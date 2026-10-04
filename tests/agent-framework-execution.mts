import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { executeAgentFrameworkRun } from "../src/lib/agents/framework/execution";
import {
  DEERFLOW_SOURCE_COMMIT,
  FLOWISE_SOURCE_COMMIT,
  type AgentFrameworkRuntimeConfiguration,
} from "../src/lib/agents/framework/contracts";
import type { FrameworkRpcClient } from "../src/lib/agents/framework/authority";

let pass = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const runtime: AgentFrameworkRuntimeConfiguration = {
  deerflowUrl: "https://deerflow.service.internal",
  deerflowSourceCommit: DEERFLOW_SOURCE_COMMIT,
  deerflowImageDigest: `registry.internal/deerflow@sha256:${"a".repeat(64)}`,
  flowiseUrl: "https://flowise.service.internal",
  flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
  flowiseImageDigest: `registry.internal/flowise@sha256:${"b".repeat(64)}`,
  flowiseIsolation: "instance-per-workspace",
  configurationSha256: "c".repeat(64),
  executionEnabled: true,
  killSwitch: false,
};

const workflow = {
  version: 1 as const,
  name: "Reviewed sourcing",
  nodes: [
    { id: "plan", kind: "plan" as const },
    { id: "source", kind: "source_reviewed_campaign" as const },
    { id: "report", kind: "report" as const },
  ],
  edges: [
    { from: "plan", to: "source" },
    { from: "source", to: "report" },
  ],
};

const memoryContent = "Prefer reviewed TypeScript community signals.";
const memoryContentSha256 = createHash("sha256").update(memoryContent, "utf8").digest("hex");

