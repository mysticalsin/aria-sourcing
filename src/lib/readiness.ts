export type MigrationIdentity = { filename: string; sha256: string };

export type MigrationState = {
  latest: MigrationIdentity | null;
  count: number;
  ledgerSha256: string;
};

export type ReadinessProbes = {
  database: () => Promise<boolean>;
  auth: () => Promise<boolean>;
  queue: () => Promise<boolean>;
  agentFrameworks: () => Promise<boolean>;
  migration: () => Promise<MigrationState | null>;
};

export type ReadinessInput = {
  releaseSha: string;
  expectedMigration: string;
  expectedMigrationSha: string;
  expectedMigrationCount: number;
  expectedLedgerSha256: string;
  agentFrameworksRequired: boolean;
};

async function booleanProbe(probe: () => Promise<boolean>) {
  try {
    return (await probe()) === true;
  } catch {
    return false;
  }
}

async function migrationProbe(probe: () => Promise<MigrationState | null>) {
  try {
    return await probe();
  } catch {
    return null;
  }
}

export async function evaluateReadiness(input: ReadinessInput, probes: ReadinessProbes) {
  const metadata =
    /^[0-9a-f]{40}$/.test(input.releaseSha) &&
    /^0[0-9]{3}_[A-Za-z0-9_]+\.sql$/.test(input.expectedMigration) &&
    /^[0-9a-f]{64}$/.test(input.expectedMigrationSha) &&
    Number.isSafeInteger(input.expectedMigrationCount) &&
    input.expectedMigrationCount > 0 &&
    /^[0-9a-f]{64}$/.test(input.expectedLedgerSha256);

  const [database, auth, queue, agentFrameworks, migration] = await Promise.all([
    booleanProbe(probes.database),
    booleanProbe(probes.auth),
    booleanProbe(probes.queue),
    input.agentFrameworksRequired ? booleanProbe(probes.agentFrameworks) : Promise.resolve(true),
    migrationProbe(probes.migration),
  ]);

  const migrationMatches =
    migration?.latest?.filename === input.expectedMigration &&
    migration.latest.sha256 === input.expectedMigrationSha &&
    migration.count === input.expectedMigrationCount &&
    migration.ledgerSha256 === input.expectedLedgerSha256;
  const ok = metadata && database && auth && queue && agentFrameworks && migrationMatches;

  return {
    ok,
    status: ok ? "ready" : "not_ready",
    build: metadata ? input.releaseSha : "unknown",
    migration: metadata ? input.expectedMigration : "unknown",
    components: {
      database,
      auth,
      queue,
      agentFrameworks,
      migration: migrationMatches,
      releaseIdentity: metadata,
    },
  } as const;
}
