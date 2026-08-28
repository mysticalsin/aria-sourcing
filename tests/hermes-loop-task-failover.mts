import assert from "node:assert/strict";
import { mock, test } from "node:test";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

let lastGenerateArgs: Record<string, unknown> | null = null;
let generateResult: { ok: true; text: string; provider: string } | { ok: false; reason: string } = {
  ok: true,
  text: "failover-copy",
  provider: "anthropic",
};

mock.module(moduleUrl("src/lib/ai/server-generate.ts"), {
  namedExports: {
    serverGenerateText: async (input: Record<string, unknown>) => {
      lastGenerateArgs = input;
      return generateResult;
    },
    clearServerGenerateAuthDeadCache: () => undefined,
  },
});

const { tryLoopTaskCloudFailover, LOOP_LLM_TASKS } = await import("../src/lib/ai/hermes-loop-failover");

test("loop tasks include outreach classify sourcing only", () => {
  assert.deepEqual([...LOOP_LLM_TASKS].sort(), ["classify", "outreach", "sourcing"]);
});

test("non-loop tasks never call serverGenerateText", async () => {
  lastGenerateArgs = null;
  const text = await tryLoopTaskCloudFailover({
    task: "chat",
    system: "sys",
    prompt: "hi",
    workspaceId: null,
  });
  assert.equal(text, null);
  assert.equal(lastGenerateArgs, null);
});

test("loop task works without workspaceId (env-key path)", async () => {
  lastGenerateArgs = null;
  generateResult = { ok: true, text: "env-failover", provider: "openai" };
  const text = await tryLoopTaskCloudFailover({
    task: "outreach",
    system: "sys",
    prompt: "draft",
    workspaceId: null,
  });
  assert.equal(text, "env-failover");
  assert.ok(lastGenerateArgs);
  assert.equal(lastGenerateArgs?.workspaceId, undefined);
  assert.equal(lastGenerateArgs?.maxTokens, 2048);
});

test("loop task passes workspaceId when provided", async () => {
  lastGenerateArgs = null;
  generateResult = { ok: true, text: "vault-failover", provider: "anthropic" };
  const text = await tryLoopTaskCloudFailover({
    task: "classify",
    system: "sys",
    prompt: "reply",
    workspaceId: "61111111-1111-4111-8111-111111111111",
  });
  assert.equal(text, "vault-failover");
  assert.equal(lastGenerateArgs?.workspaceId, "61111111-1111-4111-8111-111111111111");
});

test("failed generate returns null", async () => {
  generateResult = { ok: false, reason: "all dead" };
  const text = await tryLoopTaskCloudFailover({
    task: "sourcing",
    system: "sys",
    prompt: "find",
    workspaceId: null,
  });
  assert.equal(text, null);
});
