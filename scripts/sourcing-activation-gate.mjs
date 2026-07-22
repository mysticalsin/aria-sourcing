import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { SOURCING_LOOP_HANDLER_CONTRACT_SHA256 } from "./sourcing-loop-worker.mjs";

const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MACHINE_ID_RE = /^[0-9a-f]{14}$/;
const TARGET_GROUPS = new Set(["web", "loop"]);
const MAX_JSON_BYTES = 512_000;
const MAX_RECEIPT_BYTES = 32_000;
const SHARED_THROTTLE_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const SHARED_THROTTLE_SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/;
const DIRECT_FLY_ORIGIN = "https://aria-mantu-app.fly.dev";
const OPERATIONAL_ENV = Object.freeze({
  ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "false",
  ARIA_LOOP_KILL_SWITCH: "false",
  ARIA_SOURCING_OPERATIONAL_REQUIRED: "true",
  ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "true",
});
const DARK_ENV = Object.freeze({
  ARIA_LOOP_ENABLE_OUTBOUND_DRAIN: "false",
  ARIA_LOOP_KILL_SWITCH: "true",
  ARIA_SOURCING_OPERATIONAL_REQUIRED: "false",
  ARIA_NEED_INGRESS_SHARED_THROTTLE_VERIFIED: "false",
  ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256: "",
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).sort().join("\n") === [...expected].sort().join("\n");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedJsonFile(file, maximum = MAX_JSON_BYTES) {
  const bytes = readFileSync(file);
  if (bytes.byteLength < 2 || bytes.byteLength > maximum) {
    throw new Error(`JSON file is empty or oversized: ${path.basename(file)}`);
  }
  const value = JSON.parse(bytes.toString("utf8"));
  return { bytes, value };
}

function writeJsonFile(file, value, maximum = MAX_JSON_BYTES) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > maximum) {
    throw new Error(`JSON output is oversized: ${path.basename(file)}`);
  }
  writeFileSync(file, body, { mode: 0o600 });
}

function clone(value) {
  return structuredClone(value);
}

function imageDigest(image) {
  if (typeof image !== "string") return null;
  const marker = image.lastIndexOf("@");
  const digest = marker < 0 ? image : image.slice(marker + 1);
  return DIGEST_RE.test(digest) ? digest : null;
}

function machineImageDigest(machine) {
  const configDigest = imageDigest(machine?.config?.image);
  const refDigest = imageDigest(machine?.image_ref);
  if (configDigest && refDigest && configDigest !== refDigest) return null;
  return configDigest ?? refDigest;
}

function normalizedMachineConfig(machine) {
  if (!isRecord(machine?.config)) throw new Error("target Machine config is absent");
  const config = clone(machine.config);
  if (typeof config.image !== "string" && typeof machine.image_ref === "string") {
    config.image = machine.image_ref;
  }
  if (!imageDigest(config.image)) throw new Error("target Machine image is not digest pinned");
  if (!isRecord(config.env)) config.env = {};
  return config;
}

function machineGroup(machine) {
  const group = machine?.config?.metadata?.fly_process_group;
  return typeof group === "string" ? group : "";
}

function modeEnvironment(mode, sharedThrottleEvidenceSha256 = "") {
  if (mode === "dark") return DARK_ENV;
  if (!SHA256_RE.test(sharedThrottleEvidenceSha256)) {
    throw new Error("shared need ingress throttle evidence is invalid");
  }
  return {
    ...OPERATIONAL_ENV,
    ARIA_NEED_INGRESS_SHARED_THROTTLE_EVIDENCE_SHA256: sharedThrottleEvidenceSha256,
  };
}

function setMode(config, mode, sharedThrottleEvidenceSha256 = "") {
  const next = clone(config);
  if (!isRecord(next.env)) next.env = {};
  Object.assign(next.env, modeEnvironment(mode, sharedThrottleEvidenceSha256));
  return next;
}

function configSha256(config) {
  return sha256(stableJson(config));
}

function validateAcceptedReleaseReceipt(receipt, releaseSha) {
  if (
    !isRecord(receipt)
    || receipt.schemaVersion !== 2
    || receipt.status !== "accepted"
    || receipt.releaseSha !== releaseSha
    || !isRecord(receipt.images)
    || !DIGEST_RE.test(receipt.images.app ?? "")
    || !isRecord(receipt.migration)
    || !/^0[0-9]{3}_[A-Za-z0-9_]+\.sql$/.test(receipt.migration.filename ?? "")
    || !SHA256_RE.test(receipt.migration.sha256 ?? "")
    || !Number.isSafeInteger(receipt.migration.count)
    || receipt.migration.count < 1
    || !SHA256_RE.test(receipt.migration.ledgerSha256 ?? "")
  ) {
    throw new Error("accepted release receipt is invalid or release-mismatched");
  }
  return receipt.images.app;
}

function validHttpsOrigin(value) {
  if (typeof value !== "string" || value.length > 256) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.origin === value
      && url.username === ""
      && url.password === ""
      && url.pathname === "/"
      && url.search === ""
      && url.hash === "";
  } catch {
    return false;
  }
}

