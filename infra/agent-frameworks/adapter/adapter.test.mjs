import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import {
  DEERFLOW_SOURCE_COMMIT,
  FLOWISE_SOURCE_COMMIT,
  adapterBindHostFromEnvironment,
  createAdapterRequestListener as createRawAdapterRequestListener,
  internalRedisUrlFromEnvironment,
  probeModelGatewayReadiness,
  probeRedisQueue,
} from "./server.mjs";
import { signAgentFrameworkRequestCapabilityCore } from "../../../src/lib/agents/framework/capability-core.mjs";
import { deriveAgentFrameworkConfiguration } from "../../../src/lib/agents/framework/configuration-core.mjs";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const INSTANCE_ID = "20000000-0000-4000-8000-000000000002";
const FLOWISE_INSTANCE_ID = "30000000-0000-4000-8000-000000000003";
const FLOW_ID = "flow_123";
const ADAPTER_TOKEN = "adapter-token-at-least-32-characters-long";
const UPSTREAM_TOKEN = "upstream-token-at-least-32-characters-long";
const MODEL_GATEWAY_TOKEN = "model-gateway-token-at-least-32-characters-long";
const CAPABILITY_SECRET = "capability-secret-at-least-32-characters-long"; // gitleaks:allow - deterministic test fixture
const DEERFLOW_IMAGE = `registry.internal/deerflow@sha256:${"a".repeat(64)}`;
const FLOWISE_IMAGE = `registry.internal/flowise@sha256:${"b".repeat(64)}`;
const FLOWISE_WORKSPACE_ID = "90000000-0000-4000-8000-000000000009";
const CONFIGURATION_INPUT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  adapterImageDigest: `registry.internal/adapter@sha256:${"1".repeat(64)}`,
  redisImageDigest: `registry.internal/redis@sha256:${"2".repeat(64)}`,
  deerflowAdapterOrigin: "https://deerflow.service.internal",
  deerflowInstanceId: INSTANCE_ID,
  deerflowSourceCommit: DEERFLOW_SOURCE_COMMIT,
  deerflowImageDigest: DEERFLOW_IMAGE,
  deerflowDatabaseImageDigest: `registry.internal/postgres-deerflow@sha256:${"3".repeat(64)}`,
  deerflowModelGatewayImageDigest: `registry.internal/model-gateway@sha256:${"6".repeat(64)}`,
  deerflowCloudProviderId: "openai",
  deerflowModelProvider: "langchain-openai",
  deerflowModelId: "gpt-test",
  deerflowModelBaseUrl: "https://model-gateway.service.internal/v1",
  deerflowModelCredentialVersion: "model-key-v1",
  flowiseAdapterOrigin: "https://flowise.service.internal",
  flowiseInstanceId: FLOWISE_INSTANCE_ID,
  flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
  flowiseImageDigest: FLOWISE_IMAGE,
  flowiseWorkerImageDigest: `registry.internal/flowise-worker@sha256:${"4".repeat(64)}`,
  flowiseDatabaseImageDigest: `registry.internal/postgres-flowise@sha256:${"5".repeat(64)}`,
  flowiseWorkspaceId: FLOWISE_WORKSPACE_ID,
  flowiseReadinessWorkflowId: FLOW_ID,
  flowiseIsolation: "instance-per-workspace",
  flowiseQueueName: "aria-flowise",
});
const CONFIGURATION_SHA = deriveAgentFrameworkConfiguration(CONFIGURATION_INPUT).sha256;

function withConfiguration(config) {
  return {
    ...config,
    ...(config.mode === "deerflow" ? { modelGatewayToken: MODEL_GATEWAY_TOKEN } : {}),
    frameworkInstanceId: config.mode === "flowise" ? FLOWISE_INSTANCE_ID : INSTANCE_ID,
    configurationSha256: CONFIGURATION_SHA,
    configurationInput: CONFIGURATION_INPUT,
  };
}

function createAdapterRequestListener(config, dependencies) {
  return createRawAdapterRequestListener(withConfiguration(config), dependencies);
}

const workflow = {
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
};

