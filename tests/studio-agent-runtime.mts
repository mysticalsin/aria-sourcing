import assert from "node:assert/strict";

import {
  acquireStudioRunIdempotencyKey,
  executePrimaryAgentSourcing,
  executeStudioAgentRun,
  resolveCampaignAgentFrameworkSpec,
  resolveStudioCampaign,
  settleStudioRunIdempotencyKey,
} from "../src/lib/agents/studio-runner";

let pass = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const campaigns = [
  { id: "campaign-a", status: "Sourcing", jobAnalysis: { title: "Staff Backend Engineer" } },
  { id: "campaign-b", status: "Paused", jobAnalysis: { title: "Staff Backend Engineer" } },
  { id: "campaign-c", status: "Outreach", jobAnalysis: { title: "Data Engineer" } },
] as const;

await test("campaign selection uses one exact active reviewed need", () => {
  assert.deepEqual(resolveStudioCampaign(" staff backend engineer ", campaigns), {
    ok: true,
    campaignId: "campaign-a",
  });
  assert.deepEqual(resolveStudioCampaign("Unknown role", campaigns), {
    ok: false,
    reason: "No active campaign has this exact reviewed role title.",
  });
});

await test("ambiguous campaign needs fail closed instead of guessing", () => {
  const ambiguous = [
    ...campaigns,
    { id: "campaign-d", status: "Outreach" as const, jobAnalysis: { title: "Staff Backend Engineer" } },
  ];
  assert.deepEqual(resolveStudioCampaign("Staff Backend Engineer", ambiguous), {
    ok: false,
    reason: "More than one active campaign has this role title. Open the campaign you intend to source before running the agent.",
  });
});

function responseAt(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const input = {
  specId: "10000000-0000-4000-8000-000000000001",
  workflowVersionId: "20000000-0000-4000-8000-000000000002",
  campaignId: "campaign-a",
  count: 5,
  idempotencyKey: "30000000-0000-4000-8000-000000000003",
};

await test("a lost persistence acknowledgement reuses one run authority without repeating framework or provider work", async () => {
  const scope = {
    specId: input.specId,
    workflowVersionId: input.workflowVersionId,
    campaignId: input.campaignId,
  };
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  };
  const firstMemory = new Map<string, string>();
  const firstKey = acquireStudioRunIdempotencyKey(
    scope,
    firstMemory,
    storage,
    () => input.idempotencyKey,
  );
  const frameworkRuns = new Map<string, string>();
  const requestKeys: string[] = [];
  let frameworkExecutions = 0;
  let providerSearches = 0;
  let staged = false;
  const fetcher: typeof fetch = async (_url, init) => {
    const key = new Headers(init?.headers).get("idempotency-key") ?? "";
    requestKeys.push(key);
    if (!frameworkRuns.has(key)) {
      frameworkExecutions += 1;
      frameworkRuns.set(key, "40000000-0000-4000-8000-000000000004");
    }
    return responseAt({
      ok: true,
      runId: frameworkRuns.get(key),
      reports: [],
      command: {
        kind: "source_reviewed_campaign",
        campaignId: input.campaignId,
        count: input.count,
        query: "language:typescript",
        capabilityToken: "s".repeat(43),
      },
      requestId: "req-reconcile",
    });
  };
  const sourceNextBatch = async () => {
    if (!staged) {
      staged = true;
      providerSearches += 1;
      return {
        ok: false as const,
        error: "Candidates were saved, but the framework persistence receipt could not be confirmed. Retry this run to reconcile it.",
        source: "unavailable" as const,
        retryable: "agent_framework_reconcile" as const,
      };
    }
    return {
      ok: true as const,
      source: "github" as const,
      accepted: [],
      skipped: [{ reason: "already persisted" }],
    };
  };

  const first = await executeStudioAgentRun({
    ...input,
    idempotencyKey: firstKey,
    fetcher,
    sourceNextBatch,
  });
  assert.deepEqual(first, {
    ok: false,
    error: "Candidates were saved, but the framework persistence receipt could not be confirmed. Retry this run to reconcile it.",
    retryable: "agent_framework_reconcile",
  });
  settleStudioRunIdempotencyKey(scope, first, firstMemory, storage);
  assert.equal(stored.size, 1);
  assert.equal(JSON.stringify([...stored]).includes("s".repeat(43)), false);

  // Model a page reload: in-memory state is gone, but the non-secret UUID
  // remains in session storage. The capability token is never stored there.
  const reloadedMemory = new Map<string, string>();
  const secondKey = acquireStudioRunIdempotencyKey(
    scope,
    reloadedMemory,
    storage,
    () => "50000000-0000-4000-8000-000000000005",
  );
  const recovered = await executeStudioAgentRun({
    ...input,
    idempotencyKey: secondKey,
    fetcher,
    sourceNextBatch,
  });
  settleStudioRunIdempotencyKey(scope, recovered, reloadedMemory, storage);

  assert.equal(secondKey, firstKey);
  assert.deepEqual(requestKeys, [firstKey, firstKey]);
  assert.equal(frameworkExecutions, 1);
  assert.equal(providerSearches, 1);
  assert.equal(recovered.ok, true);
  assert.equal(stored.size, 0);

  const nextKey = acquireStudioRunIdempotencyKey(
    scope,
    reloadedMemory,
    storage,
    () => "50000000-0000-4000-8000-000000000005",
  );
  assert.equal(nextKey, "50000000-0000-4000-8000-000000000005");
  settleStudioRunIdempotencyKey(
    scope,
    { ok: false, error: "The agent framework did not authorize this sourcing run." },
    reloadedMemory,
    storage,
  );
  assert.equal(stored.size, 0);
});

