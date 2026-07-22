import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { testManifest } from "./test-manifest.mjs";

const migrationPath = "supabase/migrations/0031_orphan_owner_recovery_authority.sql";
const bridgeMigrationPath = "supabase/migrations/0062_orphan_owner_recovery_auth_bridge.sql";
const bridgeRollbackPath = "supabase/rollbacks/0062_orphan_owner_recovery_auth_bridge.sql";
const scriptPath = "scripts/recover-orphan-workspace-owner.sh";

assert.ok(existsSync(migrationPath), `${migrationPath} must exist`);
assert.ok(existsSync(bridgeMigrationPath), `${bridgeMigrationPath} must exist`);
assert.ok(existsSync(bridgeRollbackPath), `${bridgeRollbackPath} must exist`);
assert.ok(existsSync(scriptPath), `${scriptPath} must exist`);

const migration = readFileSync(migrationPath, "utf8");
const bridgeMigration = readFileSync(bridgeMigrationPath, "utf8");
const bridgeMigrationSql = bridgeMigration.replace(/--.*$/gm, "");
const bridgeRollback = readFileSync(bridgeRollbackPath, "utf8");
const script = readFileSync(scriptPath, "utf8");
const packageJson = readFileSync("package.json", "utf8");
const runbook = readFileSync("production-readiness/DEPLOYMENT_RUNBOOK.md", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const inventory = readFileSync("docker/bootstrap/legacy-table-inventory.txt", "utf8");
const invariants = readFileSync("docker/bootstrap/legacy-baseline-invariants.sql", "utf8");
const privileges = readFileSync("tests/db/function-privileges.sql", "utf8");

function recoveryDefinition(source: string): string {
  const start = source.indexOf("create or replace function public.recover_orphan_workspace_owner(");
  assert.notEqual(start, -1, "recovery function definition must exist");
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "recovery function definition must have a complete body");
  return source.slice(start, end + "\n$$;".length);
}

