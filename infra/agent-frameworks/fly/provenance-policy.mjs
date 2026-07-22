import { DEERFLOW_RUNTIME_IDENTITY } from "./operator-core.mjs";
import {
  DEERFLOW_SOURCE_COMMIT,
  FLOWISE_SOURCE_COMMIT,
  FRAMEWORK_BUILD_INPUTS,
  FRAMEWORK_BUILD_MATERIALS,
  POSTGRES_SOURCE_COMMIT,
  REDIS_SOURCE_COMMIT,
} from "../../../src/lib/agents/framework/source-identity.mjs";

const BUILD_TYPE = "https://mobyproject.org/buildkit@v1";
const BUILD_PLATFORM = "linux/amd64";
const DOCKERFILE_VERSION = "1.24.0";
const COMPATIBILITY_VERSION = 20;
const COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const RELEASE_REPOSITORY = "https://github.com/mysticalsin/aria-sourcing";
const BUILDKIT_METADATA = "https://mobyproject.org/buildkit@v1#metadata";

const SOURCE_COMMITS = Object.freeze({
  postgres: POSTGRES_SOURCE_COMMIT,
  redis: REDIS_SOURCE_COMMIT,
  "model-gateway": null,
  deerflow: DEERFLOW_SOURCE_COMMIT,
  flowise: FLOWISE_SOURCE_COMMIT,
  "flowise-worker": FLOWISE_SOURCE_COMMIT,
  adapter: null,
});

const ENTRY_POINTS = Object.freeze({
  postgres: "postgres.Dockerfile",
  redis: "redis.Dockerfile",
  "model-gateway": "model-gateway.Dockerfile",
  deerflow: "deerflow.Dockerfile",
  flowise: "flowise.Dockerfile",
  "flowise-worker": "flowise.Dockerfile",
  adapter: "adapter.Dockerfile",
});

const DOCKERFILE_DIRECTORIES = Object.freeze({
  postgres: "infra/agent-frameworks/fly/runtime",
  redis: "infra/agent-frameworks/fly/runtime",
  "model-gateway": "infra/agent-frameworks/fly/runtime",
  deerflow: "infra/agent-frameworks/upstream",
  flowise: "infra/agent-frameworks/upstream",
  "flowise-worker": "infra/agent-frameworks/upstream",
  adapter: "infra/agent-frameworks/fly/runtime",
});

const GIT_AUTH_SECRETS = Object.freeze([
  Object.freeze({ id: "GIT_AUTH_HEADER", optional: true }),
  Object.freeze({ id: "GIT_AUTH_TOKEN", optional: true }),
]);

function releaseMaterial(releaseSha) {
  return Object.freeze({
    uri: `${RELEASE_REPOSITORY}.git#${releaseSha}`,
    digest: Object.freeze({ sha1: releaseSha }),
  });
}

