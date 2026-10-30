/* ============================================================================
   Mission runner: chains a campaign's steps as agents.

   A mission is a fixed plan of steps. A step runs one agent, or fans out one
   agent per item (one draft per candidate, say) through a bounded worker pool.
   The plan itself is deterministic: deciding the order of known steps needs no
   model, so AI is spent only inside the agents that need language work, each
   on the model tier its task is routed to (see ANTHROPIC_TASK_PROFILE).

   Every agent may declare a fallback. When the agent throws or times out, the
   fallback runs and the mission continues, so a missing key, a spent budget or
   an outage degrades a step instead of failing the mission. Nothing here sends
   anything: outreach still waits for human approval in the existing queue.

   Pure TypeScript, no React, no I/O of its own: it runs wherever the agents
   it is given can run, and is unit-tested with fake agents.
   ========================================================================== */

/** Model tier an agent spends on, for display and cost reasoning only. The
 *  actual model is resolved server-side per task. "none" = no AI at all. */
export type AgentTier = "none" | "haiku" | "sonnet" | "opus";

export interface AgentContext {
  signal: AbortSignal;
  /** Outputs of completed steps, by step id (fan-out steps give an array). */
  results: Readonly<Record<string, unknown>>;
}

export interface AgentDefinition<I = unknown, O = unknown> {
  id: string;
  label: string;
  tier: AgentTier;
  run(input: I, ctx: AgentContext): Promise<O>;
  /** Deterministic stand-in used when run() fails. Absent → the failure stands. */
  fallback?(input: I, ctx: AgentContext, error: unknown): Promise<O>;
}

export interface MissionStep {
  id: string;
  // The plan is heterogeneous, so agents are typed loosely at this boundary.
  agent: AgentDefinition<any, any>;
  dependsOn?: string[];
  /** Single run: the agent's input, computed from earlier results. */
  input?: (results: Readonly<Record<string, unknown>>) => unknown;
  /** Fan-out: one agent run per returned item. An empty list completes the
   *  step with no runs. */
  fanOut?: (results: Readonly<Record<string, unknown>>) => unknown[];
  /** Fan-out only: a failed item is skipped instead of failing the step. */
  tolerateItemFailure?: boolean;
}

export interface MissionPlan {
  id: string;
  label: string;
  steps: MissionStep[];
}

export interface MissionOptions {
  /** Agents running at once across the whole mission. Default 3. */
  concurrency?: number;
  /** Per agent run. Default 120 s. */
  agentTimeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: MissionEvent) => void;
  now?: () => number;
}

export type AgentRunOutcome = "succeeded" | "fallback" | "failed" | "skipped";

export type MissionEvent =
  | { type: "mission_started"; missionId: string; at: number }
  | { type: "step_started"; stepId: string; runs: number; at: number }
  | { type: "agent_started"; stepId: string; agentId: string; tier: AgentTier; item?: number; at: number }
  | { type: "agent_finished"; stepId: string; agentId: string; outcome: AgentRunOutcome; item?: number; error?: string; at: number }
  | { type: "step_finished"; stepId: string; status: StepStatus; at: number }
  | { type: "mission_finished"; missionId: string; status: MissionStatus; at: number };

export type StepStatus = "completed" | "degraded" | "failed" | "skipped" | "cancelled";
export type MissionStatus = "completed" | "degraded" | "failed" | "cancelled";

export interface StepReport {
  status: StepStatus;
  runs: number;
  succeeded: number;
  fallbacks: number;
  failed: number;
  error?: string;
}

export interface MissionReport {
  missionId: string;
  status: MissionStatus;
  results: Record<string, unknown>;
  steps: Record<string, StepReport>;
}

export class MissionPlanError extends Error {}

/** Reject unknown dependencies, duplicate ids and cycles before running. */
export function validatePlan(plan: MissionPlan): void {
  const ids = new Set<string>();
  for (const step of plan.steps) {
    if (ids.has(step.id)) throw new MissionPlanError(`Duplicate step id: ${step.id}`);
    ids.add(step.id);
    if (step.input && step.fanOut) throw new MissionPlanError(`Step ${step.id} has both input and fanOut.`);
  }
  for (const step of plan.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) throw new MissionPlanError(`Step ${step.id} depends on unknown step ${dep}.`);
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new MissionPlanError(`Dependency cycle through ${id}.`);
    state.set(id, "visiting");
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    state.set(id, "done");
  };
  plan.steps.forEach((s) => visit(s.id));
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Passed to a fallback when the run hit its time limit. The timed-out run is
 *  abandoned, not killed: a fallback with side effects must expect it may
 *  still complete. */
export class AgentTimeoutError extends Error {
  override name = "AgentTimeoutError";
}

/** Checked by name, not instanceof: the class can be loaded twice (ESM and
 *  CommonJS copies under the test runner) and must still be recognized. */
export function isAgentTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "AgentTimeoutError";
}

