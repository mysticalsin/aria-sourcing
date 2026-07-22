import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertSafeOrigin,
  createCapacityReceipt,
  evaluateCapacityGate,
  percentile,
  validateCapacityProfile,
  verifyCapacityReceipt,
} from "../scripts/capacity-release-gate-core.mjs";
import {
  buildRequestPlan,
  mergeStagingObservation,
  runRequestPlan,
  validateSyntheticTenantAttestation,
} from "../scripts/capacity-release-gate.mjs";

const RELEASE_SHA = "a".repeat(40);
const STAGING_ORIGIN = "https://aria-capacity-staging.example.invalid";

type CapacityEvaluation = {
  passed: boolean;
  failures: string[];
  summary: {
    http: Record<string, { p95Ms: number | null }>;
    queue: { p95AgeMs: number | null };
    resources: { cpuPeakPercent: number | null; minimumHeadroomPercent: number | null };
  };
};

type CapacityReceipt = {
  decision: string;
  capacityClaim: string;
  summary: CapacityEvaluation["summary"];
};

type EvidenceFixture = {
  schemaVersion: number;
  evidenceKind: string;
  environment: string;
  origin: string;
  syntheticTenantId: string;
  syntheticTenantAttestationSha256: string;
  releaseSha: string;
  capturedAt: string;
  http: Record<string, { latenciesMs: number[]; errors: number }>;
  queue: { agesMs: number[]; duplicateDeliveries: number };
  faults: Record<string, {
    injected: boolean;
    recovered: boolean;
    recoveryMs: number;
    errorRate: number;
    externalContacts?: number;
  }>;
  resources: {
    cpuPeakPercent: number;
    memoryPeakPercent: number;
    databaseConnectionsPeakPercent?: number;
  };
};

function profile() {
  return {
    schemaVersion: 1,
    profileId: "aria-enterprise-registered-50000-v1",
    description: "Proposed staging capacity workload. These values are not measured production facts.",
    assumptions: {
      classification: "planning-assumption-unmeasured",
      registeredUsers: 50_000,
      peakConcurrentSessions: 500,
      requestsPerActiveSessionPerMinute: 2,
      targetRequestsPerSecond: 16.67,
      ratification: {
        status: "pending-owner",
        approvedBy: null as string | null,
        approvedAt: null as string | null,
      },
    },
    safety: {
      allowedOrigins: [STAGING_ORIGIN],
      syntheticTenantPrefix: "synthetic-capacity-",
      authCookieEnv: "ARIA_CAPACITY_AUTH_COOKIE",
      syntheticTenantEnv: "ARIA_CAPACITY_SYNTHETIC_TENANT_ID",
    },
    execution: {
      durationSeconds: 300,
      targetRequestsPerSecond: 16.67,
      maxInFlight: 50,
      requestTimeoutMs: 5_000,
      maxResponseBytes: 65_536,
    },
    httpScenarios: [
      {
        id: "health",
        method: "GET",
        path: "/api/health",
        weight: 10,
        authentication: "none",
        expectedStatuses: [200],
        thresholds: { minimumSamples: 10, p95Ms: 250, p99Ms: 500, maximumErrorRate: 0.001 },
      },
      {
        id: "readiness",
        method: "GET",
        path: "/api/ready",
        weight: 10,
        authentication: "none",
        expectedStatuses: [200],
        thresholds: { minimumSamples: 10, p95Ms: 750, p99Ms: 1_500, maximumErrorRate: 0.001 },
      },
      {
        id: "candidate-page-read",
        method: "GET",
        path: "/api/candidates?limit=20&offset=0",
        weight: 40,
        authentication: "synthetic-session-cookie",
        expectedStatuses: [200],
        thresholds: { minimumSamples: 10, p95Ms: 500, p99Ms: 1_000, maximumErrorRate: 0.005 },
      },
      {
        id: "agent-spec-list-read",
        method: "GET",
        path: "/api/agents/specs",
        weight: 40,
        authentication: "synthetic-session-cookie",
        expectedStatuses: [200],
        thresholds: { minimumSamples: 10, p95Ms: 500, p99Ms: 1_000, maximumErrorRate: 0.005 },
      },
    ],
    queueThresholds: {
      minimumSamples: 10,
      p95AgeMs: 60_000,
      maximumAgeMs: 120_000,
      maximumDuplicateDeliveries: 0,
    },
    faultThresholds: {
      requiredScenarios: ["database-unavailable", "queue-worker-restart", "provider-timeout-no-contact"],
      maximumRecoveryMs: 30_000,
      maximumErrorRate: 0.01,
    },
    resourceThresholds: {
      maximumCpuPercent: 70,
      maximumMemoryPercent: 75,
      maximumDatabaseConnectionsPercent: 70,
      minimumHeadroomPercent: 25,
    },
  };
}

