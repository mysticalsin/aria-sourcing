/* Fast wiring contract. Effective privileges are proved by the PostgreSQL test
 * in tests/db/function-privileges.sql, never by this source inspection alone.
 */
import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/0019_agent_authority_and_integrations.sql";
const migration = readFileSync(migrationPath, "utf8");
const ownerReconciliationPath = "docker/bootstrap/supabase-admin-reconciliation.sql";
const ownerReconciliation = existsSync(ownerReconciliationPath)
  ? readFileSync(ownerReconciliationPath, "utf8")
  : "";
const databaseTest = readFileSync("tests/db/function-privileges.sql", "utf8");
const harness = readFileSync("scripts/test-db-privileges.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = readFileSync("package.json", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const signatures = [
  "public.current_workspace_id()",
  "public.current_profile_role()",
  "public.ensure_workspace()",
  "public.touch_updated_at()",
  "public.claim_and_record(text,text,text,uuid,text,integer)",
  "public.normalize_whatsapp_e164(text)",
  "public.claim_whatsapp_outbound(uuid)",
  "public.record_whatsapp_provider_acceptance(uuid,uuid,text)",
  "public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)",
  "public.record_outreach_approval(text,text,text)",
  "public.revoke_outreach_approval(text,text)",
  "public.claim_email_outbound(text,text,text,text,text,text,uuid)",
  "public.enforce_active_whatsapp_approval()",
  "public.review_whatsapp_outbound(uuid,text)",
  "public.claim_whatsapp_inbound_processing(uuid,uuid)",
  "public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)",
  "public.finalize_whatsapp_provider_failure(uuid,uuid,text)",
  "public.stamp_databricks_connection_authority()",
  "public.audit_databricks_connection_authority()",
  "public.strip_legacy_databricks_authority()",
];

