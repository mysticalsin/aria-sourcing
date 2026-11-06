// Unit tests for the unified enrichment orchestrator + merge + registry.
// The orchestrator's provider registry (enrichment/registry.ts) and runner
// table (enrichment/runners.ts) are replaced, via node:test's module-mock
// hooks, with fake providers whose runner results come from mutable fixtures;
// the service-role Supabase client is mocked so every budget RPC the
// orchestrator makes is recorded. No network is ever hit.
// Run with: node --experimental-test-module-mocks --import tsx
// tests/enrichment-orchestrator.mts

import { mock } from "node:test";
import { isDeepStrictEqual } from "node:util";
import type { Candidate, ComplianceFlags, EnrichableField, SourcePlatform } from "../src/lib/types.ts";
// The SHIPPED registry + runner table. Static imports are evaluated before any
// mock below is registered (a module mock only affects later imports), so the
// registry-sanity block checks the real wiring while every other block runs
// against the fakes.
import { ENRICHMENT_PROVIDERS as SHIPPED_PROVIDERS, type EnrichmentProvider } from "../src/lib/enrichment/registry.ts";
import { ENRICHMENT_RUNNERS as SHIPPED_RUNNERS, type EnrichmentRunner, type RunnerResult } from "../src/lib/enrichment/runners.ts";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- mutable fixtures the mocked modules read at call time ----------------- */

/** Ordered log: `rpc:<name>` for every service-role RPC, `run:<provider>` for
 *  every runner call — lets a block assert claim -> run -> settle ordering. */
const events: string[] = [];

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}
const serviceRpcCalls: RpcCall[] = [];

interface ClaimResponse {
  data: unknown;
  error: { code: string } | null;
}
const ALLOW: ClaimResponse = { data: { allowed: true, ledger_id: "ledger-1" }, error: null };

let serviceAvailable = true;
let claimResponse: ClaimResponse = ALLOW;
let workspaceId: string | null = "workspace-1";

type FakeId = Extract<SourcePlatform, "LinkedIn" | "GitHub">;

interface FakeProviderFixture {
  enriches: EnrichableField[];
  /** Registry weight: waterfall order + the amount claimed from the budget authority. */
  costUnits: number;
  /** keyField() resolves an identity only when true. */
  hasKey: boolean;
  /** What this provider's runner returns. */
  result: RunnerResult;
  /** Side effect run inside the runner before it returns (e.g. advance the clock). */
  onRun: (() => void) | null;
  calls: number;
  /** The candidate the runner received, per call. */
  seen: Candidate[];
}

function freshFixture(): FakeProviderFixture {
  return {
    enriches: ["email"],
    costUnits: 1,
    hasKey: true,
    result: { fields: {}, costUnits: 0, status: "no_data" },
    onRun: null,
    calls: 0,
    seen: [],
  };
}

const fixtures: Record<FakeId, FakeProviderFixture> = { LinkedIn: freshFixture(), GitHub: freshFixture() };

function fakeProvider(id: FakeId): EnrichmentProvider {
  return {
    id,
    label: `Fake ${id}`,
    keyProvider: "Custom",
    get enriches() {
      return fixtures[id].enriches;
    },
    get costUnits() {
      return fixtures[id].costUnits;
    },
    keyField: (c) => (fixtures[id].hasKey ? { kind: "linkedinUrl", value: c.linkedinUrl } : null),
  };
}

function fakeRunner(id: FakeId): EnrichmentRunner {
  return async (_session, candidate) => {
    const fixture = fixtures[id];
    fixture.calls++;
    fixture.seen.push(candidate);
    events.push(`run:${id}`);
    fixture.onRun?.();
    return fixture.result;
  };
}

/* The array/object the mocked modules export. The orchestrator holds these
 * exact references, so each block re-populates them in place. */
const mockedProviders: EnrichmentProvider[] = [];
const mockedRunners: Partial<Record<SourcePlatform, EnrichmentRunner>> = {};

/** Register `ids` in the mocked registry IN THE GIVEN ORDER (the orchestrator
 *  must sort them by cost itself), each with a runner unless listed in
 *  `withoutRunner`. */
function setProviders(ids: FakeId[], withoutRunner: FakeId[] = []) {
  mockedProviders.length = 0;
  for (const key of Object.keys(mockedRunners) as SourcePlatform[]) delete mockedRunners[key];
  for (const id of ids) {
    mockedProviders.push(fakeProvider(id));
    if (!withoutRunner.includes(id)) mockedRunners[id] = fakeRunner(id);
  }
}

function resetAllFixtures() {
  fixtures.LinkedIn = freshFixture();
  fixtures.GitHub = freshFixture();
  setProviders(["LinkedIn"]);
  events.length = 0;
  serviceRpcCalls.length = 0;
  serviceAvailable = true;
  claimResponse = ALLOW;
  workspaceId = "workspace-1";
}

const rpcNames = () => serviceRpcCalls.map((call) => call.name);
const callsTo = (name: string) => serviceRpcCalls.filter((call) => call.name === name);
const claimedProviders = () => callsTo("claim_enrichment_budget").map((call) => call.args.p_provider);
const runs = () => events.filter((event) => event.startsWith("run:"));

