import type {
  Booking,
  CampaignMetrics,
  Candidate,
  CandidateStage,
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

/* The furthest funnel point a candidate ever reached, even if their current
   `stage` later regressed to a terminal/negative one (Rejected, Suppressed).
   Takes the max of the tracked high-water mark and the live stage rank so a
   stale/missing maxStageRank can never under-report the current stage. */
export function effectiveStageRank(c: Candidate): number {
  return Math.max(c.maxStageRank ?? 0, stageRank(c.stage));
}

/* Computes the {stage, maxStageRank} pair for a candidate transitioning to a
   new stage. Every store.ts mutation site that sets `candidate.stage`
   (setCandidateStage, booking creation/completion, suppression, reply
   handling, ...) must merge this in, or a later regression to a terminal
   stage (Suppressed/Rejected) silently erases an earlier high-water mark
   (e.g. Interviewed) and effectiveStageRank() under-reports it. */
export function withStage(
  prev: Pick<Candidate, "stage" | "maxStageRank">,
  stage: CandidateStage,
): { stage: CandidateStage; maxStageRank: number } {
  return {
    stage,
    maxStageRank: Math.max(prev.maxStageRank ?? 0, stageRank(prev.stage), stageRank(stage)),
  };
}

/* Elapsed hours from `createdAt` to the earliest `startTime` among the given
   bookings — each booking's *scheduled* interview time, not the moment the
   booking record itself was created. This is the single, canonical
   time-to-first-interview computation shared by store.ts (live campaigns)
   and seed.ts (seeded demo campaigns) so both report the same KPI meaning.
   Returns null when there are no bookings yet. */
export function firstInterviewElapsedHours(
  bookings: Pick<Booking, "startTime">[],
  createdAt: string,
): number | null {
  const firstStartTime = bookings.reduce<string | null>(
    (min, b) => (min === null || b.startTime < min ? b.startTime : min),
    null,
  );
  if (firstStartTime === null) return null;
  return Math.max(
    0,
    Math.round((new Date(firstStartTime).getTime() - new Date(createdAt).getTime()) / 3_600_000),
  );
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
    count: candidates.filter((c) => effectiveStageRank(c) >= FUNNEL_RANK[stage]).length,
  }));
}

export function computeCampaignMetrics(
  candidates: Candidate[],
  prev?: Partial<CampaignMetrics>,
  /** Real elapsed hours from campaign creation to the first booked interview
   *  (caller computes this from actual timestamps — see recomputeMetrics in
   *  store.ts). `undefined` preserves whatever was already on `prev`; pass
   *  `null` explicitly once no booking exists yet. */
  timeToFirstInterviewHours?: number | null,
): CampaignMetrics {
  const sourced = candidates.length;
  const contacted = candidates.filter((c) => effectiveStageRank(c) >= 1).length;
  const replied = candidates.filter((c) => effectiveStageRank(c) >= 2).length;
  const interested = candidates.filter(
    (c) => effectiveStageRank(c) >= 3 && c.stage !== "Not Interested",
  ).length;
  const booked = candidates.filter((c) => effectiveStageRank(c) >= 4).length;
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
      timeToFirstInterviewHours !== undefined
        ? timeToFirstInterviewHours
        : (prev?.timeToFirstInterviewHours ?? null),
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

export function globalKpis(
  state: Pick<HermesState, "campaigns" | "candidates" | "outreach" | "replies">,
): GlobalKpis {
  const active = state.campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  const cands = state.candidates;
  const contacted = cands.filter((c) => effectiveStageRank(c) >= 1).length;
  const replied = cands.filter((c) => effectiveStageRank(c) >= 2).length;
  const booked = cands.filter((c) => effectiveStageRank(c) >= 4).length;
  const interested = cands.filter(
    (c) => effectiveStageRank(c) >= 3 && c.stage !== "Not Interested",
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
    pendingApprovals: state.outreach.filter(
      (m) => m.status === "Needs Approval" || m.status === "Pending Manual Send",
    ).length,
    hotReplies: state.replies.filter(
      (r) => !r.handled && ["INTERESTED", "QUALIFIED_INTEREST"].includes(r.intent),
    ).length,
  };
}

export function candidatesForCampaign(state: HermesState, campaignId: string): Candidate[] {
  return state.candidates.filter((c) => c.campaignId === campaignId);
}
