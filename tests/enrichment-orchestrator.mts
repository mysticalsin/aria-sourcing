// Unit tests for the unified enrichment orchestrator + merge + registry
// (docs/superpowers/plans/2026-07-15-enrichment-orchestrator.md). Mocks every
// provider adapter module (sourcing/apify.ts, apollo.ts, seamless.ts,
// sillage.ts) via node:test's module-mock hooks — no network is ever hit.
// Run with: node --experimental-test-module-mocks --import tsx
// tests/enrichment-orchestrator.mts (mirrors source-apify-auth.mts's style).

import { mock } from "node:test";
import type { Candidate, ComplianceFlags } from "../src/lib/types.ts";

mock.module("server-only", { namedExports: {} });

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

/* ---- mutable fixtures the mocked adapter modules read at call time -------- */

let apifyKey: string | null = "apify_TEST_PLACEHOLDER";
let apifyCalls = 0;
let apifyResult: unknown = { ok: true, status: 200, data: [] };
// When set (only used by the wall-clock-deadline tests, section 8), the
// mocked adapter call advances node:test's mocked `Date`/timers by this many
// (virtual) ms before returning — simulating that this provider's own real
// network round-trip ate into the orchestrator's ORCH_DEADLINE_MS budget,
// without an actual multi-second sleep in the test run.
let apifyTimeAdvanceMs = 0;

let apolloKey: string | null = "apollo_TEST_PLACEHOLDER";
let apolloSearchCalls = 0;
let apolloMatchCalls = 0;
let apolloSearchResult: unknown[] = [];
let apolloMatchResult: unknown = null;
let apolloMatchTimeAdvanceMs = 0;

let seamlessKey: string | null = "seamless_TEST_PLACEHOLDER";
let seamlessSearchCalls = 0;
let seamlessStartCalls = 0;
let seamlessPollCalls = 0;
let seamlessSearchResult: unknown[] = [];
let seamlessStartResult: unknown = { ok: true, status: 200, data: { requestId: "req-1" } };
let seamlessPollResult: unknown = {
  ok: true,
  status: 200,
  data: { requestId: "req-1", status: "done", message: "", contact: null },
};

let sillageKey: string | null = "sillage_TEST_PLACEHOLDER";
let sillageStartCalls = 0;
let sillageStageCalls = 0;
let sillageFindCalls = 0;
let sillageMappingCalls = 0;
let sillageStartResult: unknown = {
  ok: true,
  status: 200,
  data: { status: "accepted", requestId: "req-1", stage: "account_mapping_in_progress" },
};
let sillageStageResult: unknown = {
  ok: true,
  status: 200,
  data: {
    id: "req-1",
    type: "account_mapping",
    stage: "completed",
    createdAt: "",
    updatedAt: "",
    company: { id: "company-1", name: "Acme Corp", domain: "acme.com", linkedinUrl: null },
  },
};
let sillageFindResult: unknown = { ok: true, status: 200, data: "mapping-1" };
let sillageMappingResult: unknown = {
  ok: true,
  status: 200,
  data: { id: "mapping-1", company: { id: "company-1", name: "Acme Corp", domain: "acme.com", linkedinUrl: null }, profiles: [] },
};

function resetAllFixtures() {
  apifyKey = "apify_TEST_PLACEHOLDER";
  apifyCalls = 0;
  apifyResult = { ok: true, status: 200, data: [] };
  apifyTimeAdvanceMs = 0;

  apolloKey = "apollo_TEST_PLACEHOLDER";
  apolloSearchCalls = 0;
  apolloMatchCalls = 0;
  apolloSearchResult = [];
  apolloMatchResult = null;
  apolloMatchTimeAdvanceMs = 0;

  seamlessKey = "seamless_TEST_PLACEHOLDER";
  seamlessSearchCalls = 0;
  seamlessStartCalls = 0;
  seamlessPollCalls = 0;
  seamlessSearchResult = [];
  seamlessStartResult = { ok: true, status: 200, data: { requestId: "req-1" } };
  seamlessPollResult = { ok: true, status: 200, data: { requestId: "req-1", status: "done", message: "", contact: null } };

  sillageKey = "sillage_TEST_PLACEHOLDER";
  sillageStartCalls = 0;
  sillageStageCalls = 0;
  sillageFindCalls = 0;
  sillageMappingCalls = 0;
  sillageStartResult = {
    ok: true,
    status: 200,
    data: { status: "accepted", requestId: "req-1", stage: "account_mapping_in_progress" },
  };
  sillageStageResult = {
    ok: true,
    status: 200,
    data: {
      id: "req-1",
      type: "account_mapping",
      stage: "completed",
      createdAt: "",
      updatedAt: "",
      company: { id: "company-1", name: "Acme Corp", domain: "acme.com", linkedinUrl: null },
    },
  };
  sillageFindResult = { ok: true, status: 200, data: "mapping-1" };
  sillageMappingResult = {
    ok: true,
    status: 200,
    data: { id: "mapping-1", company: { id: "company-1", name: "Acme Corp", domain: "acme.com", linkedinUrl: null }, profiles: [] },
  };
}