function fail(message) {
  throw new Error(`provenance ${message}`);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} has unexpected fields`);
}

function exactRecord(actual, expected, label) {
  exactKeys(actual, Object.keys(expected), label);
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) fail(`${label} has an invalid ${key}`);
  }
}

function canonicalRepository(value) {
  if (typeof value !== "string" || /[?#\s]/.test(value)) return "";
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function sourceCommit(component, releaseSha) {
  return SOURCE_COMMITS[component] ?? releaseSha;
}

function buildArguments(component, releaseSha) {
  const inputs = FRAMEWORK_BUILD_INPUTS[component];
  if (!inputs) fail("component is not reviewed");
  const values = {
    RELEASE_SOURCE_COMMIT: releaseSha,
    UPSTREAM_SOURCE_COMMIT: sourceCommit(component, releaseSha),
    UPSTREAM_IMAGE: inputs.UPSTREAM_IMAGE,
  };

  if (component === "deerflow") Object.assign(values, {
    DEERFLOW_BUILD_IMAGE: inputs.DEERFLOW_BUILD_IMAGE,
    DEERFLOW_UV_IMAGE: inputs.DEERFLOW_UV_IMAGE,
    DEERFLOW_UV_LOCK_SHA256: inputs.DEERFLOW_UV_LOCK_SHA256,
    DEERFLOW_PATCHED_RUNS_SHA256: DEERFLOW_RUNTIME_IDENTITY.patchedRunsSha256,
    DEERFLOW_CLEANUP_GUARD_SHA256: DEERFLOW_RUNTIME_IDENTITY.cleanupGuardSha256,
    DEERFLOW_RUNTIME_POLICY_SHA256: DEERFLOW_RUNTIME_IDENTITY.runtimePolicySha256,
    DEERFLOW_RUNTIME_CONFIG_SHA256: DEERFLOW_RUNTIME_IDENTITY.runtimeConfigSha256,
    DEERFLOW_DATABASE_BACKEND: DEERFLOW_RUNTIME_IDENTITY.databaseBackend,
    DEERFLOW_RUN_EVENTS_BACKEND: DEERFLOW_RUNTIME_IDENTITY.runEventsBackend,
    DEERFLOW_STREAM_BRIDGE_TYPE: DEERFLOW_RUNTIME_IDENTITY.streamBridgeType,
  });

  const args = Object.fromEntries(Object.entries(values).map(([key, value]) => [`build-arg:${key}`, value]));
  if (component === "deerflow") {
    args["context:deerflow_source"] = `https://github.com/bytedance/deer-flow.git#${DEERFLOW_SOURCE_COMMIT}`;
    args["frontend.caps"] = "moby.buildkit.frontend.contexts+forward";
  }
  if (component === "flowise" || component === "flowise-worker") {
    args["context:flowise_source"] = `https://github.com/FlowiseAI/Flowise.git#${FLOWISE_SOURCE_COMMIT}`;
    args["frontend.caps"] = "moby.buildkit.frontend.contexts+forward";
    args.target = component === "flowise" ? "server" : "worker";
  }
  return Object.freeze(args);
}

export function agentFrameworkProvenancePolicy(component, releaseSha) {
  if (!Object.hasOwn(SOURCE_COMMITS, component ?? "")) fail("component is not reviewed");
  if (!COMMIT.test(releaseSha ?? "")) fail("release SHA is invalid");
  const componentMaterials = FRAMEWORK_BUILD_MATERIALS[component];
  if (!Array.isArray(componentMaterials) || componentMaterials.length < 1) fail("component materials are incomplete");
  const reviewedRelease = releaseMaterial(releaseSha);
  const materials = Object.freeze([...componentMaterials, reviewedRelease]);
  return Object.freeze({
    component,
    releaseSha,
    sourceCommit: sourceCommit(component, releaseSha),
    entryPoint: `${DOCKERFILE_DIRECTORIES[component]}/${ENTRY_POINTS[component]}`,
    dockerfileDirectory: DOCKERFILE_DIRECTORIES[component],
    gitContext: true,
    releaseMaterial: reviewedRelease,
    args: buildArguments(component, releaseSha),
    materials,
  });
}

function materialKey(material, label) {
  exactKeys(material, ["uri", "digest"], label);
  if (typeof material.uri !== "string" || !material.uri || material.uri.length > 2048) fail(`${label} URI is invalid`);
  record(material.digest, `${label} digest`);
  const entries = Object.entries(material.digest);
  if (entries.length !== 1) fail(`${label} digest is invalid`);
  const [[algorithm, digest]] = entries;
  if (
    (algorithm === "sha1" && !COMMIT.test(digest ?? "")) ||
    (algorithm === "sha256" && !HASH.test(digest ?? "")) ||
    (algorithm !== "sha1" && algorithm !== "sha256")
  ) fail(`${label} digest is invalid`);
  return `${material.uri}\0${algorithm}:${digest}`;
}

