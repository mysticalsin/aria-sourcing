// Unit tests for the unified enrichment orchestrator + merge + registry.
// Mocks the provider adapter module (sourcing/apify.ts) via node:test's
// module-mock hooks — no network is ever hit.
// Run with: node --experimental-test-module-mocks --import tsx
// tests/enrichment-orchestrator.mts (mirrors source-apify-auth.mts's style).

import { mock } from "node:test";
import type { Candidate, ComplianceFlags } from "../src/lib/types.ts";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/supabase/server.ts"), {
  namedExports: {
    getServiceSupabase: () => ({
      rpc: async (name: string) => {
        if (name === "claim_enrichment_budget") return { data: { allowed: true, ledger_id: "ledger-1" }, error: null };
        if (name === "settle_enrichment_spend") return { data: { ok: true }, error: null };
        if (name === "release_enrichment_claim") return { data: { ok: true }, error: null };
        return { data: null, error: null };
      },
    }),
  },
});

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- mutable fixtures the mocked adapter module reads at call time --------- */

let apifyKey: string | null = "apify_TEST_PLACEHOLDER";
let apifyCalls = 0;
let apifyResult: unknown = { ok: true, status: 200, data: [] };

function resetAllFixtures() {
  apifyKey = "apify_TEST_PLACEHOLDER";
  apifyCalls = 0;
  apifyResult = { ok: true, status: 200, data: [] };
}

/* ---- mock the provider adapter module the runners import ------------------ */

mock.module(moduleUrl("src/lib/sourcing/apify.ts"), {
  namedExports: {
    enrichProfilesByUrl: async (_token: string, _urls: string[]) => {
      apifyCalls++;
      return apifyResult;
    },
    resolveStoredApifyKey: async () => apifyKey,
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
const fakeSession = {
  rpc: async (name: string) => {
    if (name === "current_workspace_id") return { data: "workspace-1", error: null };
    return { data: null, error: null };
  },
} as unknown as Parameters<typeof orchestrateEnrichment>[0]["session"];

/* ============================================================================
 * 1. Apify fills the wanted field in one call
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
  apifyKey = null; 
  const candidate = makeCandidate({ currentCompany: "" });

  let threw = false;
  let result: Awaited<ReturnType<typeof orchestrateEnrichment>> | null = null;
  try {
    result = await orchestrateEnrichment({ session: fakeSession, candidate, want: ["email"], budgetRemaining: 100 });
  } catch {
    threw = true;
  }

  ok("no-key provider: orchestrateEnrichment never throws", threw === false);
  ok("no-key provider: exactly one attempt is recorded", result?.attempts.length === 1);
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

  const c1 = mergeEnrichment(c0, "Apify", { email: { value: "a@x.com", confidence: 0.5 } }, at1);
  ok("merge: first provider fills the missing email field", c1.email === "a@x.com");
  ok("merge: provenance records the filling provider + confidence", c1.enrichment?.fieldProvenance.email?.provider === "Apify" && c1.enrichment?.fieldProvenance.email?.confidence === 0.5);
  ok("merge: status is partial (email only, phone still missing)", c1.enrichment?.status === "partial");

  const c2 = mergeEnrichment(c1, "GitHub", { email: { value: "b@x.com", confidence: 0.3 } }, at2);
  ok("merge: a lower-confidence value does NOT overwrite an already-covered field", c2.email === "a@x.com");
  ok("merge: provenance still attributes the field to the original (higher-confidence) provider", c2.enrichment?.fieldProvenance.email?.provider === "Apify");
  ok("merge: the losing attempt is still recorded as no_data (nothing filled)", c2.enrichment?.attempts[c2.enrichment.attempts.length - 1]?.status === "no_data");

  const c3 = mergeEnrichment(c2, "LinkedIn", { email: { value: "c@x.com", confidence: 0.9 } }, at3);
  ok("merge: a higher-confidence value DOES overwrite an already-covered field", c3.email === "c@x.com");
  ok("merge: provenance now attributes the field to the new, higher-confidence provider", c3.enrichment?.fieldProvenance.email?.provider === "LinkedIn" && c3.enrichment?.fieldProvenance.email?.confidence === 0.9);

  // A value with no confidence at all never beats an already-recorded confident field.
  const c4 = mergeEnrichment(c3, "Apify", { email: { value: "d@x.com" } }, at3);
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

  const cOverwritten = mergeEnrichment(cPreFilled, "Apify", { email: { value: "confident@x.com", confidence: 0.9 } }, at1);
  ok(
    "merge: a confident new value DOES overwrite a covered field with no recorded confidence (treated as 0)",
    cOverwritten.email === "confident@x.com" && cOverwritten.enrichment?.fieldProvenance.email?.provider === "Apify",
  );

  const cNotOverwritten = mergeEnrichment(cPreFilled, "Apify", { email: { value: "unconfident@x.com" } }, at1);
  ok(
    "merge: an unconfident new value does NOT overwrite a covered field when both default to 0 confidence",
    cNotOverwritten.email === "existing@x.com",
  );

  /* ---- coverage/status transitions: unenriched -> partial -> enriched ---- */
  ok("status transition: unenriched -> partial happened at c1", c1.enrichment?.status === "partial");
  const c5 = mergeEnrichment(c3, "Apify", { phone: { value: "+15551234567", confidence: 0.7 } }, at3);
  ok("status transition: partial -> enriched once both email and phone are covered", c5.enrichment?.status === "enriched");
  ok("status transition: coverage lists both email and phone", (c5.enrichment?.coverage ?? []).includes("email") && (c5.enrichment?.coverage ?? []).includes("phone"));
}

/* ============================================================================
 * 4. Budget exhaustion yields a budget_exceeded attempt and no paid call
 * ========================================================================== */
{
  resetAllFixtures();
  const result = await orchestrateEnrichment({
    session: fakeSession,
    candidate: makeCandidate(),
    want: ["email"],
    budgetRemaining: 0,
  });
  ok("budget: the adapter is never invoked without budget", apifyCalls === 0);
  ok("budget: the skipped provider is recorded budget_exceeded", result.attempts[0]?.status === "budget_exceeded");
  ok("budget: spend stays zero", result.spend === 0);
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
  const failedAttempt = { provider: "Apify" as const, at: "2026-01-01T00:00:00.000Z", status: "error" as const, fieldsFilled: [], costUnits: 0 };
  const failedCandidate = recordEnrichmentAttempt(bareCandidate, failedAttempt);
  ok("recordEnrichmentAttempt: an error attempt with zero coverage marks the candidate failed", failedCandidate.enrichment?.status === "failed");
  ok("computeCoverage: a bare candidate with no data has empty coverage", computeCoverage(bareCandidate).length === 0);
}

console.log(`RESULT enrichment-orchestrator: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
