import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { buildSeedState } from "../src/lib/seed";
import type { Candidate } from "../src/lib/types";
import type { ApifyProfile } from "../src/lib/sourcing/apify";
import { shortlistIdentity } from "../src/lib/sourcing/shortlist-preview";
import { campaignSourcingBasis, orderedSteps, jobStatus, publicSourcingJob, SourcePlanSchema, type CampaignSourcingJob } from "../src/lib/sourcing/unified-contract";
import type { UnifiedRunRepository, UnifiedProviders } from "../src/lib/sourcing/unified-run";
mock.module("server-only", { namedExports: {} });
const { advanceUnifiedRun } = await import("../src/lib/sourcing/unified-run");

function fixture() {
  const state = buildSeedState();
  const campaign = state.campaigns[0];
  campaign.status = "Sourcing";
  state.candidates = []; state.bookings = []; state.outreach = [];
  const query = campaign.jobAnalysis.requiredSkills[0];
  const job: CampaignSourcingJob = { id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), actor_id: crypto.randomUUID(),
    campaign_id: campaign.id, campaign_snapshot: campaignSourcingBasis(campaign), status: "active",
    steps: orderedSteps([{ source: "GitHub", query, limit: 3 }, { source: "LinkedIn", query, limit: 3 }]),
    revision: 0, claim_token: null, claim_until: null, created_at: new Date().toISOString() };
  let ws = { state, updatedAt: "v1" };
  let stored = structuredClone(job);
  let starts = 0, polls = 0, githubCalls = 0, reservations = 0, conflicts = 0;
  const profile: ApifyProfile = { id: "fixture", publicIdentifier: "aria-fixture", linkedinUrl: "https://www.linkedin.com/in/aria-fixture/", firstName: "Aria", lastName: "Fixture",
    headline: "", about: query, email: null, location: null, currentPosition: [], experience: [], education: [], topSkills: [query], skills: [], languages: [],
    connectionsCount: 0, followerCount: 0, openToWork: false, hiring: false, premium: false };
  const repo: UnifiedRunRepository = {
    readWorkspace: async () => structuredClone(ws),
    claim: async (claim, token, steps) => {
      if (claim.revision !== stored.revision) return false;
      stored.steps = structuredClone(steps); stored.revision++; stored.claim_token = token; stored.claim_until = new Date(Date.now() + 180_000).toISOString(); return true;
    },
    bind: async (_j, token, steps) => { assert.equal(stored.claim_token, token); stored.steps = structuredClone(steps); },
    reserve: async () => { reservations++; return "receipt-id"; },
    settle: async () => {},
    finish: async (_j, token, steps, expected, next) => {
      assert.equal(stored.claim_token, token);
      if (conflicts > 0) { conflicts--; return "conflict"; }
      if (expected.updatedAt !== ws.updatedAt) return "conflict";
      if (next) ws = { state: structuredClone(next), updatedAt: `v${stored.revision}` };
      stored.steps = structuredClone(steps); stored.status = jobStatus(steps); stored.claim_token = null; stored.claim_until = null; stored.revision++;
      return "saved";
    },
  };
  const providers: UnifiedProviders = {
    apifyKey: async () => "fixture-key",
    start: async (_c, _k, input) => { starts++; assert.equal(input.profileScraperMode, "Short"); assert.equal(input.maxItems, 3); return { ok: true, status: 201, data: { runId: "provider-run", datasetId: "provider-dataset", status: "READY" } }; },
    poll: async () => { polls++; return { ok: true, status: 200, data: { status: "SUCCEEDED" } }; },
    items: async () => ({ ok: true, status: 200, data: [profile, { ...profile, linkedinUrl: "https://linkedin.com/in/aria-fixture?trk=search" }] }),
    github: async () => { githubCalls++; return [{ login: "aria-other-fixture", name: "Other Fixture", email: null, company: null, location: null, bio: query, blog: null, htmlUrl: "https://github.com/aria-other-fixture", publicRepos: 2, followers: 1, createdAt: null, topLanguage: null }]; },
  };
  return { job: () => structuredClone(stored), ws: () => ws, repo, providers, profile,
    counts: () => ({ starts, polls, githubCalls, reservations }), conflict: () => { conflicts++; },
    expire: () => { stored.claim_until = new Date(0).toISOString(); },
    mutateState: (candidate: Candidate) => { ws.state.candidates.push(candidate); ws.updatedAt += "x"; } };
}