const checks: Array<[string, boolean]> = [
  [
    "migration creates a content-minimized append-only recovery receipt",
    /create table if not exists public\.owner_recovery_receipts/i.test(migration) &&
      /request_sha256 text not null/i.test(migration) &&
      /email_sha256 text not null/i.test(migration) &&
      /state_sha256 text not null/i.test(migration) &&
      /before update or delete[\s\S]*reject_owner_recovery_receipt_mutation/i.test(migration),
  ],
  [
    "recovery receipts are forced-RLS and visible only to postgres",
    /alter table public\.owner_recovery_receipts enable row level security/i.test(migration) &&
      /alter table public\.owner_recovery_receipts force row level security/i.test(migration) &&
      /revoke all on public\.owner_recovery_receipts[\s\S]*public, anon, authenticated, service_role, authenticator/i.test(
        migration,
      ) &&
      /create policy owner_recovery_receipts_postgres_all[\s\S]*for all to postgres/i.test(migration),
  ],
  [
    "one SECURITY DEFINER RPC owns the recovery mutation",
      /create or replace function public\.recover_orphan_workspace_owner\(/i.test(migration) &&
      /security definer/i.test(migration) &&
      /set search_path = pg_catalog, public, extensions, pg_temp/i.test(migration),
  ],
  [
    "only service_role can execute the recovery RPC",
    /revoke all on function public\.recover_orphan_workspace_owner\([\s\S]*from public, anon, authenticated, service_role, authenticator/i.test(
      migration,
    ) &&
      /grant execute on function public\.recover_orphan_workspace_owner\([\s\S]*to service_role/i.test(migration) &&
      /auth\.role\(\)[\s\S]*service_role/i.test(migration),
  ],
  [
    "migration grants no recovery table DML to API roles",
    !/grant\s+(?:select|insert|update|delete|all)[\s\S]{0,100}owner_recovery_receipts[\s\S]{0,100}(?:anon|authenticated|service_role|authenticator)/i.test(
      migration,
    ),
  ],
  [
    "RPC is exact-CAS and restricted to the proven orphan topology",
    /p_expected_current_domain text/i.test(migration) &&
      /p_expected_current_domain is distinct from 'workspace'/i.test(migration) &&
      /allowed_domain is distinct from p_expected_current_domain/i.test(migration) &&
      /coalesce\(profile_record\.email, ''\) <> ''/i.test(migration) &&
      /role is distinct from 'admin'/i.test(migration) &&
      /profile_count <> 1/i.test(migration) &&
      /auth_user_count <> 1/i.test(migration),
  ],
  [
    "RPC validates exact canonical identity and GoTrue eligibility",
    /p_canonical_email is distinct from lower\(p_canonical_email\)/i.test(migration) &&
      /p_canonical_domain is distinct from lower\(p_canonical_domain\)/i.test(migration) &&
      /auth_user_record\.email is distinct from p_canonical_email/i.test(migration) &&
      /confirmed_at/i.test(migration) &&
      /encrypted_password/i.test(migration) &&
      /raw_app_meta_data[\s\S]*provider[\s\S]*email/i.test(migration) &&
      /banned_until/i.test(migration) &&
      /deleted_at/i.test(migration),
  ],
  [
    "RPC independently validates the request-bound GoTrue recovery marker",
    /raw_user_meta_data[\s\S]*aria_owner_recovery_marker/i.test(migration) &&
      /aria-owner-recovery-v1:/i.test(migration) &&
      /p_request_id::text/i.test(migration) &&
      /p_operator_approval_sha256/i.test(migration),
  ],
  [
    "0062 delegates only the Auth-owner identity decision to the exact bridge",
    /auth\.aria_orphan_owner_recovery_identity_status\(\s*p_profile_id,\s*p_canonical_email,\s*expected_identity_marker\s*\)/i.test(
      bridgeMigrationSql,
    ) &&
      !/\bauth\.users\b/i.test(bridgeMigrationSql) &&
      !/\bauth_user_(?:record|json|count)\b|\bbanned_until_value\b/i.test(bridgeMigrationSql),
  ],
  [
    "0062 maps every known bridge status and rejects unknown or null status fail-closed",
    /case identity_status[\s\S]*when 'eligible'[\s\S]*when 'auth_inventory_mismatch'[\s\S]*when 'identity_not_eligible'[\s\S]*when 'identity_schema_unsupported'[\s\S]*else[\s\S]*errcode\s*=\s*'55000'[\s\S]*end case;/i.test(
      bridgeMigrationSql,
    ),
  ],
  [
    "0062 verifies the bridge owner, definer mode, volatility, search path, and restricted execution",
    /function_owner\.rolname = 'supabase_auth_admin'/i.test(bridgeMigrationSql) &&
      /function_definition\.prosecdef/i.test(bridgeMigrationSql) &&
      /function_definition\.provolatile = 'v'/i.test(bridgeMigrationSql) &&
      /search_path=pg_catalog, pg_temp/i.test(bridgeMigrationSql) &&
      /has_function_privilege\('postgres',[\s\S]*'EXECUTE'\)/i.test(bridgeMigrationSql) &&
      /has_function_privilege\('service_role',[\s\S]*'EXECUTE'\)/i.test(bridgeMigrationSql),
  ],
  [
    "0062 rollback restores the exact 0031 function definition",
    recoveryDefinition(bridgeRollback) === recoveryDefinition(migration),
  ],
  [
    "0062 forward and rollback restore the exact postgres owner and service-only ACL",
    [bridgeMigration, bridgeRollback].every(
      (source) =>
        /alter function public\.recover_orphan_workspace_owner\([\s\S]*?\) owner to postgres;/i.test(source) &&
        /revoke all on function public\.recover_orphan_workspace_owner\([\s\S]*?\) from public, anon, authenticated, service_role, authenticator;/i.test(
          source,
        ) &&
        /grant execute on function public\.recover_orphan_workspace_owner\([\s\S]*?\) to service_role;/i.test(
          source,
        ),
    ),
  ],
  [
    "database and shell enforce the same canonical public email-domain grammar",
    /position\('\.' in p_canonical_domain\) = 0/i.test(migration) &&
      /reverse\(split_part\(reverse\(p_canonical_domain\), '\.', 1\)\) !~ '\[a-z\]'/i.test(migration) &&
      /ADMIN_EMAIL[\s\S]*\[:space:\]\[:cntrl:\]/i.test(script),
  ],
  [
    "release, recovery receipt, request, and operator approval are hash-bound",
    /p_release_sha !~ '\^\[0-9a-f\]\{40\}\$'/i.test(migration) &&
      /p_recovery_receipt_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/i.test(migration) &&
      /p_request_id/i.test(migration) &&
      /aria-owner-recovery-v1:/i.test(migration) &&
      /digest\(convert_to\(expected_approval/i.test(migration) &&
      /p_operator_approval_sha256 is distinct from/i.test(migration),
  ],
  [
    "request replay is exact and changed material conflicts",
    /where request_id = p_request_id[\s\S]*for share/i.test(migration) &&
      /'status', 'replay'/i.test(migration) &&
      /'status', 'idempotency_conflict'/i.test(migration),
  ],
  [
    "the only business updates are the workspace domain and orphan profile identity",
    /update public\.workspaces[\s\S]*set allowed_domain = p_canonical_domain/i.test(migration) &&
      /update public\.profiles[\s\S]*set email = p_canonical_email,[\s\S]*full_name = p_full_name/i.test(migration) &&
      !/update public\.workspace_state/i.test(migration),
  ],
  [
    "operator script inventories before creating the exact marked GoTrue identity",
    /inventory_workspace/i.test(script) &&
      /inventory_profiles/i.test(script) &&
      /inventory_state/i.test(script) &&
      /inventory_auth_users/i.test(script) &&
      /\{id:\$profile_id,email:\$email,password:\$password/i.test(script) &&
      /aria_owner_recovery_marker/i.test(script),
  ],
  [
    "operator temporary curl configurations use a fixed non-injectable root",
    /mktemp -d \/tmp\/aria-owner-recovery\.XXXXXX/.test(script) &&
      !/\$\{TMPDIR/.test(script),
  ],
  [
    "operator script requires strong credentials and exact approval inputs",
    /\$\{#ADMIN_PASSWORD\}["'} ]*-ge 24|\$\{#ADMIN_PASSWORD\}.*24/i.test(script) &&
      /ARIA_RELEASE_SHA/i.test(script) &&
      /ARIA_RECOVERY_RECEIPT_SHA256/i.test(script) &&
      /ARIA_RECOVERY_REQUEST_ID/i.test(script) &&
      /ARIA_RECOVERY_OPERATOR_APPROVAL_SHA256/i.test(script),
  ],
  [
    "cleanup deletes only a marked newly-created user before binding",
    /cleanup_created_user/i.test(script) &&
      /aria_owner_recovery_marker/i.test(script) &&
      /aria_owner_recovery_attempt/i.test(script) &&
      /BINDING_CONFIRMED/i.test(script) &&
      /should_soft_delete/i.test(script),
  ],
  [
    "operator verifies password login and the exact admin/workspace binding",
    /auth\/v1\/token\?grant_type=password/i.test(script) &&
      /ACCESS_TOKEN/i.test(script) &&
      /role.*admin/i.test(script) &&
      /OWNER_RECOVERY_VERIFIED/i.test(script),
  ],
  [
    "recovery objects are represented in canonical inventories and privilege proofs",
    inventory.split("\n").includes("owner_recovery_receipts") &&
      invariants.includes("owner_recovery_receipts") &&
      invariants.includes("recover_orphan_workspace_owner") &&
      privileges.includes("recover_orphan_workspace_owner") &&
      privileges.includes("reject_owner_recovery_receipt_mutation"),
  ],
  [
    "package and runbook expose the reviewed recovery path",
    packageJson.includes('"test:db-owner-recovery"') &&
      packageJson.includes('"test:owner-recovery"') &&
      runbook.includes("recover-orphan-workspace-owner.sh") &&
      runbook.includes("owner_recovery_receipts"),
  ],
  [
    "CI invokes both the operator-contract and database recovery gates",
    ciWorkflow.includes("npm run test:owner-recovery") &&
      (
        ciWorkflow.includes("npm run test:db-owner-recovery") ||
        (
          ciWorkflow.includes("npm run test:database") &&
          testManifest.groups.database.includes("orphan-owner-recovery-db")
        )
      ),
  ],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) console.log(`PASS: ${name}`);
  else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

console.log(`RESULT orphan-owner-recovery-contract: ${checks.length - failed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