/* ---- mock every provider adapter module the runners import ---------------- */

mock.module(moduleUrl("src/lib/sourcing/apify.ts"), {
  namedExports: {
    enrichProfilesByUrl: async (_token: string, _urls: string[]) => {
      apifyCalls++;
      if (apifyTimeAdvanceMs > 0) mock.timers.tick(apifyTimeAdvanceMs);
      return apifyResult;
    },
    resolveStoredApifyKey: async () => apifyKey,
  },
});

mock.module(moduleUrl("src/lib/sourcing/apollo.ts"), {
  namedExports: {
    searchApolloPeople: async (_filters: unknown, _count: number, _apiKey: string) => {
      apolloSearchCalls++;
      return apolloSearchResult;
    },
    matchApolloPerson: async (_apolloId: string, _apiKey: string, _opts: unknown) => {
      apolloMatchCalls++;
      if (apolloMatchTimeAdvanceMs > 0) mock.timers.tick(apolloMatchTimeAdvanceMs);
      return apolloMatchResult;
    },
    resolveStoredApolloKey: async () => apolloKey,
  },
});

mock.module(moduleUrl("src/lib/sourcing/seamless.ts"), {
  namedExports: {
    searchSeamlessContacts: async (_filters: unknown, _count: number, _apiKey: string) => {
      seamlessSearchCalls++;
      return seamlessSearchResult;
    },
    startSeamlessResearch: async (_apiKey: string, _searchResultId: string) => {
      seamlessStartCalls++;
      return seamlessStartResult;
    },
    pollSeamlessResearch: async (_apiKey: string, _requestId: string) => {
      seamlessPollCalls++;
      return seamlessPollResult;
    },
    resolveStoredSeamlessKey: async () => seamlessKey,
  },
});

mock.module(moduleUrl("src/lib/sourcing/sillage.ts"), {
  namedExports: {
    startAccountMapping: async (_apiKey: string, _identifier: unknown) => {
      sillageStartCalls++;
      return sillageStartResult;
    },
    getMappingStage: async (_apiKey: string, _requestId: string) => {
      sillageStageCalls++;
      return sillageStageResult;
    },
    findMappingId: async (_apiKey: string, _company: unknown) => {
      sillageFindCalls++;
      return sillageFindResult;
    },
    getCompanyMapping: async (_apiKey: string, _mappingId: string) => {
      sillageMappingCalls++;
      return sillageMappingResult;
    },
    resolveStoredSillageKey: async () => sillageKey,
  },
});

const { orchestrateEnrichment } = await import("../src/lib/enrichment/orchestrator.ts");
const { mergeEnrichment, recordEnrichmentAttempt, computeCoverage } = await import("../src/lib/enrichment/merge.ts");
const { ENRICHMENT_PROVIDERS } = await import("../src/lib/enrichment/registry.ts");
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
    sourcePlatform: "Apify",
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

// Never a real session — every mocked resolveStored*Key ignores its argument.
const fakeSession = {} as Parameters<typeof orchestrateEnrichment>[0]["session"];

