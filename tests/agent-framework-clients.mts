import assert from "node:assert/strict";
import {
  DEERFLOW_SOURCE_COMMIT,
  FLOWISE_SOURCE_COMMIT,
  type AgentFrameworkRuntimeConfiguration,
} from "../src/lib/agents/framework/contracts";
import {
  AgentFrameworkAdapterError,
  importFlowiseWorkflow,
  runDeerFlowProposal,
} from "../src/lib/agents/framework/private-clients";
import { probeAgentFrameworkAdapters } from "../src/lib/agents/framework/runtime-config";

let pass = 0;
const DEERFLOW_TOKEN = "D".repeat(32);
const FLOWISE_TOKEN = "F".repeat(32);
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

function responseAt(url: string, body: unknown, init?: ResponseInit): Response {
  const response = Response.json(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const config: AgentFrameworkRuntimeConfiguration = {
  deerflowUrl: "https://deerflow.service.internal",
  deerflowSourceCommit: DEERFLOW_SOURCE_COMMIT,
  deerflowImageDigest: `registry.internal/deerflow@sha256:${"c".repeat(64)}`,
  flowiseUrl: "https://flowise.service.internal",
  flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
  flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
  flowiseIsolation: "instance-per-workspace",
  configurationSha256: "e".repeat(64),
  readinessWorkspaceId: "20000000-0000-4000-8000-000000000002",
  readinessDeerflowInstanceId: "50000000-0000-4000-8000-000000000005",
  readinessFlowiseInstanceId: "60000000-0000-4000-8000-000000000006",
  executionEnabled: true,
  killSwitch: false,
};

const request = {
  runId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  ownerId: "30000000-0000-4000-8000-000000000003",
  actorId: "30000000-0000-4000-8000-000000000003",
  specId: "40000000-0000-4000-8000-000000000004",
  campaignId: "campaign-a",
  workflowVersionId: "50000000-0000-4000-8000-000000000005",
  campaignFingerprint: "a".repeat(64),
  configurationSha256: "e".repeat(64),
  workflowSha256: "b".repeat(64),
  workflow: {
    version: 1,
    name: "Reviewed sourcing",
    nodes: [
      { id: "plan", kind: "plan" },
      { id: "source", kind: "source_reviewed_campaign" },
      { id: "report", kind: "report" },
    ],
    edges: [
      { from: "plan", to: "source" },
      { from: "source", to: "report" },
    ],
  },
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
  reviewedQueries: [{ platform: "GitHub", query: "language:typescript location:montreal" }],
  deerflowInstanceId: "50000000-0000-4000-8000-000000000005",
  flowiseInstanceId: "60000000-0000-4000-8000-000000000006",
  flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
  flowiseImageDigest: `registry.internal/flowise@sha256:${"d".repeat(64)}`,
  flowiseIsolation: "instance-per-workspace" as const,
  idempotencyKey: "run:campaign-a:1",
  capabilityToken: "t".repeat(32),
};

await test("DeerFlow receives only the strict authority envelope and a server token header", async () => {
  let called = 0;
  const fetcher: typeof fetch = async (input, init) => {
    called += 1;
    assert.equal(String(input), "https://deerflow.service.internal/v1/aria/runs");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${DEERFLOW_TOKEN}`);
    assert.equal(headers.get("x-aria-framework-contract"), "aria.deerflow.run.v1");
    assert.equal(headers.get("x-aria-workspace-id"), request.workspaceId);
    assert.equal(headers.get("x-aria-framework-instance-id"), request.deerflowInstanceId);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, request);
    assert.equal(JSON.stringify(body).includes(DEERFLOW_TOKEN), false);
    return responseAt("https://deerflow.service.internal/v1/aria/runs", {
      runId: request.runId,
      status: "proposed",
      steps: [{
        ordinal: 0,
        nodeId: "source",
        nodeKind: "source_reviewed_campaign",
        requestSha256: "1".repeat(64),
        responseSha256: "2".repeat(64),
      }],
      actions: [{ kind: "report", summary: "No candidate invented." }],
    });
  };
  const proposal = await runDeerFlowProposal(request, config, DEERFLOW_TOKEN, fetcher);
  assert.equal(called, 1);
  assert.equal(proposal.actions[0]?.kind, "report");
});

await test("unsafe runtime configuration fails before network access", async () => {
  let called = false;
  await assert.rejects(
    runDeerFlowProposal(
      request,
      { ...config, deerflowSourceCommit: "main" },
      DEERFLOW_TOKEN,
      async () => {
        called = true;
        return Response.json({});
      },
    ),
    (error: unknown) => error instanceof AgentFrameworkAdapterError && error.code === "framework-not-ready",
  );
  assert.equal(called, false);
});

await test("service tokens shorter than 32 characters fail before network access", async () => {
  let called = false;
  await assert.rejects(
    runDeerFlowProposal(
      request,
      config,
      "t".repeat(31),
      async () => {
        called = true;
        return Response.json({});
      },
    ),
    (error: unknown) =>
      error instanceof AgentFrameworkAdapterError && error.code === "framework-token-invalid",
  );
  assert.equal(called, false);
});

await test("DeerFlow errors and malformed output are sanitized", async () => {
  await assert.rejects(
    runDeerFlowProposal(
      request,
      config,
      DEERFLOW_TOKEN,
      async () => new Response("secret upstream stack and prompt", { status: 500 }),
    ),
    (error: unknown) =>
      error instanceof AgentFrameworkAdapterError &&
      error.code === "deerflow-upstream-error" &&
      !error.message.includes("secret upstream"),
  );
});

await test("Flowise import uses an immutable server binding and compiles only ARIA nodes", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://flowise.service.internal/v1/aria/workflows/flow_123/export");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${FLOWISE_TOKEN}`);
    assert.equal(headers.get("x-aria-workspace-id"), request.workspaceId);
    assert.equal(headers.get("x-aria-framework-instance-id"), "60000000-0000-4000-8000-000000000006");
    return responseAt("https://flowise.service.internal/v1/aria/workflows/flow_123/export", {
      workspaceId: request.workspaceId,
      frameworkInstanceId: "60000000-0000-4000-8000-000000000006",
      sourceCommit: FLOWISE_SOURCE_COMMIT,
      imageDigest: config.flowiseImageDigest,
      workflow: {
        id: "flow_123",
        name: "Reviewed sourcing",
        flowData: JSON.stringify({
          nodes: [
            { id: "plan", data: { ariaKind: "plan" } },
            { id: "source", data: { ariaKind: "source_reviewed_campaign" } },
            { id: "report", data: { ariaKind: "report" } },
          ],
          edges: [
            { source: "plan", target: "source" },
            { source: "source", target: "report" },
          ],
        }),
      },
    });
  };
  const workflow = await importFlowiseWorkflow(
    {
      workspaceId: request.workspaceId,
      frameworkInstanceId: "60000000-0000-4000-8000-000000000006",
      externalWorkflowId: "flow_123",
      expectedName: "Reviewed sourcing",
    },
    config,
    FLOWISE_TOKEN,
    fetcher,
  );
  assert.equal(workflow.version, 1);
  assert.deepEqual(workflow.nodes.map((node) => node.kind), ["plan", "source_reviewed_campaign", "report"]);
});

await test("Flowise imports reject arbitrary tool and code nodes", async () => {
  await assert.rejects(
    importFlowiseWorkflow(
      {
        workspaceId: request.workspaceId,
        frameworkInstanceId: "60000000-0000-4000-8000-000000000006",
        externalWorkflowId: "flow_123",
        expectedName: "Reviewed sourcing",
      },
      config,
      FLOWISE_TOKEN,
      async () => responseAt("https://flowise.service.internal/v1/aria/workflows/flow_123/export", {
        workspaceId: request.workspaceId,
        frameworkInstanceId: "60000000-0000-4000-8000-000000000006",
        sourceCommit: FLOWISE_SOURCE_COMMIT,
        imageDigest: config.flowiseImageDigest,
        workflow: {
          id: "flow_123",
          name: "Reviewed sourcing",
          flowData: JSON.stringify({
            nodes: [{ id: "evil", data: { ariaKind: "custom_javascript", code: "process.env" } }],
            edges: [],
          }),
        },
      }),
    ),
    (error: unknown) => error instanceof AgentFrameworkAdapterError && error.code === "flowise-workflow-rejected",
  );
});

await test("Flowise authoring remains available while framework execution is kill-switched", async () => {
  let called = 0;
  const workflow = await importFlowiseWorkflow(
    {
      workspaceId: request.workspaceId,
      frameworkInstanceId: request.flowiseInstanceId,
      externalWorkflowId: "flow_123",
      expectedName: "Reviewed sourcing",
    },
    { ...config, executionEnabled: false, killSwitch: true },
    FLOWISE_TOKEN,
    async (input) => {
      called += 1;
      return responseAt(String(input), {
        workspaceId: request.workspaceId,
        frameworkInstanceId: request.flowiseInstanceId,
        sourceCommit: FLOWISE_SOURCE_COMMIT,
        imageDigest: config.flowiseImageDigest,
        workflow: {
          id: "flow_123",
          name: "Reviewed sourcing",
          flowData: JSON.stringify({
            nodes: [
              { id: "plan", data: { ariaKind: "plan" } },
              { id: "source", data: { ariaKind: "source_reviewed_campaign" } },
              { id: "report", data: { ariaKind: "report" } },
            ],
            edges: [
              { source: "plan", target: "source" },
              { source: "source", target: "report" },
            ],
          }),
        },
      });
    },
  );
  assert.equal(called, 1);
  assert.equal(workflow.nodes[1]?.kind, "source_reviewed_campaign");
});

await test("readiness verifies exact framework identity and real dependencies", async () => {
  const seen = new Set<string>();
  const ready = await probeAgentFrameworkAdapters(
    config,
    { deerflowToken: DEERFLOW_TOKEN, flowiseToken: FLOWISE_TOKEN },
    async (input, init) => {
      const url = String(input);
      seen.add(url);
      const framework = url.includes("deerflow") ? "deerflow" : "flowise";
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${framework === "deerflow" ? DEERFLOW_TOKEN : FLOWISE_TOKEN}`,
      );
      assert.equal(new Headers(init?.headers).get("x-aria-workspace-id"), config.readinessWorkspaceId);
      return responseAt(url, {
        ok: true,
        framework,
        contract: framework === "deerflow" ? "aria.deerflow.run.v1" : "aria.flowise.import.v1",
        sourceCommit: framework === "deerflow" ? DEERFLOW_SOURCE_COMMIT : FLOWISE_SOURCE_COMMIT,
        imageDigest: framework === "deerflow" ? config.deerflowImageDigest : config.flowiseImageDigest,
        configurationSha256: config.configurationSha256,
        workspaceId: config.readinessWorkspaceId,
        frameworkInstanceId: framework === "deerflow"
          ? config.readinessDeerflowInstanceId
          : config.readinessFlowiseInstanceId,
        dependencies: { database: true, queue: true, worker: true, policy: true },
        ...(framework === "flowise" ? { isolation: "instance-per-workspace" } : {}),
      });
    },
  );
  assert.equal(ready, true);
  assert.deepEqual([...seen].sort(), [
    "https://deerflow.service.internal/readyz",
    "https://flowise.service.internal/readyz",
  ]);
});

await test("deployment health remains probeable while execution is kill-switched", async () => {
  const ready = await probeAgentFrameworkAdapters(
    { ...config, executionEnabled: false, killSwitch: true },
    { deerflowToken: DEERFLOW_TOKEN, flowiseToken: FLOWISE_TOKEN },
    async (input) => {
      const url = String(input);
      const framework = url.includes("deerflow") ? "deerflow" : "flowise";
      return responseAt(url, {
        ok: true,
        framework,
        contract: framework === "deerflow" ? "aria.deerflow.run.v1" : "aria.flowise.import.v1",
        sourceCommit: framework === "deerflow" ? DEERFLOW_SOURCE_COMMIT : FLOWISE_SOURCE_COMMIT,
        imageDigest: framework === "deerflow" ? config.deerflowImageDigest : config.flowiseImageDigest,
        configurationSha256: config.configurationSha256,
        workspaceId: config.readinessWorkspaceId,
        frameworkInstanceId: framework === "deerflow"
          ? config.readinessDeerflowInstanceId
          : config.readinessFlowiseInstanceId,
        dependencies: { database: true, queue: true, worker: true, policy: true },
        ...(framework === "flowise" ? { isolation: "instance-per-workspace" } : {}),
      });
    },
  );
  assert.equal(ready, true);
});

await test("an unconditional ping cannot satisfy framework readiness", async () => {
  const ready = await probeAgentFrameworkAdapters(
    config,
    { deerflowToken: DEERFLOW_TOKEN, flowiseToken: FLOWISE_TOKEN },
    async (input) => responseAt(String(input), { ok: true, message: "pong" }),
  );
  assert.equal(ready, false);
});

await test("redirected adapter responses are rejected before parsing", async () => {
  await assert.rejects(
    runDeerFlowProposal(
      request,
      config,
      DEERFLOW_TOKEN,
      async () => responseAt("https://attacker.example/collect", {
        runId: request.runId,
        status: "proposed",
        steps: [{
          ordinal: 0,
          nodeId: "source",
          nodeKind: "source_reviewed_campaign",
          requestSha256: "1".repeat(64),
          responseSha256: "2".repeat(64),
        }],
        actions: [],
      }),
    ),
    (error: unknown) => error instanceof AgentFrameworkAdapterError && error.code === "deerflow-upstream-error",
  );
});

await test("chunked adapter responses stop at the byte limit", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(1_100_000);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(stream, { status: 200 });
  Object.defineProperty(response, "url", { value: "https://deerflow.service.internal/v1/aria/runs" });
  await assert.rejects(
    runDeerFlowProposal(request, config, DEERFLOW_TOKEN, async () => response),
    (error: unknown) => error instanceof AgentFrameworkAdapterError && error.code === "deerflow-response-invalid",
  );
  assert.equal(cancelled, true);
});

console.log(`RESULT agent-framework-clients: ${pass} passed, 0 failed`);
