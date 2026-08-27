/**
 * LangGraph orchestration for the Mantu end-to-end recruiting loop.
 *
 * Webhook-triggered (no inbox polling):
 *   receiveEmail → parseRequisition → sourceCandidates → rankTop10
 *   → draftOutreach → validateQuality → queueApproval → scheduleInterview
 *
 * Authority remains in Supabase job RPCs (`PIPELINE_STAGE_TRANSITIONS` /
 * `pipeline-transitions.json`). LangGraph is the stage checkpoint machine (not
 * an in-graph tool-calling agent runtime): real parse/source/draft/book work
 * runs in the loop worker + cron routes; this graph maps completed stages onto
 * the next job kind and fail-stops (parse failure, quality blocked, missing booking).
 * When `preferLiveCritics` is set (draft cron), validateQuality runs the three
 * live LLM peer critics via dynamic import.
 *
 * Intents:
 *   - `full` (default): intake → shortlist → draft → quality → approval → book
 *   - `draft_quality`: start at draftOutreach (cron draft hook; no fake booking)
 *   - `parse_only` / `source_only` / `rank_only` / `book_only`: worker checkpoints after real handlers
 *
 * Fail-stops:
 *   - parse failure → END at `parse_requisition_failed`
 *   - quality blocked → END at `approval_blocked`
 *   - no bookingId → END at `queued_for_approval` (never claim `interview_scheduled`)
 */

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  DEFAULT_SHORTLIST_MIN_SCORE,
  TOP_CANDIDATE_SHORTLIST_SIZE,
} from "@/lib/recruiting-loop/constants";
import { validateOutreachQuality, type OutreachQualityVerdict } from "@/lib/outreach-quality-pipeline";
import pipelineTransitions from "@/lib/langchain/pipeline-transitions.json";
import graphStageJobs from "@/lib/langchain/graph-stage-jobs.json";

/** Graph state carried between nodes. */
export const RecruitingGraphState = Annotation.Root({
  /** Workspace tenant id. */
  workspaceId: Annotation<string>(),
  /**
   * Run intent: full webhook→book loop, draft/quality-only (cron hook),
   * or focused checkpoints the loop worker asserts after real handlers.
   * Checkpoints never invent side effects — they only validate stage authority.
   */
  intent: Annotation<"full" | "draft_quality" | "parse_only" | "source_only" | "rank_only" | "book_only">(),
  /** Inbound email id from record_inbound_email. */
  inboundId: Annotation<string | undefined>(),
  /** Parsed campaign id once created. */
  campaignId: Annotation<string | undefined>(),
  /** Candidate ids after sourcing. */
  candidateIds: Annotation<string[]>({
    reducer: (_prev, next) => next ?? [],
    default: () => [],
  }),
  /** Optional scored candidates for ranking (id + matchScore). */
  scoredCandidates: Annotation<Array<{ id: string; matchScore?: number | null }>>({
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
  /** Prefer live multi-agent LLM critics in validateQuality (server/cron paths). */
  preferLiveCritics: Annotation<boolean | undefined>(),
  /** Human-readable stage for observability. */
  stage: Annotation<string>(),
  /** Non-fatal errors accumulated across nodes. */
  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...(next ?? [])],
    default: () => [],
  }),
});

export type RecruitingGraphStateType = typeof RecruitingGraphState.State;

/** Pure ranking: top N by score, only candidates clearing the min-score bar. */
export function rankTopCandidates<T extends { id: string; matchScore?: number | null }>(
  candidates: T[],
  limit = TOP_CANDIDATE_SHORTLIST_SIZE,
  minScore = DEFAULT_SHORTLIST_MIN_SCORE,
): T[] {
  return [...candidates]
    .filter((c) => (c.matchScore ?? 0) >= minScore)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, limit);
}

/** Node: mark webhook received — no side effects. */
async function receiveEmail(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  return { stage: "receive_email", inboundId: state.inboundId };
}

/** Node: requisition parsed — campaign id must be set by caller/worker. */
async function parseRequisition(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  if (!state.inboundId) {
    return { stage: "parse_requisition_failed", errors: ["missing_inbound_id"] };
  }
  if (!state.campaignId?.trim()) {
    return { stage: "parse_requisition_failed", errors: ["missing_campaign_id"] };
  }
  return { stage: "requisition_parsed" };
}

/** Node: sourcing complete — candidate ids supplied by worker hook. */
async function sourceCandidates(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const ids = (state.candidateIds ?? []).filter((id) => typeof id === "string" && id.trim());
  const scored = state.scoredCandidates ?? [];
  if (ids.length === 0 && scored.length === 0) {
    return { stage: "sourcing_failed", errors: ["missing_candidate_ids"], candidateIds: [] };
  }
  const candidateIds = ids.length > 0 ? ids : scored.map((c) => c.id);
  return { stage: "sourcing_complete", candidateIds };
}