/** Counting semaphore shared by every step, so fan-outs cannot exceed the cap. */
function semaphore(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export async function runMission(plan: MissionPlan, options: MissionOptions = {}): Promise<MissionReport> {
  validatePlan(plan);
  const now = options.now ?? Date.now;
  const emit = (event: MissionEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // A failing listener must not break the mission.
    }
  };
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
  const timeoutMs = Math.max(1, options.agentTimeoutMs ?? 120_000);
  const withSlot = semaphore(concurrency);
  const results: Record<string, unknown> = {};
  const steps: Record<string, StepReport> = {};
  const cancelled = () => options.signal?.aborted === true;

  emit({ type: "mission_started", missionId: plan.id, at: now() });

  /** Run one agent with timeout, cancellation and fallback. */
  const runAgent = async (step: MissionStep, input: unknown, item?: number): Promise<{ outcome: AgentRunOutcome; value?: unknown; error?: string }> =>
    withSlot(async () => {
      if (cancelled()) return { outcome: "skipped" };
      const { agent } = step;
      emit({ type: "agent_started", stepId: step.id, agentId: agent.id, tier: agent.tier, item, at: now() });
      const controller = new AbortController();
      const relay = () => controller.abort();
      options.signal?.addEventListener("abort", relay);
      const ctx: AgentContext = { signal: controller.signal, results };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (outcome: AgentRunOutcome, value?: unknown, error?: string) => {
        emit({ type: "agent_finished", stepId: step.id, agentId: agent.id, outcome, item, error, at: now() });
        return { outcome, value, error };
      };
      try {
        const value = await Promise.race([
          agent.run(input, ctx),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new AgentTimeoutError(`${agent.label} timed out.`));
            }, timeoutMs);
          }),
        ]);
        return finish("succeeded", value);
      } catch (error) {
        if (cancelled()) return finish("skipped", undefined, "Mission cancelled.");
        if (agent.fallback) {
          try {
            return finish("fallback", await agent.fallback(input, { signal: options.signal ?? new AbortController().signal, results }, error), errorText(error));
          } catch (fallbackError) {
            return finish("failed", undefined, errorText(fallbackError));
          }
        }
        return finish("failed", undefined, errorText(error));
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", relay);
      }
    });

  const runStep = async (step: MissionStep): Promise<void> => {
    const blocked = (step.dependsOn ?? []).find((dep) => {
      const status = steps[dep]?.status;
      return status !== "completed" && status !== "degraded";
    });
    if (cancelled() || blocked) {
      const status: StepStatus = cancelled() ? "cancelled" : "skipped";
      steps[step.id] = { status, runs: 0, succeeded: 0, fallbacks: 0, failed: 0, error: blocked ? `Waiting on ${blocked}.` : undefined };
      emit({ type: "step_finished", stepId: step.id, status, at: now() });
      return;
    }

    const items = step.fanOut ? step.fanOut(results) : [step.input ? step.input(results) : undefined];
    emit({ type: "step_started", stepId: step.id, runs: items.length, at: now() });
    const runs = await Promise.all(items.map((input, index) => runAgent(step, input, step.fanOut ? index : undefined)));

    const report: StepReport = {
      status: "completed",
      runs: runs.length,
      succeeded: runs.filter((r) => r.outcome === "succeeded").length,
      fallbacks: runs.filter((r) => r.outcome === "fallback").length,
      failed: runs.filter((r) => r.outcome === "failed").length,
    };
    if (cancelled()) report.status = "cancelled";
    else if (report.failed > 0 && !(step.fanOut && step.tolerateItemFailure)) {
      report.status = "failed";
      report.error = runs.find((r) => r.outcome === "failed")?.error;
    } else if (report.fallbacks > 0 || report.failed > 0) report.status = "degraded";

    if (report.status === "completed" || report.status === "degraded") {
      const ok = runs.filter((r) => r.outcome === "succeeded" || r.outcome === "fallback").map((r) => r.value);
      results[step.id] = step.fanOut ? ok : ok[0];
    }
    steps[step.id] = report;
    emit({ type: "step_finished", stepId: step.id, status: report.status, at: now() });
  };

  // Start each step as soon as all its dependencies have settled; independent
  // steps run side by side, still bounded by the shared agent semaphore.
  const settled = new Map<string, Promise<void>>();
  const schedule = (step: MissionStep): Promise<void> => {
    const existing = settled.get(step.id);
    if (existing) return existing;
    const deps = (step.dependsOn ?? []).map((id) => schedule(plan.steps.find((s) => s.id === id) as MissionStep));
    const promise = Promise.all(deps).then(() => runStep(step));
    settled.set(step.id, promise);
    return promise;
  };
  await Promise.all(plan.steps.map(schedule));

  const statuses = Object.values(steps).map((s) => s.status);
  const status: MissionStatus = cancelled()
    ? "cancelled"
    : statuses.includes("failed") || statuses.includes("skipped")
      ? "failed"
      : statuses.includes("degraded")
        ? "degraded"
        : "completed";
  emit({ type: "mission_finished", missionId: plan.id, status, at: now() });
  return { missionId: plan.id, status, results, steps };
}