await test("approved framework command invokes canonical real sourcing and reports persisted result", async () => {
  let request: { url: string; init?: RequestInit } | null = null;
  let sourced = 0;
  const result = await executeStudioAgentRun({
    ...input,
    fetcher: async (url, init) => {
      request = { url: String(url), init };
      return responseAt({
        ok: true,
        runId: "40000000-0000-4000-8000-000000000004",
        reports: ["Exact reviewed campaign query approved."],
        command: {
          kind: "source_reviewed_campaign",
          campaignId: "campaign-a",
          count: 5,
          query: "language:typescript location:montreal",
          capabilityToken: "s".repeat(43),
        },
        requestId: "req-1",
      });
    },
    sourceNextBatch: async (campaignId, options) => {
      sourced += 1;
      assert.equal(campaignId, "campaign-a");
      assert.deepEqual(options, {
        count: 5,
        agentFramework: {
          runId: "40000000-0000-4000-8000-000000000004",
          capabilityToken: "s".repeat(43),
          query: "language:typescript location:montreal",
        },
      });
      return {
        ok: true,
        source: "github",
        accepted: [{ id: "real-candidate" }],
        skipped: [{ reason: "duplicate" }],
      };
    },
  });

  assert.equal(request?.url, "/api/agents/run");
  assert.equal(request?.init?.method, "POST");
  assert.equal(new Headers(request?.init?.headers).get("idempotency-key"), input.idempotencyKey);
  assert.equal(sourced, 1);
  assert.deepEqual(result, {
    ok: true,
    runId: "40000000-0000-4000-8000-000000000004",
    accepted: 1,
    skipped: 1,
    source: "github",
    reports: ["Exact reviewed campaign query approved."],
    candidates: [{ id: "real-candidate" }],
  });
});

