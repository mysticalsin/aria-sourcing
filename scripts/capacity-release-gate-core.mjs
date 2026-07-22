import { createHash, timingSafeEqual } from "node:crypto";

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{2,79}-v[1-9][0-9]*$/;
const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,79}$/;
const SCENARIO_ID_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SYNTHETIC_PREFIX_RE = /^synthetic-[a-z0-9-]{3,48}-$/;
const RATIFICATION_STATUSES = new Set(["pending-owner", "approved"]);
const EVIDENCE_KINDS = new Set(["staging-observation", "synthetic-fixture"]);
const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);
const SAFE_READ_PATHS = new Set([
  "/api/agents/memories",
  "/api/agents/specs",
  "/api/candidates",
  "/api/health",
  "/api/ready",
  "/api/swarm/missions",
]);
const PRODUCTION_HOSTS = new Set([
  "aria-mantu-app.fly.dev",
]);
const STAGING_MARKER_RE = /(?:^|[.-])(staging|stage|preprod|preview|test|testing|qa)(?:[.-]|$)/i;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) {
    throw new Error(`${label} has missing or unexpected fields`);
  }
}

function finiteNumber(value, label, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} to ${maximum}`);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function nonEmptyString(value, label, maximum = 500) {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function isoTimestamp(value, label) {
  nonEmptyString(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO UTC timestamp`);
  }
  return value;
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

