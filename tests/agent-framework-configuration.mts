import assert from "node:assert/strict";

import {
  agentFrameworkConfigurationInputFromEnvironment,
  deriveAgentFrameworkConfiguration,
} from "../src/lib/agents/framework/configuration-core.mjs";

let pass = 0;
function test(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

const input = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  adapterImageDigest: `registry.internal/adapter@sha256:${"1".repeat(64)}`,
  redisImageDigest: `registry.internal/redis@sha256:${"2".repeat(64)}`,
  deerflowAdapterOrigin: "https://deerflow.service.internal",
  deerflowInstanceId: "20000000-0000-4000-8000-000000000002",
  deerflowSourceCommit: "3c0a45ad772cdba388009b8d5ecad5e48cd22429",
  deerflowImageDigest: `registry.internal/deerflow@sha256:${"a".repeat(64)}`,
  deerflowDatabaseImageDigest: `registry.internal/postgres-deerflow@sha256:${"3".repeat(64)}`,
  deerflowModelGatewayImageDigest: `registry.internal/model-gateway@sha256:${"6".repeat(64)}`,
  deerflowCloudProviderId: "openai",
  deerflowModelProvider: "langchain-openai",
  deerflowModelId: "gpt-test",
  deerflowModelBaseUrl: "http://model-gateway.service.internal:8090/v1",
  deerflowModelCredentialVersion: "model-key-v1",
  flowiseAdapterOrigin: "https://flowise.service.internal",
  flowiseInstanceId: "30000000-0000-4000-8000-000000000003",
  flowiseSourceCommit: "ed9e100fb71643cd3922b005908f9732bc0e07dc",
  flowiseImageDigest: `registry.internal/flowise@sha256:${"b".repeat(64)}`,
  flowiseWorkerImageDigest: `registry.internal/flowise-worker@sha256:${"4".repeat(64)}`,
  flowiseDatabaseImageDigest: `registry.internal/postgres-flowise@sha256:${"5".repeat(64)}`,
  flowiseWorkspaceId: "90000000-0000-4000-8000-000000000009",
  flowiseReadinessWorkflowId: "flow_123",
  flowiseIsolation: "instance-per-workspace",
  flowiseQueueName: "aria-flowise",
};

test("canonical runtime identity has one stable cross-runtime SHA-256", () => {
  const first = deriveAgentFrameworkConfiguration(input);
  const reversed = deriveAgentFrameworkConfiguration(Object.fromEntries(Object.entries(input).reverse()));
  assert.equal(first.sha256, "db0ba9060ef51d819e044ee879c4d645b24d4ce2b0822808c614c2cb75516ede");
  assert.equal(reversed.sha256, first.sha256);
  assert.equal(first.manifest.deerflow.modelId, "gpt-test");
  assert.equal(first.manifest.flowise.workspaceId, input.flowiseWorkspaceId);
});

test("every security-relevant runtime change produces a different receipt", () => {
  const expected = deriveAgentFrameworkConfiguration(input).sha256;
  const mutations: Array<[keyof typeof input, string]> = [
    ["adapterImageDigest", `registry.internal/adapter@sha256:${"6".repeat(64)}`],
    ["redisImageDigest", `registry.internal/redis@sha256:${"6".repeat(64)}`],
    ["deerflowImageDigest", `registry.internal/deerflow@sha256:${"6".repeat(64)}`],
    ["deerflowDatabaseImageDigest", `registry.internal/postgres-deerflow@sha256:${"6".repeat(64)}`],
    ["deerflowModelGatewayImageDigest", `registry.internal/model-gateway@sha256:${"7".repeat(64)}`],
    ["deerflowModelId", "gpt-next"],
    ["deerflowModelBaseUrl", "https://model-gateway-v2.service.internal/v1"],
    ["deerflowModelCredentialVersion", "model-key-v2"],
    ["flowiseImageDigest", `registry.internal/flowise@sha256:${"6".repeat(64)}`],
    ["flowiseWorkerImageDigest", `registry.internal/flowise-worker@sha256:${"6".repeat(64)}`],
    ["flowiseDatabaseImageDigest", `registry.internal/postgres-flowise@sha256:${"6".repeat(64)}`],
    ["flowiseWorkspaceId", "80000000-0000-4000-8000-000000000008"],
    ["flowiseReadinessWorkflowId", "flow_456"],
    ["flowiseQueueName", "aria-flowise-v2"],
  ];
  for (const [key, value] of mutations) {
    assert.notEqual(deriveAgentFrameworkConfiguration({ ...input, [key]: value }).sha256, expected, key);
  }
  assert.notEqual(
    deriveAgentFrameworkConfiguration({ ...input, deerflowCloudProviderId: "kimi" }).sha256,
    expected,
    "deerflowCloudProviderId",
  );
});

