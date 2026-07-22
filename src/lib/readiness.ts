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
  sourcingLoop: () => Promise<boolean>;
  migration: () => Promise<MigrationState | null>;
};

export type ReadinessInput = {
  releaseSha: string;
  expectedMigration: string;
  expectedMigrationSha: string;
  expectedMigrationCount: number;
  expectedLedgerSha256: string;
  agentFrameworksRequired: boolean;
  sourcingLoopRequired: boolean;
  sourcingModeConfigured: boolean;
  needIngressSharedThrottleConfigured: boolean;
  observabilityRequired: boolean;
  observabilityConfigured: boolean;
  agentMemoryProvenanceBoundary: boolean;
};

export function healthySourcingLoopReadiness(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const exactKeys = [
    "active_workers",
    "ambiguous_sourcing_attempts",
    "dead_sourcing_jobs",
    "expected_handler_count",
    "freshest_heartbeat_age_seconds",
    "healthy",
    "heartbeat_status",
    "oldest_runnable_job_age_seconds",
    "overdue_begun_attempts",
    "overdue_runnable_jobs",
    "status",
  ];
  if (Object.keys(record).sort().join("\n") !== exactKeys.sort().join("\n")) return false;

  const boundedCount = (field: string, maximum: number) =>
    Number.isSafeInteger(record[field]) && Number(record[field]) >= 0 && Number(record[field]) <= maximum;
  const heartbeatAge = record.freshest_heartbeat_age_seconds;
  return record.healthy === true && record.status === "ready" && record.heartbeat_status === "fresh" &&
    record.expected_handler_count === 4 &&
    boundedCount("active_workers", 100) && Number(record.active_workers) >= 1 &&
    typeof heartbeatAge === "number" && Number.isFinite(heartbeatAge) && heartbeatAge >= 0 && heartbeatAge <= 90 &&
    boundedCount("oldest_runnable_job_age_seconds", 120) &&
    boundedCount("overdue_runnable_jobs", 1_000_000) && Number(record.overdue_runnable_jobs) === 0 &&
    boundedCount("dead_sourcing_jobs", 1_000_000) && Number(record.dead_sourcing_jobs) === 0 &&
    boundedCount("ambiguous_sourcing_attempts", 1_000_000) && Number(record.ambiguous_sourcing_attempts) === 0 &&
    boundedCount("overdue_begun_attempts", 1_000_000) && Number(record.overdue_begun_attempts) === 0;
}

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
    /^[0-9a-f]{64}$/.test(input.expectedLedgerSha256) &&
    input.sourcingModeConfigured;

  const [database, auth, queue, agentFrameworks, sourcingLoop, migration] = await Promise.all([
    booleanProbe(probes.database),
    booleanProbe(probes.auth),
    booleanProbe(probes.queue),
    input.agentFrameworksRequired ? booleanProbe(probes.agentFrameworks) : Promise.resolve(true),
    booleanProbe(probes.sourcingLoop),
    migrationProbe(probes.migration),
  ]);

  const migrationMatches =
    migration?.latest?.filename === input.expectedMigration &&
    migration.latest.sha256 === input.expectedMigrationSha &&
    migration.count === input.expectedMigrationCount &&
    migration.ledgerSha256 === input.expectedLedgerSha256;
  const needIngressSharedThrottle =
    !input.sourcingLoopRequired || input.needIngressSharedThrottleConfigured;
  const observability = !input.observabilityRequired || input.observabilityConfigured;
  const ok = metadata && database && auth && queue && agentFrameworks && migrationMatches &&
    needIngressSharedThrottle && observability && input.agentMemoryProvenanceBoundary &&
    (!input.sourcingLoopRequired || sourcingLoop);

  return {
    ok,
    status: ok ? "ready" : "not_ready",
    mode: input.sourcingLoopRequired ? "operational" : "release",
    build: metadata ? input.releaseSha : "unknown",
    migration: metadata ? input.expectedMigration : "unknown",
    components: {
      database,
      auth,
      queue,
      agentFrameworks,
      sourcingLoop,
      migration: migrationMatches,
      releaseIdentity: metadata,
      needIngressSharedThrottle: input.needIngressSharedThrottleConfigured,
      observability: input.observabilityConfigured,
      agentMemoryProvenanceBoundary: input.agentMemoryProvenanceBoundary,
    },
    capabilities: {
      autonomousSourcing: input.sourcingLoopRequired && sourcingLoop,
      needIngress: input.sourcingLoopRequired && input.needIngressSharedThrottleConfigured,
      agentMemoryFreeTextWrites: !input.agentMemoryProvenanceBoundary,
    },
  } as const;
}
