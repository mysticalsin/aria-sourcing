import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateOutreachQuality } from "../src/lib/outreach-quality-pipeline";

test("deterministic quality blocks robotic self-disclosure", () => {
  const verdict = validateOutreachQuality({
    subject: "Hello",
    body: "As an AI language model I think you are a perfect fit for our team with exciting opportunity.",
    channel: "Email",
  });
  assert.equal(verdict.status, "blocked");
  assert.equal(verdict.llmCriticsUsed, false);
});

test("live LLM critics module stays server-only and exports validateOutreachQualityLive", () => {
  const src = readFileSync("src/lib/outreach-quality-pipeline-live.ts", "utf8");
  assert.match(src, /import "server-only"/);
  assert.match(src, /export async function validateOutreachQualityLive/);
  assert.match(src, /llm_empathy/);
  assert.match(src, /serverGenerateText/);
  assert.match(src, /llmStages\.length !== CRITICS\.length/);
  assert.match(src, /status: merged\.status === "blocked" \? "blocked" : "needs_review"/);
});

test("LangGraph draft_quality fail-stops empty drafts and incomplete live critics", () => {
  const graph = readFileSync("src/lib/langchain/recruiting-graph.ts", "utf8");
  assert.match(graph, /stage: "draft_failed"/);
  assert.match(graph, /missing_drafts/);
  assert.match(graph, /quality_critics_incomplete/);
  assert.match(graph, /llm_critics_required/);
  const draft = readFileSync("src/app/api/cron/generate-outreach-draft/route.ts", "utf8");
  assert.match(draft, /qualityCriticsUsed/);
  assert.match(draft, /quality_critics_incomplete/);
  assert.match(draft, /queued_for_approval/);
});

test("deterministic quality scores personalized empathetic outreach as ready-ish", () => {
  const verdict = validateOutreachQuality({
    subject: "Your TypeScript work",
    body:
      "Hi Alex — I noticed your recent TypeScript contributions on the payments service. " +
      "Mantu Group is hiring a Senior Engineer in London and your background stood out. " +
      "Would you be open to a short intro chat next week?",
    channel: "Email",
  });
  assert.notEqual(verdict.status, "blocked");
  assert.ok(verdict.aggregateScore >= 60);
});

test("deterministic quality fails compliance without Mantu brand", () => {
  const verdict = validateOutreachQuality({
    subject: "Your TypeScript work",
    body:
      "Hi Alex — I noticed your recent TypeScript contributions on the payments service. " +
      "We are hiring a Senior Engineer in London and your background stood out. " +
      "Would you be open to a short intro chat next week?",
    channel: "Email",
  });
  assert.ok(verdict.stages.some((s) => s.stage === "compliance" && s.reasons.includes("missing-mantu-brand")));
  assert.notEqual(verdict.status, "ready");
});
