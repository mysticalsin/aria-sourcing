import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import {
  DEERFLOW_SOURCE_COMMIT,
  DEERFLOW_UV_LOCK_SHA256,
  FLOWISE_PNPM_LOCK_SHA256,
  FLOWISE_RUNTIME_IMAGE,
  FLOWISE_SOURCE_COMMIT,
} from "../../src/lib/agents/framework/source-identity.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");

async function availablePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(typeof address, "object");
  return address.port;
}

async function waitForWorkerHealth(origin, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`worker health process exited ${child.exitCode}`);
    try {
      return await fetch(`${origin}/healthz`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error("worker health process did not listen");
}

test("adapter image pins its base, runs unprivileged, and imports the canonical capability core", () => {
  const dockerfile = read("adapter/Dockerfile");
  assert.match(dockerfile, /mirror\.gcr\.io\/library\/node:22\.22\.0-alpine3\.23@sha256:48f53c3f0105ccddcc5e4f520347398dfc0ba9b3008fbfd98a2add27e5797957/);
  assert.match(dockerfile, /COPY --chown=node:node src\/lib\/agents\/framework\/capability-core\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node src\/lib\/agents\/framework\/configuration-core\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node src\/lib\/agents\/framework\/source-identity\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node infra\/agent-frameworks\/adapter\/server\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node infra\/agent-frameworks\/adapter\/secret-preflight\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node infra\/agent-frameworks\/deerflow-config\.yaml \/opt\/aria\/policy\/reference\/deerflow-config\.yaml/);
  assert.match(dockerfile, /COPY --chown=node:node infra\/agent-frameworks\/deerflow-agent \/opt\/aria\/policy\/reference\/agent/);
  assert.match(dockerfile, /COPY --chown=node:node infra\/agent-frameworks\/deerflow-skills \/opt\/aria\/policy\/reference\/skills/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.doesNotMatch(dockerfile, /npm install|apk add|curl\s/);
});

test("model gateway image is dependency-free, pinned, unprivileged, and does not log request material", () => {
  const dockerfile = read("model-gateway/Dockerfile");
  const server = read("model-gateway/server.mjs");
  assert.match(dockerfile, /mirror\.gcr\.io\/library\/node:22\.22\.0-alpine3\.23@sha256:48f53c3f0105ccddcc5e4f520347398dfc0ba9b3008fbfd98a2add27e5797957/);
  assert.match(dockerfile, /COPY --chown=node:node infra\/agent-frameworks\/model-gateway\/server\.mjs/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK NONE/);
  assert.doesNotMatch(dockerfile, /npm install|apk add|curl\s/);
  assert.doesNotMatch(server, /console\.(?:log|info|warn|error)|process\.env\.MODEL_GATEWAY_(?:INTERNAL_TOKEN|UPSTREAM_API_KEY)\b/);
  assert.match(server, /redirect:\s*"error"/);
});

test("stack environment example names secret files and never accepts gateway secret values", () => {
  const example = read("compose.env.example");
  for (const name of [
    "MODEL_GATEWAY_IMAGE_REPOSITORY",
    "MODEL_GATEWAY_IMAGE_SHA256",
    "DEERFLOW_CLOUD_PROVIDER_ID",
    "DEERFLOW_MODEL_ID",
    "DEERFLOW_MODEL_BASE_URL",
    "DEERFLOW_MODEL_CREDENTIAL_VERSION",
    "DEERFLOW_MODEL_GATEWAY_TOKEN_FILE",
    "DEERFLOW_MODEL_PROVIDER_API_KEY_FILE",
    "FLOWISE_REDIS_PASSWORD_FILE",
  ]) assert.match(example, new RegExp(`^${name}=`, "m"), name);
  assert.doesNotMatch(example, /^DEERFLOW_REDIS_PASSWORD_FILE=/m);
  assert.doesNotMatch(example, /^MODEL_GATEWAY_(?:INTERNAL_TOKEN|UPSTREAM_API_KEY)=/m);
  assert.doesNotMatch(example, /^REDIS_PASSWORD_FILE=/m);
});

test("release build graph uses exact audited Git contexts and direct final images", () => {
  const bake = read("docker-bake.hcl");
  assert.equal(DEERFLOW_SOURCE_COMMIT, "3c0a45ad772cdba388009b8d5ecad5e48cd22429");
  assert.equal(FLOWISE_SOURCE_COMMIT, "ed9e100fb71643cd3922b005908f9732bc0e07dc");
  assert.equal(DEERFLOW_UV_LOCK_SHA256, "c7caa9a710f07a14fe8952111576ed04b6361da15b4d68dc5580a063dbfcbe64");
  assert.equal(FLOWISE_PNPM_LOCK_SHA256, "f37c5b91f15e8a162a6daa3ed214d37649c887c9dab74c2ba840ce2db60eaae8");
  assert.equal(
    (bake.match(/context\s*=\s*"https:\/\/github\.com\/mysticalsin\/aria-sourcing\.git#\$\{RELEASE_SOURCE_COMMIT\}"/g) ?? []).length,
    5,
    "each final image must bind its ARIA Dockerfile and context to the release commit",
  );
  assert.match(bake, /bytedance\/deer-flow\.git#\$\{DEERFLOW_SOURCE_COMMIT\}/);
  assert.match(bake, /dockerfile\s*=\s*"infra\/agent-frameworks\/upstream\/deerflow\.Dockerfile"/);
  assert.match(bake, /DEERFLOW_UV_LOCK_SHA256/);
  assert.match(bake, /FlowiseAI\/Flowise\.git#\$\{FLOWISE_SOURCE_COMMIT\}/g);
  assert.ok((bake.match(/dockerfile\s*=\s*"infra\/agent-frameworks\/upstream\/flowise\.Dockerfile"/g) ?? []).length >= 2);
  assert.ok(read("upstream/flowise.Dockerfile").includes(FLOWISE_PNPM_LOCK_SHA256));
  assert.match(bake, /target\s+"model-gateway"/);
  assert.match(bake, /dockerfile\s*=\s*"infra\/agent-frameworks\/fly\/runtime\/model-gateway\.Dockerfile"/);
  assert.match(bake, /target\s+"release"\s*\{[\s\S]*?attest\s*=\s*\["type=provenance,mode=max"\]/);
  assert.doesNotMatch(bake, /type=sbom/, "the build graph must not pull BuildKit's mutable default SBOM scanner");
  assert.match(bake, /target\s+"release"\s*\{[\s\S]*?secret\s*=\s*\["id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN"\]/);
  assert.equal((bake.match(/inherits\s*=\s*\["release"\]/g) ?? []).length, 5);
  assert.doesNotMatch(bake, /backend\/Dockerfile|docker\/worker\/Dockerfile|#main|#master|:latest/);
});

test("Flowise final images contain only the clean production runtime on an immutable base", () => {
  const dockerfile = read("upstream/flowise.Dockerfile");
  const entrypoint = read("upstream/flowise-entrypoint.cjs");

  assert.equal(
    FLOWISE_RUNTIME_IMAGE,
    "gcr.io/distroless/nodejs24-debian13:nonroot@sha256:b1386d556b478c420927eb212236bfb31be9834a4549850a060a6351f7fff514",
  );
  assert.match(dockerfile, /ARG RUNTIME_IMAGE/);
  assert.match(dockerfile, /ARG FLOWISE_PNPM_LOCK_SHA256/);
  assert.match(dockerfile, /FROM \$\{RUNTIME_IMAGE\} AS runtime/);
  assert.match(dockerfile, /USER 0:0[\s\S]+WORKDIR \/app[\s\S]+USER 65532:65532/);
  assert.match(dockerfile, /pnpm fetch --frozen-lockfile --ignore-scripts --store-dir=\/pnpm\/store/);
  assert.doesNotMatch(dockerfile, /--mount=type=cache/, "the offline store must be part of the immutable build layer");
  assert.match(
    dockerfile,
    /--network=none[\s\S]+?pnpm install[\s\\]+--prod[\s\\]+--offline[\s\\]+--frozen-lockfile[\s\\]+--verify-store-integrity[\s\\]+--ignore-scripts/,
  );
  assert.match(dockerfile, /cp -a package\.json pnpm-lock\.yaml pnpm-workspace\.yaml \/runtime\//);
  assert.match(dockerfile, /cd \/runtime[\s\\]+&& pnpm install/);
  assert.match(dockerfile, /production dependency tree is incomplete/);
  assert.match(dockerfile, /development dependencies leaked into production/);
  assert.match(dockerfile, /install -d -m 0555 \/runtime-opt\/aria \/worker-opt\/aria/);
  assert.match(dockerfile, /COPY --from=build --chown=0:0 \/runtime\/ \.\//);
  assert.match(dockerfile, /COPY --from=build --chown=0:0 \/runtime-opt\/ \/opt\//);
  assert.match(dockerfile, /COPY --from=build --chown=0:0 \/worker-opt\/ \/opt\//);
  assert.match(dockerfile, /build-only content leaked into runtime/);
  assert.match(dockerfile, /bytes > 2100000000/);
  assert.match(dockerfile, /fs\.chownSync\(directory,0,0\); fs\.chmodSync\(directory,0o555\)/);
  assert.match(dockerfile, /test -e \/runtime\/packages\/components\/node_modules\/ioredis/);
  assert.match(dockerfile, /ln -s \.\.\/\.\.\/components\/node_modules\/ioredis \/runtime\/packages\/server\/node_modules\/ioredis/);
  for (const dependency of ["@langchain/core", "@langchain/langgraph", "keyv@5.3.2", "lunary", "redis"]) {
    assert.ok(dockerfile.includes(dependency), dependency);
  }
  assert.match(dockerfile, /test -e \/runtime\/packages\/server\/node_modules\/turndown/);
  assert.match(dockerfile, /ln -s \.\.\/\.\.\/server\/node_modules\/turndown \/runtime\/packages\/components\/node_modules\/turndown/);
  assert.match(dockerfile, /test -e \/runtime\/packages\/server\/node_modules\/multer/);
  assert.match(dockerfile, /ln -s \.\.\/\.\.\/server\/node_modules\/multer \/runtime\/packages\/components\/node_modules\/multer/);
  for (const dependency of [
    "@google-cloud/logging-winston",
    "@opentelemetry/instrumentation",
    "@opentelemetry/sdk-trace-node",
    "multer-azure-blob-storage",
    "multer-cloud-storage",
    "multer-s3",
    "s3-streamlogger",
    "winston-azure-blob",
    "winston-daily-rotate-file",
  ]) assert.ok(dockerfile.includes(dependency), dependency);
  assert.match(dockerfile, /require\('\/runtime\/node_modules\/\.pnpm\/sqlite3@5\.1\.7\/node_modules\/sqlite3'\)/);
  assert.match(dockerfile, /require\('\/runtime\/node_modules\/\.pnpm\/faiss-node@0\.5\.1\/node_modules\/faiss-node'\)/);
  assert.doesNotMatch(dockerfile, /COPY --from=build[^\n]*\/usr\/src\/flowise\/ \.\//);
  for (const runtimePath of [
    "/runtime/packages/server",
    "/runtime/packages/components",
    "/runtime/packages/ui/build",
  ]) assert.ok(dockerfile.includes(runtimePath), runtimePath);
  assert.match(dockerfile, /USER 65532:65532/);
  assert.match(dockerfile, /ENTRYPOINT \["\/nodejs\/bin\/node", "\/opt\/aria\/flowise-entrypoint\.cjs"\]/);
  assert.match(entrypoint, /new Set\(\["start", "worker"\]\)/);
  assert.match(entrypoint, /flowise-worker-healthcheck\.mjs/);
  assert.match(entrypoint, /oclif\.run\(undefined, "\/app\/packages\/server"\)/);
  assert.doesNotMatch(entrypoint, /execSync|spawnSync|shell:\s*true/);
});

test("deployment is private, digest-only, isolated, and fail-closed on missing secrets", () => {
  const composeText = read("compose.yaml");
  const adapterServer = read("adapter/server.mjs");
  const compose = yaml.load(composeText);
  assert.equal(compose.networks.framework_private.internal, true);
  assert.equal(compose.networks.framework_private.driver, "bridge");
  assert.equal(composeText.includes("ports:"), false);

  const services = compose.services;
  assert.equal(services["framework-secrets-preflight"].network_mode, "none");
  assert.equal(services["framework-secrets-preflight"].read_only, true);
  assert.ok(services["framework-secrets-preflight"].secrets.length >= 13);
  assert.equal(services["framework-secrets-preflight"].secrets.includes("flowise_api_key"), false);
  const flowiseRuntimePreflight = services["flowise-runtime-secrets-preflight"];
  assert.equal(flowiseRuntimePreflight.network_mode, "none");
  assert.equal(flowiseRuntimePreflight.read_only, true);
  assert.ok(flowiseRuntimePreflight.secrets.includes("flowise_api_key"));
  assert.match(
    flowiseRuntimePreflight.environment.SECRET_PREFLIGHT_FILES,
    /(?:^|,)\/run\/secrets\/flowise_api_key(?:,|$)/,
  );
  assert.equal(compose.secrets.flowise_api_key.file, "${FLOWISE_API_KEY_FILE:-/dev/null}");
  assert.equal(
    services["flowise-adapter"].depends_on["flowise-runtime-secrets-preflight"].condition,
    "service_completed_successfully",
    "the private Flowise adapter must not start until its post-bootstrap key passes reuse validation",
  );
  assert.equal(services["deerflow-db"], undefined, "the ephemeral DeerFlow runtime must not start a database");
  assert.equal(services["deerflow-redis"], undefined, "the ephemeral DeerFlow boundary must not start an unused Redis service");
  for (const name of ["deerflow", "flowise", "flowise-worker", "flowise-redis", "flowise-db", "deerflow-adapter", "flowise-adapter"]) {
    assert.ok(services[name], `${name} service is required`);
    assert.deepEqual(services[name].networks, ["framework_private"]);
    assert.ok(services[name].mem_limit, `${name} must have a memory ceiling`);
    assert.ok(services[name].cpus, `${name} must have a CPU ceiling`);
    assert.ok(services[name].pids_limit, `${name} must have a process ceiling`);
  }
  const gateway = services["model-gateway"];
  assert.ok(gateway, "model-gateway service is required");
  assert.match(gateway.image, /^\$\{MODEL_GATEWAY_IMAGE_REPOSITORY:\?.+\}@sha256:\$\{MODEL_GATEWAY_IMAGE_SHA256:\?.+\}$/);
  assert.deepEqual(Object.keys(gateway.networks).sort(), ["framework_private", "model_gateway_egress"]);
  assert.deepEqual(gateway.networks.framework_private.aliases, ["model-gateway.service.internal"]);
  assert.equal(gateway.read_only, true);
  assert.equal(gateway.user, "1000:1000");
  assert.deepEqual(gateway.cap_drop, ["ALL"]);
  assert.ok(gateway.security_opt.includes("no-new-privileges:true"));
  assert.ok(gateway.mem_limit);
  assert.ok(gateway.cpus);
  assert.ok(gateway.pids_limit);
  assert.deepEqual(gateway.secrets.sort(), ["deerflow_model_gateway_token", "deerflow_model_provider_api_key"]);
  assert.equal(gateway.environment.MODEL_GATEWAY_INTERNAL_TOKEN_FILE, "/run/secrets/deerflow_model_gateway_token");
  assert.equal(gateway.environment.MODEL_GATEWAY_UPSTREAM_API_KEY_FILE, "/run/secrets/deerflow_model_provider_api_key");
  assert.equal(gateway.environment.MODEL_GATEWAY_BIND_HOST, "0.0.0.0");
  assert.equal(gateway.environment.MODEL_GATEWAY_REQUEST_MAX_BYTES, "262144");
  assert.equal(gateway.environment.MODEL_GATEWAY_PROVIDER_ID, "${DEERFLOW_CLOUD_PROVIDER_ID:?Set the exact allowlisted cloud provider identity}");
  assert.equal(gateway.environment.MODEL_GATEWAY_MODEL_ID, "${DEERFLOW_MODEL_ID:?Set the exact provider model identifier}");
  assert.equal(compose.networks.model_gateway_egress.driver, "bridge");
  assert.notEqual(compose.networks.model_gateway_egress.internal, true);
  assert.equal(services.deerflow.environment.DEERFLOW_MODEL_BASE_URL, "http://model-gateway.service.internal:8090/v1");
  assert.ok(services.deerflow.secrets.includes("deerflow_model_gateway_token"));
  assert.equal(services.deerflow.secrets.includes("deerflow_model_provider_api_key"), false);
  assert.doesNotMatch(composeText, /deerflow_model_api_key/);
  for (const name of ["deerflow", "flowise", "flowise-worker", "flowise-redis", "flowise-db", "deerflow-adapter", "flowise-adapter"]) {
    assert.match(
      services[name].image,
      /^\$\{[A-Z0-9_]+_REPOSITORY:\?.+\}@sha256:\$\{[A-Z0-9_]+_SHA256:\?.+\}$/,
      `${name} must structurally require a digest instead of accepting a mutable tag`,
    );
  }
  for (const name of ["deerflow-adapter", "flowise-adapter"]) {
    const service = services[name];
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.ok(service.security_opt.includes("no-new-privileges:true"));
    assert.equal(service.restart, "unless-stopped");
    assert.equal(service.environment.BIND_HOST, "0.0.0.0");
    assert.ok(service.secrets.length >= 3);
    assert.ok(service.environment.ADAPTER_TOKEN_FILE.startsWith("/run/secrets/"));
    assert.ok(service.environment.UPSTREAM_TOKEN_FILE.startsWith("/run/secrets/"));
    for (const key of [
      "AGENT_FRAMEWORK_READINESS_WORKSPACE_ID",
      "AGENT_FRAMEWORK_CONFIGURATION_SHA256",
      "FRAMEWORK_ADAPTER_IMAGE_DIGEST",
      "REDIS_IMAGE_DIGEST",
      "DEERFLOW_ADAPTER_URL",
      "DEERFLOW_FRAMEWORK_INSTANCE_ID",
      "DEERFLOW_DATABASE_IMAGE_DIGEST",
      "DEERFLOW_MODEL_PROVIDER",
      "DEERFLOW_MODEL_GATEWAY_IMAGE_DIGEST",
      "DEERFLOW_CLOUD_PROVIDER_ID",
      "DEERFLOW_MODEL_ID",
      "DEERFLOW_MODEL_BASE_URL",
      "DEERFLOW_MODEL_CREDENTIAL_VERSION",
      "FLOWISE_ADAPTER_URL",
      "FLOWISE_FRAMEWORK_INSTANCE_ID",
      "FLOWISE_WORKER_IMAGE_DIGEST",
      "FLOWISE_DATABASE_IMAGE_DIGEST",
      "FLOWISE_WORKSPACE_ID",
      "FLOWISE_READINESS_WORKFLOW_ID",
      "FLOWISE_QUEUE_NAME",
    ]) assert.equal(Object.hasOwn(service.environment, key), true, `${name} must receive canonical ${key}`);
    assert.equal(service.environment.DEERFLOW_MODEL_PROVIDER, "langchain-openai");
  }
  for (const name of ["flowise_db_password", "flowise_redis_password"]) {
    assert.match(compose.secrets[name].file, /^\$\{[A-Z0-9_]+:\?.+\}$/);
    assert.notEqual(compose.secrets[name].external, true);
  }
  assert.equal(services["flowise-db"].cap_drop, undefined, "the official Postgres root entrypoint must initialize and drop privileges");
  assert.notEqual(services["flowise-redis"].user, "0:0");
  assert.doesNotMatch(composeText, /--requirepass|redis-cli[^\n]*\s-a\s/);
  assert.equal((composeText.match(/maxmemory 384mb/g) ?? []).length, 1);
  assert.equal(services.deerflow.environment.DEERFLOW_STREAM_BRIDGE_REDIS_HOST, undefined);
  assert.equal(services.deerflow.environment.DEERFLOW_DATABASE_HOST, undefined);
  assert.equal(services["deerflow-adapter"].environment.REDIS_HOST, undefined);
  assert.equal(services["flowise-adapter"].environment.REDIS_HOST, "flowise-redis");
  assert.equal(services["deerflow-adapter"].environment.REDIS_FLY_HOST, undefined);
  assert.equal(services["flowise-adapter"].environment.REDIS_FLY_HOST, undefined);
  assert.equal(services.deerflow.secrets.includes("deerflow_redis_password"), false);
  assert.equal(services.deerflow.secrets.includes("deerflow_db_password"), false);
  assert.equal(services.deerflow.secrets.includes("flowise_redis_password"), false);
  assert.ok(services.flowise.secrets.includes("flowise_redis_password"));
  assert.equal(services.flowise.secrets.includes("deerflow_redis_password"), false);
  assert.ok(services["flowise-worker"].secrets.includes("flowise_redis_password"));
  assert.equal(services["flowise-worker"].secrets.includes("deerflow_redis_password"), false);
  const workerHealthcheck = JSON.stringify(services["flowise-worker"].healthcheck.test);
  assert.doesNotMatch(workerHealthcheck, /curl/, "the checksum-built slim worker image does not install curl");
  assert.match(workerHealthcheck, /aria\.flowise-worker-readiness\.v1/);
  const serverHealthcheck = JSON.stringify(services.flowise.healthcheck.test);
  assert.doesNotMatch(serverHealthcheck, /curl/, "the checksum-built slim Flowise image does not install curl");
  assert.match(serverHealthcheck, /\/api\/v1\/ping/);
  assert.match(serverHealthcheck, /body===['"]pong['"]/);
  assert.equal(services["deerflow-adapter"].secrets.includes("deerflow_redis_password"), false);
  assert.equal(services["deerflow-adapter"].secrets.includes("flowise_redis_password"), false);
  assert.ok(services["deerflow-adapter"].secrets.includes("deerflow_model_gateway_token"));
  assert.equal(services["deerflow-adapter"].environment.MODEL_GATEWAY_TOKEN_FILE, "/run/secrets/deerflow_model_gateway_token");
  assert.ok(services["flowise-adapter"].secrets.includes("flowise_redis_password"));
  assert.equal(services["flowise-adapter"].secrets.includes("deerflow_redis_password"), false);
  assert.equal(services.deerflow.depends_on["deerflow-redis"], undefined);
  assert.equal(services.deerflow.depends_on["deerflow-db"], undefined);
  assert.equal(services.deerflow.depends_on["flowise-redis"], undefined);
  assert.ok(services["deerflow-adapter"].depends_on["model-gateway"]);
  assert.ok(services.flowise.depends_on["flowise-redis"]);
  assert.equal(services.flowise.depends_on["deerflow-redis"], undefined);
  assert.ok(services["flowise-worker"].depends_on["flowise-redis"]);
  assert.equal(services["flowise-worker"].depends_on["deerflow-redis"], undefined);
  assert.equal(compose.secrets.redis_url, undefined);
  assert.equal(compose.secrets.redis_password, undefined);
  assert.equal(compose.secrets.deerflow_db_password, undefined);
  assert.equal(compose.secrets.deerflow_redis_password, undefined);
  assert.match(compose.secrets.flowise_redis_password.file, /^\$\{FLOWISE_REDIS_PASSWORD_FILE:\?.+\}$/);
  assert.match(adapterServer, /CLIENT", "LIST", "TYPE", "normal/);
  assert.match(composeText, /FLOWISE_TENANT_ISOLATION:\s*instance-per-workspace/);
  assert.doesNotMatch(composeText, /:latest/);
  assert.doesNotMatch(composeText, /DEER_FLOW_AUTH_DISABLED=1|DEER_FLOW_AUTH_DISABLED:\s*["']?1/);
});

test("DeerFlow proposal agent declares no application tools and the gateway removes its pinned framework builtin before egress", () => {
  const config = yaml.load(read("deerflow-agent/config.yaml"));
  const gateway = read("model-gateway/server.mjs");
  assert.equal(config.name, "aria-proposal");
  assert.equal(config.model, "aria-model");
  assert.deepEqual(config.tool_groups, []);
  assert.deepEqual(config.skills, ["aria-boundary"]);

  const skill = read("deerflow-skills/public/aria-boundary/SKILL.md");
  assert.match(skill, /allowed-tools:\s*\[\]/);
  assert.match(skill, /Do not call\s+tools/);

  const soul = read("deerflow-agent/SOUL.md");
  assert.match(soul, /selectedReviewedQueryIndex/);
  assert.match(soul, /Return exactly one JSON object/);
  assert.match(soul, /Never invent or rewrite a sourcing query/);
  assert.match(soul, /Do not return candidate/i);
  assert.match(gateway, /PINNED_DEERFLOW_REVIEW_TOOL/);
  assert.match(gateway, /name:\s*"review_skill_package"/);
  assert.match(gateway, /tool_authority_not_allowed/);
});

test("DeerFlow runtime config uses the pinned schema and production dependencies", () => {
  const config = yaml.load(read("deerflow-config.yaml"));
  assert.equal(config.config_version, 24);
  assert.equal(config.models.length, 1);
  assert.equal(config.models[0].name, "aria-model");
  assert.equal(config.models[0].use, "langchain_openai:ChatOpenAI");
  assert.equal(
    config.models[0].disable_streaming,
    true,
    "the bounded non-streaming gateway requires ChatOpenAI to fall back from DeerFlow astream to ainvoke",
  );
  assert.equal(config.database.backend, "memory");
  assert.equal(config.database.postgres_url, undefined);
  assert.equal(config.run_events.backend, "memory");
  assert.equal(config.stream_bridge.type, "memory");
  assert.equal(config.stream_bridge.redis_url, undefined);
  assert.equal(config.sandbox.allow_host_bash, false);
  assert.equal(config.memory.enabled, false);
  assert.ok(config.memory.max_facts >= 10, "disabled memory still must satisfy the pinned Pydantic schema");
  assert.ok(config.memory.max_injection_tokens >= 100, "disabled memory still must satisfy the pinned Pydantic schema");
  assert.equal(config.agents_api.enabled, false);
  assert.equal(config.skills.path, "/opt/aria/deerflow/skills");
  assert.equal(config.skills.deferred_discovery, false);
  assert.equal(config.skill_evolution.enabled, false);
  assert.equal(config.scheduler.enabled, false);
});

test("Flowise worker health fails closed until fresh worker-owned database and queue evidence exists", async (t) => {
  const port = await availablePort();
  const evidenceFile = path.join(
    "/tmp",
    `aria-flowise-worker-readiness-test-${process.pid}-${Date.now()}.json`,
  );
  const healthcheck = path.join(here, "upstream/flowise-worker-healthcheck.mjs");
  const child = spawn(process.execPath, [healthcheck], {
    env: {
      ...process.env,
      WORKER_PORT: String(port),
      QUEUE_NAME: "aria-flowise",
      ARIA_FLOWISE_WORKER_READINESS_FILE: evidenceFile,
      ARIA_FLOWISE_WORKER_READINESS_MAX_AGE_MS: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGTERM");
    fs.rmSync(evidenceFile, { force: true });
  });

  const origin = `http://127.0.0.1:${port}`;
  let response = await waitForWorkerHealth(origin, child);
  assert.equal(response.status, 503, "a live parent process is not worker readiness evidence");
  assert.deepEqual(await response.json(), {
    schema: "aria.flowise-worker-readiness.v1",
    status: "unavailable",
  });

  const evidence = {
    schema: "aria.flowise-worker-readiness-evidence.v1",
    observedAt: Date.now(),
    workerPid: process.pid,
    queueName: "aria-flowise",
    database: true,
    workers: [
      { queue: "aria-flowise-prediction", id: "prediction-worker", running: true, redis: true },
      { queue: "aria-flowise-upsertion", id: "upsertion-worker", running: true, redis: true },
      { queue: "aria-flowise-schedule", id: "schedule-worker", running: true, redis: true },
    ],
  };
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });

  response = await fetch(`${origin}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schema: "aria.flowise-worker-readiness.v1",
    status: "ready",
    queueName: "aria-flowise",
    database: true,
    queue: true,
    worker: true,
  });

  fs.writeFileSync(evidenceFile, `${JSON.stringify({ ...evidence, observedAt: Date.now() - 2_000 })}\n`, { mode: 0o600 });
  response = await fetch(`${origin}/healthz`);
  assert.equal(response.status, 503, "stale worker evidence must not remain ready");

  fs.writeFileSync(evidenceFile, `${JSON.stringify({ ...evidence, queueName: "other-queue" })}\n`, { mode: 0o600 });
  response = await fetch(`${origin}/healthz`);
  assert.equal(response.status, 503, "evidence for a different queue must not cross the readiness boundary");
});

test("Flowise worker readiness patch is checksum-bound to the reviewed upstream command", () => {
  const patcher = path.join(here, "upstream/patch-flowise-worker-readiness.mjs");
  const fixture = path.join(here, "upstream/testdata/worker.ts.ed9e100fb7");
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-flowise-worker-patch-"));
  const target = path.join(targetDir, "worker.ts");
  fs.copyFileSync(fixture, target);

  assert.equal(
    createHash("sha256").update(fs.readFileSync(fixture)).digest("hex"),
    "c1bd833235bcfde0fc1593a9a2cb49bce4e6c5e5fe9a9fc0d1435946223eced4",
  );
  execFileSync(process.execPath, [patcher, target], { stdio: "pipe" });
  const patched = fs.readFileSync(target, "utf8");
  assert.match(patched, /appDataSource\.query\('SELECT 1'\)/);
  assert.match(patched, /worker\.isRunning\(\)/);
  assert.match(patched, /client\.ping\(\)/);
  assert.match(patched, /aria\.flowise-worker-readiness-evidence\.v1/);
  assert.match(patched, /observedAt: Date\.now\(\)/);
  assert.match(patched, /writeFile\(temporaryFile/);
  assert.match(patched, /rename\(temporaryFile, readinessFile\)/);
  assert.throws(
    () => execFileSync(process.execPath, [patcher, target], { stdio: "pipe" }),
    /Command failed/,
    "an already-patched or drifted upstream command must be rejected",
  );
});

test("DeerFlow wait cleanup is checksum-pinned to the audited source and fails closed", () => {
  const patcher = path.join(here, "deerflow-runtime/patch-ephemeral-wait.py");
  const cleanupGuard = path.join(here, "deerflow-runtime/cleanup-guard.py");
  const guardVerifier = path.join(here, "deerflow-runtime/verify-cleanup-deadline.py");
  const runtimePolicy = path.join(here, "deerflow-runtime/runtime-policy.py");
  const policyVerifier = path.join(here, "deerflow-runtime/verify-runtime-policy.py");
  const fixture = path.join(here, "deerflow-runtime/testdata/runs.py.3c0a45ad77");
  const dockerfile = read("deerflow-runtime/Dockerfile");
  const compose = read("compose.yaml");
  const flyEntrypoint = read("fly/runtime/deerflow-entrypoint.sh");
  const patchSource = fs.readFileSync(patcher, "utf8");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aria-deerflow-patch-"));
  const target = path.join(temp, "runs.py");
  fs.copyFileSync(fixture, target);

  assert.match(patchSource, /3c0a45ad772cdba388009b8d5ecad5e48cd22429/);
  assert.match(patchSource, /c4c65471bea48b5981c96cc8bbe802a5795da4d13c03329892efb2645339625e/);
  assert.match(dockerfile, /patch-ephemeral-wait\.py/);
  assert.match(dockerfile, /backend\/app\/gateway\/routers\/runs\.py/);

  execFileSync("python3", [patcher, target], { stdio: "pipe" });
  execFileSync("python3", [path.join(here, "deerflow-runtime/verify-ephemeral-wait.py"), target], { stdio: "pipe" });
  execFileSync("python3", [guardVerifier, cleanupGuard], { stdio: "pipe" });
  execFileSync("python3", [policyVerifier, runtimePolicy], { stdio: "pipe" });
  const patched = fs.readFileSync(target, "utf8");
  assert.equal(createHash("sha256").update(fs.readFileSync(target)).digest("hex"),
    "d5ee9ebcf676656ca9380e866b414d1ff4fa70cfac587a9fbc7d7a60506a6db4");
  assert.match(patched, /body\.on_completion == "delete"/);
  assert.match(patched, /serialize_channel_values_for_api\(channel_values\)/);
  assert.match(patched, /finally:\s+if body\.on_completion == "delete":\s+await _shielded_delete_temporary_wait_state\(request, record, thread_id\)/);
  assert.ok(
    patched.indexOf("serialize_channel_values_for_api(channel_values)") <
      patched.indexOf("await _shielded_delete_temporary_wait_state(request, record, thread_id)"),
    "the final state must be serialized before its exact temporary state is erased",
  );
  assert.match(patched, /asyncio\.shield\(cleanup_task\)/);
  assert.match(patched, /except asyncio\.CancelledError/);
  assert.match(patched, /os\._exit\(70\)/);
  assert.match(patched, /run_store\.delete\(run_id\)/);
  assert.match(patched, /event_store\.delete_by_thread\(thread_id\)/);
  assert.match(patched, /getattr\(checkpointer, "adelete_thread"/);
  assert.match(patched, /delete_checkpoints\(thread_id\)/);
  assert.match(patched, /thread_store\.delete\(thread_id\)/);
  assert.match(patched, /bridge\.cleanup\(run_id, delay=0\)/);
  assert.match(patched, /run_mgr\.cleanup\(run_id, delay=0\)/);
  assert.match(patched, /get_paths\(\)\.delete_thread_dir/);
  assert.match(dockerfile, /cleanup-guard\.py \/app\/backend\/aria_cleanup_guard\.py/);
  assert.match(dockerfile, /runtime-policy\.py \/app\/backend\/aria_runtime_policy\.py/);
  assert.match(dockerfile, /aria-deerflow-app\.py \/app\/backend\/aria_deerflow_app\.py/);
  assert.match(compose, /uvicorn aria_deerflow_app:app/);
  assert.match(flyEntrypoint, /uvicorn aria_deerflow_app:app/);
  assert.throws(
    () => execFileSync("python3", [patcher, target], { stdio: "pipe" }),
    /Command failed/,
    "the patch must reject an already-patched or drifted source file",
  );
});
