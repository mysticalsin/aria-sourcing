import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");

test("adapter image pins its base, runs unprivileged, and imports the canonical capability core", () => {
  const dockerfile = read("adapter/Dockerfile");
  assert.match(dockerfile, /node:22\.22\.0-alpine3\.23@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34/);
  assert.match(dockerfile, /COPY --chown=node:node src\/lib\/agents\/framework\/capability-core\.mjs/);
  assert.match(dockerfile, /COPY --chown=node:node src\/lib\/agents\/framework\/configuration-core\.mjs/);
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
  assert.match(dockerfile, /node:22\.22\.0-alpine3\.23@sha256:e4bf2a82ad0a4037d28035ae71529873c069b13eb0455466ae0bc13363826e34/);
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
    "DEERFLOW_REDIS_PASSWORD_FILE",
    "FLOWISE_REDIS_PASSWORD_FILE",
  ]) assert.match(example, new RegExp(`^${name}=`, "m"), name);
  assert.doesNotMatch(example, /^MODEL_GATEWAY_(?:INTERNAL_TOKEN|UPSTREAM_API_KEY)=/m);
  assert.doesNotMatch(example, /^REDIS_PASSWORD_FILE=/m);
});

test("upstream build graph uses exact audited commits and emits SBOM plus provenance", () => {
  const bake = read("docker-bake.hcl");
  assert.match(bake, /bytedance\/deer-flow\.git#fabadae4168db81f0eaaf62f209050f978e2f691/);
  assert.match(bake, /dockerfile\s*=\s*"backend\/Dockerfile"/);
  assert.match(bake, /FlowiseAI\/Flowise\.git#bb773ffa710bd22639c4ba2643413a0ea2b679d3/g);
  assert.match(bake, /dockerfile\s*=\s*"Dockerfile"/);
  assert.match(bake, /dockerfile\s*=\s*"docker\/worker\/Dockerfile"/);
  assert.match(bake, /target\s+"model-gateway"/);
  assert.match(bake, /dockerfile\s*=\s*"infra\/agent-frameworks\/model-gateway\/Dockerfile"/);
  assert.ok((bake.match(/type=sbom/g) ?? []).length >= 5);
  assert.ok((bake.match(/type=provenance,mode=max/g) ?? []).length >= 5);
  assert.doesNotMatch(bake, /#main|#master|:latest/);
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
  assert.ok(services["framework-secrets-preflight"].secrets.length >= 15);
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
  for (const name of ["deerflow", "flowise", "flowise-worker", "deerflow-redis", "flowise-redis", "deerflow-db", "flowise-db", "deerflow-adapter", "flowise-adapter"]) {
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
  for (const name of ["deerflow", "flowise", "flowise-worker", "deerflow-redis", "flowise-redis", "deerflow-db", "flowise-db", "deerflow-adapter", "flowise-adapter"]) {
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
  for (const name of ["deerflow_db_password", "flowise_db_password", "deerflow_redis_password", "flowise_redis_password"]) {
    assert.match(compose.secrets[name].file, /^\$\{[A-Z0-9_]+:\?.+\}$/);
    assert.notEqual(compose.secrets[name].external, true);
  }
  assert.equal(services["deerflow-db"].cap_drop, undefined, "the official Postgres root entrypoint must initialize and drop privileges");
  assert.equal(services["flowise-db"].cap_drop, undefined, "the official Postgres root entrypoint must initialize and drop privileges");
  for (const name of ["deerflow-redis", "flowise-redis"]) {
    assert.notEqual(services[name].user, "0:0");
  }
  assert.doesNotMatch(composeText, /--requirepass|redis-cli[^\n]*\s-a\s/);
  assert.equal((composeText.match(/maxmemory 384mb/g) ?? []).length, 2);
  assert.equal(services.deerflow.environment.DEERFLOW_STREAM_BRIDGE_REDIS_HOST, undefined);
  assert.equal(services["deerflow-adapter"].environment.REDIS_HOST, "deerflow-redis");
  assert.equal(services["flowise-adapter"].environment.REDIS_HOST, "flowise-redis");
  assert.equal(services["deerflow-adapter"].environment.REDIS_FLY_HOST, undefined);
  assert.equal(services["flowise-adapter"].environment.REDIS_FLY_HOST, undefined);
  assert.ok(services.deerflow.secrets.includes("deerflow_redis_password"));
  assert.equal(services.deerflow.secrets.includes("flowise_redis_password"), false);
  assert.ok(services.flowise.secrets.includes("flowise_redis_password"));
  assert.equal(services.flowise.secrets.includes("deerflow_redis_password"), false);
  assert.ok(services["flowise-worker"].secrets.includes("flowise_redis_password"));
  assert.equal(services["flowise-worker"].secrets.includes("deerflow_redis_password"), false);
  assert.ok(services["deerflow-adapter"].secrets.includes("deerflow_redis_password"));
  assert.equal(services["deerflow-adapter"].secrets.includes("flowise_redis_password"), false);
  assert.ok(services["deerflow-adapter"].secrets.includes("deerflow_model_gateway_token"));
  assert.equal(services["deerflow-adapter"].environment.MODEL_GATEWAY_TOKEN_FILE, "/run/secrets/deerflow_model_gateway_token");
  assert.ok(services["flowise-adapter"].secrets.includes("flowise_redis_password"));
  assert.equal(services["flowise-adapter"].secrets.includes("deerflow_redis_password"), false);
  assert.notEqual(services["deerflow-redis"].volumes[0], services["flowise-redis"].volumes[0]);
  assert.ok(services.deerflow.depends_on["deerflow-redis"]);
  assert.equal(services.deerflow.depends_on["flowise-redis"], undefined);
  assert.ok(services["deerflow-adapter"].depends_on["model-gateway"]);
  assert.ok(services.flowise.depends_on["flowise-redis"]);
  assert.equal(services.flowise.depends_on["deerflow-redis"], undefined);
  assert.ok(services["flowise-worker"].depends_on["flowise-redis"]);
  assert.equal(services["flowise-worker"].depends_on["deerflow-redis"], undefined);
  assert.equal(compose.secrets.redis_url, undefined);
  assert.equal(compose.secrets.redis_password, undefined);
  assert.match(compose.secrets.deerflow_redis_password.file, /^\$\{DEERFLOW_REDIS_PASSWORD_FILE:\?.+\}$/);
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
  assert.equal(config.database.backend, "postgres");
  assert.equal(config.run_events.backend, "db");
  assert.equal(config.stream_bridge.type, "redis");
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
