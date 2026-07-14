import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createAgentFrameworkHeartbeatClient,
  heartbeatAgentFrameworksOnce,
  loadAgentFrameworkHeartbeatConfiguration,
  runAgentFrameworkHeartbeatLoop,
} from "../scripts/agent-framework-heartbeat-worker.mjs";
import { deriveAgentFrameworkConfigurationFromEnvironment } from "../src/lib/agents/framework/configuration-core.mjs";

const WORKSPACE_A = "10000000-0000-4000-8000-000000000001";
const WORKSPACE_B = "20000000-0000-4000-8000-000000000002";
const DEERFLOW_INSTANCE = "30000000-0000-4000-8000-000000000003";
const FLOWISE_INSTANCE = "40000000-0000-4000-8000-000000000004";
const DEERFLOW_COMMIT = "fabadae4168db81f0eaaf62f209050f978e2f691";
const FLOWISE_COMMIT = "bb773ffa710bd22639c4ba2643413a0ea2b679d3";
const DEERFLOW_IMAGE = `registry.internal/deerflow@sha256:${"a".repeat(64)}`;
const FLOWISE_IMAGE = `registry.internal/flowise@sha256:${"b".repeat(64)}`;
const SERVICE_KEY = "service-role-key-that-is-at-least-thirty-two-characters";
const DEERFLOW_TOKEN = "D".repeat(32);
const FLOWISE_TOKEN = "F".repeat(32);

const baseEnvironmentWithoutConfigurationSha = {
  SUPABASE_URL: "http://aria-mantu-kong.internal:8000",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ARIA_RELEASE_SHA: "d".repeat(40),
  AGENT_FRAMEWORK_READINESS_WORKSPACE_ID: WORKSPACE_A,
  FRAMEWORK_ADAPTER_IMAGE_DIGEST: `registry.internal/framework-adapter@sha256:${"1".repeat(64)}`,
  REDIS_IMAGE_DIGEST: `registry.internal/redis@sha256:${"2".repeat(64)}`,
  DEERFLOW_ADAPTER_URL: "https://deerflow.service.internal",
  DEERFLOW_ADAPTER_TOKEN: DEERFLOW_TOKEN,
  DEERFLOW_FRAMEWORK_INSTANCE_ID: DEERFLOW_INSTANCE,
  DEERFLOW_SOURCE_COMMIT: DEERFLOW_COMMIT,
  DEERFLOW_IMAGE_DIGEST: DEERFLOW_IMAGE,
  DEERFLOW_DATABASE_IMAGE_DIGEST: `registry.internal/deerflow-postgres@sha256:${"3".repeat(64)}`,
  DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST: `registry.internal/model-gateway@sha256:${"6".repeat(64)}`,
  DEERFLOW_CLOUD_PROVIDER_ID: "openai",
  DEERFLOW_MODEL_PROVIDER: "langchain-openai",
  DEERFLOW_MODEL_ID: "aria-model",
  DEERFLOW_MODEL_BASE_URL: "https://model-gateway.service.internal/v1",
  DEERFLOW_MODEL_CREDENTIAL_VERSION: "model-key-v1",
  FLOWISE_ADAPTER_URL: "https://flowise.service.internal",
  FLOWISE_ADAPTER_TOKEN: FLOWISE_TOKEN,
  FLOWISE_FRAMEWORK_INSTANCE_ID: FLOWISE_INSTANCE,
  FLOWISE_SOURCE_COMMIT: FLOWISE_COMMIT,
  FLOWISE_IMAGE_DIGEST: FLOWISE_IMAGE,
  FLOWISE_WORKER_IMAGE_DIGEST: `registry.internal/flowise-worker@sha256:${"4".repeat(64)}`,
  FLOWISE_DATABASE_IMAGE_DIGEST: `registry.internal/flowise-postgres@sha256:${"5".repeat(64)}`,
  FLOWISE_WORKSPACE_ID: WORKSPACE_A,
  FLOWISE_READINESS_WORKFLOW_ID: "flowise-readiness",
  FLOWISE_TENANT_ISOLATION: "instance-per-workspace",
  FLOWISE_QUEUE_NAME: "aria-flowise",
};
const CONFIGURATION_SHA = deriveAgentFrameworkConfigurationFromEnvironment(
  baseEnvironmentWithoutConfigurationSha,
).sha256;
const baseEnvironment = {
  ...baseEnvironmentWithoutConfigurationSha,
  AGENT_FRAMEWORK_CONFIGURATION_SHA256: CONFIGURATION_SHA,
};

