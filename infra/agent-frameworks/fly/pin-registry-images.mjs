#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const HOLDER_APP = "aria-mantu-agent-frameworks";

const API_ORIGIN = "https://api.machines.dev";
const BUNDLE_SCHEMA = "aria.agent-framework.image-release.v1";
const COMPONENTS = Object.freeze([
  "adapter",
  "deerflow",
  "flowise",
  "flowise-worker",
  "model-gateway",
  "postgres",
  "redis",
]);
const RELEASE_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REGION = /^[a-z]{3}$/;
const MACHINE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^(?:FlyV1 [A-Za-z0-9_-]+|fm2_[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)$/;
const MAX_BUNDLE_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 2_097_152;
const MAX_MACHINES = 10_000;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 50_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function fail(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} component set is invalid`);
  }
}

function exactObjectKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} fields are invalid`);
  }
}

function boundedString(value, label, maximum = 2048) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\0\r\n]/.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function assertBoundedJson(root) {
  const pending = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const { value, depth } = pending.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) fail("release bundle JSON exceeded its structural bound");
    if (typeof value === "string" && value.length > MAX_BUNDLE_BYTES) fail("release bundle JSON string exceeded its bound");
    if (!value || typeof value !== "object") continue;
    for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
}

function exactReference(app, digest) {
  return `registry.fly.io/${app}@${digest}`;
}

function validateHolderApp(app) {
  if (app !== HOLDER_APP) fail("Fly registry holder app is invalid");
  return app;
}

function validateRegion(region) {
  if (typeof region !== "string" || !REGION.test(region)) fail("Fly region is invalid");
  return region;
}

export function validateReleaseBundle(value, app = HOLDER_APP) {
  validateHolderApp(app);
  assertBoundedJson(value);
  const bundle = record(value, "release bundle");
  exactObjectKeys(bundle, [
    "schema",
    "releaseSha",
    "repository",
    "certificateIdentity",
    "certificateIssuer",
    "refs",
    "sourceCommits",
    "upstreamImages",
    "evidence",
  ], "release bundle");
  if (bundle.schema !== BUNDLE_SCHEMA) fail("release bundle schema is invalid");
  if (typeof bundle.releaseSha !== "string" || !RELEASE_SHA.test(bundle.releaseSha)) {
    fail("release bundle SHA is invalid");
  }
  const repository = `registry.fly.io/${app}`;
  if (bundle.repository !== repository) fail("release bundle repository is invalid");
  boundedString(bundle.certificateIdentity, "release bundle certificate identity", 4096);
  boundedString(bundle.certificateIssuer, "release bundle certificate issuer", 4096);

  exactKeys(bundle.refs, COMPONENTS, "release bundle refs");
  exactKeys(bundle.sourceCommits, COMPONENTS, "release bundle source commits");
  exactKeys(bundle.upstreamImages, COMPONENTS, "release bundle upstream images");
  exactKeys(bundle.evidence, COMPONENTS, "release bundle evidence");
  const refs = {};
  const sourceCommits = {};
  const upstreamImages = {};
  const evidence = {};
  for (const component of COMPONENTS) {
    const ref = bundle.refs[component];
    const prefix = `${repository}@`;
    if (typeof ref !== "string" || !ref.startsWith(prefix)) fail(`${component} image reference is invalid`);
    const digest = ref.slice(prefix.length);
    if (!DIGEST.test(digest) || ref !== exactReference(app, digest)) fail(`${component} image reference is invalid`);
    if (typeof bundle.sourceCommits[component] !== "string" || !RELEASE_SHA.test(bundle.sourceCommits[component])) {
      fail(`${component} source commit is invalid`);
    }
    const upstreamImage = bundle.upstreamImages[component];
    if (typeof upstreamImage !== "string" || !/^[a-z0-9][a-z0-9./:_-]{0,383}@sha256:[0-9a-f]{64}$/.test(upstreamImage)) {
      fail(`${component} upstream image is invalid`);
    }
    const componentEvidence = record(bundle.evidence[component], `${component} evidence`);
    refs[component] = ref;
    sourceCommits[component] = bundle.sourceCommits[component];
    upstreamImages[component] = upstreamImage;
    evidence[component] = Object.freeze({ ...componentEvidence });
  }

  return Object.freeze({
    schema: BUNDLE_SCHEMA,
    releaseSha: bundle.releaseSha,
    repository,
    certificateIdentity: bundle.certificateIdentity,
    certificateIssuer: bundle.certificateIssuer,
    refs: Object.freeze(refs),
    sourceCommits: Object.freeze(sourceCommits),
    upstreamImages: Object.freeze(upstreamImages),
    evidence: Object.freeze(evidence),
  });
}

