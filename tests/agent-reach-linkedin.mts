import assert from "node:assert/strict";
import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });

const {
  isLinkedInPublicUrl,
  jinaReaderUrlFor,
  readLinkedInViaAgentReachJina,
  agentReachLinkedInStatus,
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

process.env.ARIA_AGENT_REACH_JINA = "0";
const disabled = await readLinkedInViaAgentReachJina("https://www.linkedin.com/in/tonywalteur/");
assert.equal(disabled.ok, false);
assert.equal(disabled.via, "stub");
delete process.env.ARIA_AGENT_REACH_JINA;

const blockedHost = await readLinkedInViaAgentReachJina("https://evil.example/in/x");
assert.equal(blockedHost.ok, false);
assert.match(blockedHost.detail, /Only https LinkedIn/i);

console.log("RESULT agent-reach-linkedin: 6 passed, 0 failed");