/* ---- module mocks ---------------------------------------------------------- */

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () =>
      serviceAvailable
        ? {
            rpc: async (name: string, args: Record<string, unknown> = {}) => {
              serviceRpcCalls.push({ name, args });
              events.push(`rpc:${name}`);
              if (name === "claim_enrichment_budget") return claimResponse;
              if (name === "settle_enrichment_spend") return { data: { ok: true }, error: null };
              if (name === "release_enrichment_claim") return { data: { ok: true }, error: null };
              return { data: null, error: null };
            },
          }
        : null,
  },
});
mock.module(moduleUrl("src/lib/enrichment/registry.ts"), { namedExports: { ENRICHMENT_PROVIDERS: mockedProviders } });
mock.module(moduleUrl("src/lib/enrichment/runners.ts"), { namedExports: { ENRICHMENT_RUNNERS: mockedRunners } });

const { orchestrateEnrichment } = await import("../src/lib/enrichment/orchestrator.ts");
const { mergeEnrichment, recordEnrichmentAttempt, computeCoverage } = await import("../src/lib/enrichment/merge.ts");
const { buildSeedState } = await import("../src/lib/seed.ts");
const { scoreCandidate } = await import("../src/lib/scoring.ts");

/* ---- test candidate builder ------------------------------------------------ */

function emptyCompliance(): ComplianceFlags {
  return {
    doNotContact: false,
    suppressed: false,
    unsubscribed: false,
    gdprExportRequested: false,
    anonymized: false,
    suppressedUntil: null,
  };
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    campaignId: "camp-1",
    name: "Jane Doe",
    email: "",
    avatarInitials: "JD",
    currentTitle: "",
    currentCompany: "Acme Corp",
    location: "",
    timezone: "",
    linkedinUrl: "https://www.linkedin.com/in/jane-doe",
    githubUrl: "",
    sourcePlatform: "LinkedIn",
    sourceQuery: "",
    matchScore: 0,
    matchBreakdown: [],
    techStack: [],
    yearsExperience: 5,
    companyStageExperience: [],
    industryExperience: [],
    recentActivity: "",
    stage: "Sourced",
    lastContactedAt: null,
    outreachHistory: [],
    replyHistory: [],
    booking: null,
    complianceFlags: emptyCompliance(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Never a real session: the fake runners ignore it, and the orchestrator only
// asks it for current_workspace_id.
const fakeSession = {
  rpc: async (name: string) => {
    if (name === "current_workspace_id") return { data: workspaceId, error: null };
    return { data: null, error: null };
  },
} as unknown as Parameters<typeof orchestrateEnrichment>[0]["session"];

type OrchestrateResult = Awaited<ReturnType<typeof orchestrateEnrichment>>;

/* ============================================================================
 * 1. A single provider fills the wanted field in one call
 * ========================================================================== */
{
  resetAllFixtures();
  fixtures.LinkedIn.enriches = ["email", "headline", "skills"];
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com", confidence: 0.9 } }, costUnits: 1, status: "ok" };
  const candidate = makeCandidate();

  const result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });
  const attempt = result.attempts[0];

  ok("fill: the provider's runner is called once and fills email", fixtures.LinkedIn.calls === 1 && result.candidate.email === "jane@acme.com");
  ok("fill: the runner receives the input candidate", fixtures.LinkedIn.seen[0]?.id === "cand-1");
  ok("fill: exactly one attempt recorded (no wasted calls)", result.attempts.length === 1);
  ok("fill: the one attempt is LinkedIn/ok and lists email as filled", attempt?.provider === "LinkedIn" && attempt?.status === "ok" && isDeepStrictEqual(attempt?.fieldsFilled, ["email"]));
  ok("fill: spend reflects the runner-reported cost", result.spend === 1);
  ok("fill: coverage now includes email", result.candidate.enrichment?.coverage.includes("email") === true);
  ok(
    "fill: provenance attributes email to the provider with the runner's confidence",
    result.candidate.enrichment?.fieldProvenance.email?.provider === "LinkedIn" && result.candidate.enrichment?.fieldProvenance.email?.confidence === 0.9,
  );
  ok("fill: the returned attempts mirror the attempt ledger on the candidate", isDeepStrictEqual(result.attempts, result.candidate.enrichment?.attempts));
  ok("fill: the input candidate object is not mutated", candidate.email === "" && candidate.enrichment === undefined);
}

/* ============================================================================
 * 2. A runner that reports not_configured is recorded as such — never throws,
 *    and the budget claim made for it is released, not settled
 * ========================================================================== */
{
  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: {}, costUnits: 0, status: "not_configured", detail: "No enrichment key configured." };
  const candidate = makeCandidate({ currentCompany: "" });

  let threw = false;
  let result: OrchestrateResult | null = null;
  try {
    result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });
  } catch {
    threw = true;
  }

  ok("not configured: orchestrateEnrichment never throws", threw === false);
  ok("not configured: exactly one attempt is recorded", result?.attempts.length === 1);
  ok("not configured: reported status is not_configured, not error", result?.attempts[0]?.status === "not_configured");
  ok("not configured: the runner's detail is carried onto the attempt", result?.attempts[0]?.detail === "No enrichment key configured.");
  ok("not configured: candidate left unchanged", result?.candidate.email === "");
  ok("not configured: spend stays zero", result?.spend === 0);
  ok("not configured: a skipped provider does not mark the candidate failed", result?.candidate.enrichment?.status === "unenriched");
  ok(
    "not configured: the budget claim is released, never settled",
    isDeepStrictEqual(rpcNames(), ["claim_enrichment_budget", "release_enrichment_claim"]) && callsTo("release_enrichment_claim")[0]?.args.p_ledger_id === "ledger-1",
  );
}

