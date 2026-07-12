/* ============================================================================
   OUTBOUND DISPATCHER — the ONLY path from messages_outbound to the wire.

   Every queued message that is due must clear, in order:
     1. a named human approval row for exactly this message id + body hash,
     2. the human-likeness gate — again, defence in depth,
     3. a live seat of the right provider,
     4. claim_whatsapp_outbound for WhatsApp, which atomically validates
        consent, DNC, template/window, seat, and the delivery ledger.
        SMS stays disabled before any claim until it has equivalent controls.
   Anything that fails flips to 'blocked' (human queue) or 'failed'; an
   unconfigured provider is counted separately. A message never silently retries
   into a double-send (dedupe_hash UNIQUE + ledger claim).

   Called from two places (Vercel Hobby forbids minute crons):
     - /api/webhooks/whatsapp — opportunistic drain after each inbound event
       (delivery/read receipts arrive constantly, so due messages go out with
       near-human latency),
     - /api/cron/dispatch-outbound — daily backstop for quiet periods.
   ========================================================================== */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsApp, sendSms, type ChannelSendOutcome } from "@/lib/channels";
import { gateOutbound } from "@/lib/gate";
import { safeLog } from "@/lib/log-redact";
import { approvalHash } from "@/lib/outreach-content";
import {
  APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT,
  buildApprovedWhatsAppTemplateAudit,
  parseApprovedWhatsAppTemplateParameterSchema,
} from "@/lib/whatsapp-template-queue";
import { assessWhatsAppDispatch, type WhatsAppPermission } from "@/lib/whatsapp-policy";
import { shouldReopenWhatsAppReview } from "@/lib/whatsapp-review-policy";
import { publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { detectInjection, validateCandidateBoundText } from "@/lib/agent-disclosure-policy";

const WHATSAPP_GATE_CACHE_VERSION = "whatsapp-outbound-gate-v1";
const WHATSAPP_GATE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function disclosureInternalFromBrief(value: unknown): Parameters<typeof validateCandidateBoundText>[1] {
  const brief = record(value);
  if (!brief) return {};
  return {
    salaryMin: typeof brief.salaryMin === "number" ? brief.salaryMin : null,
    salaryMax: typeof brief.salaryMax === "number" ? brief.salaryMax : null,
    forbidden: [brief.department, brief.teamSize, brief.reportingTo, brief.currency]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0),
  };
}

export interface DispatchStats {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
  unconfigured: number;
}

type DispatchOutcomeCounter = Exclude<keyof DispatchStats, "processed">;

/**
 * Maps a Twilio result to the durable ledger state used if SMS is enabled in a
 * future release. Only a definitive provider rejection may release the claim.
 * A timeout, 5xx, disconnect, contradictory result, or response without a
 * durable SID remains ambiguous and therefore holds the de-duplication slot.
 */
