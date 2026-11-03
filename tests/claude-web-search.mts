import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { buildSeedState } from "../src/lib/seed";
import { campaignSourcingBasis, orderedSteps, jobStatus, SourcePlanSchema, webSearchBudget, type CampaignSourcingJob } from "../src/lib/sourcing/unified-contract";
import type { UnifiedProviders, UnifiedRunRepository } from "../src/lib/sourcing/unified-run";
import { estimateCostUsd } from "../src/lib/ai/usage";
mock.module("server-only", { namedExports: {} });
const { advanceUnifiedRun } = await import("../src/lib/sourcing/unified-run");
const { canonicalLinkedInProfileUrl, searchLinkedInWithClaude, webSearchAnthropicConfig } = await import("../src/lib/sourcing/claude-web-search");
const { clearWebSearchDiscovery } = await import("../src/lib/sourcing/provider-egress");

const state = buildSeedState();
const campaign = state.campaigns[0];
campaign.status = "Sourcing";
const skill = campaign.jobAnalysis.requiredSkills[0];
const clearance = () => {
  const cleared = clearWebSearchDiscovery({ query: skill }, campaign);
  assert.ok(cleared.ok);
  return cleared.clearance;
};
const allowed = (q: string) => !/young|graduate/i.test(q) && q.includes(skill);

function withFetch(responses: (Response | Error)[], run: (calls: { url: string; init: RequestInit }[]) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next || next instanceof Error) throw next ?? new Error("unexpected request");
    return next;
  };
  return run(calls).finally(() => { globalThis.fetch = realFetch; });
}
const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("only public LinkedIn profile pages are accepted, in one canonical form", () => {
  assert.equal(canonicalLinkedInProfileUrl("https://fr.linkedin.com/in/jane-fixture?trk=public"), "https://www.linkedin.com/in/jane-fixture");
  assert.equal(canonicalLinkedInProfileUrl("https://www.linkedin.com/in/jane-fixture/en/"), "https://www.linkedin.com/in/jane-fixture");
  assert.equal(canonicalLinkedInProfileUrl("https://www.linkedin.com/company/acme"), null);
  assert.equal(canonicalLinkedInProfileUrl("https://linkedin.com.attacker.example/in/jane"), null);
  assert.equal(canonicalLinkedInProfileUrl("javascript:alert(1)"), null);
});

test("profiles come from search results, policy-failing searches are dropped and cited matches rank first", async () => {
  const first = reply({ stop_reason: "pause_turn", usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 2 } }, content: [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: skill } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [
      { type: "web_search_result", url: "https://fr.linkedin.com/in/jane-fixture?trk=x", title: "Jane Fixture – Data Engineer – Acme | LinkedIn", encrypted_content: "e" },
      { type: "web_search_result", url: "https://www.linkedin.com/company/acme", title: "Acme | LinkedIn", encrypted_content: "e" },
      { type: "web_search_result", url: "https://www.linkedin.com/in/bob-fixture/", title: "Bob Fixture - Engineer | LinkedIn", encrypted_content: "e" },
    ] },
    { type: "server_tool_use", id: "s2", name: "web_search", input: { query: `young graduate ${skill}` } },
    { type: "web_search_tool_result", tool_use_id: "s2", content: [
      { type: "web_search_result", url: "https://www.linkedin.com/in/hidden-fixture", title: "Hidden Fixture | LinkedIn", encrypted_content: "e" },
    ] },
  ] });
  const second = reply({ stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 50 }, content: [
    { type: "text", text: "Bob matches.", citations: [{ type: "web_search_result_location", url: "https://www.linkedin.com/in/bob-fixture", cited_text: `Bob builds ${skill} services`, encrypted_index: "i" }] },
    // A profile only named in prose, never returned by a search, must not appear.
    { type: "text", text: "Also https://www.linkedin.com/in/invented-fixture" },
  ] });
  await withFetch([first, second], async (calls) => {
    const outcome = await searchLinkedInWithClaude(clearance(), "fixture-key", { query: skill, limit: 6, role: campaign.jobAnalysis.title,
      location: "Paris", model: "claude-sonnet-5-5", queryAllowed: allowed });
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.hits.map((h) => h.url), ["https://www.linkedin.com/in/bob-fixture", "https://www.linkedin.com/in/jane-fixture"]);
    assert.equal(outcome.hits[0].snippet, `Bob builds ${skill} services`);
    assert.equal(outcome.hits[1].title, "Jane Fixture - Data Engineer - Acme | LinkedIn");
    assert.equal(outcome.rejectedSearches, 1);
    assert.equal(outcome.searches, 2);
    assert.equal(outcome.usage.input_tokens, 1500);
    assert.equal(outcome.usage.server_tool_use?.web_search_requests, 2);

    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).hostname, "api.anthropic.com");
    assert.equal((calls[0].init.headers as Record<string, string>)["x-api-key"], "fixture-key");
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: webSearchBudget(6), allowed_domains: ["linkedin.com/in"] }]);
    assert.match(body.messages[0].content, new RegExp(`Reviewed query: ${skill}`));
    // A paused turn is resumed by sending it back, with no extra user message.
    const resumed = JSON.parse(String(calls[1].init.body));
    assert.equal(resumed.messages.length, 2);
    assert.equal(resumed.messages[1].role, "assistant");
  });
});

