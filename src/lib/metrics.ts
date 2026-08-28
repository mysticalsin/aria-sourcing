import type {
  Booking,
  CampaignMetrics,
  Candidate,
  CandidateStage,
  ClassifiedReply,
  FunnelPoint,
  HermesState,
  OutreachMessage,
} from "./types";
import { FUNNEL_STAGES } from "./types";
import { round } from "./utils";
import { bookingNeedsCalendar } from "./booking-status";

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

export interface RealFunnelFacts {
  sourced: number;
  contacted: number;
  repliedCount: number;
  positiveReplies: number;
  booked: number;
  replyRate: number;
  positiveReplyRate: number;
  candidateIds: string[];
  contactedCandidateIds: string[];
}

export interface RealFunnelOptions {
  live: boolean;
  campaignId?: string;
}

export type RealFunnelState = Pick<
  HermesState,
  "candidates" | "outreach" | "replies" | "bookings"
>;

export function isRealSendFact(
  message: Pick<OutreachMessage, "dryRun" | "sentAt">,
): boolean {
  return message.dryRun === false && message.sentAt != null;
}

function candidatesInScope(
  candidates: Candidate[],
  { live, campaignId }: RealFunnelOptions,
): Candidate[] {
  return candidates.filter(
    (candidate) =>
      (campaignId == null || candidate.campaignId === campaignId) &&
      (!live || candidate.provenance !== "synthetic"),
  );
}

function replyIsPositive(reply: Pick<ClassifiedReply, "intent">): boolean {
  return reply.intent === "INTERESTED" || reply.intent === "QUALIFIED_INTEREST";
}

/* Canonical real-send funnel facts.
   Pipeline-stage high-water counts remain available via effectiveStageRank() and
   funnelForCandidates(); this derivation is for executive/contact KPIs that
   must only count completed real sends, replies, and bookings. */
export function realFunnelFacts(
  state: RealFunnelState,
  options: RealFunnelOptions,
): RealFunnelFacts {
  const eligibleCandidates = candidatesInScope(state.candidates, options);
  const eligibleCandidateIds = new Set(eligibleCandidates.map((candidate) => candidate.id));
  const inCampaign = (campaignId: string) =>
    options.campaignId == null || campaignId === options.campaignId;

  const contactedCandidateIds = new Set(
    state.outreach
      .filter(
        (message) =>
          inCampaign(message.campaignId) &&
          eligibleCandidateIds.has(message.candidateId) &&
          isRealSendFact(message),
      )
      .map((message) => message.candidateId),
  );

  const replies = state.replies.filter(
    (reply) =>
      inCampaign(reply.campaignId) &&
      contactedCandidateIds.has(reply.candidateId),
  );
  const repliedCandidateIds = new Set(replies.map((reply) => reply.candidateId));
  const positiveReplyCandidateIds = new Set(
    replies.filter(replyIsPositive).map((reply) => reply.candidateId),
  );
  const bookings = state.bookings.filter(
    (booking) =>
      inCampaign(booking.campaignId) &&
      contactedCandidateIds.has(booking.candidateId) &&
      // KPI "booked" requires a real meeting/calendar URL — local slots are not interviews.
      Boolean(booking.teamsLink || booking.calLink),
  );

  const contacted = contactedCandidateIds.size;
  const repliedCount = repliedCandidateIds.size;
  const positiveReplies = positiveReplyCandidateIds.size;

  return {
    sourced: eligibleCandidates.length,
    contacted,
    repliedCount,
    positiveReplies,
    booked: bookings.length,
    replyRate: contacted ? repliedCount / contacted : 0,
    positiveReplyRate: contacted ? positiveReplies / contacted : 0,
    candidateIds: [...eligibleCandidateIds],
    contactedCandidateIds: [...contactedCandidateIds],
  };
}

export interface MissionControlHudValues {
  sourced: number;
  contacted: number;
  drafted: number;
  approved: number;
  booked: number;
}