/* ============================================================================
 * 1. Waterfall runs cheapest-first and stops early once `want` is covered
 * ========================================================================== */
{
  resetAllFixtures();
  const candidate = makeCandidate();

  apifyResult = {
    ok: true,
    status: 200,
    data: [
      {
        id: "p1",
        publicIdentifier: "jane-doe",
        linkedinUrl: candidate.linkedinUrl,
        firstName: "Jane",
        lastName: "Doe",
        headline: "Senior Engineer",
        about: "",
        location: null,
        connectionsCount: null,
        followerCount: null,
        currentPosition: [],
        experience: [],
        education: [],
        topSkills: [],
        skills: [],
        languages: [],
        openToWork: false,
        hiring: false,
        premium: false,
        email: "jane@acme.com",
      },
    ],
  };

  const result = await orchestrateEnrichment({
    session: fakeSession,
    candidate,
    want: ["email"],
    budgetRemaining: 100,
  });

  ok("waterfall: Apify (cheapest, cost 1) runs first and fills email", apifyCalls === 1 && result.candidate.email === "jane@acme.com");
  ok(
    "waterfall: stops early — Apollo/Seamless/Sillage never invoked once email is covered",
    apolloSearchCalls === 0 && apolloMatchCalls === 0 && seamlessSearchCalls === 0 && seamlessStartCalls === 0 && sillageStartCalls === 0,
  );
  ok("waterfall: exactly one attempt recorded (no wasted calls)", result.attempts.length === 1);
  ok("waterfall: the one attempt is Apify/ok", result.attempts[0]?.provider === "Apify" && result.attempts[0]?.status === "ok");
  ok("waterfall: spend reflects only the one real provider call", result.spend === 1);
  ok("waterfall: coverage now includes email", result.candidate.enrichment?.coverage.includes("email") === true);
}

/* ============================================================================
 * 2. A provider with no stored key is skipped as not_configured — never throws
 * ========================================================================== */
{
  resetAllFixtures();
  apifyKey = null; // Apify is the only eligible provider (candidate has no company)
  const candidate = makeCandidate({ currentCompany: "" });

  let threw = false;
  let result: Awaited<ReturnType<typeof orchestrateEnrichment>> | null = null;
  try {
    result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });
  } catch {
    threw = true;
  }

  ok("no-key provider: orchestrateEnrichment never throws", threw === false);
  ok("no-key provider: only Apify was eligible (no company -> Apollo/Seamless/Sillage keyField is null)", result?.attempts.length === 1);
  ok("no-key provider: reported status is not_configured, not error", result?.attempts[0]?.status === "not_configured");
  ok("no-key provider: adapter itself was never called", apifyCalls === 0);
  ok("no-key provider: candidate left unchanged", result?.candidate.email === "");
  ok("no-key provider: spend stays zero", result?.spend === 0);
}

/* ============================================================================
 * 3. mergeEnrichment fills only missing/higher-confidence fields, records
 *    fieldProvenance, and does not let a lower-confidence value overwrite a
 *    higher-confidence one already on record.
 * ========================================================================== */
{
  const at1 = "2026-01-01T00:00:00.000Z";
  const at2 = "2026-01-01T00:05:00.000Z";
  const at3 = "2026-01-01T00:10:00.000Z";

  const c0 = makeCandidate({ email: "" });
  ok("merge: fresh candidate has no enrichment state yet (unenriched)", c0.enrichment === undefined);

  const c1 = mergeEnrichment(c0, "Apollo", { email: { value: "a@x.com", confidence: 0.5 } }, at1);
  ok("merge: first provider fills the missing email field", c1.email === "a@x.com");
  ok("merge: provenance records the filling provider + confidence", c1.enrichment?.fieldProvenance.email?.provider === "Apollo" && c1.enrichment?.fieldProvenance.email?.confidence === 0.5);
  ok("merge: status is partial (email only, phone still missing)", c1.enrichment?.status === "partial");

  const c2 = mergeEnrichment(c1, "Seamless", { email: { value: "b@x.com", confidence: 0.3 } }, at2);
  ok("merge: a lower-confidence value does NOT overwrite an already-covered field", c2.email === "a@x.com");
  ok("merge: provenance still attributes the field to the original (higher-confidence) provider", c2.enrichment?.fieldProvenance.email?.provider === "Apollo");
  ok("merge: the losing attempt is still recorded as no_data (nothing filled)", c2.enrichment?.attempts[c2.enrichment.attempts.length - 1]?.status === "no_data");

  const c3 = mergeEnrichment(c2, "Sillage", { email: { value: "c@x.com", confidence: 0.9 } }, at3);
  ok("merge: a higher-confidence value DOES overwrite an already-covered field", c3.email === "c@x.com");
  ok("merge: provenance now attributes the field to the new, higher-confidence provider", c3.enrichment?.fieldProvenance.email?.provider === "Sillage" && c3.enrichment?.fieldProvenance.email?.confidence === 0.9);

  // A value with no confidence at all never beats an already-recorded confident field.
  const c4 = mergeEnrichment(c3, "Apollo", { email: { value: "d@x.com" } }, at3);
  ok("merge: an unconfident new value never overwrites a confident stored one", c4.email === "c@x.com" && c4.enrichment?.fieldProvenance.email?.provider === "Sillage");

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

  const cOverwritten = mergeEnrichment(cPreFilled, "Apollo", { email: { value: "confident@x.com", confidence: 0.9 } }, at1);
  ok(
    "merge: a confident new value DOES overwrite a covered field with no recorded confidence (treated as 0)",
    cOverwritten.email === "confident@x.com" && cOverwritten.enrichment?.fieldProvenance.email?.provider === "Apollo",
  );

  const cNotOverwritten = mergeEnrichment(cPreFilled, "Apollo", { email: { value: "unconfident@x.com" } }, at1);
  ok(
    "merge: an unconfident new value does NOT overwrite a covered field when both default to 0 confidence",
    cNotOverwritten.email === "existing@x.com",
  );

  /* ---- coverage/status transitions: unenriched -> partial -> enriched ---- */
  ok("status transition: unenriched -> partial happened at c1", c1.enrichment?.status === "partial");
  const c5 = mergeEnrichment(c3, "Apollo", { phone: { value: "+15551234567", confidence: 0.7 } }, at3);
  ok("status transition: partial -> enriched once both email and phone are covered", c5.enrichment?.status === "enriched");
  ok("status transition: coverage lists both email and phone", (c5.enrichment?.coverage ?? []).includes("email") && (c5.enrichment?.coverage ?? []).includes("phone"));
}