/** Node: rank to top 10 — requires scored candidates (no blind slice inventing rank). */
async function rankTop10(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const scored = state.scoredCandidates ?? [];
  if (scored.length === 0) {
    return {
      stage: "shortlist_rank_failed",
      errors: ["missing_scored_candidates"],
      shortlistIds: [],
    };
  }
  const shortlist = rankTopCandidates(scored, TOP_CANDIDATE_SHORTLIST_SIZE).map((c) => c.id);
  if (shortlist.length === 0) {
    return {
      stage: "shortlist_rank_failed",
      errors: ["empty_shortlist_or_below_min_score"],
      shortlistIds: [],
    };
  }
  return { stage: "shortlist_ranked", shortlistIds: shortlist };
}

/** Node: Mantu-branded outreach drafts prepared for quality validation. */
async function draftOutreach(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const drafts = state.drafts ?? {};
  const entries = Object.entries(drafts).filter(
    ([id, draft]) =>
      typeof id === "string" &&
      id.trim() &&
      draft &&
      typeof draft.subject === "string" &&
      typeof draft.body === "string" &&
      draft.body.trim().length > 0,
  );
  if (entries.length === 0) {
    return {
      stage: "draft_failed",
      errors: ["missing_drafts"],
      drafts: {},
    };
  }
  return {
    stage: "outreach_drafted",
    drafts: Object.fromEntries(entries),
  };
}

