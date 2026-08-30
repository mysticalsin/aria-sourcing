import {
  initialState,
  runGraph,
  stepGraph,
  extractJson,
  PlanSchema,
  MAX_STEPS,
  type CandidateLite,
  type GraphDeps,
} from "../src/lib/agents/graph";
import {
  resolveStoredAgentRuntimePolicy,
  describeStoredAgentRuntimeAvailability,
  SupportedAgentChannelsSchema,
  SupportedAgentGuardrailsSchema,
  SupportedAgentRoleBriefSchema,
} from "../src/lib/agents/runtime-policy";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

const BRIEF = { title: "Staff Backend Engineer", seniority: "Staff", requiredSkills: ["Go", "Postgres"] };

const POOL: Record<string, CandidateLite[]> = {
  GitHub: [
    { id: "gh-1", name: "Ana Ruiz", matchScore: 88, currentTitle: "Staff Eng", currentCompany: "Acme" },
    { id: "gh-2", name: "Ben Kol", matchScore: 82 },
    { id: "gh-3", name: "Cy Duma", matchScore: 55 },
  ],
  "Stack Overflow": [
    { id: "so-1", name: "Dee Nils", matchScore: 81 },
    { id: "gh-1", name: "Ana Ruiz", matchScore: 88 }, // duplicate across platforms
  ],
};

// ---------------------------------------------------------------------------
// Stored policy admits only the channel this graph can execute truthfully
// ---------------------------------------------------------------------------
{
  const email = resolveStoredAgentRuntimePolicy(
    ["Email"],
    { autopilot: false, canary_remaining: 5 },
  );
  const autonomous = resolveStoredAgentRuntimePolicy(
    ["Email"],
    { autopilot: true, canary_remaining: 0 },
  );
  const topicRules = resolveStoredAgentRuntimePolicy(
    ["Email"],
    { autopilot: false, canary_remaining: 5, topics_allow: ["architecture"] },
  );
  const specCap = resolveStoredAgentRuntimePolicy(
    ["Email"],
    { autopilot: false, canary_remaining: 5, max_per_day: 1 },
  );
  const mixed = resolveStoredAgentRuntimePolicy(
    ["Email", "WhatsApp"],
    { autopilot: false, canary_remaining: 5 },
  );
  const unknownAuthority = resolveStoredAgentRuntimePolicy(
    ["Email"],
    { autopilot: false, canary_remaining: 5, quiet_hours: { start: "18:00" } },
  );
  ok(
    "policy resolver: supported run-history defaults produce an auditable Email policy",
    email.ok && email.policy.draftStorage === "run_history" && email.policy.deliveryAuthority === "none",
  );
  ok("policy resolver: autonomous flags fail closed", !autonomous.ok);
  ok("policy resolver: unenforced topic rules fail closed", !topicRules.ok);
  ok("policy resolver: unenforced spec-level daily caps fail closed", !specCap.ok);
  ok("policy resolver: mixed channels fail closed instead of silently dropping one", !mixed.ok);
  ok("policy resolver: unknown authority fields fail closed", !unknownAuthority.ok);
  ok("spec writes: only the executable Email channel contract is accepted", SupportedAgentChannelsSchema.safeParse(["Email"]).success && !SupportedAgentChannelsSchema.safeParse(["WhatsApp"]).success);
  ok("spec writes: unsupported and unknown guardrails are rejected", !SupportedAgentGuardrailsSchema.safeParse({ autopilot: true, canary_remaining: 0 }).success && !SupportedAgentGuardrailsSchema.safeParse({ autopilot: false, canary_remaining: 5, quiet_hours: {} }).success);
  const legacyAvailability = describeStoredAgentRuntimeAvailability(
    BRIEF,
    ["WhatsApp"],
    { autopilot: false, canary_remaining: 5 },
    "active",
    "owner-1",
    "owner-1",
  );
  ok("read model: legacy unsupported specs are explicitly marked unavailable", !legacyAvailability.runtime_eligible && Boolean(legacyAvailability.runtime_reason));
  const invalidBriefAvailability = describeStoredAgentRuntimeAvailability(
    {},
    ["Email"],
    { autopilot: false, canary_remaining: 5 },
    "active",
    "owner-1",
    "owner-1",
  );
  ok("spec writes: a non-empty role title is required", !SupportedAgentRoleBriefSchema.safeParse({}).success);
  ok("read model: invalid legacy role briefs are explicitly marked unavailable", !invalidBriefAvailability.runtime_eligible && Boolean(invalidBriefAvailability.runtime_reason));
  const pausedAvailability = describeStoredAgentRuntimeAvailability(
    BRIEF,
    ["Email"],
    { autopilot: false, canary_remaining: 5 },
    "paused",
    "owner-1",
    "owner-1",
  );
  const otherOwnerAvailability = describeStoredAgentRuntimeAvailability(
    BRIEF,
    ["Email"],
    { autopilot: false, canary_remaining: 5 },
    "active",
    "owner-2",
    "owner-1",
  );
  ok("read model: paused specs are not runnable", !pausedAvailability.runtime_eligible && /active/i.test(pausedAvailability.runtime_reason ?? ""));
  ok("read model: another owner's specs are not runnable", !otherOwnerAvailability.runtime_eligible && /owner/i.test(otherOwnerAvailability.runtime_reason ?? ""));
}