/* ============================================================================
 * 3. A runner that reports an error is recorded as an error attempt — never
 *    throws, releases its claim, and marks a bare candidate failed
 * ========================================================================== */
{
  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: {}, costUnits: 0, status: "error", detail: "upstream 502" };
  const candidate = makeCandidate({ currentCompany: "" });

  let threw = false;
  let result: OrchestrateResult | null = null;
  try {
    result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });
  } catch {
    threw = true;
  }

  ok("runner error: orchestrateEnrichment never throws", threw === false);
  ok("runner error: recorded as one error attempt with the runner's detail", result?.attempts.length === 1 && result?.attempts[0]?.status === "error" && result?.attempts[0]?.detail === "upstream 502");
  ok("runner error: a bare candidate (nothing covered) is marked failed", result?.candidate.enrichment?.status === "failed");
  ok("runner error: the budget claim is released, never settled", isDeepStrictEqual(rpcNames(), ["claim_enrichment_budget", "release_enrichment_claim"]));
  ok("runner error: spend stays zero", result?.spend === 0);
}

/* ============================================================================
 * 4. mergeEnrichment fills only missing/higher-confidence fields, records
 *    fieldProvenance, and does not let a lower-confidence value overwrite a
 *    higher-confidence one already on record.
 * ========================================================================== */
{
  const at1 = "2026-01-01T00:00:00.000Z";
  const at2 = "2026-01-01T00:05:00.000Z";
  const at3 = "2026-01-01T00:10:00.000Z";

  const c0 = makeCandidate({ email: "" });
  ok("merge: fresh candidate has no enrichment state yet (unenriched)", c0.enrichment === undefined);

  const c1 = mergeEnrichment(c0, "GitHub", { email: { value: "a@x.com", confidence: 0.5 } }, at1);
  ok("merge: first provider fills the missing email field", c1.email === "a@x.com");
  ok("merge: provenance records the filling provider + confidence", c1.enrichment?.fieldProvenance.email?.provider === "GitHub" && c1.enrichment?.fieldProvenance.email?.confidence === 0.5);
  ok("merge: status is partial (email only, phone still missing)", c1.enrichment?.status === "partial");

  const c2 = mergeEnrichment(c1, "LinkedIn", { email: { value: "b@x.com", confidence: 0.3 } }, at2);
  ok("merge: a lower-confidence value does NOT overwrite an already-covered field", c2.email === "a@x.com");
  ok("merge: provenance still attributes the field to the original (higher-confidence) provider", c2.enrichment?.fieldProvenance.email?.provider === "GitHub");
  ok("merge: the losing attempt is still recorded as no_data (nothing filled)", c2.enrichment?.attempts[c2.enrichment.attempts.length - 1]?.status === "no_data");

  const c3 = mergeEnrichment(c2, "LinkedIn", { email: { value: "c@x.com", confidence: 0.9 } }, at3);
  ok("merge: a higher-confidence value DOES overwrite an already-covered field", c3.email === "c@x.com");
  ok("merge: provenance now attributes the field to the new, higher-confidence provider", c3.enrichment?.fieldProvenance.email?.provider === "LinkedIn" && c3.enrichment?.fieldProvenance.email?.confidence === 0.9);

  // A value with no confidence at all never beats an already-recorded confident field.
  const c4 = mergeEnrichment(c3, "GitHub", { email: { value: "d@x.com" } }, at3);
  ok("merge: an unconfident new value never overwrites a confident stored one", c4.email === "c@x.com" && c4.enrichment?.fieldProvenance.email?.provider === "LinkedIn");

  /* ---- missing confidence is treated as 0, not as "unbeatable" ----
   * A candidate can arrive with a homed field already populated (e.g. email
   * set directly, never routed through mergeEnrichment) so fieldProvenance
   * has NO entry for it at all — `stored` itself is undefined, not just
   * `stored.confidence`. The gate must still let a confident new value win
   * (0 default beaten by any real confidence), while a new value with no
   * confidence of its own (also defaulting to 0) must NOT overwrite it either
   * (0 does not beat 0). */
  const cPreFilled = makeCandidate({ email: "existing@x.com" });
  ok("merge: pre-filled candidate has no fieldProvenance yet for email", cPreFilled.enrichment === undefined);

  const cOverwritten = mergeEnrichment(cPreFilled, "LinkedIn", { email: { value: "confident@x.com", confidence: 0.9 } }, at1);
  ok(
    "merge: a confident new value DOES overwrite a covered field with no recorded confidence (treated as 0)",
    cOverwritten.email === "confident@x.com" && cOverwritten.enrichment?.fieldProvenance.email?.provider === "LinkedIn",
  );

  const cNotOverwritten = mergeEnrichment(cPreFilled, "LinkedIn", { email: { value: "unconfident@x.com" } }, at1);
  ok(
    "merge: an unconfident new value does NOT overwrite a covered field when both default to 0 confidence",
    cNotOverwritten.email === "existing@x.com",
  );

  /* ---- coverage/status transitions: unenriched -> partial -> enriched ---- */
  ok("status transition: unenriched -> partial happened at c1", c1.enrichment?.status === "partial");
  const c5 = mergeEnrichment(c3, "GitHub", { phone: { value: "+15551234567", confidence: 0.7 } }, at3);
  ok("status transition: partial -> enriched once both email and phone are covered", c5.enrichment?.status === "enriched");
  ok("status transition: coverage lists both email and phone", (c5.enrichment?.coverage ?? []).includes("email") && (c5.enrichment?.coverage ?? []).includes("phone"));
}

