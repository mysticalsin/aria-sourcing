#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  APP_BY_ROLE,
  FLY_PLAN_SCHEMA,
  RELEASE_DISABLED_ROLES,
  ROLE_ORDER,
  confirmationForPlan,
  createApproval,
  createPlan,
  digestJson,
  secretImportForRole,
  validateApproval,
  validateDeerFlowRuntimeHealth,
  validateFlySecretInventory,
  validateMachineInventory,
  validateManifest,
} from "./operator-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "../../..");
const RECEIPT_SCHEMA = "aria.agent-framework.fly-receipt.v1";
const HASH = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const REQUIRED_FLY_CHECKS = new Set(["flowise-db", "flowise-redis", "flowise-worker"]);
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 32 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  record(value, label);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has unexpected fields`);
  }
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail(`${label} did not return valid JSON`);
  }
}

async function readJsonFile(file, label, { privateFile = false } = {}) {
  const resolved = path.resolve(file);
  let handle;
  try {
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_JSON_BYTES) fail(`${label} file is invalid`);
    if (privateFile && (stat.mode & 0o077) !== 0) fail(`${label} file permissions must be 0600`);
    return parseJson(await handle.readFile("utf8"), label);
  } catch (error) {
    if (error instanceof Error && /(?:invalid|permissions|JSON)/.test(error.message)) throw error;
    fail(`${label} file could not be read safely`);
  } finally {
    await handle?.close();
  }
}

async function writeExclusiveJson(file, value) {
  const resolved = path.resolve(file);
  await mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(
      resolved,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if (error?.code === "EEXIST") fail("output file already exists");
    throw error;
  } finally {
    await handle?.close();
  }
  return resolved;
}

async function fileExists(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail("receipt path is unsafe");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function runCommand(command, args, {
  cwd = PROJECT_ROOT,
  stdin,
  timeoutMs = 120_000,
  maxBytes = MAX_JSON_BYTES,
  allowFailure = false,
} = {}) {
  if (typeof command !== "string" || !Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    fail("operator command is invalid");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let overflow = false;
    let timedOut = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", () => reject(new Error(`${command} could not be executed`)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${command} timed out`));
      if (overflow) return reject(new Error(`${command} output exceeded its bound`));
      const result = {
        code: Number.isInteger(code) ? code : 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (!allowFailure && result.code !== 0) return reject(new Error(`${command} failed closed`));
      resolve(result);
    });
    if (stdin === undefined) child.stdin.end();
    else child.stdin.end(stdin, "utf8");
  });
}

function jsonDocuments(output, label) {
  const trimmed = output.trim();
  if (!trimmed) fail(`${label} evidence is empty`);
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const documents = [];
    for (const line of trimmed.split(/\r?\n/).filter(Boolean)) documents.push(parseJson(line, label));
    return documents.flatMap((value) => Array.isArray(value) ? value : [value]);
  }
}

function attestationStatements(output, label) {
  const statements = [];
  for (const document of jsonDocuments(output, label)) {
    if (document && typeof document === "object" && typeof document.payload === "string") {
      if (!/^[A-Za-z0-9+/_=-]+$/.test(document.payload)) fail(`${label} payload is invalid`);
      const decoded = Buffer.from(document.payload, "base64").toString("utf8");
      statements.push(parseJson(decoded, `${label} payload`));
    } else if (document && typeof document === "object" && Array.isArray(document.subject)) {
      statements.push(document);
    }
  }
  if (statements.length < 1) fail(`${label} did not contain a signed statement`);
  return statements;
}

function statementBindsImage(statement, expectedDigest) {
  return Array.isArray(statement?.subject) && statement.subject.some((subject) =>
    subject && typeof subject === "object" && subject.digest?.sha256 === expectedDigest);
}

function containsExactString(value, expected, depth = 0) {
  if (depth > 30) return false;
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsExactString(item, expected, depth + 1));
  }
  return false;
}

function containsExactParameter(value, expectedKey, expectedValue, depth = 0) {
  if (depth > 30 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsExactParameter(item, expectedKey, expectedValue, depth + 1));
  }
  for (const [key, item] of Object.entries(value)) {
    if ((key === expectedKey || key === `build-arg:${expectedKey}`) && item === expectedValue) return true;
    if (containsExactParameter(item, expectedKey, expectedValue, depth + 1)) return true;
  }
  return false;
}

