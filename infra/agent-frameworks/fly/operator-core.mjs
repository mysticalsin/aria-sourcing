import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import {
  agentFrameworkConfigurationInputFromEnvironment,
  deriveAgentFrameworkConfiguration,
} from "../../../src/lib/agents/framework/configuration-core.mjs";

export const FLY_MANIFEST_SCHEMA = "aria.agent-framework.fly-manifest.v2";
export const FLY_PLAN_SCHEMA = "aria.agent-framework.fly-plan.v1";
export const FLY_APPROVAL_SCHEMA = "aria.agent-framework.fly-approval.v1";
export const DEERFLOW_RUNTIME_IDENTITY = Object.freeze({
  patchedRunsSha256: "d5ee9ebcf676656ca9380e866b414d1ff4fa70cfac587a9fbc7d7a60506a6db4",
  cleanupGuardSha256: "4e4b0006ad7486b5b028dfa9168e3e45d26d33eca46e7b653db29db4683918e6",
  runtimePolicySha256: "9312dff2f23f04fc8c2a92600d47d8d4958094e4c37e010c10ff1e011dce6025",
  runtimeConfigSha256: "a5a41ab4a2772e74203820d65a6efb488bc3b6a5948c47a8d1f9dd6cd3a30369",
  databaseBackend: "memory",
  runEventsBackend: "memory",
  streamBridgeType: "memory",
});
export const ROLE_ORDER = Object.freeze([
  "deerflow-db",
  "deerflow-redis",
  "flowise-db",
  "flowise-redis",
  "model-gateway",
  "deerflow",
  "flowise",
  "flowise-worker",
  "deerflow-adapter",
  "flowise-adapter",
]);
export const RELEASE_DISABLED_ROLES = Object.freeze(["deerflow-db", "deerflow-redis"]);
const DEERFLOW_ADAPTER_ORIGIN = "http://aria-mantu-deerflow-adapter.internal:8080";
const FLOWISE_ADAPTER_ORIGIN = "http://aria-mantu-flowise-adapter.internal:8080";
const MODEL_GATEWAY_BASE_URL = "http://aria-mantu-model-gateway.internal:8090/v1";