test("a refused key and a network failure are reported, never retried", async () => {
  await withFetch([reply({ type: "error" }, 401)], async (calls) => {
    const outcome = await searchLinkedInWithClaude(clearance(), "bad-key", { query: skill, limit: 3, role: "", location: "", model: "claude-sonnet-5-5", queryAllowed: allowed });
    assert.equal(outcome.ok, false); assert.equal(!outcome.ok && outcome.reason, "refused"); assert.equal(calls.length, 1);
  });
  await withFetch([new Error("socket closed")], async (calls) => {
    const outcome = await searchLinkedInWithClaude(clearance(), "key", { query: skill, limit: 3, role: "", location: "", model: "claude-sonnet-5-5", queryAllowed: allowed });
    assert.equal(!outcome.ok && outcome.reason, "unavailable"); assert.equal(calls.length, 1);
  });
});

test("web search needs the workspace's own Anthropic key", () => {
  const settings = structuredClone(state.settings);
  settings.llmProviders = settings.llmProviders.map((p) => ({ ...p, apiKeyId: undefined }));
  assert.equal(webSearchAnthropicConfig(settings), null);
  const anthropic = settings.llmProviders.find((p) => p.kind === "Anthropic");
  assert.ok(anthropic);
  anthropic.enabled = true; anthropic.apiKeyId = "vault-key-id";
  assert.equal(webSearchAnthropicConfig(settings)?.apiKeyId, "vault-key-id");
});

test("each web search is priced on top of the tokens", () => {
  const tokens = estimateCostUsd("claude-sonnet-5-5", { input_tokens: 1000 });
  assert.ok(Math.abs(estimateCostUsd("claude-sonnet-5-5", { input_tokens: 1000, server_tool_use: { web_search_requests: 3 } }) - tokens - 0.03) < 1e-9);
});

test("the plan accepts the three sources and runs them LinkedIn, web search, GitHub", () => {
  const plan = [{ source: "GitHub", query: skill, limit: 2 }, { source: "WebSearch", query: skill, limit: 2 }, { source: "LinkedIn", query: skill, limit: 2 }] as const;
  assert.ok(SourcePlanSchema.safeParse(plan).success);
  assert.deepEqual(orderedSteps([...plan]).map((s) => s.source), ["LinkedIn", "WebSearch", "GitHub"]);
});

