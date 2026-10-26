/* Fast wiring contract. Effective privileges are proved by the PostgreSQL test
 * in tests/db/function-privileges.sql, never by this source inspection alone.
 */
import { existsSync, readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/0001_baseline.sql";
const migration = readFileSync(migrationPath, "utf8");
const ownerReconciliationPath = "docker/bootstrap/supabase-admin-reconciliation.sql";
const ownerReconciliation = existsSync(ownerReconciliationPath)
  ? readFileSync(ownerReconciliationPath, "utf8")
  : "";
const databaseTest = readFileSync("tests/db/function-privileges.sql", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const functionCount = (migration.match(/^CREATE FUNCTION public\./gm) ?? []).length;

ok(
  "every public routine has PUBLIC execute revoked, so only explicit grants apply",
  functionCount > 0 &&
    (migration.match(/^REVOKE ALL ON FUNCTION public\..+ FROM PUBLIC;$/gm) ?? []).length === functionCount,
);
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
    !/INTERNAL_TARGET_PASSWORD/i.test(ownerReconciliation),
);
ok("untrusted roles lose CREATE on public schema", /revoke create on schema public from public, anon, authenticated, service_role, authenticator/i.test(migration));
const authenticatedRpcs = [
  ...migration.matchAll(/^GRANT (?:ALL|EXECUTE) ON FUNCTION public\.(\w+)\(.*\) TO authenticated;$/gm),
].map((match) => match[1]).sort();
ok(
  "authenticated RPC allowlist is explicit",
  JSON.stringify(authenticatedRpcs) ===
    JSON.stringify([
      "claim_email_outbound",
      "current_profile_role",
      "current_workspace_id",
      "enqueue_email_outbound",
      "ensure_workspace",
      "list_workspace_candidates",
      "record_outreach_approval",
      "revoke_outreach_approval",
    ]),
);
ok(
  "service worker RPC grants are explicit and never extend to anon",
  /^GRANT (?:ALL|EXECUTE) ON FUNCTION public\.\w+\(.*\) TO service_role;$/m.test(migration) &&
    !/^GRANT .* TO anon;$/m.test(migration),
);
ok(
  "saved function search paths end with pg_temp",
  (migration.match(/^    SET search_path TO .*'pg_temp'$/gm) ?? []).length === functionCount,
);
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
    /unexpected owner/i.test(databaseTest),
);
ok("real database test rejects the removed overload", databaseTest.includes("record_whatsapp_delivery_event(uuid,text,text,timestamptz,integer)"));

console.log(`RESULT function-privileges-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