export const APP_BY_ROLE = Object.freeze({
  "deerflow-db": "aria-mantu-deerflow-db",
  "deerflow-redis": "aria-mantu-deerflow-redis",
  "flowise-db": "aria-mantu-flowise-db",
  "flowise-redis": "aria-mantu-flowise-redis",
  "model-gateway": "aria-mantu-model-gateway",
  deerflow: "aria-mantu-deerflow",
  flowise: "aria-mantu-flowise",
  "flowise-worker": "aria-mantu-flowise-worker",
  "deerflow-adapter": "aria-mantu-deerflow-adapter",
  "flowise-adapter": "aria-mantu-flowise-adapter",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE = /^registry\.fly\.io\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?@sha256:[0-9a-f]{64}$/;
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,4096}$/;
const MACHINE_ID = /^[a-z0-9]{10,32}$/;
const FLY_SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

const SECRET_FILES = Object.freeze({
  "deerflow-db": Object.freeze([
    ["ARIA_FLY_SECRET_DEERFLOW_DB_PASSWORD_FILE", "ARIA_DB_PASSWORD_B64"],
  ]),
  "deerflow-redis": Object.freeze([
  ]),
  "flowise-db": Object.freeze([
    ["ARIA_FLY_SECRET_FLOWISE_DB_PASSWORD_FILE", "ARIA_DB_PASSWORD_B64"],
  ]),
  "flowise-redis": Object.freeze([
    ["ARIA_FLY_SECRET_FLOWISE_REDIS_PASSWORD_FILE", "ARIA_REDIS_PASSWORD_B64"],
  ]),
  "model-gateway": Object.freeze([
    ["ARIA_FLY_SECRET_DEERFLOW_MODEL_GATEWAY_TOKEN_FILE", "ARIA_GATEWAY_TOKEN_B64"],
    ["ARIA_FLY_SECRET_DEERFLOW_MODEL_PROVIDER_API_KEY_FILE", "ARIA_PROVIDER_API_KEY_B64"],
  ]),
  deerflow: Object.freeze([
    ["ARIA_FLY_SECRET_DEERFLOW_MODEL_GATEWAY_TOKEN_FILE", "ARIA_GATEWAY_TOKEN_B64"],
    ["ARIA_FLY_SECRET_DEERFLOW_INTERNAL_TOKEN_FILE", "ARIA_DEERFLOW_INTERNAL_TOKEN_B64"],
  ]),
  flowise: Object.freeze([
    ["ARIA_FLY_SECRET_FLOWISE_DB_PASSWORD_FILE", "ARIA_FLOWISE_DB_PASSWORD_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_REDIS_PASSWORD_FILE", "ARIA_FLOWISE_REDIS_PASSWORD_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_ENCRYPTION_KEY_FILE", "ARIA_FLOWISE_ENCRYPTION_KEY_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_JWT_AUTH_SECRET_FILE", "ARIA_FLOWISE_JWT_AUTH_SECRET_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_JWT_REFRESH_SECRET_FILE", "ARIA_FLOWISE_JWT_REFRESH_SECRET_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_SESSION_SECRET_FILE", "ARIA_FLOWISE_SESSION_SECRET_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_TOKEN_HASH_SECRET_FILE", "ARIA_FLOWISE_TOKEN_HASH_SECRET_B64"],
  ]),
  "flowise-worker": Object.freeze([
    ["ARIA_FLY_SECRET_FLOWISE_DB_PASSWORD_FILE", "ARIA_FLOWISE_DB_PASSWORD_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_REDIS_PASSWORD_FILE", "ARIA_FLOWISE_REDIS_PASSWORD_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_ENCRYPTION_KEY_FILE", "ARIA_FLOWISE_ENCRYPTION_KEY_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_JWT_AUTH_SECRET_FILE", "ARIA_FLOWISE_JWT_AUTH_SECRET_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_JWT_REFRESH_SECRET_FILE", "ARIA_FLOWISE_JWT_REFRESH_SECRET_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_SESSION_SECRET_FILE", "ARIA_FLOWISE_SESSION_SECRET_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_TOKEN_HASH_SECRET_FILE", "ARIA_FLOWISE_TOKEN_HASH_SECRET_B64"],
  ]),
  "deerflow-adapter": Object.freeze([
    ["ARIA_FLY_SECRET_DEERFLOW_ADAPTER_TOKEN_FILE", "ARIA_ADAPTER_TOKEN_B64"],
    ["ARIA_FLY_SECRET_DEERFLOW_INTERNAL_TOKEN_FILE", "ARIA_UPSTREAM_TOKEN_B64"],
    ["ARIA_FLY_SECRET_AGENT_FRAMEWORK_CAPABILITY_SECRET_FILE", "ARIA_CAPABILITY_SECRET_B64"], // gitleaks:allow - environment variable names only
    ["ARIA_FLY_SECRET_DEERFLOW_MODEL_GATEWAY_TOKEN_FILE", "ARIA_GATEWAY_TOKEN_B64"],
  ]),
  "flowise-adapter": Object.freeze([
    ["ARIA_FLY_SECRET_FLOWISE_ADAPTER_TOKEN_FILE", "ARIA_ADAPTER_TOKEN_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_API_KEY_FILE", "ARIA_UPSTREAM_TOKEN_B64"],
    ["ARIA_FLY_SECRET_FLOWISE_REDIS_PASSWORD_FILE", "ARIA_REDIS_PASSWORD_B64"],
  ]),
});

function fail(message) {
  throw new Error(message);
}

function plainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} has unexpected fields`);
}

function required(value, label, maximum = 2048) {
  if (
    typeof value !== "string" || value.trim() !== value || value.length < 1 ||
    value.length > maximum || /[\r\n\0]/.test(value)
  ) fail(`${label} is invalid`);
  return value;
}

function uuid(value, label) {
  const normalized = required(value, label, 36).toLowerCase();
  if (!UUID.test(normalized) || normalized === "00000000-0000-0000-0000-000000000000") fail(`${label} is invalid`);
  return normalized;
}

function sha256(value, label) {
  const normalized = required(value, label, 64);
  if (!SHA256.test(normalized) || /^0+$/.test(normalized)) fail(`${label} is invalid`);
  return normalized;
}

function commit(value, label) {
  const normalized = required(value, label, 40);
  if (!COMMIT.test(normalized) || /^0+$/.test(normalized)) fail(`${label} is invalid`);
  return normalized;
}

function imageRef(value, label) {
  const normalized = required(value, label, 460);
  if (!IMAGE.test(normalized) || /@sha256:0{64}$/.test(normalized)) fail(`${label} must be an immutable image digest`);
  return normalized;
}

const IMAGE_TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const IMAGE_PATH_COMPONENT = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const IMAGE_DOMAIN = /^(?:localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::[1-9][0-9]{0,4})?$/;

export function canonicalTaggedImageReference(value) {
  if (
    typeof value !== "string" || value.length < 3 || value.length > 384 ||
    /[\s\0-\x1f\x7f]/.test(value) || value.includes("://") || value.includes("@")
  ) fail("tagged image reference is invalid");
  const lastSlash = value.lastIndexOf("/");
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= lastSlash || lastColon < 1 || lastColon === value.length - 1) {
    fail("tagged image reference must include an explicit tag");
  }
  const repository = value.slice(0, lastColon);
  const tag = value.slice(lastColon + 1);
  if (!IMAGE_TAG.test(tag)) fail("tagged image reference has an invalid tag");
  if (tag.toLowerCase() === "latest") fail("tagged image reference must use a pinned tag");
  if (repository.length > 255 || repository.startsWith("/") || repository.endsWith("/")) {
    fail("tagged image reference has an invalid repository");
  }
  const components = repository.split("/");
  const domainLike = components[0].includes(".") || components[0].includes(":") || components[0] === "localhost";
  if (domainLike) {
    if (components.length < 2 || !IMAGE_DOMAIN.test(components.shift())) {
      fail("tagged image reference has an invalid repository");
    }
    const port = repository.match(/^[^/]+:([0-9]+)\//)?.[1];
    if (port && Number(port) > 65_535) fail("tagged image reference has an invalid repository");
  }
  if (components.length < 1 || components.some((component) => !IMAGE_PATH_COMPONENT.test(component))) {
    fail("tagged image reference has an invalid repository");
  }
  return Object.freeze({ repository, tag });
}

function httpsUrl(value, label, { originOnly = false } = {}) {
  const normalized = required(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail(`${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) {
    fail(`${label} must be HTTPS`);
  }
  if (originOnly && parsed.pathname !== "/") fail(`${label} must be an HTTPS origin`);
  return originOnly ? parsed.origin : parsed.href.replace(/\/$/, "");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestJson(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function normalizeImage(value, role) {
  exactKeys(value, ["ref", "sourceCommit", "certificateIdentity", "certificateIssuer"], `${role} image`);
  return Object.freeze({
    ref: imageRef(value.ref, `${role} image digest`),
    sourceCommit: commit(value.sourceCommit, `${role} source commit`),
    certificateIdentity: httpsUrl(value.certificateIdentity, `${role} certificate identity`),
    certificateIssuer: httpsUrl(value.certificateIssuer, `${role} certificate issuer`, { originOnly: true }),
  });
}

export function validateManifest(value) {
  exactKeys(value, [
    "schema", "phase", "deploymentId", "organization", "network", "region",
    "sourceReleaseSha", "configurationSha256", "deerflowRuntime", "workspaceId", "frameworkInstances",
    "model", "flowise", "images",
  ], "manifest");
  if (value.schema !== FLY_MANIFEST_SCHEMA || value.phase !== "runtime") fail("manifest schema or phase is invalid");
  const organization = required(value.organization, "organization", 63);
  const network = required(value.network, "network", 63);
  const region = required(value.region, "region", 8);
  if (!NAME.test(organization)) fail("organization is invalid");
  if (network !== "default") fail("network must be the reviewed default 6PN used by the ARIA control app");
  if (region !== "cdg") fail("region must match the ARIA production region");

  exactKeys(value.frameworkInstances, ["deerflow", "flowise"], "framework instances");
  const deerflowInstance = uuid(value.frameworkInstances.deerflow, "DeerFlow instance");
  const flowiseInstance = uuid(value.frameworkInstances.flowise, "Flowise instance");
  if (deerflowInstance === flowiseInstance) fail("framework instance IDs must be independent");

  exactKeys(value.deerflowRuntime, Object.keys(DEERFLOW_RUNTIME_IDENTITY), "DeerFlow runtime");
  const deerflowRuntime = Object.freeze({
    patchedRunsSha256: sha256(value.deerflowRuntime.patchedRunsSha256, "DeerFlow runtime patched runs SHA"),
    cleanupGuardSha256: sha256(value.deerflowRuntime.cleanupGuardSha256, "DeerFlow runtime cleanup guard SHA"),
    runtimePolicySha256: sha256(value.deerflowRuntime.runtimePolicySha256, "DeerFlow runtime policy SHA"),
    runtimeConfigSha256: sha256(value.deerflowRuntime.runtimeConfigSha256, "DeerFlow runtime config SHA"),
    databaseBackend: required(value.deerflowRuntime.databaseBackend, "DeerFlow runtime database backend", 32),
    runEventsBackend: required(value.deerflowRuntime.runEventsBackend, "DeerFlow runtime run-events backend", 32),
    streamBridgeType: required(value.deerflowRuntime.streamBridgeType, "DeerFlow runtime stream-bridge type", 32),
  });
  if (canonicalJson(deerflowRuntime) !== canonicalJson(DEERFLOW_RUNTIME_IDENTITY)) {
    fail("DeerFlow runtime identity does not match the audited runtime");
  }

  exactKeys(value.model, ["providerId", "modelId", "baseUrl", "credentialVersion"], "model");
  const providerId = required(value.model.providerId, "model provider", 64);
  if (!new Set(["kimi", "openai"]).has(providerId)) fail("model provider is not allowlisted");
  const baseUrl = httpsUrl(value.model.baseUrl, "model base URL");
  const expectedBaseUrl = providerId === "kimi" ? "https://api.moonshot.ai/v1" : "https://api.openai.com/v1";
  if (baseUrl !== expectedBaseUrl) fail("model base URL does not match the provider allowlist");

  exactKeys(value.flowise, ["workspaceId", "readinessWorkflowId"], "Flowise binding");
  const images = plainRecord(value.images, "images");
  if (JSON.stringify(Object.keys(images).sort()) !== JSON.stringify([...ROLE_ORDER].sort())) {
    fail("images must bind every Fly role exactly once");
  }

  const normalizedImages = Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => [role, normalizeImage(images[role], role)])));
  if (normalizedImages["deerflow-adapter"].ref !== normalizedImages["flowise-adapter"].ref) {
    fail("both adapters must use the same reviewed adapter image digest");
  }
  if (normalizedImages["deerflow-redis"].ref !== normalizedImages["flowise-redis"].ref) {
    fail("both Redis planes must use the same reviewed Redis image digest");
  }

  const normalized = Object.freeze({
    schema: FLY_MANIFEST_SCHEMA,
    phase: "runtime",
    deploymentId: uuid(value.deploymentId, "deploymentId"),
    organization,
    network,
    region,
    sourceReleaseSha: commit(value.sourceReleaseSha, "source release SHA"),
    configurationSha256: sha256(value.configurationSha256, "configuration SHA"),
    deerflowRuntime,
    workspaceId: uuid(value.workspaceId, "workspaceId"),
    frameworkInstances: Object.freeze({ deerflow: deerflowInstance, flowise: flowiseInstance }),
    model: Object.freeze({
      providerId,
      modelId: required(value.model.modelId, "model ID", 200),
      baseUrl,
      credentialVersion: required(value.model.credentialVersion, "model credential version", 128),
    }),
    flowise: Object.freeze({
      workspaceId: uuid(value.flowise.workspaceId, "Flowise workspaceId"),
      readinessWorkflowId: required(value.flowise.readinessWorkflowId, "Flowise readiness workflow", 128),
    }),
    images: normalizedImages,
  });
  const generatedConfigurationSha256 = deriveAgentFrameworkConfiguration(
    agentFrameworkConfigurationInputFromEnvironment(dynamicEnvironment("deerflow-adapter", normalized)),
  ).sha256;
  if (generatedConfigurationSha256 !== normalized.configurationSha256) {
    fail("configuration SHA does not match the generated private adapter environment");
  }
  return Object.freeze({ ...normalized, sha256: digestJson(normalized) });
}