export function resolveSmsLedgerStatus(outcome: ChannelSendOutcome): "sent" | "skipped" | "ambiguous" {
  if (
    outcome.status === "sent" &&
    outcome.deliveryState === "accepted" &&
    typeof outcome.id === "string" &&
    outcome.id.trim().length > 0
  ) {
    return "sent";
  }
  if (outcome.status !== "sent" && outcome.deliveryState === "not-sent") return "skipped";
  return "ambiguous";
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
  const stats: DispatchStats = { processed: 0, sent: 0, blocked: 0, failed: 0, unconfigured: 0 };

  // A public demo may still use a real Supabase database. Never let a queued
  // row from that shared environment reach a provider, regardless of caller.
  if (publicDemoSideEffectsDisabled()) return stats;

  let dueQuery = supabase
    .from("messages_outbound")
    .select("id, workspace_id, spec_id, candidate_id, seat_id, channel, to_address, subject, body, type, template_id, template_parameters, approval_message_id, review_decision")
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
    let deliveryAttemptId: string | null = null;
    const finish = async (status: "sent" | "blocked" | "failed", gateResult?: unknown, countAs?: DispatchOutcomeCounter) => {
      const reopenReview =
        status === "blocked" &&
        shouldReopenWhatsAppReview({
          channel: msg.channel,
          type: msg.type,
          status,
          reviewDecision: msg.review_decision ?? null,
        });
      let transition = supabase
        .from("messages_outbound")
        .update({
          status,
          ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
          ...(gateResult !== undefined ? { gate_result: gateResult } : {}),
          ...(reopenReview ? { review_decision: null, reviewed_at: null, reviewed_by: null } : {}),
        })
        .eq("id", msg.id)
        .eq("status", deliveryAttemptId ? "dispatching" : "queued");
      if (deliveryAttemptId) {
        transition = transition.eq("delivery_attempt_id", deliveryAttemptId);
      }
      const { data: transitioned, error: transitionError } = await transition
        .select("id")
        .maybeSingle();
      if (transitionError) {
        safeLog("dispatch-outbound: terminal transition error", { message: transitionError.message });
        return;
      }
      if (transitioned) stats[countAs ?? status]++;
    };

    try {
      // SMS has no equivalent consent, opt-out, suppression, or durable-outbox
      // policy yet. Never let a service-role row turn into a live Twilio send.
      if (msg.channel === "SMS") {
        await finish("blocked", { pass: false, reasons: ["sms-disabled-pending-consent-policy"] });
        continue;
      }

      // A Meta-approved template is not free-form candidate copy. Before
      // looking up its approval, reconstruct the exact audit payload from the
      // current trusted template record and normalized stored parameters. This
      // makes a post-approval change to template identity, locale, sender,
      // version, schema, or parameters fail closed before the DB claim.
      const isApprovedWhatsAppTemplate = msg.channel === "WhatsApp" && msg.type === "approved_template";
      let whatsappTemplate: { name: string; language: string; bodyParameters: string[] } | null = null;
      let templateAuditBody: string | null = null;
      if (isApprovedWhatsAppTemplate) {
        const { data: template, error: templateErr } = await supabase
          .from("whatsapp_templates")
          .select("id, sender_id, meta_name, language, version, status, parameter_schema, body_parameter_count")
          .eq("workspace_id", msg.workspace_id)
          .eq("id", msg.template_id ?? "")
          .maybeSingle();
        if (templateErr) {
          safeLog("dispatch-outbound: WhatsApp template lookup error", { message: templateErr.message });
          await finish("blocked", { pass: false, reasons: ["whatsapp-template-store-unavailable"] });
          continue;
        }
        if (!template || template.status !== "approved") {
          await finish("blocked", { pass: false, reasons: ["whatsapp:template-not-approved"] });
          continue;
        }
        const parameterSchema = parseApprovedWhatsAppTemplateParameterSchema(
          template.parameter_schema,
          template.body_parameter_count,
        );
        const audit = parameterSchema
          ? buildApprovedWhatsAppTemplateAudit({
              template: {
                id: String(template.id),
                senderId: String(template.sender_id),
                metaName: String(template.meta_name),
                language: String(template.language),
                version: Number(template.version),
              },
              parameterSchema,
              parameters: msg.template_parameters,
            })
          : null;
        if (!audit) {
          await finish("blocked", { pass: false, reasons: ["whatsapp:template-parameters-invalid"] });
          continue;
        }
        if (msg.subject !== APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT || msg.body !== audit.body) {
          await finish("blocked", { pass: false, reasons: ["whatsapp:template-audit-mismatch"] });
          continue;
        }
        templateAuditBody = audit.body;
        whatsappTemplate = {
          name: String(template.meta_name),
          language: String(template.language),
          bodyParameters: audit.parameters,
        };
      }

      // 1. Approval must exist for exactly this message. For an externally
      // approved template, the canonical audit payload replaces candidate
      // prose so identity and normalized parameters are part of the hash.
      const bodyHash = isApprovedWhatsAppTemplate
        ? approvalHash(APPROVED_WHATSAPP_TEMPLATE_AUDIT_SUBJECT, templateAuditBody ?? "")
        : approvalHash(msg.subject ?? "", msg.body);
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

      // 2. Human-likeness is a free-form text safeguard. It intentionally does
      // not evaluate the machine-readable audit record for an externally
      // approved Meta template; that record was already bound to the approval
      // above and the actual recipient-facing text stays in Meta's template.
      if (!isApprovedWhatsAppTemplate) {
        const gate = gateOutbound(msg.body);
        if (msg.channel === "WhatsApp" && !(await cacheWhatsAppGateVerdict(supabase, msg.workspace_id, msg.body, gate))) {
          await finish("blocked", { pass: false, reasons: ["whatsapp:gate-cache-write-failed"] });
          continue;
        }
        if (!gate.pass) {
          await finish("blocked", { pass: false, reasons: gate.reasons });
          continue;
        }
        const { data: spec } = msg.spec_id
          ? await supabase
              .from("agent_specs")
              .select("role_brief")
              .eq("id", msg.spec_id)
              .maybeSingle()
          : { data: null };
        const disclosure = validateCandidateBoundText(msg.body, disclosureInternalFromBrief(record(spec)?.role_brief));
        const injection = detectInjection(msg.body);
        if (!disclosure.safe || injection.flagged) {
          await finish("blocked", { pass: false, reasons: [disclosure.reason ?? "injection-suspected"] });
          continue;
        }
      }

      // 2b. WhatsApp has its own legal/provider boundary. A free-form reply
      // needs a current, matching opt-in plus an open customer-service window.
      // A business-initiated message must instead identify a trusted template.
      // This happens before a seat check, ledger claim, or provider call.
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
        if (msg.channel === "WhatsApp" && (claimObj?.reason === "not-queued" || claimObj?.reason === "message-not-found")) {
          // Another worker already owns or completed this row. Its state is
          // authoritative; a losing selector must never downgrade it.
          continue;
        }
        await finish("blocked", { pass: false, reasons: [`guardrail:${claimObj?.reason ?? "blocked"}`] });
        continue;
      }
      deliveryAttemptId = claimObj.delivery_attempt_id ?? null;
      if (msg.channel === "WhatsApp" && (!deliveryAttemptId || !UUID_PATTERN.test(deliveryAttemptId))) {
        // A provider call without the database-issued ownership token could
        // never be reconciled or finalized safely. Leave the claimed row for
        // operator recovery rather than guessing a terminal state.
        safeLog("dispatch-outbound: WhatsApp claim returned no valid delivery attempt");
        stats.failed++;
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
      if (msg.channel === "WhatsApp") {
        if (outcome.status === "dry-run") {
          if (claimObj.ledger_id) {
            await supabase
              .from("outreach_ledger")
              .update({
                status: "skipped",
                reason: outcome.detail,
              })
              .eq("id", claimObj.ledger_id);
          }
          await finish("blocked", { pass: false, reasons: ["provider-unconfigured"] }, "unconfigured");
          continue;
        }
        if (outcome.deliveryState !== "not-sent") {
          // A timeout, disconnect, or successful response without Meta's
          // durable id may have been accepted. Releasing the claim would make
          // a retry capable of double-contacting the candidate.
          safeLog("dispatch-outbound: WhatsApp result requires reconciliation", {
            deliveryState: outcome.deliveryState,
          });
          stats.failed++;
          continue;
        }
        try {
          const { data: failure, error: failureErr } = await supabase.rpc(
            "finalize_whatsapp_provider_failure",
            {
              p_message_id: msg.id,
              p_delivery_attempt_id: deliveryAttemptId,
              p_reason: outcome.detail.slice(0, 512),
            },
          );
          const failureObj = failure as { allowed?: boolean; reason?: string } | null;
          if (failureErr || failureObj?.allowed !== true) {
            safeLog("dispatch-outbound: WhatsApp failure finalization failed", {
              message: failureErr?.message ?? failureObj?.reason ?? "unknown",
            });
          }
        } catch (err) {
          safeLog("dispatch-outbound: WhatsApp failure finalization error", {
            message: err instanceof Error ? err.message : "unknown",
          });
        }
        stats.failed++;
        continue;
      }
      const smsLedgerStatus = resolveSmsLedgerStatus(outcome);
      if (claimObj.ledger_id) {
        await supabase
          .from("outreach_ledger")
          .update({
            status: smsLedgerStatus,
            reason: smsLedgerStatus === "sent" ? null : outcome.detail,
          })
          .eq("id", claimObj.ledger_id);
      }
      const providerUnconfigured = outcome.status === "dry-run" && smsLedgerStatus === "skipped";
      await finish(
        smsLedgerStatus === "sent" ? "sent" : providerUnconfigured ? "blocked" : "failed",
        smsLedgerStatus === "ambiguous"
          ? { pass: false, reasons: ["sms-provider-reconciliation-required"] }
          : providerUnconfigured
            ? { pass: false, reasons: ["provider-unconfigured"] }
            : undefined,
        providerUnconfigured ? "unconfigured" : undefined,
      );
    } catch (err) {
      safeLog("dispatch-outbound: error", { message: err instanceof Error ? err.message : "unknown" });
      await finish("failed");
    }
  }

  return stats;
}