/** Node: validate outreach quality for each draft (multi-agent critics). */
async function validateQuality(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  const draftEntries = Object.entries(state.drafts ?? {});
  if (draftEntries.length === 0) {
    return {
      stage: "draft_failed",
      errors: ["missing_drafts"],
      quality: {},
    };
  }
  const quality: Record<string, OutreachQualityVerdict> = {};
  // draft_quality defaults to live multi-agent peers (cron may omit the flag).
  // Explicit preferLiveCritics:false keeps deterministic unit-test paths.
  const preferLive =
    state.preferLiveCritics === true ||
    (state.intent === "draft_quality" && state.preferLiveCritics !== false);
  type QualityFn = (input: {
    subject: string;
    body: string;
    channel?: string;
    workspaceId?: string;
  }) => OutreachQualityVerdict | Promise<OutreachQualityVerdict>;
  let liveValidate: QualityFn | null = null;
  if (preferLive) {
    try {
      // Dynamic import keeps unit tests free of server-only LLM modules.
      const live = await import("@/lib/outreach-quality-pipeline-live");
      liveValidate = live.validateOutreachQualityLive;
    } catch {
      liveValidate = null;
    }
  }
  for (const [candidateId, draft] of draftEntries) {
    const input = {
      subject: draft.subject,
      body: draft.body,
      channel: draft.channel,
      workspaceId: state.workspaceId,
    };
    quality[candidateId] = liveValidate
      ? await liveValidate(input)
      : validateOutreachQuality(input);
  }
  // Prefer-live path without usable LLM peers must not claim quality_validated ready.
  // Stay on a fail-closed stage; the draft cron re-runs live critics and maps a
  // successful re-validation to queued_for_approval before the worker sees it.
  if (preferLive && liveValidate) {
    const missingCritics = Object.values(quality).some((v) => v.llmCriticsUsed !== true);
    if (missingCritics) {
      const anyBlocked = Object.values(quality).some((v) => v.status === "blocked");
      return {
        stage: anyBlocked ? "approval_blocked" : "quality_critics_incomplete",
        quality,
        errors: ["llm_critics_required"],
      };
    }
  } else if (preferLive && !liveValidate) {
    return {
      stage: "quality_critics_incomplete",
      quality,
      errors: ["llm_critics_unavailable"],
    };
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

/** Node: first interview scheduled (Teams / Outlook calendar) — bookingId required. */
async function scheduleInterview(state: RecruitingGraphStateType): Promise<Partial<RecruitingGraphStateType>> {
  if (!state.bookingId) {
    return {
      stage: "queued_for_approval",
      errors: ["missing_booking_id"],
    };
  }
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
    .addConditionalEdges(START, (state) => {
      if (state.intent === "draft_quality") return "draftOutreach";
      if (state.intent === "parse_only") return "receiveEmail";
      if (state.intent === "source_only") return "sourceCandidates";
      if (state.intent === "rank_only") return "sourceCandidates";
      if (state.intent === "book_only") return "scheduleInterview";
      return "receiveEmail";
    })
    .addEdge("receiveEmail", "parseRequisition")
    .addConditionalEdges("parseRequisition", (state) => {
      if (state.stage === "parse_requisition_failed") return END;
      if (state.intent === "parse_only") return END;
      return "sourceCandidates";
    })
    .addConditionalEdges("sourceCandidates", (state) => {
      if (state.stage === "sourcing_failed") return END;
      if (state.intent === "source_only") return END;
      return "rankTop10";
    })
    .addConditionalEdges("rankTop10", (state) => {
      if (state.stage === "shortlist_rank_failed") return END;
      if (state.intent === "rank_only") return END;
      return "draftOutreach";
    })
    .addConditionalEdges("draftOutreach", (state) => {
      if (state.stage === "draft_failed") return END;
      return "validateQuality";
    })
    .addConditionalEdges("validateQuality", (state) => {
      if (state.stage === "draft_failed") return END;
      if (state.stage === "quality_critics_incomplete") return END;
      if (state.stage === "approval_blocked") return END;
      return "queueApproval";
    })
    .addConditionalEdges("queueApproval", (state) => {
      const blocked = Object.values(state.quality ?? {}).some((v) => v.status === "blocked");
      if (blocked) return END;
      // Only claim interview booking when a real booking id is present.
      if (state.bookingId) return "scheduleInterview";
      return END;
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

export type RunRecruitingGraphInput = Partial<RecruitingGraphStateType> & {
  intent?: "full" | "draft_quality" | "parse_only" | "source_only" | "rank_only" | "book_only";
};

/** Run the graph from an initial partial state (for tests and API routes). */
export async function runRecruitingGraph(
  input: RunRecruitingGraphInput,
): Promise<RecruitingGraphStateType> {
  const graph = getRecruitingGraph();
  const result = await graph.invoke({
    workspaceId: input.workspaceId ?? "",
    intent: input.intent ?? "full",
    inboundId: input.inboundId,
    campaignId: input.campaignId,
    candidateIds: input.candidateIds ?? [],
    scoredCandidates: input.scoredCandidates ?? [],
    shortlistIds: input.shortlistIds ?? [],
    drafts: input.drafts ?? {},
    quality: input.quality ?? {},
    bookingId: input.bookingId,
    preferLiveCritics: input.preferLiveCritics,
    stage: input.stage ?? "init",
    errors: input.errors ?? [],
  });
  return result;
}

/**
 * Assert the graph lands on an allowed stage and return the successor job kind.
 * Used by the loop worker cron checkpoint so side-effect handlers stay honest.
 */
export async function assertRecruitingGraphStage(
  input: RunRecruitingGraphInput,
  allowedStages: readonly string[],
): Promise<
  | {
      ok: true;
      stage: string;
      nextJobKind: string | null;
      errors: string[];
      shortlistIds: string[];
    }
  | { ok: false; stage: string; reason: string; errors: string[]; shortlistIds: string[] }
> {
  const result = await runRecruitingGraph(input);
  const stage = result.stage;
  const shortlistIds = Array.isArray(result.shortlistIds) ? result.shortlistIds : [];
  if (!allowedStages.includes(stage)) {
    return {
      ok: false,
      stage,
      reason: "stage_mismatch",
      errors: result.errors ?? [],
      shortlistIds,
    };
  }
  return {
    ok: true,
    stage,
    nextJobKind: nextJobKindAfterGraphStage(stage),
    errors: result.errors ?? [],
    shortlistIds,
  };
}

/**
 * Shared job-spine transitions (same contract as `scripts/sourcing-loop-worker.mjs`).
 * LangGraph stages resolve into these successors when the worker advances the loop.
 */
export const PIPELINE_STAGE_TRANSITIONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(pipelineTransitions).map(([kind, next]) => [kind, Object.freeze([...(next as string[])])]),
    ),
  );

/** Job kinds the graph expects the loop worker to enqueue after each stage. */
export const GRAPH_STAGE_TO_JOB_KIND: Record<string, string> = Object.freeze({
  ...graphStageJobs,
});

/** Resolve the first allowed successor job kind for a completed pipeline stage. */
export function nextJobKindAfterPipelineStage(completedKind: string): string | null {
  const next = PIPELINE_STAGE_TRANSITIONS[completedKind];
  return next && next.length > 0 ? next[0] : null;
}

/** Resolve the job kind the worker should enqueue after a LangGraph stage. */
export function nextJobKindAfterGraphStage(stage: string): string | null {
  return GRAPH_STAGE_TO_JOB_KIND[stage] ?? null;
}
