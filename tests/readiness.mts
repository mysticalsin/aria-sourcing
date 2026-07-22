import {
  evaluateReadiness,
  healthySourcingLoopReadiness,
  type ReadinessProbes,
} from "../src/lib/readiness";
import { readFileSync } from "node:fs";

const releaseSha = "a".repeat(40);
const expectedMigration = "0018_first_login_admin_grant.sql";
const expectedMigrationSha = "b".repeat(64);
const expectedMigrationCount = 18;
const expectedLedgerSha256 = "c".repeat(64);
const readinessInput = {
  releaseSha,
  expectedMigration,
  expectedMigrationSha,
  expectedMigrationCount,
  expectedLedgerSha256,
  agentFrameworksRequired: true,
  sourcingLoopRequired: true,
  sourcingModeConfigured: true,
  needIngressSharedThrottleConfigured: true,
  observabilityRequired: true,
  observabilityConfigured: true,
  agentMemoryProvenanceBoundary: true,
};

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

function healthyProbes(overrides: Partial<ReadinessProbes> = {}): ReadinessProbes {
  return {
    database: async () => true,
    auth: async () => true,
    queue: async () => true,
    agentFrameworks: async () => true,
    sourcingLoop: async () => true,
    migration: async () => ({
      latest: { filename: expectedMigration, sha256: expectedMigrationSha },
      count: expectedMigrationCount,
      ledgerSha256: expectedLedgerSha256,
    }),
    ...overrides,
  };
}

const healthyLoopReadiness = {
  active_workers: 1,
  ambiguous_sourcing_attempts: 0,
  dead_sourcing_jobs: 0,
  expected_handler_count: 4,
  freshest_heartbeat_age_seconds: 20,
  healthy: true,
  heartbeat_status: "fresh",
  oldest_runnable_job_age_seconds: 30,
  overdue_begun_attempts: 0,
  overdue_runnable_jobs: 0,
  status: "ready",
};

ok(
  "exact-release sourcing readiness accepts a fresh bounded healthy loop",
  healthySourcingLoopReadiness(healthyLoopReadiness),
);
ok(
  "sourcing readiness rejects an incomplete handler set",
  !healthySourcingLoopReadiness({ ...healthyLoopReadiness, expected_handler_count: 3 }),
);
ok(
  "sourcing readiness rejects an expanded handler set",
  !healthySourcingLoopReadiness({ ...healthyLoopReadiness, expected_handler_count: 5 }),
);
ok(
  "sourcing readiness rejects dead jobs",
  !healthySourcingLoopReadiness({ ...healthyLoopReadiness, dead_sourcing_jobs: 1 }),
);
ok(
  "sourcing readiness rejects ambiguous provider attempts",
  !healthySourcingLoopReadiness({ ...healthyLoopReadiness, ambiguous_sourcing_attempts: 1 }),
);
ok(
  "sourcing readiness rejects an oldest runnable job beyond the bound",
  !healthySourcingLoopReadiness({ ...healthyLoopReadiness, oldest_runnable_job_age_seconds: 121 }),
);
ok(
  "sourcing readiness rejects stale exact-release heartbeats",
  !healthySourcingLoopReadiness({
    ...healthyLoopReadiness,
    freshest_heartbeat_age_seconds: 91,
    heartbeat_status: "stale",
    healthy: false,
    status: "not_ready",
  }),
);

const healthy = await evaluateReadiness(
  readinessInput,
  healthyProbes(),
);
ok("all required dependencies and identities are ready", healthy.ok && healthy.status === "ready");
ok("ready response contains the exact release identity", healthy.build === releaseSha);
ok("operational readiness is explicit when the sourcing loop is required and healthy", healthy.mode === "operational");
ok(
  "production readiness declares the enforced agent-memory provenance boundary",
  healthy.components.agentMemoryProvenanceBoundary === true &&
    healthy.capabilities.agentMemoryFreeTextWrites === false,
);

const authDown = await evaluateReadiness(
  readinessInput,
  healthyProbes({ auth: async () => false }),
);
ok("Auth failure makes readiness fail", !authDown.ok && !authDown.components.auth);

const databaseThrows = await evaluateReadiness(
  readinessInput,
  healthyProbes({ database: async () => { throw new Error("down"); } }),
);
ok("database probe exception fails closed", !databaseThrows.ok && !databaseThrows.components.database);

const migrationMismatch = await evaluateReadiness(
  readinessInput,
  healthyProbes({
    migration: async () => ({
      latest: { filename: expectedMigration, sha256: "d".repeat(64) },
      count: expectedMigrationCount,
      ledgerSha256: expectedLedgerSha256,
    }),
  }),
);
ok("migration hash mismatch makes readiness fail", !migrationMismatch.ok && !migrationMismatch.components.migration);

const migrationCountMismatch = await evaluateReadiness(
  readinessInput,
  healthyProbes({
    migration: async () => ({
      latest: { filename: expectedMigration, sha256: expectedMigrationSha },
      count: expectedMigrationCount - 1,
      ledgerSha256: expectedLedgerSha256,
    }),
  }),
);
ok("migration count mismatch makes readiness fail", !migrationCountMismatch.ok && !migrationCountMismatch.components.migration);

const ledgerMismatch = await evaluateReadiness(
  readinessInput,
  healthyProbes({
    migration: async () => ({
      latest: { filename: expectedMigration, sha256: expectedMigrationSha },
      count: expectedMigrationCount,
      ledgerSha256: "d".repeat(64),
    }),
  }),
);
ok("migration ledger mismatch makes readiness fail", !ledgerMismatch.ok && !ledgerMismatch.components.migration);