const runRequestWithoutCapability = {
  runId: "40000000-0000-4000-8000-000000000004",
  workspaceId: WORKSPACE_ID,
  ownerId: "50000000-0000-4000-8000-000000000005",
  actorId: "50000000-0000-4000-8000-000000000005",
  specId: "60000000-0000-4000-8000-000000000006",
  campaignId: "campaign-a",
  workflowVersionId: "70000000-0000-4000-8000-000000000007",
  campaignFingerprint: "c".repeat(64),
  configurationSha256: CONFIGURATION_SHA,
  workflowSha256: "e".repeat(64),
  workflow,
  need: {
    title: "Staff Backend Engineer",
    seniority: "Staff",
    employmentType: "Full-time",
    locationType: "Hybrid",
    location: "Montreal",
    regions: ["Canada"],
    requiredSkills: ["TypeScript", "Postgres"],
    niceToHaveSkills: ["Redis"],
    minYearsExperience: 7,
    maxYearsExperience: null,
    industryExperience: ["SaaS"],
  },
  reviewedQueries: [
    { platform: "GitHub", query: "language:typescript location:montreal" },
    { platform: "GitHub", query: "language:typescript topic:postgres location:canada" },
  ],
  agentMemory: {
    policy: "untrusted-reference-v1",
    receiptSha256: "f".repeat(64),
    items: [{ kind: "preference", content: "Prefer reviewed TypeScript community signals." }],
  },
  deerflowInstanceId: INSTANCE_ID,
  flowiseInstanceId: FLOWISE_INSTANCE_ID,
  flowiseSourceCommit: FLOWISE_SOURCE_COMMIT,
  flowiseImageDigest: FLOWISE_IMAGE,
  flowiseIsolation: "instance-per-workspace",
  idempotencyKey: "80000000-0000-4000-8000-000000000008",
};

const runRequest = {
  ...runRequestWithoutCapability,
  capabilityToken: signAgentFrameworkRequestCapabilityCore(
    CAPABILITY_SECRET,
    runRequestWithoutCapability,
  ),
};

async function listen(listener) {
  const server = http.createServer(listener);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    },
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function adapterHeaders(contract) {
  return {
    authorization: `Bearer ${ADAPTER_TOKEN}`,
    "x-aria-framework-contract": contract,
    "x-aria-workspace-id": WORKSPACE_ID,
    "x-aria-framework-instance-id": contract === "aria.flowise.import.v1" ? FLOWISE_INSTANCE_ID : INSTANCE_ID,
  };
}

test("adapter startup rejects a self-asserted receipt, manifest drift, and model alias drift", () => {
  const base = withConfiguration({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: "http://deerflow:8001",
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  });
  assert.throws(() => createRawAdapterRequestListener({ ...base, configurationSha256: "f".repeat(64) }));
  assert.throws(() => createRawAdapterRequestListener({
    ...base,
    configurationInput: { ...CONFIGURATION_INPUT, deerflowModelId: "gpt-drifted" },
  }));
  assert.throws(() => createRawAdapterRequestListener({ ...base, deerflowModel: "gpt-test" }));
  assert.throws(() => createRawAdapterRequestListener({ ...base, modelGatewayToken: UPSTREAM_TOKEN }));
});

