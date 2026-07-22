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
import * as operatorCore from "./operator-core.mjs";
import { verifySupplyChainForImage } from "./operator.mjs";
import * as operator from "./operator.mjs";
import { agentFrameworkProvenancePolicy } from "./provenance-policy.mjs";
import {
  agentFrameworkConfigurationInputFromEnvironment,
  deriveAgentFrameworkConfiguration,
} from "../../../src/lib/agents/framework/configuration-core.mjs";
import {
  FLOWISE_FAISS_PREBUILD_SHA256,
  FLOWISE_PNPM_TARBALL_SHA256,
  FLOWISE_SQLITE_PREBUILD_SHA256,
} from "../../../src/lib/agents/framework/source-identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");
const readProject = (name) => fs.readFileSync(path.join(projectRoot, name), "utf8");
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
const UPSTREAM_COMMIT = "d".repeat(40);
const DEERFLOW_RUNTIME = Object.freeze({
  patchedRunsSha256: "d5ee9ebcf676656ca9380e866b414d1ff4fa70cfac587a9fbc7d7a60506a6db4",
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

function validBuildProvenance(component, releaseSha = COMMIT) {
  const policy = agentFrameworkProvenancePolicy(component, releaseSha);
  return {
    builder: { id: "" },
    buildType: "https://mobyproject.org/buildkit@v1",
    materials: structuredClone(policy.materials),
    invocation: {
      configSource: {
        uri: policy.releaseMaterial.uri,
        digest: structuredClone(policy.releaseMaterial.digest),
        entryPoint: policy.entryPoint,
      },
      parameters: {
        frontend: "dockerfile.v0",
        args: structuredClone(policy.args),
        secrets: [
          { id: "GIT_AUTH_HEADER", optional: true },
          { id: "GIT_AUTH_TOKEN", optional: true },
        ],
        root: {
          configSource: {
            uri: policy.releaseMaterial.uri,
            digest: structuredClone(policy.releaseMaterial.digest),
            path: policy.entryPoint,
          },
          request: { args: structuredClone(policy.args) },
        },
        compatibilityVersion: 20,
      },
      environment: { dockerfileVersion: "1.24.0", platform: "linux/amd64" },
    },
    buildConfig: {
      llbDefinition: [{
        id: "step0",
        op: {
          Op: { source: { identifier: policy.releaseMaterial.uri, attrs: {
            "git.authheadersecret": "GIT_AUTH_HEADER",
            "git.authtokensecret": "GIT_AUTH_TOKEN",
          } } },
          constraints: {},
        },
      }],
      digestMapping: { [`sha256:${SHA}`]: "step0" },
    },
    metadata: {
      buildInvocationID: `fixture-${component}`,
      buildStartedOn: "2026-07-19T00:00:00Z",
      buildFinishedOn: "2026-07-19T00:00:01Z",
      completeness: { parameters: true, environment: true, materials: true },
      reproducible: false,
      "https://mobyproject.org/buildkit@v1#metadata": { source: { infos: [] } },
    },
  };
}

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
  assert.equal((bake.match(/type=sbom/g) ?? []).length, 0);
  assert.equal((bake.match(/type=provenance,mode=max/g) ?? []).length, 1);
  assert.equal((bake.match(/inherits\s*=\s*\["release"\]/g) ?? []).length, 7);
  assert.doesNotMatch(bake, /:latest|#main|#master/);
  for (const [name, value] of Object.entries({
    DEERFLOW_PATCHED_RUNS_SHA256: DEERFLOW_RUNTIME.patchedRunsSha256,
    DEERFLOW_CLEANUP_GUARD_SHA256: DEERFLOW_RUNTIME.cleanupGuardSha256,
    DEERFLOW_RUNTIME_POLICY_SHA256: DEERFLOW_RUNTIME.runtimePolicySha256,
    DEERFLOW_RUNTIME_CONFIG_SHA256: DEERFLOW_RUNTIME.runtimeConfigSha256,
    DEERFLOW_DATABASE_BACKEND: DEERFLOW_RUNTIME.databaseBackend,
    DEERFLOW_RUN_EVENTS_BACKEND: DEERFLOW_RUNTIME.runEventsBackend,
    DEERFLOW_STREAM_BRIDGE_TYPE: DEERFLOW_RUNTIME.streamBridgeType,
  })) {
    assert.match(bake, new RegExp(`variable\\s+"${name}"\\s*\\{`), name);
    assert.match(bake, new RegExp(`${name}\\s*=\\s*"\\$\\{${name}\\}"`), name);
    assert.doesNotMatch(bake, new RegExp(`${name}\\s*=\\s*"${value}"`), `${name} must come from operator authority`);
  }
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
    assert.match(dockerfile, /^ARG RELEASE_SOURCE_COMMIT$/m, `${name} release source`);
    assert.match(dockerfile, /^ARG UPSTREAM_SOURCE_COMMIT$/m, `${name} upstream source`);
    assert.match(
      dockerfile,
      /org\.opencontainers\.image\.revision="\$\{RELEASE_SOURCE_COMMIT\}"/,
      `${name} OCI revision must identify the reviewed ARIA release`,
    );
    assert.match(
      dockerfile,
      /io\.mantu\.aria\.upstream-revision="\$\{UPSTREAM_SOURCE_COMMIT\}"/,
      `${name} must preserve the reviewed upstream revision separately`,
    );
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
  const image = { ...manifest().images.deerflow, sourceCommit: UPSTREAM_COMMIT };
  const digest = image.ref.split("@sha256:")[1];
  const statement = (predicate) => JSON.stringify([{ payload: Buffer.from(JSON.stringify({
    subject: [{ name: "aria-deerflow", digest: { sha256: digest } }],
    predicate,
  })).toString("base64") }]);
  const validScan = {
    SchemaVersion: 2,
    ArtifactName: image.ref,
    Results: [{
      Target: image.ref,
      Class: "os-pkgs",
      Type: "debian",
      Vulnerabilities: [],
      Secrets: [],
      Misconfigurations: [],
    }],
  };
  const validSbom = {
    spdxVersion: "SPDX-2.3",
    SPDXID: "SPDXRef-DOCUMENT",
    dataLicense: "CC0-1.0",
    name: "aria-deerflow",
    documentNamespace: "https://aria.invalid/spdx/deerflow",
    creationInfo: { created: "2026-07-19T00:00:00Z", creators: ["Tool: trivy"] },
    packages: [{ SPDXID: "SPDXRef-Package-deerflow", name: "deerflow" }],
  };
  const runnerFor = (provenance, { scan = validScan, sbom = validSbom } = {}) => async (command, args) => {
    if (command === "trivy") return { code: 0, stdout: JSON.stringify(scan), stderr: "" };
    if (command !== "cosign") throw new Error("unexpected command");
    if (!args.includes("verify-attestation")) return { code: 0, stdout: "{}", stderr: "" };
    if (args.includes("spdxjson")) return { code: 0, stdout: statement(sbom), stderr: "" };
    return { code: 0, stdout: statement(provenance), stderr: "" };
  };
  const provenance = validBuildProvenance("deerflow");
  await verifySupplyChainForImage("deerflow", image, runnerFor(provenance), DEERFLOW_RUNTIME, COMMIT);
  const missingMode = structuredClone(provenance);
  delete missingMode.invocation.parameters.args["build-arg:DEERFLOW_RUN_EVENTS_BACKEND"];
  await assert.rejects(
    verifySupplyChainForImage("deerflow", image, runnerFor(missingMode), DEERFLOW_RUNTIME, COMMIT),
    /provenance predicate/i,
  );
  const unexpectedMaterial = structuredClone(provenance);
  unexpectedMaterial.materials.push({ uri: "https://evil.invalid/material", digest: { sha256: SHA } });
  await assert.rejects(
    verifySupplyChainForImage("deerflow", image, runnerFor(unexpectedMaterial), DEERFLOW_RUNTIME, COMMIT),
    /provenance predicate/i,
    "unexpected provenance materials must not authorize an image",
  );
  await assert.rejects(
    verifySupplyChainForImage("deerflow", image, runnerFor(provenance), {
      ...DEERFLOW_RUNTIME,
      runEventsBackend: "db",
    }, COMMIT),
    /runtime identity/i,
  );
  await assert.rejects(
    verifySupplyChainForImage(
      "deerflow",
      image,
      runnerFor(provenance, { scan: { ...validScan, Results: null } }),
      DEERFLOW_RUNTIME,
      COMMIT,
    ),
    /Trivy scan results/i,
  );
  await assert.rejects(
    verifySupplyChainForImage(
      "deerflow",
      image,
      runnerFor(provenance, { scan: { ...validScan, Results: [{}] } }),
      DEERFLOW_RUNTIME,
      COMMIT,
    ),
    /Trivy result/i,
  );
  await assert.rejects(
    verifySupplyChainForImage(
      "deerflow",
      image,
      runnerFor(provenance, {
        scan: {
          ...validScan,
          Results: [{ ...validScan.Results[0], Vulnerabilities: [{}] }],
        },
      }),
      DEERFLOW_RUNTIME,
      COMMIT,
    ),
    /Trivy vulnerability/i,
  );
  await assert.rejects(
    verifySupplyChainForImage(
      "deerflow",
      image,
      runnerFor(provenance, {
        scan: {
          ...validScan,
          Results: [{ ...validScan.Results[0], Secrets: [{ Severity: "CRITICAL", RuleID: "secret" }] }],
        },
      }),
      DEERFLOW_RUNTIME,
      COMMIT,
    ),
    /Trivy blocked/i,
  );
  await assert.rejects(
    verifySupplyChainForImage(
      "deerflow",
      image,
      runnerFor(provenance, { sbom: {} }),
      DEERFLOW_RUNTIME,
      COMMIT,
    ),
    /SBOM predicate/i,
  );
  for (const sbom of [
    { ...validSbom, creationInfo: [] },
    { ...validSbom, packages: [{}], files: [{ SPDXID: "SPDXRef-file", fileName: "/app/server.mjs" }] },
  ]) {
    await assert.rejects(
      verifySupplyChainForImage(
        "deerflow",
        image,
        runnerFor(provenance, { sbom }),
        DEERFLOW_RUNTIME,
        COMMIT,
      ),
      /SBOM predicate/i,
    );
  }
});

test("release inputs use a canonical tagged-image parser that preserves registry ports", () => {
  assert.equal(typeof operatorCore.canonicalTaggedImageReference, "function");
  assert.deepEqual(
    operatorCore.canonicalTaggedImageReference("registry.example.test:5443/team/postgres:16.4-bookworm"),
    {
      repository: "registry.example.test:5443/team/postgres",
      tag: "16.4-bookworm",
    },
  );
  assert.deepEqual(operatorCore.canonicalTaggedImageReference("postgres:16.4"), {
    repository: "postgres",
    tag: "16.4",
  });
  assert.throws(
    () => operatorCore.canonicalTaggedImageReference("registry.example.test:5443/team/postgres"),
    /tagged image/i,
  );
  assert.throws(
    () => operatorCore.canonicalTaggedImageReference(`registry.example.test/team/postgres@sha256:${SHA}`),
    /tagged image/i,
  );
  assert.throws(
    () => operatorCore.canonicalTaggedImageReference("registry.example.test/team/postgres:latest"),
    /pinned tag/i,
  );
  for (const unsafe of [
    "https://registry.example.test/team/postgres:16.4",
    "registry.example.test/team/postgres:16.4\n",
    "registry.example.test/Team/postgres:16.4",
    "registry.example.test:70000/team/postgres:16.4",
    "registry.example.test/team//postgres:16.4",
  ]) assert.throws(() => operatorCore.canonicalTaggedImageReference(unsafe), /tagged image/i, unsafe);
});

test("operator isolates and removes ephemeral Fly registry credentials", async () => {
  assert.equal(typeof operator.withFlyRegistryAuthentication, "function");
  const calls = [];
  let dockerConfig;
  let temporaryHome;
  const priorToken = process.env.FLY_API_TOKEN;
  process.env.FLY_API_TOKEN = `FlyV1 ${"t".repeat(32)}`;
  await operator.withFlyRegistryAuthentication(async (command, args, options = {}) => {
    calls.push([command, args, options]);
    if (command === "flyctl") {
      dockerConfig = options.env?.DOCKER_CONFIG;
      temporaryHome = options.env?.HOME;
      assert.equal(typeof dockerConfig, "string");
      assert.equal(fs.statSync(dockerConfig).isDirectory(), true);
      assert.equal(path.dirname(dockerConfig), temporaryHome);
      assert.equal(options.env.FLY_API_TOKEN, process.env.FLY_API_TOKEN);
    } else {
      assert.equal(options.env?.FLY_API_TOKEN, undefined);
    }
    assert.equal(options.inheritEnv, false);
    return { code: 0, stdout: "", stderr: "" };
  }, async (authenticatedRunner) => {
    await authenticatedRunner("cosign", ["verify", "image"]);
    await authenticatedRunner("trivy", ["image", "image"]);
    assert.equal(fs.statSync(dockerConfig).isDirectory(), true);
  });
  if (priorToken === undefined) delete process.env.FLY_API_TOKEN;
  else process.env.FLY_API_TOKEN = priorToken;
  assert.deepEqual(calls.map(([command, args]) => [command, args]), [
    ["flyctl", ["auth", "docker"]],
    ["cosign", ["verify", "image"]],
    ["flyctl", ["auth", "docker"]],
    ["trivy", ["image", "image"]],
  ]);
  assert.equal(calls[0][2].env.DOCKER_CONFIG, calls[3][2].env.DOCKER_CONFIG);
  assert.equal(fs.existsSync(temporaryHome), false);
  const source = read("operator.mjs");
  assert.match(
    source,
    /for \(const role of ROLE_ORDER\)[\s\S]*?withFlyRegistryAuthentication\(\s*runner,[\s\S]*?verifySupplyChainForImage/,
    "the five-minute Fly registry credential must be refreshed for each role verification",
  );
});

test("runCommand can launch registry consumers without inheriting the Fly token", async () => {
  const prior = process.env.FLY_API_TOKEN;
  process.env.FLY_API_TOKEN = `FlyV1 ${"s".repeat(32)}`;
  try {
    const result = await operator.runCommand(process.execPath, [
      "-e",
      "process.stdout.write(String(Object.hasOwn(process.env, 'FLY_API_TOKEN')))",
    ], { inheritEnv: false });
    assert.equal(result.stdout, "false");
  } finally {
    if (prior === undefined) delete process.env.FLY_API_TOKEN;
    else process.env.FLY_API_TOKEN = prior;
  }
});

test("registry authentication removes credentials after authentication and callback failures", async () => {
  const priorToken = process.env.FLY_API_TOKEN;
  process.env.FLY_API_TOKEN = `FlyV1 ${"u".repeat(32)}`;
  try {
    for (const failure of ["authentication", "callback"]) {
      let temporaryHome;
      await assert.rejects(
        operator.withFlyRegistryAuthentication(async (command, _args, options = {}) => {
          temporaryHome = options.env?.HOME;
          if (failure === "authentication" && command === "flyctl") throw new Error("auth failed");
          return { code: 0, stdout: "", stderr: "" };
        }, async (runner) => {
          await runner("cosign", ["verify", "image"]);
          if (failure === "callback") {
            throw new Error("callback failed");
          }
        }),
        new RegExp(`${failure === "authentication" ? "auth" : "callback"} failed`),
      );
      assert.equal(fs.existsSync(temporaryHome), false);
    }
  } finally {
    if (priorToken === undefined) delete process.env.FLY_API_TOKEN;
    else process.env.FLY_API_TOKEN = priorToken;
  }
});

test("agent-framework release workflow uses one provisioned app repository with component tags", () => {
  const workflow = readProject(".github/workflows/deploy-agent-frameworks.yml");
  assert.match(workflow, /^  AF_REGISTRY_APP: aria-mantu-agent-frameworks$/m);
  assert.match(workflow, /^  AF_REGISTRY_REPOSITORY: registry\.fly\.io\/aria-mantu-agent-frameworks$/m);
  assert.doesNotMatch(workflow, /flyctl apps create/, "the release job must use a pre-provisioned app-scoped registry token");
  for (const target of ["postgres", "redis", "model-gateway", "deerflow", "flowise", "flowise-worker", "adapter"]) {
    assert.match(
      workflow,
      new RegExp(`\\[${target}\\]=\"\\$AF_REGISTRY_REPOSITORY:${target}-\\$suffix\"`),
      `${target} must receive a unique tag in the holder app repository`,
    );
  }
  assert.equal(
    (workflow.match(/--set "\$target\.tags=\$\{tags\[\$target\]\}"/g) ?? []).length,
    1,
    "one direct final-image build must use the explicit target-to-tag map",
  );
  assert.match(workflow, /DEERFLOW_RUNTIME_IMAGE/);
  assert.match(workflow, /FLOWISE_NODE_IMAGE/);
  assert.match(workflow, /FLOWISE_PNPM_LOCK_SHA256/);
  assert.match(workflow, /FLOWISE_RUNTIME_IMAGE/);
  assert.match(workflow, /NODE_22_RUNTIME_IMAGE/);
  assert.doesNotMatch(workflow, /registry\.fly\.io\/[^\s:"']+\/[^\s:"']+/, "Fly registry paths are app-scoped, not nested namespaces");
  assert.doesNotMatch(workflow, /\$\{AF_NAMESPACE\}\/\$\{target\}/, "digest refs must come from the exact target-to-app map");
  assert.match(workflow, /DEERFLOW_RUNTIME_IDENTITY/, "the audited runtime identity must have one source of truth");
  assert.match(workflow, /verifySupplyChainForImage/, "CI must use the operator's exact provenance and scan validator");
  assert.doesNotMatch(workflow, /setup-qemu-action/, "the amd64 Fly release must not run a mutable privileged binfmt image");
  assert.match(workflow, /version: v0\.35\.0/, "Buildx must be version-pinned");
  assert.match(workflow, /moby\/buildkit:v0\.31\.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec/);
  assert.match(read("operator.mjs"), /--certificate-github-workflow-sha/);
  assert.match(workflow, /verifySupplyChainForImage\([\s\S]*?process\.env\.AF_RELEASE_SHA/);
});

test("agent-framework bake files reject missing identities and use the real DeerFlow final stage", () => {
  const upstreamBake = readProject("infra/agent-frameworks/docker-bake.hcl");
  assert.doesNotMatch(upstreamBake, /target\s*=\s*"runtime"/);
  assert.match(upstreamBake, /\$\{DEERFLOW_SOURCE_COMMIT\}/);
  assert.match(upstreamBake, /\$\{FLOWISE_SOURCE_COMMIT\}/);
  assert.doesNotMatch(upstreamBake, /fabadae4168db81f0eaaf62f209050f978e2f691|bb773ffa710bd22639c4ba2643413a0ea2b679d3/);

  const required = [
    "POSTGRES_UPSTREAM_IMAGE", "REDIS_UPSTREAM_IMAGE", "DEERFLOW_UPSTREAM_IMAGE", "FLOWISE_UPSTREAM_IMAGE",
    "FLOWISE_WORKER_UPSTREAM_IMAGE", "FLOWISE_RUNTIME_IMAGE", "FLOWISE_PNPM_LOCK_SHA256", "ADAPTER_UPSTREAM_IMAGE", "MODEL_GATEWAY_UPSTREAM_IMAGE",
    "RELEASE_SOURCE_COMMIT", "POSTGRES_SOURCE_COMMIT", "REDIS_SOURCE_COMMIT",
    "DEERFLOW_SOURCE_COMMIT", "FLOWISE_SOURCE_COMMIT",
  ];
  assert.throws(() => execFileSync("docker", [
    "buildx", "bake", "-f", path.join(here, "docker-bake.hcl"), "--print",
  ], {
    env: { ...process.env, ...Object.fromEntries(required.map((name) => [name, ""])) },
    stdio: "pipe",
  }));
});

test("production framework builds are direct, lock-bound, and never execute upstream Dockerfiles", () => {
  const workflow = readProject(".github/workflows/deploy-agent-frameworks.yml");
  const bake = read("docker-bake.hcl");
  const deerflow = readProject("infra/agent-frameworks/upstream/deerflow.Dockerfile");
  const flowise = readProject("infra/agent-frameworks/upstream/flowise.Dockerfile");
  const workerHealth = readProject("infra/agent-frameworks/upstream/flowise-worker-healthcheck.mjs");
  const workerWrapper = read("runtime/flowise-worker.Dockerfile");
  const identityProbe = read("runtime/identity-probe.mjs");

  assert.doesNotMatch(
    workflow,
    /docker buildx bake -f infra\/agent-frameworks\/docker-bake\.hcl/,
    "production must not publish unsigned intermediate images",
  );
  assert.equal((workflow.match(/docker buildx bake/g) ?? []).length, 1, "seven final images build in one reviewed graph");
  assert.match(
    workflow,
    /- name: Build and push final images[\s\S]*?env:\s*\n\s+GIT_AUTH_TOKEN: \$\{\{ github\.token \}\}/,
    "the private exact Git context must receive only the step-scoped contents-read token as a BuildKit secret",
  );
  assert.match(bake, /target\s+"release"\s*\{[\s\S]*?secret\s*=\s*\["id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN"\]/);
  assert.equal((bake.match(/inherits\s*=\s*\["release"\]/g) ?? []).length, 7);
  assert.doesNotMatch(bake, /type=sbom/, "production must not invoke BuildKit's mutable default SBOM scanner");
  assert.match(workflow, /--format spdx-json/, "the signed SPDX must come from the independently pinned Trivy scanner");
  assert.match(bake, /dockerfile\s*=\s*"infra\/agent-frameworks\/upstream\/deerflow\.Dockerfile"/);
  assert.equal(
    (bake.match(/context\s*=\s*"https:\/\/github\.com\/mysticalsin\/aria-sourcing\.git#\$\{RELEASE_SOURCE_COMMIT\}"/g) ?? []).length,
    7,
    "each production image must bind its ARIA Dockerfile and context to the release commit",
  );
  assert.match(bake, /deerflow_source\s*=\s*"https:\/\/github\.com\/bytedance\/deer-flow\.git#\$\{DEERFLOW_SOURCE_COMMIT\}"/);
  assert.match(bake, /dockerfile\s*=\s*"infra\/agent-frameworks\/upstream\/flowise\.Dockerfile"/g);
  assert.match(bake, /flowise_source\s*=\s*"https:\/\/github\.com\/FlowiseAI\/Flowise\.git#\$\{FLOWISE_SOURCE_COMMIT\}"/g);
  assert.doesNotMatch(bake, /dockerfile\s*=\s*"(?:backend\/Dockerfile|Dockerfile|docker\/worker\/Dockerfile)"/);

  assert.match(deerflow, /uv sync --locked --no-dev --no-editable --extra redis/);
  assert.match(deerflow, /DEERFLOW_UV_LOCK_SHA256/);
  assert.doesNotMatch(deerflow, /apt-get|nodesource|docker:cli|curl\s/);
  assert.match(flowise, /pnpm fetch --frozen-lockfile/);
  assert.match(flowise, /--network=none[\s\S]+?pnpm install[\s\\]+--offline[\s\\]+--frozen-lockfile[\s\\]+--verify-store-integrity[\s\\]+--ignore-scripts/);
  assert.match(flowise, /onlyBuiltDependencies[\s\S]+?\['faiss-node','sqlite3'\]/);
  assert.match(flowise, /--network=none[\s\S]+?npm_config_faiss_node_local_prebuilds=\/opt\/aria\/prebuilds[\s\S]+?prebuild-install\/bin\.js --runtime napi/);
  assert.match(flowise, /--network=none[\s\S]+?npm_config_sqlite3_local_prebuilds=\/opt\/aria\/prebuilds[\s\S]+?prebuild-install\/bin\.js --runtime napi/);
  assert.doesNotMatch(flowise, /pnpm rebuild/, "native lifecycle scripts must be invoked explicitly from checksum-pinned local artifacts");
  assert.match(flowise, new RegExp(`ADD --checksum=sha256:${FLOWISE_PNPM_TARBALL_SHA256}`));
  assert.match(flowise, new RegExp(`ADD --checksum=sha256:${FLOWISE_FAISS_PREBUILD_SHA256}`));
  assert.match(flowise, new RegExp(`ADD --checksum=sha256:${FLOWISE_SQLITE_PREBUILD_SHA256}`));
  assert.doesNotMatch(flowise, /apt-get|apk add|npm install[^\n]*https?:|chromium|express/);
  assert.match(workerHealth, /node:http/);
  assert.doesNotMatch(workerHealth, /express|fetch\(|https?:/);
  assert.match(workerHealth, /aria\.flowise-worker-readiness-evidence\.v1/);
  assert.match(workerHealth, /O_NOFOLLOW/);
  assert.match(flowise, /patch-flowise-worker-readiness\.mjs/);
  assert.match(flowise, /packages\/server\/src\/commands\/worker\.ts/);
  assert.match(workerWrapper, /\/opt\/aria\/flowise-worker-healthcheck\.mjs/);
  assert.doesNotMatch(workerWrapper, /\/app\/healthcheck\/healthcheck\.js/);
  assert.match(identityProbe, /aria\.flowise-worker-readiness\.v1/);
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
  const nestedFlyRepository = manifest();
  nestedFlyRepository.images.deerflow.ref = `registry.fly.io/aria-mantu-agent-frameworks/deerflow@sha256:${SHA}`;
  assert.throws(() => validateManifest(nestedFlyRepository), /digest/i);
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