function validateSupplyChainEvidence(evidence) {
  plainRecord(evidence, "supply-chain evidence");
  if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify([...ROLE_ORDER].sort())) {
    fail("supply-chain evidence is incomplete");
  }
  return Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => {
    const item = evidence[role];
    exactKeys(item, ["signatureSha256", "sbomSha256", "provenanceSha256", "vulnerabilityScanSha256"], `${role} evidence`);
    return [role, Object.freeze({
      signatureSha256: sha256(item.signatureSha256, `${role} signature evidence`),
      sbomSha256: sha256(item.sbomSha256, `${role} SBOM evidence`),
      provenanceSha256: sha256(item.provenanceSha256, `${role} provenance evidence`),
      vulnerabilityScanSha256: sha256(item.vulnerabilityScanSha256, `${role} scan evidence`),
    })];
  })));
}

export function createPlan(manifest, { now = new Date(), supplyChainEvidence, priorState, configSha256ByRole }) {
  if (!manifest || manifest.sha256 !== digestJson(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "sha256")))) {
    fail("manifest identity is invalid");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) fail("plan time is invalid");
  plainRecord(priorState, "prior state");
  if (JSON.stringify(Object.keys(priorState).sort()) !== JSON.stringify([...ROLE_ORDER].sort())) fail("prior state is incomplete");
  plainRecord(configSha256ByRole, "Fly config identities");
  if (JSON.stringify(Object.keys(configSha256ByRole).sort()) !== JSON.stringify([...ROLE_ORDER].sort())) {
    fail("Fly config identities are incomplete");
  }
  const evidence = validateSupplyChainEvidence(supplyChainEvidence);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.valueOf() + 15 * 60_000).toISOString();
  return Object.freeze({
    schema: FLY_PLAN_SCHEMA,
    deploymentId: manifest.deploymentId,
    manifestSha256: manifest.sha256,
    sourceReleaseSha: manifest.sourceReleaseSha,
    organization: manifest.organization,
    network: manifest.network,
    region: manifest.region,
    createdAt,
    expiresAt,
    applications: Object.freeze(Object.fromEntries(ROLE_ORDER.map((role) => [role, Object.freeze({
      app: APP_BY_ROLE[role],
      config: `${role}.toml`,
      releaseDisabled: RELEASE_DISABLED_ROLES.includes(role),
      configSha256: sha256(configSha256ByRole[role], `${role} Fly config SHA`),
      image: manifest.images[role].ref,
      sourceCommit: manifest.images[role].sourceCommit,
      supplyChain: evidence[role],
      priorState: priorState[role] ?? null,
    })]))),
  });
}

