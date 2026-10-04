import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { buildSeedState } from "../src/lib/seed";

mock.module("server-only", { namedExports: {} });

const { makeSourcingToolRunner } = await import("../src/lib/ai/sourcing-tools");

test("prohibited discovery criteria do not reach the provider socket", async () => {
  const campaign = buildSeedState().campaigns[0];
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      text: async () => "{}",
    } as Response;
  }) as typeof fetch;

  try {
    const runner = makeSourcingToolRunner(campaign, [], campaign.scoringWeights, "");
    const result = await runner.run("search_candidates", {
      platform: "GitHub",
      query: "language:Go young graduates",
      count: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