function makeDeps(overrides?: Partial<GraphDeps> & { planJson?: string; draftBody?: string }): GraphDeps & { generateCalls: string[]; promptCalls: string[] } {
  const generateCalls: string[] = [];
  const promptCalls: string[] = [];
  const planJson =
    overrides?.planJson ??
    JSON.stringify({
      thought: "backend role, code-heavy platforms",
      steps: [
        { title: "GitHub Go engineers", platform: "GitHub", query: "language:go postgres" },
        { title: "SO Postgres answers", platform: "Stack Overflow", query: "postgres performance" },
      ],
    });
  const draftBody =
    overrides?.draftBody ??
    "Hi there, your work on Go services with heavy Postgres loads caught my eye. We have a staff role doing exactly that. Open to a quick chat?";
  return {
    generateCalls,
    promptCalls,
    async generate(system: string, prompt: string) {
      generateCalls.push(system.slice(0, 30));
      promptCalls.push(prompt);
      if (system.startsWith("You plan candidate sourcing")) return "```json\n" + planJson + "\n```";
      return JSON.stringify({ subject: "Go + Postgres staff role", body: draftBody });
    },
    async search(platform: string) {
      return POOL[platform] ?? [];
    },
    ...((overrides ?? {}) as Partial<GraphDeps>),
  };
}

// ---------------------------------------------------------------------------
// Stored execution policy is auditable and revalidated before every graph step
// ---------------------------------------------------------------------------
{
  const deps = makeDeps();
  const checkedNodes: string[] = [];
  const policy = {
    channel: "Email" as const,
    draftStorage: "run_history" as const,
    deliveryAuthority: "none" as const,
  };
  const result = await runGraph(
    initialState(BRIEF, 1, policy),
    deps,
    undefined,
    "planner",
    0,
    async (node) => { checkedNodes.push(node); },
  );
  ok("policy: stored snapshot records run-history storage with no delivery authority", result.state.executionPolicy?.draftStorage === "run_history" && result.state.executionPolicy?.deliveryAuthority === "none");
  ok("policy: every executed node is preceded by status revalidation", checkedNodes.length === result.steps && checkedNodes[0] === "planner");
}

{
  const deps = makeDeps();
  let stopped = false;
  try {
    await runGraph(initialState(BRIEF, 1), deps, undefined, "planner", 0, async (node) => {
      if (node === "sourcer") throw new Error("spec-paused");
    });
  } catch (error) {
    stopped = error instanceof Error && error.message === "spec-paused";
  }
  ok("pause: revalidation failure stops the graph", stopped);
  ok("pause: no search or later model work runs after the rejected node", deps.generateCalls.length === 1 && deps.promptCalls.length === 1);
}

// ---------------------------------------------------------------------------
// Happy path: full run
// ---------------------------------------------------------------------------
{
  const deps = makeDeps();
  const events: string[] = [];
  const result = await runGraph(initialState(BRIEF, 3), deps, async (_n, _s, e) => { events.push(e.type); });

  ok("run: completes at done", result.node === "done");
  ok("run: within step budget", result.steps < MAX_STEPS);
  ok("run: plan parsed through fences", result.state.plan?.steps.length === 2);
  ok("run: candidates deduped across platforms", result.state.candidates.length === 4);
  ok("run: screener drops sub-80 scores", result.state.screened.every((c) => c.matchScore >= 80));
  ok("run: screener sorts best-first", result.state.screened[0]?.id === "gh-1");
  ok("run: caps at draftCount", result.state.screened.length === 3);
  ok("run: one draft per screened candidate", result.state.drafts.length === 3);
  ok("run: all clean drafts pass gate", result.state.drafts.every((d) => d.gatePassed));
  ok("run: report mentions counts", (result.state.report ?? "").includes("4 real candidates"));
  ok("run: report truthfully retains drafts in run history without claiming approval", (result.state.report ?? "").includes("retained in run history") && !(result.state.report ?? "").includes("ready for approval"));
  ok("run: events narrate lifecycle", events.includes("plan_ready") && events.includes("screened") && events.includes("report"));
  ok("run: no errors", result.state.errors.length === 0);
}

