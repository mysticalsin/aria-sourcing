/* ============================================================================
   OUTBOUND DISPATCHER — the ONLY path from messages_outbound to the wire.

   Every queued message that is due must clear, in order:
     1. a named human approval row for exactly this message id + body hash,
     2. the human-likeness gate — again, defence in depth,
     3. a live seat of the right provider and the channel's atomic claim
        (Email or assisted LinkedIn). Any other channel is blocked.
   Anything that fails flips to 'blocked' (human queue) or 'failed'; an
   unconfigured provider is counted separately. A message never silently retries
   into a double-send (dedupe_hash UNIQUE + ledger claim).

   Called from /api/cron/dispatch-outbound.
   ========================================================================== */

import type { SupabaseClient } from "@supabase/supabase-js";
import { gateOutbound } from "@/lib/gate";
import { safeLog } from "@/lib/log-redact";
import { approvalHash } from "@/lib/outreach-content";
import { publicDemoSideEffectsDisabled } from "@/lib/server/demo-side-effects";
import { detectInjection, validateCandidateBoundText } from "@/lib/agent-disclosure-policy";
import { performEmailSend } from "@/lib/email-send";
import { createEmailUnsubscribeLink } from "@/lib/email-unsubscribe";
import { linkedInAdapterForProvider } from "@/lib/linkedin-channel";

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

