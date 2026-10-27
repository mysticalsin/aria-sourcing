import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";
import { buildSeedState } from "../src/lib/seed.ts";
import { scoreCandidate } from "../src/lib/scoring.ts";
import type { Candidate, HermesState } from "../src/lib/types.ts";
import type { OrchestrateEnrichmentInput } from "../src/lib/enrichment/orchestrator.ts";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;
let state: HermesState;
let role = "member";
let signedIn = true;
let calls = 0;
let reads = 0;
let changeDuringCall: (() => void) | undefined;
let lastInput: OrchestrateEnrichmentInput | undefined;
let failProvider = false;
let throwProvider = false;
let prodBlock: Response | null = null;
let connected = true;
const session = {
  auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-1" } : null } }) },
  rpc: async (fn: string) => ({ data: fn === "current_profile_role" ? role : "workspace-1", error: null }),
  from: (table: string) => {
    assert.equal(table, "workspace_state");
    return { select: () => ({ eq: (field: string, id: string) => {
      assert.equal(field, "workspace_id"); assert.equal(id, "workspace-1");
      return { single: async () => { reads++; return { data: { state: structuredClone(state) }, error: null }; } };
    } }) };
  },
};
mock.module(moduleUrl("src/lib/supabase/config.ts"), { namedExports: {
  get supabaseEnabled() { return connected; }, prodFailClosed: () => prodBlock,
} });
mock.module(moduleUrl("src/lib/supabase/server.ts"), { namedExports: { getServerSupabase: async () => session } });
mock.module(moduleUrl("src/lib/rate-limit.ts"), { namedExports: {
  checkRateLimit: () => ({ ok: true }), rateLimitKey: () => "fixture", tooManyRequests: () => new Response(null, { status: 429 }),
} });
mock.module(moduleUrl("src/lib/enrichment/orchestrator.ts"), { namedExports: {
  orchestrateEnrichment: async (input: OrchestrateEnrichmentInput) => {
    calls++; lastInput = input;
    if (throwProvider) throw new Error("private upstream content");
    const candidate: Candidate = { ...input.candidate,
      experience: ["Engineer @ Fixture (2020-present)"], education: ["Fixture university"], languages: ["French"],
      techStack: ["Go", "Kubernetes"],
    };
    const scored = scoreCandidate(candidate, input.jd!, input.weights);
    candidate.matchScore = scored.score; candidate.matchBreakdown = scored.breakdown;
    changeDuringCall?.();
    return { candidate, attempts: [{ provider: "Apify", at: new Date().toISOString(), status: failProvider ? "error" : "ok", fieldsFilled: failProvider ? [] : ["skills", "experience", "education", "languages"], costUnits: 1, detail: failProvider ? "Provider refused the request." : undefined }], spend: 1 };
  },
} });
const { POST } = await import("../src/app/api/source/enrich/route.ts");
function reset() {
  state = buildSeedState();
  state.campaigns[0].status = "Sourcing";
  Object.assign(state.campaigns[0].jobAnalysis, { title: "Backend Engineer", requiredSkills: ["Go", "Kubernetes"], seniority: "Senior", locationType: "Remote", employmentType: "Full-time" });
  state.candidates = [{ ...state.candidates[0], id: "cand-1", campaignId: state.campaigns[0].id, stage: "Sourced", provenance: "live", yearsExperience: null, matchScore: 1, techStack: [], email: "", experience: undefined, education: undefined, languages: undefined,
    complianceFlags: { doNotContact: false, suppressed: false, unsubscribed: false, anonymized: false, gdprExportRequested: false, suppressedUntil: null } }];
  role = "member"; signedIn = true; calls = 0; reads = 0; changeDuringCall = undefined; failProvider = false; throwProvider = false; prodBlock = null; connected = true;
}
const body = (extra = {}) => ({ candidateId: "cand-1", want: ["skills", "experience"], ...extra });
const req = (data = body(), origin = "http://localhost") => new NextRequest("http://localhost/api/source/enrich", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(data) });

