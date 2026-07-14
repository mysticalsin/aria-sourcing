import { evaluateReadiness, type ReadinessProbes } from "../src/lib/readiness";
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
    migration: async () => ({
      latest: { filename: expectedMigration, sha256: expectedMigrationSha },
      count: expectedMigrationCount,
      ledgerSha256: expectedLedgerSha256,
    }),
    ...overrides,
  };
}

const healthy = await evaluateReadiness(
  readinessInput,
  healthyProbes(),
);
ok("all required dependencies and identities are ready", healthy.ok && healthy.status === "ready");
ok("ready response contains the exact release identity", healthy.build === releaseSha);

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

const readinessRoute = readFileSync(
  new URL("../src/app/api/ready/route.ts", import.meta.url),
  "utf8",
);
ok(
  "production readiness cannot opt out of DeerFlow and Flowise with an environment flag",
  /process\.env\.NODE_ENV === "production"\s*\|\|\s*process\.env\.AGENT_FRAMEWORKS_REQUIRED === "true"/.test(readinessRoute) &&
    !/frameworkRequirement !== "false"/.test(readinessRoute),
);

const missingIdentity = await evaluateReadiness(
  {
    releaseSha: "",
    expectedMigration: "",
    expectedMigrationSha: "",
    expectedMigrationCount: 0,
    expectedLedgerSha256: "",
    agentFrameworksRequired: true,
  },
  healthyProbes(),
);
ok("missing release metadata makes readiness fail", !missingIdentity.ok && !missingIdentity.components.releaseIdentity);

console.log(`RESULT readiness: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