async function loopSendControlsPermit(supabase: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("sourcing_loop_controls")
    .select("kill_switch, sequences_enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    safeLog("dispatch-outbound: loop controls lookup error", { message: error.message });
    return false;
  }
  const controls = record(data);
  return controls?.kill_switch === false && controls.sequences_enabled === true;
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
    if (!(await loopSendControlsPermit(supabase, msg.workspace_id))) continue;
    let deliveryAttemptId: string | null = null;
    const finish = async (status: "sent" | "blocked" | "failed", gateResult?: unknown, countAs?: DispatchOutcomeCounter) => {
      let transition = supabase
        .from("messages_outbound")
        .update({
          status,
          ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
          ...(gateResult !== undefined ? { gate_result: gateResult } : {}),
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
      // Only Email and assisted LinkedIn are dispatchable. A legacy row on any
      // other channel (e.g. legacy WhatsApp / SMS rows) never reaches a provider.
      if (msg.channel !== "Email" && msg.channel !== "LinkedIn") {
        await finish("blocked", { pass: false, reasons: ["channel-not-dispatchable"] });
        continue;
      }

      // 1. Approval must exist for exactly this message.
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

      // 2. Human-likeness and disclosure safeguards on the free-form text.
      const gate = gateOutbound(msg.body);
      if (!gate.pass) {
        await finish("blocked", { pass: false, reasons: gate.reasons });
        continue;
      }
      const { data: spec } = msg.spec_id
        ? await supabase
            .from("agent_specs")
            .select("role_brief")
            .eq("id", msg.spec_id)
            .eq("workspace_id", msg.workspace_id)
            .maybeSingle()
        : { data: null };
      const disclosure = validateCandidateBoundText(msg.body, disclosureInternalFromBrief(record(spec)?.role_brief));
      const injection = detectInjection(msg.body);
      if (!disclosure.safe || injection.flagged) {
        await finish("blocked", { pass: false, reasons: [disclosure.reason ?? "injection-suspected"] });
        continue;
      }

      if (msg.channel === "LinkedIn") {
        const { data: seat, error: seatErr } = await supabase
          .from("agent_seats")
          .select("id, provider, status, mode")
          .eq("id", msg.seat_id ?? "")
          .eq("workspace_id", msg.workspace_id)
          .maybeSingle();
        if (seatErr) {
          safeLog("dispatch-outbound: LinkedIn seat lookup error", { message: seatErr.message });
          await finish("blocked", { pass: false, reasons: ["linkedin-seat-store-unavailable"] });
          continue;
        }
        const adapter = linkedInAdapterForProvider(seat?.provider);
        if (!seat || seat.status !== "active" || seat.mode !== "live" || !adapter) {
          await finish("blocked", { pass: false, reasons: ["linkedin-seat-not-live"] });
          continue;
        }
        if (!adapter.configured()) {
          await finish("blocked", { pass: false, reasons: ["linkedin-provider-unconfigured"] }, "unconfigured");
          continue;
        }

        const { data: claim, error: claimErr } = await supabase.rpc("claim_linkedin_outbound_queued", {
          p_message_id: msg.id,
        });
        if (claimErr) {
          safeLog("dispatch-outbound: LinkedIn claim error", { message: claimErr.message });
          await finish("failed");
          continue;
        }
        const claimObj = claim as {
          allowed?: boolean;
          reason?: string;
          ledger_id?: string;
          delivery_attempt_id?: string;
          profile_url?: string;
        } | null;
        if (claimObj?.allowed !== true) {
          if (claimObj?.reason === "not-queued" || claimObj?.reason === "message-not-found") {
            continue;
          }
          await finish("blocked", { pass: false, reasons: [`guardrail:${claimObj?.reason ?? "blocked"}`] });
          continue;
        }
        deliveryAttemptId = claimObj.delivery_attempt_id ?? null;
        if (!deliveryAttemptId || !UUID_PATTERN.test(deliveryAttemptId) || !claimObj.profile_url || !claimObj.ledger_id) {
          safeLog("dispatch-outbound: LinkedIn claim returned no valid ownership token");
          stats.failed++;
          continue;
        }

        const outcome = await adapter.deliver({
          workspaceId: msg.workspace_id,
          messageId: msg.id,
          candidateId: msg.candidate_id,
          profileUrl: claimObj.profile_url,
          subject: msg.subject ?? "",
          body: msg.body,
          attemptId: deliveryAttemptId,
        });
        const outcomeKind =
          outcome.status === "sent" && outcome.deliveryState === "accepted"
            ? "sent"
            : outcome.deliveryState === "unknown"
              ? "ambiguous"
              : "skipped";
        const { data: recorded, error: recordErr } = await supabase.rpc("record_linkedin_delivery_outcome", {
          p_message_id: msg.id,
          p_delivery_attempt_id: deliveryAttemptId,
          p_outcome: outcomeKind,
          p_reason: outcomeKind === "sent" ? null : outcome.detail.slice(0, 512),
          p_provider_message_id: outcome.id ?? null,
        });
        const recordedObj = recorded as { allowed?: boolean; reason?: string } | null;
        if (recordErr || recordedObj?.allowed !== true) {
          safeLog("dispatch-outbound: LinkedIn outcome reconciliation failed", {
            message: recordErr?.message ?? recordedObj?.reason ?? "unknown",
          });
          stats.failed++;
          continue;
        }
        if (outcomeKind === "sent") {
          stats.sent++;
        } else if (outcome.status === "dry-run") {
          stats.unconfigured++;
        } else {
          stats.failed++;
        }
        continue;
      }

      // 2c. Email joins the durable outbox (Rock 2). Approval, human-likeness, and
      // disclosure already cleared above. The service-only claim re-verifies the
      // approval, suppression, a LIVE domain-verified email seat, the 90-day
      // window, and the warmup cap in ONE transaction, transitions the outbox row
      // queued -> dispatching under a delivery_attempt_id (the pre-dispatch trigger
      // is the final race-safe gate), and mints the RFC Message-ID the send stamps
      // and a reply threads back to. Never calls a provider from the request path.
      if (msg.channel === "Email") {
        const unsubscribe = createEmailUnsubscribeLink();
        if (!unsubscribe) {
          await finish("blocked", { pass: false, reasons: ["email-unsubscribe-unavailable"] });
          continue;
        }

        const { data: claim, error: claimErr } = await supabase.rpc("claim_email_outbound_queued", {
          p_message_id: msg.id,
        });
        if (claimErr) {
          safeLog("dispatch-outbound: email claim error", { message: claimErr.message });
          await finish("failed");
          continue;
        }
        const emailClaim = claim as {
          allowed?: boolean;
          reason?: string;
          ledger_id?: string;
          delivery_attempt_id?: string;
          rfc_message_id?: string;
          operator_email?: string;
          provider?: string;
        } | null;
        if (emailClaim?.allowed !== true) {
          if (emailClaim?.reason === "not-queued" || emailClaim?.reason === "message-not-found") {
            // Another worker already owns or completed this row; its state is
            // authoritative and a losing selector must never downgrade it.
            continue;
          }
          await finish("blocked", { pass: false, reasons: [`guardrail:${emailClaim?.reason ?? "blocked"}`] });
          continue;
        }
        deliveryAttemptId = emailClaim.delivery_attempt_id ?? null;
        const rfcMessageId = emailClaim.rfc_message_id ?? "";
        if (
          !deliveryAttemptId ||
          !UUID_PATTERN.test(deliveryAttemptId) ||
          !rfcMessageId ||
          !emailClaim.operator_email ||
          !emailClaim.provider ||
          !emailClaim.ledger_id
        ) {
          // A provider call without the DB-issued ownership token / message id
          // could never be reconciled safely. Leave the claimed row for operator
          // recovery rather than guessing a terminal state.
          safeLog("dispatch-outbound: email claim returned no valid ownership token or rfc id");
          stats.failed++;
          continue;
        }

        // Bind the one-click unsubscribe token to the claimed ledger BEFORE any
        // provider call; a failure finalizes the attempt without sending.
        const { data: tokenBound, error: tokenBindErr } = await supabase
          .from("outreach_ledger")
          .update({ email_unsubscribe_token_hash: unsubscribe.tokenHash })
          .eq("id", emailClaim.ledger_id)
          .eq("workspace_id", msg.workspace_id)
          .is("email_unsubscribe_token_hash", null)
          .select("id")
          .maybeSingle();
        if (tokenBindErr || !tokenBound) {
          safeLog("dispatch-outbound: email unsubscribe token bind error", { message: tokenBindErr?.message ?? "no ledger row" });
          await supabase.rpc("finalize_email_provider_failure", {
            p_message_id: msg.id,
            p_delivery_attempt_id: deliveryAttemptId,
            p_reason: "Unsubscribe token storage failed.",
          });
          stats.failed++;
          continue;
        }

        const outcome = await performEmailSend(supabase, {
          workspaceId: msg.workspace_id,
          seatId: msg.seat_id ?? "",
          provider: emailClaim.provider,
          operatorEmail: emailClaim.operator_email,
          to: msg.to_address,
          subject: msg.subject ?? "",
          body: msg.body,
          unsubscribeUrl: unsubscribe.url,
          attemptId: deliveryAttemptId,
          rfcMessageId,
        });

        if (outcome.status === "sent" && outcome.deliveryState === "accepted") {
          const { data: acceptance, error: acceptanceErr } = await supabase.rpc("record_email_send_message_id", {
            p_message_id: msg.id,
            p_delivery_attempt_id: deliveryAttemptId,
            p_rfc_message_id: rfcMessageId,
          });
          const acceptanceObj = acceptance as { allowed?: boolean; reason?: string } | null;
          if (acceptanceErr || acceptanceObj?.allowed !== true) {
            // The provider accepted but the durable acceptance record failed: leave
            // the row dispatching for human recovery, never retry (double-send risk).
            safeLog("dispatch-outbound: email acceptance reconciliation failed", {
              message: acceptanceErr?.message ?? acceptanceObj?.reason ?? "unknown",
            });
            stats.failed++;
            continue;
          }
          stats.sent++;
          continue;
        }
        if (outcome.deliveryState === "not-sent") {
          // Provably pre-transport (or an intentional dry-run): the provider never
          // accepted, so the ledger slot is retryable. outbox -> failed, ledger ->
          // skipped. A dry-run means the provider is unconfigured.
          const providerUnconfigured = outcome.status === "dry-run";
          await supabase.rpc("finalize_email_provider_failure", {
            p_message_id: msg.id,
            p_delivery_attempt_id: deliveryAttemptId,
            p_reason: outcome.detail.slice(0, 512),
          });
          stats[providerUnconfigured ? "unconfigured" : "failed"]++;
          continue;
        }
        // deliveryState 'unknown' — a timeout or 5xx may have followed provider
        // acceptance. Leave the row dispatching (ledger stays claimed) for human
        // reconciliation via send_attempt_id; retrying could double-contact.
        safeLog("dispatch-outbound: email result requires reconciliation", { deliveryState: outcome.deliveryState });
        stats.failed++;
        continue;
      }

      await finish("blocked", { pass: false, reasons: ["channel-not-dispatchable"] });
    } catch (err) {
      safeLog("dispatch-outbound: error", { message: err instanceof Error ? err.message : "unknown" });
      await finish("failed");
    }
  }

  return stats;
}
