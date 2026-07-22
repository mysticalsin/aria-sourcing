import assert from "node:assert/strict";
import test from "node:test";

import { buildSeedState } from "../src/lib/seed";
import {
  autonomousSourcingDurableEvidenceCapability,
  executeBoundSourcingPipeline,
  type BoundSourcingPipelineDependencies,
} from "../src/lib/sourcing/bound-sourcing-execution";

const seed = buildSeedState();
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const campaign = {
  ...seed.campaigns[0],
  id: "campaign-bound-sourcing",
  status: "Sourcing" as const,
};
const binding = {
  workspaceId: WORKSPACE_ID,
  bindingSetId: "22222222-2222-4222-8222-222222222222",
  setSha256: "a".repeat(64),
  bindingId: "33333333-3333-4333-8333-333333333333",
  purpose: "sourcing" as const,
  provider: "openai" as const,
  credentialProvider: "OpenAI",
  endpointProfile: "openai_responses",
  model: "gpt-4o-mini",
  apiKeyId: "44444444-4444-4444-8444-444444444444",
  catalogRevision: 1,
  configSha256: "b".repeat(64),
};

function candidate(id: string) {
  return {
    ...seed.candidates[0],
    id,
    campaignId: campaign.id,
    name: "Observed Candidate",
    provenance: "live" as const,
    sourcePlatform: "GitHub" as const,
    sourceQuery: "language:typescript type:user",
  };
}

function dependencies(overrides: Partial<BoundSourcingPipelineDependencies> = {}) {
  const calls: string[] = [];
  const found = [candidate("candidate-observed-1")];
  let toolRan = false;
  const deps: BoundSourcingPipelineDependencies = {
    createToolRunner: (_campaign, _existing, _weights, _github, _tavily, _web, beforeExternalCall) => ({
      run: async () => {
        calls.push("tool");
        if (beforeExternalCall && !(await beforeExternalCall())) {
          return { ok: false, error: "Sourcing authority changed." };
        }
        toolRan = true;
        return { ok: true, content: { found: [{ id: found[0]?.id }] } };
      },
      getFound: () => toolRan ? found : [],
      getExecutions: () => toolRan ? [{
        platform: "GitHub",
        query: "language:typescript type:user",
        ok: true,
        candidateCount: found.length,
        skippedCount: 0,
      }] : [],
    }),
    runAnthropic: async () => {
      calls.push("anthropic");
      return { ok: false, reason: "unexpected", toolCalls: [] };
    },
    runOpenAi: async (input) => {
      calls.push("openai");
      await input.servers[0]?.run?.("search_candidates", {
        platform: "GitHub",
        query: "language:typescript type:user",
        count: 1,
      });
      return {
        ok: true,
        text: JSON.stringify({
          drafts: [{
            candidateId: found[0]?.id,
            subject: "A role aligned with your TypeScript work",
            body: "Your verified TypeScript work looks relevant. Would you be open to a short conversation?",
          }],
        }),
        toolCalls: [],
      };
    },
    ...overrides,
  };
  return { calls, deps };
}

test("a database-bound sourcing execution returns only candidates observed through a real search tool", async () => {
  const { calls, deps } = dependencies();
  let authorityChecks = 0;

  const result = await executeBoundSourcingPipeline({
    workspaceId: WORKSPACE_ID,
    campaign,
    existing: [],
    count: 1,
    binding,
    apiKey: "workspace-bound-provider-key",
    githubToken: "",
    promotedLessons: [],
    beforeExternalCall: async () => {
      authorityChecks += 1;
      return true;
    },
  }, deps);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(calls, ["openai", "tool"]);
  assert.ok(authorityChecks >= 2, "authority must be checked for model and search egress");
  assert.equal(result.found.length, 1);
  assert.equal(result.found[0]?.id, "candidate-observed-1");
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0]?.ok, true);
  assert.deepEqual(result.drafts.map((draft) => draft.candidateId), ["candidate-observed-1"]);
  assert.deepEqual(result.durableEvidence, {
    ready: false,
    code: "provider_evidence_unavailable",
  });
});

test("the current browser search runner explicitly refuses autonomous durable-commit capability", () => {
  assert.deepEqual(autonomousSourcingDurableEvidenceCapability(), {
    ready: false,
    code: "provider_evidence_unavailable",
    missing: [
      "provider_response_sha256",
      "canonical_source_external_id",
      "durable_query_receipt",
    ],
  });
});