/* ============================================================================
 * 5. Budget exhaustion yields a budget_exceeded attempt and no paid call
 * ========================================================================== */
{
  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 1, status: "ok" };
  const result = await orchestrateEnrichment({
    session: fakeSession,
    candidate: makeCandidate(),
    want: ["email"],
    budgetRemaining: 0,
  });
  ok("budget: the runner is never invoked without budget", fixtures.LinkedIn.calls === 0);
  ok("budget: the skipped provider is recorded budget_exceeded", result.attempts[0]?.status === "budget_exceeded");
  ok("budget: no budget-authority RPC is made", serviceRpcCalls.length === 0);
  ok("budget: spend stays zero", result.spend === 0);
}

/* ============================================================================
 * 6. The budget is shared across the waterfall: a paid no-match on the cheap
 *    provider leaves nothing for the costlier one
 * ========================================================================== */
{
  resetAllFixtures();
  setProviders(["LinkedIn", "GitHub"]);
  fixtures.LinkedIn.costUnits = 1;
  fixtures.LinkedIn.result = { fields: {}, costUnits: 1, status: "no_data" };
  fixtures.GitHub.costUnits = 2;
  fixtures.GitHub.result = { fields: { email: { value: "gh@acme.com" } }, costUnits: 2, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 1 });

  ok("shared budget: the cheap provider runs and its no_data attempt carries its cost", result.attempts[0]?.provider === "LinkedIn" && result.attempts[0]?.status === "no_data" && result.attempts[0]?.costUnits === 1);
  ok("shared budget: the costlier provider is recorded budget_exceeded", result.attempts[1]?.provider === "GitHub" && result.attempts[1]?.status === "budget_exceeded");
  ok("shared budget: the costlier provider's runner is never called", fixtures.GitHub.calls === 0);
  ok("shared budget: spend is the one paid call", result.spend === 1);
  ok("shared budget: only the cheap provider claims, and its paid no-match is settled", isDeepStrictEqual(rpcNames(), ["claim_enrichment_budget", "settle_enrichment_spend"]) && callsTo("settle_enrichment_spend")[0]?.args.p_actual_cents === 1);
  ok("shared budget: the candidate stays unfilled", result.candidate.email === "");
}

/* ============================================================================
 * 7. Budget-authority contract: claim (registry cost) -> run -> settle (actual
 *    cost) against the session's workspace
 * ========================================================================== */
{
  resetAllFixtures();
  fixtures.LinkedIn.costUnits = 3;
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 2, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });
  const claim = callsTo("claim_enrichment_budget")[0]?.args;
  const settle = callsTo("settle_enrichment_spend")[0]?.args;

  ok("budget authority: claim -> run -> settle, in that order", isDeepStrictEqual(events, ["rpc:claim_enrichment_budget", "run:LinkedIn", "rpc:settle_enrichment_spend"]));
  ok("budget authority: the claim is scoped to the session's workspace", claim?.p_workspace_id === "workspace-1");
  ok("budget authority: the claim names the provider", claim?.p_provider === "LinkedIn");
  ok("budget authority: the claim reserves the registry cost up-front", claim?.p_amount_cents === 3);
  ok("budget authority: the claim is booked against a YYYY-MM period", typeof claim?.p_period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(claim.p_period));
  ok("budget authority: the idempotency key is per candidate and provider", typeof claim?.p_idempotency_key === "string" && claim.p_idempotency_key.startsWith("enrich:cand-1:LinkedIn:"));
  ok("budget authority: settle uses the claim's ledger id and the runner-reported (actual) cost", settle?.p_ledger_id === "ledger-1" && settle?.p_actual_cents === 2);
  ok("budget authority: spend is the actual cost, not the registry weight", result.spend === 2);
  ok("budget authority: the ok attempt carries the actual cost", result.attempts[0]?.costUnits === 2);
}