test("adapter startup accepts only private listener bindings and its own Compose or strict Fly Redis hostname", () => {
  assert.equal(adapterBindHostFromEnvironment({}), "0.0.0.0");
  for (const bindHost of ["0.0.0.0", "::", "fly-local-6pn"]) {
    assert.equal(adapterBindHostFromEnvironment({ BIND_HOST: bindHost }), bindHost);
  }
  for (const bindHost of ["127.0.0.1", "0.0.0.0.example", "public.example.com", "", "FLY-LOCAL-6PN"]) {
    if (bindHost === "") continue;
    assert.throws(() => adapterBindHostFromEnvironment({ BIND_HOST: bindHost }));
  }

  const environment = {
    REDIS_PASSWORD: "redis-password-at-least-32-characters-long",
    REDIS_PORT: "6379",
    REDIS_DB: "0",
  };
  for (const [mode, host, reviewedFlyHost] of [
    ["deerflow", "deerflow-redis"],
    ["flowise", "flowise-redis"],
    ["deerflow", "aria-deerflow-redis.internal", "aria-deerflow-redis.internal"],
    ["flowise", "aria-flowise-redis.internal", "aria-flowise-redis.internal"],
  ]) {
    const redis = new URL(internalRedisUrlFromEnvironment({
      ...environment,
      ADAPTER_MODE: mode,
      ...(mode === "deerflow" ? { REDIS_PLANE_OWNER: "aria-adapter" } : {}),
      REDIS_HOST: host,
      ...(reviewedFlyHost ? { REDIS_FLY_HOST: reviewedFlyHost } : {}),
    }));
    assert.equal(redis.protocol, "redis:");
    assert.equal(redis.hostname, host);
    assert.equal(redis.port, "6379");
    assert.equal(redis.pathname, "/0");
    assert.equal(redis.username, "default");
  }
  for (const host of [
    "redis",
    "other",
    "REDIS.internal",
    "redis.internal.evil",
    "redis_.internal",
    "-redis.internal",
    "redis-.internal",
    "redis.internal.",
    "127.0.0.1",
    "[::1]",
    "http://redis.internal",
    "user@redis.internal",
  ]) {
    assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "deerflow", REDIS_HOST: host }), host);
  }
  assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "deerflow", REDIS_HOST: "flowise-redis" }));
  assert.throws(() => internalRedisUrlFromEnvironment({
    ...environment,
    ADAPTER_MODE: "deerflow",
    REDIS_PLANE_OWNER: "deerflow",
    REDIS_HOST: "deerflow-redis",
  }));
  assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "flowise", REDIS_HOST: "deerflow-redis" }));
  assert.throws(() => internalRedisUrlFromEnvironment({
    ...environment,
    ADAPTER_MODE: "deerflow",
    REDIS_HOST: "aria-flowise-redis.internal",
    REDIS_FLY_HOST: "aria-flowise-redis.internal",
  }));
  assert.throws(() => internalRedisUrlFromEnvironment({
    ...environment,
    ADAPTER_MODE: "flowise",
    REDIS_HOST: "aria-deerflow-redis.internal",
    REDIS_FLY_HOST: "aria-deerflow-redis.internal",
  }));
  assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "deerflow", REDIS_HOST: "aria-deerflow-redis.internal" }));
  assert.throws(() => internalRedisUrlFromEnvironment({
    ...environment,
    ADAPTER_MODE: "deerflow",
    REDIS_HOST: "unreviewed-deerflow-redis.internal",
    REDIS_FLY_HOST: "aria-deerflow-redis.internal",
  }));
  assert.throws(() => internalRedisUrlFromEnvironment({
    ...environment,
    ADAPTER_MODE: "deerflow",
    REDIS_HOST: "deerflow-redis",
    REDIS_FLY_HOST: "aria-deerflow-redis.internal",
  }));
  assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "unknown", REDIS_HOST: "deerflow-redis" }));
  assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "deerflow", REDIS_HOST: "deerflow-redis", REDIS_PORT: "6380" }));
  assert.throws(() => internalRedisUrlFromEnvironment({ ...environment, ADAPTER_MODE: "deerflow", REDIS_HOST: "deerflow-redis", REDIS_DB: "1" }));
});

test("DeerFlow model readiness authenticates the canonical gateway and requires the exact provider and model", async (t) => {
  let provider = "openai";
  let model = "gpt-test";
  const gateway = await listen((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/readyz");
    assert.equal(req.headers.authorization, `Bearer ${MODEL_GATEWAY_TOKEN}`);
    sendJson(res, 200, { status: "ready", provider, model });
  });
  t.after(() => gateway.close());
  const config = {
    modelGatewayReadyUrl: `${gateway.origin}/readyz`,
    modelGatewayToken: MODEL_GATEWAY_TOKEN,
    deerflowCloudProviderId: "openai",
    deerflowModelId: "gpt-test",
  };
  assert.equal(await probeModelGatewayReadiness(config), true);
  provider = "kimi";
  assert.equal(await probeModelGatewayReadiness(config), false);
  provider = "openai";
  model = "wrong-model";
  assert.equal(await probeModelGatewayReadiness(config), false);
});

