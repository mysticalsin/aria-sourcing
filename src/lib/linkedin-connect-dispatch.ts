// Campaign dispatcher for LinkedIn connection requests (plan S5, section 3.2).
// Drains queued connection requests whose scheduled time has passed and sends
// them through the vendor adapter's connect primitive: one claim per row, two
// to ten minutes between rows in a workspace, quiet hours respected, the
// workspace connect cap re-checked here and again inside the claim. A spent cap
// is not a failure: the row waits for tomorrow's limit, still queued, visible.
// An unconfigured connect endpoint or an assisted-manual seat is never counted
// as sent; the row is blocked with the reason and stays a draft for a person.

import {
  LINKEDIN_CONNECT_NOTE_MAX,
  effectiveConnectCap,
  inLoopQuietHours,
  loopNextDayStart,
  loopSendTime,
  type LoopQuietHours,
} from "@/lib/linkedin-loop";
import type { LinkedInConnectStore, QueuedConnect } from "@/lib/linkedin-connect-store";
import { linkedInAdapterForProvider, type LinkedInAdapter } from "@/lib/linkedin-channel";
import { gateLoopReply } from "@/lib/linkedin-inbound";
import { linkedInSenderCanSend } from "@/lib/linkedin-connect-card";

export interface CampaignDispatchStats {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
  unconfigured: number;
  rescheduled: number;
  /** Rows pushed to tomorrow because today's connect limit is spent. */
  waiting: number;
}

export interface CampaignDispatchDeps {
  store: LinkedInConnectStore;
  now?: () => Date;
  adapterFor?: (provider: string) => LinkedInAdapter | null;
}

export const WAITING_FOR_LIMIT_REASON = "linkedin-campaign:waiting-for-tomorrow-limit";

function briefRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function dispatchLinkedInCampaignDue(deps: CampaignDispatchDeps, limit = 10): Promise<CampaignDispatchStats> {
  const stats: CampaignDispatchStats = { processed: 0, sent: 0, blocked: 0, failed: 0, unconfigured: 0, rescheduled: 0, waiting: 0 };
  const now = deps.now?.() ?? new Date();
  const adapterFor = deps.adapterFor ?? linkedInAdapterForProvider;
  const due = await deps.store.listDueConnects(now, Math.max(1, Math.min(50, limit)));
  if (!due) return stats;

  // One send per workspace per pass; the rest of that workspace's due rows are
  // pushed two to ten minutes out so consecutive requests never leave together.
  const sentInWorkspace = new Set<string>();

  for (const row of due) {
    stats.processed++;
    const block = async (reason: string, countAs: "blocked" | "unconfigured" = "blocked") => {
      await deps.store.updateConnect(row.id, { status: "blocked", gateResult: { pass: false, reasons: [reason] } });
      stats[countAs]++;
    };

    const controls = await deps.store.readControls(row.workspaceId);
    if (!controls || controls.killSwitch) {
      await block("linkedin-campaign:kill-switch");
      continue;
    }
    if (!controls.loopEnabled) {
      await block("linkedin-campaign:sending-off");
      continue;
    }

    // The human gate: the note was shown and approved at a campaign launch that
    // is still live. The claim re-checks the hashes; here the launch is checked
    // so the reason stays visible on the row.
    const approval = await deps.store.readLaunchApproval(row.workspaceId, row.approvalMessageId);
    if (!approval || approval.revokedAt || !approval.grantId) {
      await block("linkedin-campaign:not-launched");
      continue;
    }
    const grant = await deps.store.getGrant(approval.grantId);
    if (!grant || grant.workspaceId !== row.workspaceId || grant.scope !== "campaign") {
      await block("linkedin-campaign:not-launched");
      continue;
    }
    if (grant.revokedAt) {
      await block("linkedin-campaign:launch-revoked");
      continue;
    }

    const quiet: LoopQuietHours = { start: grant.quietStart, end: grant.quietEnd };
    if (inLoopQuietHours(now, quiet, grant.timezone) || sentInWorkspace.has(row.workspaceId)) {
      const later = loopSendTime(now, `${row.id}:${now.toISOString()}`, quiet, grant.timezone);
      await deps.store.updateConnect(row.id, { scheduledAt: later.toISOString() });
      stats.rescheduled++;
      continue;
    }

    if (row.note.length > LINKEDIN_CONNECT_NOTE_MAX) {
      await block("linkedin-campaign:note-too-long");
      continue;
    }
    if (row.note.trim()) {
      const brief = briefRecord(row.specId ? await deps.store.readRoleBrief(row.workspaceId, row.specId) : null);
      const gated = gateLoopReply(row.note, brief, "");
      if (gated.reasons.length > 0) {
        await block(gated.reasons[0]);
        continue;
      }
    }

    const seatId = row.seatId ?? grant.seatId;
    const seat = seatId ? await deps.store.readSeat(row.workspaceId, seatId) : null;
    const adapter = seat ? adapterFor(seat.provider) : null;
    if (!seat || seat.status !== "active" || seat.mode !== "live" || !adapter) {
      await block("linkedin-seat-not-live");
      continue;
    }
    if (adapter.kind !== "vendor-api") {
      // A person cannot be asked to copy and paste an invitation. Never "sent".
      await block("linkedin-campaign:requires-vendor-api", "unconfigured");
      continue;
    }
    if (!adapter.connectConfigured()) {
      await block("linkedin-connect-unconfigured", "unconfigured");
      continue;
    }
    if (!linkedInSenderCanSend(seat.providerState)) {
      await block("linkedin-sender-not-connected");
      continue;
    }

    // Workspace connect ceiling, in the workspace's own day. A spent limit
    // means the row waits for tomorrow, still queued and visible.
    const waitForTomorrow = async () => {
      const tomorrow = loopSendTime(loopNextDayStart(now, controls.timezone), `${row.id}:tomorrow`, quiet, grant.timezone);
      await deps.store.updateConnect(row.id, {
        scheduledAt: tomorrow.toISOString(),
        gateResult: { pass: true, reasons: [WAITING_FOR_LIMIT_REASON] },
      });
      stats.waiting++;
    };
    const connectsToday = await deps.store.countWorkspaceConnectsToday(row.workspaceId, controls.timezone, now);
    if (connectsToday === null) {
      stats.failed++;
      continue;
    }
    if (connectsToday >= effectiveConnectCap(controls)) {
      await waitForTomorrow();
      continue;
    }

    const claim = await deps.store.claimConnect(row.id);
    if (!claim) {
      stats.failed++;
      continue;
    }
    if (!claim.allowed) {
      if (claim.reason === "not-queued" || claim.reason === "message-not-found") continue;
      if (claim.reason === "workspace-connect-cap-reached") {
        // The claim serialises per workspace: the 26th in the same second lands here.
        await waitForTomorrow();
        continue;
      }
      if (claim.reason === "connect-too-soon") {
        // Another drain sent one from this workspace under two minutes ago.
        const later = loopSendTime(now, `${row.id}:${now.toISOString()}:spacing`, quiet, grant.timezone);
        await deps.store.updateConnect(row.id, { scheduledAt: later.toISOString() });
        stats.rescheduled++;
        continue;
      }
      await block(`guardrail:${claim.reason ?? "blocked"}`);
      continue;
    }
    if (!claim.deliveryAttemptId || !claim.profileUrl) {
      stats.failed++;
      continue;
    }

    const outcome = await adapter.connect({
      workspaceId: row.workspaceId,
      messageId: row.id,
      candidateId: row.candidateId,
      profileUrl: claim.profileUrl,
      note: row.note,
      attemptId: claim.deliveryAttemptId,
    });
    const kind: "sent" | "skipped" | "ambiguous" =
      outcome.status === "sent" && outcome.deliveryState === "accepted" && outcome.id
        ? "sent"
        : outcome.deliveryState === "unknown"
          ? "ambiguous"
          : "skipped";
    const recorded = await deps.store.recordConnectOutcome(
      row.id,
      claim.deliveryAttemptId,
      kind,
      kind === "sent" ? null : outcome.detail.slice(0, 512),
      outcome.id ?? null,
    );
    if (!recorded) {
      stats.failed++;
      continue;
    }
    if (kind === "sent") {
      stats.sent++;
      sentInWorkspace.add(row.workspaceId);
    } else {
      stats.failed++;
    }
  }
  return stats;
}

export type { QueuedConnect };
