import {
  computeCampaignMetrics,
  globalKpis,
  isRealSendFact,
  realFunnelFacts,
  type GlobalKpis,
  type RealFunnelFacts,
} from "./metrics";
import { can } from "./rbac";
import type { Activity, Campaign, Candidate, HermesState, Role, SourcePlatform, WinRecord } from "./types";
import { round } from "./utils";

export type ExecDashboardState = Pick<
  HermesState,
  "campaigns" | "candidates" | "outreach" | "replies" | "bookings" | "activities" | "settings" | "wins"
>;

export interface ExecFunnelRow {
  id: string;
  label: string;
  facts: RealFunnelFacts;
  avgMatchScore: number;
  timeToFirstInterviewHours: number | null;
}

export interface ExecTrends {
  sourced: number[];
  contacted: number[];
  replied: number[];
  booked: number[];
}

export interface ExecDashboardModel {
  kpis: GlobalKpis;
  facts: RealFunnelFacts;
  platformFunnels: ExecFunnelRow[];
  campaignFunnels: ExecFunnelRow[];
  trends: ExecTrends;
  recentWins: WinRecord[];
  demoMode: boolean;
}

const TREND_POINTS = 8;

function scopedCandidates(state: ExecDashboardState, live: boolean, campaignId?: string): Candidate[] {
  const candidateIds = new Set(realFunnelFacts(state, { live, campaignId }).candidateIds);
  return state.candidates.filter((candidate) => candidateIds.has(candidate.id));
}

function avgMatchScore(candidates: Candidate[]): number {
  const scores = candidates.map((candidate) => candidate.matchScore).filter(Boolean);
  return scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
}

function campaignFirstInterviewHours(campaign: Campaign | undefined): number | null {
  return campaign?.metrics.timeToFirstInterviewHours ?? null;
}

function trendBuckets(dates: string[], minMs: number, maxMs: number): number[] {
  const buckets = new Array(TREND_POINTS).fill(0) as number[];
  const span = Math.max(1, maxMs - minMs);
  for (const iso of dates) {
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at)) continue;
    const rawIndex = Math.floor(((at - minMs) / span) * TREND_POINTS);
    const index = Math.max(0, Math.min(TREND_POINTS - 1, rawIndex));
    buckets[index] += 1;
  }
  return buckets;
}

function trendWindow(activities: Activity[], dates: string[]): { minMs: number; maxMs: number } {
  const times = [...activities.map((activity) => activity.createdAt), ...dates]
    .map((iso) => new Date(iso).getTime())
    .filter(Number.isFinite);
  if (times.length === 0) {
    const now = Date.now();
    return { minMs: now, maxMs: now + 1 };
  }
  return { minMs: Math.min(...times), maxMs: Math.max(...times) + 1 };
}

function deriveTrends(state: ExecDashboardState, live: boolean): ExecTrends {
  const facts = realFunnelFacts(state, { live });
  const candidateIds = new Set(facts.candidateIds);
  const contactedCandidateIds = new Set(facts.contactedCandidateIds);
  const candidates = state.candidates.filter((candidate) => candidateIds.has(candidate.id));
  const realOutreach = state.outreach.filter(
    (message) => contactedCandidateIds.has(message.candidateId) && isRealSendFact(message),
  );
  const replies = state.replies.filter((reply) => contactedCandidateIds.has(reply.candidateId));
  const bookings = state.bookings.filter(
    (booking) =>
      contactedCandidateIds.has(booking.candidateId)
      && Boolean(booking.teamsLink || booking.calLink),
  );
  const allDates = [
    ...candidates.map((candidate) => candidate.createdAt),
    ...realOutreach.map((message) => message.sentAt).filter((sentAt): sentAt is string => sentAt != null),
    ...replies.map((reply) => reply.receivedAt),
    ...bookings.map((booking) => booking.createdAt),
  ];
  const { minMs, maxMs } = trendWindow(
    state.activities.filter((activity) => activity.type !== "system"),
    allDates,
  );

  return {
    sourced: trendBuckets(candidates.map((candidate) => candidate.createdAt), minMs, maxMs),
    contacted: trendBuckets(
      realOutreach.map((message) => message.sentAt).filter((sentAt): sentAt is string => sentAt != null),
      minMs,
      maxMs,
    ),
    replied: trendBuckets(replies.map((reply) => reply.receivedAt), minMs, maxMs),
    booked: trendBuckets(bookings.map((booking) => booking.createdAt), minMs, maxMs),
  };
}

function platformRows(state: ExecDashboardState, live: boolean): ExecFunnelRow[] {
  const scoped = scopedCandidates(state, live);
  const platforms = Array.from(new Set(scoped.map((candidate) => candidate.sourcePlatform))).sort();
  return platforms.map((platform) => {
    const candidates = scoped.filter((candidate) => candidate.sourcePlatform === platform);
    const facts = realFunnelFacts({ ...state, candidates }, { live });
    return {
      id: platform,
      label: platform,
      facts,
      avgMatchScore: avgMatchScore(candidates),
      timeToFirstInterviewHours: null,
    };
  });
}

function campaignRows(state: ExecDashboardState, live: boolean): ExecFunnelRow[] {
  return state.campaigns
    .map((campaign) => {
      const candidates = scopedCandidates(state, live, campaign.id);
      const facts = realFunnelFacts(state, { live, campaignId: campaign.id });
      const metrics = computeCampaignMetrics(
        candidates,
        campaign.metrics,
        campaignFirstInterviewHours(campaign),
        facts,
      );
      return {
        id: campaign.id,
        label: campaign.title,
        facts,
        avgMatchScore: metrics.avgMatchScore,
        timeToFirstInterviewHours: metrics.timeToFirstInterviewHours,
      };
    })
    .filter((row) => row.facts.sourced > 0 || row.facts.contacted > 0 || row.facts.booked > 0);
}

export function deriveExecDashboard(state: ExecDashboardState, demoMode: boolean): ExecDashboardModel {
  const live = !state.settings.dryRunMode;
  const facts = realFunnelFacts(state, { live });
  return {
    kpis: globalKpis(state),
    facts,
    platformFunnels: platformRows(state, live),
    campaignFunnels: campaignRows(state, live),
    trends: deriveTrends(state, live),
    recentWins: [...(state.wins ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6),
    demoMode,
  };
}

export function execCanExport(role: Role): boolean {
  return can(role, "manage_settings");
}

export function execWinCandidateLabel(win: Pick<WinRecord, "candidateName" | "roleTitle">, role: Role): string {
  if (execCanExport(role)) return win.candidateName;
  return win.candidateName.trim().split(/\s+/)[0] || "Candidate";
}