/* ============================================================================
 * 8. A refused or unavailable budget claim skips the provider as
 *    budget_exceeded, carrying the reason, before any paid call
 * ========================================================================== */
{
  const refusals: Array<{ label: string; available: boolean; response: ClaimResponse; detail: string }> = [
    { label: "cap reached", available: true, response: { data: { allowed: false, reason: "monthly_cap_reached" }, error: null }, detail: "monthly_cap_reached" },
    { label: "rpc error", available: true, response: { data: null, error: { code: "PGRST301" } }, detail: "PGRST301" },
    { label: "allowed without a ledger id", available: true, response: { data: { allowed: true }, error: null }, detail: "budget_refused" },
    { label: "no service client", available: false, response: ALLOW, detail: "budget_authority_unavailable" },
  ];
  for (const refusal of refusals) {
    resetAllFixtures();
    serviceAvailable = refusal.available;
    claimResponse = refusal.response;
    fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 1, status: "ok" };

    const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });

    ok(`claim refused (${refusal.label}): the runner is never called`, fixtures.LinkedIn.calls === 0);
    ok(
      `claim refused (${refusal.label}): recorded budget_exceeded with reason "${refusal.detail}"`,
      result.attempts.length === 1 && result.attempts[0]?.status === "budget_exceeded" && result.attempts[0]?.detail === refusal.detail,
    );
    ok(`claim refused (${refusal.label}): nothing is settled or released`, rpcNames().every((name) => name === "claim_enrichment_budget"));
    ok(`claim refused (${refusal.label}): spend is zero and the candidate unchanged`, result.spend === 0 && result.candidate.email === "");
  }
}

/* ============================================================================
 * 9. A zero-cost provider runs without any budget-authority round trip
 * ========================================================================== */
{
  resetAllFixtures();
  serviceAvailable = false; // a claim attempt would surface as budget_authority_unavailable
  fixtures.LinkedIn.costUnits = 0;
  fixtures.LinkedIn.result = { fields: { email: { value: "free@acme.com" } }, costUnits: 0, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });

  ok("free provider: runs and fills the field", fixtures.LinkedIn.calls === 1 && result.candidate.email === "free@acme.com");
  ok("free provider: no budget claim, settle or release is attempted", serviceRpcCalls.length === 0 && result.attempts[0]?.status === "ok");
  ok("free provider: spend stays zero", result.spend === 0);
}

/* ============================================================================
 * 10. No resolvable workspace: the provider is recorded as an error before
 *     any claim or paid call
 * ========================================================================== */
{
  resetAllFixtures();
  workspaceId = null;
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 1, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate({ currentCompany: "" }), want: ["email"], budgetRemaining: 100 });

  ok("no workspace: the runner is never called", fixtures.LinkedIn.calls === 0);
  ok("no workspace: no budget claim is attempted", serviceRpcCalls.length === 0);
  ok("no workspace: recorded as an error attempt", result.attempts[0]?.status === "error" && result.attempts[0]?.detail === "workspace authority unavailable");
  ok("no workspace: a bare candidate is marked failed", result.candidate.enrichment?.status === "failed");
  ok("no workspace: spend stays zero", result.spend === 0);
}

/* ============================================================================
 * 11. Waterfall order + early stop: cheapest first regardless of registry
 *     order, and nothing more runs once `want` is covered
 * ========================================================================== */
{
  resetAllFixtures();
  setProviders(["GitHub", "LinkedIn"]); // costlier provider registered first
  fixtures.GitHub.costUnits = 5;
  fixtures.GitHub.result = { fields: { email: { value: "gh@acme.com" } }, costUnits: 5, status: "ok" };
  fixtures.LinkedIn.costUnits = 1;
  fixtures.LinkedIn.result = { fields: { email: { value: "li@acme.com" } }, costUnits: 1, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });

  ok("waterfall order: the cheaper provider runs first regardless of registry order", isDeepStrictEqual(runs(), ["run:LinkedIn"]));
  ok("waterfall stop: once want is covered, the costlier provider is never called", fixtures.GitHub.calls === 0);
  ok("waterfall stop: one attempt, from the cheaper provider", result.attempts.length === 1 && result.attempts[0]?.provider === "LinkedIn");
  ok("waterfall stop: only the cheaper provider's budget is claimed", isDeepStrictEqual(claimedProviders(), ["LinkedIn"]));
  ok("waterfall stop: the cheaper provider's value is kept", result.candidate.email === "li@acme.com" && result.spend === 1);
}

