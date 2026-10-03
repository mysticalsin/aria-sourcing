import assert from "node:assert/strict";
import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

// Isolate from operator shell secrets (never assert against a live key value).
delete process.env.ARIA_JINA_API_KEY;
delete process.env.JINA_API_KEY;

const {
  isLinkedInPublicUrl,
  jinaReaderUrlFor,
  readLinkedInViaAgentReachJina,
  readLinkedInViaAgentReachMcp,
  readLinkedInViaAgentReach,
  searchLinkedInViaAgentReachJina,
  agentReachLinkedInStatus,
  agentReachLinkedInMcpStatus,
  agentReachLinkedInSearchStatus,
  agentReachJinaApiKeyConfigured,
} = await import("../src/lib/integrations/agent-reach-linkedin");

assert.equal(isLinkedInPublicUrl("https://www.linkedin.com/in/tonywalteur/"), true);
assert.equal(isLinkedInPublicUrl("https://www.linkedin.com/company/mantu/"), true);
assert.equal(isLinkedInPublicUrl("https://example.com/in/nope"), false);
assert.equal(isLinkedInPublicUrl("http://www.linkedin.com/in/tonywalteur/"), false);

assert.equal(
  jinaReaderUrlFor("https://www.linkedin.com/in/tonywalteur/?trk=foo"),
  "https://r.jina.ai/https://www.linkedin.com/in/tonywalteur/",
);

const status = agentReachLinkedInStatus();
assert.equal(status.id, "agent-reach-jina");
assert.equal(status.enabled, true);
assert.equal(typeof status.apiKeyConfigured, "boolean");

const mcpOff = agentReachLinkedInMcpStatus();
assert.equal(mcpOff.id, "agent-reach-mcp");
assert.equal(mcpOff.enabled, false);
assert.equal(mcpOff.urlConfigured, false);

const searchOff = agentReachLinkedInSearchStatus();
assert.equal(searchOff.id, "agent-reach-jina-search");
assert.equal(searchOff.enabled, false);
assert.equal(agentReachJinaApiKeyConfigured(), false);

process.env.ARIA_AGENT_REACH_JINA = "0";
const disabled = await readLinkedInViaAgentReachJina("https://www.linkedin.com/in/tonywalteur/");
assert.equal(disabled.ok, false);
assert.equal(disabled.via, "stub");
delete process.env.ARIA_AGENT_REACH_JINA;

const blockedHost = await readLinkedInViaAgentReachJina("https://evil.example/in/x");
assert.equal(blockedHost.ok, false);
assert.match(blockedHost.detail, /Only https LinkedIn/i);

const mcpUnset = await readLinkedInViaAgentReachMcp("https://www.linkedin.com/in/tonywalteur/");
assert.equal(mcpUnset.ok, false);
assert.equal(mcpUnset.via, "stub");
assert.match(mcpUnset.detail, /not configured/i);

process.env.ARIA_AGENT_REACH_LINKEDIN_MCP_URL = "https://agent-reach.example";
const mcpOn = agentReachLinkedInMcpStatus();
assert.equal(mcpOn.enabled, true);
assert.equal(mcpOn.urlConfigured, true);

let seenUrl = "";
let seenBody = "";
const fakeFetch: typeof fetch = async (input, init) => {
  seenUrl = String(input);
  seenBody = String(init?.body ?? "");
  return new Response(
    JSON.stringify({
      ok: true,
      title: "Tony Walteur",
      text: "Senior Java Developer · Spring Boot · PostgreSQL · Kafka · Microservices. Building platforms.",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};
const mcpOk = await readLinkedInViaAgentReachMcp("https://www.linkedin.com/in/tonywalteur/", {
  fetchImpl: fakeFetch,
});
assert.equal(mcpOk.ok, true);
if (mcpOk.ok) {
  assert.equal(mcpOk.via, "agent-reach-mcp");
  assert.match(mcpOk.text, /Senior Java/);
}
assert.match(seenUrl, /\/linkedin\/profile$/);
assert.match(seenBody, /tonywalteur/);

const emptyFetch: typeof fetch = async () =>
  new Response(JSON.stringify({ ok: true, text: "thin" }), { status: 200 });
const mcpThin = await readLinkedInViaAgentReachMcp("https://www.linkedin.com/in/tonywalteur/", {
  fetchImpl: emptyFetch,
});
assert.equal(mcpThin.ok, false);
assert.equal(mcpThin.via, "agent-reach-mcp");

// Unified reader prefers MCP when configured + healthy.
const viaMcp = await readLinkedInViaAgentReach("https://www.linkedin.com/in/tonywalteur/", {
  fetchImpl: fakeFetch,
});
assert.equal(viaMcp.ok, true);
if (viaMcp.ok) assert.equal(viaMcp.via, "agent-reach-mcp");

delete process.env.ARIA_AGENT_REACH_LINKEDIN_MCP_URL;

// Search requires API key — fail closed without inventing URLs.
delete process.env.ARIA_JINA_API_KEY;
delete process.env.JINA_API_KEY;
const searchNoKey = await searchLinkedInViaAgentReachJina({ keywords: ["java"] });
assert.equal(searchNoKey.ok, false);
assert.match(String(searchNoKey.detail), /ARIA_JINA_API_KEY/i);
assert.equal(searchNoKey.hits.length, 0);

process.env.ARIA_JINA_API_KEY = "apikey_test_not_real";
assert.equal(agentReachJinaApiKeyConfigured(), true);
assert.equal(agentReachLinkedInStatus().apiKeyConfigured, true);
assert.equal(agentReachLinkedInStatus().keyKind, "portal-apikey-reader");
assert.ok(
  agentReachLinkedInStatus().bestAriaUses.some((u) => /Reader enrichment/i.test(u)),
  "portal apikey best uses name Reader enrichment",
);
assert.equal(agentReachLinkedInSearchStatus().enabled, false);
const searchApikey = await searchLinkedInViaAgentReachJina({ keywords: ["java"] });
assert.equal(searchApikey.ok, false);
assert.match(String(searchApikey.detail), /Reader \(X-API-Key\)|standard jina/i);
delete process.env.ARIA_JINA_API_KEY;

process.env.ARIA_JINA_API_KEY = "jina_test_not_real";
assert.equal(agentReachLinkedInStatus().keyKind, "jina-bearer");
assert.equal(agentReachLinkedInSearchStatus().enabled, true);
delete process.env.ARIA_JINA_API_KEY;

console.log("RESULT agent-reach-linkedin: 24 passed, 0 failed");