function validateMaterials(materials, expected) {
  if (!Array.isArray(materials) || materials.length !== expected.length) fail("materials are not the exact reviewed set");
  const actualKeys = materials.map((value, index) => materialKey(value, `material ${index}`)).sort();
  const expectedKeys = expected.map((value, index) => materialKey(value, `expected material ${index}`)).sort();
  if (new Set(actualKeys).size !== actualKeys.length || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail("materials are not the exact reviewed set");
  }
}

function validateGitSecrets(value, expected) {
  if (!expected) {
    if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) fail("request contains an unexpected secret");
    return;
  }
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(GIT_AUTH_SECRETS)) {
    fail("request contains an unexpected secret");
  }
}

function rejectRequestAuthority(request, { gitContext = false } = {}) {
  validateGitSecrets(request.secrets, gitContext);
  if (request.ssh !== undefined && (!Array.isArray(request.ssh) || request.ssh.length !== 0)) {
    fail("request contains unexpected SSH authority");
  }
  if (request.inputs !== undefined && (typeof request.inputs !== "object" || request.inputs === null || Object.keys(request.inputs).length !== 0)) {
    fail("request contains unexpected nested input authority");
  }
}

function validateRootRequest(root, policy) {
  exactKeys(root, ["configSource", "request"], "root request");
  exactKeys(root.configSource, ["uri", "digest", "path"], "root config source");
  if (
    root.configSource.uri !== policy.releaseMaterial.uri ||
    root.configSource.path !== policy.entryPoint ||
    JSON.stringify(root.configSource.digest) !== JSON.stringify(policy.releaseMaterial.digest)
  ) fail("root config source is invalid");
  exactKeys(root.request, ["args"], "nested root request");
  rejectRequestAuthority(root.request);
  exactRecord(root.request.args, policy.args, "nested root arguments");
}

function validateParameters(parameters, policy) {
  const allowed = new Set(["frontend", "args", "secrets", "locals", "root", "compatibilityVersion"]);
  if (Object.keys(parameters).some((key) => !allowed.has(key))) fail("request parameters have unexpected fields");
  if (parameters.frontend !== "dockerfile.v0") fail("frontend is invalid");
  exactRecord(parameters.args, policy.args, "request arguments");
  rejectRequestAuthority(parameters, { gitContext: policy.gitContext });
  if (parameters.locals !== undefined && (!Array.isArray(parameters.locals) || parameters.locals.length !== 0)) {
    fail("remote build contains an unexpected local source");
  }
  if (parameters.compatibilityVersion !== COMPATIBILITY_VERSION) fail("compatibility version is invalid");
  if (parameters.root !== undefined) validateRootRequest(parameters.root, policy);
}

function validatePlatform(value) {
  if (value === undefined) return;
  record(value, "LLB platform");
  if (value.Architecture !== "amd64" || value.OS !== "linux") fail("LLB platform is not linux/amd64");
}

function validateLlbDefinition(definition, label) {
  if (!Array.isArray(definition) || definition.length < 1) fail(`${label} is missing`);
  for (const [index, step] of definition.entries()) {
    record(step, `${label} step ${index}`);
    record(step.op, `${label} step ${index} operation`);
    validatePlatform(step.op.platform);
    const operation = step.op.Op;
    record(operation, `${label} step ${index} operation union`);
    if (operation.source?.attrs !== undefined) {
      record(operation.source.attrs, `${label} step ${index} source attributes`);
      for (const [key, value] of Object.entries(operation.source.attrs)) {
        if (!key.toLowerCase().includes("secret")) continue;
        if (
          (key !== "git.authheadersecret" || value !== "GIT_AUTH_HEADER") &&
          (key !== "git.authtokensecret" || value !== "GIT_AUTH_TOKEN")
        ) fail("LLB source references an unexpected secret");
      }
    }
    const execution = operation.exec;
    if (!execution) continue;
    record(execution, `${label} step ${index} execution`);
    if (execution.network !== undefined && execution.network !== 0 && execution.network !== 2) {
      fail("LLB requests a network entitlement");
    }
    if (execution.security !== undefined) fail("LLB requests an insecure security entitlement");
    if (execution.secretenv !== undefined && (!Array.isArray(execution.secretenv) || execution.secretenv.length !== 0)) {
      fail("LLB requests a secret environment");
    }
    if (execution.cdiDevices !== undefined && (!Array.isArray(execution.cdiDevices) || execution.cdiDevices.length !== 0)) {
      fail("LLB requests a privileged device");
    }
    if (execution.mounts !== undefined && !Array.isArray(execution.mounts)) fail("LLB mounts are invalid");
    for (const mount of execution.mounts ?? []) {
      record(mount, `${label} step ${index} mount`);
      if (mount.mountType === 1 || mount.secretOpt !== undefined) fail("LLB requests a secret mount");
      if (mount.mountType === 2 || mount.SSHOpt !== undefined || mount.sshOpt !== undefined) fail("LLB requests an SSH mount");
    }
  }
}