/* ============================================================================
 * 12. Waterfall fall-through: a still-missing field moves on to the next
 *     provider, which sees the candidate as enriched by the earlier one
 * ========================================================================== */
{
  resetAllFixtures();
  setProviders(["GitHub", "LinkedIn"]);
  fixtures.LinkedIn.costUnits = 1;
  fixtures.LinkedIn.enriches = ["email", "phone"];
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com", confidence: 0.9 } }, costUnits: 1, status: "ok" };
  fixtures.GitHub.costUnits = 2;
  fixtures.GitHub.enriches = ["phone"];
  fixtures.GitHub.result = { fields: { phone: { value: "+15551234567", confidence: 0.8 } }, costUnits: 2, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email", "phone"], budgetRemaining: 100 });
  const provenance = result.candidate.enrichment?.fieldProvenance;

  ok("fall-through: both providers run, cheapest first", isDeepStrictEqual(runs(), ["run:LinkedIn", "run:GitHub"]));
  ok("fall-through: the second provider receives the candidate as enriched by the first", fixtures.GitHub.seen[0]?.email === "jane@acme.com");
  ok(
    "fall-through: both fields end up filled, each attributed to its own provider",
    result.candidate.email === "jane@acme.com" && result.candidate.phone === "+15551234567" && provenance?.email?.provider === "LinkedIn" && provenance?.phone?.provider === "GitHub",
  );
  ok(
    "fall-through: two ok attempts, in run order",
    isDeepStrictEqual(result.attempts.map((a) => `${a.provider}:${a.status}`), ["LinkedIn:ok", "GitHub:ok"]),
  );
  ok("fall-through: spend sums both runner-reported costs", result.spend === 3);
  ok("fall-through: status is enriched once email and phone are both covered", result.candidate.enrichment?.status === "enriched");
  ok(
    "fall-through: each provider claims then settles its own ledger entry",
    isDeepStrictEqual(rpcNames(), ["claim_enrichment_budget", "settle_enrichment_spend", "claim_enrichment_budget", "settle_enrichment_spend"])
      && isDeepStrictEqual(claimedProviders(), ["LinkedIn", "GitHub"]),
  );
}

/* ============================================================================
 * 13. A later provider that only offers already-covered fields is skipped
 *     (no call, no attempt, no claim) even though another field is missing
 * ========================================================================== */
{
  resetAllFixtures();
  setProviders(["LinkedIn", "GitHub"]);
  fixtures.LinkedIn.costUnits = 1;
  fixtures.LinkedIn.enriches = ["email", "phone"];
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 1, status: "ok" };
  fixtures.GitHub.costUnits = 2;
  fixtures.GitHub.enriches = ["email"];
  fixtures.GitHub.result = { fields: { email: { value: "gh@acme.com" } }, costUnits: 2, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email", "phone"], budgetRemaining: 100 });

  ok("covered skip: a provider offering only already-covered fields is never called", fixtures.GitHub.calls === 0);
  ok("covered skip: it records no attempt and claims no budget", result.attempts.length === 1 && isDeepStrictEqual(claimedProviders(), ["LinkedIn"]));
  ok("covered skip: the earlier value stands and the still-missing field stays missing", result.candidate.email === "jane@acme.com" && !result.candidate.phone);
}

/* ============================================================================
 * 14. Ineligible providers are filtered out up-front, with no attempt
 * ========================================================================== */
{
  // (a) the provider fills none of the wanted fields
  resetAllFixtures();
  fixtures.LinkedIn.enriches = ["phone"];
  fixtures.LinkedIn.result = { fields: { phone: { value: "+15551234567" } }, costUnits: 1, status: "ok" };
  const offTarget = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });
  ok(
    "eligibility: a provider that fills none of the wanted fields is never called and records nothing",
    fixtures.LinkedIn.calls === 0 && offTarget.attempts.length === 0 && serviceRpcCalls.length === 0 && offTarget.spend === 0,
  );

  // (b) the provider cannot resolve an identity for this candidate
  resetAllFixtures();
  fixtures.LinkedIn.hasKey = false;
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 1, status: "ok" };
  const keyless = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });
  ok(
    "eligibility: a provider with no key field for this candidate is never called and records nothing",
    fixtures.LinkedIn.calls === 0 && keyless.attempts.length === 0 && serviceRpcCalls.length === 0,
  );
  ok("eligibility: with no eligible provider the candidate gains no enrichment state", keyless.candidate.enrichment === undefined && keyless.candidate.email === "");

  // (c) every wanted field is already covered on the input candidate
  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: { email: { value: "new@acme.com", confidence: 1 } }, costUnits: 1, status: "ok" };
  const covered = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate({ email: "already@acme.com" }), want: ["email"], budgetRemaining: 100 });
  ok(
    "eligibility: when every wanted field is already covered, no provider runs",
    fixtures.LinkedIn.calls === 0 && covered.attempts.length === 0 && covered.candidate.email === "already@acme.com" && covered.spend === 0,
  );
}

/* ============================================================================
 * 15. A registry provider with no runner is skipped silently and the
 *     waterfall falls through to the next one
 * ========================================================================== */
{
  resetAllFixtures();
  setProviders(["LinkedIn", "GitHub"], ["LinkedIn"]);
  fixtures.LinkedIn.costUnits = 1;
  fixtures.GitHub.costUnits = 2;
  fixtures.GitHub.result = { fields: { email: { value: "gh@acme.com" } }, costUnits: 2, status: "ok" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });

  ok("no runner: the runner-less provider records no attempt", result.attempts.length === 1 && result.attempts[0]?.provider === "GitHub");
  ok("no runner: no budget is claimed for it", isDeepStrictEqual(claimedProviders(), ["GitHub"]));
  ok("no runner: the waterfall still falls through to the next provider", result.candidate.email === "gh@acme.com" && fixtures.GitHub.calls === 1);
}