function validateSharedThrottleEvidence({
  evidence,
  evidenceKey,
  releaseSha,
  imageDigest: expectedDigest,
  inventory,
  now = Date.now(),
}) {
  const fail = () => { throw new Error("shared need ingress throttle evidence is invalid"); };
  if (
    !SHARED_THROTTLE_KEY_RE.test(evidenceKey ?? "")
    || Buffer.from(evidenceKey, "base64url").byteLength !== 32
    || !exactKeys(evidence, new Set([
      "app", "assertions", "expiresAt", "imageDigest", "origins", "policy",
      "releaseSha", "route", "schemaVersion", "signature", "status", "testedAt",
      "webMachineIds",
    ]))
  ) fail();

  const signatureMatch = SHARED_THROTTLE_SIGNATURE_RE.exec(evidence.signature ?? "");
  if (!signatureMatch) fail();
  const unsigned = clone(evidence);
  delete unsigned.signature;
  const expectedSignature = createHmac("sha256", Buffer.from(evidenceKey, "base64url"))
    .update(stableJson(unsigned), "utf8")
    .digest();
  const presentedSignature = Buffer.from(signatureMatch[1], "hex");
  if (
    expectedSignature.byteLength !== presentedSignature.byteLength
    || !timingSafeEqual(expectedSignature, presentedSignature)
  ) fail();

  const testedAt = Date.parse(evidence.testedAt ?? "");
  const expiresAt = Date.parse(evidence.expiresAt ?? "");
  const origins = evidence.origins;
  const webMachineIds = evidence.webMachineIds;
  const activeWebMachineIds = inventory.targets
    .filter(({ group, machine }) => group === "web" && machine.state === "started")
    .map(({ machine }) => machine.id)
    .sort();
  if (
    evidence.schemaVersion !== 1
    || evidence.status !== "passed"
    || evidence.app !== "aria-mantu-app"
    || evidence.releaseSha !== releaseSha
    || evidence.imageDigest !== expectedDigest
    || evidence.route !== "/api/webhooks/needs"
    || !Array.isArray(origins)
    || origins.length < 1
    || origins.length > 16
    || origins.some((origin) => !validHttpsOrigin(origin))
    || stableJson(origins) !== stableJson([...new Set(origins)].sort())
    || !origins.includes(DIRECT_FLY_ORIGIN)
    || !Array.isArray(webMachineIds)
    || webMachineIds.length < 2
    || webMachineIds.length > 32
    || webMachineIds.some((id) => !MACHINE_ID_RE.test(id))
    || stableJson(webMachineIds) !== stableJson(activeWebMachineIds)
    || !exactKeys(evidence.policy, new Set([
      "policyIdSha256", "provider", "requestLimit", "revisionSha256", "windowSeconds",
    ]))
    || !/^[a-z][a-z0-9._-]{1,63}$/.test(evidence.policy.provider ?? "")
    || !SHA256_RE.test(evidence.policy.policyIdSha256 ?? "")
    || !SHA256_RE.test(evidence.policy.revisionSha256 ?? "")
    || !Number.isSafeInteger(evidence.policy.requestLimit)
    || evidence.policy.requestLimit < 1
    || evidence.policy.requestLimit > 20
    || !Number.isSafeInteger(evidence.policy.windowSeconds)
    || evidence.policy.windowSeconds < 60
    || evidence.policy.windowSeconds > 3_600
    || !exactKeys(evidence.assertions, new Set([
      "blockedInventedKeyDatabaseWrites", "blockedInventedKeyOriginRequests",
      "combinedBurstAcrossMachines", "directFlyOriginCovered", "distinctWebMachinesObserved",
      "everyPublicOriginCovered", "noStore", "positiveRetryAfter", "returns429",
      "signedBelowLimitAccepted", "trustedIdentityBucket",
    ]))
    || evidence.assertions.everyPublicOriginCovered !== true
    || evidence.assertions.directFlyOriginCovered !== true
    || evidence.assertions.trustedIdentityBucket !== true
    || evidence.assertions.combinedBurstAcrossMachines !== true
    || !Number.isSafeInteger(evidence.assertions.distinctWebMachinesObserved)
    || evidence.assertions.distinctWebMachinesObserved < 2
    || evidence.assertions.distinctWebMachinesObserved > activeWebMachineIds.length
    || evidence.assertions.returns429 !== true
    || evidence.assertions.positiveRetryAfter !== true
    || evidence.assertions.noStore !== true
    || evidence.assertions.signedBelowLimitAccepted !== true
    || evidence.assertions.blockedInventedKeyOriginRequests !== 0
    || evidence.assertions.blockedInventedKeyDatabaseWrites !== 0
    || !Number.isFinite(now)
    || !Number.isFinite(testedAt)
    || !Number.isFinite(expiresAt)
    || evidence.testedAt !== new Date(testedAt).toISOString()
    || evidence.expiresAt !== new Date(expiresAt).toISOString()
    || testedAt > now + 5 * 60_000
    || testedAt < now - 24 * 60 * 60_000
    || expiresAt <= now
    || expiresAt > testedAt + 24 * 60 * 60_000
  ) fail();

  return {
    sha256: sha256(stableJson(evidence)),
    expiresAt: evidence.expiresAt,
    policyIdSha256: evidence.policy.policyIdSha256,
    policyRevisionSha256: evidence.policy.revisionSha256,
  };
}

function validateMachineInventory(machines, releaseSha, expectedDigest, expectedIds = null) {
  if (!Array.isArray(machines) || machines.length < 4) {
    throw new Error("Fly Machine inventory is incomplete");
  }
  const seen = new Set();
  const targets = [];
  for (const machine of machines) {
    if (!isRecord(machine) || !MACHINE_ID_RE.test(machine.id ?? "") || seen.has(machine.id)) {
      throw new Error("Fly Machine inventory contains an invalid or duplicate id");
    }
    seen.add(machine.id);
    const group = machineGroup(machine);
    if (!group) throw new Error("Fly Machine process group is absent");
    if (!new Set(["web", "cleanup", "framework_heartbeat", "loop"]).has(group)) {
      throw new Error("Fly Machine inventory contains an unexpected process group");
    }
    if (machineImageDigest(machine) !== expectedDigest) {
      throw new Error(`${group} Machine image digest does not match the accepted release`);
    }
    if (machine.state !== "started" && machine.state !== "stopped") {
      throw new Error(`${group} Machine is not in a stable state`);
    }
    if (TARGET_GROUPS.has(group)) {
      const config = normalizedMachineConfig(machine);
      if (config.env.ARIA_RELEASE_SHA !== releaseSha) {
        throw new Error(`${group} Machine release identity does not match the accepted release`);
      }
      targets.push({ machine, group, config });
    }
  }

  const web = targets.filter(({ group }) => group === "web");
  const loop = targets.filter(({ group }) => group === "loop");
  if (
    web.length < 1
    || web.length > 32
    || web.filter(({ machine }) => machine.state === "started").length < 1
  ) {
    throw new Error("activation requires one to 32 web Machines with at least one started");
  }
  const activeLoop = loop.filter(({ machine }) => machine.state === "started");
  const standbyLoop = loop.filter(({ machine }) =>
    machine.state === "stopped"
    && Array.isArray(machine.config?.standbys)
    && machine.config.standbys.length === 1
    && machine.config.standbys[0] === activeLoop[0]?.machine.id,
  );
  if (loop.length !== 2 || activeLoop.length !== 1 || standbyLoop.length !== 1) {
    throw new Error("activation requires one started loop Machine and its exact stopped standby");
  }
  if (expectedIds) {
    const actual = targets.map(({ machine }) => machine.id).sort();
    const expected = [...expectedIds].sort();
    if (stableJson(actual) !== stableJson(expected)) {
      throw new Error("web or loop Machine identity changed after activation preflight");
    }
  }
  return { targets, activeLoopId: activeLoop[0].machine.id };
}

function validateMode(config, mode, sharedThrottleEvidenceSha256 = "") {
  let expected;
  try {
    expected = modeEnvironment(mode, sharedThrottleEvidenceSha256);
  } catch {
    return false;
  }
  return Object.entries(expected).every(([key, value]) => config.env?.[key] === value);
}

function validateReleaseEnvironment(config, releaseSha, migration) {
  return Boolean(
    config.env?.ARIA_RELEASE_SHA === releaseSha
    && config.env?.ARIA_EXPECTED_MIGRATION === migration.filename
    && config.env?.ARIA_EXPECTED_MIGRATION_SHA === migration.sha256
    && config.env?.ARIA_EXPECTED_MIGRATION_COUNT === String(migration.count)
    && config.env?.ARIA_EXPECTED_LEDGER_SHA === migration.ledgerSha256
  );
}

function makePlan(machines, state, mode, configDirectory) {
  const inventory = validateMachineInventory(
    machines,
    state.releaseSha,
    state.imageDigest,
    state.targets.map((target) => target.id),
  );
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  const targets = inventory.targets.map(({ machine, group, config }) => {
    const desired = setMode(config, mode, state.sharedThrottleEvidenceSha256);
    const configPath = path.join(configDirectory, `${machine.id}.${mode}.json`);
    writeJsonFile(configPath, desired);
    return {
      id: machine.id,
      group,
      state: machine.state,
      configPath,
      configSha256: configSha256(desired),
    };
  }).sort((left, right) => {
    const groupOrder = mode === "operational"
      ? { loop: 0, web: 1 }
      : { web: 0, loop: 1 };
    return groupOrder[left.group] - groupOrder[right.group] || left.id.localeCompare(right.id);
  });
  return {
    schemaVersion: 1,
    mode,
    releaseSha: state.releaseSha,
    imageDigest: state.imageDigest,
    activeLoopId: inventory.activeLoopId,
    targets,
  };
}