const deerflowTarget = {
  workspace_id: WORKSPACE_A,
  instance_id: DEERFLOW_INSTANCE,
  framework: "deerflow",
  source_commit: DEERFLOW_COMMIT,
  image_digest: DEERFLOW_IMAGE,
  isolation_mode: "dedicated-worker",
  configuration_sha256: CONFIGURATION_SHA,
};

const flowiseTarget = {
  workspace_id: WORKSPACE_A,
  instance_id: FLOWISE_INSTANCE,
  framework: "flowise",
  source_commit: FLOWISE_COMMIT,
  image_digest: FLOWISE_IMAGE,
  isolation_mode: "instance-per-workspace",
  configuration_sha256: CONFIGURATION_SHA,
};

function responseAt(url: string, value: unknown, init: ResponseInit = {}): Response {
  const response = new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function readinessFor(target: typeof deerflowTarget | typeof flowiseTarget) {
  return {
    ok: true,
    framework: target.framework,
    contract: target.framework === "deerflow"
      ? "aria.deerflow.run.v1"
      : "aria.flowise.import.v1",
    sourceCommit: target.source_commit,
    imageDigest: target.image_digest,
    configurationSha256: target.configuration_sha256,
    workspaceId: target.workspace_id,
    frameworkInstanceId: target.instance_id,
    ...(target.framework === "flowise" ? { isolation: target.isolation_mode } : {}),
    dependencies: { database: true, queue: true, worker: true, policy: true },
  };
}

test("heartbeat client calls only the two service RPCs with bounded non-redirecting requests", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createAgentFrameworkHeartbeatClient(
    baseEnvironment.SUPABASE_URL,
    SERVICE_KEY,
    async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/list_agent_framework_heartbeat_targets")) {
        return responseAt(url, { status: "ok", targets: [deerflowTarget] });
      }
      return responseAt(url, { status: "recorded" });
    },
    { timeoutMs: 1_000 },
  );

  const listed = await client.listTargets(WORKSPACE_A);
  const recorded = await client.recordReadiness({
    p_workspace_id: WORKSPACE_A,
    p_instance_id: DEERFLOW_INSTANCE,
    p_source_commit: DEERFLOW_COMMIT,
    p_image_digest: DEERFLOW_IMAGE,
    p_isolation_mode: "dedicated-worker",
    p_readiness_sha256: "e".repeat(64),
    p_ready: true,
  });

  assert.equal(listed.error, null);
  assert.equal(recorded.error, null);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/rest\/v1\/rpc\/list_agent_framework_heartbeat_targets$/);
  assert.match(requests[1].url, /\/rest\/v1\/rpc\/record_agent_framework_readiness$/);
  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("apikey"), SERVICE_KEY);
    assert.equal(headers.get("authorization"), `Bearer ${SERVICE_KEY}`);
    assert.equal(request.init?.method, "POST");
    assert.equal(request.init?.redirect, "error");
    assert.ok(request.init?.signal instanceof AbortSignal);
  }
  assert.equal(
    requests[0].init?.body,
    JSON.stringify({ p_workspace_id: WORKSPACE_A }),
  );
  assert.equal(
    requests[1].init?.body,
    JSON.stringify({
      p_workspace_id: WORKSPACE_A,
      p_instance_id: DEERFLOW_INSTANCE,
      p_source_commit: DEERFLOW_COMMIT,
      p_image_digest: DEERFLOW_IMAGE,
      p_isolation_mode: "dedicated-worker",
      p_readiness_sha256: "e".repeat(64),
      p_ready: true,
    }),
  );
});