/* ============================================================================
 * 16. Wall-clock deadline: once 45s have elapsed, a not-yet-started provider
 *     is deferred (never run, never claimed) and earlier paid work is kept
 * ========================================================================== */
{
  resetAllFixtures();
  setProviders(["LinkedIn", "GitHub"]);
  const realDateNow = Date.now;
  let clockOffsetMs = 0;
  fixtures.LinkedIn.costUnits = 1;
  fixtures.LinkedIn.enriches = ["email", "phone"];
  fixtures.LinkedIn.result = { fields: { email: { value: "jane@acme.com" } }, costUnits: 1, status: "ok" };
  fixtures.LinkedIn.onRun = () => {
    clockOffsetMs = 45_000; // the slow first provider eats the whole time budget
  };
  fixtures.GitHub.costUnits = 2;
  fixtures.GitHub.enriches = ["phone"];
  fixtures.GitHub.result = { fields: { phone: { value: "+15551234567" } }, costUnits: 2, status: "ok" };

  let result: OrchestrateResult;
  Date.now = () => realDateNow() + clockOffsetMs;
  try {
    result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email", "phone"], budgetRemaining: 100 });
  } finally {
    Date.now = realDateNow;
  }
  const deferred = result.attempts[1];

  ok("deadline: the provider due after the time budget is never called", fixtures.GitHub.calls === 0);
  ok(
    "deadline: it is recorded as deferred, zero cost, nothing filled, with a re-run hint",
    deferred?.provider === "GitHub" && deferred?.status === "deferred" && deferred?.costUnits === 0 && deferred?.fieldsFilled.length === 0 && (deferred?.detail ?? "").includes("re-run"),
  );
  ok("deadline: the already-paid earlier result is kept", result.candidate.email === "jane@acme.com" && result.attempts[0]?.provider === "LinkedIn" && result.attempts[0]?.status === "ok");
  ok("deadline: spend counts only the provider that ran", result.spend === 1);
  ok("deadline: no budget is claimed for the deferred provider", isDeepStrictEqual(claimedProviders(), ["LinkedIn"]));
}

/* ============================================================================
 * 17. Runner-result reconciliation: actual cost + detail patched onto the
 *     merged attempt, externalId recorded, ok-but-empty / no_data results
 * ========================================================================== */
{
  resetAllFixtures();
  fixtures.LinkedIn.result = {
    fields: { email: { value: "jane@acme.com" } },
    costUnits: 2,
    status: "ok",
    detail: "matched on profile url",
    externalId: "li-123",
  };
  const filled = await orchestrateEnrichment({
    session: fakeSession,
    candidate: makeCandidate({ externalIds: { GitHub: "gh-9" } }),
    want: ["email"],
    budgetRemaining: 100,
  });
  ok("reconcile: the merged ok attempt carries the runner's actual cost (not merge's 0)", filled.attempts[0]?.status === "ok" && filled.attempts[0]?.costUnits === 2);
  ok("reconcile: the merged ok attempt carries the runner's detail", filled.attempts[0]?.detail === "matched on profile url");
  ok("reconcile: the candidate's attempt ledger holds the same patched attempt", isDeepStrictEqual(filled.candidate.enrichment?.attempts.at(-1), filled.attempts[0]));
  ok("reconcile: the resolved externalId is recorded under the provider id", filled.candidate.externalIds?.LinkedIn === "li-123");
  ok("reconcile: existing external ids are preserved", filled.candidate.externalIds?.GitHub === "gh-9");

  // status "ok" but nothing usable: merge records no_data, the paid call is still settled
  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: {}, costUnits: 1, status: "ok", externalId: "li-456" };
  const empty = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });
  ok("reconcile: an ok result that fills nothing is recorded as no_data", empty.attempts[0]?.status === "no_data" && empty.attempts[0]?.fieldsFilled.length === 0);
  ok(
    "reconcile: that paid empty result is still charged and settled",
    empty.attempts[0]?.costUnits === 1 && empty.spend === 1 && callsTo("settle_enrichment_spend")[0]?.args.p_actual_cents === 1 && callsTo("release_enrichment_claim").length === 0,
  );
  ok("reconcile: the externalId is recorded even when no field was filled", empty.candidate.externalIds?.LinkedIn === "li-456");

  // a runner-reported no_data keeps its cost + detail and is settled, not released
  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: {}, costUnits: 1, status: "no_data", detail: "no profile at this url" };
  const noData = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate(), want: ["email"], budgetRemaining: 100 });
  ok(
    "no_data: recorded with the runner's cost and detail",
    noData.attempts[0]?.status === "no_data" && noData.attempts[0]?.costUnits === 1 && noData.attempts[0]?.detail === "no profile at this url",
  );
  ok("no_data: a paid no-match is settled, not released", isDeepStrictEqual(rpcNames(), ["claim_enrichment_budget", "settle_enrichment_spend"]));
}

/* ============================================================================
 * 18. Multi-field results merge onto their candidate slots with provenance
 * ========================================================================== */
{
  resetAllFixtures();
  const want: EnrichableField[] = ["headline", "skills", "experience", "education", "languages", "location"];
  fixtures.LinkedIn.enriches = ["email", ...want];
  fixtures.LinkedIn.result = {
    fields: {
      headline: { value: "Staff Engineer" },
      location: { value: "Lisbon, Portugal" },
      skills: { value: ["go", "Rust", "rust"] },
      experience: { value: ["Staff Engineer @ Acme (2021 - now)", "  "] },
      education: { value: ["BSc Computer Science @ IST"] },
      languages: { value: ["English", "Portuguese"] },
    },
    costUnits: 1,
    status: "ok",
  };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate: makeCandidate({ techStack: ["Go"] }), want, budgetRemaining: 100 });
  const c = result.candidate;

  ok("multi-field: headline lands on currentTitle and location on location", c.currentTitle === "Staff Engineer" && c.location === "Lisbon, Portugal");
  ok("multi-field: skills union-merge case-insensitively onto techStack", isDeepStrictEqual(c.techStack, ["Go", "Rust"]));
  ok(
    "multi-field: experience/education/languages land on their own slots, blanks dropped",
    isDeepStrictEqual(c.experience, ["Staff Engineer @ Acme (2021 - now)"]) && isDeepStrictEqual(c.education, ["BSc Computer Science @ IST"]) && isDeepStrictEqual(c.languages, ["English", "Portuguese"]),
  );
  ok("multi-field: the attempt lists every filled field", isDeepStrictEqual([...(result.attempts[0]?.fieldsFilled ?? [])].sort(), [...want].sort()));
  ok("multi-field: every filled field's provenance names the provider", want.every((field) => c.enrichment?.fieldProvenance[field]?.provider === "LinkedIn"));
  ok("multi-field: coverage includes every filled field", want.every((field) => c.enrichment?.coverage.includes(field) === true));
  ok("multi-field: status stays partial while email/phone are missing", c.enrichment?.status === "partial");
  ok("multi-field: one provider call covers every wanted field", fixtures.LinkedIn.calls === 1 && result.attempts.length === 1);
}