// ---------------------------------------------------------------------------
// Gate holds an AI-sloppy draft — kept for review, never dropped
// ---------------------------------------------------------------------------
{
  const deps = makeDeps({ draftBody: "As an AI assistant, I found your profile via my search tools." });
  const result = await runGraph(initialState(BRIEF, 2), deps);
  ok("gate: run still completes", result.node === "done");
  ok("gate: drafts held not dropped", result.state.drafts.length === 2);
  ok("gate: none pass", result.state.drafts.every((d) => !d.gatePassed));
  ok("gate: reasons recorded", result.state.drafts.every((d) => (d.gateReasons ?? []).length > 0));
  ok("gate: report counts held drafts", (result.state.report ?? "").includes("held by the gate"));
}

// ---------------------------------------------------------------------------
// Planner returns garbage → run fails safe, no search happens
// ---------------------------------------------------------------------------
{
  let searched = false;
  const deps = makeDeps({ planJson: "totally not json" });
  deps.search = async () => { searched = true; return []; };
  const result = await runGraph(initialState(BRIEF, 3), deps);
  ok("badplan: ends done with error", result.node === "done" && result.state.errors.some((e) => e.includes("planner")));
  ok("badplan: never searched", !searched);
  ok("badplan: no drafts", result.state.drafts.length === 0);
}

// ---------------------------------------------------------------------------
// Search failure on one platform → error recorded, run continues
// ---------------------------------------------------------------------------
{
  const deps = makeDeps();
  const orig = deps.search;
  deps.search = async (platform, query, count) => {
    if (platform === "GitHub") throw new Error("rate limited");
    return orig(platform, query, count);
  };
  const result = await runGraph(initialState(BRIEF, 3), deps);
  ok("searchfail: run completes", result.node === "done");
  ok("searchfail: error recorded", result.state.errors.some((e) => e.includes("rate limited")));
  ok("searchfail: other platform still sourced", result.state.candidates.length === 2);
}

// ---------------------------------------------------------------------------
// No candidates pass screening → skips outreach entirely
// ---------------------------------------------------------------------------
{
  const deps = makeDeps();
  deps.search = async () => [{ id: "low-1", name: "Low Score", matchScore: 20 }];
  const result = await runGraph(initialState(BRIEF, 3), deps);
  ok("nopass: completes", result.node === "done");
  ok("nopass: zero drafts", result.state.drafts.length === 0);
  ok("nopass: reporter still ran", (result.state.report ?? "").length > 0);
}

// ---------------------------------------------------------------------------
// Resumability: single-step semantics + restart from persisted node/state
// ---------------------------------------------------------------------------
{
  const deps = makeDeps();
  const s0 = initialState(BRIEF, 3);
  const r1 = await stepGraph("planner", s0, deps);
  ok("resume: planner → sourcer", r1.node === "sourcer");
  const r2 = await stepGraph(r1.node, r1.state, deps);
  ok("resume: sourcer advances cursor", r2.state.planCursor === 1);
  // Simulate crash: restart driver from the persisted snapshot.
  const resumed = await runGraph(r2.state, deps, undefined, r2.node, 2);
  ok("resume: completes from snapshot", resumed.node === "done");
  ok("resume: full candidate set after resume", resumed.state.candidates.length === 4);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
{
  ok("extractJson: fenced", (extractJson('```json\n{"a":1}\n```') as { a: number })?.a === 1);
  ok("extractJson: prefixed prose", (extractJson('Sure! {"a":2}') as { a: number })?.a === 2);
  ok("extractJson: garbage → null", extractJson("nope") === null);
  ok("plan schema: rejects empty steps", !PlanSchema.safeParse({ thought: "", steps: [] }).success);
  ok("plan schema: rejects unknown platform", !PlanSchema.safeParse({ steps: [{ title: "x", platform: "TikTok", query: "y" }] }).success);
}

console.log(`RESULT agent-graph: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
