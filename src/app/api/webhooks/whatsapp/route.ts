import { NextResponse, type NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/server";
import { safeLog } from "@/lib/log-redact";
import {
  verifyMetaSignature,
  parseWhatsAppWebhook,
  parseWhatsAppDeliveryStatuses,
  buildReplyPrompt,
  decideAutopilot,
  type SpecGuardrails,
} from "@/lib/autopilot";
import { dedupeHash } from "@/lib/gate";
import { dispatchDue } from "@/lib/dispatch-outbound";
import { isWhatsAppOptOut, normalizeWhatsAppAddress } from "@/lib/whatsapp-policy";
import {
  CLOUD_ENDPOINT,
  PROVIDER_ENV,
  DEFAULT_MODEL,
  buildCloudRequest,
  parseCloudResponse,
  type AiProviderSlug,
} from "@/lib/ai/provider";

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

/** First env-configured provider wins; the reply composer needs no tools. */
function envProvider(): { slug: AiProviderSlug; key: string } | null {
  const order: AiProviderSlug[] = ["anthropic", "openai", "groq", "mistral", "xai"];
  for (const slug of order) {
    const key = process.env[PROVIDER_ENV[slug]] ?? "";
    if (key && CLOUD_ENDPOINT[slug]) return { slug, key };
  }
  return null;
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
  // in flight can still reconcile after an operator pauses the sender.
  for (const receipt of parseWhatsAppDeliveryStatuses(payload)) {
    try {
      if (receipt.occurredAt > Date.now() + 5 * 60 * 1_000) {
        safeLog("whatsapp delivery receipt ignored: future timestamp", { status: receipt.status });
        continue;
      }
      const { data: sender, error: senderErr } = await supabase
        .from("whatsapp_senders")
        .select("workspace_id")
        .eq("meta_phone_number_id", receipt.senderPhoneNumberId)
        .maybeSingle();
      if (senderErr || !sender) {
        if (senderErr) safeLog("whatsapp delivery sender lookup error", { message: senderErr.message });
        continue;
      }
      const { error: eventErr } = await supabase.rpc("record_whatsapp_delivery_event", {
        p_workspace_id: sender.workspace_id,
        p_provider_message_id: receipt.providerMessageId,
        p_event_status: receipt.status,
        p_provider_occurred_at: new Date(receipt.occurredAt).toISOString(),
        p_provider_error_code: receipt.providerErrorCode ?? null,
      });
      if (eventErr) safeLog("whatsapp delivery receipt reconciliation error", { message: eventErr.message });
    } catch (err) {
      safeLog("whatsapp delivery receipt processing error", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  for (const msg of parseWhatsAppWebhook(payload)) {
    try {
      // Resolve a tenant from Meta's signed phone-number ID. An environment
      // workspace fallback would let a valid event cross tenant boundaries.
      const { data: sender, error: senderErr } = await supabase
        .from("whatsapp_senders")
        .select("id, workspace_id, status")
        .eq("meta_phone_number_id", msg.senderPhoneNumberId)
        .maybeSingle();
      if (senderErr || !sender || sender.status !== "active") {
        if (senderErr) safeLog("whatsapp sender lookup error", { message: senderErr.message });
        continue;
      }
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
        })
        .select("id")
        .maybeSingle();
      if (insErr) {
        // Unique violation = Meta redelivery of a message we already handled.
        if (insErr.code !== "23505") safeLog("whatsapp inbound insert error", { message: insErr.message });
        continue;
      }
      if (!inserted) continue;

      // A deterministic opt-out has no agent, thread, or model path. The
      // phone suppression and queued-message cancellation happen before any
      // reply content is considered.
      if (isWhatsAppOptOut(msg.text)) {
        const { error: optOutErr } = await supabase
          .from("whatsapp_contacts")
          .upsert(
            {
              workspace_id: workspaceId,
              recipient_e164: recipientE164,
              consent_status: "opted_out",
              consent_source: "candidate-message",
              consent_evidence: { provider_message_id: msg.providerId },
              recorded_at: receivedAt,
              expires_at: null,
              revoked_at: receivedAt,
              revoked_reason: "candidate-opt-out",
              last_inbound_at: receivedAt,
            },
            { onConflict: "workspace_id,recipient_e164" },
          );
        if (optOutErr) {
          safeLog("whatsapp opt-out contact update error", { message: optOutErr.message });
          continue;
        }
        const { error: suppressErr } = await supabase
          .from("suppression_list")
          .upsert(
            {
              workspace_id: workspaceId,
              type: "phone",
              value: recipientE164,
              reason: "Candidate requested WhatsApp opt-out.",
              source: "WhatsApp candidate message",
            },
            { onConflict: "workspace_id,type,value" },
          );
        if (suppressErr) safeLog("whatsapp opt-out suppression error", { message: suppressErr.message });
        await supabase
          .from("messages_outbound")
          .update({ status: "blocked", gate_result: { pass: false, reasons: ["whatsapp:opted-out"] } })
          .eq("workspace_id", workspaceId)
          .eq("channel", "WhatsApp")
          .eq("recipient_e164", recipientE164)
          .in("status", ["composed", "queued"]);
        await supabase.from("messages_inbound").update({ processed: true }).eq("id", inserted.id);
        continue;
      }

      // Inbound text opens a new 24-hour reply window for this sender. It is
      // deliberately separate from consent: receiving a message does not grant
      // permission to contact an unconsented number.
      await supabase
        .from("whatsapp_contacts")
        .update({ last_inbound_at: receivedAt })
        .eq("workspace_id", workspaceId)
        .eq("recipient_e164", recipientE164)
        .eq("consent_status", "opted_in");
      const windowEnd = new Date(new Date(receivedAt).getTime() + 24 * 60 * 60 * 1_000).toISOString();
      const { error: windowErr } = await supabase
        .from("whatsapp_conversation_windows")
        .upsert(
          {
            workspace_id: workspaceId,
            sender_id: sender.id,
            recipient_e164: recipientE164,
            last_inbound_message_id: msg.providerId,
            last_inbound_at: receivedAt,
            freeform_until: windowEnd,
          },
          { onConflict: "workspace_id,sender_id,recipient_e164" },
        );
      if (windowErr) {
        safeLog("whatsapp reply-window update error", { message: windowErr.message });
        continue;
      }

      // 2. Thread to the candidate/spec via the latest outbound to this phone.
      const { data: thread } = await supabase
        .from("messages_outbound")
        .select("candidate_id, spec_id, body")
        .eq("workspace_id", workspaceId)
        .eq("to_address", recipientE164)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!thread?.spec_id) continue; // unknown sender — stays for human triage

      const { data: spec } = await supabase
        .from("agent_specs")
        .select("id, owner_id, seat_id, role_brief, guardrails, status")
        .eq("id", thread.spec_id)
        .maybeSingle();
      if (!spec || spec.status !== "active") continue;

      // 3. Compose a reply (env-key provider; skip silently if none configured).
      const provider = envProvider();
      if (!provider) continue;
      const brief = spec.role_brief as { title?: string; seniority?: string } & Record<string, unknown>;
      const { system, prompt } = buildReplyPrompt({
        inbound: msg.text,
        lastOutbound: thread.body,
        roleSummary: JSON.stringify(brief).slice(0, 2_000),
      });
      const reqSpec = buildCloudRequest(provider.slug, DEFAULT_MODEL[provider.slug], system, prompt, provider.key, 512);
      const res = await fetch(reqSpec.url, {
        method: "POST",
        headers: reqSpec.headers,
        body: reqSpec.body,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        safeLog("whatsapp autopilot: LLM error", { status: res.status });
        continue;
      }
      const draft = parseCloudResponse(provider.slug, await res.json());
      if (!draft.trim()) continue;

      // 4. Gate + guardrails decide: schedule or hand to human.
      const guardrails = (spec.guardrails ?? {}) as SpecGuardrails;
      const decision = decideAutopilot(draft, guardrails);
      const hash = dedupeHash(thread.candidate_id, "WhatsApp", decision.text);

      const { error: outErr } = await supabase
        .from("messages_outbound")
        .insert({
          workspace_id: workspaceId,
          spec_id: spec.id,
          candidate_id: thread.candidate_id,
          seat_id: spec.seat_id,
          channel: "WhatsApp",
          to_address: recipientE164,
          recipient_e164: recipientE164,
          type: "candidate_reply",
          body: decision.text,
          status: "blocked",
          gate_result: { pass: false, reasons: decision.reasons },
          dedupe_hash: hash,
          scheduled_at: null,
        })
        .select("id")
        .maybeSingle();
      if (outErr) {
        // Unique dedupe_hash violation = this exact reply already exists.
        if (outErr.code !== "23505") safeLog("whatsapp outbound insert error", { message: outErr.message });
        continue;
      }

      // 5. Canary countdown: the first N autopilot replies always go to the
      // human queue; decrement even on 'queue' so the canary actually burns.
      if (guardrails.autopilot && (guardrails.canary_remaining ?? 0) > 0) {
        await supabase
          .from("agent_specs")
          .update({ guardrails: { ...guardrails, canary_remaining: (guardrails.canary_remaining ?? 0) - 1 } })
          .eq("id", spec.id);
      }

      await supabase.from("messages_inbound").update({ processed: true }).eq("id", inserted.id);
    } catch (err) {
      safeLog("whatsapp webhook processing error", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // Opportunistic drain: Meta calls this webhook for every delivery/read
  // receipt too, so due queued messages go out with near-human latency even
  // though Vercel Hobby only allows a daily cron (the /api/cron backstop).
  try {
    await dispatchDue(supabase, 5);
  } catch (err) {
    safeLog("whatsapp webhook: drain error", { message: err instanceof Error ? err.message : "unknown" });
  }

  return NextResponse.json({ ok: true });
}
