/**
 * serverGenerateText: auth-dead env skip + retryable upstream continues to next provider.
 */
import assert from "node:assert/strict";
import { mock } from "node:test";

const originalFetch = globalThis.fetch;
const originalKimi = process.env.KIMI_API_KEY;
const originalAnthropic = process.env.ANTHROPIC_API_KEY;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

try {
  mock.module("server-only", { namedExports: {} });
  mock.module("../src/lib/ai/vault-secret.ts", {
    namedExports: {
      resolveStoredLlmKeyForWorkspace: async () => "",
    },
  });

  process.env.KIMI_API_KEY = "kimi-dead";
  process.env.ANTHROPIC_API_KEY = "anthropic-ok";

  const { clearServerGenerateAuthDeadCache, serverGenerateText } = await import(
    "../src/lib/ai/server-generate"
  );
  clearServerGenerateAuthDeadCache();

  let calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("kimi") || url.includes("moonshot")) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    // Anthropic Messages API shape
    return jsonResponse(200, {
      content: [{ type: "text", text: "ok-from-anthropic" }],
    });
  }) as typeof fetch;

  const first = await serverGenerateText({
    system: "sys",
    prompt: "hello",
    maxTokens: 32,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.text, "ok-from-anthropic");
    assert.equal(first.provider, "anthropic");
  }
  const kimiCallsFirst = calls.filter((u) => /kimi|moonshot/i.test(u)).length;
  assert.ok(kimiCallsFirst >= 1, "first call probes dead Kimi once");

  calls = [];
  const second = await serverGenerateText({
    system: "sys",
    prompt: "again",
    maxTokens: 32,
  });
  assert.equal(second.ok, true);
  const kimiCallsSecond = calls.filter((u) => /kimi|moonshot/i.test(u)).length;
  assert.equal(kimiCallsSecond, 0, "auth-dead Kimi env is skipped on the next call");

  clearServerGenerateAuthDeadCache();
  calls = [];
  // Retryable Kimi 429 should continue to Anthropic (not abort).
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("kimi") || url.includes("moonshot")) {
      return jsonResponse(429, { error: "rate-limit" });
    }
    return jsonResponse(200, {
      content: [{ type: "text", text: "ok-after-429" }],
    });
  }) as typeof fetch;

  const after429 = await serverGenerateText({
    system: "sys",
    prompt: "rate",
    maxTokens: 32,
  });
  assert.equal(after429.ok, true);
  if (after429.ok) assert.equal(after429.text, "ok-after-429");

  console.log("RESULT server-generate-failover: 3 passed, 0 failed");
} catch (err) {
  console.log("FAIL:", err instanceof Error ? err.message : err);
  console.log("RESULT server-generate-failover: 0 passed, 1 failed");
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  if (originalKimi === undefined) delete process.env.KIMI_API_KEY;
  else process.env.KIMI_API_KEY = originalKimi;
  if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropic;
}
