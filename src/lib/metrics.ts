import type {
  Campaign,
  CampaignMetrics,
  Candidate,
  FunnelPoint,
  HermesState,
} from "./types";
import { FUNNEL_STAGES } from "./types";
import { round } from "./utils";

/* Effective funnel rank for any candidate stage. Terminal/negative stages map
   to the furthest pipeline point they actually reached. */
export const STAGE_RANK: Record<string, number> = {
  Sourced: 0,
  Contacted: 1,
  Replied: 2,
  Interested: 3,
  Booked: 4,
  Interviewed: 5,
  Offer: 6,
  Hired: 7,
  "Not Interested": 2,
  Rejected: 1,
  Suppressed: 1,
};

export function stageRank(stage: string): number {
  return STAGE_RANK[stage] ?? 0;
}

const FUNNEL_RANK: Record<string, number> = {
  Sourced: 0,
  Contacted: 1,
  Replied: 2,
  Interested: 3,
  Booked: 4,
  Interviewed: 5,
  Hired: 7,
};

export function funnelForCandidates(candidates: Candidate[]): FunnelPoint[] {
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    count: candidates.filter((c) => stageRank(c.stage) >= FUNNEL_RANK[stage]).length,
  }));
}

export function computeCampaignMetrics(
  candidates: Candidate[],
  prev?: Partial<CampaignMetrics>,
): CampaignMetrics {
  const sourced = candidates.length;
  const contacted = candidates.filter((c) => stageRank(c.stage) >= 1).length;
  const replied = candidates.filter((c) => stageRank(c.stage) >= 2).length;
  const interested = candidates.filter(
    (c) => stageRank(c.stage) >= 3 && c.stage !== "Not Interested",
  ).length;
  const booked = candidates.filter((c) => stageRank(c.stage) >= 4).length;
  const interviewed = candidates.filter((c) =>
    ["Interviewed", "Offer", "Hired"].includes(c.stage),
  ).length;
  const offer = candidates.filter((c) => ["Offer", "Hired"].includes(c.stage)).length;
  const hired = candidates.filter((c) => c.stage === "Hired").length;
  const notInterested = candidates.filter((c) => c.stage === "Not Interested").length;
  const scores = candidates.map((c) => c.matchScore).filter(Boolean);
  const avg = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  return {
    sourced,
    contacted,
    replied,
    interested,
    booked,
    interviewed,
    offer,
    hired,
    notInterested,
    replyRate: contacted ? replied / contacted : 0,
    avgMatchScore: avg,
    timeToFirstInterviewHours:
      prev?.timeToFirstInterviewHours ?? (booked > 0 ? 36 : null),
    emailsSentToday: prev?.emailsSentToday ?? 0,
    linkedinSentToday: prev?.linkedinSentToday ?? 0,
  };
}

export interface GlobalKpis {
  activeCampaigns: number;
  totalCampaigns: number;
  candidatesSourced: number;
  contacted: number;
  replyRate: number;
  interviewsBooked: number;
  interested: number;
  awaitingBooking: number;
  avgMatchScore: number;
  timeToFirstInterviewHours: number | null;
  pendingApprovals: number;
  hotReplies: number;
}

export function globalKpis(state: HermesState): GlobalKpis {
  const active = state.campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  const cands = state.candidates;
  const contacted = cands.filter((c) => stageRank(c.stage) >= 1).length;
  const replied = cands.filter((c) => stageRank(c.stage) >= 2).length;
  const booked = cands.filter((c) => stageRank(c.stage) >= 4).length;
  const interested = cands.filter(
    (c) => stageRank(c.stage) >= 3 && c.stage !== "Not Interested",
  ).length;
  const awaitingBooking = cands.filter((c) => c.stage === "Interested" && !c.booking).length;
  const scores = cands.map((c) => c.matchScore).filter(Boolean);
  const avg = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  // Mean time-to-first-interview across ACTIVE campaigns only.
  const ttfi = active
    .map((c) => c.metrics.timeToFirstInterviewHours)
    .filter((v): v is number => v != null);

  return {
    activeCampaigns: active.length,
    totalCampaigns: state.campaigns.length,
    candidatesSourced: cands.length,
    contacted,
    replyRate: contacted ? replied / contacted : 0,
    interviewsBooked: booked,
    interested,
    awaitingBooking,
    avgMatchScore: avg,
    timeToFirstInterviewHours: ttfi.length ? round(ttfi.reduce((a, b) => a + b, 0) / ttfi.length) : null,
    pendingApprovals: state.outreach.filter((m) => m.status === "Needs Approval").length,
    hotReplies: state.replies.filter(
      (r) => !r.handled && ["INTERESTED", "QUALIFIED_INTEREST"].includes(r.intent),
    ).length,
  };
}

export function campaignById(state: HermesState, id: string): Campaign | undefined {
  return state.campaigns.find((c) => c.id === id);
}

export function candidatesForCampaign(state: HermesState, campaignId: string): Candidate[] {
  return state.candidates.filter((c) => c.campaignId === campaignId);
}
