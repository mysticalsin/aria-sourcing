import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FLY_MANIFEST_SCHEMA,
  RELEASE_DISABLED_ROLES,
  ROLE_ORDER,
  confirmationForPlan,
  createApproval,
  createPlan,
  dynamicEnvironment,
  secretImportForRole,
  validateDeerFlowRuntimeHealth,
  validateFlySecretInventory,
  validateApproval,
  validateMachineInventory,
  validateManifest,
} from "./operator-core.mjs";
import { verifySupplyChainForImage } from "./operator.mjs";
import {
  agentFrameworkConfigurationInputFromEnvironment,
  deriveAgentFrameworkConfiguration,
} from "../../../src/lib/agents/framework/configuration-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");
const CONFIGS = Object.freeze([
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
const SHA = "a".repeat(64);
const SHA_B = "b".repeat(64);
const COMMIT = "c".repeat(40);
const DEERFLOW_RUNTIME = Object.freeze({
  patchedRunsSha256: "79b6601066faa937a2d0b5551f7e1a5311304f1e7b28962c1ccee72cea05d6e7",
  cleanupGuardSha256: "4e4b0006ad7486b5b028dfa9168e3e45d26d33eca46e7b653db29db4683918e6",
  runtimePolicySha256: "9312dff2f23f04fc8c2a92600d47d8d4958094e4c37e010c10ff1e011dce6025",
  runtimeConfigSha256: "a5a41ab4a2772e74203820d65a6efb488bc3b6a5948c47a8d1f9dd6cd3a30369",
  databaseBackend: "memory",
  runEventsBackend: "memory",
  streamBridgeType: "memory",
});
const UUIDS = Object.freeze({
  deployment: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  deerflow: "30000000-0000-4000-8000-000000000003",
  flowise: "40000000-0000-4000-8000-000000000004",
  flowiseWorkspace: "50000000-0000-4000-8000-000000000005",
});

function image(role) {
  const sharedRole = role.endsWith("-adapter")
    ? "adapter"
    : role.endsWith("-redis")
      ? "redis"
      : role;
  return {
    ref: `registry.fly.io/aria-${sharedRole}@sha256:${SHA}`,
    sourceCommit: COMMIT,
    certificateIdentity: "https://github.com/mantu/aria/.github/workflows/promote.yml@refs/heads/main",
    certificateIssuer: "https://token.actions.githubusercontent.com",
  };
}

function manifest(overrides = {}) {
  const value = {
    schema: FLY_MANIFEST_SCHEMA,
    phase: "runtime",
    deploymentId: UUIDS.deployment,
    organization: "mantu",
    network: "default",
    region: "cdg",
    sourceReleaseSha: COMMIT,
    configurationSha256: SHA_B,
    deerflowRuntime: DEERFLOW_RUNTIME,
    workspaceId: UUIDS.workspace,
    frameworkInstances: {
      deerflow: UUIDS.deerflow,
      flowise: UUIDS.flowise,
    },
    model: {
      providerId: "kimi",
      modelId: "moonshot-v1-128k",
      baseUrl: "https://api.moonshot.ai/v1",
      credentialVersion: "kimi-prod-v2",
    },
    flowise: {
      workspaceId: UUIDS.flowiseWorkspace,
      readinessWorkflowId: "aria-readiness-workflow",
    },
    images: Object.fromEntries(CONFIGS.map((role) => [role, image(role)])),
    ...overrides,
  };
  value.configurationSha256 = deriveAgentFrameworkConfiguration(
    agentFrameworkConfigurationInputFromEnvironment(dynamicEnvironment("deerflow-adapter", value)),
  ).sha256;
  return value;
}

test("Fly adapter authority uses exact private runtime origins and a derived configuration digest", () => {
  const accepted = validateManifest(manifest());
  for (const role of ["deerflow-adapter", "flowise-adapter"]) {
    const environment = dynamicEnvironment(role, accepted);
    assert.equal(environment.DEERFLOW_ADAPTER_URL, "http://aria-mantu-deerflow-adapter.internal:8080");
    assert.equal(environment.FLOWISE_ADAPTER_URL, "http://aria-mantu-flowise-adapter.internal:8080");
    assert.equal(environment.DEERFLOW_MODEL_BASE_URL, "http://aria-mantu-model-gateway.internal:8090/v1");
    assert.equal(environment.DEERFLOW_MODEL_BASE_URL.includes("api.moonshot.ai"), false);
    assert.equal(
      deriveAgentFrameworkConfiguration(
        agentFrameworkConfigurationInputFromEnvironment(environment),
      ).sha256,
      accepted.configurationSha256,
    );
  }
  assert.throws(
    () => validateManifest({ ...manifest(), configurationSha256: "0".repeat(64) }),
    /configuration SHA/i,
  );
});

test("all reviewed Fly role configs validate and remain private without Fly Proxy services", () => {
  assert.deepEqual(ROLE_ORDER, CONFIGS);
  assert.deepEqual(RELEASE_DISABLED_ROLES, ["deerflow-db", "deerflow-redis"]);
  for (const role of CONFIGS) {
    const file = path.join(here, `${role}.toml`);
    const source = fs.readFileSync(file, "utf8");
    execFileSync("flyctl", ["config", "validate", "--config", file], { stdio: "pipe" });
    assert.doesNotMatch(source, /^\s*\[\[?services?\]?\]/m, role);
    assert.doesNotMatch(source, /^\s*\[http_service\]/m, role);
    assert.doesNotMatch(source, /^\s*\[build\]/m, role);
    assert.match(source, /primary_region\s*=\s*"cdg"/, role);
    assert.match(source, /\[\[restart\]\][\s\S]*?policy\s*=\s*"always"/, role);
    assert.match(source, /\[deploy\][\s\S]*?strategy\s*=\s*"rolling"/, role);
    assert.match(source, /persist_rootfs\s*=\s*"never"/, role);
    assert.doesNotMatch(source, /:latest|raw_value\s*=|local_path\s*=/, role);
  }
});

test("stateful apps use distinct volumes with scheduled snapshots and bounded growth", () => {
  const expected = new Map([
    ["flowise-db", "flowise_pg_data"],
    ["flowise-redis", "flowise_redis_data"],
  ]);
  const sources = [];
  for (const role of CONFIGS) {
    const source = read(`${role}.toml`);
    if (RELEASE_DISABLED_ROLES.includes(role)) {
      assert.match(source, /RELEASE-DISABLED/);
      continue;
    }
    if (!expected.has(role)) {
      assert.doesNotMatch(source, /^\s*\[\[?mounts?\]?\]/m, role);
      continue;
    }
    assert.match(source, new RegExp(`source\\s*=\\s*"${expected.get(role)}"`), role);
    assert.match(source, /scheduled_snapshots\s*=\s*true/, role);
    assert.match(source, /snapshot_retention\s*=\s*(?:14|30)/, role);
    assert.match(source, /auto_extend_size_threshold\s*=\s*80/, role);
    assert.match(source, /auto_extend_size_increment\s*=\s*"[0-9]+GB"/, role);
    assert.match(source, /auto_extend_size_limit\s*=\s*"[0-9]+GB"/, role);
    sources.push(expected.get(role));
  }
  assert.equal(new Set(sources).size, 2);
});

test("Fly runtime binds only private authorities and keeps Redis inside Flowise", () => {
  const gateway = read("model-gateway.toml");
  assert.match(gateway, /MODEL_GATEWAY_BIND_HOST\s*=\s*"fly-local-6pn"/);
  assert.match(gateway, /MODEL_GATEWAY_REQUEST_MAX_BYTES\s*=\s*"262144"/);
  assert.match(gateway, /guest_path\s*=\s*"\/run\/secrets\/deerflow_model_gateway_token"/);
  assert.match(gateway, /guest_path\s*=\s*"\/run\/secrets\/deerflow_model_provider_api_key"/);

  for (const role of ["deerflow-adapter", "flowise-adapter"]) {
    assert.match(read(`${role}.toml`), /BIND_HOST\s*=\s*"fly-local-6pn"/, role);
  }
  const deerflow = `${read("deerflow.toml")}\n${read("deerflow-adapter.toml")}`;
  const flowise = `${read("flowise.toml")}\n${read("flowise-worker.toml")}\n${read("flowise-adapter.toml")}`;
  assert.doesNotMatch(deerflow, /aria-mantu-deerflow-redis\.internal/);
  assert.doesNotMatch(deerflow, /aria-mantu-flowise-redis\.internal/);
  assert.match(flowise, /aria-mantu-flowise-redis\.internal/g);
  assert.doesNotMatch(flowise, /aria-mantu-deerflow-redis\.internal/);
  assert.doesNotMatch(read("deerflow-adapter.toml"), /REDIS_(?:FLY_)?HOST|REDIS_PASSWORD/);
  assert.match(read("flowise-adapter.toml"), /REDIS_FLY_HOST\s*=\s*"aria-mantu-flowise-redis\.internal"/);
});

test("DeerFlow Fly runtime is single-process and has no database or Redis authority", () => {
  const deerflow = read("deerflow.toml");
  const entrypoint = read("runtime/deerflow-entrypoint.sh");
  const entrypointWithoutDefensiveUnset = entrypoint.replace(/unset DATABASE_URL[\s\S]*?OKAHU_API_KEY\n/, "");
  assert.match(deerflow, /DEERFLOW_BIND_HOST\s*=\s*"fly-local-6pn"/);
  assert.match(entrypoint, /--workers 1/);
  for (const source of [deerflow, entrypointWithoutDefensiveUnset]) {
    assert.doesNotMatch(source, /DEERFLOW_DATABASE_(?:HOST|URL|PASSWORD|PASSWORD_FILE)/);
    assert.doesNotMatch(source, /DEERFLOW_STREAM_BRIDGE_REDIS_(?:HOST|URL)/);
    assert.doesNotMatch(source, /DEERFLOW_REDIS_(?:PASSWORD|PASSWORD_FILE)/);
    assert.doesNotMatch(source, /deerflow_db_password|deerflow_redis_password/);
  }
  assert.doesNotMatch(deerflow, /aria-mantu-deerflow-db\.internal/);
  assert.doesNotMatch(deerflow, /aria-mantu-deerflow-redis\.internal/);

  for (const name of [
    "LANGSMITH_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_TRACING",
    "LANGFUSE_TRACING",
    "MONOCLE_TRACING",
  ]) {
    assert.match(deerflow, new RegExp(`${name}\\s*=\\s*"false"`), name);
    assert.match(entrypoint, new RegExp(`export ${name}=false`), name);
  }
  for (const name of [
    "DATABASE_URL",
    "DEER_FLOW_STREAM_BRIDGE_REDIS_URL",
    "REDIS_URL",
    "LANGSMITH_API_KEY",
    "LANGCHAIN_API_KEY",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "OKAHU_API_KEY",
  ]) assert.match(entrypoint, new RegExp(`unset[\\s\\S]*\\b${name}\\b`), name);

  const adapter = read("deerflow-adapter.toml");
  assert.doesNotMatch(adapter, /REDIS_PLANE_OWNER|REDIS_(?:FLY_)?HOST|REDIS_PASSWORD/);

  const probe = read("runtime/private-probe.py");
  assert.match(probe, /from private_http import open_without_redirect/);
  assert.match(probe, /open_without_redirect\(request, timeout=8\)/);
  assert.doesNotMatch(probe, /urllib\.request\.urlopen/);
  const privateHttp = read("runtime/private_http.py");
  assert.match(privateHttp, /ProxyHandler\(\{\}\)/);
  assert.match(probe, /\/app\/backend\/app\/gateway\/routers\/runs\.py/);
  assert.match(probe, /\/app\/backend\/aria_cleanup_guard\.py/);
  assert.match(probe, /\/app\/backend\/aria_runtime_policy\.py/);
  assert.match(probe, /response\.headers\.get\("x-aria-runtime-policy"\)/);
  assert.doesNotMatch(probe, /os\.environ.*(?:DATABASE_URL|REDIS_URL|LANGSMITH_TRACING)/s);
  assert.match(probe, /\/opt\/aria\/deerflow\/config\.yaml/);
  for (const fact of [
    "patchedRunsSha256",
    "cleanupGuardSha256",
    "runtimePolicySha256",
    "runtimeConfigSha256",
    "databaseBackend",
    "runEventsBackend",
    "streamBridgeType",
    "tracingDisabled",
    "persistenceEnvironmentClean",
  ]) {
    assert.match(probe, new RegExp(fact), fact);
  }
});

test("private readiness transport never follows redirects", () => {
  execFileSync("python3", [path.join(here, "runtime/private_http.test.py")], {
    stdio: "pipe",
  });
});

test("DeerFlow in-Machine readiness proves the exact patched runtime and memory-only storage", () => {
  const accepted = validateManifest(manifest());
  assert.equal(
    createHash("sha256").update(read("../deerflow-config.yaml")).digest("hex"),
    DEERFLOW_RUNTIME.runtimeConfigSha256,
  );
  assert.equal(
    createHash("sha256").update(read("../deerflow-runtime/cleanup-guard.py")).digest("hex"),
    DEERFLOW_RUNTIME.cleanupGuardSha256,
  );
  assert.equal(
    createHash("sha256").update(read("../deerflow-runtime/runtime-policy.py")).digest("hex"),
    DEERFLOW_RUNTIME.runtimePolicySha256,
  );
  const health = {
    mode: "deerflow",
    status: "ready",
    ...DEERFLOW_RUNTIME,
    tracingDisabled: true,
    persistenceEnvironmentClean: true,
  };
  assert.deepEqual(validateDeerFlowRuntimeHealth(health, accepted), health);
  assert.throws(() => validateDeerFlowRuntimeHealth({
    ...health,
    runtimeConfigSha256: SHA,
  }, accepted), /runtime identity/i);
  assert.throws(() => validateDeerFlowRuntimeHealth({
    ...health,
    runEventsBackend: "db",
  }, accepted), /runtime identity/i);
});

test("runtime wrappers inherit promoted digests, enforce steady-state users, and emit attestations", () => {
  const bake = read("docker-bake.hcl");
  for (const name of ["postgres", "redis", "deerflow", "flowise", "flowise-worker", "adapter", "model-gateway"]) {
    assert.match(bake, new RegExp(`target\\s+"${name}"`), name);
  }
  assert.ok((bake.match(/type=sbom/g) ?? []).length >= 7);
  assert.ok((bake.match(/type=provenance,mode=max/g) ?? []).length >= 7);
  assert.doesNotMatch(bake, /:latest|#main|#master/);
  for (const [name, value] of Object.entries({
    DEERFLOW_PATCHED_RUNS_SHA256: DEERFLOW_RUNTIME.patchedRunsSha256,
    DEERFLOW_CLEANUP_GUARD_SHA256: DEERFLOW_RUNTIME.cleanupGuardSha256,
    DEERFLOW_RUNTIME_POLICY_SHA256: DEERFLOW_RUNTIME.runtimePolicySha256,
    DEERFLOW_RUNTIME_CONFIG_SHA256: DEERFLOW_RUNTIME.runtimeConfigSha256,
    DEERFLOW_DATABASE_BACKEND: DEERFLOW_RUNTIME.databaseBackend,
    DEERFLOW_RUN_EVENTS_BACKEND: DEERFLOW_RUNTIME.runEventsBackend,
    DEERFLOW_STREAM_BRIDGE_TYPE: DEERFLOW_RUNTIME.streamBridgeType,
  })) assert.match(bake, new RegExp(`${name}\\s*=\\s*"${value}"`), name);
  const deerflowDockerfile = read("runtime/deerflow.Dockerfile");
  for (const name of [
    "DEERFLOW_PATCHED_RUNS_SHA256",
    "DEERFLOW_CLEANUP_GUARD_SHA256",
    "DEERFLOW_RUNTIME_POLICY_SHA256",
    "DEERFLOW_RUNTIME_CONFIG_SHA256",
    "DEERFLOW_DATABASE_BACKEND",
    "DEERFLOW_RUN_EVENTS_BACKEND",
    "DEERFLOW_STREAM_BRIDGE_TYPE",
  ]) {
    assert.match(deerflowDockerfile, new RegExp(`^ARG ${name}$`, "m"), name);
    assert.match(deerflowDockerfile, new RegExp(`io\\.mantu\\.aria\\.deerflow\\..+=\\"\\$\\{${name}\\}\\"`), name);
  }
  for (const name of ["postgres", "redis", "deerflow", "flowise", "flowise-worker", "adapter", "model-gateway"]) {
    const dockerfile = read(`runtime/${name}.Dockerfile`);
    assert.match(dockerfile, /^ARG UPSTREAM_IMAGE\nFROM \$\{UPSTREAM_IMAGE\}/m, name);
    assert.doesNotMatch(dockerfile, /:latest/, name);
    if (new Set(["postgres", "redis"]).has(name)) {
      assert.match(
        read(`runtime/${name}-entrypoint.sh`),
        /exec \/usr\/local\/bin\/docker-entrypoint\.sh|exec gosu redis redis-server/,
        `${name} may initialize its Fly volume as root only when its official entrypoint drops to the service account`,
      );
    } else {
      assert.match(dockerfile, /USER (?:1000|65532|node)/, name);
    }
  }
});

test("DeerFlow image provenance binds the audited patch, cleanup guard, policy, config, and memory-only modes", async () => {
  const image = manifest().images.deerflow;
  const digest = image.ref.split("@sha256:")[1];
  const statement = (predicate) => JSON.stringify([{ payload: Buffer.from(JSON.stringify({
    subject: [{ name: "aria-deerflow", digest: { sha256: digest } }],
    predicate,
  })).toString("base64") }]);
  const runnerFor = (parameters, unrelatedMetadata) => async (command, args) => {
    if (command === "trivy") return { code: 0, stdout: JSON.stringify({ Results: [] }), stderr: "" };
    if (command !== "cosign") throw new Error("unexpected command");
    if (!args.includes("verify-attestation")) return { code: 0, stdout: "{}", stderr: "" };
    if (args.includes("spdxjson")) return { code: 0, stdout: statement({}), stderr: "" };
    return { code: 0, stdout: statement({
      sourceCommit: image.sourceCommit,
      invocation: { parameters },
      ...(unrelatedMetadata ? { metadata: unrelatedMetadata } : {}),
    }), stderr: "" };
  };
  const parameters = {
    DEERFLOW_PATCHED_RUNS_SHA256: DEERFLOW_RUNTIME.patchedRunsSha256,
    DEERFLOW_CLEANUP_GUARD_SHA256: DEERFLOW_RUNTIME.cleanupGuardSha256,
    DEERFLOW_RUNTIME_POLICY_SHA256: DEERFLOW_RUNTIME.runtimePolicySha256,
    DEERFLOW_RUNTIME_CONFIG_SHA256: DEERFLOW_RUNTIME.runtimeConfigSha256,
    DEERFLOW_DATABASE_BACKEND: DEERFLOW_RUNTIME.databaseBackend,
    DEERFLOW_RUN_EVENTS_BACKEND: DEERFLOW_RUNTIME.runEventsBackend,
    DEERFLOW_STREAM_BRIDGE_TYPE: DEERFLOW_RUNTIME.streamBridgeType,
  };
  await verifySupplyChainForImage("deerflow", image, runnerFor(parameters), DEERFLOW_RUNTIME);
  const missingMode = { ...parameters };
  delete missingMode.DEERFLOW_RUN_EVENTS_BACKEND;
  await assert.rejects(
    verifySupplyChainForImage("deerflow", image, runnerFor(missingMode), DEERFLOW_RUNTIME),
    /runtime provenance/i,
  );
  await assert.rejects(
    verifySupplyChainForImage("deerflow", image, runnerFor({}, parameters), DEERFLOW_RUNTIME),
    /runtime provenance/i,
    "runtime claims outside canonical SLSA parameters must not authorize an image",
  );
});

test("manifest, plan, and approval bind exact immutable identities", () => {
  const accepted = validateManifest(manifest());
  const plan = createPlan(accepted, {
    now: new Date("2026-07-14T12:00:00.000Z"),
    supplyChainEvidence: Object.fromEntries(CONFIGS.map((role) => [role, {
      signatureSha256: SHA,
      sbomSha256: SHA,
      provenanceSha256: SHA,
      vulnerabilityScanSha256: SHA,
    }])),
    configSha256ByRole: Object.fromEntries(CONFIGS.map((role) => [role, SHA_B])),
    priorState: Object.fromEntries(CONFIGS.map((role) => [role, null])),
  });
  const confirmation = confirmationForPlan(plan);
  assert.match(confirmation, /^[0-9a-f]{64}$/);
  assert.equal(plan.manifestSha256, accepted.sha256);
  assert.equal(JSON.stringify(plan).includes("secret"), false);
  const approval = createApproval(plan, confirmation, new Date("2026-07-14T12:01:00.000Z"));
  assert.deepEqual(validateApproval(plan, approval), approval);
  assert.throws(() => validateApproval({ ...plan, manifestSha256: SHA }, approval), /approval/i);
});

test("manifest rejects tags, missing evidence identities, duplicate framework IDs, and unsafe networks", () => {
  assert.throws(() => validateManifest(manifest({ network: "other-network" })), /network/i);
  assert.throws(() => validateManifest(manifest({
    frameworkInstances: { deerflow: UUIDS.deerflow, flowise: UUIDS.deerflow },
  })), /instance/i);
  const tagged = manifest();
  tagged.images.deerflow.ref = "registry.fly.io/deerflow:main";
  assert.throws(() => validateManifest(tagged), /digest/i);
  const unsigned = manifest();
  delete unsigned.images.flowise.certificateIdentity;
  assert.throws(() => validateManifest(unsigned), /image/i);
  assert.throws(() => validateManifest(manifest({
    deerflowRuntime: { ...DEERFLOW_RUNTIME, databaseBackend: "postgres" },
  })), /DeerFlow runtime/i);
  assert.throws(() => validateManifest(manifest({
    deerflowRuntime: { ...DEERFLOW_RUNTIME, patchedRunsSha256: SHA },
  })), /DeerFlow runtime/i);
});

test("secret imports read files, base64 file mounts, never include values in plans, and reject weak material", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-fly-secrets-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
    return file;
  };
  const environment = {
    ARIA_FLY_SECRET_DEERFLOW_DB_PASSWORD_FILE: write("df-db", "A".repeat(40)),
    ARIA_FLY_SECRET_DEERFLOW_REDIS_PASSWORD_FILE: write("df-redis", "B".repeat(40)),
    ARIA_FLY_SECRET_DEERFLOW_MODEL_GATEWAY_TOKEN_FILE: write("gateway", "C".repeat(40)),
    ARIA_FLY_SECRET_DEERFLOW_INTERNAL_TOKEN_FILE: write("df-internal", "D".repeat(40)),
  };
  const imported = await secretImportForRole("deerflow", validateManifest(manifest()), environment);
  assert.doesNotMatch(imported, /ARIA_DEERFLOW_DB_PASSWORD_B64/);
  assert.doesNotMatch(imported, /ARIA_DEERFLOW_REDIS_PASSWORD_B64/);
  assert.match(imported, /^ARIA_GATEWAY_TOKEN_B64=[A-Za-z0-9+/=]+$/m);
  assert.match(imported, /^ARIA_WORKSPACE_ID=[0-9a-f-]+$/m);
  assert.equal(imported.includes("A".repeat(40)), false);
  assert.equal(imported.includes("B".repeat(40)), false);
  await assert.rejects(
    secretImportForRole("deerflow-db", validateManifest(manifest()), environment),
    /release-disabled/i,
  );
  await assert.rejects(
    secretImportForRole("deerflow-redis", validateManifest(manifest()), environment),
    /release-disabled/i,
  );
  await assert.rejects(
    secretImportForRole("deerflow", validateManifest(manifest()), {
      ...environment,
      ARIA_FLY_SECRET_DEERFLOW_MODEL_GATEWAY_TOKEN_FILE: write("weak", "short"),
    }),
    /secret/i,
  );
});

test("Fly secret inventory rejects stale authority before prepare, deployment, and replay", () => {
  const accepted = validateManifest(manifest());
  const expected = [
    "ARIA_DEERFLOW_INTERNAL_TOKEN_B64",
    "ARIA_GATEWAY_TOKEN_B64",
    "ARIA_RELEASE_SHA",
    "ARIA_WORKSPACE_ID",
    "DEERFLOW_MODEL_ID",
  ];
  const inventory = expected.map((Name) => ({ Name, Digest: SHA }));
  assert.deepEqual(validateFlySecretInventory("deerflow", accepted, inventory), expected);
  assert.throws(() => validateFlySecretInventory("deerflow", accepted, [
    ...inventory,
    { Name: "ARIA_DB_PASSWORD_B64", Digest: SHA },
  ]), /stale Fly secret/i);
  assert.throws(() => validateFlySecretInventory("deerflow", accepted, inventory.slice(1)), /incomplete/i);
  assert.deepEqual(
    validateFlySecretInventory("deerflow", accepted, inventory.slice(1), { requireComplete: false }),
    expected.slice(1),
  );
  assert.deepEqual(validateFlySecretInventory("deerflow-db", accepted, []), []);
  assert.throws(() => validateFlySecretInventory("deerflow-db", accepted, [
    { Name: "ARIA_DB_PASSWORD_B64", Digest: SHA },
  ]), /stale Fly secret/i);

  const operator = read("operator.mjs");
  assert.match(operator, /flyctl", \["secrets", "list"/);
  assert.match(operator, /validateCurrentSecretInventory\(role, app, manifest, runner, \{ requireComplete: false \}\)/);
  assert.ok(
    (operator.match(/validateCurrentSecretInventory\(role, APP_BY_ROLE\[role\], manifest, runner, \{ requireComplete: false \}\)/g) ?? []).length >= 1,
    "deploy must reject stale secret names before staging approved material",
  );
  assert.match(operator, /validateCurrentSecretInventory\(role, APP_BY_ROLE\[role\], manifest, runner\)/);
});

test("machine inventory requires one fresh started machine on the exact digest", () => {
  const expected = manifest().images.deerflow.ref;
  const result = validateMachineInventory("deerflow", expected, [{
    id: "185e62e43e5389",
    state: "started",
    image_ref: expected,
    config: { image: expected },
  }]);
  assert.equal(result.machineId, "185e62e43e5389");
  assert.equal(result.imageDigest, expected);
  assert.throws(() => validateMachineInventory("deerflow", expected, []), /machine/i);
  assert.throws(() => validateMachineInventory("deerflow", expected, [{
    id: "185e62e43e5389",
    state: "started",
    image_ref: `registry.fly.io/aria-deerflow@sha256:${SHA_B}`,
  }]), /image/i);
  assert.deepEqual(validateMachineInventory("deerflow", expected, [{
    id: "185e62e43e5389",
    state: "started",
    image_ref: {
      registry: "registry.fly.io",
      repository: "aria-deerflow",
      digest: `sha256:${SHA}`,
    },
    config: { services: [] },
  }]), {
    machineId: "185e62e43e5389",
    imageDigest: expected,
    state: "started",
  });
  assert.throws(() => validateMachineInventory("deerflow", expected, [{
    id: "185e62e43e5389",
    state: "started",
    image_ref: expected,
    config: { services: [{ ports: [{ port: 443 }] }] },
  }]), /services/i);
});

test("operator has explicit prepare, confirm, and deploy gates with supply-chain verification", () => {
  const operator = read("operator.mjs");
  assert.match(operator, /prepare/);
  assert.match(operator, /confirm/);
  assert.match(operator, /deploy/);
  assert.match(operator, /cosign/);
  assert.match(operator, /verify-attestation/);
  assert.match(operator, /spdxjson/);
  assert.match(operator, /slsaprovenance/);
  assert.match(operator, /trivy/);
  assert.match(operator, /--no-public-ips/);
  assert.match(operator, /--image/);
  assert.match(operator, /secrets.*import/);
  assert.doesNotMatch(operator, /secrets\s+set[^\n]*(?:PASSWORD|TOKEN|KEY)=/);
});
