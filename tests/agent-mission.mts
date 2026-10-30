/**
 * Mission runner tests (src/lib/agents/mission.ts), with fake agents only.
 */
import {
  MissionPlanError,
  runMission,
  validatePlan,
  type AgentDefinition,
  type MissionEvent,
  type MissionPlan,
} from "../src/lib/agents/mission.js";
import { campaignLaunchPlan, MAX_MISSION_DRAFTS, type DraftedPair } from "../src/lib/agents/campaign-mission.js";
import type { Candidate, OutreachMessage } from "../src/lib/types.js";

let pass = 0,
  fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function agent<I, O>(id: string, run: (input: I) => Promise<O>, fallback?: (input: I) => Promise<O>): AgentDefinition<I, O> {
  return { id, label: id, tier: "none", run: (input) => run(input), ...(fallback ? { fallback: (input) => fallback(input) } : {}) };
}

/* ---- 1. Dependencies pass results forward; fan-out respects concurrency --- */

let active = 0;
let peak = 0;
const draft = agent<number, string>("draft", async (n) => {
  active++;
  peak = Math.max(peak, active);
  await wait(10);
  active--;
  return `draft-${n}`;
});
const order: string[] = [];
const plan: MissionPlan = {
  id: "m1",
  label: "Launch",
  steps: [
    { id: "source", agent: agent("source", async () => { order.push("source"); return [1, 2, 3, 4, 5, 6]; }) },
    { id: "drafts", agent: draft, dependsOn: ["source"], fanOut: (r) => r.source as number[] },
    { id: "summary", agent: agent<string[], number>("summary", async (d) => { order.push("summary"); return d.length; }), dependsOn: ["drafts"], input: (r) => r.drafts },
  ],
};
const events: MissionEvent[] = [];
const report = await runMission(plan, { concurrency: 2, onEvent: (e) => events.push(e) });
ok("mission completes", report.status === "completed");
ok("fan-out results keep item order", JSON.stringify(report.results.drafts) === JSON.stringify(["draft-1", "draft-2", "draft-3", "draft-4", "draft-5", "draft-6"]));
ok("dependent step receives the fan-out output", report.results.summary === 6);
ok("concurrency cap holds", peak === 2);
ok("steps run in dependency order", order.join(",") === "source,summary");
ok("events open and close the mission", events[0]?.type === "mission_started" && events.at(-1)?.type === "mission_finished");
ok("one agent_started per run", events.filter((e) => e.type === "agent_started").length === 8);

/* ---- 2. Fallback degrades the step instead of failing the mission -------- */

const flaky = agent<void, string>("ai-draft", async () => { throw new Error("Daily AI budget reached."); }, async () => "template draft");
const degraded = await runMission({ id: "m2", label: "x", steps: [{ id: "draft", agent: flaky }] });
ok("fallback output is used", degraded.results.draft === "template draft");
ok("fallback marks the step degraded", degraded.steps.draft?.status === "degraded" && degraded.steps.draft.fallbacks === 1);
ok("degraded mission status", degraded.status === "degraded");

/* ---- 3. A failure without fallback blocks dependants --------------------- */

const broken = await runMission({
  id: "m3",
  label: "x",
  steps: [
    { id: "a", agent: agent("a", async () => { throw new Error("boom"); }) },
    { id: "b", agent: agent("b", async () => "never"), dependsOn: ["a"] },
  ],
});
ok("failed step reports its error", broken.steps.a?.status === "failed" && broken.steps.a.error === "boom");
ok("dependant is skipped", broken.steps.b?.status === "skipped" && broken.steps.b.runs === 0);
ok("mission fails", broken.status === "failed");

/* ---- 4. Tolerated item failures keep the successful items ---------------- */

const partial = await runMission({
  id: "m4",
  label: "x",
  steps: [{ id: "items", agent: agent<number, number>("item", async (n) => { if (n === 2) throw new Error("bad item"); return n * 10; }), fanOut: () => [1, 2, 3], tolerateItemFailure: true }],
});
ok("tolerated failure degrades the step", partial.steps.items?.status === "degraded" && partial.steps.items.failed === 1);
ok("successful items are kept", JSON.stringify(partial.results.items) === "[10,30]");

/* ---- 5. Timeout falls back; cancellation stops new runs ------------------ */

const slow = agent<void, string>("slow", () => new Promise<string>(() => {}), async () => "late fallback");
const timed = await runMission({ id: "m5", label: "x", steps: [{ id: "s", agent: slow }] }, { agentTimeoutMs: 20 });
ok("timeout triggers the fallback", timed.results.s === "late fallback");