const queueDown = await evaluateReadiness(
  readinessInput,
  healthyProbes({ queue: async () => false }),
);
ok("queue failure makes readiness fail", !queueDown.ok && !queueDown.components.queue);

const frameworksDown = await evaluateReadiness(
  readinessInput,
  healthyProbes({ agentFrameworks: async () => false }),
);
ok("required DeerFlow and Flowise adapter failure makes readiness fail", !frameworksDown.ok && !frameworksDown.components.agentFrameworks);

const frameworksOptional = await evaluateReadiness(
  { ...readinessInput, agentFrameworksRequired: false },
  healthyProbes({ agentFrameworks: async () => false }),
);
ok("a deliberately framework-free deployment does not inherit the optional probe failure", frameworksOptional.ok && frameworksOptional.components.agentFrameworks);

const sourcingLoopDown = await evaluateReadiness(
  readinessInput,
  healthyProbes({ sourcingLoop: async () => false }),
);
ok(
  "an unhealthy or inert sourcing loop fails operational readiness",
  !sourcingLoopDown.ok && !sourcingLoopDown.components.sourcingLoop,
);

const darkRelease = await evaluateReadiness(
  {
    ...readinessInput,
    sourcingLoopRequired: false,
    needIngressSharedThrottleConfigured: false,
  },
  healthyProbes({ sourcingLoop: async () => false }),
);
ok(
  "a protected dark release is ready without claiming autonomous sourcing or public need ingress",
  darkRelease.ok && darkRelease.status === "ready" && darkRelease.mode === "release" &&
    !darkRelease.components.sourcingLoop && !darkRelease.components.needIngressSharedThrottle &&
    !darkRelease.capabilities.autonomousSourcing && !darkRelease.capabilities.needIngress,
);

const sharedNeedIngressThrottleMissing = await evaluateReadiness(
  { ...readinessInput, needIngressSharedThrottleConfigured: false },
  healthyProbes(),
);
ok(
  "operational readiness fails when the shared need-ingress throttle is not attested",
  !sharedNeedIngressThrottleMissing.ok &&
    !sharedNeedIngressThrottleMissing.components.needIngressSharedThrottle,
);

const observabilityMissing = await evaluateReadiness(
  { ...readinessInput, observabilityConfigured: false },
  healthyProbes(),
);
ok(
  "required production observability configuration fails readiness closed",
  !observabilityMissing.ok && !observabilityMissing.components.observability,
);

const observabilityOptional = await evaluateReadiness(
  {
    ...readinessInput,
    observabilityRequired: false,
    observabilityConfigured: false,
  },
  healthyProbes(),
);
ok(
  "an explicit non-production deployment may run without an exporter",
  observabilityOptional.ok && !observabilityOptional.components.observability,
);

const memoryBoundaryMissing = await evaluateReadiness(
  { ...readinessInput, agentMemoryProvenanceBoundary: false },
  healthyProbes(),
);
ok(
  "production readiness fails when the agent-memory provenance boundary is absent",
  !memoryBoundaryMissing.ok &&
    !memoryBoundaryMissing.components.agentMemoryProvenanceBoundary &&
    memoryBoundaryMissing.capabilities.agentMemoryFreeTextWrites,
);

const readinessRoute = readFileSync(
  new URL("../src/app/api/ready/route.ts", import.meta.url),
  "utf8",
);
ok(
  "production readiness cannot opt out of DeerFlow and Flowise with an environment flag",
  /process\.env\.NODE_ENV === "production"\s*\|\|\s*process\.env\.AGENT_FRAMEWORKS_REQUIRED === "true"/.test(readinessRoute) &&
    !/frameworkRequirement !== "false"/.test(readinessRoute),
);
ok(
  "the readiness route binds sourcing health to the database authority and explicit deployment mode",
  /get_sourcing_loop_readiness/.test(readinessRoute) &&
    /p_release_sha:\s*releaseSha/.test(readinessRoute) &&
    /ARIA_SOURCING_OPERATIONAL_REQUIRED/.test(readinessRoute) &&
    /sourcingLoopRequired/.test(readinessRoute),
);
ok(
  "Auth readiness requires both GoTrue health and the exact identity lifecycle schema",
  /auth_identity_lifecycle_schema_ready/.test(readinessRoute) &&
    /lifecycleSchema\.error === null/.test(readinessRoute) &&
    /lifecycleSchema\.data === true/.test(readinessRoute),
);
ok(
  "production readiness cannot opt out of configured external observability",
  /process\.env\.NODE_ENV === "production"[\s\S]*ARIA_OBSERVABILITY_REQUIRED/.test(readinessRoute) &&
    /observabilityConfiguration/.test(readinessRoute) &&
    /observabilityConfigured/.test(readinessRoute),
);
ok(
  "production readiness derives the agent-memory provenance boundary only from production mode",
  /agentMemoryProvenanceBoundary\s*=\s*process\.env\.NODE_ENV\s*===\s*["']production["']/.test(readinessRoute) &&
    !/ARIA_[A-Z0-9_]*MEMORY[A-Z0-9_]*/.test(readinessRoute),
);

const missingIdentity = await evaluateReadiness(
  {
    releaseSha: "",
    expectedMigration: "",
    expectedMigrationSha: "",
    expectedMigrationCount: 0,
    expectedLedgerSha256: "",
    agentFrameworksRequired: true,
    sourcingLoopRequired: true,
    sourcingModeConfigured: false,
    needIngressSharedThrottleConfigured: false,
    observabilityRequired: true,
    observabilityConfigured: false,
    agentMemoryProvenanceBoundary: false,
  },
  healthyProbes(),
);
ok("missing release metadata makes readiness fail", !missingIdentity.ok && !missingIdentity.components.releaseIdentity);

console.log(`RESULT readiness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