test("healthy targets are probed with exact private identity and recorded independently", async () => {
  const records: Array<Record<string, unknown>> = [];
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [deerflowTarget, flowiseTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return { data: { status: "recorded" }, error: null };
    },
  };
  const seen = new Set<string>();
  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(baseEnvironment),
    async (input, init) => {
      const url = String(input);
      seen.add(url);
      const target = url.includes("deerflow") ? deerflowTarget : flowiseTarget;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${target.framework === "deerflow" ? DEERFLOW_TOKEN : FLOWISE_TOKEN}`);
      assert.equal(headers.get("x-aria-workspace-id"), target.workspace_id);
      assert.equal(headers.get("x-aria-framework-instance-id"), target.instance_id);
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      return responseAt(url, readinessFor(target));
    },
  );

  assert.deepEqual([...seen].sort(), [
    "https://deerflow.service.internal/readyz",
    "https://flowise.service.internal/readyz",
  ]);
  assert.equal(result.status, "ok");
  assert.equal(result.targets, 2);
  assert.equal(result.ready, 2);
  assert.equal(result.recorded, 2);
  assert.equal(records.length, 2);
  assert.equal(records.every((record) => record.p_ready === true), true);
  assert.equal(records.every((record) => /^[0-9a-f]{64}$/.test(String(record.p_readiness_sha256))), true);
  assert.equal(JSON.stringify(result).includes(DEERFLOW_TOKEN), false);
  assert.equal(JSON.stringify(result).includes(FLOWISE_TOKEN), false);
});

test("identity or configuration drift records false without adapter egress", async () => {
  let adapterCalls = 0;
  const records: Array<Record<string, unknown>> = [];
  const driftedTarget = { ...deerflowTarget, configuration_sha256: "f".repeat(64) };
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [driftedTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return { data: { status: "recorded" }, error: null };
    },
  };

  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(baseEnvironment),
    async () => {
      adapterCalls += 1;
      return responseAt("https://deerflow.service.internal/readyz", readinessFor(deerflowTarget));
    },
  );

  assert.equal(adapterCalls, 0);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.failureCodes, ["target_identity_mismatch"]);
  assert.equal(records.length, 1);
  assert.equal(records[0].p_ready, false);
  assert.equal(records[0].p_configuration_sha256, driftedTarget.configuration_sha256);
});

test("missing or unsafe adapter configuration fails closed per target without crashing deployment", async () => {
  const records: Array<Record<string, unknown>> = [];
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [deerflowTarget, flowiseTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return { data: { status: "recorded" }, error: null };
    },
  };
  const incompleteEnvironment = {
    ...baseEnvironment,
    DEERFLOW_ADAPTER_TOKEN: "",
    FLOWISE_ADAPTER_TOKEN: "",
  };

  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(incompleteEnvironment),
    async () => { throw new Error("must not egress"); },
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.ready, 0);
  assert.equal(result.recorded, 2);
  assert.deepEqual(result.failureCodes, ["adapter_configuration_invalid", "adapter_configuration_invalid"]);
  assert.equal(records.every((record) => record.p_ready === false), true);
});

test("adapter tokens shorter than 32 characters fail before heartbeat egress", async () => {
  let adapterCalls = 0;
  const records: Array<Record<string, unknown>> = [];
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [deerflowTarget, flowiseTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return { data: { status: "recorded" }, error: null };
    },
  };

  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration({
      ...baseEnvironment,
      DEERFLOW_ADAPTER_TOKEN: "d".repeat(31),
      FLOWISE_ADAPTER_TOKEN: "f".repeat(31),
    }),
    async () => {
      adapterCalls += 1;
      return responseAt("https://deerflow.service.internal/readyz", readinessFor(deerflowTarget));
    },
  );

  assert.equal(adapterCalls, 0);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.failureCodes, ["adapter_configuration_invalid", "adapter_configuration_invalid"]);
  assert.equal(records.every((record) => record.p_ready === false), true);
});

test("malformed, redirected, and unhealthy adapter responses are never marked ready", async () => {
  const records: Array<Record<string, unknown>> = [];
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [deerflowTarget, flowiseTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return { data: { status: "recorded" }, error: null };
    },
  };
  let calls = 0;
  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(baseEnvironment),
    async (input) => {
      calls += 1;
      if (String(input).includes("deerflow")) {
        return responseAt("https://attacker.example/collect", readinessFor(deerflowTarget));
      }
      return responseAt(String(input), {
        ...readinessFor(flowiseTarget),
        dependencies: { database: true, queue: true, worker: false, policy: true },
      });
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.status, "degraded");
  assert.equal(result.ready, 0);
  assert.equal(records.every((record) => record.p_ready === false), true);
  assert.deepEqual(result.failureCodes.sort(), ["adapter_response_invalid", "adapter_unready"]);
});

test("target inventory parsing is exact, bounded, duplicate-safe, and fail closed", async () => {
  let records = 0;
  const client = {
    async listTargets() {
      return {
        data: {
          status: "ok",
          targets: [{ ...deerflowTarget, unexpected: "must fail" }],
        },
        error: null,
      };
    },
    async recordReadiness() {
      records += 1;
      return { data: { status: "recorded" }, error: null };
    },
  };

  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(baseEnvironment),
    async () => { throw new Error("must not egress"); },
  );
  assert.equal(result.status, "degraded");
  assert.equal(result.targets, 0);
  assert.deepEqual(result.failureCodes, ["target_inventory_invalid"]);
  assert.equal(records, 0);
});

test("one target failure cannot suppress another target readiness record", async () => {
  const records: Array<Record<string, unknown>> = [];
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [deerflowTarget, flowiseTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return args.p_instance_id === FLOWISE_INSTANCE
        ? { data: null, error: { code: "record_failed" } }
        : { data: { status: "recorded" }, error: null };
    },
  };

  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(baseEnvironment),
    async (input) => {
      const target = String(input).includes("deerflow") ? deerflowTarget : flowiseTarget;
      return responseAt(String(input), readinessFor(target));
    },
  );

  assert.equal(records.length, 2);
  assert.equal(result.status, "degraded");
  assert.equal(result.recorded, 1);
  assert.equal(result.ready, 1);
  assert.deepEqual(result.failureCodes, ["readiness_record_failed"]);
});

test("a malformed fetch result is isolated to its target instead of aborting the cycle", async () => {
  const records: Array<Record<string, unknown>> = [];
  const client = {
    async listTargets() {
      return { data: { status: "ok", targets: [deerflowTarget, flowiseTarget] }, error: null };
    },
    async recordReadiness(args: Record<string, unknown>) {
      records.push(args);
      return { data: { status: "recorded" }, error: null };
    },
  };

  const result = await heartbeatAgentFrameworksOnce(
    client,
    loadAgentFrameworkHeartbeatConfiguration(baseEnvironment),
    async (input) => String(input).includes("deerflow")
      ? undefined as unknown as Response
      : responseAt(String(input), readinessFor(flowiseTarget)),
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.targets, 2);
  assert.equal(result.ready, 1);
  assert.equal(result.recorded, 2);
  assert.equal(records.length, 2);
  assert.deepEqual(result.failureCodes, ["adapter_response_invalid"]);
});

test("the loop defaults to one non-overlapping cycle per 60 seconds and logs no secret material", async () => {
  const configuration = loadAgentFrameworkHeartbeatConfiguration(baseEnvironment);
  assert.equal(configuration.intervalMs, 60_000);
  const controller = new AbortController();
  const waits: number[] = [];
  const events: unknown[] = [];
  await runAgentFrameworkHeartbeatLoop({
    client: {
      async listTargets() { return { data: { status: "ok", targets: [] }, error: null }; },
      async recordReadiness() { throw new Error("not called"); },
    },
    configuration,
    signal: controller.signal,
    logger(event: unknown) { events.push(event); },
    now: () => 1_000,
    async sleep(milliseconds: number) {
      waits.push(milliseconds);
      controller.abort();
    },
  });

  assert.deepEqual(waits, [60_000]);
  assert.equal(events.length, 1);
  const output = JSON.stringify(events);
  assert.equal(output.includes(SERVICE_KEY), false);
  assert.equal(output.includes(DEERFLOW_TOKEN), false);
  assert.equal(output.includes(FLOWISE_TOKEN), false);
  assert.equal(output.includes(".internal"), false);
  assert.equal(output.includes(WORKSPACE_A), false);
});

test("the production image runs the heartbeat as a non-HTTP isolated process", () => {
  const dockerfile = readFileSync("Dockerfile.prod", "utf8");
  const fly = readFileSync("fly.app.toml", "utf8");
  assert.match(dockerfile, /agent-framework-heartbeat-worker\.mjs/);
  assert.match(dockerfile, /src\/lib\/agents\/framework\/configuration-core\.mjs/);
  assert.match(
    fly,
    /\[processes\][\s\S]*framework_heartbeat\s*=\s*"node scripts\/agent-framework-heartbeat-worker\.mjs"/,
  );
  assert.match(fly, /\[http_service\][\s\S]*processes\s*=\s*\["web"\]/);
  assert.match(
    fly,
    /\[\[vm\]\]\s*\n\s*processes\s*=\s*\["framework_heartbeat"\][\s\S]*?memory\s*=\s*"256mb"/,
  );
});