test("authority and input guards run before any paid provider work", async () => {
  reset(); prodBlock = new Response(null, { status: 503 }); assert.equal((await POST(req())).status, 503);
  reset(); signedIn = false; assert.equal((await POST(req())).status, 401);
  reset(); role = "viewer"; assert.equal((await POST(req())).status, 403);
  reset(); assert.equal((await POST(req(body(), "https://other.example"))).status, 403);
  reset(); assert.equal((await POST(req(body({ want: [] })))).status, 400);
  reset(); assert.equal((await POST(req(body({ candidateId: "foreign-candidate" })))).status, 404);
  reset(); assert.equal((await POST(req(body({ candidate: { id: "cand-1", linkedinUrl: "https://linkedin.com/in/forged" } })))).status, 400);
  assert.equal(calls, 0);
});

test("excluded candidates and inactive/incomplete campaigns never call the provider", async () => {
  for (const flag of ["doNotContact", "suppressed", "unsubscribed", "anonymized"] as const) {
    reset(); state.candidates[0].complianceFlags[flag] = true;
    assert.equal((await POST(req())).status, 409, flag); assert.equal(calls, 0);
  }
  for (const stage of ["Rejected", "Suppressed", "Hired"] as const) {
    reset(); state.candidates[0].stage = stage;
    assert.equal((await POST(req())).status, 409, stage); assert.equal(calls, 0);
  }
  reset(); state.candidates[0].provenance = "synthetic"; assert.equal((await POST(req())).status, 409); assert.equal(calls, 0);
  reset(); state.campaigns[0].status = "Paused"; assert.equal((await POST(req())).status, 409); assert.equal(calls, 0);
  reset(); state.campaigns[0].jobAnalysis.employmentType = "Unspecified"; assert.equal((await POST(req())).status, 409); assert.equal(calls, 0);
});

test("saved identity and brief drive enrichment; full richness and updated score cross the boundary", async () => {
  reset(); const response = await POST(req()); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(calls, 1); assert.equal(reads, 2);
  assert.equal(lastInput?.candidate.yearsExperience, null);
  assert.equal(lastInput?.candidate.linkedinUrl, state.candidates[0].linkedinUrl);
  assert.deepEqual(lastInput?.jd, state.campaigns[0].jobAnalysis);
  assert.deepEqual(result.patch.languages, ["French"]); assert.equal(result.patch.experience.length, 1); assert.equal(result.patch.education.length, 1);
  assert.ok(result.patch.matchScore > 1); assert.equal(result.patch.stage, undefined); assert.equal(result.patch.yearsExperience, undefined);
  assert.equal(result.outcome.ok, true); assert.equal(response.headers.get("cache-control"), "no-store");
});

test("only budget hints are accepted, with a bounded server ceiling", async () => {
  for (const [value, expected] of [[undefined, 10], [5, 5], [999, 10]] as const) {
    reset(); await POST(req(body({ budgetRemaining: value }))); assert.equal(lastInput?.budgetRemaining, expected);
  }
});

test("provider errors remain distinct from completed no-data responses and arbitrary errors stay private", async () => {
  reset(); failProvider = true; const error = await (await POST(req())).json();
  assert.equal(error.ok, true); assert.equal(error.outcome.ok, false); assert.equal(error.attempts[0].status, "error");
  reset(); throwProvider = true; const response = await POST(req()); assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private upstream content/);
});

test("concurrent erasure, role revocation, evidence and campaign edits invalidate the result", async () => {
  for (const change of [
    () => { state.candidates = []; },
    () => { role = "viewer"; },
    () => { state.candidates[0].complianceFlags.doNotContact = true; },
    () => { state.candidates[0].linkedinUrl = "https://linkedin.com/in/new-fixture"; },
    () => { state.campaigns[0].jobAnalysis.requiredSkills = ["Rust"]; },
  ]) {
    reset(); changeDuringCall = change;
    const response = await POST(req()); assert.equal(response.status, 409); assert.equal(calls, 1);
    assert.equal((await response.json()).patch, undefined);
  }
  reset(); changeDuringCall = () => { state.candidates[0].notes = [{ id: "note", text: "Concurrent recruiter note", at: new Date().toISOString() }]; };
  assert.equal((await POST(req())).status, 200);
});