function responseAt(url: string, body: unknown): Response {
  const response = Response.json(body);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function harness(overrides?: {
  configurationSha256?: string;
  mutationStatus?: string;
  egressAuthorizeStatus?: string;
  egressExpiresAt?: string;
  egressReleaseStatus?: string;
  recovery?: boolean;
  recoveryReports?: unknown;
  workflow?: typeof workflow | { version: 1; name: string; nodes: Array<{ id: string; kind: "report" }>; edges: [] };
}) {
  const calls: string[] = [];
  const rpcArgs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: FrameworkRpcClient = {
    async rpc(name, args) {
      calls.push(name);
      rpcArgs.push({ name, args });
      if (name === "claim_agent_framework_run") {
        if (overrides?.recovery) {
          return {
            error: null,
            data: {
              status: "already_completed",
              run_id: "10000000-0000-4000-8000-000000000001",
              run_status: "proposed",
              source_query: "language:typescript location:montreal",
              sourcing_count: 5,
              reports: Object.prototype.hasOwnProperty.call(overrides, "recoveryReports")
                ? overrides?.recoveryReports
                : ["Run the exact reviewed campaign query."],
            },
          };
        }
        return {
          error: null,
          data: {
            status: "claimed",
            run_id: "10000000-0000-4000-8000-000000000001",
            lease_id: "20000000-0000-4000-8000-000000000002",
            lease_expires_at: "2026-07-14T20:00:00.000Z",
            configuration_sha256: overrides?.configurationSha256 ?? runtime.configurationSha256,
            workflow_version_id: "30000000-0000-4000-8000-000000000003",
            workflow_sha256: "d".repeat(64),
            workflow: overrides?.workflow ?? workflow,
            deerflow_instance_id: "40000000-0000-4000-8000-000000000004",
            deerflow_source_commit: runtime.deerflowSourceCommit,
            deerflow_image_digest: runtime.deerflowImageDigest,
            deerflow_readiness_sha256: "e".repeat(64),
            flowise_instance_id: "50000000-0000-4000-8000-000000000005",
            flowise_source_commit: runtime.flowiseSourceCommit,
            flowise_image_digest: runtime.flowiseImageDigest,
            flowise_isolation_mode: runtime.flowiseIsolation,
            flowise_readiness_sha256: "f".repeat(64),
          },
        };
      }
      if (name === "authorize_agent_framework_memory_egress") {
        return {
          error: null,
          data: overrides?.egressAuthorizeStatus === undefined
            ? {
                status: "authorized",
                egress_lease_id: "b0000000-0000-4000-8000-000000000001",
                expires_at: overrides?.egressExpiresAt ?? "2099-07-14T20:01:15.000Z",
                replayed: false,
              }
            : { status: overrides.egressAuthorizeStatus },
        };
      }
      if (name === "release_agent_framework_memory_egress") {
        return {
          error: null,
          data: { status: overrides?.egressReleaseStatus ?? "released" },
        };
      }
      const defaultStatus = name === "record_agent_framework_step_receipt"
        ? "recorded"
        : name === "complete_agent_framework_run"
          ? "proposed"
          : "failed";
      return { data: { status: overrides?.mutationStatus ?? defaultStatus }, error: null };
    },
  };
  return { client, calls, rpcArgs };
}

const baseInput: Omit<
  Parameters<typeof executeAgentFrameworkRun>[0],
  "client" | "revalidateAuthority" | "fetcher"
> = {
  runtime,
  deerflowToken: "private-deerflow-token-at-least-32-characters",
  capabilitySecret: "framework-capability-secret-value-1234567890",
  workspaceId: "60000000-0000-4000-8000-000000000006",
  ownerId: "70000000-0000-4000-8000-000000000007",
  actorId: "70000000-0000-4000-8000-000000000007",
  specId: "80000000-0000-4000-8000-000000000008",
  campaignId: "campaign-a",
  campaignFingerprint: "1".repeat(64),
  workflowVersionId: "30000000-0000-4000-8000-000000000003",
  idempotencyKey: "90000000-0000-4000-8000-000000000009",
  reviewedGithubQueries: ["language:typescript location:montreal"],
  need: {
    title: "Staff Backend Engineer",
    seniority: "Staff",
    employmentType: "Full-time",
    locationType: "Hybrid",
    location: "Montreal",
    regions: ["Canada"],
    requiredSkills: ["TypeScript", "Postgres"],
    niceToHaveSkills: [],
    minYearsExperience: 7,
    maxYearsExperience: null,
    industryExperience: ["SaaS"],
  },
  sourcingCount: 5,
  loadMemoryContext: async (_scope, _runId) => ({
    items: [{
      memoryId: "a0000000-0000-4000-8000-000000000001",
      kind: "preference",
      content: memoryContent,
    }],
    receipts: [{
      memoryId: "a0000000-0000-4000-8000-000000000001",
      memoryRevision: 2,
      contentSha256: memoryContentSha256,
      position: 0,
      byteCount: 45,
    }],
    totalBytes: 45,
  }),
};

function proposal(query = "language:typescript location:montreal") {
  return {
    runId: "10000000-0000-4000-8000-000000000001",
    status: "proposed",
    steps: workflow.nodes.map((node, ordinal) => ({
      ordinal,
      nodeId: node.id,
      nodeKind: node.kind,
      requestSha256: String(ordinal + 2).repeat(64),
      responseSha256: String(ordinal + 5).repeat(64),
    })),
    actions: [
      { kind: "source_query", platform: "GitHub", query },
      { kind: "report", summary: "Run the exact reviewed campaign query." },
    ],
  };
}

await test("DeerFlow executes an approved Flowise workflow and can request only exact reviewed sourcing", async () => {
  const { client, calls, rpcArgs } = harness();
  let authorityChecks = 0;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => {
      authorityChecks += 1;
      return true;
    },
    fetcher: async (input, init) => {
      assert.equal(calls.at(-1), "authorize_agent_framework_memory_egress");
      assert.equal(String(input), "https://deerflow.service.internal/v1/aria/runs");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.workflow, workflow);
      assert.equal(body.need.title, "Staff Backend Engineer");
      assert.deepEqual(body.reviewedQueries, [{ platform: "GitHub", query: "language:typescript location:montreal" }]);
      assert.deepEqual(body.agentMemory.items, [{
        kind: "preference",
        content: "Prefer reviewed TypeScript community signals.",
      }]);
      assert.equal(body.agentMemory.policy, "untrusted-reference-v1");
      assert.match(body.agentMemory.receiptSha256, /^[0-9a-f]{64}$/);
      assert.equal(body.flowiseInstanceId, "50000000-0000-4000-8000-000000000005");
      assert.equal(JSON.stringify(body).includes("candidate"), false);
      return responseAt(String(input), proposal());
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected framework execution success");
  assert.match(result.sourcingCapabilityToken, /^[A-Za-z0-9_-]{43}$/);
  const { sourcingCapabilityToken: _token, ...receipt } = result;
  assert.deepEqual(receipt, {
    ok: true,
    runId: "10000000-0000-4000-8000-000000000001",
    sourceReviewedCampaign: true,
    sourceQuery: "language:typescript location:montreal",
    reports: ["Run the exact reviewed campaign query."],
  });
  assert.equal(calls.filter((name) => name === "record_agent_framework_step_receipt").length, 3);
  assert.equal(calls.filter((name) => name === "release_agent_framework_memory_egress").length, 1);
  assert.equal(calls.at(-1), "complete_agent_framework_run");
  const completion = rpcArgs.at(-1);
  assert.equal(completion?.name, "complete_agent_framework_run");
  assert.equal(completion?.args.p_run_id, "10000000-0000-4000-8000-000000000001");
  assert.equal(completion?.args.p_lease_id, "20000000-0000-4000-8000-000000000002");
  assert.match(String(completion?.args.p_proposal_sha256), /^[0-9a-f]{64}$/);
  assert.match(String(completion?.args.p_sourcing_capability_sha256), /^[0-9a-f]{64}$/);
  assert.equal(completion?.args.p_sourcing_count, 5);
  assert.equal(completion?.args.p_source_query, "language:typescript location:montreal");
  assert.deepEqual(completion?.args.p_reports, ["Run the exact reviewed campaign query."]);
  assert.equal(authorityChecks, 3, "authority must be checked before memory, before egress, and after response");
});

await test("lost framework responses recover the same deterministic sourcing authority without adapter egress", async () => {
  const first = harness();
  const initial = await executeAgentFrameworkRun({
    ...baseInput,
    client: first.client,
    revalidateAuthority: async () => true,
    fetcher: async (input) => responseAt(String(input), proposal()),
  });
  assert.equal(initial.ok, true);
  if (!initial.ok) throw new Error("expected initial framework execution success");

  const recovered = harness({ recovery: true });
  let fetched = false;
  const replay = await executeAgentFrameworkRun({
    ...baseInput,
    client: recovered.client,
    revalidateAuthority: async () => true,
    fetcher: async () => {
      fetched = true;
      throw new Error("recovery must not call DeerFlow");
    },
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) throw new Error("expected framework recovery success");
  assert.equal(fetched, false);
  assert.deepEqual(replay, initial);
  assert.deepEqual(recovered.calls, ["claim_agent_framework_run"]);
});

await test("memory plaintext drift fails before adapter egress and records the run failure", async () => {
  const { client, calls } = harness();
  const tamperedMemoryContent = "Prefer reviewed JavaScript community signals.";
  let fetched = false;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    loadMemoryContext: async () => ({
      items: [{
        memoryId: "a0000000-0000-4000-8000-000000000001",
        kind: "preference",
        content: tamperedMemoryContent,
      }],
      receipts: [{
        memoryId: "a0000000-0000-4000-8000-000000000001",
        memoryRevision: 2,
        contentSha256: memoryContentSha256,
        position: 0,
        byteCount: Buffer.byteLength(tamperedMemoryContent, "utf8"),
      }],
      totalBytes: Buffer.byteLength(tamperedMemoryContent, "utf8"),
    }),
    revalidateAuthority: async () => true,
    fetcher: async () => {
      fetched = true;
      return responseAt("https://deerflow.service.internal/v1/aria/runs", proposal());
    },
  });
  assert.deepEqual(result, { ok: false, code: "framework_unavailable" });
  assert.equal(fetched, false);
  assert.deepEqual(calls, ["claim_agent_framework_run", "fail_agent_framework_run"]);
});