function approvedProfile() {
  const value = profile();
  value.assumptions.ratification = {
    status: "approved",
    approvedBy: "capacity-owner@example.invalid",
    approvedAt: "2026-07-21T15:00:00.000Z",
  };
  return value;
}

function evidence(kind = "staging-observation"): EvidenceFixture {
  return {
    schemaVersion: 1,
    evidenceKind: kind,
    environment: kind === "staging-observation" ? "staging" : "offline-fixture",
    origin: STAGING_ORIGIN,
    syntheticTenantId: "synthetic-capacity-0001",
    syntheticTenantAttestationSha256: "c".repeat(64),
    releaseSha: RELEASE_SHA,
    capturedAt: "2026-07-21T16:00:00.000Z",
    http: {
      health: { latenciesMs: [50, 60, 70, 80, 90, 100, 110, 120, 130, 140], errors: 0 },
      readiness: { latenciesMs: [100, 110, 120, 130, 140, 150, 160, 170, 180, 190], errors: 0 },
      "candidate-page-read": { latenciesMs: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210], errors: 0 },
      "agent-spec-list-read": { latenciesMs: [90, 100, 110, 120, 130, 140, 150, 160, 170, 180], errors: 0 },
    },
    queue: {
      agesMs: [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000],
      duplicateDeliveries: 0,
    },
    faults: {
      "database-unavailable": { injected: true, recovered: true, recoveryMs: 5_000, errorRate: 0 },
      "queue-worker-restart": { injected: true, recovered: true, recoveryMs: 10_000, errorRate: 0 },
      "provider-timeout-no-contact": {
        injected: true,
        recovered: true,
        recoveryMs: 2_000,
        errorRate: 0,
        externalContacts: 0,
      },
    },
    resources: {
      cpuPeakPercent: 50,
      memoryPeakPercent: 60,
      databaseConnectionsPeakPercent: 55,
    },
  };
}

test("profile keeps 50,000 registered users separate from an unmeasured peak-session assumption", () => {
  const result = validateCapacityProfile(profile());
  assert.equal(result.assumptions.registeredUsers, 50_000);
  assert.equal(result.assumptions.peakConcurrentSessions, 500);
  assert.equal(result.assumptions.classification, "planning-assumption-unmeasured");
  assert.equal(result.assumptions.ratification.status, "pending-owner");
});

test("profile validation rejects unsafe methods, unbounded execution, and population contradictions", () => {
  const unsafeMethod = profile();
  unsafeMethod.httpScenarios[2].method = "POST";
  assert.throws(() => validateCapacityProfile(unsafeMethod), /GET or HEAD/);

  const unbounded = profile();
  unbounded.execution.maxInFlight = 501;
  assert.throws(() => validateCapacityProfile(unbounded), /maxInFlight/);

  const contradictory = profile();
  contradictory.assumptions.peakConcurrentSessions = 50_001;
  assert.throws(() => validateCapacityProfile(contradictory), /registeredUsers/);
});

