import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$/;
const BOUNDED_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/;
const FLOW_ID = /^[A-Za-z0-9_-]{1,120}$/;
const ISOLATION = new Set(["instance-per-workspace", "licensed-enterprise-workspace"]);
const CLOUD_PROVIDERS = new Set(["kimi", "openai"]);

function required(value, name, maximum = 200) {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > maximum || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function uuid(value, name) {
  const normalized = required(value, name, 36).toLowerCase();
  if (!UUID.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function commit(value, name) {
  const normalized = required(value, name, 40);
  if (!COMMIT.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function image(value, name) {
  const normalized = required(value, name, 460);
  if (!IMAGE_DIGEST.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function identifier(value, name) {
  const normalized = required(value, name, 200);
  if (!BOUNDED_ID.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function origin(value, name, { allowPath = false } = {}) {
  const raw = required(value, name, 2_048);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} is invalid`);
  }
  if (
    !new Set(["http:", "https:"]).has(parsed.protocol) ||
    !parsed.hostname.endsWith(".internal") ||
    parsed.hostname === ".internal" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (!allowPath && parsed.pathname !== "/")
  ) throw new Error(`${name} is invalid`);
  const path = allowPath && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
  return `${parsed.origin}${path}`;
}

/**
 * Build the complete secret-free runtime identity that ARIA, its heartbeat,
 * and both private adapters must independently agree on. The positional array
 * is versioned so its JSON encoding is a stable cross-runtime hash contract.
 */
export function deriveAgentFrameworkConfiguration(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("framework configuration is invalid");
  const manifest = Object.freeze({
    schema: "aria.agent-framework.configuration.v2",
    workspaceId: uuid(raw.workspaceId, "workspaceId"),
    adapterImageDigest: image(raw.adapterImageDigest, "adapterImageDigest"),
    redisImageDigest: image(raw.redisImageDigest, "redisImageDigest"),
    deerflow: Object.freeze({
      adapterOrigin: origin(raw.deerflowAdapterOrigin, "deerflowAdapterOrigin"),
      instanceId: uuid(raw.deerflowInstanceId, "deerflowInstanceId"),
      sourceCommit: commit(raw.deerflowSourceCommit, "deerflowSourceCommit"),
      imageDigest: image(raw.deerflowImageDigest, "deerflowImageDigest"),
      databaseImageDigest: image(raw.deerflowDatabaseImageDigest, "deerflowDatabaseImageDigest"),
      modelGatewayImageDigest: image(raw.deerflowModelGatewayImageDigest, "deerflowModelGatewayImageDigest"),
      cloudProviderId: identifier(raw.deerflowCloudProviderId, "deerflowCloudProviderId"),
      modelProvider: identifier(raw.deerflowModelProvider, "deerflowModelProvider"),
      modelId: identifier(raw.deerflowModelId, "deerflowModelId"),
      modelBaseUrl: origin(raw.deerflowModelBaseUrl, "deerflowModelBaseUrl", { allowPath: true }),
      modelCredentialVersion: identifier(raw.deerflowModelCredentialVersion, "deerflowModelCredentialVersion"),
    }),
    flowise: Object.freeze({
      adapterOrigin: origin(raw.flowiseAdapterOrigin, "flowiseAdapterOrigin"),
      instanceId: uuid(raw.flowiseInstanceId, "flowiseInstanceId"),
      sourceCommit: commit(raw.flowiseSourceCommit, "flowiseSourceCommit"),
      imageDigest: image(raw.flowiseImageDigest, "flowiseImageDigest"),
      workerImageDigest: image(raw.flowiseWorkerImageDigest, "flowiseWorkerImageDigest"),
      databaseImageDigest: image(raw.flowiseDatabaseImageDigest, "flowiseDatabaseImageDigest"),
      workspaceId: uuid(raw.flowiseWorkspaceId, "flowiseWorkspaceId"),
      readinessWorkflowId: required(raw.flowiseReadinessWorkflowId, "flowiseReadinessWorkflowId", 120),
      isolation: required(raw.flowiseIsolation, "flowiseIsolation", 40),
      queueName: identifier(raw.flowiseQueueName, "flowiseQueueName"),
    }),
  });
  if (!FLOW_ID.test(manifest.flowise.readinessWorkflowId)) throw new Error("flowiseReadinessWorkflowId is invalid");
  if (!ISOLATION.has(manifest.flowise.isolation)) throw new Error("flowiseIsolation is invalid");
  if (!CLOUD_PROVIDERS.has(manifest.deerflow.cloudProviderId)) throw new Error("deerflowCloudProviderId is invalid");
  if (manifest.deerflow.modelProvider !== "langchain-openai") throw new Error("deerflowModelProvider is invalid");
  if (manifest.deerflow.instanceId === manifest.flowise.instanceId) throw new Error("framework instance identities must be distinct");

  const canonical = Object.freeze([
    manifest.schema,
    manifest.workspaceId,
    manifest.adapterImageDigest,
    manifest.redisImageDigest,
    manifest.deerflow.adapterOrigin,
    manifest.deerflow.instanceId,
    manifest.deerflow.sourceCommit,
    manifest.deerflow.imageDigest,
    manifest.deerflow.databaseImageDigest,
    manifest.deerflow.modelGatewayImageDigest,
    manifest.deerflow.cloudProviderId,
    manifest.deerflow.modelProvider,
    manifest.deerflow.modelId,
    manifest.deerflow.modelBaseUrl,
    manifest.deerflow.modelCredentialVersion,
    manifest.flowise.adapterOrigin,
    manifest.flowise.instanceId,
    manifest.flowise.sourceCommit,
    manifest.flowise.imageDigest,
    manifest.flowise.workerImageDigest,
    manifest.flowise.databaseImageDigest,
    manifest.flowise.workspaceId,
    manifest.flowise.readinessWorkflowId,
    manifest.flowise.isolation,
    manifest.flowise.queueName,
  ]);
  const canonicalJson = JSON.stringify(canonical);
  return Object.freeze({
    manifest,
    canonicalJson,
    sha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
  });
}

export function agentFrameworkConfigurationInputFromEnvironment(environment) {
  return {
    workspaceId: environment.AGENT_FRAMEWORK_READINESS_WORKSPACE_ID,
    adapterImageDigest: environment.FRAMEWORK_ADAPTER_IMAGE_DIGEST,
    redisImageDigest: environment.REDIS_IMAGE_DIGEST,
    deerflowAdapterOrigin: environment.DEERFLOW_ADAPTER_URL,
    deerflowInstanceId: environment.DEERFLOW_FRAMEWORK_INSTANCE_ID,
    deerflowSourceCommit: environment.DEERFLOW_SOURCE_COMMIT,
    deerflowImageDigest: environment.DEERFLOW_IMAGE_DIGEST,
    deerflowDatabaseImageDigest: environment.DEERFLOW_DATABASE_IMAGE_DIGEST,
    deerflowModelGatewayImageDigest: environment.DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST,
    deerflowCloudProviderId: environment.DEERFLOW_CLOUD_PROVIDER_ID,
    deerflowModelProvider: environment.DEERFLOW_MODEL_PROVIDER,
    deerflowModelId: environment.DEERFLOW_MODEL_ID,
    deerflowModelBaseUrl: environment.DEERFLOW_MODEL_BASE_URL,
    deerflowModelCredentialVersion: environment.DEERFLOW_MODEL_CREDENTIAL_VERSION,
    flowiseAdapterOrigin: environment.FLOWISE_ADAPTER_URL,
    flowiseInstanceId: environment.FLOWISE_FRAMEWORK_INSTANCE_ID,
    flowiseSourceCommit: environment.FLOWISE_SOURCE_COMMIT,
    flowiseImageDigest: environment.FLOWISE_IMAGE_DIGEST,
    flowiseWorkerImageDigest: environment.FLOWISE_WORKER_IMAGE_DIGEST,
    flowiseDatabaseImageDigest: environment.FLOWISE_DATABASE_IMAGE_DIGEST,
    flowiseWorkspaceId: environment.FLOWISE_WORKSPACE_ID,
    flowiseReadinessWorkflowId: environment.FLOWISE_READINESS_WORKFLOW_ID,
    flowiseIsolation: environment.FLOWISE_TENANT_ISOLATION,
    flowiseQueueName: environment.FLOWISE_QUEUE_NAME,
  };
}

export function deriveAgentFrameworkConfigurationFromEnvironment(environment) {
  return deriveAgentFrameworkConfiguration(agentFrameworkConfigurationInputFromEnvironment(environment));
}