await test("completed-run recovery fails closed when the durable reports are malformed", async () => {
  const recovered = harness({ recovery: true, recoveryReports: [""] });
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client: recovered.client,
    revalidateAuthority: async () => true,
    fetcher: async () => {
      throw new Error("invalid recovery must not call DeerFlow");
    },
  });
  assert.deepEqual(result, { ok: false, code: "authority_unavailable" });
  assert.deepEqual(recovered.calls, ["claim_agent_framework_run"]);
});

await test("a proposal without the approved reviewed-sourcing workflow cannot complete", async () => {
  const { client } = harness();
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async (input) => responseAt(String(input), {
      runId: "10000000-0000-4000-8000-000000000001",
      status: "proposed",
      steps: [{
        ordinal: 0,
        nodeId: "report",
        nodeKind: "report",
        requestSha256: "2".repeat(64),
        responseSha256: "5".repeat(64),
      }],
      actions: [{ kind: "report", summary: "Nothing sourced." }],
    }),
  });
  assert.deepEqual(result, { ok: false, code: "proposal_invalid" });
});

await test("an invented query or candidate action fails before becoming sourcing authority", async () => {
  const { client, calls } = harness();
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async (input) => responseAt(String(input), proposal("language:rust location:unknown")),
  });
  assert.deepEqual(result, { ok: false, code: "proposal_invalid" });
  assert.equal(calls.includes("record_agent_framework_step_receipt"), false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("a proposal must contain exactly one report action", async () => {
  const invalidActions = [
    [{
      kind: "source_query",
      platform: "GitHub",
      query: "language:typescript location:montreal",
    }],
    [
      {
        kind: "source_query",
        platform: "GitHub",
        query: "language:typescript location:montreal",
      },
      { kind: "report", summary: "First report." },
      { kind: "report", summary: "Second report." },
    ],
  ];
  for (const actions of invalidActions) {
    const { client, calls } = harness();
    const malformed = { ...proposal(), actions };
    const result = await executeAgentFrameworkRun({
      ...baseInput,
      client,
      revalidateAuthority: async () => true,
      fetcher: async (input) => responseAt(String(input), malformed),
    });
    assert.deepEqual(result, { ok: false, code: "proposal_invalid" });
    assert.equal(calls.includes("record_agent_framework_step_receipt"), false);
    assert.equal(calls.at(-1), "fail_agent_framework_run");
  }
});

await test("database and environment provenance mismatch fails before adapter egress", async () => {
  const { client, calls } = harness({ configurationSha256: "0".repeat(64) });
  let fetched = false;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async () => {
      fetched = true;
      return responseAt("https://deerflow.service.internal/v1/aria/runs", proposal());
    },
  });
  assert.deepEqual(result, { ok: false, code: "configuration_invalid" });
  assert.equal(fetched, false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("authority revocation before memory selection blocks plaintext access and adapter egress", async () => {
  const { client, calls } = harness();
  let loadedMemory = false;
  let fetched = false;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    loadMemoryContext: async (...args) => {
      loadedMemory = true;
      return baseInput.loadMemoryContext(...args);
    },
    revalidateAuthority: async () => false,
    fetcher: async () => {
      fetched = true;
      return responseAt("https://deerflow.service.internal/v1/aria/runs", proposal());
    },
  });
  assert.deepEqual(result, { ok: false, code: "authority_changed" });
  assert.equal(loadedMemory, false);
  assert.equal(fetched, false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("authority revocation after memory selection blocks plaintext adapter egress", async () => {
  const { client, calls } = harness();
  let authorityChecks = 0;
  let loadedMemory = false;
  let fetched = false;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    loadMemoryContext: async (...args) => {
      loadedMemory = true;
      return baseInput.loadMemoryContext(...args);
    },
    revalidateAuthority: async () => {
      authorityChecks += 1;
      return authorityChecks === 1;
    },
    fetcher: async () => {
      fetched = true;
      return responseAt("https://deerflow.service.internal/v1/aria/runs", proposal());
    },
  });
  assert.deepEqual(result, { ok: false, code: "authority_changed" });
  assert.equal(loadedMemory, true);
  assert.equal(fetched, false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("authority revocation during DeerFlow work blocks every receipt and effect", async () => {
  const { client, calls } = harness();
  let authorityChecks = 0;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => {
      authorityChecks += 1;
      return authorityChecks < 3;
    },
    fetcher: async (input) => responseAt(String(input), proposal()),
  });
  assert.deepEqual(result, { ok: false, code: "authority_changed" });
  assert.equal(calls.includes("record_agent_framework_step_receipt"), false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("memory egress authorization failure blocks plaintext before adapter egress", async () => {
  const { client, calls } = harness({ egressAuthorizeStatus: "memory_changed" });
  let fetched = false;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async () => {
      fetched = true;
      return responseAt("https://deerflow.service.internal/v1/aria/runs", proposal());
    },
  });
  assert.deepEqual(result, { ok: false, code: "authority_changed" });
  assert.equal(fetched, false);
  assert.equal(calls.includes("release_agent_framework_memory_egress"), false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("a near-expiry memory egress authorization blocks plaintext before adapter egress", async () => {
  const { client, calls } = harness({
    egressExpiresAt: new Date(Date.now() + 30_000).toISOString(),
  });
  let fetched = false;
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async () => {
      fetched = true;
      return responseAt("https://deerflow.service.internal/v1/aria/runs", proposal());
    },
  });
  assert.deepEqual(result, { ok: false, code: "framework_unavailable" });
  assert.equal(fetched, false);
  assert.equal(calls.includes("release_agent_framework_memory_egress"), false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("memory egress lease release failure prevents proposal receipts and effects", async () => {
  const { client, calls } = harness({ egressReleaseStatus: "authority_unavailable" });
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async (input) => responseAt(String(input), proposal()),
  });
  assert.deepEqual(result, { ok: false, code: "framework_unavailable" });
  assert.equal(calls.includes("record_agent_framework_step_receipt"), false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

await test("an expired memory egress lease prevents proposal receipts and effects", async () => {
  const { client, calls } = harness({ egressReleaseStatus: "lease_expired" });
  const result = await executeAgentFrameworkRun({
    ...baseInput,
    client,
    revalidateAuthority: async () => true,
    fetcher: async (input) => responseAt(String(input), proposal()),
  });
  assert.deepEqual(result, { ok: false, code: "framework_unavailable" });
  assert.equal(calls.includes("record_agent_framework_step_receipt"), false);
  assert.equal(calls.at(-1), "fail_agent_framework_run");
});

console.log(`RESULT agent-framework-execution: ${pass} passed, 0 failed`);
