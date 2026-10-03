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
  /**
   * True when HERMES_API_URL is set to a value the SSRF allow-list will refuse.
   * The runtime is then unreachable and every call silently falls back to the
   * deterministic mock, so the deployment must fail readiness rather than look
   * healthy. False both when Hermes is unconfigured (feature off) and when it is
   * configured correctly.
   */
  hermesRuntimeMisconfigured: boolean;
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
    // Always probe the component bit — skipping it painted local "ready" theater.
    // Top-level ok still ignores frameworks when agentFrameworksRequired is false.
    booleanProbe(probes.agentFrameworks),
    migrationProbe(probes.migration),
  ]);

  const migrationMatches =
    migration?.latest?.filename === input.expectedMigration &&
    migration.latest.sha256 === input.expectedMigrationSha &&
    migration.count === input.expectedMigrationCount &&
    migration.ledgerSha256 === input.expectedLedgerSha256;
  const hermesRuntime = !input.hermesRuntimeMisconfigured;
  // Component bit is always probed above; only gate ok on it when required
  // (otherwise local/dev painted frameworks green without a real probe).
  const ok =
    metadata &&
    database &&
    auth &&
    queue &&
    (!input.agentFrameworksRequired || agentFrameworks) &&
    migrationMatches &&
    hermesRuntime;

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
      hermesRuntime,
      migration: migrationMatches,
      releaseIdentity: metadata,
    },
  } as const;
}
