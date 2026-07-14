import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FLY_MANIFEST_SCHEMA,
  ROLE_ORDER,
  confirmationForPlan,
  createApproval,
  createPlan,
  secretImportForRole,
  validateApproval,
  validateMachineInventory,
  validateManifest,
} from "./operator-core.mjs";

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
  return {
    schema: FLY_MANIFEST_SCHEMA,
    phase: "runtime",
    deploymentId: UUIDS.deployment,
    organization: "mantu",
    network: "default",
    region: "cdg",
    sourceReleaseSha: COMMIT,
    configurationSha256: SHA_B,
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
}

test("all ten Fly apps validate and remain private without Fly Proxy services", () => {
  assert.deepEqual(ROLE_ORDER, CONFIGS);
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
    ["deerflow-db", "deerflow_pg_data"],
    ["flowise-db", "flowise_pg_data"],
    ["deerflow-redis", "deerflow_redis_data"],
    ["flowise-redis", "flowise_redis_data"],
  ]);
  const sources = [];
  for (const role of CONFIGS) {
    const source = read(`${role}.toml`);
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
  assert.equal(new Set(sources).size, 4);
});

test("Fly runtime binds only private authorities and keeps the two Redis planes separate", () => {
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
  assert.match(deerflow, /aria-mantu-deerflow-redis\.internal/g);
  assert.doesNotMatch(deerflow, /aria-mantu-flowise-redis\.internal/);
  assert.match(flowise, /aria-mantu-flowise-redis\.internal/g);
  assert.doesNotMatch(flowise, /aria-mantu-deerflow-redis\.internal/);
  assert.match(read("deerflow-adapter.toml"), /REDIS_FLY_HOST\s*=\s*"aria-mantu-deerflow-redis\.internal"/);
  assert.match(read("flowise-adapter.toml"), /REDIS_FLY_HOST\s*=\s*"aria-mantu-flowise-redis\.internal"/);
});

test("runtime wrappers inherit promoted digests, enforce steady-state users, and emit attestations", () => {
  const bake = read("docker-bake.hcl");
  for (const name of ["postgres", "redis", "deerflow", "flowise", "flowise-worker", "adapter", "model-gateway"]) {
    assert.match(bake, new RegExp(`target\\s+"${name}"`), name);
  }
  assert.ok((bake.match(/type=sbom/g) ?? []).length >= 7);
  assert.ok((bake.match(/type=provenance,mode=max/g) ?? []).length >= 7);
  assert.doesNotMatch(bake, /:latest|#main|#master/);
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
  assert.match(imported, /^ARIA_DEERFLOW_DB_PASSWORD_B64=[A-Za-z0-9+/=]+$/m);
  assert.match(imported, /^ARIA_WORKSPACE_ID=[0-9a-f-]+$/m);
  assert.equal(imported.includes("A".repeat(40)), false);
  assert.equal(imported.includes("B".repeat(40)), false);
  await assert.rejects(
    secretImportForRole("deerflow", validateManifest(manifest()), {
      ...environment,
      ARIA_FLY_SECRET_DEERFLOW_DB_PASSWORD_FILE: write("weak", "short"),
    }),
    /secret/i,
  );
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
