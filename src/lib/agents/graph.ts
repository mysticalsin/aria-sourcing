/* ============================================================================
   SOURCING AGENT GRAPH — deer-flow's planner/worker/reporter pattern, ported
   to a plain TypeScript state machine (deliberately NOT LangGraph: state is a
   JSON row in agent_runs, so a serverless timeout is a resume, not a failure).

   planner → sourcer → screener → outreach → reporter → done

   Each node executes exactly one step: it receives the state, returns the
   updated state plus the next node. The driver (API route) persists after
   every step. All side-effectful dependencies (LLM, platform search) are
   injected, so the whole graph is unit-testable with mocks.

   Guardrails inherited from the platform:
   - The sourcer only reports candidates the injected search actually returned
     (the runner accumulates real results — the model never invents people).
   - Every outreach draft passes gateOutbound(); failing drafts are kept as
     'blocked' for human review, never silently dropped or sent.
   - step_count is bounded by MAX_STEPS — a runaway plan halts as 'failed'.
   ========================================================================== */

import { z } from "zod";
import { gateOutbound } from "@/lib/gate";
import {
  DISCLOSURE_SYSTEM,
  candidateDisclosureContextForCampaignLike,
  disclosureInternalFromCampaignLike,
  validateCandidateBoundText,
} from "@/lib/agent-disclosure-policy";
import type { AgentExecutionPolicy } from "@/lib/agents/runtime-policy";

export type AgentNode = "planner" | "sourcer" | "screener" | "outreach" | "reporter" | "done";

export const MAX_STEPS = 24;
export const DEFAULT_MIN_SCORE = 70; // mirrors MIN_SCORE_FLOOR in rules.ts

// ---------------------------------------------------------------------------
// Plan schema — same shape deer-flow validates server-side, minus locales.
// ---------------------------------------------------------------------------
export const PlanStepSchema = z.object({
  title: z.string().min(1).max(200),
  platform: z.enum(["GitHub", "LinkedIn", "Stack Overflow", "Dribbble", "Behance"]),
  query: z.string().min(2).max(256),
});
export const PlanSchema = z.object({
  thought: z.string().max(2_000).default(""),
  steps: z.array(PlanStepSchema).min(1).max(6),
});
export type Plan = z.infer<typeof PlanSchema>;

export interface CandidateLite {
  id: string;
  name: string;
  matchScore: number;
  currentTitle?: string;
  currentCompany?: string;
}

export interface DraftLite {
  candidateId: string;
  subject: string;
  body: string;
  gatePassed: boolean;
  gateReasons?: string[];
}

export interface AgentGraphState {
  /** Role brief (Campaign.jobAnalysis shape), set at run creation. */
  brief: Record<string, unknown>;
  draftCount: number;
  minScore: number;
  plan?: Plan;
  /** Next plan step the sourcer should execute (one per graph step — resumable). */
  planCursor: number;
  candidates: CandidateLite[];
  screened: CandidateLite[];
  drafts: DraftLite[];
  report?: string;
  errors: string[];
  /** Immutable stored-spec policy snapshot for audit and resumability. */
  executionPolicy: AgentExecutionPolicy;
}

const DEFAULT_EXECUTION_POLICY: AgentExecutionPolicy = {
  channel: "Email",
  queueMode: "human_review",
  autopilotRequested: false,
};

export function initialState(
  brief: Record<string, unknown>,
  draftCount = 5,
  executionPolicy: AgentExecutionPolicy = DEFAULT_EXECUTION_POLICY,
  minScore = DEFAULT_MIN_SCORE,
): AgentGraphState {
  return {
    brief,
    draftCount,
    executionPolicy,
    minScore,
    planCursor: 0,
    candidates: [],
    screened: [],
    drafts: [],
    errors: [],
  };
}

export interface GraphDeps {
  /** Single LLM completion. */
  generate(system: string, prompt: string): Promise<string>;
  /** Real platform search; returns only real, already-scored candidates. */
  search(platform: string, query: string, count: number): Promise<CandidateLite[]>;
}

/** Tolerant JSON extraction — models fence and preface JSON. Same posture as
 *  parseDrafts in /api/sourcing-agent. */
