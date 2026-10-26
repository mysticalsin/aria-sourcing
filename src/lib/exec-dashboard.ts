import {
  computeCampaignMetrics,
  globalKpis,
  isRealSendFact,
  realFunnelFacts,
  type GlobalKpis,
  type RealFunnelFacts,
} from "./metrics";
import { can } from "./rbac";
import { DEFAULT_ROI_ASSUMPTIONS, activitySpanDays, estimateRoi, type RoiAssumptions, type RoiEstimate } from "./roi";
import type { Activity, Campaign, Candidate, HermesState, Role, SourcePlatform, WinRecord } from "./types";
import { round, SEED_NOW } from "./utils";

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

export const EXEC_PERIODS = ["7d", "30d", "90d", "all"] as const;
export type ExecPeriod = (typeof EXEC_PERIODS)[number];

export const EXEC_PERIOD_LABEL: Record<ExecPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const PERIOD_DAYS: Record<ExecPeriod, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

export interface ExecConversionStep {
  key: "sourced" | "contacted" | "replied" | "positive" | "booked" | "accepted";
  label: string;
  count: number;
  /** Share of the previous step that reached this one; null for the first step. */
  rateFromPrevious: number | null;
}

export interface ExecValueSummary extends RoiEstimate {
  assumptions: RoiAssumptions;
  spanDays: number;
  /** Value of time saved per interview booked; null without bookings. */
  valuePerBooking: number | null;
}

/** The decision-maker report: one period, one funnel, one value estimate. */
export interface ExecDecisionReport {
  period: ExecPeriod;
  /** True when contacts are approved dry-run sends (demo); no email left the system. */
  simulated: boolean;
  facts: RealFunnelFacts;
  /** Accepted meetings (win records) in the period. */
  acceptedMeetings: number;
  conversion: ExecConversionStep[];
  value: ExecValueSummary;
}

export interface ExecDashboardModel {
  kpis: GlobalKpis;
  facts: RealFunnelFacts;
  platformFunnels: ExecFunnelRow[];
  campaignFunnels: ExecFunnelRow[];
  trends: ExecTrends;
  recentWins: WinRecord[];
  demoMode: boolean;
  report: ExecDecisionReport;
}

export interface ExecDashboardOptions {
  period?: ExecPeriod;
  /** Clock for period scoping; defaults to Date.now(). */
  nowMs?: number;
  assumptions?: RoiAssumptions;
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
  const bookings = state.bookings.filter((booking) => contactedCandidateIds.has(booking.candidateId));
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

function withinPeriod(iso: string | null | undefined, sinceMs: number | null): boolean {
  if (sinceMs == null) return true;
  if (!iso) return false;
  const at = new Date(iso).getTime();
  return Number.isFinite(at) && at >= sinceMs;
}

/** Keeps only the records that happened inside the period (by their own event time). */
export function scopeExecStateToPeriod(
  state: ExecDashboardState,
  period: ExecPeriod,
  nowMs: number = Date.now(),
): ExecDashboardState {
  const days = PERIOD_DAYS[period];
  if (days == null) return state;
  const sinceMs = nowMs - days * 86_400_000;
  return {
    ...state,
    candidates: state.candidates.filter((candidate) => withinPeriod(candidate.createdAt, sinceMs)),
    outreach: state.outreach.filter((message) => withinPeriod(message.sentAt ?? message.createdAt, sinceMs)),
    replies: state.replies.filter((reply) => withinPeriod(reply.receivedAt, sinceMs)),
    bookings: state.bookings.filter((booking) => withinPeriod(booking.createdAt, sinceMs)),
    activities: state.activities.filter((activity) => withinPeriod(activity.createdAt, sinceMs)),
    wins: (state.wins ?? []).filter((win) => withinPeriod(win.at, sinceMs)),
  };
}

export function execConversionSteps(facts: RealFunnelFacts, accepted: number): ExecConversionStep[] {
  const steps: Array<Omit<ExecConversionStep, "rateFromPrevious">> = [
    { key: "sourced", label: "Sourced", count: facts.sourced },
    { key: "contacted", label: "Contacted", count: facts.contacted },
    { key: "replied", label: "Replied", count: facts.repliedCount },
    { key: "positive", label: "Interested", count: facts.positiveReplies },
    { key: "booked", label: "Interview booked", count: facts.booked },
    { key: "accepted", label: "Meeting accepted", count: accepted },
  ];
  return steps.map((step, index) => {
    if (index === 0) return { ...step, rateFromPrevious: null };
    const previous = steps[index - 1].count;
    return { ...step, rateFromPrevious: previous > 0 ? step.count / previous : 0 };
  });
}

function decisionReport(
  state: ExecDashboardState,
  demoMode: boolean,
  live: boolean,
  period: ExecPeriod,
  assumptions: RoiAssumptions,
): ExecDecisionReport {
  const facts = realFunnelFacts(state, { live, includeSimulatedSends: demoMode });
  const acceptedMeetings = (state.wins ?? []).length;
  const counted = new Set(facts.candidateIds);
  const drafted = state.outreach.filter((message) => counted.has(message.candidateId)).length;
  const spanDays = activitySpanDays([
    ...state.candidates.filter((candidate) => counted.has(candidate.id)).map((candidate) => candidate.createdAt),
    ...state.outreach.filter((message) => counted.has(message.candidateId)).map((message) => message.createdAt),
    ...state.bookings.map((booking) => booking.createdAt),
  ]);
  const roi = estimateRoi({ sourced: facts.sourced, drafted, booked: facts.booked, spanDays }, assumptions);
  return {
    period,
    simulated: demoMode,
    facts,
    acceptedMeetings,
    conversion: execConversionSteps(facts, acceptedMeetings),
    value: {
      ...roi,
      assumptions,
      spanDays,
      valuePerBooking: facts.booked > 0 ? roi.valueSaved / facts.booked : null,
    },
  };
}

export function deriveExecDashboard(
  fullState: ExecDashboardState,
  demoMode: boolean,
  options: ExecDashboardOptions = {},
): ExecDashboardModel {
  const period = options.period ?? "all";
  // Seeded demo data is dated on the fixed seed clock, so demo periods are
  // measured from it rather than from the wall clock.
  const nowMs = options.nowMs ?? (demoMode ? SEED_NOW.getTime() : Date.now());
  const state = scopeExecStateToPeriod(fullState, period, nowMs);
  const live = !state.settings.dryRunMode;
  const facts = realFunnelFacts(state, { live });
  return {
    report: decisionReport(state, demoMode, live, period, options.assumptions ?? DEFAULT_ROI_ASSUMPTIONS),
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