export async function loadReleaseBundle(file) {
  boundedString(file, "release bundle path", 4096);
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch {
    fail("release bundle file could not be opened");
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_BUNDLE_BYTES) fail("release bundle file size is invalid");
    const bytes = await handle.readFile();
    if (bytes.length < 2 || bytes.length > MAX_BUNDLE_BYTES) fail("release bundle file size is invalid");
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail("release bundle JSON is invalid");
    }
    return value;
  } finally {
    await handle.close().catch(() => {});
  }
}

export function buildPinPlan(bundle, { app = HOLDER_APP, region = "cdg" } = {}) {
  validateHolderApp(app);
  validateRegion(region);
  const validated = validateReleaseBundle(bundle, app);
  const byDigest = new Map();
  for (const component of COMPONENTS) {
    const ref = validated.refs[component];
    const digest = ref.slice(ref.indexOf("@") + 1);
    const components = byDigest.get(digest) ?? [];
    components.push(component);
    byDigest.set(digest, components);
  }
  return Object.freeze([...byDigest.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([digest, components]) => {
    const sortedComponents = [...components].sort();
    return Object.freeze({
      app,
      region,
      digest,
      ref: exactReference(app, digest),
      name: `aria-pin-${validated.releaseSha.slice(0, 10)}-${digest.slice(7, 19)}`,
      components: Object.freeze(sortedComponents),
      metadata: Object.freeze({
        aria_pin_schema: "v1",
        aria_release_sha: validated.releaseSha,
        aria_components: sortedComponents.join(","),
        aria_digest: digest,
      }),
    });
  }));
}

function flyToken(environment) {
  const value = environment?.FLY_API_TOKEN;
  if (
    typeof value !== "string" || value.length < 20 || value.length > 4096 ||
    /[\0\r\n\t]/.test(value) || !TOKEN.test(value)
  ) {
    fail("FLY_API_TOKEN is missing or invalid");
  }
  return value;
}

async function boundedResponseText(response, maximum = MAX_RESPONSE_BYTES) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maximum) fail("Fly API response exceeded its bound");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel().catch(() => {});
      fail("Fly API response exceeded its bound");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function parseApiJson(text) {
  if (!text.trim()) fail("Fly API response is invalid");
  try {
    const value = JSON.parse(text);
    assertBoundedJson(value);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.includes("structural bound")) throw error;
    fail("Fly API response is invalid");
  }
}

async function machinesRequest(app, {
  method = "GET",
  body,
  expectedStatuses = [200],
  allowConflict = false,
  environment = process.env,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 3,
  timeoutMs = 15_000,
} = {}) {
  validateHolderApp(app);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) fail("Fly API retry bound is invalid");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) fail("Fly API timeout bound is invalid");
  const token = flyToken(environment);
  const url = new URL(`/v1/apps/${encodeURIComponent(app)}/machines`, API_ORIGIN);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      if (attempt === maxAttempts) fail("Fly API request failed closed");
      await sleep(100 * (2 ** (attempt - 1)));
      continue;
    }
    const text = await boundedResponseText(response);
    if (expectedStatuses.includes(response.status)) return parseApiJson(text);
    if (allowConflict && response.status === 409) return null;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) fail("Fly API request failed closed");
    await sleep(100 * (2 ** (attempt - 1)));
  }
  fail("Fly API request failed closed");
}

function servicesArePrivate(config) {
  return config?.services === undefined || (Array.isArray(config.services) && config.services.length === 0);
}