export function extractJson(text: string): unknown {
  const match = (text ?? "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

const PLANNER_SYSTEM =
  "You plan candidate sourcing for one role. Given the role brief, output ONLY JSON " +
  '(no prose, no fences): {"thought": "<one line>", "steps": [{"title": "...", ' +
  '"platform": "GitHub"|"LinkedIn"|"Stack Overflow"|"Dribbble"|"Behance", "query": "<search query>"}]}. ' +
  "1-6 steps. Pick only platforms that genuinely fit the role (no Dribbble for backend). " +
  "Queries are what a senior sourcer would type into that platform's search. " +
  DISCLOSURE_SYSTEM;

const OUTREACH_SYSTEM =
  "You draft one first-touch outreach message from a recruiter to a candidate. Output ONLY JSON " +
  '(no prose, no fences): {"subject": "<under 60 chars>", "body": "<under 120 words>"}. ' +
  "Lead with their specific real work, one genuine reason for reaching out, soft low-pressure ask. " +
  "No AI slop, no corporate filler, no em-dashes, never mention tools or automation. " +
  DISCLOSURE_SYSTEM;

export interface StepResult {
  node: AgentNode;
  state: AgentGraphState;
  /** Narration for agent_events — never a message, never sendable. */
  event: { type: string; payload: Record<string, unknown> };
}

/** Execute exactly one node. The driver persists state after every call. */
export async function stepGraph(node: AgentNode, state: AgentGraphState, deps: GraphDeps): Promise<StepResult> {
  switch (node) {
    case "planner": {
      const raw = await deps.generate(
        PLANNER_SYSTEM,
        `Role brief:\n${candidateDisclosureContextForCampaignLike(state.brief).slice(0, 4_000)}`,
      );
      const parsed = PlanSchema.safeParse(extractJson(raw));
      if (!parsed.success) {
        const errors = [...state.errors, "planner: invalid plan JSON"];
        return { node: "done", state: { ...state, errors }, event: { type: "plan_failed", payload: {} } };
      }
      return {
        node: "sourcer",
        state: { ...state, plan: parsed.data, planCursor: 0 },
        event: { type: "plan_ready", payload: { steps: parsed.data.steps.length } },
      };
    }

    case "sourcer": {
      const step = state.plan?.steps[state.planCursor];
      if (!step) return { node: "screener", state, event: { type: "sourcing_complete", payload: { found: state.candidates.length } } };
      let found: CandidateLite[] = [];
      let errors = state.errors;
      try {
        found = await deps.search(step.platform, step.query, 8);
      } catch (err) {
        errors = [...errors, `sourcer(${step.platform}): ${err instanceof Error ? err.message : "search failed"}`];
      }
      const seen = new Set(state.candidates.map((c) => c.id));
      const fresh = found.filter((c) => !seen.has(c.id));
      const next = state.planCursor + 1;
      return {
        node: next < (state.plan?.steps.length ?? 0) ? "sourcer" : "screener",
        state: { ...state, candidates: [...state.candidates, ...fresh], planCursor: next, errors },
        event: { type: "search_step", payload: { platform: step.platform, found: fresh.length } },
      };
    }

    case "screener": {
      const screened = [...state.candidates]
        .filter((c) => c.matchScore >= state.minScore)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, state.draftCount);
      const next: AgentNode = screened.length > 0 ? "outreach" : "reporter";
      return {
        node: next,
        state: { ...state, screened },
        event: { type: "screened", payload: { kept: screened.length, of: state.candidates.length } },
      };
    }

    case "outreach": {
      // One draft per step — keeps each serverless invocation short and the
      // run resumable mid-outreach.
      const target = state.screened[state.drafts.length];
      if (!target) return { node: "reporter", state, event: { type: "outreach_complete", payload: { drafts: state.drafts.length } } };
      const raw = await deps.generate(
        OUTREACH_SYSTEM,
        `Role brief:\n${candidateDisclosureContextForCampaignLike(state.brief).slice(0, 2_000)}\n\nCandidate:\n${JSON.stringify(target)}`,
      );
      const parsed = extractJson(raw) as { subject?: string; body?: string } | null;
      const subject = String(parsed?.subject ?? "").slice(0, 255);
      const body = String(parsed?.body ?? "").slice(0, 5_000);
      const gate = body ? gateOutbound(body) : { pass: false as const, reasons: ["empty-draft"], text: "" };
      const disclosure = validateCandidateBoundText(body, disclosureInternalFromCampaignLike(state.brief));
      const draft: DraftLite = gate.pass && disclosure.safe
        ? { candidateId: target.id, subject, body: gate.text, gatePassed: true }
        : {
            candidateId: target.id,
            subject,
            body,
            gatePassed: false,
            gateReasons: [...(gate.pass ? [] : gate.reasons), ...(disclosure.safe ? [] : [disclosure.reason ?? "disclosure-leak-blocked"])],
          };
      const drafts = [...state.drafts, draft];
      return {
        node: drafts.length < state.screened.length ? "outreach" : "reporter",
        state: { ...state, drafts },
        event: { type: "draft", payload: { candidateId: target.id, gatePassed: gate.pass } },
      };
    }

    case "reporter": {
      // Deterministic — a report is bookkeeping, not creativity.
      const passed = state.drafts.filter((d) => d.gatePassed).length;
      const report =
        `Sourced ${state.candidates.length} real candidates across ${state.plan?.steps.length ?? 0} searches; ` +
        `${state.screened.length} passed screening (score >= ${state.minScore}); ` +
        `${passed} drafts ready for approval, ${state.drafts.length - passed} held by the gate` +
        (state.errors.length ? `; ${state.errors.length} step error(s).` : ".");
      return { node: "done", state: { ...state, report }, event: { type: "report", payload: { passed } } };
    }

    case "done":
      return { node: "done", state, event: { type: "noop", payload: {} } };
  }
}

/** Drive the graph to completion (or the step budget). Used by the API route
 *  and tests; the route persists via onStep after every node. */
export async function runGraph(
  state: AgentGraphState,
  deps: GraphDeps,
  onStep?: (node: AgentNode, state: AgentGraphState, event: StepResult["event"]) => Promise<void>,
  startNode: AgentNode = "planner",
  startStep = 0,
  beforeStep?: (node: AgentNode, state: AgentGraphState, step: number) => Promise<void>,
): Promise<{ node: AgentNode; state: AgentGraphState; steps: number }> {
  let node: AgentNode = startNode;
  let current = state;
  let steps = startStep;
  while (node !== "done" && steps < MAX_STEPS) {
    if (beforeStep) await beforeStep(node, current, steps);
    const result = await stepGraph(node, current, deps);
    node = result.node;
    current = result.state;
    steps++;
    if (onStep) await onStep(node, current, result.event);
  }
  if (node !== "done") {
    current = { ...current, errors: [...current.errors, `step budget exhausted (${MAX_STEPS})`] };
  }
  return { node, state: current, steps };
}