function validateAttestation(output, image, label, { sourceCommit, runtimeParameters } = {}) {
  const expectedDigest = image.split("@sha256:")[1];
  const statements = attestationStatements(output, label);
  const bound = statements.filter((statement) => statementBindsImage(statement, expectedDigest));
  if (bound.length < 1) fail(`${label} does not bind the reviewed image digest`);
  if (sourceCommit && !bound.some((statement) => containsExactString(statement.predicate, sourceCommit))) {
    fail(`${label} does not bind the reviewed source commit`);
  }
  if (runtimeParameters && !bound.some((statement) => {
    const roots = [
      statement.predicate?.invocation?.parameters,
      statement.predicate?.buildDefinition?.externalParameters,
    ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
    return roots.some((root) => Object.entries(runtimeParameters).every(([key, value]) =>
      containsExactParameter(root, key, value)));
  })) {
    fail(`${label} does not bind the audited DeerFlow runtime provenance`);
  }
}

function validateVulnerabilityScan(output) {
  const scan = parseJson(output, "Trivy scan");
  record(scan, "Trivy scan");
  if (scan.Results !== null && !Array.isArray(scan.Results)) fail("Trivy scan results are invalid");
  let blocked = 0;
  for (const result of scan.Results ?? []) {
    if (result?.Vulnerabilities !== null && result?.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) {
      fail("Trivy vulnerability results are invalid");
    }
    for (const vulnerability of result?.Vulnerabilities ?? []) {
      if (new Set(["HIGH", "CRITICAL"]).has(vulnerability?.Severity)) blocked += 1;
    }
  }
  if (blocked > 0) fail(`Trivy blocked ${blocked} high or critical vulnerabilities`);
}

export async function verifySupplyChainForImage(role, image, runner = runCommand, deerflowRuntime) {
  const identityArguments = [
    "--certificate-identity", image.certificateIdentity,
    "--certificate-oidc-issuer", image.certificateIssuer,
  ];
  const signature = await runner("cosign", ["verify", ...identityArguments, "--output", "json", image.ref], {
    maxBytes: MAX_EVIDENCE_BYTES,
  });
  jsonDocuments(signature.stdout, `${role} signature`);

  const sbom = await runner("cosign", [
    "verify-attestation", ...identityArguments, "--type", "spdxjson", "--output", "json", image.ref,
  ], { maxBytes: MAX_EVIDENCE_BYTES });
  validateAttestation(sbom.stdout, image.ref, `${role} SBOM`);

  const provenance = await runner("cosign", [
    "verify-attestation", ...identityArguments, "--type", "slsaprovenance", "--output", "json", image.ref,
  ], { maxBytes: MAX_EVIDENCE_BYTES });
  const runtimeParameters = role === "deerflow" ? {
    DEERFLOW_PATCHED_RUNS_SHA256: deerflowRuntime?.patchedRunsSha256,
    DEERFLOW_CLEANUP_GUARD_SHA256: deerflowRuntime?.cleanupGuardSha256,
    DEERFLOW_RUNTIME_POLICY_SHA256: deerflowRuntime?.runtimePolicySha256,
    DEERFLOW_RUNTIME_CONFIG_SHA256: deerflowRuntime?.runtimeConfigSha256,
    DEERFLOW_DATABASE_BACKEND: deerflowRuntime?.databaseBackend,
    DEERFLOW_RUN_EVENTS_BACKEND: deerflowRuntime?.runEventsBackend,
    DEERFLOW_STREAM_BRIDGE_TYPE: deerflowRuntime?.streamBridgeType,
  } : undefined;
  if (runtimeParameters && Object.values(runtimeParameters).some((value) => typeof value !== "string" || !value)) {
    fail("DeerFlow runtime provenance identity is incomplete");
  }
  validateAttestation(provenance.stdout, image.ref, `${role} provenance`, {
    sourceCommit: image.sourceCommit,
    runtimeParameters,
  });

  const scan = await runner("trivy", [
    "image", "--quiet", "--exit-code", "0", "--severity", "HIGH,CRITICAL", "--format", "json", image.ref,
  ], { timeoutMs: 10 * 60_000, maxBytes: MAX_EVIDENCE_BYTES });
  validateVulnerabilityScan(scan.stdout);

  return Object.freeze({
    signatureSha256: hashText(signature.stdout),
    sbomSha256: hashText(sbom.stdout),
    provenanceSha256: hashText(provenance.stdout),
    vulnerabilityScanSha256: hashText(scan.stdout),
  });
}

function flyToken(environment = process.env) {
  const value = environment.FLY_API_TOKEN;
  if (typeof value !== "string" || value.length < 20 || value.length > 4096 || /\s|\0/.test(value)) {
    fail("FLY_API_TOKEN is missing or invalid");
  }
  return value;
}

async function boundedResponseText(response, maximum = MAX_JSON_BYTES) {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maximum) fail("Fly API response exceeded its bound");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximum) {
      await reader.cancel();
      fail("Fly API response exceeded its bound");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((value) => Buffer.from(value))).toString("utf8");
}

