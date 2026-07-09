/* ============================================================================
   OUTBOUND DISPATCHER — the ONLY path from messages_outbound to the wire.

   Every queued message that is due must clear, in order:
     1. an approval row for exactly this message id + body hash (autopilot
        writes one when scheduling; a human click writes one in the Replies UI),
     2. the human-likeness gate — again, defence in depth,
     3. a live seat of the right provider,
     4. claim_whatsapp_outbound for WhatsApp, which atomically validates
        consent, DNC, template/window, seat, and the delivery ledger.
        SMS uses the existing claim_and_record path.
   Anything that fails flips to 'blocked' (human queue) or 'failed'; a message
   never silently retries into a double-send (dedupe_hash UNIQUE + ledger claim).

   Called from two places (Vercel Hobby forbids minute crons):
     - /api/webhooks/whatsapp — opportunistic drain after each inbound event
       (delivery/read receipts arrive constantly, so due messages go out with
       near-human latency),
     - /api/cron/dispatch-outbound — daily backstop for quiet periods.
   ========================================================================== */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsApp, sendSms } from "@/lib/channels";
import { gateOutbound } from "@/lib/gate";
import { safeLog } from "@/lib/log-redact";
import { approvalHash } from "@/lib/outreach-content";
import { assessWhatsAppDispatch, type WhatsAppPermission } from "@/lib/whatsapp-policy";

const WHATSAPP_GATE_CACHE_VERSION = "whatsapp-outbound-gate-v1";
const WHATSAPP_GATE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface DispatchStats {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
}

async function cacheWhatsAppGateVerdict(
  supabase: SupabaseClient,
  workspaceId: string,
  body: string,
  gate: ReturnType<typeof gateOutbound>,
): Promise<boolean> {
  const contentHash = createHash("sha256").update(body, "utf8").digest("hex");
  const now = new Date();
  const { error } = await supabase.from("outbound_content_cache").upsert(
    {
      workspace_id: workspaceId,
      content_hash: contentHash,
      gate_version: WHATSAPP_GATE_CACHE_VERSION,
      verdict: gate.pass ? "pass" : "block",
      reasons: gate.pass ? [] : gate.reasons,
      observed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + WHATSAPP_GATE_CACHE_TTL_MS).toISOString(),
    },
    { onConflict: "workspace_id,content_hash,gate_version" },
  );
  if (!error) return true;
  safeLog("dispatch-outbound: WhatsApp content-gate cache error", { message: error.message });
  return false;
}

