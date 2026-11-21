import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { buildSeedState } from "../src/lib/seed";
import type { Candidate } from "../src/lib/types";
import type { SearchHit } from "../src/lib/sourcing/web-leads";
import { shortlistIdentity } from "../src/lib/sourcing/shortlist-preview";
import { campaignSourcingBasis, orderedSteps, jobStatus, publicSourcingJob, SourcePlanSchema, SOURCE_LABELS, type CampaignSourcingJob, type SourceStep } from "../src/lib/sourcing/unified-contract";
import type { UnifiedRunRepository, UnifiedProviders } from "../src/lib/sourcing/unified-run";
mock.module("server-only", { namedExports: {} });
const { advanceUnifiedRun } = await import("../src/lib/sourcing/unified-run");

// LinkedIn profiles come from Claude's web search (Apify was retired by the
// owner on 2026-11-06); GitHub complements them.
function fixture(steps?: SourceStep[]) {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  campaign.status = "Sourcing";
  state.candidates = []; state.bookings = []; state.outreach = [];
  const query = campaign.jobAnalysis.requiredSkills[0];
  const job: CampaignSourcingJob = { id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), actor_id: crypto.randomUUID(),
    campaign_id: campaign.id, campaign_snapshot: campaignSourcingBasis(campaign), status: "active",
    steps: steps ?? orderedSteps([{ source: "GitHub", query, limit: 3 }, { source: "WebSearch", query, limit: 3 }]),
    revision: 0, claim_token: null, claim_until: null, created_at: new Date().toISOString() };
  let ws = { state, updatedAt: "v1" };
  let stored = structuredClone(job);
  let searches = 0, githubCalls = 0, reservations = 0, conflicts = 0;
  const hit: SearchHit = { title: "Aria Fixture - Backend Engineer - Fixture Co | LinkedIn", url: "https://www.linkedin.com/in/aria-fixture/", snippet: query };
  const repo: UnifiedRunRepository = {
    readWorkspace: async () => structuredClone(ws),
    claim: async (claim, token, claimed) => {
      if (claim.revision !== stored.revision) return false;
      stored.steps = structuredClone(claimed); stored.revision++; stored.claim_token = token; stored.claim_until = new Date(Date.now() + 180_000).toISOString(); return true;
    },
    bind: async (_j, token, bound) => { assert.equal(stored.claim_token, token); stored.steps = structuredClone(bound); },
    reserve: async () => { reservations++; return "receipt-id"; },
    settle: async () => {},
    finish: async (_j, token, finished, expected, next) => {
      assert.equal(stored.claim_token, token);
      if (conflicts > 0) { conflicts--; return "conflict"; }
      if (expected.updatedAt !== ws.updatedAt) return "conflict";
      if (next) ws = { state: structuredClone(next), updatedAt: `v${stored.revision}` };
      stored.steps = structuredClone(finished); stored.status = jobStatus(finished); stored.claim_token = null; stored.claim_until = null; stored.revision++;
      return "saved";
    },
  };
  const providers: UnifiedProviders = {
    github: async () => { githubCalls++; return [{ login: "aria-other-fixture", name: "Other Fixture", email: null, company: null, location: null, bio: query, blog: null, htmlUrl: "https://github.com/aria-other-fixture", publicRepos: 2, followers: 1, createdAt: null, topLanguage: null }]; },
    webSearch: async () => { searches++; return { ok: true, hits: [hit, { ...hit, url: "https://linkedin.com/in/aria-fixture?trk=search" }] }; },
  };
  return { job: () => structuredClone(stored), ws: () => ws, repo, providers, hit, query,
    counts: () => ({ searches, githubCalls, reservations }), conflict: () => { conflicts++; },
    expire: () => { stored.claim_until = new Date(0).toISOString(); },
    mutateState: (candidate: Candidate) => { ws.state.candidates.push(candidate); ws.updatedAt += "x"; } };
}

