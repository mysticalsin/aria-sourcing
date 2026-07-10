import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { safeLog } from "@/lib/log-redact";
import {
  verifyMetaSignature,
  parseWhatsAppWebhook,
  parseWhatsAppDeliveryStatuses,
} from "@/lib/autopilot";
import { dispatchDue } from "@/lib/dispatch-outbound";
import { isWhatsAppOptOut, normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";
import { decideWhatsAppInboundDisposition, decideWhatsAppReceiptAcknowledgement } from "@/lib/whatsapp-review-policy";
import { processStoredWhatsAppInbound, recoverPendingWhatsAppInbound } from "@/lib/whatsapp-inbound";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook — the inbound half of gated autopilot.
 *
 * GET: Meta's one-time subscription handshake (hub.challenge echo).
 * POST: signature-verified message delivery. Each text message is stored in
 * messages_inbound (idempotent on provider message id), threaded to the
 * candidate via the latest outbound to that phone, answered by the reply
 * composer, and routed by decideAutopilot():
 *   - every generated draft → messages_outbound status 'blocked', visible in
 *     the Replies queue for a named human to review and explicitly send.
 *
 * A verified event is acknowledged only after durable storage is available.
 * Individual processing failures are logged and retained for cron recovery;
 * a missing service client returns 503 so Meta retries rather than dropping
 * the event permanently.
 */

const VERIFY_TOKEN = () => process.env.WHATSAPP_VERIFY_TOKEN ?? "";
const APP_SECRET = () => process.env.WHATSAPP_APP_SECRET ?? "";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && VERIFY_TOKEN() && token === VERIFY_TOKEN()) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signature, APP_SECRET())) {
    return NextResponse.json({ ok: false, reason: "Bad signature." }, { status: 401 });
  }

  const supabase = getServiceSupabase();
  if (!supabase) {
    safeLog("whatsapp webhook: not configured", { hasSupabase: false });
    return NextResponse.json({ ok: false, reason: "Service client unavailable." }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true }); // not JSON we understand; ack
  }

  // Delivery/read receipts are signed provider facts, never candidate replies.
  // Resolve the sender without requiring it to remain active so an event already
  // in flight can still reconcile after an operator pauses the sender. A known
  // sender's failed persistence is retryable: acknowledging it would silently
  // lose a durable delivery fact.
  let retryableReceiptFailure = false;
  for (const receipt of parseWhatsAppDeliveryStatuses(payload)) {
    try {
      if (receipt.occurredAt > Date.now() + 5 * 60 * 1_000) {
        safeLog("whatsapp delivery receipt ignored: future timestamp", { status: receipt.status });
        continue;
      }
      const { data: sender, error: senderErr } = await supabase
        .from("whatsapp_senders")
        .select("id, workspace_id")
        .eq("meta_phone_number_id", receipt.senderPhoneNumberId)
        .maybeSingle();
      if (senderErr) {
        retryableReceiptFailure = true;
        safeLog("whatsapp delivery sender lookup error", { message: senderErr.message });
        continue;
      }
      if (!sender) {
        continue;
      }
      const { data: event, error: eventErr } = await supabase.rpc("record_whatsapp_delivery_event", {
        p_workspace_id: sender.workspace_id,
        p_sender_id: sender.id,
        p_provider_message_id: receipt.providerMessageId,
        p_event_status: receipt.status,
        p_provider_occurred_at: new Date(receipt.occurredAt).toISOString(),
        p_provider_error_code: receipt.providerErrorCode ?? null,
      });
      const receiptDecision = decideWhatsAppReceiptAcknowledgement({
        senderKnown: true,
        rpcResult: eventErr
          ? null
          : (event as { recorded?: boolean; retryable?: boolean; reason?: string } | null),
      });
      if (!receiptDecision.acknowledge) {
        retryableReceiptFailure = true;
        safeLog("whatsapp delivery receipt reconciliation error", { message: eventErr?.message ?? receiptDecision.reason });
      }
    } catch (err) {
      retryableReceiptFailure = true;
      safeLog("whatsapp delivery receipt processing error", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // The inbound row is committed before any model call. The lease-backed
  // processor makes a Meta redelivery, a webhook restart, and cron recovery
  // converge on that stored row rather than losing it after a mid-pipeline
  // error or composing two candidate replies.
  let retryableInboundFailure = false;
  for (const msg of parseWhatsAppWebhook(payload)) {
    try {
      // Resolve a tenant from Meta's signed phone-number ID. An environment
      // workspace fallback would let a valid event cross tenant boundaries.
      const { data: sender, error: senderErr } = await supabase
        .from("whatsapp_senders")
        .select("id, workspace_id, status")
        .eq("meta_phone_number_id", msg.senderPhoneNumberId)
        .maybeSingle();
      if (senderErr) {
        retryableInboundFailure = true;
        safeLog("whatsapp sender lookup error", { message: senderErr.message });
        continue;
      }
      if (!sender) {
        continue;
      }
      const inboundDisposition = decideWhatsAppInboundDisposition({
        senderStatus: sender.status,
        isOptOut: isWhatsAppOptOut(msg.text),
      });
      const workspaceId = sender.workspace_id;
      const recipientE164 = normalizeWhatsAppAddress(msg.from);
      if (!recipientE164) {
        safeLog("whatsapp inbound: invalid sender address", { providerId: msg.providerId });
        continue;
      }
      const localNow = Date.now();
      const receivedAt = Number.isFinite(msg.timestamp) && msg.timestamp > 0 && msg.timestamp <= localNow + 5 * 60 * 1_000
        ? new Date(msg.timestamp).toISOString()
        : new Date(localNow).toISOString();

      // 1. Store inbound, idempotent on Meta's message id.
      const { data: inserted, error: insErr } = await supabase
        .from("messages_inbound")
        .insert({
          workspace_id: workspaceId,
          channel: "WhatsApp",
          from_address: recipientE164,
          body: msg.text,
          provider_id: msg.providerId,
          received_at: receivedAt,
          whatsapp_sender_id: sender.id,
          processed: inboundDisposition.initiallyProcessed,
        })
        .select("id")
        .maybeSingle();
      let inboundId = inserted?.id;
      let existingInboundProcessed = inboundDisposition.initiallyProcessed;
      if (insErr?.code === "23505") {
        // A prior delivery may have stored the row before the process failed.
        // Reclaim it through the same lease instead of treating a duplicate as
        // proof that it was successfully processed.
        const { data: existing, error: existingErr } = await supabase
          .from("messages_inbound")
          .select("id, processed")
          .eq("workspace_id", workspaceId)
          .eq("channel", "WhatsApp")
          .eq("provider_id", msg.providerId)
          .maybeSingle();
        if (existingErr || !existing) {
          retryableInboundFailure = true;
          safeLog("whatsapp inbound duplicate lookup error", { message: existingErr?.message ?? "not found" });
          continue;
        }
        inboundId = existing.id;
        existingInboundProcessed = existing.processed === true;
      } else if (insErr) {
        retryableInboundFailure = true;
        safeLog("whatsapp inbound insert error", { message: insErr.message });
        continue;
      }
      if (!inboundId) {
        retryableInboundFailure = true;
        safeLog("whatsapp inbound persistence returned no id", { providerId: msg.providerId });
        continue;
      }

      if (!inboundDisposition.process) {
        // If an inactive-sender event is a redelivery of a row created before
        // the pause, record the current non-dispatch decision too. Recovery
        // only selects unfinished rows, so reactivation cannot draft this text.
        if (!existingInboundProcessed) {
          const { error: blockErr } = await supabase
            .from("messages_inbound")
            .update({ processed: true })
            .eq("id", inboundId)
            .eq("workspace_id", workspaceId)
            .eq("processed", false);
          if (blockErr) {
            retryableInboundFailure = true;
            safeLog("whatsapp inactive inbound disposition update error", { message: blockErr.message });
          }
        }
        continue;
      }

      const result = await processStoredWhatsAppInbound(supabase, { inboundId, senderId: sender.id });
      if (result.outcome === "retry") {
        retryableInboundFailure = true;
        safeLog("whatsapp inbound processing deferred", { reason: result.reason });
      }
    } catch (err) {
      retryableInboundFailure = true;
      safeLog("whatsapp webhook processing error", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  try {
    const recovery = await recoverPendingWhatsAppInbound(supabase, 5);
    if (recovery.retryable > 0) retryableInboundFailure = true;
  } catch (err) {
    retryableInboundFailure = true;
    safeLog("whatsapp inbound recovery error", { message: err instanceof Error ? err.message : "unknown" });
  }

  // Opportunistic drain: Meta calls this webhook for every delivery/read
  // receipt too, so due queued messages go out with near-human latency even
  // though Vercel Hobby only allows a daily cron (the /api/cron backstop).
  try {
    await dispatchDue(supabase, 5);
  } catch (err) {
    safeLog("whatsapp webhook: drain error", { message: err instanceof Error ? err.message : "unknown" });
  }

  if (retryableReceiptFailure || retryableInboundFailure) {
    return NextResponse.json(
      { ok: false, reason: "Retryable WhatsApp persistence failure." },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}