const controller = new AbortController();
let started = 0;
const cancellable = agent<number, number>("c", async (n) => {
  started++;
  if (n === 0) controller.abort();
  await wait(5);
  return n;
});
const cancelledReport = await runMission(
  { id: "m6", label: "x", steps: [{ id: "c", agent: cancellable, fanOut: () => [0, 1, 2, 3] }, { id: "after", agent: agent("after", async () => 1), dependsOn: ["c"] }] },
  { concurrency: 1, signal: controller.signal },
);
ok("cancellation stops queued runs", started === 1);
ok("cancelled mission status", cancelledReport.status === "cancelled");
ok("later steps are cancelled", cancelledReport.steps.after?.status === "cancelled");

/* ---- 6. Plan validation --------------------------------------------------- */

const throwsPlanError = (p: MissionPlan) => {
  try { validatePlan(p); return false; } catch (e) { return e instanceof MissionPlanError; }
};
const noop = agent("n", async () => null);
ok("unknown dependency rejected", throwsPlanError({ id: "v", label: "v", steps: [{ id: "a", agent: noop, dependsOn: ["zz"] }] }));
ok("duplicate id rejected", throwsPlanError({ id: "v", label: "v", steps: [{ id: "a", agent: noop }, { id: "a", agent: noop }] }));
ok("cycle rejected", throwsPlanError({ id: "v", label: "v", steps: [{ id: "a", agent: noop, dependsOn: ["b"] }, { id: "b", agent: noop, dependsOn: ["a"] }] }));
ok("empty fan-out completes", (await runMission({ id: "e", label: "e", steps: [{ id: "f", agent: noop, fanOut: () => [] }] })).steps.f?.status === "completed");

/* ---- 7. Campaign launch mission ------------------------------------------- */

const candidates = [55, 91, 72, 88, 60, 95, 70, 80].map(
  (score, i) => ({ id: `c${i}`, name: `Cand ${i}`, matchScore: score }) as unknown as Candidate,
);
const message = (id: string, draftedBy: "ai" | "template") => ({ id: `m-${id}`, candidateId: id, draftedBy }) as unknown as OutreachMessage;

const liveCalls: string[] = [];
const templateCalls: string[] = [];
const launch = await runMission(
  campaignLaunchPlan("camp1", {
    sourceBatch: async () => ({ ok: true, accepted: candidates }),
    draftLive: async (id) => {
      liveCalls.push(id);
      if (id === "c3") throw new Error("network down");
      if (id === "c7") return null; // e.g. no verified email
      return message(id, "ai");
    },
    draftTemplate: (id) => {
      templateCalls.push(id);
      return message(id, "template");
    },
  }),
  { concurrency: 2 },
);
const launchDrafts = launch.results.drafts as DraftedPair[];
ok("drafts only the top candidates, best first", liveCalls.length === MAX_MISSION_DRAFTS && liveCalls[0] === "c5" && !liveCalls.includes("c0"));
ok("an unexpected draft error falls back to the template", templateCalls.join() === "c3" && launchDrafts.some((p) => p.message.draftedBy === "template"));
ok("an undraftable candidate is skipped without a template", !templateCalls.includes("c7") && !launchDrafts.some((p) => p.candidate.id === "c7"));
ok("launch mission degrades instead of failing", launch.status === "degraded" && launchDrafts.length === MAX_MISSION_DRAFTS - 1);

const timedOutTemplates: string[] = [];
const hung = await runMission(
  campaignLaunchPlan("camp2", {
    sourceBatch: async () => ({ ok: true, accepted: candidates.slice(0, 1) }),
    draftLive: () => new Promise<OutreachMessage | null>(() => {}),
    draftTemplate: (id) => { timedOutTemplates.push(id); return message(id, "template"); },
  }),
  { agentTimeoutMs: 20 },
);
ok("a timed-out live draft never gets a duplicate template", timedOutTemplates.length === 0 && hung.steps.drafts?.failed === 1);

const noSource = await runMission(
  campaignLaunchPlan("camp3", {
    sourceBatch: async () => ({ ok: false, error: "Campaign has no reviewed real-sourcing query." }),
    draftLive: async () => null,
    draftTemplate: () => null,
  }),
);
ok("a sourcing failure surfaces its reason", noSource.steps.source?.error === "Campaign has no reviewed real-sourcing query.");
ok("no drafts are attempted after a sourcing failure", noSource.steps.drafts?.status === "skipped");
ok("maxDrafts is clamped to the cost cap", campaignLaunchPlan("x", { sourceBatch: async () => ({ ok: true, accepted: [] }), draftLive: async () => null, draftTemplate: () => null }, { maxDrafts: 50 }).steps.length === 2);

console.log(`RESULT agent-mission: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
