/**
 * LangGraph orchestration for the Mantu end-to-end recruiting loop.
 *
 * Webhook-triggered (no inbox polling):
 *   receiveEmail → parseRequisition → sourceCandidates → rankTop10
 *   → draftOutreach → validateQuality → queueApproval → scheduleInterview
 *
 * Each node maps to existing Postgres job kinds and API surfaces; LangGraph
 * holds the state machine — authority remains in Supabase RPCs.
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { TOP_CANDIDATE_SHORTLIST_SIZE } from "@/lib/recruiting-loop/constants";
import { validateOutreachQuality, type OutreachQualityVerdict } from "@/lib/outreach-quality-pipeline";

/** Graph state carried between nodes. */
export const RecruitingGraphState = Annotation.Root({
  /** Workspace tenant id. */
  workspaceId: Annotation<string>(),
  /** Inbound email id from record_inbound_email. */
  inboundId: Annotation<string | undefined>(),
  /** Parsed campaign id once created. */
  campaignId: Annotation<string | undefined>(),
  /** Candidate ids after sourcing. */
  candidateIds: Annotation<string[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  /** Top-N shortlist after ranking. */
  shortlistIds: Annotation<string[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  /** Outreach drafts keyed by candidate id. */
  drafts: Annotation<Record<string, { subject: string; body: string; channel: string }>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  /** Quality verdicts per candidate. */
  quality: Annotation<Record<string, OutreachQualityVerdict>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  /** Booking id when first interview scheduled. */
  bookingId: Annotation<string | undefined>(),
  /** Human-readable stage for observability. */
  stage: Annotation<string>(),
  /** Non-fatal errors accumulated across nodes. */
  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...(next ?? [])],
    default: () => [],
  }),
});

export type RecruitingGraphStateType = typeof RecruitingGraphState.State;

/** Pure ranking: take top N by score descending. */
export function rankTopCandidates<T extends { id: string; matchScore?: number | null }>(
  candidates: T[],
  limit = TOP_CANDIDATE_SHORTLIST_SIZE,
): T[] {
  return [...candidates]
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, limit);
}

/** Node: mark webhook received — no side effects. */
async function receiveEmail(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  return { stage: "receive_email", inboundId: state.inboundId };
}

/** Node: requisition parsed — campaign id should be set by caller/worker. */
async function parseRequisition(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  if (!state.inboundId) {
    return { stage: "parse_requisition_failed", errors: ["missing_inbound_id"] };
  }
  return { stage: "requisition_parsed" };
}

/** Node: sourcing complete — candidate ids supplied by worker hook. */
async function sourceCandidates(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  return { stage: "sourcing_complete", candidateIds: state.candidateIds ?? [] };
}

/** Node: rank to top 10 by score when scored candidates are supplied on state. */
async function rankTop10(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const ids = state.candidateIds ?? [];
  // Prefer caller-supplied order when ids alone are present; scored ranking
  // happens in the loop worker shortlist handler via matchScore.
  const shortlist = ids.slice(0, TOP_CANDIDATE_SHORTLIST_SIZE);
  return {
    stage: "shortlist_ranked",
    shortlistIds: shortlist,
  };
}

/** Node: Mantu-branded outreach drafts prepared for quality validation. */
async function draftOutreach(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  return {
    stage: "outreach_drafted",
    drafts: state.drafts ?? {},
  };
}

/** Node: validate outreach quality for each draft (multi-agent critics). */
async function validateQuality(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const quality: Record<string, OutreachQualityVerdict> = {};
  for (const [candidateId, draft] of Object.entries(state.drafts ?? {})) {
    quality[candidateId] = validateOutreachQuality({
      subject: draft.subject,
      body: draft.body,
      channel: draft.channel,
    });
  }
  return { stage: "quality_validated", quality };
}

/** Node: queue for human approval — blocked drafts flagged. */
async function queueApproval(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const blocked = Object.values(state.quality ?? {}).filter((v) => v.status === "blocked").length;
  return {
    stage: blocked > 0 ? "approval_blocked" : "queued_for_approval",
    errors: blocked > 0 ? [`${blocked} draft(s) blocked by quality pipeline`] : [],
  };
}

/** Node: first interview scheduled (Teams / Outlook calendar). */
async function scheduleInterview(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  return { stage: "interview_scheduled", bookingId: state.bookingId };
}

function buildRecruitingGraph() {
  const graph = new StateGraph(RecruitingGraphState)
    .addNode("receiveEmail", receiveEmail)
    .addNode("parseRequisition", parseRequisition)
    .addNode("sourceCandidates", sourceCandidates)
    .addNode("rankTop10", rankTop10)
    .addNode("draftOutreach", draftOutreach)
    .addNode("validateQuality", validateQuality)
    .addNode("queueApproval", queueApproval)
    .addNode("scheduleInterview", scheduleInterview)
    .addEdge(START, "receiveEmail")
    .addEdge("receiveEmail", "parseRequisition")
    .addEdge("parseRequisition", "sourceCandidates")
    .addEdge("sourceCandidates", "rankTop10")
    .addEdge("rankTop10", "draftOutreach")
    .addEdge("draftOutreach", "validateQuality")
    .addEdge("validateQuality", "queueApproval")
    .addConditionalEdges("queueApproval", (state) => {
      const blocked = Object.values(state.quality ?? {}).some((v) => v.status === "blocked");
      return blocked ? END : "scheduleInterview";
    })
    .addEdge("scheduleInterview", END);

  return graph.compile();
}

let compiledGraph: ReturnType<typeof buildRecruitingGraph> | null = null;

/** Singleton compiled LangGraph for the recruiting loop. */
export function getRecruitingGraph() {
  if (!compiledGraph) compiledGraph = buildRecruitingGraph();
  return compiledGraph;
}

/** Run the graph from an initial partial state (for tests and API routes). */
export async function runRecruitingGraph(
  input: Partial<RecruitingGraphStateType>,
): Promise<RecruitingGraphStateType> {
  const graph = getRecruitingGraph();
  const result = await graph.invoke({
    workspaceId: input.workspaceId ?? "",
    inboundId: input.inboundId,
    campaignId: input.campaignId,
    candidateIds: input.candidateIds ?? [],
    shortlistIds: input.shortlistIds ?? [],
    drafts: input.drafts ?? {},
    quality: input.quality ?? {},
    bookingId: input.bookingId,
    stage: input.stage ?? "init",
    errors: input.errors ?? [],
  });
  return result;
}

/** Job kinds the graph expects the loop worker to enqueue after each stage. */
export const GRAPH_STAGE_TO_JOB_KIND: Record<string, string> = {
  requisition_parsed: "campaign_create",
  sourcing_complete: "shortlist_build",
  shortlist_ranked: "draft_generate",
  quality_validated: "draft_generate",
  queued_for_approval: "delivery_reconcile",
  interview_scheduled: "calendar_book",
};