test("missing binding or workspace key fails closed before model or search egress", async () => {
  for (const input of [
    { binding: null, apiKey: "workspace-bound-provider-key" },
    { binding, apiKey: "" },
    { binding: { ...binding, purpose: "requisition_parse" as const }, apiKey: "workspace-bound-provider-key" },
    {
      binding: { ...binding, workspaceId: "11111111-1111-4111-8111-111111111112" },
      apiKey: "workspace-bound-provider-key",
    },
  ]) {
    const { calls, deps } = dependencies();
    const result = await executeBoundSourcingPipeline({
      workspaceId: WORKSPACE_ID,
      campaign,
      existing: [],
      count: 1,
      githubToken: "",
      promotedLessons: [],
      beforeExternalCall: async () => true,
      ...input,
    }, deps);

    assert.deepEqual(result, { ok: false, code: "not_configured" });
    assert.deepEqual(calls, []);
  }
});

test("authority revocation and model-only answers cannot produce autonomous candidates", async () => {
  {
    const { calls, deps } = dependencies();
    const result = await executeBoundSourcingPipeline({
      workspaceId: WORKSPACE_ID,
      campaign,
      existing: [],
      count: 1,
      binding,
      apiKey: "workspace-bound-provider-key",
      githubToken: "",
      promotedLessons: [],
      beforeExternalCall: async () => false,
    }, deps);
    assert.deepEqual(result, { ok: false, code: "authority_changed" });
    assert.deepEqual(calls, []);
  }

  {
    const { calls, deps } = dependencies({
      runOpenAi: async () => {
        calls.push("openai");
        return { ok: true, text: JSON.stringify({ drafts: [] }), toolCalls: [] };
      },
    });
    let checks = 0;
    const result = await executeBoundSourcingPipeline({
      workspaceId: WORKSPACE_ID,
      campaign,
      existing: [],
      count: 1,
      binding,
      apiKey: "workspace-bound-provider-key",
      githubToken: "",
      promotedLessons: [],
      beforeExternalCall: async () => {
        checks += 1;
        return checks === 1;
      },
    }, deps);
    assert.deepEqual(result, { ok: false, code: "authority_changed" });
    assert.deepEqual(calls, ["openai"]);
  }

  {
    const { calls, deps } = dependencies({
      runOpenAi: async () => {
        calls.push("openai");
        return {
          ok: true,
          text: JSON.stringify({ drafts: [{
            candidateId: "model-invented-id",
            subject: "Invented",
            body: "This person was never returned by a search provider.",
          }] }),
          toolCalls: [],
        };
      },
    });
    const result = await executeBoundSourcingPipeline({
      workspaceId: WORKSPACE_ID,
      campaign,
      existing: [],
      count: 1,
      binding,
      apiKey: "workspace-bound-provider-key",
      githubToken: "",
      promotedLessons: [],
      beforeExternalCall: async () => true,
    }, deps);
    assert.deepEqual(result, { ok: false, code: "no_real_search" });
    assert.deepEqual(calls, ["openai"]);
  }
});

test("unobserved draft identifiers and malformed model output are rejected", async () => {
  for (const text of [
    "not-json",
    JSON.stringify({ drafts: [{
      candidateId: "candidate-invented-by-model",
      subject: "Invented",
      body: "This identifier did not come from the search tool.",
    }] }),
  ]) {
    const { deps } = dependencies({
      runOpenAi: async (input) => {
        await input.servers[0]?.run?.("search_candidates", {
          platform: "GitHub",
          query: "language:typescript type:user",
          count: 1,
        });
        return { ok: true, text, toolCalls: [] };
      },
    });
    const result = await executeBoundSourcingPipeline({
      workspaceId: WORKSPACE_ID,
      campaign,
      existing: [],
      count: 1,
      binding,
      apiKey: "workspace-bound-provider-key",
      githubToken: "",
      promotedLessons: [],
      beforeExternalCall: async () => true,
    }, deps);
    assert.deepEqual(result, { ok: false, code: "response_invalid" });
  }
});

test("provider exceptions collapse to a bounded failure without exposing upstream details", async () => {
  const { deps } = dependencies({
    runOpenAi: async () => {
      throw new Error("secret-bearing upstream exception");
    },
  });
  const result = await executeBoundSourcingPipeline({
    workspaceId: WORKSPACE_ID,
    campaign,
    existing: [],
    count: 1,
    binding,
    apiKey: "workspace-bound-provider-key",
    githubToken: "",
    promotedLessons: [],
    beforeExternalCall: async () => true,
  }, deps);
  assert.deepEqual(result, { ok: false, code: "upstream_failed" });
});