test("source plan rejects duplicates, unbounded limits and caller-owned authority", () => {
  assert.equal(SourcePlanSchema.safeParse([{ source: "LinkedIn", query: "Go", limit: 51 }]).success, false);
  assert.equal(SourcePlanSchema.safeParse([{ source: "LinkedIn", query: "Go", limit: 2, datasetId: "injected" }]).success, false);
  assert.equal(SourcePlanSchema.safeParse([{ source: "GitHub", query: "Go", limit: 2 }, { source: "GitHub", query: "Go", limit: 2 }]).success, false);
});
test("shortlist identities obey confidentiality and the existing outreach-purpose policy", () => {
  const candidate = { ...buildSeedState().candidates[0], stage: "Sourced" as const,
    name: "Aria Confidential Fixture", linkedinUrl: "https://linkedin.com/in/aria-private-fixture", githubUrl: "" };
  const masked = shortlistIdentity(candidate, true);
  assert.notEqual(masked.name, candidate.name);
  assert.equal(masked.profileUrl, "");
  assert.equal(shortlistIdentity(candidate, false).profileUrl, candidate.linkedinUrl);
  assert.equal(shortlistIdentity({ ...candidate, stage: "Contacted" }, true).name, candidate.name);
});
test("LinkedIn first, refresh recovery, authoritative dedupe and saved GitHub complement", async () => {
  const f = fixture();
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().steps[0].status, "running");
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().githubCalls, 0);
  // Reconstructing from the repository is the refresh path; no browser IDs.
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.deepEqual([f.job().steps[0].found, f.job().steps[0].added, f.job().steps[0].duplicates], [2, 1, 1]);
  assert.equal(f.ws().state.candidates[0].currentTitle, "");
  assert.equal(f.ws().state.candidates[0].yearsExperience, null);
  assert.equal(f.ws().state.candidates[0].email, "");
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "completed"); assert.equal(f.ws().state.candidates.length, 2);
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().githubCalls, 1);
  const dto = publicSourcingJob(f.job(), f.job().actor_id);
  assert.doesNotMatch(JSON.stringify(dto), /provider-dataset|provider-run|fixture-key|campaign_snapshot|workspace_id/);
});
test("simultaneous polling claims at most one paid start", async () => {
  const f = fixture(); const same = f.job();
  await Promise.all([advanceUnifiedRun(same, f.repo, f.providers), advanceUnifiedRun(same, f.repo, f.providers)]);
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().reservations, 1);
});
test("a start timeout is uncertain and never retried; the next source still runs", async () => {
  const f = fixture();
  f.providers.start = async () => ({ ok: false, status: 0, title: "timeout", detail: "sensitive error" });
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().steps[0].status, "uncertain");
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "partial"); assert.equal(f.counts().githubCalls, 1);
  assert.doesNotMatch(JSON.stringify(f.job().steps), /sensitive error/);
});
test("crash during a paid start does not launch again after the lease expires", async () => {
  const f = fixture();
  f.providers.start = async () => { throw new Error("process stopped after provider accepted"); };
  await assert.rejects(advanceUnifiedRun(f.job(), f.repo, f.providers));
  f.expire();
  let retried = false; f.providers.start = async () => { retried = true; throw new Error(); };
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(retried, false); assert.equal(f.job().steps[0].status, "uncertain");
});
test("state conflict remaps and dedupes against the latest persisted candidates", async () => {
  const f = fixture();
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  const finish = f.repo.finish; let first = true;
  f.repo.finish = async (...args) => {
    if (first) { first = false; const candidate = args[4]!.candidates[0]; f.mutateState(candidate); return "conflict"; }
    return finish(...args);
  };
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.ws().state.candidates.length, 1);
  assert.equal(f.job().steps[0].added, 0); assert.equal(f.job().steps[0].duplicates, 2);
});
test("missing LinkedIn key remains explicit and does not swallow GitHub results", async () => {
  const f = fixture(); f.providers.apifyKey = async () => null;
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.counts().starts, 0); assert.equal(f.job().steps[0].status, "failed");
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "partial"); assert.equal(f.ws().state.candidates.length, 1);
});
test("transient status failure keeps the exact binding and resumes without paid restart", async () => {
  const f = fixture(); await advanceUnifiedRun(f.job(), f.repo, f.providers);
  const poll = f.providers.poll;
  f.providers.poll = async () => ({ ok: false, status: 503, title: "down", detail: "" });
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().steps[0].externalRunId, "provider-run"); assert.equal(f.job().steps[0].status, "running");
  f.providers.poll = poll; await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.counts().starts, 1); assert.equal(f.job().steps[0].status, "completed");
});
test("brief changes during provider work prevent candidate persistence", async () => {
  const f = fixture(); await advanceUnifiedRun(f.job(), f.repo, f.providers);
  f.providers.items = async () => { f.ws().state.campaigns[0].jobAnalysis.title = "Different role"; return { ok: true, status: 200, data: [f.profile] }; };
  await assert.rejects(advanceUnifiedRun(f.job(), f.repo, f.providers), /brief changed/);
  assert.equal(f.ws().state.candidates.length, 0);
});
test("invalid source URLs are excluded instead of creating unsafe profile links", async () => {
  const f = fixture(); await advanceUnifiedRun(f.job(), f.repo, f.providers);
  f.providers.items = async () => ({ ok: true, status: 200, data: [{ ...f.profile, linkedinUrl: "javascript:alert(1)" }] });
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.ws().state.candidates.length, 0); assert.equal(f.job().steps[0].excluded, 1);
});
test("an erased identity is excluded without blocking the rest of a batch", async () => {
  const f = fixture(); await advanceUnifiedRun(f.job(), f.repo, f.providers);
  const finish = f.repo.finish; let first = true;
  f.repo.finish = async (...args) => {
    if (first) { first = false; return { blockedIds: [args[4]!.candidates[0].id] }; }
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