/* ============================================================================
 * 4. Budget exhaustion yields budget_exceeded attempts and halts paid calls
 * ========================================================================== */
{
  resetAllFixtures();
  const candidate = makeCandidate();

  apifyResult = {
    ok: true,
    status: 200,
    data: [
      {
        id: "p1",
        publicIdentifier: "jane-doe",
        linkedinUrl: candidate.linkedinUrl,
        firstName: "Jane",
        lastName: "Doe",
        headline: "",
        about: "",
        location: null,
        connectionsCount: null,
        followerCount: null,
        currentPosition: [],
        experience: [],
        education: [],
        topSkills: [],
        skills: [],
        languages: [],
        openToWork: false,
        hiring: false,
        premium: false,
        email: "jane@acme.com", // email only — phone stays missing, forcing the waterfall onward
      },
    ],
  };

  // Exactly enough budget for Apify's one real call (costUnits 1) and nothing else.
  const result = await orchestrateEnrichment({
    session: fakeSession,
    candidate,
    want: ["email", "phone"],
    budgetRemaining: 1,
  });

  ok("budget: Apify still runs (budget available) and fills email", apifyCalls === 1 && result.candidate.email === "jane@acme.com");
  ok(
    "budget: every subsequent paid provider (Apollo, Seamless, Sillage) is recorded budget_exceeded",
    result.attempts.filter((a) => a.status === "budget_exceeded").length === 3,
  );
  ok(
    "budget: the exhausted providers' adapters are never actually invoked",
    apolloSearchCalls === 0 && apolloMatchCalls === 0 && seamlessSearchCalls === 0 && seamlessStartCalls === 0 && sillageStartCalls === 0,
  );
  ok("budget: total attempts is Apify-ok + 3 budget_exceeded", result.attempts.length === 4);
  ok("budget: spend reflects only the real call that ran, never a budget_exceeded skip", result.spend === 1);
  ok("budget: phone stays uncovered (nothing more could run)", result.candidate.enrichment?.coverage.includes("phone") === false);
}