test("DeerFlow adapter invokes the pinned official wait API and can select only a reviewed query", async (t) => {
  let upstreamCalls = 0;
  let expectedRequest = runRequest;
  const upstream = await listen(async (req, res) => {
    upstreamCalls += 1;
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/runs/wait");
    assert.equal(req.headers["x-deerflow-internal-token"], UPSTREAM_TOKEN);
    const body = await readJson(req);
    assert.equal(body.assistant_id, "aria-proposal");
    assert.equal(body.config.recursion_limit, 24);
    assert.equal(body.context.model_name, "aria-model");
    assert.equal(body.context.non_interactive, true);
    assert.equal(body.context.subagent_enabled, false);
    assert.equal(body.context.max_concurrent_subagents, 1);
    assert.equal(body.context.max_total_subagents, 1);
    assert.equal(body.on_disconnect, "cancel");
    assert.equal(body.on_completion, "delete");

    const prompt = JSON.parse(body.input.messages[0].content);
    assert.equal(prompt.contract, "aria.deerflow.proposal.v1");
    assert.deepEqual(prompt.need, expectedRequest.need);
    assert.deepEqual(prompt.reviewedQueries, expectedRequest.reviewedQueries.map((query, index) => ({ index, ...query })));
    assert.deepEqual(prompt.agentMemory, {
      policy: expectedRequest.agentMemory.policy,
      items: expectedRequest.agentMemory.items,
    });
    assert.equal(Object.hasOwn(prompt.agentMemory, "receiptSha256"), false);
    assert.match(expectedRequest.agentMemory.receiptSha256, /^[0-9a-f]{64}$/);
    assert.match(prompt.memoryPolicy, /untrusted reference data/i);
    assert.equal(prompt.output.report, 'literal "complete" when the workflow reports, otherwise null');
    assert.equal(Object.hasOwn(prompt, "candidates"), false);
    assert.equal(Object.hasOwn(prompt, "capabilityToken"), false);
    assert.equal(Object.hasOwn(prompt, "apiKey"), false);

    sendJson(res, 200, {
      messages: [{
        type: "ai",
        content: JSON.stringify({
          selectedReviewedQueryIndex: 1,
          report: "complete",
        }),
      }],
    });
  });
  t.after(() => upstream.close());

  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify(runRequest),
  });
  assert.equal(response.status, 200);
  const proposal = await response.json();
  assert.equal(proposal.runId, runRequest.runId);
  assert.equal(proposal.status, "proposed");
  assert.deepEqual(proposal.actions, [
    { kind: "source_query", platform: "GitHub", query: runRequest.reviewedQueries[1].query },
    { kind: "report", summary: "DeerFlow completed the approved workflow and selected one reviewed sourcing query." },
  ]);
  assert.deepEqual(proposal.steps.map(({ ordinal, nodeId, nodeKind }) => ({ ordinal, nodeId, nodeKind })), [
    { ordinal: 0, nodeId: "plan", nodeKind: "plan" },
    { ordinal: 1, nodeId: "source", nodeKind: "source_reviewed_campaign" },
    { ordinal: 2, nodeId: "report", nodeKind: "report" },
  ]);
  assert.ok(proposal.steps.every((step) => /^[0-9a-f]{64}$/.test(step.requestSha256)));
  assert.ok(proposal.steps.every((step) => /^[0-9a-f]{64}$/.test(step.responseSha256)));
  const changedAuthorityWithoutCapability = {
    ...runRequestWithoutCapability,
    need: { ...runRequestWithoutCapability.need, title: "Principal Backend Engineer" },
  };
  const changedAuthorityRequest = {
    ...changedAuthorityWithoutCapability,
    capabilityToken: signAgentFrameworkRequestCapabilityCore(
      CAPABILITY_SECRET,
      changedAuthorityWithoutCapability,
    ),
  };
  expectedRequest = changedAuthorityRequest;
  const changedResponse = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify(changedAuthorityRequest),
  });
  assert.equal(changedResponse.status, 200);
  const changedProposal = await changedResponse.json();
  assert.notDeepEqual(
    changedProposal.steps.map((step) => step.requestSha256),
    proposal.steps.map((step) => step.requestSha256),
    "step request receipts must bind the grounded need and reviewed-query authority",
  );
  assert.equal(upstreamCalls, 2);
});

test("DeerFlow adapter fails closed when upstream invents a query or emits non-JSON", async (t) => {
  let responseBody = JSON.stringify({
    selectedReviewedQueryIndex: 99,
    query: "language:rust location:unknown",
    report: "Invented",
  });
  const upstream = await listen(async (req, res) => {
    await readJson(req);
    sendJson(res, 200, { messages: [{ type: "ai", content: responseBody }] });
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const call = () => fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify(runRequest),
  });
  let response = await call();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: "upstream_contract_invalid" });

  responseBody = "The best query is language:rust location:unknown";
  response = await call();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: "upstream_contract_invalid" });

  responseBody = JSON.stringify({ selectedReviewedQueryIndex: 0, report: "Invented narrative" });
  response = await call();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: "upstream_contract_invalid" });
});