export function missionControlHudValues(
  state: RealFunnelState,
  options: RealFunnelOptions,
): MissionControlHudValues {
  const facts = realFunnelFacts(state, options);
  const eligibleCandidateIds = new Set(facts.candidateIds);
  const scopedOutreach = state.outreach.filter(
    (message) =>
      eligibleCandidateIds.has(message.candidateId) &&
      (options.campaignId == null || message.campaignId === options.campaignId),
  );

  return {
    sourced: facts.sourced,
    contacted: facts.contacted,
    drafted: scopedOutreach.length,
    approved: scopedOutreach.filter((message) => message.approvedBy != null).length,
    booked: facts.booked,
  };
}

export function computeCampaignMetrics(
  candidates: Candidate[],
  prev?: Partial<CampaignMetrics>,
  /** Real elapsed hours from campaign creation to the first booked interview
   *  (caller computes this from actual timestamps — see recomputeMetrics in
   *  store.ts). `undefined` preserves whatever was already on `prev`; pass
   *  `null` explicitly once no booking exists yet. */
  timeToFirstInterviewHours?: number | null,
  realFacts?: Pick<RealFunnelFacts, "contacted" | "repliedCount" | "booked" | "replyRate">,
): CampaignMetrics {
  const sourced = candidates.length;
  const stageContacted = candidates.filter((c) => effectiveStageRank(c) >= 1).length;
  const stageReplied = candidates.filter((c) => effectiveStageRank(c) >= 2).length;
  const interested = candidates.filter(
    (c) => effectiveStageRank(c) >= 3 && c.stage !== "Not Interested",
  ).length;
  const stageBooked = candidates.filter((c) => effectiveStageRank(c) >= 4).length;
  const interviewed = candidates.filter((c) =>
    ["Interviewed", "Offer", "Hired"].includes(c.stage),
  ).length;
  const offer = candidates.filter((c) => ["Offer", "Hired"].includes(c.stage)).length;
  const hired = candidates.filter((c) => c.stage === "Hired").length;
  const notInterested = candidates.filter((c) => c.stage === "Not Interested").length;
  const scores = candidates.map((c) => c.matchScore).filter(Boolean);
  const avg = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const contacted = realFacts?.contacted ?? stageContacted;
  const replied = realFacts?.repliedCount ?? stageReplied;
  const booked = realFacts?.booked ?? stageBooked;

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
    replyRate: realFacts?.replyRate ?? (contacted ? replied / contacted : 0),
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
  state: Pick<
    HermesState,
    "campaigns" | "candidates" | "outreach" | "replies" | "bookings" | "settings"
  >,
): GlobalKpis {
  const active = state.campaigns.filter((c) => !["Filled", "Paused"].includes(c.status));
  const facts = realFunnelFacts(state, { live: !state.settings.dryRunMode });
  const candidateIds = new Set(facts.candidateIds);
  const cands = state.candidates.filter((c) => candidateIds.has(c.id));
  const interested = cands.filter(
    (c) => effectiveStageRank(c) >= 3 && c.stage !== "Not Interested",
  ).length;
  const awaitingBooking = cands.filter(
    (c) => c.stage === "Interested" && (!c.booking || bookingNeedsCalendar(c.booking)),
  ).length;
  const scores = cands.map((c) => c.matchScore).filter(Boolean);
  const avg = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  // Mean time-to-first-interview across ACTIVE campaigns only.
  const ttfi = active
    .map((c) => c.metrics.timeToFirstInterviewHours)
    .filter((v): v is number => v != null);

  return {
    activeCampaigns: active.length,
    totalCampaigns: state.campaigns.length,
    candidatesSourced: facts.sourced,
    contacted: facts.contacted,
    replyRate: facts.replyRate,
    interviewsBooked: facts.booked,
    interested,
    awaitingBooking,
    avgMatchScore: avg,
    timeToFirstInterviewHours: ttfi.length ? round(ttfi.reduce((a, b) => a + b, 0) / ttfi.length) : null,
    pendingApprovals: state.outreach.filter(
      (m) =>
        candidateIds.has(m.candidateId) &&
        (m.status === "Needs Approval" || m.status === "Pending Manual Send"),
    ).length,
    hotReplies: state.replies.filter(
      (r) =>
        candidateIds.has(r.candidateId) &&
        !r.handled &&
        ["INTERESTED", "QUALIFIED_INTEREST"].includes(r.intent),
    ).length,
  };
}

export function candidatesForCampaign(state: HermesState, campaignId: string): Candidate[] {
  return state.candidates.filter((c) => c.campaignId === campaignId);
}