/* ============================================================================
 * 5. Cross-provider identity resolution: Apollo resolves its own apolloId
 *    from name+company (free search) then enriches, and the orchestrator
 *    records the resolved externalId back onto the candidate.
 * ========================================================================== */
{
  resetAllFixtures();
  apifyKey = null; // candidate has no linkedinUrl anyway (irrelevant to Apollo path)
  seamlessKey = null; // isolates the assertions to Apollo's own call counters
  sillageKey = null;

  const candidate = makeCandidate({ linkedinUrl: "" });

  apolloSearchResult = [
    {
      id: "apollo-123",
      name: "Jane Doe",
      title: "Senior Engineer",
      company: "Acme Corp",
      linkedinUrl: "",
      city: "",
      state: "",
      country: "",
      headline: "",
      seniority: "",
      departments: [],
    },
  ];
  apolloMatchResult = { email: "jane@acme.com", phone: "+15551234567" };

  const result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });

  ok("cross-provider: Apollo's free search step ran to resolve an id", apolloSearchCalls === 1);
  ok("cross-provider: Apollo's paid match step ran with the resolved id", apolloMatchCalls === 1);
  ok("cross-provider: email filled via the resolved Apollo identity", result.candidate.email === "jane@acme.com");
  ok("cross-provider: the resolved apolloId is recorded onto externalIds for future re-enrichment", result.candidate.externalIds?.Apollo === "apollo-123");
  ok("cross-provider: waterfall still stops once email is covered", result.attempts.length === 1);
}

/* ============================================================================
 * 6. Re-score runs after merge (only when a JobAnalysis is supplied)
 * ========================================================================== */
{
  resetAllFixtures();
  const seed = buildSeedState();
  const campaign = seed.campaigns[0];
  const jd = campaign.jobAnalysis;
  const weights = campaign.scoringWeights;

  const candidate = makeCandidate({ matchScore: 0, matchBreakdown: [], techStack: ["Go"] });

  apifyResult = {
    ok: true,
    status: 200,
    data: [
      {
        id: "p1",
        publicIdentifier: "jane-doe",
        linkedinUrl: candidate.linkedinUrl,
        firstName: "Jane",
        lastName: "Doe",
        headline: "Senior Engineer",
        about: "",
        location: null,
        connectionsCount: null,
        followerCount: null,
        currentPosition: [],
        experience: [],
        education: [],
        topSkills: ["Go"],
        skills: ["Go"],
        languages: [],
        openToWork: false,
        hiring: false,
        premium: false,
        email: "jane@acme.com",
      },
    ],
  };

  const withJd = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100, jd, weights });
  const expected = scoreCandidate(withJd.candidate, jd, weights);
  ok("rescore: matchBreakdown is populated once a jd is supplied", withJd.candidate.matchBreakdown.length > 0);
  ok("rescore: matchScore matches a direct scoreCandidate call on the enriched candidate", withJd.candidate.matchScore === expected.score);

  resetAllFixtures();
  const candidate2 = makeCandidate({ matchScore: 0, matchBreakdown: [] });
  apifyResult = { ok: true, status: 200, data: [] };
  const withoutJd = await orchestrateEnrichment({ session: fakeSession, candidate: candidate2, want: ["email"], budgetRemaining: 100 });
  ok("rescore: omitting jd leaves matchScore/matchBreakdown untouched", withoutJd.candidate.matchScore === 0 && withoutJd.candidate.matchBreakdown.length === 0);
}

/* ============================================================================
 * 7. Registry sanity: every provider is ordered cheapest-first and declares a
 *    coherent keyField/enriches shape (guards the waterfall's core assumption)
 * ========================================================================== */
{
  const sorted = [...ENRICHMENT_PROVIDERS].sort((a, b) => a.costUnits - b.costUnits);
  ok("registry: Apify is the cheapest provider (runs first in the waterfall)", sorted[0]?.id === "Apify");
  ok("registry: every provider declares at least one enrichable field", ENRICHMENT_PROVIDERS.every((p) => p.enriches.length > 0));
  ok(
    "registry: a candidate lacking every identifying field resolves keyField to null for all providers",
    ENRICHMENT_PROVIDERS.every((p) => p.keyField(makeCandidate({ linkedinUrl: "", currentCompany: "", externalIds: undefined })) === null),
  );
  // computeCoverage/recordEnrichmentAttempt are exercised directly too (not just via mergeEnrichment).
  // currentCompany blank here: makeCandidate()'s default "Acme Corp" would itself count as
  // the homed "company" field being covered, which would defeat this "truly bare" check.
  const bareCandidate = makeCandidate({ currentCompany: "" });
  const failedAttempt = { provider: "Apollo" as const, at: "2026-01-01T00:00:00.000Z", status: "error" as const, fieldsFilled: [], costUnits: 0 };
  const failedCandidate = recordEnrichmentAttempt(bareCandidate, failedAttempt);
  ok("recordEnrichmentAttempt: an error attempt with zero coverage marks the candidate failed", failedCandidate.enrichment?.status === "failed");
  ok("computeCoverage: a bare candidate with no data has empty coverage", computeCoverage(bareCandidate).length === 0);
}