function validateMaxBuild(document, policy) {
  exactKeys(document.buildConfig, ["llbDefinition", "digestMapping"], "max build config");
  validateLlbDefinition(document.buildConfig.llbDefinition, "max LLB definition");
  record(document.buildConfig.digestMapping, "max digest mapping");
  if (Object.keys(document.buildConfig.digestMapping).length < 1) fail("max digest mapping is empty");

  record(document.metadata, "max metadata");
  record(document.metadata.completeness, "max completeness");
  if (
    document.metadata.completeness.parameters !== true ||
    document.metadata.completeness.environment !== true ||
    document.metadata.completeness.materials !== true
  ) fail("max completeness is invalid");
  if (typeof document.metadata.buildInvocationID !== "string" || !document.metadata.buildInvocationID) {
    fail("max build invocation is invalid");
  }
  if (Number.isNaN(Date.parse(document.metadata.buildStartedOn)) || Number.isNaN(Date.parse(document.metadata.buildFinishedOn))) {
    fail("max build timestamps are invalid");
  }
  if (typeof document.metadata.reproducible !== "boolean") fail("max reproducibility is invalid");
  const buildkit = record(document.metadata[BUILDKIT_METADATA], "BuildKit max metadata");
  if (buildkit.network !== undefined) fail("BuildKit metadata contains an unexpected network entitlement");
  if (buildkit.vcs !== undefined) {
    record(buildkit.vcs, "BuildKit VCS identity");
    if (
      buildkit.vcs.revision !== policy.releaseSha ||
      canonicalRepository(buildkit.vcs.source) !== RELEASE_REPOSITORY
    ) fail("BuildKit VCS identity is invalid");
  }
  for (const [index, info] of (buildkit.source?.infos ?? []).entries()) {
    if (info?.llbDefinition !== undefined) validateLlbDefinition(info.llbDefinition, `source LLB definition ${index}`);
  }
}

export function validateAgentFrameworkProvenance(document, { component, releaseSha } = {}) {
  const policy = agentFrameworkProvenancePolicy(component, releaseSha);
  exactKeys(document, ["builder", "buildType", "materials", "invocation", "buildConfig", "metadata"], "predicate");
  exactRecord(document.builder, { id: "" }, "builder");
  if (document.buildType !== BUILD_TYPE) fail("build type is invalid");
  validateMaterials(document.materials, policy.materials);

  exactKeys(document.invocation, ["configSource", "parameters", "environment"], "invocation");
  exactKeys(document.invocation.configSource, ["uri", "digest", "entryPoint"], "config source");
  if (
    document.invocation.configSource.uri !== policy.releaseMaterial.uri ||
    document.invocation.configSource.entryPoint !== policy.entryPoint ||
    JSON.stringify(document.invocation.configSource.digest) !== JSON.stringify(policy.releaseMaterial.digest)
  ) fail("config source is invalid");
  validateParameters(record(document.invocation.parameters, "request parameters"), policy);
  exactRecord(document.invocation.environment, {
    dockerfileVersion: DOCKERFILE_VERSION,
    platform: BUILD_PLATFORM,
  }, "build environment");
  validateMaxBuild(document, policy);
  return policy;
}