async function machinesApi(pathname, {
  method = "GET",
  body,
  expectedStatuses = [200],
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const url = new URL(pathname, "https://api.machines.dev");
  if (url.origin !== "https://api.machines.dev" || !url.pathname.startsWith("/v1/")) fail("Fly API path is invalid");
  const response = await fetchImpl(url, {
    method,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${flyToken(environment)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await boundedResponseText(response);
  if (!expectedStatuses.includes(response.status)) fail("Fly API request failed closed");
  return text.trim() ? parseJson(text, "Fly API") : null;
}

async function organizationApps(organization, options = {}) {
  const response = record(await machinesApi(`/v1/apps?org_slug=${encodeURIComponent(organization)}`, options), "Fly app inventory");
  if (!Array.isArray(response.apps)) fail("Fly app inventory is invalid");
  const apps = new Map();
  for (const item of response.apps) {
    if (!item || typeof item.name !== "string" || typeof item.network !== "string" || apps.has(item.name)) {
      fail("Fly app inventory is invalid");
    }
    apps.set(item.name, Object.freeze({ name: item.name, network: item.network }));
  }
  return apps;
}

async function machineInventory(app, options = {}) {
  const result = await machinesApi(`/v1/apps/${encodeURIComponent(app)}/machines`, options);
  if (!Array.isArray(result)) fail("Fly machine inventory is invalid");
  return result;
}

function imageReference(machine) {
  const image = machine?.config?.image ?? machine?.image_ref;
  if (typeof image === "string") return image;
  if (image && typeof image.registry === "string" && typeof image.repository === "string" && typeof image.digest === "string") {
    return `${image.registry}/${image.repository}@${image.digest}`;
  }
  return null;
}

function sanitizePriorMachines(value) {
  return value.map((machine) => {
    if (!SAFE_ID.test(machine?.id ?? "") || typeof machine?.state !== "string") fail("prior Fly machine state is invalid");
    const image = imageReference(machine);
    return Object.freeze({ id: machine.id, state: machine.state, image: typeof image === "string" ? image : null });
  });
}

async function publicIpInventory(app, runner = runCommand) {
  const result = await runner("flyctl", ["ips", "list", "--app", app, "--json"]);
  const inventory = parseJson(result.stdout, `${app} IP inventory`);
  if (!Array.isArray(inventory)) fail(`${app} IP inventory is invalid`);
  if (inventory.length > 0) fail(`${app} has an allocated Fly Proxy IP`);
  return inventory;
}

async function validateCurrentSecretInventory(role, app, manifest, runner, options) {
  const result = await runner("flyctl", ["secrets", "list", "--app", app, "--json"]);
  const parsed = parseJson(result.stdout, `${app} Fly secret inventory`);
  const nestedInventory = parsed && typeof parsed === "object" ? parsed.secrets ?? parsed.Secrets : null;
  const inventory = Array.isArray(parsed)
    ? parsed
    : Array.isArray(nestedInventory)
      ? nestedInventory
      : null;
  if (!inventory) fail(`${app} Fly secret inventory is invalid`);
  return validateFlySecretInventory(role, manifest, inventory, options);
}

async function validateFlyConfigs(runner = runCommand) {
  const digests = {};
  for (const role of ROLE_ORDER) {
    const config = path.join(HERE, `${role}.toml`);
    await runner("flyctl", ["config", "validate", "--config", config]);
    digests[role] = hashText(await readFile(config));
  }
  return Object.freeze(digests);
}

function assertPlanMatchesManifest(plan, manifest, { requireFresh = false, now = new Date() } = {}) {
  exactKeys(plan, [
    "schema", "deploymentId", "manifestSha256", "sourceReleaseSha", "organization", "network", "region",
    "createdAt", "expiresAt", "applications",
  ], "plan");
  if (
    plan.schema !== FLY_PLAN_SCHEMA || plan.deploymentId !== manifest.deploymentId ||
    plan.manifestSha256 !== manifest.sha256 || plan.sourceReleaseSha !== manifest.sourceReleaseSha ||
    plan.organization !== manifest.organization || plan.network !== manifest.network || plan.region !== manifest.region
  ) fail("plan does not bind the manifest");
  const createdAt = new Date(plan.createdAt);
  const expiresAt = new Date(plan.expiresAt);
  if (!Number.isFinite(createdAt.valueOf()) || expiresAt.valueOf() - createdAt.valueOf() !== 15 * 60_000) {
    fail("plan validity window is invalid");
  }
  if (requireFresh && (now.valueOf() < createdAt.valueOf() || now.valueOf() > expiresAt.valueOf())) fail("plan has expired");
  record(plan.applications, "plan applications");
  if (JSON.stringify(Object.keys(plan.applications).sort()) !== JSON.stringify([...ROLE_ORDER].sort())) {
    fail("plan applications are incomplete");
  }
  for (const role of ROLE_ORDER) {
    const application = plan.applications[role];
    exactKeys(application, ["app", "config", "releaseDisabled", "configSha256", "image", "sourceCommit", "supplyChain", "priorState"], `${role} plan`);
    if (
      application.app !== APP_BY_ROLE[role] || application.config !== `${role}.toml` ||
      application.releaseDisabled !== RELEASE_DISABLED_ROLES.includes(role) ||
      !HASH.test(application.configSha256) || application.image !== manifest.images[role].ref ||
      application.sourceCommit !== manifest.images[role].sourceCommit
    ) fail(`${role} plan binding is invalid`);
    exactKeys(application.supplyChain, [
      "signatureSha256", "sbomSha256", "provenanceSha256", "vulnerabilityScanSha256",
    ], `${role} supply-chain plan`);
    if (!Object.values(application.supplyChain).every((value) => HASH.test(value))) fail(`${role} evidence identity is invalid`);
  }
  return plan;
}

async function assertCurrentConfigIdentities(plan) {
  for (const role of ROLE_ORDER) {
    const config = path.join(HERE, `${role}.toml`);
    if (hashText(await readFile(config)) !== plan.applications[role].configSha256) {
      fail(`${role} Fly config changed after approval`);
    }
  }
}

export async function prepareDeployment({ manifestFile, planFile }, dependencies = {}) {
  const runner = dependencies.runner ?? runCommand;
  const apiOptions = dependencies.apiOptions ?? {};
  const manifest = validateManifest(await readJsonFile(manifestFile, "manifest"));
  flyToken();
  const configSha256ByRole = await validateFlyConfigs(runner);
  const supplyChainEvidence = {};
  for (const role of ROLE_ORDER) {
    supplyChainEvidence[role] = await verifySupplyChainForImage(
      role,
      manifest.images[role],
      runner,
      role === "deerflow" ? manifest.deerflowRuntime : undefined,
    );
  }
  const apps = await organizationApps(manifest.organization, apiOptions);
  const priorState = {};
  for (const role of ROLE_ORDER) {
    const app = APP_BY_ROLE[role];
    const existing = apps.get(app);
    if (!existing) {
      priorState[role] = null;
      continue;
    }
    if (existing.network !== manifest.network) fail(`${app} is attached to an unreviewed Fly network`);
    await publicIpInventory(app, runner);
    await validateCurrentSecretInventory(role, app, manifest, runner, { requireComplete: false });
    const machines = await machineInventory(app, apiOptions);
    if (RELEASE_DISABLED_ROLES.includes(role) && machines.length > 0) {
      fail(`${app} is release-disabled but still has Fly machines`);
    }
    priorState[role] = Object.freeze({
      exists: true,
      network: existing.network,
      machines: sanitizePriorMachines(machines),
    });
  }
  const plan = createPlan(manifest, {
    supplyChainEvidence,
    priorState,
    configSha256ByRole,
  });
  const resolved = await writeExclusiveJson(planFile, plan);
  return Object.freeze({ plan: resolved, confirmation: confirmationForPlan(plan) });
}

export async function confirmDeployment({ manifestFile, planFile, approvalFile, confirmation }, now = new Date()) {
  const manifest = validateManifest(await readJsonFile(manifestFile, "manifest"));
  const plan = assertPlanMatchesManifest(await readJsonFile(planFile, "plan", { privateFile: true }), manifest, {
    requireFresh: true,
    now,
  });
  const approval = createApproval(plan, confirmation, now);
  const resolved = await writeExclusiveJson(approvalFile, approval);
  return Object.freeze({ approval: resolved, planSha256: approval.planSha256 });
}

async function ensureApplication(role, manifest, options = {}) {
  const app = APP_BY_ROLE[role];
  let apps = await organizationApps(manifest.organization, options);
  if (!apps.has(app)) {
    await machinesApi("/v1/apps", {
      ...options,
      method: "POST",
      body: { app_name: app, org_slug: manifest.organization },
      expectedStatuses: [200, 201, 409],
    });
    apps = await organizationApps(manifest.organization, options);
  }
  const current = apps.get(app);
  if (!current || current.network !== "default") fail(`${app} does not belong to the reviewed default 6PN`);
  return current;
}

export function deploymentArguments(role, plan) {
  const application = plan.applications[role];
  return [
    PROJECT_ROOT,
    "--app", application.app,
    "--config", path.join(HERE, application.config),
    "--image", application.image,
    "--no-public-ips",
    "--ha=false",
    "--strategy", "rolling",
    "--wait-timeout", "10m",
    "--yes",
  ];
}

function listFromFlyJson(output, label) {
  const value = parseJson(output, label);
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["checks", "Checks"]) if (Array.isArray(value[key])) return value[key];
  }
  fail(`${label} is invalid`);
}

async function validateFlyChecks(role, app, runner) {
  const result = await runner("flyctl", ["checks", "list", "--app", app, "--json"]);
  const checks = listFromFlyJson(result.stdout, `${app} health checks`);
  if (REQUIRED_FLY_CHECKS.has(role) && checks.length < 1) fail(`${app} has no platform health check result`);
  for (const check of checks) {
    const status = String(check?.status ?? check?.Status ?? "").toLowerCase();
    if (!new Set(["passing", "pass"]).has(status)) fail(`${app} has a failing platform health check`);
  }
}

function privateHealthCommand(role) {
  if (role === "flowise-db") {
    return `sh -lc 'export PGPASSWORD="$(tr -d "\\r\\n" < /run/secrets/db_password)"; test "$(psql -h "$FLY_PRIVATE_IP" -U flowise -d flowise -Atqc "SELECT 1")" = "1"; printf "%s\\n" "{\\"mode\\":\\"postgres\\",\\"status\\":\\"ready\\"}"'`;
  }
  if (role === "flowise-redis") {
    return "sh -lc 'export REDISCLI_AUTH=\"$(tr -d \"\\r\\n\" < /run/secrets/redis_password)\"; test \"$(redis-cli -h \"$FLY_PRIVATE_IP\" -p 6379 --no-auth-warning ping)\" = \"PONG\"; printf \"%s\\n\" \"{\\\"mode\\\":\\\"redis\\\",\\\"status\\\":\\\"ready\\\"}\"'";
  }
  if (role === "deerflow") return "python /opt/aria/private-probe.py deerflow";
  if (role === "model-gateway") return "node /opt/aria/identity-probe.mjs model-gateway";
  if (role === "flowise") return "node /opt/aria/identity-probe.mjs flowise";
  if (role === "flowise-worker") return "node /opt/aria/identity-probe.mjs flowise-worker";
  return "node /opt/aria/identity-probe.mjs adapter";
}

async function privateHealth(role, app, machineId, manifest, runner) {
  const result = await runner("flyctl", [
    "ssh", "console", "--app", app, "--machine", machineId, "--quiet", "--pty=false",
    "--command", privateHealthCommand(role),
  ], { timeoutMs: 60_000 });
  const health = record(parseJson(result.stdout.trim(), `${app} private readiness`), `${app} private readiness`);
  if (health.status !== "ready") fail(`${app} private readiness failed`);
  if (role === "deerflow") validateDeerFlowRuntimeHealth(health, manifest);
  if (role === "model-gateway" && (health.provider !== manifest.model.providerId || health.model !== manifest.model.modelId)) {
    fail(`${app} model identity does not match the manifest`);
  }
  if (role.endsWith("-adapter")) {
    const framework = role.startsWith("deerflow") ? "deerflow" : "flowise";
    if (
      health.framework !== framework || health.sourceCommit !== manifest.images[framework].sourceCommit ||
      health.imageDigest !== manifest.images[framework].ref || health.configurationSha256 !== manifest.configurationSha256 ||
      health.workspaceId !== manifest.workspaceId || health.frameworkInstanceId !== manifest.frameworkInstances[framework]
    ) fail(`${app} runtime identity does not match the manifest`);
  }
  return Object.freeze({ ...health, checkedAt: new Date().toISOString() });
}

async function verifyApplication(role, manifest, plan, runner, apiOptions) {
  const app = APP_BY_ROLE[role];
  const apps = await organizationApps(manifest.organization, apiOptions);
  if (apps.get(app)?.network !== "default") fail(`${app} network identity changed`);
  await publicIpInventory(app, runner);
  await validateCurrentSecretInventory(role, app, manifest, runner);
  const machine = validateMachineInventory(role, plan.applications[role].image, await machineInventory(app, apiOptions));
  await validateFlyChecks(role, app, runner);
  const health = await privateHealth(role, app, machine.machineId, manifest, runner);
  return Object.freeze({
    app,
    network: "default",
    noFlyProxyIps: true,
    machineId: machine.machineId,
    imageDigest: machine.imageDigest,
    health,
  });
}

async function verifyReleaseDisabledApplication(role, manifest, plan, runner, apiOptions) {
  const app = APP_BY_ROLE[role];
  const apps = await organizationApps(manifest.organization, apiOptions);
  const existing = apps.get(app);
  if (existing) {
    if (existing.network !== "default") fail(`${app} network identity changed`);
    await publicIpInventory(app, runner);
    await validateCurrentSecretInventory(role, app, manifest, runner);
    if ((await machineInventory(app, apiOptions)).length > 0) {
      fail(`${app} is release-disabled but still has Fly machines`);
    }
  }
  return Object.freeze({
    app,
    network: existing?.network ?? "default",
    noFlyProxyIps: true,
    machineId: null,
    imageDigest: plan.applications[role].image,
    health: Object.freeze({ status: "release-disabled" }),
  });
}

function receiptPath(receiptDirectory, plan) {
  return path.resolve(receiptDirectory, `${plan.deploymentId}-${confirmationForPlan(plan)}.json`);
}

function validateReceipt(receipt, manifest, plan) {
  exactKeys(receipt, [
    "schema", "deploymentId", "planSha256", "manifestSha256", "sourceReleaseSha", "organization", "network",
    "completedAt", "applications",
  ], "receipt");
  if (
    receipt.schema !== RECEIPT_SCHEMA || receipt.deploymentId !== plan.deploymentId ||
    receipt.planSha256 !== confirmationForPlan(plan) || receipt.manifestSha256 !== manifest.sha256 ||
    receipt.sourceReleaseSha !== manifest.sourceReleaseSha || receipt.organization !== manifest.organization ||
    receipt.network !== "default" || !Number.isFinite(new Date(receipt.completedAt).valueOf())
  ) fail("receipt does not bind the approved deployment");
  record(receipt.applications, "receipt applications");
  if (JSON.stringify(Object.keys(receipt.applications).sort()) !== JSON.stringify([...ROLE_ORDER].sort())) {
    fail("receipt applications are incomplete");
  }
  for (const role of ROLE_ORDER) {
    if (
      receipt.applications[role]?.app !== APP_BY_ROLE[role] ||
      receipt.applications[role]?.imageDigest !== plan.applications[role].image
    ) fail(`${role} receipt identity is invalid`);
  }
  return receipt;
}

export async function deployApproved({ manifestFile, planFile, approvalFile, receiptDirectory, execute }, dependencies = {}) {
  if (execute !== true) fail("deploy requires the explicit --execute gate");
  const runner = dependencies.runner ?? runCommand;
  const apiOptions = dependencies.apiOptions ?? {};
  const manifest = validateManifest(await readJsonFile(manifestFile, "manifest"));
  const plan = assertPlanMatchesManifest(await readJsonFile(planFile, "plan", { privateFile: true }), manifest);
  const approval = validateApproval(plan, await readJsonFile(approvalFile, "approval", { privateFile: true }));
  const approvedAt = new Date(approval.approvedAt).valueOf();
  if (approvedAt < new Date(plan.createdAt).valueOf() || approvedAt > new Date(plan.expiresAt).valueOf()) {
    fail("approval time is outside the plan validity window");
  }
  await assertCurrentConfigIdentities(plan);
  flyToken();

  const output = receiptPath(receiptDirectory, plan);
  if (await fileExists(output)) {
    validateReceipt(await readJsonFile(output, "receipt", { privateFile: true }), manifest, plan);
    const applications = {};
    for (const role of ROLE_ORDER) {
      applications[role] = RELEASE_DISABLED_ROLES.includes(role)
        ? await verifyReleaseDisabledApplication(role, manifest, plan, runner, apiOptions)
        : await verifyApplication(role, manifest, plan, runner, apiOptions);
    }
    return Object.freeze({ receipt: output, planSha256: confirmationForPlan(plan), replay: true, applications });
  }

  assertPlanMatchesManifest(plan, manifest, { requireFresh: true });
  const applications = {};
  for (const role of ROLE_ORDER) {
    if (RELEASE_DISABLED_ROLES.includes(role)) {
      applications[role] = await verifyReleaseDisabledApplication(role, manifest, plan, runner, apiOptions);
      continue;
    }
    await ensureApplication(role, manifest, apiOptions);
    await publicIpInventory(APP_BY_ROLE[role], runner);
    await validateCurrentSecretInventory(role, APP_BY_ROLE[role], manifest, runner, { requireComplete: false });
    const secretInput = await secretImportForRole(role, manifest);
    await runner("flyctl", ["secrets", "import", "--stage", "--app", APP_BY_ROLE[role]], { stdin: secretInput });
    await validateCurrentSecretInventory(role, APP_BY_ROLE[role], manifest, runner);
    await runner("flyctl", ["deploy", ...deploymentArguments(role, plan)], { timeoutMs: 12 * 60_000, maxBytes: 16 * 1024 * 1024 });
    applications[role] = await verifyApplication(role, manifest, plan, runner, apiOptions);
  }

  const receipt = Object.freeze({
    schema: RECEIPT_SCHEMA,
    deploymentId: plan.deploymentId,
    planSha256: confirmationForPlan(plan),
    manifestSha256: manifest.sha256,
    sourceReleaseSha: manifest.sourceReleaseSha,
    organization: manifest.organization,
    network: "default",
    completedAt: new Date().toISOString(),
    applications: Object.freeze(applications),
  });
  await writeExclusiveJson(output, receipt);
  return Object.freeze({ receipt: output, planSha256: receipt.planSha256, replay: false, applications });
}

function parseArguments(argv) {
  const command = argv[2];
  const allowed = {
    prepare: new Set(["manifest", "plan"]),
    confirm: new Set(["manifest", "plan", "confirmation", "approval"]),
    deploy: new Set(["manifest", "plan", "approval", "receipt-dir", "execute"]),
  }[command];
  if (!allowed) fail("usage: operator.mjs prepare|confirm|deploy [options]");
  const values = {};
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail("operator option is invalid");
    const name = token.slice(2);
    if (!allowed.has(name) || Object.hasOwn(values, name)) fail("operator option is invalid");
    if (name === "execute") {
      values.execute = true;
      continue;
    }
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--") || /[\r\n\0]/.test(value)) fail("operator option value is invalid");
    values[name] = value;
    index += 1;
  }
  for (const name of allowed) if (!Object.hasOwn(values, name)) fail(`--${name} is required`);
  return { command, values };
}

async function main() {
  const { command, values } = parseArguments(process.argv);
  if (command === "prepare") {
    return prepareDeployment({ manifestFile: values.manifest, planFile: values.plan });
  }
  if (command === "confirm") {
    return confirmDeployment({
      manifestFile: values.manifest,
      planFile: values.plan,
      approvalFile: values.approval,
      confirmation: values.confirmation,
    });
  }
  return deployApproved({
    manifestFile: values.manifest,
    planFile: values.plan,
    approvalFile: values.approval,
    receiptDirectory: values["receipt-dir"],
    execute: values.execute,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await main();
    const publicResult = {
      ...(result.plan ? { plan: result.plan, confirmation: result.confirmation } : {}),
      ...(result.approval ? { approval: result.approval, planSha256: result.planSha256 } : {}),
      ...(result.receipt ? { receipt: result.receipt, planSha256: result.planSha256, replay: result.replay } : {}),
    };
    process.stdout.write(`${JSON.stringify(publicResult)}\n`);
  } catch (error) {
    process.stderr.write(`Fly framework operator failed closed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