function sha256Canonical(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function capacityDocumentSha256(value) {
  return sha256Canonical(value);
}

function validateThresholds(value, label) {
  exactKeys(value, ["minimumSamples", "p95Ms", "p99Ms", "maximumErrorRate"], label);
  integer(value.minimumSamples, `${label}.minimumSamples`, 10, 1_000_000);
  finiteNumber(value.p95Ms, `${label}.p95Ms`, 1, 120_000);
  finiteNumber(value.p99Ms, `${label}.p99Ms`, value.p95Ms, 120_000);
  finiteNumber(value.maximumErrorRate, `${label}.maximumErrorRate`, 0, 0.05);
}

function validateHttpScenario(value, index) {
  const label = `httpScenarios[${index}]`;
  exactKeys(
    value,
    ["id", "method", "path", "weight", "authentication", "expectedStatuses", "thresholds"],
    label,
  );
  if (!SCENARIO_ID_RE.test(value.id ?? "")) throw new Error(`${label}.id is invalid`);
  if (!READ_ONLY_METHODS.has(value.method)) throw new Error(`${label}.method must be GET or HEAD`);
  nonEmptyString(value.path, `${label}.path`, 300);
  if (!value.path.startsWith("/") || value.path.startsWith("//") || value.path.includes("#")) {
    throw new Error(`${label}.path must be a relative HTTP path`);
  }
  const parsed = new URL(value.path, "https://capacity.invalid");
  if (!SAFE_READ_PATHS.has(parsed.pathname)) {
    throw new Error(`${label}.path is not in the read-only capacity allowlist`);
  }
  if (parsed.pathname === "/api/candidates") {
    const allowedParams = new Set(["limit", "offset", "sort"]);
    if ([...parsed.searchParams.keys()].some((key) => !allowedParams.has(key))) {
      throw new Error(`${label}.path contains an unsafe candidate query`);
    }
  } else if (parsed.search) {
    throw new Error(`${label}.path may not include query parameters`);
  }
  integer(value.weight, `${label}.weight`, 1, 100);
  if (value.authentication !== "none" && value.authentication !== "synthetic-session-cookie") {
    throw new Error(`${label}.authentication is invalid`);
  }
  if (
    !Array.isArray(value.expectedStatuses)
    || value.expectedStatuses.length < 1
    || value.expectedStatuses.length > 5
    || new Set(value.expectedStatuses).size !== value.expectedStatuses.length
  ) {
    throw new Error(`${label}.expectedStatuses must be a non-empty unique array`);
  }
  for (const status of value.expectedStatuses) {
    integer(status, `${label}.expectedStatuses`, 200, 399);
  }
  validateThresholds(value.thresholds, `${label}.thresholds`);
}

function canonicalOrigin(value, label) {
  nonEmptyString(value, label, 300);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${label} must be a credential-free HTTPS origin`);
  }
  return parsed.origin;
}

export function validateCapacityProfile(input) {
  const profile = structuredClone(input);
  exactKeys(
    profile,
    [
      "schemaVersion",
      "profileId",
      "description",
      "assumptions",
      "safety",
      "execution",
      "httpScenarios",
      "queueThresholds",
      "faultThresholds",
      "resourceThresholds",
    ],
    "profile",
  );
  if (profile.schemaVersion !== 1) throw new Error("profile.schemaVersion must equal 1");
  if (!PROFILE_ID_RE.test(profile.profileId ?? "")) throw new Error("profile.profileId is invalid");
  nonEmptyString(profile.description, "profile.description", 500);

  exactKeys(
    profile.assumptions,
    [
      "classification",
      "registeredUsers",
      "peakConcurrentSessions",
      "requestsPerActiveSessionPerMinute",
      "targetRequestsPerSecond",
      "ratification",
    ],
    "profile.assumptions",
  );
  if (profile.assumptions.classification !== "planning-assumption-unmeasured") {
    throw new Error("profile.assumptions.classification must state that it is unmeasured");
  }
  integer(profile.assumptions.registeredUsers, "profile.assumptions.registeredUsers", 1, 1_000_000);
  integer(
    profile.assumptions.peakConcurrentSessions,
    "profile.assumptions.peakConcurrentSessions",
    1,
    1_000_000,
  );
  if (profile.assumptions.peakConcurrentSessions > profile.assumptions.registeredUsers) {
    throw new Error("profile.assumptions.peakConcurrentSessions may not exceed registeredUsers");
  }
  finiteNumber(
    profile.assumptions.requestsPerActiveSessionPerMinute,
    "profile.assumptions.requestsPerActiveSessionPerMinute",
    0.01,
    120,
  );
  finiteNumber(profile.assumptions.targetRequestsPerSecond, "profile.assumptions.targetRequestsPerSecond", 0.01, 100);
  const derivedRequestsPerSecond = (
    profile.assumptions.peakConcurrentSessions
    * profile.assumptions.requestsPerActiveSessionPerMinute
    / 60
  );
  if (Math.abs(derivedRequestsPerSecond - profile.assumptions.targetRequestsPerSecond) > 0.01) {
    throw new Error("profile.assumptions.targetRequestsPerSecond does not match the session assumptions");
  }
  exactKeys(profile.assumptions.ratification, ["status", "approvedBy", "approvedAt"], "profile.assumptions.ratification");
  if (!RATIFICATION_STATUSES.has(profile.assumptions.ratification.status)) {
    throw new Error("profile.assumptions.ratification.status is invalid");
  }
  if (profile.assumptions.ratification.status === "approved") {
    nonEmptyString(profile.assumptions.ratification.approvedBy, "profile.assumptions.ratification.approvedBy", 200);
    isoTimestamp(profile.assumptions.ratification.approvedAt, "profile.assumptions.ratification.approvedAt");
  } else if (
    profile.assumptions.ratification.approvedBy !== null
    || profile.assumptions.ratification.approvedAt !== null
  ) {
    throw new Error("pending profile assumptions may not name an approver");
  }

  exactKeys(
    profile.safety,
    ["allowedOrigins", "syntheticTenantPrefix", "authCookieEnv", "syntheticTenantEnv"],
    "profile.safety",
  );
  if (
    !Array.isArray(profile.safety.allowedOrigins)
    || profile.safety.allowedOrigins.length < 1
    || profile.safety.allowedOrigins.length > 10
  ) {
    throw new Error("profile.safety.allowedOrigins must contain one to ten origins");
  }
  profile.safety.allowedOrigins = profile.safety.allowedOrigins.map((origin, index) =>
    canonicalOrigin(origin, `profile.safety.allowedOrigins[${index}]`));
  if (new Set(profile.safety.allowedOrigins).size !== profile.safety.allowedOrigins.length) {
    throw new Error("profile.safety.allowedOrigins contains duplicates");
  }
  for (const origin of profile.safety.allowedOrigins) assertSafeOrigin(origin, profile.safety.allowedOrigins);
  if (!SYNTHETIC_PREFIX_RE.test(profile.safety.syntheticTenantPrefix ?? "")) {
    throw new Error("profile.safety.syntheticTenantPrefix is invalid");
  }
  if (!ENV_NAME_RE.test(profile.safety.authCookieEnv ?? "")) {
    throw new Error("profile.safety.authCookieEnv is invalid");
  }
  if (!ENV_NAME_RE.test(profile.safety.syntheticTenantEnv ?? "")) {
    throw new Error("profile.safety.syntheticTenantEnv is invalid");
  }
  if (profile.safety.authCookieEnv === profile.safety.syntheticTenantEnv) {
    throw new Error("profile safety environment variable names must be distinct");
  }

  exactKeys(
    profile.execution,
    ["durationSeconds", "targetRequestsPerSecond", "maxInFlight", "requestTimeoutMs", "maxResponseBytes"],
    "profile.execution",
  );
  integer(profile.execution.durationSeconds, "profile.execution.durationSeconds", 30, 3_600);
  finiteNumber(profile.execution.targetRequestsPerSecond, "profile.execution.targetRequestsPerSecond", 0.01, 100);
  if (Math.abs(profile.execution.targetRequestsPerSecond - profile.assumptions.targetRequestsPerSecond) > 0.001) {
    throw new Error("profile.execution.targetRequestsPerSecond must equal the assumption");
  }
  integer(profile.execution.maxInFlight, "profile.execution.maxInFlight", 1, 200);
  integer(profile.execution.requestTimeoutMs, "profile.execution.requestTimeoutMs", 100, 30_000);
  integer(profile.execution.maxResponseBytes, "profile.execution.maxResponseBytes", 1_024, 65_536);

  if (!Array.isArray(profile.httpScenarios) || profile.httpScenarios.length < 3 || profile.httpScenarios.length > 20) {
    throw new Error("profile.httpScenarios must contain three to twenty read-only scenarios");
  }
  profile.httpScenarios.forEach(validateHttpScenario);
  const scenarioIds = profile.httpScenarios.map((scenario) => scenario.id);
  if (new Set(scenarioIds).size !== scenarioIds.length) throw new Error("profile.httpScenarios contains duplicate ids");
  if (!scenarioIds.includes("health") || !scenarioIds.includes("readiness")) {
    throw new Error("profile.httpScenarios must include health and readiness");
  }
  if (!profile.httpScenarios.some((scenario) => scenario.authentication === "synthetic-session-cookie")) {
    throw new Error("profile.httpScenarios must include an authenticated synthetic read");
  }
  if (profile.httpScenarios.reduce((total, scenario) => total + scenario.weight, 0) !== 100) {
    throw new Error("profile.httpScenarios weights must total 100");
  }

  exactKeys(
    profile.queueThresholds,
    ["minimumSamples", "p95AgeMs", "maximumAgeMs", "maximumDuplicateDeliveries"],
    "profile.queueThresholds",
  );
  integer(profile.queueThresholds.minimumSamples, "profile.queueThresholds.minimumSamples", 10, 1_000_000);
  finiteNumber(profile.queueThresholds.p95AgeMs, "profile.queueThresholds.p95AgeMs", 1, 86_400_000);
  finiteNumber(
    profile.queueThresholds.maximumAgeMs,
    "profile.queueThresholds.maximumAgeMs",
    profile.queueThresholds.p95AgeMs,
    86_400_000,
  );
  integer(
    profile.queueThresholds.maximumDuplicateDeliveries,
    "profile.queueThresholds.maximumDuplicateDeliveries",
    0,
    1_000,
  );

  exactKeys(
    profile.faultThresholds,
    ["requiredScenarios", "maximumRecoveryMs", "maximumErrorRate"],
    "profile.faultThresholds",
  );
  if (
    !Array.isArray(profile.faultThresholds.requiredScenarios)
    || profile.faultThresholds.requiredScenarios.length < 3
    || profile.faultThresholds.requiredScenarios.length > 20
    || new Set(profile.faultThresholds.requiredScenarios).size !== profile.faultThresholds.requiredScenarios.length
    || profile.faultThresholds.requiredScenarios.some((id) => !SCENARIO_ID_RE.test(id))
  ) {
    throw new Error("profile.faultThresholds.requiredScenarios is invalid");
  }
  if (!profile.faultThresholds.requiredScenarios.includes("provider-timeout-no-contact")) {
    throw new Error("profile requires the provider-timeout-no-contact fault scenario");
  }
  finiteNumber(profile.faultThresholds.maximumRecoveryMs, "profile.faultThresholds.maximumRecoveryMs", 1, 600_000);
  finiteNumber(profile.faultThresholds.maximumErrorRate, "profile.faultThresholds.maximumErrorRate", 0, 0.1);

  exactKeys(
    profile.resourceThresholds,
    [
      "maximumCpuPercent",
      "maximumMemoryPercent",
      "maximumDatabaseConnectionsPercent",
      "minimumHeadroomPercent",
    ],
    "profile.resourceThresholds",
  );
  finiteNumber(profile.resourceThresholds.maximumCpuPercent, "profile.resourceThresholds.maximumCpuPercent", 1, 99);
  finiteNumber(profile.resourceThresholds.maximumMemoryPercent, "profile.resourceThresholds.maximumMemoryPercent", 1, 99);
  finiteNumber(
    profile.resourceThresholds.maximumDatabaseConnectionsPercent,
    "profile.resourceThresholds.maximumDatabaseConnectionsPercent",
    1,
    99,
  );
  finiteNumber(profile.resourceThresholds.minimumHeadroomPercent, "profile.resourceThresholds.minimumHeadroomPercent", 1, 99);
  for (const [name, maximum] of [
    ["CPU", profile.resourceThresholds.maximumCpuPercent],
    ["memory", profile.resourceThresholds.maximumMemoryPercent],
    ["database connections", profile.resourceThresholds.maximumDatabaseConnectionsPercent],
  ]) {
    if (100 - maximum < profile.resourceThresholds.minimumHeadroomPercent) {
      throw new Error(`profile ${name} threshold does not preserve minimum headroom`);
    }
  }
  return profile;
}

export function assertSafeOrigin(input, allowedOrigins) {
  const origin = canonicalOrigin(input, "origin");
  const hostname = new URL(origin).hostname.toLowerCase();
  if (
    PRODUCTION_HOSTS.has(hostname)
    || /(?:^|[.-])(prod|production)(?:[.-]|$)/i.test(hostname)
  ) {
    throw new Error("capacity execution refuses a production origin");
  }
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.includes(origin)) {
    throw new Error("capacity origin is not explicitly allowlisted");
  }
  if (!STAGING_MARKER_RE.test(hostname)) {
    throw new Error("capacity origin hostname lacks a staging marker");
  }
  return origin;
}

export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile requires a non-empty array");
  finiteNumber(quantile, "quantile", Number.EPSILON, 1);
  const numbers = values.map((value, index) => finiteNumber(value, `values[${index}]`, 0, 600_000));
  numbers.sort((left, right) => left - right);
  return numbers[Math.ceil(quantile * numbers.length) - 1];
}

function observedNumbers(value, label, failures, minimumSamples) {
  if (!Array.isArray(value) || value.length < minimumSamples) {
    failures.push(`${label} requires at least ${minimumSamples} samples`);
    return [];
  }
  if (value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 600_000)) {
    failures.push(`${label} contains an invalid sample`);
    return [];
  }
  return [...value];
}

function observedPercent(value, label, failures) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    failures.push(`${label} is missing or invalid`);
    return null;
  }
  return value;
}

function rounded(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function evaluateCapacityGate(profileInput, evidenceInput) {
  const profile = validateCapacityProfile(profileInput);
  const evidence = structuredClone(evidenceInput);
  const failures = [];
  const summary = { http: {}, queue: {}, faults: {}, resources: {} };

  if (!isRecord(evidence) || evidence.schemaVersion !== 1) failures.push("evidence schemaVersion is missing or invalid");
  if (!EVIDENCE_KINDS.has(evidence?.evidenceKind)) failures.push("evidenceKind is missing or invalid");
  const expectedEnvironment = evidence?.evidenceKind === "synthetic-fixture" ? "offline-fixture" : "staging";
  if (evidence?.environment !== expectedEnvironment) failures.push("evidence environment does not match its kind");
  try {
    assertSafeOrigin(evidence?.origin, profile.safety.allowedOrigins);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "evidence origin is unsafe");
  }
  if (
    typeof evidence?.syntheticTenantId !== "string"
    || !evidence.syntheticTenantId.startsWith(profile.safety.syntheticTenantPrefix)
    || evidence.syntheticTenantId.length > 100
  ) {
    failures.push("syntheticTenantId is missing or does not match the required prefix");
  }
  if (!/^[0-9a-f]{64}$/.test(evidence?.syntheticTenantAttestationSha256 ?? "")) {
    failures.push("syntheticTenantAttestationSha256 is missing or invalid");
  }
  if (!RELEASE_SHA_RE.test(evidence?.releaseSha ?? "")) failures.push("releaseSha is missing or invalid");
  try {
    isoTimestamp(evidence?.capturedAt, "capturedAt");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "capturedAt is invalid");
  }
  if (
    evidence?.evidenceKind === "staging-observation"
    && profile.assumptions.ratification.status !== "approved"
  ) {
    failures.push("profile assumptions are not owner-ratified");
  }

  for (const scenario of profile.httpScenarios) {
    const observed = evidence?.http?.[scenario.id];
    const scenarioSummary = {
      samples: 0,
      errors: null,
      errorRate: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    };
    summary.http[scenario.id] = scenarioSummary;
    if (!isRecord(observed)) {
      failures.push(`HTTP scenario ${scenario.id} is missing`);
      continue;
    }
    const latencies = observedNumbers(
      observed.latenciesMs,
      `HTTP scenario ${scenario.id}`,
      failures,
      scenario.thresholds.minimumSamples,
    );
    const errors = Number.isSafeInteger(observed.errors) && observed.errors >= 0 ? observed.errors : null;
    if (errors === null || errors > latencies.length) failures.push(`HTTP scenario ${scenario.id} errors is missing or invalid`);
    scenarioSummary.samples = latencies.length;
    scenarioSummary.errors = errors;
    if (latencies.length > 0 && errors !== null && errors <= latencies.length) {
      scenarioSummary.errorRate = rounded(errors / latencies.length);
      scenarioSummary.p50Ms = percentile(latencies, 0.5);
      scenarioSummary.p95Ms = percentile(latencies, 0.95);
      scenarioSummary.p99Ms = percentile(latencies, 0.99);
      if (scenarioSummary.p95Ms > scenario.thresholds.p95Ms) failures.push(`HTTP scenario ${scenario.id} p95 breached`);
      if (scenarioSummary.p99Ms > scenario.thresholds.p99Ms) failures.push(`HTTP scenario ${scenario.id} p99 breached`);
      if (scenarioSummary.errorRate > scenario.thresholds.maximumErrorRate) {
        failures.push(`HTTP scenario ${scenario.id} error rate breached`);
      }
    }
  }

  const queueAges = observedNumbers(
    evidence?.queue?.agesMs,
    "queue age",
    failures,
    profile.queueThresholds.minimumSamples,
  );
  const duplicateDeliveries = Number.isSafeInteger(evidence?.queue?.duplicateDeliveries)
    && evidence.queue.duplicateDeliveries >= 0
    ? evidence.queue.duplicateDeliveries
    : null;
  summary.queue = {
    samples: queueAges.length,
    p95AgeMs: queueAges.length > 0 ? percentile(queueAges, 0.95) : null,
    maximumAgeMs: queueAges.length > 0 ? Math.max(...queueAges) : null,
    duplicateDeliveries,
  };
  if (duplicateDeliveries === null) failures.push("queue duplicate deliveries metric is missing or invalid");
  if (summary.queue.p95AgeMs !== null && summary.queue.p95AgeMs > profile.queueThresholds.p95AgeMs) {
    failures.push("queue p95 age breached");
  }
  if (summary.queue.maximumAgeMs !== null && summary.queue.maximumAgeMs > profile.queueThresholds.maximumAgeMs) {
    failures.push("queue maximum age breached");
  }
  if (
    duplicateDeliveries !== null
    && duplicateDeliveries > profile.queueThresholds.maximumDuplicateDeliveries
  ) {
    failures.push("queue duplicate deliveries breached");
  }

  for (const scenarioId of profile.faultThresholds.requiredScenarios) {
    const observed = evidence?.faults?.[scenarioId];
    if (!isRecord(observed)) {
      failures.push(`fault scenario ${scenarioId} is missing`);
      summary.faults[scenarioId] = null;
      continue;
    }
    const recoveryMs = typeof observed.recoveryMs === "number" && Number.isFinite(observed.recoveryMs)
      ? observed.recoveryMs
      : null;
    const errorRate = typeof observed.errorRate === "number" && Number.isFinite(observed.errorRate)
      ? observed.errorRate
      : null;
    summary.faults[scenarioId] = {
      injected: observed.injected === true,
      recovered: observed.recovered === true,
      recoveryMs,
      errorRate,
      ...(scenarioId === "provider-timeout-no-contact"
        ? { externalContacts: observed.externalContacts ?? null }
        : {}),
    };
    if (observed.injected !== true) failures.push(`fault scenario ${scenarioId} was not injected`);
    if (observed.recovered !== true) failures.push(`fault scenario ${scenarioId} did not recover`);
    if (recoveryMs === null || recoveryMs < 0) failures.push(`fault scenario ${scenarioId} recoveryMs is missing or invalid`);
    else if (recoveryMs > profile.faultThresholds.maximumRecoveryMs) failures.push(`fault scenario ${scenarioId} recovery breached`);
    if (errorRate === null || errorRate < 0 || errorRate > 1) {
      failures.push(`fault scenario ${scenarioId} errorRate is missing or invalid`);
    } else if (errorRate > profile.faultThresholds.maximumErrorRate) {
      failures.push(`fault scenario ${scenarioId} error rate breached`);
    }
    if (
      scenarioId === "provider-timeout-no-contact"
      && (!Number.isSafeInteger(observed.externalContacts) || observed.externalContacts !== 0)
    ) {
      failures.push("provider timeout fault produced external contacts");
    }
  }

  const cpu = observedPercent(evidence?.resources?.cpuPeakPercent, "resources.cpuPeakPercent", failures);
  const memory = observedPercent(evidence?.resources?.memoryPeakPercent, "resources.memoryPeakPercent", failures);
  const databaseConnections = observedPercent(
    evidence?.resources?.databaseConnectionsPeakPercent,
    "resources.databaseConnectionsPeakPercent",
    failures,
  );
  const resourceValues = [cpu, memory, databaseConnections].filter((value) => value !== null);
  const minimumHeadroom = resourceValues.length === 3 ? 100 - Math.max(...resourceValues) : null;
  summary.resources = {
    cpuPeakPercent: cpu,
    memoryPeakPercent: memory,
    databaseConnectionsPeakPercent: databaseConnections,
    minimumHeadroomPercent: minimumHeadroom,
  };
  if (cpu !== null && cpu > profile.resourceThresholds.maximumCpuPercent) failures.push("resource CPU threshold breached");
  if (memory !== null && memory > profile.resourceThresholds.maximumMemoryPercent) failures.push("resource memory threshold breached");
  if (
    databaseConnections !== null
    && databaseConnections > profile.resourceThresholds.maximumDatabaseConnectionsPercent
  ) {
    failures.push("resource database connections threshold breached");
  }
  if (minimumHeadroom !== null && minimumHeadroom < profile.resourceThresholds.minimumHeadroomPercent) {
    failures.push("resource minimum headroom threshold breached");
  }

  return {
    passed: failures.length === 0,
    failures,
    summary,
  };
}

export function createCapacityReceipt({ profile: profileInput, evidence: evidenceInput, evaluation, generatedAt }) {
  const profile = validateCapacityProfile(profileInput);
  const evidence = structuredClone(evidenceInput);
  isoTimestamp(generatedAt, "generatedAt");
  const actualEvaluation = evaluateCapacityGate(profile, evidence);
  if (stableJson(evaluation) !== stableJson(actualEvaluation)) {
    throw new Error("provided capacity evaluation does not match the profile and evidence");
  }
  const fixture = evidence.evidenceKind === "synthetic-fixture";
  const decision = fixture
    ? (actualEvaluation.passed ? "harness-pass" : "harness-fail")
    : (actualEvaluation.passed ? "staging-pass" : "staging-fail");
  const capacityClaim = !fixture
    && actualEvaluation.passed
    && profile.assumptions.ratification.status === "approved"
    ? "validated-for-exact-profile"
    : "not-established";
  const unsigned = {
    schemaVersion: 1,
    receiptType: "aria-capacity-release-gate",
    generatedAt,
    profileId: profile.profileId,
    profileSha256: sha256Canonical(profile),
    evidenceSha256: sha256Canonical(evidence),
    releaseSha: evidence.releaseSha,
    evidenceKind: evidence.evidenceKind,
    environment: evidence.environment,
    origin: evidence.origin,
    syntheticTenantAttestationSha256: evidence.syntheticTenantAttestationSha256,
    assumptionClassification: profile.assumptions.classification,
    registeredUsers: profile.assumptions.registeredUsers,
    peakConcurrentSessions: profile.assumptions.peakConcurrentSessions,
    decision,
    capacityClaim,
    failures: actualEvaluation.failures,
    summary: actualEvaluation.summary,
  };
  return {
    ...unsigned,
    integrity: {
      algorithm: "sha256",
      canonicalization: "sorted-json-v1",
      digest: sha256Canonical(unsigned),
    },
  };
}

export function verifyCapacityReceipt(receipt) {
  if (
    !isRecord(receipt)
    || !isRecord(receipt.integrity)
    || receipt.integrity.algorithm !== "sha256"
    || receipt.integrity.canonicalization !== "sorted-json-v1"
    || !/^[0-9a-f]{64}$/.test(receipt.integrity.digest ?? "")
  ) {
    return false;
  }
  const unsigned = structuredClone(receipt);
  delete unsigned.integrity;
  const expected = Buffer.from(sha256Canonical(unsigned), "hex");
  const actual = Buffer.from(receipt.integrity.digest, "hex");
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