/* ============================================================================
 * 19. Re-score runs after merge (only when a JobAnalysis is supplied)
 * ========================================================================== */
{
  resetAllFixtures();
  const seed = buildSeedState();
  const campaign = seed.campaigns[0];
  const jd = campaign.jobAnalysis;
  const weights = campaign.scoringWeights;

  fixtures.LinkedIn.enriches = ["email", "skills"];
  fixtures.LinkedIn.result = {
    fields: { email: { value: "jane@acme.com", confidence: 0.9 }, skills: { value: ["Go"] } },
    costUnits: 1,
    status: "ok",
  };
  const candidate = makeCandidate({ matchScore: 0, matchBreakdown: [], techStack: ["Go"] });

  const withJd = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100, jd, weights });
  const expected = scoreCandidate(withJd.candidate, jd, weights);
  ok("rescore: matchBreakdown is populated once a jd is supplied", withJd.candidate.matchBreakdown.length > 0);
  ok("rescore: matchScore matches a direct scoreCandidate call on the enriched candidate", withJd.candidate.matchScore === expected.score);

  resetAllFixtures();
  fixtures.LinkedIn.result = { fields: {}, costUnits: 1, status: "no_data" };
  const candidate2 = makeCandidate({ matchScore: 0, matchBreakdown: [] });
  const withoutJd = await orchestrateEnrichment({ session: fakeSession, candidate: candidate2, want: ["email"], budgetRemaining: 100 });
  ok("rescore: omitting jd leaves matchScore/matchBreakdown untouched", withoutJd.candidate.matchScore === 0 && withoutJd.candidate.matchBreakdown.length === 0);
}

/* ============================================================================
 * 20. Registry sanity on the SHIPPED registry + runner table (vacuous while
 *     no provider is configured; they bite as soon as one is added), plus
 *     direct recordEnrichmentAttempt/computeCoverage checks
 * ========================================================================== */
{
  const shippedIds = SHIPPED_PROVIDERS.map((p) => p.id);
  ok("harness: registry sanity reads the shipped modules, not the fakes", (SHIPPED_PROVIDERS as unknown) !== mockedProviders && (SHIPPED_RUNNERS as unknown) !== mockedRunners);
  ok("registry: provider ids are unique", new Set(shippedIds).size === shippedIds.length);
  ok("registry: every provider has a runner (the orchestrator silently skips one without)", SHIPPED_PROVIDERS.every((p) => typeof SHIPPED_RUNNERS[p.id] === "function"));
  ok("registry: every runner belongs to a registered provider", Object.keys(SHIPPED_RUNNERS).every((id) => shippedIds.some((providerId) => providerId === id)));
  ok("registry: every provider declares at least one enrichable field", SHIPPED_PROVIDERS.every((p) => p.enriches.length > 0));
  ok("registry: every provider declares a finite, non-negative cost", SHIPPED_PROVIDERS.every((p) => Number.isFinite(p.costUnits) && p.costUnits >= 0));
  ok(
    "registry: a candidate lacking every identifying field resolves keyField to null for all providers",
    SHIPPED_PROVIDERS.every((p) => p.keyField(makeCandidate({ linkedinUrl: "", currentCompany: "", externalIds: undefined })) === null),
  );
  // computeCoverage/recordEnrichmentAttempt are exercised directly too (not just via mergeEnrichment).
  // currentCompany blank here: makeCandidate()'s default "Acme Corp" would itself count as
  // the homed "company" field being covered, which would defeat this "truly bare" check.
  const bareCandidate = makeCandidate({ currentCompany: "" });
  const failedAttempt = { provider: "LinkedIn" as const, at: "2026-01-01T00:00:00.000Z", status: "error" as const, fieldsFilled: [], costUnits: 0 };
  const failedCandidate = recordEnrichmentAttempt(bareCandidate, failedAttempt);
  ok("recordEnrichmentAttempt: an error attempt with zero coverage marks the candidate failed", failedCandidate.enrichment?.status === "failed");
  ok("recordEnrichmentAttempt: an error attempt never downgrades a candidate with coverage", recordEnrichmentAttempt(makeCandidate(), failedAttempt).enrichment?.status === "partial");
  ok("computeCoverage: a bare candidate with no data has empty coverage", computeCoverage(bareCandidate).length === 0);
}

console.log(`RESULT enrichment-orchestrator: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
