import assert from "node:assert/strict";
import test from "node:test";

import {
  HOLDER_APP,
  buildPinPlan,
  pinRegistryImages,
  validateReleaseBundle,
} from "./pin-registry-images.mjs";

const RELEASE_SHA = "a".repeat(40);
const TOKEN = `fm2_${"token-value-".repeat(4)}`;
const COMPONENTS = [
  "adapter",
  "deerflow",
  "flowise",
  "flowise-worker",
  "model-gateway",
  "postgres",
  "redis",
];

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function releaseBundle({ duplicate = false, allSame = false } = {}) {
  const refs = Object.fromEntries(COMPONENTS.map((component, index) => {
    const value = allSame || (duplicate && component === "redis") ? digest("1") : digest(String(index + 1));
    return [component, `registry.fly.io/${HOLDER_APP}@${value}`];
  }));
  return {
    schema: "aria.agent-framework.image-release.v1",
    releaseSha: RELEASE_SHA,
    repository: `registry.fly.io/${HOLDER_APP}`,
    certificateIdentity: "https://github.com/example/workflow.yml@refs/heads/main",
    certificateIssuer: "https://token.actions.githubusercontent.com",
    refs,
    sourceCommits: Object.fromEntries(COMPONENTS.map((component) => [component, RELEASE_SHA])),
    upstreamImages: Object.fromEntries(COMPONENTS.map((component, index) => [
      component,
      `ghcr.io/example/${component}@${digest(String(index + 1))}`,
    ])),
    evidence: Object.fromEntries(COMPONENTS.map((component) => [component, {}])),
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function machineFor(pin, overrides = {}) {
  return {
    id: overrides.id ?? `machine-${pin.digest.slice(-8)}`,
    name: overrides.name ?? pin.name,
    state: overrides.state ?? "stopped",
    region: overrides.region ?? pin.region,
    image_ref: pin.ref,
    config: {
      image: pin.ref,
      auto_destroy: false,
      restart: { policy: "no" },
      services: [],
      metadata: pin.metadata,
      ...(overrides.config ?? {}),
    },
  };
}

test("buildPinPlan groups components that resolve to the same exact holder digest", () => {
  const bundle = validateReleaseBundle(releaseBundle({ duplicate: true }), HOLDER_APP);
  const plan = buildPinPlan(bundle, { app: HOLDER_APP, region: "cdg" });

  assert.equal(plan.length, 6);
  const shared = plan.find((pin) => pin.digest === digest("1"));
  assert.deepEqual(shared.components, ["adapter", "redis"]);
  assert.equal(shared.metadata.aria_release_sha, RELEASE_SHA);
  assert.equal(shared.metadata.aria_components, "adapter,redis");
  assert.equal(bundle.upstreamImages.deerflow, releaseBundle({ duplicate: true }).upstreamImages.deerflow);
});

test("pinRegistryImages creates only missing stopped pins without public services", async () => {
  const bundle = releaseBundle({ duplicate: true });
  const plan = buildPinPlan(validateReleaseBundle(bundle, HOLDER_APP), { app: HOLDER_APP, region: "cdg" });
  const missing = plan.at(-1);
  const inventory = plan.slice(0, -1).map(machineFor);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init.method === "GET") return jsonResponse(inventory);
    const body = JSON.parse(init.body);
    return jsonResponse(machineFor(missing, {
      id: "created-pin-123",
      state: "created",
      config: body.config,
      region: body.region,
    }));
  };

  const result = await pinRegistryImages({
    bundle,
    app: HOLDER_APP,
    region: "cdg",
    environment: { FLY_API_TOKEN: TOKEN },
    fetchImpl,
    sleep: async () => {},
  });

  assert.equal(result.created, 1);
  assert.equal(result.kept, plan.length - 1);
  assert.equal(result.total, plan.length);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.machines.dev/v1/apps/${HOLDER_APP}/machines`);
  assert.equal(calls[1].url, calls[0].url);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers.authorization, `Bearer ${TOKEN}`);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.skip_launch, true);
  assert.equal(body.skip_service_registration, true);
  assert.equal(body.name, missing.name);
  assert.equal(body.region, "cdg");
  assert.equal(body.config.image, missing.ref);
  assert.deepEqual(body.config.services, []);
  assert.equal(body.config.auto_destroy, false);
  assert.deepEqual(body.config.metadata, missing.metadata);
  assert.doesNotMatch(calls[1].init.body, new RegExp(TOKEN));
});

test("pinRegistryImages is idempotent and skips creation when every digest is already pinned", async () => {
  const bundle = releaseBundle();
  const plan = buildPinPlan(validateReleaseBundle(bundle, HOLDER_APP), { app: HOLDER_APP, region: "cdg" });
  let calls = 0;

  const result = await pinRegistryImages({
    bundle,
    app: HOLDER_APP,
    region: "cdg",
    environment: { FLY_API_TOKEN: TOKEN },
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(init.method, "GET");
      return jsonResponse(plan.map(machineFor));
    },
  });

  assert.deepEqual(result, { created: 0, kept: plan.length, total: plan.length });
  assert.equal(calls, 1);
});

test("pinRegistryImages reconciles a retried create by deterministic Machine name", async () => {
  const bundle = releaseBundle({ allSame: true });
  const [pin] = buildPinPlan(bundle, { app: HOLDER_APP, region: "cdg" });
  let calls = 0;

  const result = await pinRegistryImages({
    bundle,
    app: HOLDER_APP,
    region: "cdg",
    environment: { FLY_API_TOKEN: TOKEN },
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls === 1) return jsonResponse([]);
      if (calls === 2) {
        assert.equal(JSON.parse(init.body).name, pin.name);
        return jsonResponse({ error: "temporary" }, 503);
      }
      if (calls === 3) return jsonResponse({ error: "name already exists" }, 409);
      assert.equal(init.method, "GET");
      return jsonResponse([machineFor(pin, { state: "created" })]);
    },
    sleep: async () => {},
  });

  assert.deepEqual(result, { created: 1, kept: 0, total: 1 });
  assert.equal(calls, 4);
});

test("pinRegistryImages retries bounded transient failures and fails closed on an unsafe create response", async () => {
  const bundle = releaseBundle();
  let calls = 0;
  const secretBearingError = await pinRegistryImages({
    bundle,
    app: HOLDER_APP,
    region: "cdg",
    environment: { FLY_API_TOKEN: TOKEN },
    fetchImpl: async (_url, init) => {
      calls += 1;
      if (calls < 3) return jsonResponse({ error: TOKEN }, 503);
      if (init.method === "GET") return jsonResponse([]);
      const body = JSON.parse(init.body);
      return jsonResponse(machineFor(buildPinPlan(validateReleaseBundle(bundle, HOLDER_APP), {
        app: HOLDER_APP,
        region: "cdg",
      })[0], {
        id: "unsafe-machine",
        state: "started",
        config: { ...body.config, services: [{ protocol: "tcp", ports: [{ port: 443 }] }] },
      }));
    },
    sleep: async () => {},
  }).then(
    () => null,
    (error) => error,
  );

  assert.equal(calls, 4);
  assert(secretBearingError instanceof Error);
  assert.match(secretBearingError.message, /created Fly Machine response is unsafe/);
  assert.doesNotMatch(secretBearingError.message, new RegExp(TOKEN));
});

test("validateReleaseBundle rejects non-holder references and unexpected component sets", () => {
  const wrongRepository = releaseBundle();
  wrongRepository.refs.adapter = `registry.fly.io/another-app@${digest("f")}`;
  assert.throws(() => validateReleaseBundle(wrongRepository, HOLDER_APP), /image reference is invalid/);

  const unexpected = releaseBundle();
  unexpected.refs.extra = `registry.fly.io/${HOLDER_APP}@${digest("f")}`;
  assert.throws(() => validateReleaseBundle(unexpected, HOLDER_APP), /component set is invalid/);
});