export function confirmationForPlan(plan) {
  if (!plan || plan.schema !== FLY_PLAN_SCHEMA) fail("plan is invalid");
  return digestJson(plan);
}

export function createApproval(plan, suppliedConfirmation, now = new Date()) {
  const expected = confirmationForPlan(plan);
  if (suppliedConfirmation !== expected) fail("confirmation does not match the plan");
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) fail("approval time is invalid");
  return Object.freeze({
    schema: FLY_APPROVAL_SCHEMA,
    deploymentId: plan.deploymentId,
    planSha256: expected,
    approvedAt: now.toISOString(),
  });
}

export function validateApproval(plan, value) {
  exactKeys(value, ["schema", "deploymentId", "planSha256", "approvedAt"], "approval");
  const expected = confirmationForPlan(plan);
  if (
    value.schema !== FLY_APPROVAL_SCHEMA ||
    uuid(value.deploymentId, "approval deploymentId") !== plan.deploymentId ||
    sha256(value.planSha256, "approval plan SHA") !== expected
  ) fail("approval does not bind this plan");
  const approvedAt = new Date(required(value.approvedAt, "approval time", 40));
  if (!Number.isFinite(approvedAt.valueOf())) fail("approval time is invalid");
  return Object.freeze({
    schema: FLY_APPROVAL_SCHEMA,
    deploymentId: plan.deploymentId,
    planSha256: expected,
    approvedAt: approvedAt.toISOString(),
  });
}