function machineImageReference(machine) {
  if (typeof machine?.config?.image === "string") return machine.config.image;
  if (typeof machine?.image_ref === "string") return machine.image_ref;
  const image = machine?.image_ref;
  if (
    image && typeof image === "object" && image.registry === "registry.fly.io" &&
    typeof image.repository === "string" && typeof image.digest === "string"
  ) {
    return `${image.registry}/${image.repository}@${image.digest}`;
  }
  return null;
}

function imageMatches(machine, ref) {
  return machineImageReference(machine) === ref;
}

function metadataMatches(metadata, expected) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
    Object.entries(expected).every(([key, value]) => metadata[key] === value);
}

function managedMachineMatches(machine, pin) {
  return metadataMatches(machine?.config?.metadata, pin.metadata) && imageMatches(machine, pin.ref);
}

function machineIsSafe(machine, pin) {
  return managedMachineMatches(machine, pin) &&
    MACHINE_ID.test(machine.id ?? "") &&
    machine.name === pin.name &&
    (machine.state === "created" || machine.state === "stopped") &&
    machine.region === pin.region &&
    servicesArePrivate(machine.config) &&
    machine.config?.auto_destroy === false &&
    machine.config?.restart?.policy === "no";
}

function validateInventory(value) {
  if (!Array.isArray(value) || value.length > MAX_MACHINES) fail("Fly Machine inventory is invalid");
  return value;
}

function createPayload(pin) {
  return {
    name: pin.name,
    region: pin.region,
    skip_launch: true,
    skip_service_registration: true,
    config: {
      image: pin.ref,
      auto_destroy: false,
      restart: { policy: "no" },
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
      services: [],
      metadata: pin.metadata,
    },
  };
}

export async function pinRegistryImages({
  bundle,
  app = HOLDER_APP,
  region = "cdg",
  environment = process.env,
  fetchImpl = fetch,
  sleep,
  maxAttempts = 3,
  timeoutMs = 15_000,
} = {}) {
  const validated = validateReleaseBundle(bundle, app);
  const plan = buildPinPlan(validated, { app, region });
  const requestOptions = { environment, fetchImpl, maxAttempts, timeoutMs, ...(sleep ? { sleep } : {}) };
  const inventory = validateInventory(await machinesRequest(app, requestOptions));
  let kept = 0;
  let created = 0;

  for (const pin of plan) {
    const managed = inventory.filter((machine) => managedMachineMatches(machine, pin));
    if (managed.some((machine) => !machineIsSafe(machine, pin))) fail("existing Fly registry pin is unsafe");
    const existing = managed.filter((machine) => machineIsSafe(machine, pin));
    if (existing.length > 1) fail("duplicate Fly registry pins are unsafe");
    if (existing.length === 1) {
      kept += 1;
      continue;
    }
    let machine = await machinesRequest(app, {
      ...requestOptions,
      method: "POST",
      body: createPayload(pin),
      expectedStatuses: [200],
      allowConflict: true,
    });
    if (machine === null) {
      const refreshed = validateInventory(await machinesRequest(app, requestOptions));
      const candidates = refreshed.filter((item) => managedMachineMatches(item, pin));
      if (candidates.length !== 1 || !machineIsSafe(candidates[0], pin)) {
        fail("Fly Machine create conflict could not be reconciled");
      }
      machine = candidates[0];
    }
    if (!machineIsSafe(machine, pin)) fail("created Fly Machine response is unsafe");
    created += 1;
    inventory.push(machine);
  }

  return Object.freeze({ created, kept, total: plan.length });
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) fail("usage: pin-registry-images --bundle <file> --app <app> --region <region>");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--bundle", "--app", "--region"].includes(flag) || values.has(flag) || typeof value !== "string" || value.startsWith("--")) {
      fail("pin-registry-images arguments are invalid");
    }
    values.set(flag, value);
  }
  const bundle = boundedString(values.get("--bundle"), "release bundle path", 4096);
  const app = validateHolderApp(values.get("--app"));
  const region = validateRegion(values.get("--region"));
  return Object.freeze({ bundle, app, region });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const bundle = await loadReleaseBundle(args.bundle);
  const result = await pinRegistryImages({ bundle, app: args.app, region: args.region });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "registry pinning failed";
    process.stderr.write(`Registry pinning failed: ${message}\n`);
    process.exitCode = 1;
  });
}