ok("migration resets every public routine before allowlisting", signatures.every((signature) => migration.includes(`'${signature}'`)));
ok(
  "postgres-owned future public-schema objects lose default API-role privileges",
  /alter default privileges revoke all on tables from public/i.test(migration) &&
    /alter default privileges revoke all on sequences from public/i.test(migration) &&
    /alter default privileges revoke execute on functions from public/i.test(migration) &&
    /alter default privileges in schema public revoke all on tables from anon, authenticated, service_role, authenticator/i.test(
    migration,
  ) &&
    /alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role, authenticator/i.test(
      migration,
    ) &&
    /alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role, authenticator/i.test(
      migration,
    ),
);
ok(
  "migration 0019 never mutates another owner's default ACL",
  !/alter default privileges\s+for\s+(?:role|user)\s+supabase_admin/i.test(migration),
);
ok("supabase_admin reconciliation is a separate reviewed SQL surface", ownerReconciliation.length > 0);
ok(
  "supabase_admin reconciliation requires a direct owner session",
  /session_user/i.test(ownerReconciliation) &&
    /current_user/i.test(ownerReconciliation) &&
    /supabase_admin/i.test(ownerReconciliation) &&
    /raise exception/i.test(ownerReconciliation),
);
ok(
  "supabase_admin-owned future objects lose every default API-role privilege",
  /alter default privileges revoke all on tables from public/i.test(ownerReconciliation) &&
    /alter default privileges revoke all on sequences from public/i.test(ownerReconciliation) &&
    /alter default privileges revoke execute on functions from public/i.test(ownerReconciliation) &&
    /alter default privileges in schema public revoke all on tables from anon, authenticated, service_role, authenticator/i.test(
      ownerReconciliation,
    ) &&
    /alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role, authenticator/i.test(
      ownerReconciliation,
    ) &&
    /alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role, authenticator/i.test(
      ownerReconciliation,
    ) &&
    !/alter default privileges\s+for\s+(?:role|user)/i.test(ownerReconciliation),
);
ok(
  "owner password rotation uses an environment value and SQL literal quoting",
  /\\getenv\s+\w+\s+SUPABASE_ADMIN_TARGET_PASSWORD/i.test(ownerReconciliation) &&
    /format\s*\([^;]*%L/is.test(ownerReconciliation) &&
    /\\gexec/i.test(ownerReconciliation),
);
ok(
  "unused internal database roles are disabled without shared passwords",
  /pgbouncer/i.test(ownerReconciliation) &&
    /supabase_storage_admin/i.test(ownerReconciliation) &&
    /supabase_functions_admin/i.test(ownerReconciliation) &&
    /nologin/i.test(ownerReconciliation) &&
    /password\s+null/i.test(ownerReconciliation) &&
    !/INTERNAL_TARGET_PASSWORD/i.test(ownerReconciliation) &&
    /pg_authid/i.test(harness) &&
    /rolcanlogin/i.test(harness) &&
    /rolpassword\s+is\s+not\s+null/i.test(harness),
);
ok("untrusted roles lose CREATE on public schema", /revoke create on schema public from public, anon, authenticated, service_role, authenticator/i.test(migration));
ok("authenticated RPC allowlist is explicit", /AUTHENTICATED RPC ALLOWLIST/i.test(migration));
ok("service worker RPC allowlist is explicit", /SERVICE RPC ALLOWLIST/i.test(migration));
ok("saved function search paths end with pg_temp", /pg_catalog, public(?:, extensions)?, pg_temp/i.test(migration));
ok("real database test checks effective role privileges", /has_function_privilege/i.test(databaseTest) && /aclexplode/i.test(databaseTest));
ok(
  "real database test uses valid PL/pgSQL query iteration",
  !/foreach\s+\w+\s+in\s+select/i.test(databaseTest),
);
ok(
  "real database test probes future table, sequence, and function privileges for every API role",
  /__aria_default_acl_table_probe/i.test(databaseTest) &&
  /__aria_default_acl_sequence_probe/i.test(databaseTest) &&
  /__aria_default_acl_function_probe/i.test(databaseTest) &&
    /__aria_supabase_admin_default_acl_table_probe/i.test(databaseTest) &&
    /__aria_supabase_admin_default_acl_sequence_probe/i.test(databaseTest) &&
    /__aria_supabase_admin_default_acl_function_probe/i.test(databaseTest) &&
    /has_table_privilege/i.test(databaseTest) &&
    /has_sequence_privilege/i.test(databaseTest) &&
    /has_function_privilege/i.test(databaseTest) &&
    (databaseTest.match(/'MAINTAIN'/g) ?? []).length >= 2,
);
ok(
  "owner probes come from separate direct sessions rather than SET ROLE",
  !/set\s+(?:local\s+)?role\s+supabase_admin/i.test(databaseTest) &&
    /session_user\s*<>\s*'postgres'/i.test(databaseTest) &&
    /unexpected owner/i.test(databaseTest) &&
    /--network "?\$network"?[\s\S]*-h db -U "?\$role"?/i.test(harness) &&
    /-U supabase_admin/i.test(harness),
);
ok(
  "real harness proves owner denial, two rotations, retry, and no password leakage",
  /postgres unexpectedly ran supabase_admin reconciliation/i.test(harness) &&
    (harness.match(/run_owner_reconciliation/g) ?? []).length >= 4 &&
    /retired database password still authenticates/i.test(harness) &&
    /POSTGRES_TARGET_PASSWORD/i.test(harness) &&
    /SUPABASE_AUTH_ADMIN_TARGET_PASSWORD/i.test(harness) &&
    /AUTHENTICATOR_TARGET_PASSWORD/i.test(harness) &&
    /database owner reconciliation exposed a password marker/i.test(harness) &&
    /docker logs/i.test(harness),
);
ok("real database test rejects the removed overload", databaseTest.includes("record_whatsapp_delivery_event(uuid,text,text,timestamptz,integer)"));
ok("disposable database harness applies every migration", /migrations\/\[0-9\]\[0-9\]\[0-9\]\[0-9\]_\*\.sql/.test(harness));
ok("package exposes the real database privilege test", packageJson.includes('"test:db-privileges"'));
ok("CI runs database privilege verification", /database-security:[\s\S]*test:db-privileges/i.test(workflow));

console.log(`RESULT function-privileges-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