test("origin guard requires an exact explicit staging allowlist and rejects production lookalikes", () => {
  assert.equal(assertSafeOrigin(STAGING_ORIGIN, [STAGING_ORIGIN]), STAGING_ORIGIN);
  assert.throws(
    () => assertSafeOrigin("https://aria-mantu-app.fly.dev", ["https://aria-mantu-app.fly.dev"]),
    /production origin/,
  );
  assert.throws(
    () => assertSafeOrigin("https://aria-capacity-staging.example.invalid.attacker.test", [STAGING_ORIGIN]),
    /allowlisted/,
  );
  assert.throws(
    () => assertSafeOrigin("https://aria.example.invalid", ["https://aria.example.invalid"]),
    /staging marker/,
  );
});

test("percentiles use a deterministic nearest-rank calculation", () => {
  assert.equal(percentile([40, 10, 20, 30], 0.5), 20);
  assert.equal(percentile([40, 10, 20, 30], 0.95), 40);
  assert.throws(() => percentile([], 0.95), /non-empty/);
});

test("gate passes a complete measured staging observation for the exact profile", () => {
  const result = evaluateCapacityGate(approvedProfile(), evidence()) as unknown as CapacityEvaluation;
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.summary.http["candidate-page-read"].p95Ms, 210);
  assert.equal(result.summary.queue.p95AgeMs, 10_000);
  assert.equal(result.summary.resources.minimumHeadroomPercent, 40);
});

test("gate fails closed for missing required metrics and threshold breaches", () => {
  const missing = evidence();
  delete missing.resources.databaseConnectionsPeakPercent;
  const missingResult = evaluateCapacityGate(approvedProfile(), missing) as unknown as CapacityEvaluation;
  assert.equal(missingResult.passed, false);
  assert.match(missingResult.failures.join("\n"), /databaseConnectionsPeakPercent is missing/);

  const breached = evidence();
  breached.queue.duplicateDeliveries = 1;
  breached.faults["provider-timeout-no-contact"].externalContacts = 1;
  breached.resources.cpuPeakPercent = 90;
  const breachedResult = evaluateCapacityGate(approvedProfile(), breached) as unknown as CapacityEvaluation;
  assert.equal(breachedResult.passed, false);
  assert.match(breachedResult.failures.join("\n"), /duplicate deliveries/);
  assert.match(breachedResult.failures.join("\n"), /external contacts/);
  assert.match(breachedResult.failures.join("\n"), /CPU/);
});

test("receipt binds profile, evidence, decision, and integrity without turning a fixture into capacity proof", () => {
  const fixtureEvidence = evidence("synthetic-fixture");
  const evaluation = evaluateCapacityGate(profile(), fixtureEvidence);
  const receipt = createCapacityReceipt({
    profile: profile(),
    evidence: fixtureEvidence,
    evaluation,
    generatedAt: "2026-07-21T16:10:00.000Z",
  }) as unknown as CapacityReceipt;

  assert.equal(receipt.decision, "harness-pass");
  assert.equal(receipt.capacityClaim, "not-established");
  assert.equal(verifyCapacityReceipt(receipt), true);

  const tampered = structuredClone(receipt);
  tampered.summary.resources.cpuPeakPercent = 1;
  assert.equal(verifyCapacityReceipt(tampered), false);
});

test("request plan applies the exact weighted read mix without exceeding its finite bound", () => {
  const plan = buildRequestPlan(profile(), 100);
  const counts = Object.fromEntries(
    profile().httpScenarios.map((scenario) => [
      scenario.id,
      plan.filter((request) => request.scenario.id === scenario.id).length,
    ]),
  );
  assert.deepEqual(counts, {
    health: 10,
    readiness: 10,
    "candidate-page-read": 40,
    "agent-spec-list-read": 40,
  });
  assert.equal(plan.length, 100);
  assert.ok(plan.at(-1)!.scheduledOffsetMs < 6_000);
});