export function validateSharedThrottleEvidenceForActivation({
  machines,
  releaseReceipt,
  releaseSha,
  sharedThrottleEvidence,
  sharedThrottleEvidenceKey,
  now = Date.now(),
}) {
  if (!RELEASE_SHA_RE.test(releaseSha)) throw new Error("release SHA is invalid");
  const imageDigestValue = validateAcceptedReleaseReceipt(releaseReceipt, releaseSha);
  const inventory = validateMachineInventory(machines, releaseSha, imageDigestValue);
  for (const { config, group } of inventory.targets) {
    if (!validateReleaseEnvironment(config, releaseSha, releaseReceipt.migration)) {
      throw new Error(`${group} Machine migration identity does not match the accepted release`);
    }
    if (!validateMode(config, "dark")) {
      throw new Error(`${group} Machine is not in the protected dark mode`);
    }
  }
  const sharedThrottleAuthority = validateSharedThrottleEvidence({
    evidence: sharedThrottleEvidence,
    evidenceKey: sharedThrottleEvidenceKey,
    releaseSha,
    imageDigest: imageDigestValue,
    inventory,
    now,
  });
  return {
    evidence: clone(sharedThrottleEvidence),
    imageDigest: imageDigestValue,
    inventory,
    authority: sharedThrottleAuthority,
  };
}