test("DeerFlow adapter cancels an oversized streamed upstream response", async (t) => {
  const targetChunks = 96;
  let sentChunks = 0;
  let closedBeforeCompletion = false;
  let markClosed;
  const closed = new Promise((resolve) => { markClosed = resolve; });
  const upstream = await listen(async (req, res) => {
    await readJson(req);
    res.writeHead(200, { "content-type": "application/json" });
    const interval = setInterval(() => {
      sentChunks += 1;
      res.write("x".repeat(64 * 1024));
      if (sentChunks >= targetChunks) {
        clearInterval(interval);
        res.end();
      }
    }, 2);
    res.once("close", () => {
      closedBeforeCompletion = sentChunks < targetChunks;
      clearInterval(interval);
      markClosed();
    });
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify(runRequest),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: "upstream_contract_invalid" });
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("upstream stream was not closed")), 1_000)),
  ]);
  assert.equal(closedBeforeCompletion, true);
});

test("DeerFlow adapter rejects workflow substitution under an otherwise valid capability", async (t) => {
  let upstreamCalls = 0;
  const upstream = await listen((_req, res) => {
    upstreamCalls += 1;
    sendJson(res, 500, {});
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const substitutedWorkflow = {
    ...workflow,
    nodes: [
      ...workflow.nodes.slice(0, 2),
      { id: "draft", kind: "plan" },
      workflow.nodes[2],
    ],
    edges: [
      { from: "plan", to: "source" },
      { from: "source", to: "draft" },
      { from: "draft", to: "report" },
    ],
  };
  const response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify({ ...runRequest, workflow: substitutedWorkflow }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, code: "capability_invalid" });
  assert.equal(upstreamCalls, 0);
});

test("DeerFlow adapter requires exactly one reviewed source and one report node", async (t) => {
  let upstreamCalls = 0;
  const upstream = await listen((_req, res) => {
    upstreamCalls += 1;
    sendJson(res, 500, {});
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const invalidWorkflows = [
    {
      version: 1,
      name: "Missing reviewed source",
      nodes: [
        { id: "plan", kind: "plan" },
        { id: "report", kind: "report" },
      ],
      edges: [{ from: "plan", to: "report" }],
    },
    {
      version: 1,
      name: "Missing report",
      nodes: [
        { id: "plan", kind: "plan" },
        { id: "source", kind: "source_reviewed_campaign" },
      ],
      edges: [{ from: "plan", to: "source" }],
    },
    {
      version: 1,
      name: "Duplicate reviewed source",
      nodes: [
        { id: "plan", kind: "plan" },
        { id: "source", kind: "source_reviewed_campaign" },
        { id: "source_again", kind: "source_reviewed_campaign" },
        { id: "report", kind: "report" },
      ],
      edges: [
        { from: "plan", to: "source" },
        { from: "source", to: "source_again" },
        { from: "source_again", to: "report" },
      ],
    },
    {
      version: 1,
      name: "Duplicate report",
      nodes: [
        { id: "plan", kind: "plan" },
        { id: "source", kind: "source_reviewed_campaign" },
        { id: "report", kind: "report" },
        { id: "report_again", kind: "report" },
      ],
      edges: [
        { from: "plan", to: "source" },
        { from: "source", to: "report" },
        { from: "report", to: "report_again" },
      ],
    },
  ];
  for (const invalidWorkflow of invalidWorkflows) {
    const authority = { ...runRequestWithoutCapability, workflow: invalidWorkflow };
    const response = await fetch(`${adapter.origin}/v1/aria/runs`, {
      method: "POST",
      headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
      body: JSON.stringify({
        ...authority,
        capabilityToken: signAgentFrameworkRequestCapabilityCore(CAPABILITY_SECRET, authority),
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: "request_invalid" });
  }
  assert.equal(upstreamCalls, 0);
});

test("Flowise adapter invokes the pinned official chatflow API and returns only the bound workflow fields", async (t) => {
  const upstreamWorkspaceId = "90000000-0000-4000-8000-000000000009";
  let upstreamCalls = 0;
  const upstream = await listen((req, res) => {
    upstreamCalls += 1;
    assert.equal(req.method, "GET");
    assert.equal(req.url, `/api/v1/chatflows/${FLOW_ID}`);
    assert.equal(req.headers.authorization, `Bearer ${UPSTREAM_TOKEN}`);
    sendJson(res, 200, {
      id: FLOW_ID,
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
      workspaceId: upstreamWorkspaceId,
      apiConfig: "must-not-cross-the-adapter",
      credential: "must-not-cross-the-adapter",
    });
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "flowise",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: FLOWISE_SOURCE_COMMIT,
    imageDigest: FLOWISE_IMAGE,
    configurationSha256: CONFIGURATION_SHA,
    isolation: "instance-per-workspace",
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    upstreamWorkspaceId,
    readinessWorkflowId: FLOW_ID,
    workerHealthUrl: `${upstream.origin}/healthz`,
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/v1/aria/workflows/${FLOW_ID}/export`, {
    headers: {
      ...adapterHeaders("aria.flowise.import.v1"),
      "x-aria-workspace-id": WORKSPACE_ID,
      "x-aria-framework-instance-id": FLOWISE_INSTANCE_ID,
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    workspaceId: WORKSPACE_ID,
    frameworkInstanceId: FLOWISE_INSTANCE_ID,
    sourceCommit: FLOWISE_SOURCE_COMMIT,
    imageDigest: FLOWISE_IMAGE,
    workflow: {
      id: FLOW_ID,
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
  assert.equal(upstreamCalls, 1);
});

test("Flowise adapter rejects cross-workspace bindings before upstream egress", async (t) => {
  let upstreamCalls = 0;
  const upstream = await listen((_req, res) => {
    upstreamCalls += 1;
    sendJson(res, 500, {});
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "flowise",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: FLOWISE_SOURCE_COMMIT,
    imageDigest: FLOWISE_IMAGE,
    isolation: "instance-per-workspace",
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    upstreamWorkspaceId: "90000000-0000-4000-8000-000000000009",
    readinessWorkflowId: FLOW_ID,
    workerHealthUrl: `${upstream.origin}/healthz`,
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/v1/aria/workflows/${FLOW_ID}/export`, {
    headers: {
      ...adapterHeaders("aria.flowise.import.v1"),
      "x-aria-workspace-id": "aaaaaaaa-0000-4000-8000-000000000001",
      "x-aria-framework-instance-id": FLOWISE_INSTANCE_ID,
    },
  });
  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
});

test("DeerFlow readiness reports only the exact runtime facts it proves", async (t) => {
  const seen = [];
  const upstream = await listen(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === "/health") return sendJson(res, 200, { status: "healthy", service: "deer-flow-gateway" });
    if (req.url === "/api/models") return sendJson(res, 200, { models: [{ name: "aria-model", model: "gpt-test" }], token_usage: { enabled: true } });
    if (req.url === "/api/assistants/aria-proposal") return sendJson(res, 200, {
      assistant_id: "aria-proposal",
      graph_id: "lead_agent",
      name: "aria-proposal",
    });
    return sendJson(res, 404, {});
  });
  t.after(() => upstream.close());
  let policyMatches = true;
  let modelGatewayReady = true;
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: FLOWISE_INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
  }, {
    policyProbe: async () => policyMatches,
    modelGatewayProbe: async () => modelGatewayReady,
  }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/readyz`, { headers: adapterHeaders("aria.deerflow.run.v1") });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    readinessSchema: "aria.agent-framework-adapter-readiness.v2",
    framework: "deerflow",
    contract: "aria.deerflow.run.v1",
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    configurationSha256: CONFIGURATION_SHA,
    workspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    dependencies: {
      modelGateway: true,
      runtimeHealth: true,
      modelBinding: true,
      assistantBinding: true,
      policyBundle: true,
    },
  });
  assert.deepEqual(seen, ["GET /health", "GET /api/models", "GET /api/assistants/aria-proposal"]);

  policyMatches = false;
  const mismatch = await fetch(`${adapter.origin}/readyz`, { headers: adapterHeaders("aria.deerflow.run.v1") });
  assert.equal(mismatch.status, 503);
  assert.deepEqual((await mismatch.json()).dependencies, {
    modelGateway: true,
    runtimeHealth: true,
    modelBinding: true,
    assistantBinding: true,
    policyBundle: false,
  });

  policyMatches = true;
  modelGatewayReady = false;
  const unavailableModel = await fetch(`${adapter.origin}/readyz`, { headers: adapterHeaders("aria.deerflow.run.v1") });
  assert.equal(unavailableModel.status, 503);
  assert.deepEqual((await unavailableModel.json()).dependencies, {
    modelGateway: false,
    runtimeHealth: false,
    modelBinding: false,
    assistantBinding: false,
    policyBundle: false,
  });
});

test("readiness rejects a mismatched framework instance before dependency probes", async (t) => {
  let upstreamCalls = 0;
  const upstream = await listen((_req, res) => {
    upstreamCalls += 1;
    sendJson(res, 200, {});
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/readyz`, {
    headers: {
      ...adapterHeaders("aria.deerflow.run.v1"),
      "x-aria-framework-instance-id": "aaaaaaaa-0000-4000-8000-000000000001",
    },
  });
  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
});

test("Flowise readiness verifies the official ping, workspace database query, queue, and worker", async (t) => {
  const upstreamWorkspaceId = "90000000-0000-4000-8000-000000000009";
  let returnedWorkspaceId = upstreamWorkspaceId;
  let workerQueueName = "aria-flowise";
  const seen = [];
  const upstream = await listen((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === "/api/v1/ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("pong");
    }
    if (req.url === `/api/v1/chatflows/${FLOW_ID}`) {
      assert.equal(req.headers.authorization, `Bearer ${UPSTREAM_TOKEN}`);
      return sendJson(res, 200, {
        id: FLOW_ID,
        workspaceId: returnedWorkspaceId,
        name: "Readiness sentinel",
        flowData: JSON.stringify({
          nodes: [{ id: "sentinel", data: { ariaKind: "plan" } }],
          edges: [],
        }),
      });
    }
    if (req.url === "/healthz") {
      return sendJson(res, 200, {
        schema: "aria.flowise-worker-readiness.v1",
        status: "ready",
        queueName: workerQueueName,
        database: true,
        queue: true,
        worker: true,
      });
    }
    return sendJson(res, 404, {});
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "flowise",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: FLOWISE_SOURCE_COMMIT,
    imageDigest: FLOWISE_IMAGE,
    configurationSha256: CONFIGURATION_SHA,
    isolation: "instance-per-workspace",
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    upstreamWorkspaceId,
    readinessWorkflowId: FLOW_ID,
    workerHealthUrl: `${upstream.origin}/healthz`,
    redisUrl: "redis://redis.internal:6379/0",
  }, {
    redisProbe: async (url, timeoutMs, clientNames) => {
      assert.equal(url, "redis://redis.internal:6379/0");
      assert.equal(timeoutMs, 2_000);
      assert.deepEqual(clientNames, [
        "bull:YXJpYS1mbG93aXNlLXByZWRpY3Rpb24=",
        "bull:YXJpYS1mbG93aXNlLXVwc2VydGlvbg==",
        "bull:YXJpYS1mbG93aXNlLXNjaGVkdWxl",
      ]);
      return true;
    },
  }));
  t.after(() => adapter.close());

  const response = await fetch(`${adapter.origin}/readyz`, { headers: adapterHeaders("aria.flowise.import.v1") });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    readinessSchema: "aria.agent-framework-adapter-readiness.v2",
    framework: "flowise",
    contract: "aria.flowise.import.v1",
    sourceCommit: FLOWISE_SOURCE_COMMIT,
    imageDigest: FLOWISE_IMAGE,
    configurationSha256: CONFIGURATION_SHA,
    isolation: "instance-per-workspace",
    workspaceId: WORKSPACE_ID,
    frameworkInstanceId: FLOWISE_INSTANCE_ID,
    dependencies: { database: true, queue: true, worker: true, policy: true },
  });
  assert.deepEqual(seen, [
    "GET /api/v1/ping",
    `GET /api/v1/chatflows/${FLOW_ID}`,
    "GET /healthz",
  ]);

  returnedWorkspaceId = "aaaaaaaa-0000-4000-8000-000000000001";
  const mismatched = await fetch(`${adapter.origin}/readyz`, { headers: adapterHeaders("aria.flowise.import.v1") });
  assert.equal(mismatched.status, 503);
  assert.deepEqual((await mismatched.json()).dependencies, {
    database: false,
    queue: false,
    worker: true,
    policy: false,
  });

  returnedWorkspaceId = upstreamWorkspaceId;
  workerQueueName = "other-queue";
  const mismatchedWorker = await fetch(`${adapter.origin}/readyz`, { headers: adapterHeaders("aria.flowise.import.v1") });
  assert.equal(mismatchedWorker.status, 503);
  assert.deepEqual((await mismatchedWorker.json()).dependencies, {
    database: true,
    queue: false,
    worker: false,
    policy: true,
  });
});