export async function dispatchDue(supabase: SupabaseClient, limit = 10, messageId?: string): Promise<DispatchStats> {
  const stats: DispatchStats = { processed: 0, sent: 0, blocked: 0, failed: 0 };

  let dueQuery = supabase
    .from("messages_outbound")
    .select("id, workspace_id, spec_id, candidate_id, seat_id, channel, to_address, subject, body, type, template_id, template_parameters, approval_message_id")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString());
  if (messageId) dueQuery = dueQuery.eq("id", messageId);
  const { data: due, error: dueErr } = await dueQuery
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (dueErr) {
    safeLog("dispatch-outbound: select error", { message: dueErr.message });
    return stats;
  }

  for (const msg of due ?? []) {
    stats.processed++;
    const finish = async (status: "sent" | "blocked" | "failed", gateResult?: unknown) => {
      await supabase
        .from("messages_outbound")
        .update({
          status,
          ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
          ...(gateResult !== undefined ? { gate_result: gateResult } : {}),
        })
        .eq("id", msg.id);
      stats[status]++;
    };

    try {
      // SMS has no equivalent consent, opt-out, suppression, or durable-outbox
      // policy yet. Never let a service-role row turn into a live Twilio send.
      if (msg.channel === "SMS") {
        await finish("blocked", { pass: false, reasons: ["sms-disabled-pending-consent-policy"] });
        continue;
      }

      // 1. Approval must exist for exactly this text.
      const bodyHash = approvalHash(msg.subject ?? "", msg.body);
      const approvalMessageId = msg.approval_message_id ?? msg.id;
      const { data: approval } = await supabase
        .from("outreach_approvals")
        .select("body_hash, approval_source, revoked_at")
        .eq("workspace_id", msg.workspace_id)
        .eq("message_id", approvalMessageId)
        .maybeSingle();
      if (!approval || approval.revoked_at || approval.body_hash !== bodyHash || approval.approval_source !== "human") {
        const reason = !approval
          ? "no-approval"
          : approval.revoked_at
            ? "approval-revoked"
            : approval.body_hash !== bodyHash
            ? "approval-hash-mismatch"
            : "approval-not-human";
        await finish("blocked", { pass: false, reasons: [reason] });
        continue;
      }

      // 2. Human-likeness gate, re-run at the wire.
      const gate = gateOutbound(msg.body);
      if (msg.channel === "WhatsApp" && !(await cacheWhatsAppGateVerdict(supabase, msg.workspace_id, msg.body, gate))) {
        await finish("blocked", { pass: false, reasons: ["whatsapp:gate-cache-write-failed"] });
        continue;
      }
      if (!gate.pass) {
        await finish("blocked", { pass: false, reasons: gate.reasons });
        continue;
      }

      // 2b. WhatsApp has its own legal/provider boundary. A free-form reply
      // needs a current, matching opt-in plus an open customer-service window.
      // A business-initiated message must instead identify a trusted template.
      // This happens before a seat check, ledger claim, or provider call.
      let whatsappTemplate: { name: string; language: string; bodyParameters: string[] } | null = null;
      if (msg.channel === "WhatsApp") {
        const { data: contact, error: contactErr } = await supabase
          .from("whatsapp_contacts")
          .select("consent_status, recipient_e164, recorded_at, expires_at, last_inbound_at")
          .eq("workspace_id", msg.workspace_id)
          .eq("recipient_e164", msg.to_address)
          .maybeSingle();
        if (contactErr) {
          safeLog("dispatch-outbound: WhatsApp contact lookup error", { message: contactErr.message });
          await finish("blocked", { pass: false, reasons: ["whatsapp-policy-store-unavailable"] });
          continue;
        }
        const permission: WhatsAppPermission | null = contact
          ? {
              status: contact.consent_status === "opted_in" ? "opted_in" : "opted_out",
              recipientAddress: contact.recipient_e164,
              recordedAt: contact.recorded_at,
              expiresAt: contact.expires_at,
            }
          : null;
        if (msg.type === "approved_template") {
          const { data: template, error: templateErr } = await supabase
            .from("whatsapp_templates")
            .select("id, meta_name, language, status")
            .eq("workspace_id", msg.workspace_id)
            .eq("id", msg.template_id ?? "")
            .maybeSingle();
          if (templateErr) {
            safeLog("dispatch-outbound: WhatsApp template lookup error", { message: templateErr.message });
            await finish("blocked", { pass: false, reasons: ["whatsapp-template-store-unavailable"] });
            continue;
          }
          const parameters = msg.template_parameters;
          if (!Array.isArray(parameters) || !parameters.every((value) => typeof value === "string" && value.length <= 1_024)) {
            await finish("blocked", { pass: false, reasons: ["whatsapp:template-parameters-invalid"] });
            continue;
          }
          if (template) {
            whatsappTemplate = {
              name: String(template.meta_name),
              language: String(template.language),
              bodyParameters: parameters,
            };
          }
        }
        const decision = assessWhatsAppDispatch({
          now: new Date(),
          recipientAddress: msg.to_address,
          type: msg.type === "approved_template" ? "approved_template" : "candidate_reply",
          permission,
          inboundReceivedAt: contact?.last_inbound_at,
          template:
            whatsappTemplate === null
              ? null
              : { name: whatsappTemplate.name, language: whatsappTemplate.language, approved: true },
        });
        if (!decision.allow) {
          await finish("blocked", { pass: false, reasons: [`whatsapp:${decision.reason}`] });
          continue;
        }
      }

      // 3. Live seat of the right provider.
      if (msg.channel !== "WhatsApp" && msg.channel !== "SMS") {
        await finish("blocked", { pass: false, reasons: ["channel-not-dispatchable"] });
        continue;
      }
      const expectedProvider = msg.channel === "WhatsApp" ? "WhatsApp Cloud" : "Twilio SMS";
      const { data: seat } = await supabase
        .from("agent_seats")
        .select("id, provider, status, mode")
        .eq("id", msg.seat_id ?? "")
        .maybeSingle();
      if (!seat || seat.status !== "active" || seat.mode !== "live" || seat.provider !== expectedProvider) {
        await finish("blocked", { pass: false, reasons: ["seat-not-live"] });
        continue;
      }

      // 4. Atomic guardrail claim. The spec id stands in as the campaign
      // scope for agent sends.
      const { data: claim, error: claimErr } =
        msg.channel === "WhatsApp"
          ? await supabase.rpc("claim_whatsapp_outbound", { p_message_id: msg.id })
          : await supabase.rpc("claim_and_record", {
              p_candidate_id: msg.candidate_id,
              p_candidate_email: msg.to_address,
              p_campaign_id: msg.spec_id ?? "agent",
              p_seat_id: seat.id,
              p_channel: msg.channel,
            });
      if (claimErr) {
        safeLog("dispatch-outbound: claim error", { message: claimErr.message });
        await finish("failed");
        continue;
      }
      const claimObj = claim as {
        allowed?: boolean;
        reason?: string;
        ledger_id?: string;
        delivery_attempt_id?: string;
        meta_phone_number_id?: string;
      } | null;
      if (claimObj?.allowed !== true) {
        await finish("blocked", { pass: false, reasons: [`guardrail:${claimObj?.reason ?? "blocked"}`] });
        continue;
      }

      const outcome =
        msg.channel === "WhatsApp"
          ? whatsappTemplate
            ? await sendWhatsApp({
                to: msg.to_address,
                kind: "approved_template",
                template: whatsappTemplate,
                senderPhoneNumberId: claimObj?.meta_phone_number_id,
              })
          : await sendWhatsApp({ to: msg.to_address, body: msg.body, senderPhoneNumberId: claimObj?.meta_phone_number_id })
          : await sendSms({ to: msg.to_address, body: msg.body });

      // Meta accepted a WhatsApp message only when it returned its durable
      // message id. Reconcile that acceptance in one service-only transaction
      // before changing the outbox or ledger. A reconciliation failure leaves
      // the row dispatching: retrying an ambiguous external send could duplicate
      // contact, so it needs explicit human recovery instead.
      if (msg.channel === "WhatsApp" && outcome.status === "sent") {
        if (!outcome.id || !claimObj.delivery_attempt_id) {
          safeLog("dispatch-outbound: WhatsApp acceptance cannot be reconciled", {
            hasProviderMessageId: Boolean(outcome.id),
            hasDeliveryAttemptId: Boolean(claimObj.delivery_attempt_id),
          });
          stats.failed++;
          continue;
        }
        try {
          const { data: acceptance, error: acceptanceErr } = await supabase.rpc(
            "record_whatsapp_provider_acceptance",
            {
              p_message_id: msg.id,
              p_delivery_attempt_id: claimObj.delivery_attempt_id,
              p_provider_message_id: outcome.id,
            },
          );
          const acceptanceObj = acceptance as { allowed?: boolean; reason?: string } | null;
          if (acceptanceErr || acceptanceObj?.allowed !== true) {
            safeLog("dispatch-outbound: WhatsApp acceptance reconciliation failed", {
              message: acceptanceErr?.message ?? acceptanceObj?.reason ?? "unknown",
            });
            stats.failed++;
            continue;
          }
          stats.sent++;
          continue;
        } catch (err) {
          safeLog("dispatch-outbound: WhatsApp acceptance reconciliation error", {
            message: err instanceof Error ? err.message : "unknown",
          });
          stats.failed++;
          continue;
        }
      }
      if (claimObj.ledger_id) {
        await supabase
          .from("outreach_ledger")
          .update({
            status: outcome.status === "sent" ? "sent" : "skipped",
            reason: outcome.status === "sent" ? null : outcome.detail,
          })
          .eq("id", claimObj.ledger_id);
      }
      await finish(outcome.status === "sent" ? "sent" : "failed");
    } catch (err) {
      safeLog("dispatch-outbound: error", { message: err instanceof Error ? err.message : "unknown" });
      await finish("failed");
    }
  }

  return stats;
}