await test("wrong or malformed framework commands never call sourcing", async () => {
  for (const body of [
    {
      ok: true,
      runId: "40000000-0000-4000-8000-000000000004",
      reports: [],
      command: { kind: "source_reviewed_campaign", campaignId: "campaign-other", count: 5, query: "language:typescript", capabilityToken: "s".repeat(43) },
      requestId: "req-2",
    },
    {
      ok: true,
      runId: "40000000-0000-4000-8000-000000000004",
      reports: [],
      command: { kind: "invent_candidates", campaignId: "campaign-a", count: 5, query: "language:typescript", capabilityToken: "s".repeat(43) },
      requestId: "req-3",
    },
    { ok: true, command: null },
  ]) {
    let sourced = false;
    const result = await executeStudioAgentRun({
      ...input,
      fetcher: async () => responseAt(body),
      sourceNextBatch: async () => {
        sourced = true;
        throw new Error("must not source");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(sourced, false);
  }
});

await test("canonical sourcing failures and empty real searches stay honest", async () => {
  const frameworkResponse = () => responseAt({
    ok: true,
    runId: "40000000-0000-4000-8000-000000000004",
    reports: [],
    command: { kind: "source_reviewed_campaign", campaignId: "campaign-a", count: 5, query: "language:typescript", capabilityToken: "s".repeat(43) },
    requestId: "req-4",
  });

  const failed = await executeStudioAgentRun({
    ...input,
    fetcher: frameworkResponse,
    sourceNextBatch: async () => ({ ok: false, error: "Provider unavailable.", source: "unavailable" }),
  });
  assert.deepEqual(failed, { ok: false, error: "Provider unavailable." });

  const empty = await executeStudioAgentRun({
    ...input,
    fetcher: frameworkResponse,
    sourceNextBatch: async () => ({ ok: true, source: "github", accepted: [], skipped: [] }),
  });
  assert.deepEqual(empty, {
    ok: true,
    runId: "40000000-0000-4000-8000-000000000004",
    accepted: 0,
    skipped: 0,
    source: "github",
    reports: [],
    candidates: [],
  });
});

const approvedSpec = {
  id: "60000000-0000-4000-8000-000000000006",
  role_brief: { title: "Staff Backend Engineer" },
  runtime_eligible: true,
  runtime_reason: null,
  workflowVersionId: "70000000-0000-4000-8000-000000000007",
  workflowName: "Reviewed backend sourcing",
  workflowSha256: "a".repeat(64),
};

await test("primary agent selection fails closed for missing, disabled, or ambiguous approved workflows", () => {
  assert.equal(resolveCampaignAgentFrameworkSpec("Staff Backend Engineer", []).ok, false);
  assert.equal(resolveCampaignAgentFrameworkSpec("Staff Backend Engineer", [{
    ...approvedSpec,
    runtime_eligible: false,
    runtime_reason: "Framework runtime is disabled.",
  }]).ok, false);
  const ambiguous = resolveCampaignAgentFrameworkSpec("Staff Backend Engineer", [
    approvedSpec,
    { ...approvedSpec, id: "80000000-0000-4000-8000-000000000008" },
  ]);
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.match(ambiguous.error, /more than one/i);
});

await test("primary Run Aria executes one approved framework before using its persisted real candidates", async () => {
  const urls: string[] = [];
  const sourceOptions: unknown[] = [];
  const stored = new Map<string, string>();
  const result = await executePrimaryAgentSourcing({
    campaignId: "campaign-a",
    campaignTitle: "Staff Backend Engineer",
    count: 6,
    demoAuthorized: false,
    idempotencyMemory: new Map(),
    retryStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => { stored.set(key, value); },
      removeItem: (key) => { stored.delete(key); },
    },
    createUuid: () => "90000000-0000-4000-8000-000000000009",
    fetcher: async (url) => {
      urls.push(String(url));
      if (String(url) === "/api/agents/specs") {
        return responseAt({ ok: true, specs: [approvedSpec] });
      }
      return responseAt({
        ok: true,
        runId: "a0000000-0000-4000-8000-00000000000a",
        reports: ["Reviewed query authorized."],
        command: {
          kind: "source_reviewed_campaign",
          campaignId: "campaign-a",
          count: 6,
          query: "language:typescript location:montreal",
          capabilityToken: "s".repeat(43),
        },
        requestId: "req-primary",
      });
    },
    sourceNextBatch: async (_campaignId, options) => {
      sourceOptions.push(options);
      return {
        ok: true,
        source: "github",
        accepted: [{ id: "persisted-real-candidate" }],
        skipped: [],
      };
    },
  });

  assert.deepEqual(urls, ["/api/agents/specs", "/api/agents/run"]);
  assert.equal(sourceOptions.length, 1);
  assert.deepEqual(sourceOptions[0], {
    count: 6,
    agentFramework: {
      runId: "a0000000-0000-4000-8000-00000000000a",
      capabilityToken: "s".repeat(43),
      query: "language:typescript location:montreal",
    },
  });
  assert.deepEqual(result, {
    ok: true,
    mode: "framework",
    candidates: [{ id: "persisted-real-candidate" }],
    skipped: 0,
    source: "github",
    reports: ["Reviewed query authorized."],
  });
  assert.equal(stored.size, 0);
});

await test("missing or framework-disabled primary authority performs zero sourcing", async () => {
  for (const specs of [
    [],
    [{ ...approvedSpec, runtime_eligible: false, runtime_reason: "Framework runtime is disabled." }],
  ]) {
    let sourced = 0;
    const result = await executePrimaryAgentSourcing({
      campaignId: "campaign-a",
      campaignTitle: "Staff Backend Engineer",
      count: 6,
      demoAuthorized: false,
      idempotencyMemory: new Map(),
      retryStorage: null,
      fetcher: async () => responseAt({ ok: true, specs }),
      sourceNextBatch: async () => {
        sourced += 1;
        throw new Error("must not source");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(sourced, 0);
  }
});

await test("synthetic Talent Pool sourcing is reachable only with explicit demo authority", async () => {
  let demoCalls = 0;
  let fetchCalls = 0;
  const demo = await executePrimaryAgentSourcing({
    campaignId: "campaign-a",
    campaignTitle: "Staff Backend Engineer",
    count: 6,
    demoAuthorized: true,
    idempotencyMemory: new Map(),
    retryStorage: null,
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("framework must not run in authorized demo mode");
    },
    sourceNextBatch: async (_campaignId, options) => {
      demoCalls += 1;
      assert.deepEqual(options, { count: 6, platform: "Talent Pool" });
      return { ok: true, source: "mock", accepted: [], skipped: [] };
    },
  });
  assert.equal(demo.ok, true);
  assert.equal(demoCalls, 1);
  assert.equal(fetchCalls, 0);

  let unauthorizedSourceCalls = 0;
  const unauthorized = await executePrimaryAgentSourcing({
    campaignId: "campaign-a",
    campaignTitle: "Staff Backend Engineer",
    count: 6,
    demoAuthorized: false,
    idempotencyMemory: new Map(),
    retryStorage: null,
    fetcher: async () => responseAt({ ok: true, specs: [] }),
    sourceNextBatch: async () => {
      unauthorizedSourceCalls += 1;
      return { ok: true, source: "mock", accepted: [], skipped: [] };
    },
  });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorizedSourceCalls, 0);
});

console.log(`RESULT studio-agent-runtime: ${pass} passed, 0 failed`);