async function readSecretFile(file, label) {
  const resolved = required(file, `${label} file`, 4096);
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail(`${label} secret file permissions are invalid`);
  const value = (await readFile(resolved, "utf8")).trim();
  if (!TOKEN.test(value)) fail(`${label} secret material is invalid`);
  return value;
}

export function dynamicEnvironment(role, manifest) {
  const common = {
    ARIA_RELEASE_SHA: manifest.sourceReleaseSha,
  };
  if (role === "model-gateway") return {
    ...common,
    MODEL_GATEWAY_PROVIDER_ID: manifest.model.providerId,
    MODEL_GATEWAY_MODEL_ID: manifest.model.modelId,
  };
  if (role === "deerflow") return {
    ...common,
    ARIA_WORKSPACE_ID: manifest.workspaceId,
    DEERFLOW_MODEL_ID: manifest.model.modelId,
  };
  if (!role.endsWith("-adapter")) return common;
  const upstreamRole = role === "deerflow-adapter" ? "deerflow" : "flowise";
  return {
    ...common,
    AGENT_FRAMEWORK_READINESS_WORKSPACE_ID: manifest.workspaceId,
    AGENT_FRAMEWORK_CONFIGURATION_SHA256: manifest.configurationSha256,
    FRAMEWORK_ADAPTER_IMAGE_DIGEST: manifest.images[role].ref,
    REDIS_IMAGE_DIGEST: manifest.images[role.startsWith("deerflow") ? "deerflow-redis" : "flowise-redis"].ref,
    DEERFLOW_ADAPTER_URL: DEERFLOW_ADAPTER_ORIGIN,
    DEERFLOW_FRAMEWORK_INSTANCE_ID: manifest.frameworkInstances.deerflow,
    DEERFLOW_SOURCE_COMMIT: manifest.images.deerflow.sourceCommit,
    DEERFLOW_IMAGE_DIGEST: manifest.images.deerflow.ref,
    DEERFLOW_DATABASE_IMAGE_DIGEST: manifest.images["deerflow-db"].ref,
    DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST: manifest.images["model-gateway"].ref,
    DEERFLOW_CLOUD_PROVIDER_ID: manifest.model.providerId,
    DEERFLOW_MODEL_PROVIDER: "langchain-openai",
    DEERFLOW_MODEL_ID: manifest.model.modelId,
    DEERFLOW_MODEL_BASE_URL: MODEL_GATEWAY_BASE_URL,
    DEERFLOW_MODEL_CREDENTIAL_VERSION: manifest.model.credentialVersion,
    FLOWISE_ADAPTER_URL: FLOWISE_ADAPTER_ORIGIN,
    FLOWISE_FRAMEWORK_INSTANCE_ID: manifest.frameworkInstances.flowise,
    FLOWISE_SOURCE_COMMIT: manifest.images.flowise.sourceCommit,
    FLOWISE_IMAGE_DIGEST: manifest.images.flowise.ref,
    FLOWISE_WORKER_IMAGE_DIGEST: manifest.images["flowise-worker"].ref,
    FLOWISE_DATABASE_IMAGE_DIGEST: manifest.images["flowise-db"].ref,
    FLOWISE_WORKSPACE_ID: manifest.flowise.workspaceId,
    FLOWISE_READINESS_WORKFLOW_ID: manifest.flowise.readinessWorkflowId,
    FLOWISE_TENANT_ISOLATION: "instance-per-workspace",
    FLOWISE_QUEUE_NAME: "aria-flowise",
    ARIA_WORKSPACE_ID: manifest.workspaceId,
    FRAMEWORK_INSTANCE_ID: role === "deerflow-adapter"
      ? manifest.frameworkInstances.deerflow
      : manifest.frameworkInstances.flowise,
    UPSTREAM_SOURCE_COMMIT: manifest.images[upstreamRole].sourceCommit,
    UPSTREAM_IMAGE_DIGEST: manifest.images[upstreamRole].ref,
  };
}

