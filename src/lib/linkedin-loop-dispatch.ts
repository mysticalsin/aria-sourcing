// Outbound half of the LinkedIn reply loop. Drains queued loop replies whose
// delay has elapsed and sends them through the configured vendor adapter. The
// loop never counts an assisted-manual draft or an unconfigured vendor as
// sent: those rows are blocked and stay visible as drafts for a human.

import { inLoopQuietHours, loopSendTime } from "@/lib/linkedin-loop";
import type { LinkedInLoopStore, LoopQueuedReply } from "@/lib/linkedin-loop-store";
import { linkedInAdapterForProvider, type LinkedInAdapter } from "@/lib/linkedin-channel";
import { gateLoopReply } from "@/lib/linkedin-inbound";
import { linkedInSenderCanSend } from "@/lib/linkedin-connect-card";

export interface LoopDispatchStats {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
  unconfigured: number;
  rescheduled: number;
}

export interface LoopDispatchDeps {
  store: LinkedInLoopStore;
  now?: () => Date;
  adapterFor?: (provider: string) => LinkedInAdapter | null;
}

function briefRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function dispatchLinkedInLoopDue(deps: LoopDispatchDeps, limit = 10): Promise<LoopDispatchStats> {
  const stats: LoopDispatchStats = { processed: 0, sent: 0, blocked: 0, failed: 0, unconfigured: 0, rescheduled: 0 };
  const now = deps.now?.() ?? new Date();
  const adapterFor = deps.adapterFor ?? linkedInAdapterForProvider;
  const due = await deps.store.listDueReplies(now, Math.max(1, Math.min(50, limit)));
  if (!due) return stats;

  for (const reply of due) {
    stats.processed++;
    const block = async (reason: string, countAs: "blocked" | "unconfigured" = "blocked") => {
      await deps.store.updateReply(reply.id, { status: "blocked", gateResult: { pass: false, reasons: [reason] } });
      stats[countAs]++;
    };

    const [controls, grant] = await Promise.all([deps.store.readControls(reply.workspaceId), deps.store.getGrant(reply.grantId)]);
    if (!controls || controls.killSwitch) {
      await block("linkedin-loop:kill-switch");
      continue;
    }
    if (!controls.loopEnabled) {
      await block("linkedin-loop:disabled");
      continue;
    }
    if (!grant || grant.revokedAt || grant.workspaceId !== reply.workspaceId) {
      await block("linkedin-loop:campaign-launch-revoked");
      continue;
    }
    if (inLoopQuietHours(now, { start: grant.quietStart, end: grant.quietEnd }, grant.timezone)) {
      const later = loopSendTime(now, `${reply.id}:${now.toISOString()}`, { start: grant.quietStart, end: grant.quietEnd }, grant.timezone);
      await deps.store.updateReply(reply.id, { scheduledAt: later.toISOString() });
      stats.rescheduled++;
      continue;
    }

    const brief = briefRecord(reply.specId ? await deps.store.readRoleBrief(reply.workspaceId, reply.specId) : null);
    const gated = gateLoopReply(reply.body, brief, "");
    if (gated.reasons.length > 0) {
      await block(gated.reasons[0]);
      continue;
    }

    const seat = reply.seatId ? await deps.store.readSeat(reply.workspaceId, reply.seatId) : null;
    const adapter = seat ? adapterFor(seat.provider) : null;
    if (!seat || seat.status !== "active" || seat.mode !== "live" || !adapter) {
      await block("linkedin-seat-not-live");
      continue;
    }
    if (adapter.kind !== "vendor-api") {
      // Assisted-manual means a person copies and pastes. The loop never
      // pretends that happened.
      await block("linkedin-loop:requires-vendor-api", "unconfigured");
      continue;
    }
    if (!adapter.configured()) {
      await block("linkedin-provider-unconfigured", "unconfigured");
      continue;
    }
    if (!linkedInSenderCanSend(seat.providerState)) {
      // The sender behind the seat is not attached, paused or restricted
      // (0058). The claim would refuse too; blocking here keeps the reason visible.
      await block("linkedin-sender-not-connected");
      continue;
    }

    const claim = await deps.store.claimReply(reply.id);
    if (!claim) {
      stats.failed++;
      continue;
    }
    if (!claim.allowed) {
      if (claim.reason === "not-queued" || claim.reason === "message-not-found") continue;
      await block(`guardrail:${claim.reason ?? "blocked"}`);
      continue;
    }
    if (!claim.deliveryAttemptId || !claim.profileUrl) {
      stats.failed++;
      continue;
    }

    const outcome = await adapter.deliver({
      workspaceId: reply.workspaceId,
      messageId: reply.id,
      candidateId: reply.candidateId,
      profileUrl: claim.profileUrl,
      subject: reply.subject,
      body: reply.body,
      attemptId: claim.deliveryAttemptId,
    });
    const kind: "sent" | "skipped" | "ambiguous" =
      outcome.status === "sent" && outcome.deliveryState === "accepted" && outcome.id
        ? "sent"
        : outcome.deliveryState === "unknown"
          ? "ambiguous"
          : "skipped";
    const recorded = await deps.store.recordOutcome(
      reply.id,
      claim.deliveryAttemptId,
      kind,
      kind === "sent" ? null : outcome.detail.slice(0, 512),
      outcome.id ?? null,
    );
    if (!recorded) {
      stats.failed++;
      continue;
    }
    if (kind === "sent") stats.sent++;
    else stats.failed++;
  }
  return stats;
}

export type { LoopQueuedReply };