test("authentication and bounded-body gates reject before upstream egress", async (t) => {
  let upstreamCalls = 0;
  const upstream = await listen((_req, res) => {
    upstreamCalls += 1;
    sendJson(res, 500, {});
  });
  t.after(() => upstream.close());
  const adapter = await listen(createAdapterRequestListener({
    mode: "deerflow",
    adapterToken: ADAPTER_TOKEN,
    upstreamBaseUrl: upstream.origin,
    upstreamToken: UPSTREAM_TOKEN,
    sourceCommit: DEERFLOW_SOURCE_COMMIT,
    imageDigest: DEERFLOW_IMAGE,
    ariaWorkspaceId: WORKSPACE_ID,
    frameworkInstanceId: INSTANCE_ID,
    deerflowAgentId: "aria-proposal",
    deerflowModel: "aria-model",
    configurationSha256: runRequest.configurationSha256,
    capabilitySecret: CAPABILITY_SECRET,
    acceptedFlowiseImageDigest: FLOWISE_IMAGE,
    acceptedFlowiseIsolation: "instance-per-workspace",
    redisUrl: "redis://redis.internal:6379/0",
  }, { redisProbe: async () => true }));
  t.after(() => adapter.close());

  let response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-aria-framework-contract": "aria.deerflow.run.v1" },
    body: JSON.stringify(runRequest),
  });
  assert.equal(response.status, 401);

  response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify({ ...runRequest, capabilityToken: "A".repeat(43) }),
  });
  assert.equal(response.status, 403);

  const crossBoundRequestWithoutCapability = {
    ...runRequestWithoutCapability,
    deerflowInstanceId: "aaaaaaaa-0000-4000-8000-000000000001",
  };
  response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify({
      ...crossBoundRequestWithoutCapability,
      capabilityToken: signAgentFrameworkRequestCapabilityCore(
        CAPABILITY_SECRET,
        crossBoundRequestWithoutCapability,
      ),
    }),
  });
  assert.equal(response.status, 400);

  const repeatedSourceRequestWithoutCapability = {
    ...runRequestWithoutCapability,
    workflow: {
      version: 1,
      name: "Repeated source",
      nodes: [
        { id: "source_one", kind: "source_reviewed_campaign" },
        { id: "source_two", kind: "source_reviewed_campaign" },
      ],
      edges: [{ from: "source_one", to: "source_two" }],
    },
  };
  response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify({
      ...repeatedSourceRequestWithoutCapability,
      capabilityToken: signAgentFrameworkRequestCapabilityCore(
        CAPABILITY_SECRET,
        repeatedSourceRequestWithoutCapability,
      ),
    }),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify({
      ...runRequest,
      reviewedQueries: [{ platform: "GitHub", query: "language:rust location:unknown" }],
    }),
  });
  assert.equal(response.status, 403);

  response = await fetch(`${adapter.origin}/v1/aria/runs`, {
    method: "POST",
    headers: { ...adapterHeaders("aria.deerflow.run.v1"), "content-type": "application/json" },
    body: JSON.stringify({ ...runRequest, padding: "x".repeat(300_000) }),
  });
  assert.equal(response.status, 413);
  assert.equal(upstreamCalls, 0);
});

