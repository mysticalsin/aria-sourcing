import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateOutreachQuality,
  validateOutreachQualityLive,
} from "../src/lib/outreach-quality-pipeline";

test("deterministic quality blocks robotic self-disclosure", () => {
  const verdict = validateOutreachQuality({
    subject: "Hello",
    body: "As an AI language model I think you are a perfect fit for our team with exciting opportunity.",
    channel: "Email",
  });
  assert.equal(verdict.status, "blocked");
  assert.equal(verdict.llmCriticsUsed, false);
});

test("validateOutreachQualityLive falls back to deterministic without LLM keys", async () => {
  const prev = process.env.ARIA_QUALITY_LLM_CRITICS;
  process.env.ARIA_QUALITY_LLM_CRITICS = "0";
  try {
    const verdict = await validateOutreachQualityLive({
      subject: "Your TypeScript work",
      body:
        "Hi Alex — I noticed your recent TypeScript contributions on the payments service. " +
        "We are hiring a Senior Engineer in London and your background stood out. " +
        "Would you be open to a short intro chat next week?",
      channel: "Email",
    });
    assert.ok(verdict.aggregateScore > 0);
    assert.equal(verdict.llmCriticsUsed, false);
  } finally {
    if (prev === undefined) delete process.env.ARIA_QUALITY_LLM_CRITICS;
    else process.env.ARIA_QUALITY_LLM_CRITICS = prev;
  }
});