export async function secretImportForRole(role, manifest, environment = process.env) {
  if (!ROLE_ORDER.includes(role)) fail("Fly role is invalid");
  if (RELEASE_DISABLED_ROLES.includes(role)) fail(`${role} is release-disabled`);
  const entries = [];
  for (const [fileVariable, flySecret] of SECRET_FILES[role]) {
    const value = await readSecretFile(environment[fileVariable], fileVariable);
    entries.push([flySecret, Buffer.from(value, "utf8").toString("base64")]);
  }
  for (const [name, value] of Object.entries(dynamicEnvironment(role, manifest))) {
    entries.push([name, required(value, name, 2048)]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return `${entries.map(([name, value]) => `${name}=${value}`).join("\n")}\n`;
}

export function validateFlySecretInventory(role, manifest, value, { requireComplete = true } = {}) {
  if (!ROLE_ORDER.includes(role) || !Array.isArray(value) || typeof requireComplete !== "boolean") {
    fail("Fly secret inventory is invalid");
  }
  const expected = RELEASE_DISABLED_ROLES.includes(role)
    ? []
    : [...new Set([
        ...SECRET_FILES[role].map((entry) => entry[1]),
        ...Object.keys(dynamicEnvironment(role, manifest)),
      ])].sort();
  const accepted = new Set(expected);
  const actual = new Set();
  for (const item of value) {
    plainRecord(item, `${role} Fly secret`);
    const upper = item.Name;
    const lower = item.name;
    if (upper !== undefined && lower !== undefined && upper !== lower) fail("Fly secret inventory is invalid");
    const name = upper ?? lower;
    if (typeof name !== "string" || !FLY_SECRET_NAME.test(name) || actual.has(name)) {
      fail("Fly secret inventory is invalid");
    }
    if (!accepted.has(name)) fail(`${role} has a stale Fly secret: ${name}`);
    actual.add(name);
  }
  if (requireComplete && expected.some((name) => !actual.has(name))) {
    fail(`${role} Fly secret inventory is incomplete`);
  }
  return Object.freeze([...actual].sort());
}

export function validateMachineInventory(role, expectedImage, value) {
  if (!ROLE_ORDER.includes(role) || !Array.isArray(value)) fail("machine inventory is invalid");
  const running = value.filter((machine) => machine?.state === "started");
  if (running.length !== 1) fail(`${role} must have exactly one started machine`);
  const machine = running[0];
  const machineId = required(machine.id, `${role} machine ID`, 32);
  if (!MACHINE_ID.test(machineId)) fail(`${role} machine ID is invalid`);
  if (Array.isArray(machine?.config?.services) && machine.config.services.length > 0) {
    fail(`${role} machine unexpectedly exposes Fly Proxy services`);
  }
  const rawImage = machine?.config?.image ?? machine?.image_ref;
  const actualImage = typeof rawImage === "string"
    ? rawImage
    : rawImage && typeof rawImage === "object" && typeof rawImage.registry === "string" &&
        typeof rawImage.repository === "string" && typeof rawImage.digest === "string"
      ? `${rawImage.registry}/${rawImage.repository}@${rawImage.digest}`
      : null;
  if (actualImage !== expectedImage) fail(`${role} machine image does not match the plan`);
  return Object.freeze({ machineId, imageDigest: expectedImage, state: "started" });
}

export function validateDeerFlowRuntimeHealth(value, manifest) {
  exactKeys(value, [
    "mode", "status", "patchedRunsSha256", "cleanupGuardSha256", "runtimePolicySha256", "runtimeConfigSha256",
    "databaseBackend", "runEventsBackend", "streamBridgeType", "tracingDisabled", "persistenceEnvironmentClean",
  ], "DeerFlow runtime health");
  if (
    value.mode !== "deerflow" || value.status !== "ready" ||
    value.tracingDisabled !== true || value.persistenceEnvironmentClean !== true
  ) fail("DeerFlow runtime readiness failed");
  const runtime = Object.freeze({
    patchedRunsSha256: sha256(value.patchedRunsSha256, "DeerFlow health patched runs SHA"),
    cleanupGuardSha256: sha256(value.cleanupGuardSha256, "DeerFlow health cleanup guard SHA"),
    runtimePolicySha256: sha256(value.runtimePolicySha256, "DeerFlow health runtime policy SHA"),
    runtimeConfigSha256: sha256(value.runtimeConfigSha256, "DeerFlow health runtime config SHA"),
    databaseBackend: required(value.databaseBackend, "DeerFlow health database backend", 32),
    runEventsBackend: required(value.runEventsBackend, "DeerFlow health run-events backend", 32),
    streamBridgeType: required(value.streamBridgeType, "DeerFlow health stream-bridge type", 32),
  });
  if (!manifest?.deerflowRuntime || canonicalJson(runtime) !== canonicalJson(manifest.deerflowRuntime)) {
    fail("DeerFlow runtime identity does not match the manifest");
  }
  return Object.freeze({
    mode: "deerflow",
    status: "ready",
    ...runtime,
    tracingDisabled: true,
    persistenceEnvironmentClean: true,
  });
}