test("private Fly 6PN HTTP and HTTPS endpoints pass while public endpoints, mutable images, and unapproved providers fail closed", () => {
  assert.equal(
    deriveAgentFrameworkConfiguration({ ...input, deerflowAdapterOrigin: "http://deerflow.service.internal:8080" }).manifest.deerflow.adapterOrigin,
    "http://deerflow.service.internal:8080",
  );
  assert.equal(
    deriveAgentFrameworkConfiguration({ ...input, deerflowModelBaseUrl: "https://model-gateway.service.internal/v1" }).manifest.deerflow.modelBaseUrl,
    "https://model-gateway.service.internal/v1",
  );
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, deerflowAdapterOrigin: "https://public.example.com" }));
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, deerflowAdapterOrigin: "http://public.example.com" }));
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, deerflowModelBaseUrl: "https://api.openai.com/v1" }));
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, flowiseImageDigest: "flowise:latest" }));
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, deerflowModelProvider: "invented-provider" }));
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, deerflowCloudProviderId: "arbitrary-cloud" }));
  assert.throws(() => deriveAgentFrameworkConfiguration({ ...input, flowiseInstanceId: input.deerflowInstanceId }));
});

test("the environment mapper contains no secret or token fields", () => {
  const environment = {
    AGENT_FRAMEWORK_READINESS_WORKSPACE_ID: input.workspaceId,
    FRAMEWORK_ADAPTER_IMAGE_DIGEST: input.adapterImageDigest,
    REDIS_IMAGE_DIGEST: input.redisImageDigest,
    DEERFLOW_ADAPTER_URL: input.deerflowAdapterOrigin,
    DEERFLOW_FRAMEWORK_INSTANCE_ID: input.deerflowInstanceId,
    DEERFLOW_SOURCE_COMMIT: input.deerflowSourceCommit,
    DEERFLOW_IMAGE_DIGEST: input.deerflowImageDigest,
    DEERFLOW_DATABASE_IMAGE_DIGEST: input.deerflowDatabaseImageDigest,
    DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST: input.deerflowModelGatewayImageDigest,
    DEERFLOW_CLOUD_PROVIDER_ID: input.deerflowCloudProviderId,
    DEERFLOW_MODEL_PROVIDER: input.deerflowModelProvider,
    DEERFLOW_MODEL_ID: input.deerflowModelId,
    DEERFLOW_MODEL_BASE_URL: input.deerflowModelBaseUrl,
    DEERFLOW_MODEL_CREDENTIAL_VERSION: input.deerflowModelCredentialVersion,
    FLOWISE_ADAPTER_URL: input.flowiseAdapterOrigin,
    FLOWISE_FRAMEWORK_INSTANCE_ID: input.flowiseInstanceId,
    FLOWISE_SOURCE_COMMIT: input.flowiseSourceCommit,
    FLOWISE_IMAGE_DIGEST: input.flowiseImageDigest,
    FLOWISE_WORKER_IMAGE_DIGEST: input.flowiseWorkerImageDigest,
    FLOWISE_DATABASE_IMAGE_DIGEST: input.flowiseDatabaseImageDigest,
    FLOWISE_WORKSPACE_ID: input.flowiseWorkspaceId,
    FLOWISE_READINESS_WORKFLOW_ID: input.flowiseReadinessWorkflowId,
    FLOWISE_TENANT_ISOLATION: input.flowiseIsolation,
    FLOWISE_QUEUE_NAME: input.flowiseQueueName,
    DEERFLOW_MODEL_API_KEY: "must-not-appear",
    FLOWISE_ADAPTER_TOKEN: "must-not-appear",
  };
  const mapped = agentFrameworkConfigurationInputFromEnvironment(environment);
  assert.deepEqual(mapped, input);
  assert.equal(JSON.stringify(mapped).includes("must-not-appear"), false);
});

console.log(`RESULT agent-framework-configuration: ${pass} passed, 0 failed`);