function runFixture() {
  const ws = { state: structuredClone(state), updatedAt: "v1" };
  ws.state.candidates = [];
  const target = ws.state.campaigns[0];
  let stored: CampaignSourcingJob = { id: crypto.randomUUID(), workspace_id: crypto.randomUUID(), actor_id: crypto.randomUUID(),
    campaign_id: target.id, campaign_snapshot: campaignSourcingBasis(target), status: "active",
    steps: orderedSteps([{ source: "WebSearch", query: skill, limit: 5 }]), revision: 0, claim_token: null, claim_until: null, created_at: new Date().toISOString() };
  const receipts: { source: string; settled?: boolean }[] = [];
  let searches = 0;
  const repo: UnifiedRunRepository = {
    readWorkspace: async () => structuredClone(ws),
    claim: async (job, token, steps) => {
      if (job.revision !== stored.revision) return false;
      stored = { ...stored, steps: structuredClone(steps), revision: stored.revision + 1, claim_token: token, claim_until: new Date(Date.now() + 180_000).toISOString() };
      return true;
    },
    bind: async (_job, _token, steps) => { stored.steps = structuredClone(steps); },
    reserve: async (source) => { receipts.push({ source }); return "receipt"; },
    settle: async (_id, succeeded) => { receipts[receipts.length - 1].settled = succeeded; },
    finish: async (_job, _token, steps, _expected, next) => {
      if (next) { ws.state = structuredClone(next); ws.updatedAt += "x"; }
      stored = { ...stored, steps: structuredClone(steps), status: jobStatus(steps), claim_token: null, claim_until: null, revision: stored.revision + 1 };
      return "saved";
    },
  };
  const providers: UnifiedProviders = {
    apifyKey: async () => null, start: async () => { throw new Error("no Apify"); }, poll: async () => { throw new Error("no Apify"); },
    items: async () => { throw new Error("no Apify"); }, github: async () => [],
    webSearch: async (_c, query) => {
      searches++; assert.equal(query, skill);
      return { ok: true, hits: [{ url: "https://www.linkedin.com/in/jane-fixture", title: "Jane Fixture - Data Engineer - Acme | LinkedIn", snippet: `Builds ${skill} services` }] };
    },
  };
  return { ws, repo, providers, receipts, job: () => structuredClone(stored), searches: () => searches,
    interrupt: () => { stored.steps[0].status = "starting"; } };
}

test("a web search step saves scored LinkedIn leads with their source and no invented contact details", async () => {
  const f = runFixture();
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "completed");
  assert.deepEqual([f.job().steps[0].found, f.job().steps[0].added], [1, 1]);
  const candidate = f.ws.state.candidates[0];
  assert.equal(candidate.linkedinUrl, "https://www.linkedin.com/in/jane-fixture");
  assert.equal(candidate.sourcePlatform, "LinkedIn");
  assert.equal(candidate.name, "Jane Fixture");
  assert.equal(candidate.currentCompany, "Acme");
  assert.equal(candidate.email, "");
  assert.equal(candidate.yearsExperience, null);
  assert.equal(candidate.sourceRunId, f.job().id);
  assert.deepEqual(f.receipts, [{ source: "WebSearch", settled: true }]);
});

test("an interrupted web search is never repeated automatically", async () => {
  const f = runFixture();
  f.interrupt();
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.searches(), 0);
  assert.equal(f.job().steps[0].status, "uncertain");
  assert.match(f.job().steps[0].error ?? "", /no paid retry/);
});

test("a failed web search is explicit and settles its receipt as failed", async () => {
  const f = runFixture();
  f.providers.webSearch = async () => ({ ok: false, error: "Add an Anthropic key in Settings before searching the web." });
  await advanceUnifiedRun(f.job(), f.repo, f.providers);
  assert.equal(f.job().status, "failed");
  assert.match(f.job().steps[0].error ?? "", /Anthropic key/);
  assert.equal(f.ws.state.candidates.length, 0);
  assert.deepEqual(f.receipts, [{ source: "WebSearch", settled: false }]);
});
