/**
 * Workspace critics use resolveLoopLlm (Hermes-first); demo stays serverGenerateText.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

let loopCalls = 0;
let cloudCalls = 0;
let hermesOk = true;
let cloudOk = false;

mock.module("server-only", { namedExports: {} });
mock.module(moduleUrl("src/lib/ai/loop-llm.ts"), {
  namedExports: {
    resolveLoopLlm: async () => {
      loopCalls += 1;
      return hermesOk
        ? { ok: true, text: JSON.stringify({ pass: true, score: 88, reasons: ["ok"] }) }
        : { ok: false, reason: "Hermes down" };
    },
  },
});
mock.module(moduleUrl("src/lib/ai/server-generate.ts"), {
  namedExports: {
    serverGenerateText: async () => {
      cloudCalls += 1;
      return cloudOk
        ? { ok: true, text: JSON.stringify({ pass: true, score: 90, reasons: ["cloud"] }), provider: "anthropic" }
        : { ok: false, reason: "No cloud LLM" };
    },
    clearServerGenerateAuthDeadCache: () => {},
  },
});

const { validateOutreachQualityLive } = await import("../src/lib/outreach-quality-pipeline-live");

const cleanBody =
  "Hi Alex — Mantu Group is hiring for a senior TypeScript role that matches your GraphQL work. Open to a short chat?";

test("workspace critics prefer resolveLoopLlm (Hermes-first) over bare cloud", async () => {
  loopCalls = 0;
  cloudCalls = 0;
  hermesOk = true;
  cloudOk = false;
  const verdict = await validateOutreachQualityLive({
    subject: "Quick chat?",
    body: cleanBody,
    channel: "LinkedIn",
    workspaceId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(verdict.llmCriticsUsed, true);
  assert.ok(loopCalls >= 3, `expected ≥3 loop calls, got ${loopCalls}`);
  assert.equal(cloudCalls, 0, "workspace path must not call serverGenerateText directly");
});

test("demo / no-workspace critics use serverGenerateText only", async () => {
  loopCalls = 0;
  cloudCalls = 0;
  hermesOk = true;
  cloudOk = true;
  const verdict = await validateOutreachQualityLive({
    subject: "Quick chat?",
    body: cleanBody,
    channel: "Email",
  });
  assert.equal(verdict.llmCriticsUsed, true);
  assert.equal(loopCalls, 0);
  assert.ok(cloudCalls >= 3, `expected ≥3 cloud calls, got ${cloudCalls}`);
});

test("workspace critics fail closed when Hermes and cloud path both dead", async () => {
  loopCalls = 0;
  cloudCalls = 0;
  hermesOk = false;
  cloudOk = false;
  // resolveLoopLlm mock returns fail; real code would then try cloud inside
  // resolveLoopLlm — here the mock is the whole loop stack, so critics fail.
  const verdict = await validateOutreachQualityLive({
    subject: "Quick chat?",
    body: cleanBody,
    channel: "Email",
    workspaceId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(verdict.llmCriticsUsed, false);
  assert.notEqual(verdict.status, "ready");
  assert.ok(loopCalls >= 3);
  assert.equal(cloudCalls, 0);
});