export function createActivationSnapshot({
  machines,
  releaseReceipt,
  releaseSha,
  configDirectory,
  sharedThrottleEvidence,
  sharedThrottleEvidenceKey,
  now = Date.now(),
}) {
  const preflight = validateSharedThrottleEvidenceForActivation({
    machines,
    releaseReceipt,
    releaseSha,
    sharedThrottleEvidence,
    sharedThrottleEvidenceKey,
    now,
  });
  const imageDigestValue = preflight.imageDigest;
  const inventory = preflight.inventory;
  const sharedThrottleAuthority = preflight.authority;
  const state = {
    schemaVersion: 1,
    releaseSha,
    imageDigest: imageDigestValue,
    migration: clone(releaseReceipt.migration),
    handlerContractSha256: SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
    sharedThrottleEvidenceSha256: sharedThrottleAuthority.sha256,
    sharedThrottleEvidenceExpiresAt: sharedThrottleAuthority.expiresAt,
    sharedThrottlePolicyIdSha256: sharedThrottleAuthority.policyIdSha256,
    sharedThrottlePolicyRevisionSha256: sharedThrottleAuthority.policyRevisionSha256,
    targetInventorySha256: sha256(stableJson(inventory.targets.map(({ machine, group, config }) => ({
      id: machine.id,
      group,
      state: machine.state,
      configSha256: configSha256(config),
    })).sort((left, right) => left.id.localeCompare(right.id)))),
    activeLoopId: inventory.activeLoopId,
    targets: inventory.targets.map(({ machine, group, config }) => ({
      id: machine.id,
      group,
      initialState: machine.state,
      initialConfigSha256: configSha256(config),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
  const plan = makePlan(machines, state, "operational", configDirectory);
  return { state, plan };
}

export function createRedarkPlan({ machines, state, configDirectory }) {
  return makePlan(machines, state, "dark", configDirectory);
}

export function verifyMachinePlan({ machines, state, plan }) {
  if (
    !isRecord(plan)
    || plan.schemaVersion !== 1
    || !new Set(["dark", "operational"]).has(plan.mode)
    || plan.releaseSha !== state.releaseSha
    || plan.imageDigest !== state.imageDigest
    || !Array.isArray(plan.targets)
  ) throw new Error("Machine mutation plan is invalid");
  const inventory = validateMachineInventory(
    machines,
    state.releaseSha,
    state.imageDigest,
    state.targets.map((target) => target.id),
  );
  const byId = new Map(inventory.targets.map((target) => [target.machine.id, target]));
  if (plan.targets.length !== byId.size) throw new Error("Machine mutation plan target count changed");
  for (const target of plan.targets) {
    const actual = byId.get(target.id);
    if (
      !actual
      || actual.group !== target.group
      || actual.machine.state !== target.state
      || !validateMode(actual.config, plan.mode, state.sharedThrottleEvidenceSha256)
      || configSha256(actual.config) !== target.configSha256
    ) throw new Error(`${target.group ?? "target"} Machine config mutation is not exact`);
  }
  return {
    mode: plan.mode,
    targetCount: plan.targets.length,
    activeLoopId: inventory.activeLoopId,
    configSetSha256: sha256(stableJson(plan.targets.map(({ id, group, configSha256: hash }) => ({ id, group, hash })))),
  };
}

function eventFrom(value, inheritedTimestamp = "", depth = 0) {
  if (depth > 4) return null;
  if (isRecord(value)) {
    const timestamp = typeof value.startedAt === "string"
      ? value.startedAt
      : typeof value.timestamp === "string"
        ? value.timestamp
        : inheritedTimestamp;
    if (value.event === "sourcing_loop_tick") return { event: value, timestamp };
    for (const key of ["message", "msg"]) {
      if (value[key] !== undefined) {
        const nested = eventFrom(value[key], timestamp, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  }
  if (typeof value !== "string") return null;
  try {
    return eventFrom(JSON.parse(value), inheritedTimestamp, depth + 1);
  } catch {
    const start = value.indexOf('{"event":"sourcing_loop_tick"');
    if (start < 0) return null;
    try { return eventFrom(JSON.parse(value.slice(start)), inheritedTimestamp, depth + 1); } catch { return null; }
  }
}

export function verifyOperationalHeartbeat(logs, releaseSha, notBefore) {
  const lowerBound = Date.parse(notBefore);
  if (
    !RELEASE_SHA_RE.test(releaseSha)
    || !Number.isFinite(lowerBound)
    || typeof logs !== "string"
    || logs.length > 5_000_000
  ) return false;
  const receipts = logs.split(/\r?\n/).map((line) => eventFrom(line)).filter(Boolean);
  return receipts.some(({ event, timestamp }) =>
    Number.isFinite(Date.parse(timestamp))
    && Date.parse(timestamp) >= lowerBound
    && Date.parse(timestamp) <= Date.now() + 5 * 60_000
    && event.releaseSha === releaseSha
    && event.status === "ok"
    && Array.isArray(event.failureCodes)
    && event.failureCodes.length === 0
    && event.dispatch === "disabled"
    && Number.isSafeInteger(event.durationMs)
    && event.durationMs >= 0
    && event.durationMs <= 120_000,
  );
}

function requiredEnvironment(name, pattern = null, maximum = 4_096) {
  const value = process.env[name] ?? "";
  if (!value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  if (pattern && !pattern.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function strictOrigin(name, expectedHostname) {
  const value = requiredEnvironment(name, null, 300);
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.hostname !== expectedHostname
    || url.username || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search || url.hash
  ) throw new Error(`${name} must be the exact production origin`);
  return url;
}

async function boundedResponseText(response, maximum = MAX_JSON_BYTES) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("HTTP response is oversized");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new Error("HTTP response is oversized");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function requestJson(url, options, expectedStatuses = [200], maximumBytes = MAX_JSON_BYTES) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await boundedResponseText(response, maximumBytes);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`HTTP gate failed with status ${response.status}`);
  }
  let body;
  try { body = JSON.parse(text); } catch { throw new Error("HTTP gate returned invalid JSON"); }
  return { body, headers: response.headers, status: response.status };
}

function restHeaders(apiKey, bearer, extra = {}) {
  return {
    apikey: apiKey,
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    ...extra,
  };
}

export function validateSourcingReadiness(value, releaseSha, expectedMigration) {
  return Boolean(
    isRecord(value)
    && value.ok === true
    && value.status === "ready"
    && value.mode === "operational"
    && value.build === releaseSha
    && value.migration === expectedMigration
    && isRecord(value.components)
    && value.components.database === true
    && value.components.auth === true
    && value.components.queue === true
    && value.components.agentFrameworks === true
    && value.components.sourcingLoop === true
    && value.components.migration === true
    && value.components.releaseIdentity === true
    && value.components.needIngressSharedThrottle === true
    && isRecord(value.capabilities)
    && value.capabilities.autonomousSourcing === true
    && value.capabilities.needIngress === true
  );
}

export function validateLoopReadiness(value) {
  const keys = new Set([
    "active_workers", "ambiguous_sourcing_attempts", "dead_sourcing_jobs",
    "expected_handler_count", "freshest_heartbeat_age_seconds", "healthy",
    "heartbeat_status", "oldest_runnable_job_age_seconds", "overdue_begun_attempts",
    "overdue_runnable_jobs", "status",
  ]);
  const bounded = (name) => Number.isSafeInteger(value?.[name]) && value[name] >= 0 && value[name] <= 1_000_000;
  return Boolean(
    exactKeys(value, keys)
    && value.healthy === true
    && value.status === "ready"
    && value.heartbeat_status === "fresh"
    && value.expected_handler_count === 4
    && bounded("active_workers") && value.active_workers >= 1 && value.active_workers <= 100
    && Number.isFinite(value.freshest_heartbeat_age_seconds)
    && value.freshest_heartbeat_age_seconds >= 0
    && value.freshest_heartbeat_age_seconds <= 90
    && bounded("oldest_runnable_job_age_seconds")
    && value.oldest_runnable_job_age_seconds <= 120
    && bounded("overdue_runnable_jobs") && value.overdue_runnable_jobs === 0
    && bounded("dead_sourcing_jobs") && value.dead_sourcing_jobs === 0
    && bounded("ambiguous_sourcing_attempts") && value.ambiguous_sourcing_attempts === 0
    && bounded("overdue_begun_attempts") && value.overdue_begun_attempts === 0
  );
}

export function validateAutonomousProviderProof(value, expectedCredentialId, now = Date.now()) {
  const keys = new Set([
    "attemptCount", "confirmationCount", "credentialId", "credentialVerifiedAt",
    "credentialVersion", "failureCount", "provider", "providerMode", "receiptCount",
    "receipts", "status", "verificationHttpStatus", "verificationMethod",
  ]);
  if (
    !exactKeys(value, keys)
    || value.status !== "completed"
    || value.provider !== "tavily"
    || value.providerMode !== "workspace_credential"
    || value.credentialId !== expectedCredentialId
    || !UUID_RE.test(value.credentialId ?? "")
    || !SHA256_RE.test(value.credentialVersion ?? "")
    || !Number.isSafeInteger(value.receiptCount)
    || value.receiptCount < 1
    || value.receiptCount > 5
    || !Number.isSafeInteger(value.attemptCount)
    || value.attemptCount < value.receiptCount
    || value.attemptCount > value.receiptCount * 4
    || !Number.isSafeInteger(value.failureCount)
    || value.failureCount < 0
    || value.failureCount > value.receiptCount * 3
    || value.attemptCount !== value.receiptCount + value.failureCount
    || !Number.isSafeInteger(value.confirmationCount)
    || value.confirmationCount !== value.attemptCount
    || !["tavily_usage_v1", "tavily_key_info_v1"].includes(value.verificationMethod)
    || value.verificationHttpStatus !== 200
    || !Array.isArray(value.receipts)
    || value.receipts.length !== value.receiptCount
  ) {
    throw new Error("autonomous Tavily provider proof is invalid");
  }
  const verifiedAt = Date.parse(value.credentialVerifiedAt ?? "");
  if (
    !Number.isFinite(now)
    || !Number.isFinite(verifiedAt)
    || verifiedAt > now + 5 * 60_000
    || verifiedAt <= now - 24 * 60 * 60_000
  ) throw new Error("autonomous Tavily credential proof is stale");

  let candidateCount = 0;
  const seenJobs = new Set();
  const seenAttempts = new Set();
  for (const receipt of value.receipts) {
    if (
      !exactKeys(receipt, new Set([
        "candidateCount", "canonicalQuerySha256", "completedAt", "egressAttemptId",
        "jobId", "resultSha256",
      ]))
      || !UUID_RE.test(receipt.jobId ?? "")
      || !UUID_RE.test(receipt.egressAttemptId ?? "")
      || seenJobs.has(receipt.jobId)
      || seenAttempts.has(receipt.egressAttemptId)
      || !SHA256_RE.test(receipt.canonicalQuerySha256 ?? "")
      || !SHA256_RE.test(receipt.resultSha256 ?? "")
      || !Number.isSafeInteger(receipt.candidateCount)
      || receipt.candidateCount < 0
      || receipt.candidateCount > 5
      || !Number.isFinite(Date.parse(receipt.completedAt ?? ""))
    ) throw new Error("autonomous Tavily receipt proof is invalid");
    seenJobs.add(receipt.jobId);
    seenAttempts.add(receipt.egressAttemptId);
    candidateCount += receipt.candidateCount;
  }
  if (candidateCount < 1 || candidateCount > 25) {
    throw new Error("autonomous Tavily proof has no bounded candidate result");
  }
  return {
    attemptCount: value.attemptCount,
    confirmationCount: value.confirmationCount,
    receiptCount: value.receiptCount,
    failureCount: value.failureCount,
    candidateCount,
    credentialIdSha256: sha256(value.credentialId),
    credentialVersionSha256: sha256(value.credentialVersion),
    verificationSha256: sha256(stableJson({
      method: value.verificationMethod,
      httpStatus: value.verificationHttpStatus,
      verifiedAt: value.credentialVerifiedAt,
    })),
    receiptSetSha256: sha256(stableJson(value.receipts)),
    proofSha256: sha256(stableJson(value)),
  };
}

async function waitFor(check, { attempts, intervalMs, description }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await check();
      if (value !== null && value !== false && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${description} did not become ready${lastError ? `: ${lastError.message}` : ""}`);
}

function exactOutboundCount(headers) {
  const value = headers.get("content-range") ?? "";
  const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(value);
  if (!match) throw new Error("messages_outbound count proof is absent");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 0 || count > 10_000_000) {
    throw new Error("messages_outbound count is invalid");
  }
  return count;
}

function validateApprovalReviews(reviews, releaseSha, imageDigestValue) {
  if (!Array.isArray(reviews) || reviews.length > 1_000) throw new Error("activation approval evidence is invalid");
  const actor = (process.env.GITHUB_ACTOR ?? "").toLowerCase();
  const triggeringActor = (process.env.GITHUB_TRIGGERING_ACTOR ?? "").toLowerCase();
  const matches = reviews.filter((review) =>
    review?.state === "approved"
    && typeof review?.user?.login === "string"
    && review.user.login.length >= 1
    && review.user.login.length <= 100
    && Array.isArray(review?.environments)
    && review.environments.some((environment) => environment?.name === "Production-Sourcing-Activation"),
  );
  if (matches.length < 1) throw new Error("Production-Sourcing-Activation approval is absent");
  const review = matches.at(-1);
  const reviewer = review.user.login.toLowerCase();
  if (!actor || !triggeringActor || reviewer === actor || reviewer === triggeringActor) {
    throw new Error("sourcing activation approval is self-approved or actor evidence is absent");
  }
  return {
    environment: "Production-Sourcing-Activation",
    reviewerIdentitySha256: sha256(reviewer),
    evidenceSha256: sha256(stableJson({
      releaseSha,
      imageDigest: imageDigestValue,
      state: review.state,
      reviewer,
      environments: review.environments.map((environment) => ({
        id: environment?.id ?? null,
        name: environment?.name ?? null,
      })).sort((left, right) => String(left.name).localeCompare(String(right.name))),
    })),
  };
}

function validateActivationCandidateReceipt(receipt) {
  const releaseSha = requiredEnvironment("ARIA_RELEASE_SHA", RELEASE_SHA_RE, 40);
  const runId = requiredEnvironment("GITHUB_RUN_ID", /^[1-9][0-9]*$/, 30);
  const runAttempt = Number(requiredEnvironment("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/, 10));
  const count = receipt?.canary?.messagesOutboundBefore;
  const rowsetSha256 = receipt?.canary?.messagesOutboundBeforeSha256;
  const completedAt = Date.parse(receipt?.completedAt ?? "");
  if (
    !exactKeys(receipt, new Set([
      "approval", "canary", "completedAt", "handlerContractSha256", "imageDigest",
      "machineIdentity", "migration", "readinessSha256", "releaseSha", "run",
      "safety", "schemaVersion", "sharedThrottleEvidenceSha256", "status",
    ]))
    || receipt.schemaVersion !== 1
    || receipt.status !== "pending-artifact"
    || receipt.releaseSha !== releaseSha
    || !DIGEST_RE.test(receipt.imageDigest ?? "")
    || receipt.handlerContractSha256 !== SOURCING_LOOP_HANDLER_CONTRACT_SHA256
    || !SHA256_RE.test(receipt.sharedThrottleEvidenceSha256 ?? "")
    || !exactKeys(receipt.migration, new Set(["count", "filename", "ledgerSha256", "sha256"]))
    || !/^0[0-9]{3}_[A-Za-z0-9_]+\.sql$/.test(receipt.migration.filename ?? "")
    || !SHA256_RE.test(receipt.migration.sha256 ?? "")
    || !Number.isSafeInteger(receipt.migration.count)
    || receipt.migration.count < 1
    || !SHA256_RE.test(receipt.migration.ledgerSha256 ?? "")
    || !exactKeys(receipt.run, new Set(["attempt", "id"]))
    || receipt.run.id !== runId
    || receipt.run.attempt !== runAttempt
    || !exactKeys(receipt.approval, new Set(["environment", "evidenceSha256", "reviewerIdentitySha256"]))
    || receipt.approval.environment !== "Production-Sourcing-Activation"
    || !SHA256_RE.test(receipt.approval.evidenceSha256 ?? "")
    || !SHA256_RE.test(receipt.approval.reviewerIdentitySha256 ?? "")
    || !exactKeys(receipt.machineIdentity, new Set([
      "operationalConfigSetSha256", "targetCount", "targetInventorySha256",
    ]))
    || !Number.isSafeInteger(receipt.machineIdentity.targetCount)
    || receipt.machineIdentity.targetCount < 3
    || receipt.machineIdentity.targetCount > 34
    || !SHA256_RE.test(receipt.machineIdentity.targetInventorySha256 ?? "")
    || !SHA256_RE.test(receipt.machineIdentity.operationalConfigSetSha256 ?? "")
    || !exactKeys(receipt.canary, new Set([
      "campaignId", "candidateCount", "candidateEvidenceSha256", "idempotencyKeySha256",
      "intakeJobId", "needCredentialIdSha256", "needCredentialKeySha256",
      "messagesOutboundAfter", "messagesOutboundAfterSha256", "messagesOutboundBefore",
      "messagesOutboundBeforeSha256", "messagesOutboundConfirmed",
      "messagesOutboundConfirmedSha256", "provider", "providerAttemptCount",
      "providerConfirmationCount", "providerCredentialIdSha256",
      "providerCredentialVersionSha256", "providerFailureCount", "providerMode",
      "providerProofAfterReplaySha256", "providerProofBeforeReplaySha256",
      "providerReceiptCount", "providerReceiptSetSha256", "providerVerificationSha256",
      "replayVerified", "requisitionId", "workspaceIdSha256",
    ]))
    || receipt.canary.provider !== "tavily"
    || receipt.canary.providerMode !== "workspace_credential"
    || !Number.isSafeInteger(receipt.canary.candidateCount)
    || receipt.canary.candidateCount < 1
    || receipt.canary.candidateCount > 25
    || !Number.isSafeInteger(receipt.canary.providerAttemptCount)
    || receipt.canary.providerAttemptCount < 1
    || receipt.canary.providerAttemptCount > 5
    || receipt.canary.providerConfirmationCount !== receipt.canary.providerAttemptCount
    || receipt.canary.providerReceiptCount !== receipt.canary.providerAttemptCount
    || receipt.canary.providerFailureCount !== 0
    || receipt.canary.replayVerified !== true
    || !UUID_RE.test(receipt.canary.intakeJobId ?? "")
    || !UUID_RE.test(receipt.canary.requisitionId ?? "")
    || !UUID_RE.test(receipt.canary.campaignId ?? "")
    || !Number.isSafeInteger(count)
    || count < 0
    || count > 2_000
    || receipt.canary.messagesOutboundAfter !== count
    || receipt.canary.messagesOutboundConfirmed !== count
    || !SHA256_RE.test(rowsetSha256 ?? "")
    || receipt.canary.messagesOutboundAfterSha256 !== rowsetSha256
    || receipt.canary.messagesOutboundConfirmedSha256 !== rowsetSha256
    || ![
      "candidateEvidenceSha256", "idempotencyKeySha256", "needCredentialIdSha256",
      "needCredentialKeySha256", "providerCredentialIdSha256",
      "providerCredentialVersionSha256", "providerProofAfterReplaySha256",
      "providerProofBeforeReplaySha256", "providerReceiptSetSha256",
      "providerVerificationSha256", "workspaceIdSha256",
    ].every((key) => SHA256_RE.test(receipt.canary[key] ?? ""))
    || receipt.canary.providerProofAfterReplaySha256
      !== receipt.canary.providerProofBeforeReplaySha256
    || !exactKeys(receipt.safety, new Set(["contactAttempted", "outboundDrainEnabled", "proof"]))
    || receipt.safety.contactAttempted !== false
    || receipt.safety.outboundDrainEnabled !== false
    || receipt.safety.proof !== "tenant-rls-messages_outbound-exact-rowset-before-after-confirmed"
    || !SHA256_RE.test(receipt.readinessSha256 ?? "")
    || !Number.isFinite(completedAt)
    || completedAt > Date.now() + 5 * 60_000
  ) throw new Error("activation candidate receipt is invalid or unexpectedly expanded");
}

async function runNoContactCanary({ releaseReceipt, state, machineProof, reviews }) {
  const releaseSha = requiredEnvironment("ARIA_RELEASE_SHA", RELEASE_SHA_RE, 40);
  const runId = requiredEnvironment("GITHUB_RUN_ID", /^[1-9][0-9]*$/, 30);
  const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/, 10);
  const workspaceId = requiredEnvironment("ARIA_SOURCING_CANARY_WORKSPACE_ID", UUID_RE, 36);
  const needCredentialId = requiredEnvironment("ARIA_SOURCING_CANARY_CREDENTIAL_ID", UUID_RE, 36);
  const tavilyCredentialId = requiredEnvironment(
    "ARIA_SOURCING_CANARY_TAVILY_CREDENTIAL_ID",
    UUID_RE,
    36,
  );
  const email = requiredEnvironment("ARIA_SOURCING_CANARY_EMAIL", /^[^\s@]+@[^\s@]+$/, 320);
  const password = requiredEnvironment("ARIA_SOURCING_CANARY_PASSWORD", null, 1_000);
  const needKey = requiredEnvironment("ARIA_SOURCING_CANARY_NEED_KEY", /^aria_need_v1_[A-Za-z0-9_-]{43}$/, 56);
  const anonKey = requiredEnvironment("SUPABASE_ANON_KEY", null, 4_096);
  const serviceKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY", null, 4_096);
  const appOrigin = strictOrigin("APP_URL", "aria-mantu-app.fly.dev");
  const kongOrigin = strictOrigin("KONG_URL", "aria-mantu-kong.fly.dev");
  const expectedDigest = validateAcceptedReleaseReceipt(releaseReceipt, releaseSha);
  if (
    state.releaseSha !== releaseSha
    || state.imageDigest !== expectedDigest
    || state.handlerContractSha256 !== SOURCING_LOOP_HANDLER_CONTRACT_SHA256
  ) throw new Error("activation snapshot identity does not match the accepted release");
  if (
    !isRecord(machineProof)
    || machineProof.mode !== "operational"
    || machineProof.targetCount !== state.targets?.length
    || machineProof.activeLoopId !== state.activeLoopId
    || !SHA256_RE.test(machineProof.configSetSha256 ?? "")
  ) throw new Error("exact operational Machine proof is absent");
  const approval = validateApprovalReviews(reviews, releaseSha, expectedDigest);

  const ready = await waitFor(async () => {
    const response = await requestJson(new URL("/api/ready", appOrigin), { method: "GET" });
    return validateSourcingReadiness(response.body, releaseSha, releaseReceipt.migration.filename)
      ? response.body
      : null;
  }, { attempts: 24, intervalMs: 5_000, description: "operational application readiness" });

  const loopResponse = await requestJson(
    new URL("/rest/v1/rpc/get_sourcing_loop_readiness", kongOrigin),
    { method: "POST", headers: restHeaders(serviceKey, serviceKey), body: "{}" },
  );
  if (!validateLoopReadiness(loopResponse.body)) throw new Error("exact sourcing loop readiness is not healthy");

  const login = await requestJson(
    new URL("/auth/v1/token?grant_type=password", kongOrigin),
    { method: "POST", headers: { apikey: anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password }) },
  );
  const accessToken = login.body?.access_token;
  if (typeof accessToken !== "string" || accessToken.length < 32 || accessToken.length > 8_192) {
    throw new Error("dedicated canary login did not return a bounded access token");
  }

  const credentialDigest = sha256(needKey);
  const resolved = await requestJson(
    new URL("/rest/v1/rpc/resolve_need_ingress_credential", kongOrigin),
    {
      method: "POST",
      headers: restHeaders(serviceKey, serviceKey),
      body: JSON.stringify({ p_key_sha256: credentialDigest }),
    },
  );
  if (
    !exactKeys(resolved.body, new Set(["credential_id", "status", "workspace_id"]))
    || resolved.body.status !== "active"
    || resolved.body.credential_id !== needCredentialId
    || resolved.body.workspace_id !== workspaceId
  ) throw new Error("dedicated need credential is not active for the expected canary tenant");

  const currentWorkspace = await requestJson(
    new URL("/rest/v1/rpc/current_workspace_id", kongOrigin),
    { method: "POST", headers: restHeaders(anonKey, accessToken), body: "{}" },
  );
  if (currentWorkspace.body !== workspaceId) throw new Error("canary user and need credential are not tenant-bound together");

  const outboundSnapshot = async () => {
    const countUrl = new URL("/rest/v1/messages_outbound?select=id", kongOrigin);
    const countResponse = await requestJson(
      countUrl,
      {
        method: "GET",
        headers: restHeaders(anonKey, accessToken, { prefer: "count=exact", range: "0-0" }),
      },
      [200, 206],
    );
    if (!Array.isArray(countResponse.body) || countResponse.body.length > 1) {
      throw new Error("messages_outbound count response is invalid");
    }
    const count = exactOutboundCount(countResponse.headers);
    if (count > 2_000) throw new Error("dedicated canary outbound ledger is too large for exact proof");
    const rowsUrl = new URL("/rest/v1/messages_outbound?select=*&order=id.asc&limit=2001", kongOrigin);
    const rowsResponse = await requestJson(
      rowsUrl,
      { method: "GET", headers: restHeaders(anonKey, accessToken) },
      [200],
      4_000_000,
    );
    if (!Array.isArray(rowsResponse.body) || rowsResponse.body.length !== count) {
      throw new Error("messages_outbound exact snapshot does not match its count");
    }
    return { count, sha256: sha256(stableJson(rowsResponse.body)) };
  };
  const outboundBefore = await outboundSnapshot();

  const needBody = JSON.stringify({
    need: {
      content: "Source a Senior Product Manager. Required skills: product strategy, roadmapping, stakeholder management. Employment type: full-time. Location type: remote.",
      contentType: "text/plain",
    },
  });
  const idempotencyKey = `activation:${runId}:${runAttempt}:${releaseSha.slice(0, 12)}`;
  const submitNeed = async () => {
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signingPayload = `aria-need-v1\n${timestamp}\n${idempotencyKey}\n${needBody}`;
    const signature = createHmac("sha256", needKey).update(signingPayload, "utf8").digest("hex");
    return requestJson(
      new URL("/api/webhooks/needs", appOrigin),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-aria-need-key": needKey,
          "x-aria-need-timestamp": timestamp,
          "x-aria-need-signature": `sha256=${signature}`,
        },
        body: needBody,
      },
      [200, 202],
    );
  };
  const needResponse = await submitNeed();
  const requisitionId = needResponse.body?.requisitionId;
  const intakeJobId = needResponse.body?.jobId;
  if (
    needResponse.body?.ok !== true
    || !UUID_RE.test(requisitionId ?? "")
    || !UUID_RE.test(intakeJobId ?? "")
  ) throw new Error("tenant-bound need ingress did not return exact durable ids");

  const campaign = await waitFor(async () => {
    const response = await requestJson(
      new URL("/rest/v1/rpc/list_workspace_requisitions", kongOrigin),
      {
        method: "POST",
        headers: restHeaders(anonKey, accessToken),
        body: JSON.stringify({ p_limit: 200, p_offset: 0 }),
      },
    );
    if (!Array.isArray(response.body) || response.body.length > 200) throw new Error("requisition inventory is invalid");
    const requisition = response.body.find((row) => row?.id === requisitionId);
    if (!requisition) return null;
    if (["needs_clarification", "rejected", "erased"].includes(requisition.status)) {
      throw new Error(`canary requisition reached terminal status ${requisition.status}`);
    }
    if (requisition.status !== "campaign_created" || !UUID_RE.test(requisition.campaign_id ?? "")) return null;
    return { id: requisition.campaign_id };
  }, { attempts: 84, intervalMs: 5_000, description: "canary campaign" });

  const providerProofSnapshot = async () => {
    const response = await requestJson(
      new URL("/rest/v1/rpc/get_autonomous_web_sourcing_activation_proof", kongOrigin),
      {
        method: "POST",
        headers: restHeaders(serviceKey, serviceKey),
        body: JSON.stringify({
          p_workspace_id: workspaceId,
          p_campaign_id: campaign.id,
        }),
      },
    );
    if (response.body?.status === "pending") return null;
    return validateAutonomousProviderProof(response.body, tavilyCredentialId);
  };
  const providerProofBeforeReplay = await waitFor(providerProofSnapshot, {
    attempts: 84,
    intervalMs: 5_000,
    description: "credential-bound Tavily provider receipt",
  });

  const candidateProof = await waitFor(async () => {
    const response = await requestJson(
      new URL("/rest/v1/rpc/list_workspace_candidates", kongOrigin),
      {
        method: "POST",
        headers: restHeaders(anonKey, accessToken),
        body: JSON.stringify({
          p_campaign_id: campaign.id,
          p_stage: null,
          p_source: "LinkedIn",
          p_search: null,
          p_sort: "recent",
          p_limit: 25,
          p_offset: 0,
        }),
      },
    );
    if (!Array.isArray(response.body) || response.body.length > 25) throw new Error("candidate inventory is invalid");
    const proofs = [];
    for (const row of response.body) {
      const candidate = row?.payload;
      const evidence = candidate?.sourceEvidence;
      if (
        !isRecord(candidate)
        || candidate.campaignId !== campaign.id
        || candidate.sourcePlatform !== "LinkedIn"
        || candidate.provenance !== "live"
        || !/^linkedin-[0-9a-f]{32}$/.test(candidate.id ?? "")
        || !isRecord(evidence)
        || !exactKeys(evidence, new Set([
          "attemptId", "externalId", "linkedinUrl", "matchedRequiredSkills",
          "matchedRoleTerms", "normalizedPayloadSha256", "provider",
          "providerResultOrdinal", "providerResultSha256", "providerResultSnippet",
          "providerResultTitle", "providerScore", "querySha256", "rawResponseSha256",
          "roleTitle", "roleTitleObserved",
        ]))
        || evidence.provider !== "tavily"
        || !UUID_RE.test(evidence.attemptId ?? "")
        || !Number.isSafeInteger(evidence.providerResultOrdinal)
        || evidence.providerResultOrdinal < 0
        || evidence.providerResultOrdinal > 4
        || typeof evidence.providerResultTitle !== "string"
        || evidence.providerResultTitle.length < 1
        || evidence.providerResultTitle.length > 300
        || typeof evidence.providerResultSnippet !== "string"
        || evidence.providerResultSnippet.length < 1
        || evidence.providerResultSnippet.length > 4_000
        || typeof evidence.providerScore !== "number"
        || !Number.isFinite(evidence.providerScore)
        || evidence.providerScore < 0
        || evidence.providerScore > 1
        || !/^https:\/\/www\.linkedin\.com\/in\/[a-z0-9][a-z0-9-]{2,99}$/.test(evidence.linkedinUrl ?? "")
        || !SHA256_RE.test(evidence.externalId ?? "")
        || !SHA256_RE.test(evidence.querySha256 ?? "")
        || !SHA256_RE.test(evidence.rawResponseSha256 ?? "")
        || !SHA256_RE.test(evidence.providerResultSha256 ?? "")
        || !SHA256_RE.test(evidence.normalizedPayloadSha256 ?? "")
        || typeof evidence.roleTitle !== "string"
        || evidence.roleTitle.length < 2
        || evidence.roleTitle.length > 200
        || typeof evidence.roleTitleObserved !== "boolean"
        || !Array.isArray(evidence.matchedRequiredSkills)
        || !Array.isArray(evidence.matchedRoleTerms)
        || evidence.linkedinUrl !== candidate.linkedinUrl
        || candidate.sourceUrl !== evidence.linkedinUrl
        || candidate.sourceExternalId !== evidence.externalId
      ) throw new Error("candidate is not backed by canonical Tavily LinkedIn evidence");
      proofs.push({
        candidateIdSha256: sha256(String(candidate.id)),
        externalIdSha256: sha256(evidence.externalId),
        attemptIdSha256: sha256(evidence.attemptId),
        querySha256: evidence.querySha256,
        rawResponseSha256: evidence.rawResponseSha256,
        providerResultSha256: evidence.providerResultSha256,
        normalizedPayloadSha256: evidence.normalizedPayloadSha256,
      });
    }
    if (proofs.length < 1 || proofs.length > 25) return null;
    return {
      count: proofs.length,
      sha256: sha256(stableJson(proofs.sort((left, right) => left.candidateIdSha256.localeCompare(right.candidateIdSha256)))),
    };
  }, { attempts: 84, intervalMs: 5_000, description: "evidence-backed Tavily LinkedIn candidates" });

  const replayResponse = await submitNeed();
  if (
    replayResponse.body?.ok !== true
    || replayResponse.body?.requisitionId !== requisitionId
    || replayResponse.body?.jobId !== intakeJobId
  ) throw new Error("need ingress replay did not return the original durable ids");
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const providerProofAfterReplay = await providerProofSnapshot();
  if (
    providerProofAfterReplay === null
    || providerProofAfterReplay.proofSha256 !== providerProofBeforeReplay.proofSha256
    || providerProofAfterReplay.receiptSetSha256 !== providerProofBeforeReplay.receiptSetSha256
  ) throw new Error("need ingress replay caused a second provider effect");

  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const outboundAfter = await outboundSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const outboundConfirmed = await outboundSnapshot();
  if (
    outboundAfter.count !== outboundBefore.count
    || outboundConfirmed.count !== outboundBefore.count
    || outboundAfter.sha256 !== outboundBefore.sha256
    || outboundConfirmed.sha256 !== outboundBefore.sha256
  ) throw new Error("no-contact canary changed messages_outbound");

  const receipt = {
    schemaVersion: 1,
    status: "pending-artifact",
    releaseSha,
    imageDigest: expectedDigest,
    migration: clone(releaseReceipt.migration),
    handlerContractSha256: SOURCING_LOOP_HANDLER_CONTRACT_SHA256,
    sharedThrottleEvidenceSha256: state.sharedThrottleEvidenceSha256,
    run: { id: runId, attempt: Number(runAttempt) },
    approval,
    machineIdentity: {
      targetCount: state.targets.length,
      targetInventorySha256: state.targetInventorySha256,
      operationalConfigSetSha256: machineProof.configSetSha256,
    },
    canary: {
      workspaceIdSha256: sha256(workspaceId),
      needCredentialIdSha256: sha256(needCredentialId),
      needCredentialKeySha256: credentialDigest,
      idempotencyKeySha256: sha256(idempotencyKey),
      intakeJobId,
      requisitionId,
      campaignId: campaign.id,
      provider: "tavily",
      providerMode: "workspace_credential",
      providerCredentialIdSha256: providerProofBeforeReplay.credentialIdSha256,
      providerCredentialVersionSha256: providerProofBeforeReplay.credentialVersionSha256,
      providerVerificationSha256: providerProofBeforeReplay.verificationSha256,
      providerAttemptCount: providerProofBeforeReplay.attemptCount,
      providerConfirmationCount: providerProofBeforeReplay.confirmationCount,
      providerReceiptCount: providerProofBeforeReplay.receiptCount,
      providerFailureCount: providerProofBeforeReplay.failureCount,
      providerReceiptSetSha256: providerProofBeforeReplay.receiptSetSha256,
      providerProofBeforeReplaySha256: providerProofBeforeReplay.proofSha256,
      providerProofAfterReplaySha256: providerProofAfterReplay.proofSha256,
      replayVerified: true,
      candidateCount: candidateProof.count,
      candidateEvidenceSha256: candidateProof.sha256,
      messagesOutboundBefore: outboundBefore.count,
      messagesOutboundAfter: outboundAfter.count,
      messagesOutboundConfirmed: outboundConfirmed.count,
      messagesOutboundBeforeSha256: outboundBefore.sha256,
      messagesOutboundAfterSha256: outboundAfter.sha256,
      messagesOutboundConfirmedSha256: outboundConfirmed.sha256,
    },
    safety: {
      outboundDrainEnabled: false,
      contactAttempted: false,
      proof: "tenant-rls-messages_outbound-exact-rowset-before-after-confirmed",
    },
    readinessSha256: sha256(stableJson(ready)),
    completedAt: new Date().toISOString(),
  };
  if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error("activation receipt is oversized");
  }
  return receipt;
}

function parseArguments(argv) {
  const command = argv[0] ?? "";
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z][a-z-]*$/.test(flag ?? "") || value === undefined || Object.hasOwn(values, flag.slice(2))) {
      throw new Error("invalid or duplicate CLI argument");
    }
    values[flag.slice(2)] = value;
  }
  const take = (name) => {
    const value = values[name];
    if (!value) throw new Error(`--${name} is required`);
    delete values[name];
    return value;
  };
  const done = () => {
    if (Object.keys(values).length !== 0) throw new Error("unexpected CLI argument");
  };
  return { command, take, done };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.command === "validate-shared-throttle-evidence") {
    const machines = boundedJsonFile(args.take("machines")).value;
    const releaseReceipt = boundedJsonFile(
      args.take("release-receipt"),
      MAX_RECEIPT_BYTES,
    ).value;
    const sharedThrottleEvidence = boundedJsonFile(
      args.take("shared-throttle-evidence"),
      MAX_RECEIPT_BYTES,
    ).value;
    const releaseSha = args.take("release-sha");
    const output = args.take("output");
    args.done();
    const verified = validateSharedThrottleEvidenceForActivation({
      machines,
      releaseReceipt,
      releaseSha,
      sharedThrottleEvidence,
      sharedThrottleEvidenceKey: process.env.ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_HMAC_KEY ?? "",
    });
    writeJsonFile(output, verified.evidence, MAX_RECEIPT_BYTES);
    return;
  }
  if (args.command === "snapshot") {
    const machinesFile = args.take("machines");
    const receiptFile = args.take("release-receipt");
    const sharedThrottleEvidenceFile = args.take("shared-throttle-evidence");
    const releaseSha = args.take("release-sha");
    const stateFile = args.take("state");
    const planFile = args.take("plan");
    const configDirectory = args.take("config-dir");
    args.done();
    const machines = boundedJsonFile(machinesFile).value;
    const releaseReceipt = boundedJsonFile(receiptFile, MAX_RECEIPT_BYTES).value;
    const sharedThrottleEvidence = boundedJsonFile(
      sharedThrottleEvidenceFile,
      MAX_RECEIPT_BYTES,
    ).value;
    const { state, plan } = createActivationSnapshot({
      machines,
      releaseReceipt,
      releaseSha,
      configDirectory,
      sharedThrottleEvidence,
      sharedThrottleEvidenceKey: process.env.ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_HMAC_KEY ?? "",
    });
    writeJsonFile(stateFile, state, MAX_RECEIPT_BYTES);
    writeJsonFile(planFile, plan, MAX_RECEIPT_BYTES);
    return;
  }
  if (args.command === "redark") {
    const machines = boundedJsonFile(args.take("machines")).value;
    const state = boundedJsonFile(args.take("state"), MAX_RECEIPT_BYTES).value;
    const planFile = args.take("plan");
    const configDirectory = args.take("config-dir");
    args.done();
    writeJsonFile(planFile, createRedarkPlan({ machines, state, configDirectory }), MAX_RECEIPT_BYTES);
    return;
  }
  if (args.command === "verify-machines") {
    const machines = boundedJsonFile(args.take("machines")).value;
    const state = boundedJsonFile(args.take("state"), MAX_RECEIPT_BYTES).value;
    const plan = boundedJsonFile(args.take("plan"), MAX_RECEIPT_BYTES).value;
    const output = args.take("output");
    args.done();
    writeJsonFile(output, verifyMachinePlan({ machines, state, plan }), MAX_RECEIPT_BYTES);
    return;
  }
  if (args.command === "verify-heartbeat") {
    const logs = readFileSync(args.take("logs"), "utf8");
    const releaseSha = args.take("release-sha");
    const notBefore = args.take("not-before");
    args.done();
    if (!verifyOperationalHeartbeat(logs, releaseSha, notBefore)) {
      throw new Error("fresh exact operational loop heartbeat is absent");
    }
    return;
  }
  if (args.command === "canary") {
    const releaseReceipt = boundedJsonFile(args.take("release-receipt"), MAX_RECEIPT_BYTES).value;
    const state = boundedJsonFile(args.take("state"), MAX_RECEIPT_BYTES).value;
    const machineProof = boundedJsonFile(args.take("machine-proof"), MAX_RECEIPT_BYTES).value;
    const reviews = boundedJsonFile(args.take("reviews"), MAX_JSON_BYTES).value;
    const output = args.take("output");
    args.done();
    writeJsonFile(
      output,
      await runNoContactCanary({ releaseReceipt, state, machineProof, reviews }),
      MAX_RECEIPT_BYTES,
    );
    return;
  }
  if (args.command === "validate-approval") {
    const receipt = boundedJsonFile(args.take("release-receipt"), MAX_RECEIPT_BYTES).value;
    const reviews = boundedJsonFile(args.take("reviews"), MAX_JSON_BYTES).value;
    const releaseSha = args.take("release-sha");
    const output = args.take("output");
    args.done();
    const expectedDigest = validateAcceptedReleaseReceipt(receipt, releaseSha);
    writeJsonFile(
      output,
      validateApprovalReviews(reviews, releaseSha, expectedDigest),
      MAX_RECEIPT_BYTES,
    );
    return;
  }
  if (args.command === "finalize-receipt") {
    const candidateFile = args.take("candidate");
    const output = args.take("output");
    const artifactId = args.take("artifact-id");
    const artifactSha256 = args.take("artifact-sha256");
    args.done();
    const candidate = boundedJsonFile(candidateFile, MAX_RECEIPT_BYTES);
    validateActivationCandidateReceipt(candidate.value);
    if (
      !/^[1-9][0-9]*$/.test(artifactId)
      || !SHA256_RE.test(artifactSha256)
    ) throw new Error("activation candidate receipt or artifact identity is invalid");
    writeJsonFile(output, {
      ...candidate.value,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      evidenceArtifact: {
        id: artifactId,
        sha256: artifactSha256,
        candidateReceiptSha256: sha256(candidate.bytes),
      },
    }, MAX_RECEIPT_BYTES);
    return;
  }
  throw new Error("unknown sourcing activation gate command");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "sourcing activation gate failed");
    process.exitCode = 1;
  });
}