test("request runner never exceeds the profile concurrency bound and emits no response bodies", async () => {
  const boundedProfile = approvedProfile();
  boundedProfile.execution.maxInFlight = 2;
  const plan = buildRequestPlan(boundedProfile, 12).map((entry) => ({ ...entry, scheduledOffsetMs: 0 }));
  let active = 0;
  let maximumActive = 0;
  const http = await runRequestPlan({
    profile: boundedProfile,
    origin: STAGING_ORIGIN,
    plan,
    authCookie: "sb-auth-token=staging-token-value-that-is-never-returned",
    syntheticTenantId: "synthetic-capacity-0001",
    request: async ({ scenario }: { scenario: { expectedStatuses: number[] } }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { status: scenario.expectedStatuses[0], responseBytes: 10 };
    },
  });
  assert.equal(maximumActive, 2);
  assert.equal(Object.values(http).reduce((total, value) => total + value.latenciesMs.length, 0), 12);
  assert.equal(JSON.stringify(http).includes("staging-token-value"), false);
  assert.equal(JSON.stringify(http).includes("body"), false);
});

test("synthetic tenant attestation binds the approved cookie without exposing it", () => {
  const authCookie = "sb-auth-token=staging-token-value-that-is-never-returned";
  const attestation = {
    schemaVersion: 1,
    kind: "aria-capacity-synthetic-tenant-attestation",
    environment: "staging",
    profileId: approvedProfile().profileId,
    origin: STAGING_ORIGIN,
    syntheticTenantId: "synthetic-capacity-0001",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    sessionCookieSha256: createHash("sha256").update(authCookie).digest("hex"),
    dataClassification: "synthetic-only",
    externalEffects: "forbidden",
    approvedBy: "capacity-owner@example.invalid",
    approvedAt: "2026-07-21T15:00:00.000Z",
    expiresAt: "2026-07-21T17:00:00.000Z",
  };
  const result = validateSyntheticTenantAttestation({
    profile: approvedProfile(),
    origin: STAGING_ORIGIN,
    syntheticTenantId: "synthetic-capacity-0001",
    authCookie,
    attestation,
    now: "2026-07-21T16:00:00.000Z",
  });
  assert.equal(result.syntheticTenantId, "synthetic-capacity-0001");
  assert.match(result.attestationSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes("staging-token-value"), false);
  assert.throws(
    () => validateSyntheticTenantAttestation({
      profile: approvedProfile(),
      origin: STAGING_ORIGIN,
      syntheticTenantId: "synthetic-capacity-0001",
      authCookie: `${authCookie}-wrong`,
      attestation,
      now: "2026-07-21T16:00:00.000Z",
    }),
    /cookie digest/,
  );
});

test("staging merge rejects cross-release sidecar metrics", () => {
  const httpObservation = {
    schemaVersion: 1,
    evidenceKind: "staging-http-observation",
    environment: "staging",
    origin: STAGING_ORIGIN,
    syntheticTenantId: "synthetic-capacity-0001",
    syntheticTenantAttestationSha256: "c".repeat(64),
    releaseSha: RELEASE_SHA,
    windowStartedAt: "2026-07-21T15:55:00.000Z",
    windowEndedAt: "2026-07-21T16:00:00.000Z",
    http: evidence().http,
  };
  const metrics = {
    schemaVersion: 1,
    evidenceKind: "staging-operational-metrics",
    environment: "staging",
    origin: STAGING_ORIGIN,
    syntheticTenantId: "synthetic-capacity-0001",
    syntheticTenantAttestationSha256: "c".repeat(64),
    releaseSha: RELEASE_SHA,
    windowStartedAt: "2026-07-21T15:54:30.000Z",
    windowEndedAt: "2026-07-21T16:00:30.000Z",
    queue: evidence().queue,
    faults: evidence().faults,
    resources: evidence().resources,
  };
  const merged = mergeStagingObservation({
    profile: approvedProfile(),
    httpObservation,
    operationalMetrics: metrics,
  });
  assert.equal(merged.evidenceKind, "staging-observation");
  assert.equal(merged.queue.duplicateDeliveries, 0);

  metrics.releaseSha = "b".repeat(40);
  assert.throws(
    () => mergeStagingObservation({
      profile: approvedProfile(),
      httpObservation,
      operationalMetrics: metrics,
    }),
    /release-mismatched/,
  );
});