test("Redis dependency probe authenticates, selects the configured database, and pings", async (t) => {
  let transcript = "";
  const workerClientNames = ["bull:prediction", "bull:upsertion", "bull:schedule"];
  let advertisedClientNames = workerClientNames;
  const redis = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      transcript += chunk.toString("utf8");
      if (transcript.includes("CLIENT")) {
        const clients = advertisedClientNames.map((name, index) => `id=${index + 1} name=${name}`).join("\n");
        socket.end(`+OK\r\n+OK\r\n+PONG\r\n$${Buffer.byteLength(clients)}\r\n${clients}\r\n`);
      }
    });
  });
  redis.listen(0, "127.0.0.1");
  await once(redis, "listening");
  t.after(async () => {
    redis.close();
    await once(redis, "close");
  });
  const address = redis.address();
  assert.ok(address && typeof address === "object");

  assert.equal(
    await probeRedisQueue(`redis://aria:secret@127.0.0.1:${address.port}/4`, 2_000, workerClientNames),
    true,
  );
  assert.match(transcript, /AUTH/);
  assert.match(transcript, /aria/);
  assert.match(transcript, /secret/);
  assert.match(transcript, /SELECT/);
  assert.match(transcript, /\r\n4\r\n/);
  assert.match(transcript, /PING/);
  assert.match(transcript, /CLIENT/);

  advertisedClientNames = workerClientNames.slice(0, 2);
  assert.equal(
    await probeRedisQueue(`redis://aria:secret@127.0.0.1:${address.port}/4`, 2_000, workerClientNames),
    false,
    "readiness must fail when any bound BullMQ worker is absent",
  );
});
