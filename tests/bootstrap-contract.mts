import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const runFlySource = readFileSync("docker/bootstrap/run.fly.sh", "utf8");
const localRunSource = readFileSync("docker/bootstrap/run.sh", "utf8");
const flyDockerfile = readFileSync("docker/bootstrap/Dockerfile.fly", "utf8");
const localDockerfile = readFileSync("docker/bootstrap/Dockerfile", "utf8");
const ownerReconciliationSource = readFileSync("docker/bootstrap/supabase-admin-reconciliation.sql", "utf8");
const legacyInvariantPath = "docker/bootstrap/legacy-baseline-invariants.sql";
const legacyInvariantSource = existsSync(legacyInvariantPath) ? readFileSync(legacyInvariantPath, "utf8") : "";
const emptySchemaDigestPath = "docker/bootstrap/recovery-empty-public-schema.sha256";
const emptySchemaDigestSource = existsSync(emptySchemaDigestPath) ? readFileSync(emptySchemaDigestPath, "utf8").trim() : "";
const numberedMigrations = readdirSync("supabase/migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .map((name) => ({ name, source: readFileSync(`supabase/migrations/${name}`, "utf8") }));
const legacyTables = [
  "agent_events", "agent_runs", "agent_seats", "agent_specs", "api_keys",
  "databricks_connection_events", "databricks_connections", "dust_connection_events", "dust_connections", "email_connections",
  "messages_inbound", "messages_outbound", "outbound_content_cache", "outreach_approvals",
  "outreach_ledger", "profiles", "suppression_list", "whatsapp_contacts",
  "whatsapp_conversation_windows", "whatsapp_delivery_events", "whatsapp_senders",
  "whatsapp_templates", "workspace_state", "workspaces",
];

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

function executable(path: string, source: string) {
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
}

ok(
  "numbered migrations leave transaction ownership to the bootstrap runner",
  numberedMigrations.every(
    ({ source }) => !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(source),
  ),
);

type Phase = "recovery-preflight" | "legacy-preflight" | "legacy-baseline" | "owner" | "migrations" | "all";
type BootstrapOptions = {
  phase?: Phase;
  baselineApproval?: string;
  omitTargetSecrets?: boolean;
  recoveryState?: "verified-empty" | "verified-pre-ledger" | "complete-ledger" | "unsupported";
  ledgerManifestMismatch?: boolean;
  omitApprovedFingerprints?: boolean;
  ownerCurrentFails?: boolean;
  ownerTargetFails?: boolean;
  ownerApplyFails?: boolean;
  postgresTargetFails?: boolean;
  migrationApplyFails?: boolean;
};

function runBootstrap(options: BootstrapOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "aria-bootstrap-contract-"));
  const bin = join(root, "bin");
  const migrations = join(root, "migrations");
  const reconciliation = join(root, "reconciliation");
  const capturedOwnerPlan = join(root, "captured-owner.sql");
  const capturedMigrationPlan = join(root, "captured-migrations.sql");
  const capturedPreflightPlan = join(root, "captured-preflight.sql");
  const capturedBaselinePlan = join(root, "captured-baseline.sql");
  const psqlLog = join(root, "psql.log");
  const expectedSchemaDigest = join(root, "expected-public-schema.sha256");
  const expectedEmptySchemaDigest = join(root, "expected-empty-public-schema.sha256");

  try {
    mkdirSync(bin);
    mkdirSync(migrations);
    mkdirSync(reconciliation);
    writeFileSync(psqlLog, "");
    writeFileSync(join(migrations, "0001_first.sql"), "select 1;\n");
    writeFileSync(join(migrations, "0002_second.sql"), "select 2;\n");
    for (const file of ["supabase-admin-reconciliation.sql", "legacy-baseline-invariants.sql", "jwt.sql", "auth-owner.sql", "roles.sql"]) {
      writeFileSync(join(reconciliation, file), `select '${file}';\n`);
    }
    const schemaDump = "contract-public-schema\n";
    const schemaSha256 = createHash("sha256").update(schemaDump).digest("hex");
    const migrationManifest = ["0001_first.sql", "0002_second.sql"]
      .map((filename) => `${filename}=${createHash("sha256").update(readFileSync(join(migrations, filename))).digest("hex")}`)
      .join("\n") + "\n";
    const migrationManifestSha256 = createHash("sha256").update(migrationManifest).digest("hex");
    const emptyTableSha256 = createHash("sha256").update("").digest("hex");
    const rowManifest = legacyTables.map((table) => `public.${table}=0:${emptyTableSha256}`).join("\n") + "\n";
    const rowFingerprintSha256 = createHash("sha256").update(rowManifest).digest("hex");
    const emptyRowFingerprintSha256 = createHash("sha256").update("").digest("hex");
    writeFileSync(expectedSchemaDigest, `${schemaSha256}\n`);
    writeFileSync(expectedEmptySchemaDigest, `${schemaSha256}\n`);

    executable(
      join(bin, "psql"),
      `#!/bin/sh
set -eu
case "\${PGPASSWORD:-}" in
  contract-owner-current) connection=owner-current ;;
  contract-owner-target) connection=owner-target ;;
  contract-postgres-target) connection=postgres-target ;;
  *) exit 46 ;;
esac
role=""
previous=""
for argument in "$@"; do
  if [ "$previous" = "-U" ]; then role="$argument"; break; fi
  previous="$argument"
done
case "$connection:$role" in
  owner-*:supabase_admin|postgres-target:postgres) ;;
  *) exit 47 ;;
esac
printf '%s %s\n' "$connection" "$*" >> "$FAKE_PSQL_LOG"
case " $* " in
  *" -f "*|*" -c "*|*" -qc "*|*" -Atqc "*) ;;
  *)
    while IFS= read -r statement; do
      case "$statement" in
        *pg_export_snapshot*) printf '00000003-0000001B-1\n' ;;
        '\\q') exit 0 ;;
      esac
    done
    exit 0 ;;
esac
case " $* " in
  *" select filename || '=' || sha256 from public.aria_schema_migrations order by filename "*)
    printf '%s' "$FAKE_LEDGER_MANIFEST"; exit 0 ;;
  *" select count(*) from public."*) printf '0\n'; exit 0 ;;
esac
case "$connection" in
  owner-current)
    [ "\${FAKE_OWNER_CURRENT_FAIL:-0}" = 0 ] || exit 43 ;;
  owner-target)
    [ "\${FAKE_OWNER_TARGET_FAIL:-0}" = 0 ] || exit 44 ;;
  postgres-target)
    [ "\${FAKE_POSTGRES_TARGET_FAIL:-0}" = 0 ] || exit 45 ;;
esac
case " $* " in
  *" -f "*)
    plan=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "-f" ]; then plan="$2"; break; fi
      shift
    done
    [ -n "$plan" ] || exit 48
    case "$connection" in
      owner-*)
        if grep -q 'ARIA_LEGACY_PREFLIGHT' "$plan"; then
          cp "$plan" "$CAPTURED_PREFLIGHT_PLAN"
          if grep -q 'ARIA_COMPLETE_LEDGER_EXPECTED' "$plan" && [ "\${FAKE_LEDGER_MISMATCH:-0}" = 1 ]; then
            exit 49
          fi
          if ! grep -q 'aria_verified_empty' "$plan"; then
            printf '%s' "$FAKE_ROW_MANIFEST"
          fi
        elif grep -q 'ARIA_LEGACY_BASELINE_WRITE' "$plan"; then
          cp "$plan" "$CAPTURED_BASELINE_PLAN"
        else
          [ "\${FAKE_OWNER_APPLY_FAIL:-0}" = 0 ] || exit 42
          cp "$plan" "$CAPTURED_OWNER_PLAN"
        fi ;;
      postgres-target)
        [ "\${FAKE_MIGRATION_APPLY_FAIL:-0}" = 0 ] || exit 41
        cp "$plan" "$CAPTURED_MIGRATION_PLAN" ;;
    esac
    ;;
esac
exit 0
`,
    );
    executable(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
    executable(join(bin, "pg_dump"), "#!/bin/sh\nprintf 'contract-public-schema\\n'\n");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      ARIA_BOOTSTRAP_PHASE: options.phase ?? "all",
      DB_HOST: "db.invalid",
      DB_PORT: "5432",
      DB_NAME: "postgres",
      SUPABASE_ADMIN_CURRENT_PASSWORD: "contract-owner-current",
      MIGRATIONS_DIR: migrations,
      RECONCILIATION_DIR: reconciliation,
      LEGACY_BASELINE_INVARIANTS_FILE: join(reconciliation, "legacy-baseline-invariants.sql"),
      LEGACY_BASELINE_EXPECTED_SCHEMA_SHA256_FILE: expectedSchemaDigest,
      RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE: expectedEmptySchemaDigest,
      CAPTURED_OWNER_PLAN: capturedOwnerPlan,
      CAPTURED_MIGRATION_PLAN: capturedMigrationPlan,
      CAPTURED_PREFLIGHT_PLAN: capturedPreflightPlan,
      CAPTURED_BASELINE_PLAN: capturedBaselinePlan,
      FAKE_PSQL_LOG: psqlLog,
      FAKE_OWNER_CURRENT_FAIL: options.ownerCurrentFails ? "1" : "0",
      FAKE_OWNER_TARGET_FAIL: options.ownerTargetFails ? "1" : "0",
      FAKE_OWNER_APPLY_FAIL: options.ownerApplyFails ? "1" : "0",
      FAKE_POSTGRES_TARGET_FAIL: options.postgresTargetFails ? "1" : "0",
      FAKE_MIGRATION_APPLY_FAIL: options.migrationApplyFails ? "1" : "0",
      FAKE_LEDGER_MANIFEST: options.ledgerManifestMismatch ? "0001_first.sql=wrong\n" : migrationManifest,
      FAKE_LEDGER_MISMATCH: options.ledgerManifestMismatch ? "1" : "0",
      FAKE_ROW_MANIFEST: rowManifest,
    };
    if (!options.omitApprovedFingerprints) {
      env.ARIA_LEGACY_APPROVED_SCHEMA_SHA256 = schemaSha256;
      env.ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256 =
        options.recoveryState === "verified-empty" ? emptyRowFingerprintSha256 : rowFingerprintSha256;
      env.ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256 = migrationManifestSha256;
    }
    if (!options.omitTargetSecrets) {
      env.SUPABASE_ADMIN_TARGET_PASSWORD = "contract-owner-target";
      env.POSTGRES_TARGET_PASSWORD = "contract-postgres-target";
      env.SUPABASE_AUTH_ADMIN_TARGET_PASSWORD = "contract-auth-admin-target";
      env.AUTHENTICATOR_TARGET_PASSWORD = "contract-authenticator-target";
      env.JWT_SECRET = "contract-jwt";
      env.JWT_EXP = "3600";
    }
    if (options.baselineApproval !== undefined) {
      env.ARIA_LEGACY_BASELINE_APPROVAL_SHA256 = options.baselineApproval;
    }
    if (options.recoveryState !== undefined) {
      env.ARIA_RECOVERY_MIGRATION_STATE = options.recoveryState;
    }

    const result = spawnSync("/bin/sh", ["docker/bootstrap/run.fly.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
      env,
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      ownerPlan: existsSync(capturedOwnerPlan) ? readFileSync(capturedOwnerPlan, "utf8") : "",
      migrationPlan: existsSync(capturedMigrationPlan) ? readFileSync(capturedMigrationPlan, "utf8") : "",
      preflightPlan: existsSync(capturedPreflightPlan) ? readFileSync(capturedPreflightPlan, "utf8") : "",
      baselinePlan: existsSync(capturedBaselinePlan) ? readFileSync(capturedBaselinePlan, "utf8") : "",
      psqlLog: readFileSync(psqlLog, "utf8"),
      reconciliation,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function planApplyCount(log: string, urlFragment: string) {
  return log
    .split("\n")
    .filter((line) => line.startsWith(`${urlFragment} `) && line.includes(" -f ")).length;
}

const contractPasswords = [
  "contract-owner-current",
  "contract-owner-target",
  "contract-postgres-target",
  "contract-auth-admin-target",
  "contract-authenticator-target",
];

ok(
  "bootstrap accepts host components without password-bearing DSNs",
  /DB_HOST/.test(runFlySource) &&
    /DB_PORT/.test(runFlySource) &&
    /DB_NAME/.test(runFlySource) &&
    /SUPABASE_ADMIN_CURRENT_PASSWORD/.test(runFlySource) &&
    /SUPABASE_ADMIN_TARGET_PASSWORD/.test(runFlySource) &&
    /POSTGRES_TARGET_PASSWORD/.test(runFlySource) &&
    !/ADMIN_DB_URL|TARGET_ADMIN_DB_URL|SUPABASE_ADMIN_DB_URL|TARGET_SUPABASE_ADMIN_DB_URL|FLY_DB_ADMIN_PASSWORD|POSTGRES_CURRENT_PASSWORD|postgres:\/\//.test(
      runFlySource,
    ),
);
ok(
  "bootstrap images drop root before any database connection",
  /USER\s+postgres[\s\S]*ENTRYPOINT/i.test(flyDockerfile) &&
    /USER\s+postgres[\s\S]*ENTRYPOINT/i.test(localDockerfile),
);
ok(
  "production bootstrap image contains every reviewed recovery-preflight input",
  /legacy-baseline-invariants\.sql/.test(flyDockerfile) &&
    /legacy-baseline-public-schema\.sha256/.test(flyDockerfile) &&
    /recovery-empty-public-schema\.sha256/.test(flyDockerfile),
);
ok(
  "verified-empty schema fingerprint is pinned as lowercase SHA-256",
  /^[0-9a-f]{64}$/.test(emptySchemaDigestSource),
);
ok(
  "local bootstrap records the same filename-plus-SHA ARIA ledger",
  /ARIA_BOOTSTRAP_PHASE=migrations[\s\S]*run\.fly\.sh/.test(localRunSource) &&
    /public\.aria_schema_migrations/.test(runFlySource) &&
    /sha256/.test(runFlySource) &&
    !/supabase_migrations\.schema_migrations/.test(`${localRunSource}${runFlySource}`),
);
ok(
  "owner reconciliation makes postgres an unprivileged direct migrator",
  /alter role postgres[\s\S]*nosuperuser[\s\S]*nocreatedb[\s\S]*nocreaterole[\s\S]*noreplication[\s\S]*nobypassrls/i.test(
    ownerReconciliationSource,
  ) && /pg_auth_members/.test(ownerReconciliationSource),
);
ok(
  "legacy invariants are exact and contain no mutation statements",
  legacyInvariantSource.length > 0 &&
    /workspace_state/.test(legacyInvariantSource) &&
    /finalize_whatsapp_provider_failure/.test(legacyInvariantSource) &&
    /rowsecurity/.test(legacyInvariantSource) &&
    !/^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im.test(legacyInvariantSource),
);
ok(
  "recovery schema, ledger, and data proofs share one exported database snapshot",
  /pg_export_snapshot/.test(runFlySource) &&
    /--snapshot/.test(runFlySource) &&
    /set transaction snapshot/i.test(runFlySource),
);
ok(
  "recovery data fingerprint binds deterministic row contents instead of counts alone",
  /digest\s*\(\s*row_to_json/i.test(runFlySource) &&
    /string_agg[\s\S]*order by/i.test(runFlySource) &&
    !/printf 'public\.%s=%s\\n' "\$table_name" "\$row_count"/.test(runFlySource),
);

const legacyPreflight = runBootstrap({ phase: "legacy-preflight", omitTargetSecrets: true });
const approvalDigest = legacyPreflight.output.match(/ARIA_LEGACY_BASELINE_APPROVAL_SHA256=([0-9a-f]{64})/)?.[1] ?? "";
ok("legacy preflight succeeds with only the current owner credential", legacyPreflight.status === 0);
ok(
  "legacy preflight uses a direct current-owner read-only transaction",
  legacyPreflight.psqlLog.includes("owner-current ") &&
    !legacyPreflight.psqlLog.includes("owner-target ") &&
    /begin[\s\S]*read only/i.test(legacyPreflight.preflightPlan) &&
    !/^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im.test(legacyPreflight.preflightPlan),
);
ok("legacy preflight emits one exact approval digest", approvalDigest.length === 64);
ok("legacy preflight never creates a baseline plan", legacyPreflight.baselinePlan === "");

const verifiedRecovery = runBootstrap({
  phase: "recovery-preflight",
  recoveryState: "verified-pre-ledger",
  omitTargetSecrets: true,
});
ok(
  "recovery preflight supports the receipt's verified-pre-ledger state read-only",
  verifiedRecovery.status === 0 &&
    /ARIA_RECOVERY_PREFLIGHT_SHA256=[0-9a-f]{64}/.test(verifiedRecovery.output) &&
    /ARIA_LEGACY_BASELINE_APPROVAL_SHA256=[0-9a-f]{64}/.test(verifiedRecovery.output),
);
const unboundRecovery = runBootstrap({
  phase: "recovery-preflight",
  recoveryState: "verified-pre-ledger",
  omitApprovedFingerprints: true,
  omitTargetSecrets: true,
});
ok("recovery preflight rejects a receipt with missing approved fingerprints", unboundRecovery.status !== 0);
const emptyRecovery = runBootstrap({
  phase: "recovery-preflight",
  recoveryState: "verified-empty",
  omitTargetSecrets: true,
});
ok(
  "recovery preflight accepts only a pinned empty PostgreSQL 17 cluster without baselining",
  emptyRecovery.status === 0 &&
    /server_version_num/.test(emptyRecovery.preflightPlan) &&
    /verified-empty recovery requires no public tables/.test(emptyRecovery.preflightPlan) &&
    /verified-empty recovery requires no public functions/.test(emptyRecovery.preflightPlan) &&
    /ARIA_RECOVERY_PREFLIGHT_SHA256=[0-9a-f]{64}/.test(emptyRecovery.output) &&
    !/ARIA_LEGACY_BASELINE_APPROVAL_SHA256=/.test(emptyRecovery.output),
);
const completeRecovery = runBootstrap({
  phase: "recovery-preflight",
  recoveryState: "complete-ledger",
  omitTargetSecrets: true,
});
ok(
  "recovery preflight verifies a complete filename-plus-SHA ledger without authorizing baselining",
  completeRecovery.status === 0 &&
    /complete-ledger recovery requires/.test(completeRecovery.preflightPlan) &&
    /ARIA_RECOVERY_PREFLIGHT_SHA256=[0-9a-f]{64}/.test(completeRecovery.output) &&
    !/ARIA_LEGACY_BASELINE_APPROVAL_SHA256=/.test(completeRecovery.output),
);
const mismatchedRecoveryLedger = runBootstrap({
  phase: "recovery-preflight",
  recoveryState: "complete-ledger",
  ledgerManifestMismatch: true,
  omitTargetSecrets: true,
});
ok("recovery preflight rejects a complete ledger with any identity drift", mismatchedRecoveryLedger.status !== 0);
const unsupportedRecovery = runBootstrap({
  phase: "recovery-preflight",
  recoveryState: "unsupported",
  omitTargetSecrets: true,
});
ok("recovery preflight rejects empty, new, and unknown recovery states", unsupportedRecovery.status !== 0);

const missingApproval = runBootstrap({ phase: "legacy-baseline", omitTargetSecrets: true });
ok("legacy baseline refuses missing owner approval", missingApproval.status !== 0);
ok("legacy baseline never creates a write plan without owner approval", missingApproval.baselinePlan === "");
const wrongApproval = runBootstrap({ phase: "legacy-baseline", omitTargetSecrets: true, baselineApproval: "0".repeat(64) });
ok("legacy baseline refuses a stale or foreign approval digest", wrongApproval.status !== 0 && wrongApproval.baselinePlan === "");
const approvedBaseline = runBootstrap({ phase: "legacy-baseline", omitTargetSecrets: true, baselineApproval: approvalDigest });
ok("legacy baseline accepts the exact preflight approval", approvedBaseline.status === 0);
ok(
  "approved baseline rechecks invariants then records exact filename and SHA identities",
  /legacy-baseline-invariants\.sql/.test(approvedBaseline.baselinePlan) &&
    /create table[\s\S]*aria_schema_migrations/i.test(approvedBaseline.baselinePlan) &&
    /0001_first\.sql[\s\S]*[0-9a-f]{64}[\s\S]*0002_second\.sql[\s\S]*[0-9a-f]{64}/.test(
      approvedBaseline.baselinePlan,
    ),
);
ok(
  "approved baseline locks application tables and revalidates exact content before ledger adoption",
  /begin transaction isolation level read committed/i.test(approvedBaseline.baselinePlan) &&
    /lock table[\s\S]*in share mode/i.test(approvedBaseline.baselinePlan) &&
    /lock table public\.aria_schema_migrations in share mode/i.test(approvedBaseline.baselinePlan) &&
    /legacy data fingerprint changed after preflight/i.test(approvedBaseline.baselinePlan) &&
    /digest\s*\(\s*row_to_json/i.test(approvedBaseline.baselinePlan),
);

const ownerOnly = runBootstrap({ phase: "owner" });
ok("owner phase succeeds", ownerOnly.status === 0);
ok(
  "owner phase applies the unified owner reconciliation on one owner session",
  /supabase-admin-reconciliation\.sql/.test(ownerOnly.ownerPlan) &&
    !/roles\.sql|jwt\.sql|auth-owner\.sql|0001_first\.sql/.test(ownerOnly.ownerPlan) &&
    planApplyCount(ownerOnly.psqlLog, "owner-current") === 1,
);
ok("owner phase never applies the migration plan", ownerOnly.migrationPlan === "");
ok(
  "owner phase reconnects with the rotated target postgres credential",
  ownerOnly.psqlLog.includes("postgres-target ") && !ownerOnly.psqlLog.includes("postgres-current "),
);

const ownerFallback = runBootstrap({ phase: "owner", ownerCurrentFails: true });
ok(
  "owner phase falls back from current to target owner credentials",
  ownerFallback.status === 0 &&
    ownerFallback.psqlLog.includes("owner-current ") &&
    ownerFallback.psqlLog.includes("owner-target ") &&
    planApplyCount(ownerFallback.psqlLog, "owner-target") === 1,
);

const migrationsOnly = runBootstrap({ phase: "migrations" });
ok("migrations phase succeeds", migrationsOnly.status === 0);
ok("migrations phase never opens an owner session", !migrationsOnly.psqlLog.includes("owner-current ") && !migrationsOnly.psqlLog.includes("owner-target "));
ok("migrations phase never applies an owner plan", migrationsOnly.ownerPlan === "");
ok("migration plan is one explicit transaction", /begin;[\s\S]*commit;/.test(migrationsOnly.migrationPlan));
ok("migration plan holds a transaction advisory lock", /pg_advisory_xact_lock/.test(migrationsOnly.migrationPlan));
ok("migration plan contains no owner-only reconciliation", !/jwt\.sql|supabase-admin-reconciliation\.sql|auth-owner\.sql|roles\.sql/.test(migrationsOnly.migrationPlan));
ok("migration plan refuses an unbaselined legacy schema", /do \$aria_baseline_guard\$[\s\S]*raise exception 'existing ARIA schema has no migration ledger/.test(migrationsOnly.migrationPlan));
ok("migration plan rejects an empty legacy migration ledger", /raise exception 'existing ARIA schema has an empty migration ledger/.test(migrationsOnly.migrationPlan));
ok("migration plan never relies on unsupported psql quit exit codes", !/\\quit\s+[0-9]+/.test(migrationsOnly.migrationPlan));
ok("migration plan records both filenames", /0001_first\.sql[\s\S]*0002_second\.sql/.test(migrationsOnly.migrationPlan));
ok("migration plan records SHA-256 identities", (migrationsOnly.migrationPlan.match(/[0-9a-f]{64}/g) ?? []).length >= 2);
ok("migrations phase applies exactly one target-postgres plan", planApplyCount(migrationsOnly.psqlLog, "postgres-target") === 1);
ok("migrations phase never attempts a current-postgres connection", !migrationsOnly.psqlLog.includes("postgres-current "));
ok(
  "psql argv and captured output contain neither passwords nor DSNs",
  !/postgres:\/\//.test(`${ownerOnly.psqlLog}${migrationsOnly.psqlLog}${ownerOnly.output}${migrationsOnly.output}`) &&
    contractPasswords.every(
      (password) => !`${ownerOnly.psqlLog}${migrationsOnly.psqlLog}${ownerOnly.output}${migrationsOnly.output}`.includes(password),
    ),
);

const all = runBootstrap({ phase: "all" });
const ownerApplyAt = all.psqlLog.split("\n").findIndex((line) => line.startsWith("owner-current ") && line.includes(" -f "));
const migrationApplyAt = all.psqlLog.split("\n").findIndex((line) => line.startsWith("postgres-target ") && line.includes(" -f "));
ok("all phase succeeds", all.status === 0);
ok("all phase preserves one owner plan and one migration plan", planApplyCount(all.psqlLog, "owner-current") === 1 && planApplyCount(all.psqlLog, "postgres-target") === 1);
ok("all phase applies owner reconciliation before migrations", ownerApplyAt >= 0 && migrationApplyAt > ownerApplyAt);

const ownerFailure = runBootstrap({ phase: "all", ownerApplyFails: true });
ok("owner reconciliation failure propagates", ownerFailure.status === 42);
ok("owner reconciliation failure prevents every migration plan", ownerFailure.migrationPlan === "" && planApplyCount(ownerFailure.psqlLog, "postgres-target") === 0);

const reconnectFailure = runBootstrap({ phase: "all", postgresTargetFails: true });
ok("target postgres reconnect failure blocks the release", reconnectFailure.status !== 0);
ok("target postgres reconnect failure prevents migration apply", reconnectFailure.migrationPlan === "" && planApplyCount(reconnectFailure.psqlLog, "postgres-target") === 0);

const migrationFailure = runBootstrap({ phase: "migrations", migrationApplyFails: true });
ok("migration transaction failure propagates", migrationFailure.status === 41);
ok("failed migration never prints completion", !migrationFailure.output.includes("[migrate] complete"));

console.log(`RESULT bootstrap-contract: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
