/* ============================================================================
   Pure workspace transitions shared by the browser store and server code
   (agents). No React, no I/O.
   ========================================================================== */

import type { Activity, CandidateStage, OutreachLedgerEntry, WorkspaceState } from "@/lib/types";
import { computeCampaignMetrics, firstInterviewElapsedHours, realFunnelFacts } from "@/lib/metrics";
import { genId } from "@/lib/utils";

export function makeActivity(
  activity: Omit<Activity, "id" | "createdAt"> & { createdAt?: string },
): Activity {
  return {
    id: genId("act"),
    createdAt: activity.createdAt ?? new Date().toISOString(),
    ...activity,
  };
}

export function withActivity(
  state: WorkspaceState,
  activity: Activity,
  campaignId: string | null,
): WorkspaceState {
  const campaigns = campaignId
    ? state.campaigns.map((campaign) =>
        campaign.id === campaignId
          ? {
              ...campaign,
              activities: [activity, ...campaign.activities].slice(0, 80),
            }
          : campaign,
      )
    : state.campaigns;
  return {
    ...state,
    campaigns,
    activities: [activity, ...state.activities].slice(0, 300),
  };
}

export function recomputeMetrics(state: WorkspaceState, campaignId: string): WorkspaceState {
  const candidates = state.candidates.filter(
    (candidate) => candidate.campaignId === campaignId,
  );
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  const firstInterviewHours = campaign
    ? firstInterviewElapsedHours(
        state.bookings.filter((booking) => booking.campaignId === campaignId),
        campaign.createdAt,
      )
    : null;
  return {
    ...state,
    campaigns: state.campaigns.map((item) =>
      item.id === campaignId
        ? {
            ...item,
            metrics: computeCampaignMetrics(
              candidates,
              item.metrics,
              firstInterviewHours,
              realFunnelFacts(state, {
                live: !state.settings.dryRunMode,
                campaignId,
              }),
            ),
          }
        : item,
    ),
  };
}

/**
 * A LinkedIn outreach message left (the operator confirmed a manual send, or
 * the bridge extension reported it sent): the message becomes Scheduled with
 * its send time, a Sourced candidate becomes Contacted, a ledger row and a
 * campaign activity are written, the campaign's LinkedIn counter goes up.
 * Returns the state unchanged when the message, its candidate or its
 * campaign is missing, or the message is not a LinkedIn message.
 */
export function recordLinkedInSent(
  prev: WorkspaceState,
  messageId: string,
  now: string,
  note: { reason: string; notes: string; title?: string },
): WorkspaceState {
  const msg = prev.outreach.find((m) => m.id === messageId);
  if (!msg || msg.channel !== "LinkedIn") return prev;
  const candidate = prev.candidates.find((c) => c.id === msg.candidateId);
  const campaign = prev.campaigns.find((c) => c.id === msg.campaignId);
  if (!candidate || !campaign) return prev;
  const outreach = prev.outreach.map((m) =>
    m.id === messageId
      ? { ...m, status: "Scheduled" as const, scheduledFor: now, sentAt: now }
      : m,
  );
  const candidates = prev.candidates.map((c) =>
    c.id === candidate.id
      ? {
          ...c,
          stage: (["Sourced"].includes(c.stage) ? "Contacted" : c.stage) as CandidateStage,
          lastContactedAt: now,
          outreachHistory: [
            { messageId, channel: msg.channel, subject: msg.subject, status: "Scheduled" as const, at: now },
            ...c.outreachHistory,
          ],
        }
      : c,
  );
  const ledgerEntry: OutreachLedgerEntry = {
    id: genId("led"),
    candidateId: candidate.id,
    candidateEmail: candidate.email,
    seatId: "",
    campaignId: campaign.id,
    channel: msg.channel,
    status: "sent",
    reason: note.reason,
    at: now,
  };
  let next: WorkspaceState = { ...prev, outreach, candidates, ledger: [ledgerEntry, ...prev.ledger] };
  next = {
    ...next,
    campaigns: next.campaigns.map((c) =>
      c.id === campaign.id
        ? { ...c, metrics: { ...c.metrics, linkedinSentToday: c.metrics.linkedinSentToday + 1 } }
        : c,
    ),
  };
  next = recomputeMetrics(next, campaign.id);
  return withActivity(
    next,
    makeActivity({
      type: "outreach",
      title: note.title ?? `LinkedIn message sent: ${candidate.name}`,
      notes: note.notes,
      outcome: "Scheduled",
      campaignId: campaign.id,
      linkedEntityType: "candidate",
      linkedEntityId: candidate.id,
    }),
    campaign.id,
  );
}
