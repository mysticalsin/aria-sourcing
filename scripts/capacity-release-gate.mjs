#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import path from "node:path";

import {
  assertSafeOrigin,
  capacityDocumentSha256,
  createCapacityReceipt,
  evaluateCapacityGate,
  validateCapacityProfile,
} from "./capacity-release-gate-core.mjs";

const MAX_INPUT_BYTES = 2_000_000;
const MAX_OUTPUT_BYTES = 2_000_000;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_COOKIE_RE = /^(?:sb-auth-token(?:\.[0-9]+)?=[^;\r\n]{16,4096})(?:; sb-auth-token(?:\.[0-9]+)?=[^;\r\n]{16,4096})*$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file) {
  const bytes = readFileSync(file);
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`JSON input is empty or oversized: ${path.basename(file)}`);
  }
  return JSON.parse(bytes.toString("utf8"));
}

function writeJson(file, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error(`JSON output is oversized: ${path.basename(file)}`);
  }
  writeFileSync(file, body, { mode: 0o600 });
}

function parseTimestamp(value, label) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} is missing or invalid`);
  }
  return Date.parse(value);
}

function validateSyntheticTenant(profile, tenantId) {
  if (
    typeof tenantId !== "string"
    || !tenantId.startsWith(profile.safety.syntheticTenantPrefix)
    || tenantId.length > 100
  ) {
    throw new Error("synthetic tenant id is missing or invalid");
  }
  return tenantId;
}

function validateAuthCookie(profile, authCookie) {
  const authRequired = profile.httpScenarios.some(
    (scenario) => scenario.authentication === "synthetic-session-cookie",
  );
  if (authRequired && (typeof authCookie !== "string" || !AUTH_COOKIE_RE.test(authCookie))) {
    throw new Error("synthetic session cookie is missing or invalid");
  }
  return authCookie;
}

export function validateSyntheticTenantAttestation({
  profile: profileInput,
  origin: originInput,
  syntheticTenantId,
  authCookie,
  attestation: attestationInput,
  now = new Date().toISOString(),
}) {
  const profile = validateCapacityProfile(profileInput);
  if (profile.assumptions.ratification.status !== "approved") {
    throw new Error("profile assumptions are not owner-ratified");
  }
  const origin = assertSafeOrigin(originInput, profile.safety.allowedOrigins);
  validateSyntheticTenant(profile, syntheticTenantId);
  validateAuthCookie(profile, authCookie);
  const attestation = structuredClone(attestationInput);
  const expectedKeys = [
    "approvedAt",
    "approvedBy",
    "dataClassification",
    "environment",
    "expiresAt",
    "externalEffects",
    "kind",
    "origin",
    "profileId",
    "schemaVersion",
    "sessionCookieSha256",
    "syntheticTenantId",
    "workspaceId",
  ].sort();
  if (!isRecord(attestation) || Object.keys(attestation).sort().join("\n") !== expectedKeys.join("\n")) {
    throw new Error("synthetic tenant attestation has missing or unexpected fields");
  }
  if (
    attestation.schemaVersion !== 1
    || attestation.kind !== "aria-capacity-synthetic-tenant-attestation"
    || attestation.environment !== "staging"
    || attestation.profileId !== profile.profileId
    || attestation.origin !== origin
    || attestation.syntheticTenantId !== syntheticTenantId
    || !UUID_RE.test(attestation.workspaceId ?? "")
    || attestation.dataClassification !== "synthetic-only"
    || attestation.externalEffects !== "forbidden"
    || typeof attestation.approvedBy !== "string"
    || attestation.approvedBy.length < 3
    || attestation.approvedBy.length > 200
    || !SHA256_RE.test(attestation.sessionCookieSha256 ?? "")
  ) {
    throw new Error("synthetic tenant attestation identity or safety declaration is invalid");
  }
  const actualCookieSha256 = createHash("sha256").update(authCookie).digest("hex");
  if (actualCookieSha256 !== attestation.sessionCookieSha256) {
    throw new Error("synthetic tenant attestation cookie digest does not match");
  }
  const approvedAt = parseTimestamp(attestation.approvedAt, "attestation.approvedAt");
  const expiresAt = parseTimestamp(attestation.expiresAt, "attestation.expiresAt");
  const currentTime = parseTimestamp(now, "attestation verification time");
  if (
    approvedAt > currentTime
    || expiresAt <= currentTime
    || expiresAt <= approvedAt
    || expiresAt - approvedAt > 86_400_000
  ) {
    throw new Error("synthetic tenant attestation is not currently valid or exceeds 24 hours");
  }
  return {
    syntheticTenantId,
    workspaceId: attestation.workspaceId,
    expiresAt: attestation.expiresAt,
    attestationSha256: capacityDocumentSha256(attestation),
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scenarioForBucket(scenarios, bucket) {
  let cursor = 0;
  for (const scenario of scenarios) {
    cursor += scenario.weight;
    if (bucket < cursor) return scenario;
  }
  return scenarios.at(-1);
}

export function buildRequestPlan(profileInput, totalRequests) {
  const profile = validateCapacityProfile(profileInput);
  if (!Number.isSafeInteger(totalRequests) || totalRequests < 1 || totalRequests > 360_000) {
    throw new Error("totalRequests must be an integer from 1 to 360000");
  }
  return Array.from({ length: totalRequests }, (_, index) => ({
    index,
    scheduledOffsetMs: index * 1_000 / profile.execution.targetRequestsPerSecond,
    scenario: structuredClone(scenarioForBucket(profile.httpScenarios, (index % 100) + 0.5)),
  }));
}

async function consumeBounded(response, maximumBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    throw new Error("response exceeded the configured byte limit");
  }
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        throw new Error("response exceeded the configured byte limit");
      }
    }
  } finally {
    if (bytes > maximumBytes) await reader.cancel();
    reader.releaseLock();
  }
  return bytes;
}

async function stagingReadRequest({ origin, scenario, authCookie, syntheticTenantId, timeoutMs, maxResponseBytes }) {
  const headers = {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "User-Agent": "ARIA-Capacity-Gate/1",
    "X-Aria-Capacity-Synthetic-Tenant": syntheticTenantId,
  };
  if (scenario.authentication === "synthetic-session-cookie") headers.Cookie = authCookie;
  const response = await fetch(new URL(scenario.path, origin), {
    method: scenario.method,
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responseBytes = await consumeBounded(response, maxResponseBytes);
  return { status: response.status, responseBytes };
}

export async function runRequestPlan({
  profile: profileInput,
  origin: originInput,
  plan,
  authCookie,
  syntheticTenantId,
  request = stagingReadRequest,
}) {
  const profile = validateCapacityProfile(profileInput);
  const origin = assertSafeOrigin(originInput, profile.safety.allowedOrigins);
  validateSyntheticTenant(profile, syntheticTenantId);
  validateAuthCookie(profile, authCookie);
  if (!Array.isArray(plan) || plan.length < 1 || plan.length > 360_000) {
    throw new Error("request plan is empty or oversized");
  }
  const scenarios = new Map(profile.httpScenarios.map((scenario) => [scenario.id, scenario]));
  for (const [index, entry] of plan.entries()) {
    if (
      !isRecord(entry)
      || entry.index !== index
      || typeof entry.scheduledOffsetMs !== "number"
      || !Number.isFinite(entry.scheduledOffsetMs)
      || entry.scheduledOffsetMs < 0
      || !scenarios.has(entry.scenario?.id)
    ) {
      throw new Error("request plan contains an invalid entry");
    }
  }

  const results = Object.fromEntries(profile.httpScenarios.map((scenario) => [
    scenario.id,
    { latenciesMs: [], errors: 0 },
  ]));
  const startedAt = performance.now();
  let cursor = 0;
  async function worker() {
    for (;;) {
      const position = cursor;
      cursor += 1;
      if (position >= plan.length) return;
      const entry = plan[position];
      const waitMs = startedAt + entry.scheduledOffsetMs - performance.now();
      if (waitMs > 0) await sleep(waitMs);
      const scenario = scenarios.get(entry.scenario.id);
      const requestStartedAt = performance.now();
      let failed = false;
      try {
        const response = await request({
          origin,
          scenario,
          authCookie: scenario.authentication === "synthetic-session-cookie" ? authCookie : undefined,
          syntheticTenantId,
          timeoutMs: profile.execution.requestTimeoutMs,
          maxResponseBytes: profile.execution.maxResponseBytes,
        });
        if (
          !isRecord(response)
          || !Number.isSafeInteger(response.status)
          || !Number.isSafeInteger(response.responseBytes)
          || response.responseBytes < 0
          || response.responseBytes > profile.execution.maxResponseBytes
          || !scenario.expectedStatuses.includes(response.status)
        ) {
          failed = true;
        }
      } catch {
        failed = true;
      }
      const elapsed = Math.max(0, performance.now() - requestStartedAt);
      results[scenario.id].latenciesMs.push(Math.round(elapsed * 1_000) / 1_000);
      if (failed) results[scenario.id].errors += 1;
    }
  }
  const workers = Math.min(profile.execution.maxInFlight, plan.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function validateObservationIdentity(profile, observation, expectedKind, label) {
  if (
    !isRecord(observation)
    || observation.schemaVersion !== 1
    || observation.evidenceKind !== expectedKind
    || observation.environment !== "staging"
    || !RELEASE_SHA_RE.test(observation.releaseSha ?? "")
    || !SHA256_RE.test(observation.syntheticTenantAttestationSha256 ?? "")
  ) {
    throw new Error(`${label} identity is missing or invalid`);
  }
  assertSafeOrigin(observation.origin, profile.safety.allowedOrigins);
  validateSyntheticTenant(profile, observation.syntheticTenantId);
  const start = parseTimestamp(observation.windowStartedAt, `${label}.windowStartedAt`);
  const end = parseTimestamp(observation.windowEndedAt, `${label}.windowEndedAt`);
  if (end <= start || end - start > 4_000_000) throw new Error(`${label} observation window is invalid`);
  return { start, end };
}

export function mergeStagingObservation({ profile: profileInput, httpObservation, operationalMetrics }) {
  const profile = validateCapacityProfile(profileInput);
  if (profile.assumptions.ratification.status !== "approved") {
    throw new Error("profile assumptions are not owner-ratified");
  }
  const httpWindow = validateObservationIdentity(
    profile,
    httpObservation,
    "staging-http-observation",
    "HTTP observation",
  );
  const metricsWindow = validateObservationIdentity(
    profile,
    operationalMetrics,
    "staging-operational-metrics",
    "operational metrics",
  );
  const expectedDurationMs = profile.execution.durationSeconds * 1_000;
  const observedDurationMs = httpWindow.end - httpWindow.start;
  const durationToleranceMs = Math.max(5_000, expectedDurationMs * 0.1);
  if (Math.abs(observedDurationMs - expectedDurationMs) > durationToleranceMs) {
    throw new Error("HTTP observation duration does not match the ratified profile");
  }
  for (const field of ["origin", "syntheticTenantId", "syntheticTenantAttestationSha256", "releaseSha"]) {
    if (httpObservation[field] !== operationalMetrics[field]) {
      throw new Error(`operational metrics are ${field === "releaseSha" ? "release-mismatched" : `${field}-mismatched`}`);
    }
  }
  if (metricsWindow.start > httpWindow.start || metricsWindow.end < httpWindow.end) {
    throw new Error("operational metrics do not cover the HTTP observation window");
  }
  if (metricsWindow.end - metricsWindow.start > expectedDurationMs + 600_000) {
    throw new Error("operational metrics window is too broad for the ratified profile");
  }
  if (!isRecord(httpObservation.http)) throw new Error("HTTP observation metrics are missing");
  if (
    !isRecord(operationalMetrics.queue)
    || !isRecord(operationalMetrics.faults)
    || !isRecord(operationalMetrics.resources)
  ) {
    throw new Error("operational queue, fault, or resource metrics are missing");
  }
  return {
    schemaVersion: 1,
    evidenceKind: "staging-observation",
    environment: "staging",
    origin: httpObservation.origin,
    syntheticTenantId: httpObservation.syntheticTenantId,
    syntheticTenantAttestationSha256: httpObservation.syntheticTenantAttestationSha256,
    releaseSha: httpObservation.releaseSha,
    capturedAt: operationalMetrics.windowEndedAt,
    http: structuredClone(httpObservation.http),
    queue: structuredClone(operationalMetrics.queue),
    faults: structuredClone(operationalMetrics.faults),
    resources: structuredClone(operationalMetrics.resources),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw new Error("capacity command is required");
  const flags = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!/^--[a-z][a-z-]*$/.test(flag ?? "") || value === undefined || value.startsWith("--")) {
      throw new Error("capacity arguments must be --name value pairs");
    }
    const name = flag.slice(2);
    if (Object.hasOwn(flags, name)) throw new Error(`capacity argument is duplicated: ${flag}`);
    flags[name] = value;
  }
  return { command, flags };
}

function requireFlags(flags, required, allowed = required) {
  for (const name of required) {
    if (!flags[name]) throw new Error(`--${name} is required`);
  }
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) throw new Error(`unexpected capacity argument: --${name}`);
  }
}

async function main(argv) {
  const { command, flags } = parseArgs(argv);
  if (command === "validate-profile") {
    requireFlags(flags, ["profile"]);
    const profile = validateCapacityProfile(readJson(flags.profile));
    process.stdout.write(`${JSON.stringify({
      ok: true,
      profileId: profile.profileId,
      classification: profile.assumptions.classification,
      ratification: profile.assumptions.ratification.status,
      registeredUsers: profile.assumptions.registeredUsers,
      peakConcurrentSessions: profile.assumptions.peakConcurrentSessions,
    })}\n`);
    return;
  }
  if (command === "evaluate-fixture") {
    requireFlags(flags, ["profile", "evidence", "receipt"]);
    const profile = validateCapacityProfile(readJson(flags.profile));
    const evidence = readJson(flags.evidence);
    if (evidence.evidenceKind !== "synthetic-fixture") throw new Error("evaluate-fixture requires synthetic fixture evidence");
    const evaluation = evaluateCapacityGate(profile, evidence);
    const receipt = createCapacityReceipt({ profile, evidence, evaluation, generatedAt: new Date().toISOString() });
    writeJson(flags.receipt, receipt);
    process.stdout.write(`${JSON.stringify({ ok: evaluation.passed, decision: receipt.decision, capacityClaim: receipt.capacityClaim })}\n`);
    if (!evaluation.passed) process.exitCode = 1;
    return;
  }
  if (command === "probe") {
    requireFlags(flags, ["profile", "origin", "allow-origin", "release-sha", "tenant-attestation", "output"]);
    const profile = validateCapacityProfile(readJson(flags.profile));
    if (profile.assumptions.ratification.status !== "approved") throw new Error("profile assumptions are not owner-ratified");
    const origin = assertSafeOrigin(flags.origin, profile.safety.allowedOrigins);
    assertSafeOrigin(origin, [flags["allow-origin"]]);
    if (!RELEASE_SHA_RE.test(flags["release-sha"])) throw new Error("--release-sha must be 40 lowercase hex characters");
    const authCookie = process.env[profile.safety.authCookieEnv];
    const syntheticTenantId = process.env[profile.safety.syntheticTenantEnv];
    const tenantAttestation = validateSyntheticTenantAttestation({
      profile,
      origin,
      syntheticTenantId,
      authCookie,
      attestation: readJson(flags["tenant-attestation"]),
    });
    const totalRequests = Math.ceil(profile.execution.durationSeconds * profile.execution.targetRequestsPerSecond);
    const plan = buildRequestPlan(profile, totalRequests);
    const windowStartedAt = new Date().toISOString();
    const http = await runRequestPlan({ profile, origin, plan, authCookie, syntheticTenantId });
    const windowEndedAt = new Date().toISOString();
    writeJson(flags.output, {
      schemaVersion: 1,
      evidenceKind: "staging-http-observation",
      environment: "staging",
      origin,
      syntheticTenantId,
      syntheticTenantAttestationSha256: tenantAttestation.attestationSha256,
      releaseSha: flags["release-sha"],
      windowStartedAt,
      windowEndedAt,
      http,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, output: flags.output, requests: totalRequests })}\n`);
    return;
  }
  if (command === "gate") {
    requireFlags(flags, ["profile", "http", "metrics", "receipt"]);
    const profile = validateCapacityProfile(readJson(flags.profile));
    const evidence = mergeStagingObservation({
      profile,
      httpObservation: readJson(flags.http),
      operationalMetrics: readJson(flags.metrics),
    });
    const evaluation = evaluateCapacityGate(profile, evidence);
    const receipt = createCapacityReceipt({ profile, evidence, evaluation, generatedAt: new Date().toISOString() });
    writeJson(flags.receipt, receipt);
    process.stdout.write(`${JSON.stringify({ ok: evaluation.passed, decision: receipt.decision, capacityClaim: receipt.capacityClaim })}\n`);
    if (!evaluation.passed) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown capacity command: ${command}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`capacity gate failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