/* ============================================================================
 * 8. Wall-clock deadline: a request that's run long enough defers whatever
 *    hasn't started yet rather than risk the platform's 60s route timeout —
 *    cheap providers that already ran keep their spend/results, only
 *    not-yet-started providers are ever deferred. Uses node:test's mocked
 *    Date/timers (via the apify/apollo mocks' *TimeAdvanceMs hooks above) to
 *    simulate elapsed wall-clock time instantly, without real multi-second
 *    sleeps in the test run.
 * ========================================================================== */
{
  // 8a. The hard deadline (elapsed >= ORCH_DEADLINE_MS) defers EVERY
  // subsequent provider, even a cheap/sync one (Apollo) that hasn't started —
  // not just the slow async pollers.
  resetAllFixtures();
  mock.timers.enable({ apis: ["Date", "setTimeout"] });
  try {
    const candidate = makeCandidate();
    apifyResult = { ok: true, status: 200, data: [] }; // no profile -> email stays uncovered, waterfall continues
    apifyTimeAdvanceMs = 46_000; // simulate Apify's own call consuming the whole wall-clock deadline

    const result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });

    ok("deadline: the provider already running before the deadline still completes", apifyCalls === 1);
    ok(
      "deadline: every provider after the deadline is exceeded is deferred, including cheap/sync Apollo",
      result.attempts.filter((a) => a.status === "deferred").length === 3,
    );
    ok(
      "deadline: deferred providers never start a single network call",
      apolloSearchCalls === 0 && apolloMatchCalls === 0 && seamlessSearchCalls === 0 && seamlessStartCalls === 0 && sillageStartCalls === 0,
    );
    ok(
      "deadline: deferred attempts carry the re-run detail message",
      result.attempts.filter((a) => a.status === "deferred").every((a) => a.detail === "time budget — re-run to continue"),
    );
    ok("deadline: total attempts is Apify(no_data) + 3 deferred", result.attempts.length === 4);
  } finally {
    mock.timers.reset();
  }

  // 8b. Once the cheap providers have run but a slow async poller (Seamless,
  // Sillage) no longer has enough remaining runway to finish even one poll
  // cycle, it's deferred pre-flight — never invoked — while the earlier
  // cheap provider's real result/spend is preserved intact (no lost spend).
  resetAllFixtures();
  mock.timers.enable({ apis: ["Date", "setTimeout"] });
  try {
    // No linkedinUrl -> Apify is ineligible (isolates this scenario to
    // Apollo/Seamless/Sillage, same isolation trick as scenario 5 above).
    const candidate = makeCandidate({ linkedinUrl: "" });
    apolloSearchResult = [
      {
        id: "apollo-999",
        name: "Jane Doe",
        title: "",
        company: "Acme Corp",
        linkedinUrl: "",
        city: "",
        state: "",
        country: "",
        headline: "",
        seniority: "",
        departments: [],
      },
    ];
    apolloMatchResult = { email: "jane@apollo.com", phone: null }; // fills email, leaves phone missing so the waterfall continues
    apolloMatchTimeAdvanceMs = 20_000; // simulate Apollo's real call latency eating into the wall-clock budget

    const result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email", "phone"], budgetRemaining: 100 });

    ok(
      "deadline: the cheap provider (Apollo) still runs to completion and its filled data is preserved",
      apolloMatchCalls === 1 && result.candidate.email === "jane@apollo.com",
    );
    ok(
      "deadline: both slow async pollers are deferred once remaining time can't cover their poll budget",
      result.attempts.filter((a) => a.status === "deferred" && (a.provider === "Seamless" || a.provider === "Sillage")).length === 2,
    );
    ok(
      "deadline: the deferred slow pollers' adapters were never invoked",
      seamlessSearchCalls === 0 && seamlessStartCalls === 0 && sillageStartCalls === 0,
    );
    ok("deadline: spend reflects only the cheap provider's real call — nothing already spent is lost", result.spend === 1);
  } finally {
    mock.timers.reset();
  }
}

console.log(`RESULT enrichment-orchestrator: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