test("source plan rejects duplicates, unbounded limits, caller-owned authority and the retired Apify source", () => {
  assert.equal(SourcePlanSchema.safeParse([{ source: "WebSearch", query: "Go", limit: 51 }]).success, false);
  assert.equal(SourcePlanSchema.safeParse([{ source: "WebSearch", query: "Go", limit: 2, datasetId: "injected" }]).success, false);
  assert.equal(SourcePlanSchema.safeParse([{ source: "GitHub", query: "Go", limit: 2 }, { source: "GitHub", query: "Go", limit: 2 }]).success, false);
  assert.equal(SourcePlanSchema.safeParse([{ source: "LinkedIn", query: "Go", limit: 2 }]).success, false, "LinkedIn via Apify can no longer be planned");
  assert.equal(SourcePlanSchema.safeParse([{ source: "WebSearch", query: "Go", limit: 2 }, { source: "GitHub", query: "Go", limit: 2 }]).success, true);
});
test("shortlist identities obey confidentiality and the existing outreach-purpose policy", () => {
  const candidate = { ...buildSeedState().candidates[0], stage: "Sourced" as const,
    name: "Aria Confidential Fixture", linkedinUrl: "https://linkedin.com/in/aria-private-fixture", githubUrl: "" };
  const masked = shortlistIdentity(candidate, true);
  assert.notEqual(masked.name, candidate.name);
  assert.equal(masked.profileUrl, "");
  assert.equal(shortlistIdentity(candidate, false).profileUrl, candidate.linkedinUrl);
  assert.equal(shortlistIdentity({ ...candidate, stage: "Contacted" }, true).name, candidate.name);
  const photo = { ...candidate, avatarUrl: "https://cdn.example.test/photo.jpg" };
  assert.equal(shortlistIdentity(photo, true).display.avatarUrl, undefined, "a masked candidate shows no photo");
  assert.equal(shortlistIdentity(photo, false).display.avatarUrl, photo.avatarUrl);
  assert.equal(shortlistIdentity(candidate, false).profileLabel, "LinkedIn");
  assert.equal(shortlistIdentity({ ...candidate, linkedinUrl: "", githubUrl: "https://github.com/x" }, false).profileLabel, "GitHub");
});
test("web search first, refresh recovery, authoritative dedupe and saved GitHub complement", async () => {
  const f = fixture();
  assert.equal(f.job().steps[0].source, "WebSearch");
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.deepEqual([f.job().steps[0].status, f.job().steps[0].found, f.job().steps[0].added, f.job().steps[0].duplicates], ["completed", 2, 1, 1]);
  assert.equal(f.counts().searches, 1); assert.equal(f.counts().githubCalls, 0);
  assert.equal(f.ws().state.candidates[0].linkedinUrl, "https://www.linkedin.com/in/aria-fixture");
  assert.equal(f.ws().state.candidates[0].email, "");
  // Reconstructing from the repository is the refresh path; no browser IDs.
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "completed"); assert.equal(f.ws().state.candidates.length, 2);
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.counts().searches, 1); assert.equal(f.counts().githubCalls, 1);
  const dto = publicSourcingJob(f.job(), f.job().actor_id);
  assert.doesNotMatch(JSON.stringify(dto), /receipt-id|campaign_snapshot|workspace_id/);
});
test("simultaneous polling claims at most one paid web search", async () => {
  const f = fixture(); const same = f.job();
  await Promise.all([advanceUnifiedRun(same, f.repo, f.providers), advanceUnifiedRun(same, f.repo, f.providers)]);
  assert.equal(f.counts().searches, 1); assert.equal(f.counts().reservations, 1);
});
test("a crash during a paid web search does not search again after the lease expires; the next source still runs", async () => {
  const f = fixture();
  const bind = f.repo.bind;
  f.repo.bind = async () => { throw new Error("process stopped after the search was reserved"); };
  await assert.rejects(advanceUnifiedRun(f.job(), f.repo, f.providers));
  f.repo.bind = bind;
  f.expire();
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.counts().searches, 0); assert.equal(f.job().steps[0].status, "uncertain");
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "partial"); assert.equal(f.counts().githubCalls, 1);
});
test("state conflict remaps and dedupes against the latest persisted candidates", async () => {
  const f = fixture();
  const finish = f.repo.finish; let first = true;
  f.repo.finish = async (...args) => {
    if (first && args[4]) { first = false; const candidate = args[4].candidates[0]; f.mutateState(candidate); return "conflict"; }
    return finish(...args);
  };
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.ws().state.candidates.length, 1);
  assert.equal(f.job().steps[0].added, 0); assert.equal(f.job().steps[0].duplicates, 2);
});
test("a failed web search stays explicit and does not swallow GitHub results", async () => {
  const f = fixture(); f.providers.webSearch = async () => ({ ok: false, error: "Add an Anthropic key in Settings before searching the web." });
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().steps[0].status, "failed"); assert.match(f.job().steps[0].error!, /Anthropic key/);
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "partial"); assert.equal(f.ws().state.candidates.length, 1);
});
test("a step saved before Apify was retired ends without any provider call", async () => {
  const base = fixture();
  const legacy: SourceStep = { source: "LinkedIn", query: base.query, limit: 3, status: "running", found: 0, added: 0, duplicates: 0, excluded: 0, externalRunId: "old-run", datasetId: "old-dataset" };
  const f = fixture([legacy, ...orderedSteps([{ source: "GitHub", query: base.query, limit: 3 }])]);
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().steps[0].status, "failed");
  assert.match(f.job().steps[0].error!, /Apify was removed/);
  assert.deepEqual(f.counts(), { searches: 0, githubCalls: 0, reservations: 0 });
  assert.match(SOURCE_LABELS.LinkedIn, /retired/);
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "partial"); assert.equal(f.counts().githubCalls, 1);
});
test("brief changes during provider work prevent candidate persistence", async () => {
  const f = fixture();
  f.providers.webSearch = async () => { f.ws().state.campaigns[0].jobAnalysis.title = "Different role"; return { ok: true, hits: [f.hit] }; };
  await assert.rejects(advanceUnifiedRun(f.job(), f.repo, f.providers), /brief changed/);
  assert.equal(f.ws().state.candidates.length, 0);
});
test("invalid source URLs are excluded instead of creating unsafe profile links", async () => {
  const f = fixture();
  f.providers.webSearch = async () => ({ ok: true, hits: [{ ...f.hit, url: "javascript:alert(1)" }, { ...f.hit, url: "https://evil.example/in/aria-fixture" }] });
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.ws().state.candidates.length, 0);
  assert.deepEqual([f.job().steps[0].found, f.job().steps[0].excluded], [2, 2]);
});
test("an erased identity is excluded without blocking the rest of a batch", async () => {
  const f = fixture();
  const finish = f.repo.finish; let first = true;
  f.repo.finish = async (...args) => {
    if (first && args[4]) { first = false; return { blockedIds: [args[4].candidates[0].id] }; }
    return finish(...args);
  };
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.ws().state.candidates.length, 0); assert.equal(f.job().steps[0].added, 0); assert.equal(f.job().steps[0].excluded, 1);
});
test("GitHub search qualifiers do not become observed candidate skills", async () => {
  const { searchGithubUsers } = await import("../src/lib/sourcing/github");
  const { clearProviderProbe } = await import("../src/lib/sourcing/provider-egress");
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).includes("/search/users")
      ? { items: [{ login: "aria-fixture" }] } : { login: "aria-fixture", bio: "", public_repos: 1 }), { status: 200, headers: {"content-type":"application/json"} });
    const users = await searchGithubUsers(clearProviderProbe("GitHub"), "language:Go", 1);
    assert.equal(users[0].topLanguage, null);
  } finally { globalThis.fetch = realFetch; }
});
