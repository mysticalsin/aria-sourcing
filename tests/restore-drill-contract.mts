import { readFileSync } from "node:fs";

const restore = readFileSync("scripts/restore-drill.sh", "utf8");
const backup = readFileSync("scripts/backup.sh", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("restore uses strict shell mode", /set -euo pipefail/.test(restore));
ok("restore uses strict psql mode", /psql -X -v ON_ERROR_STOP=1/.test(restore));
ok("restore uses one custom-format archive", /pg_restore --exit-on-error/.test(restore) && !/SCHEMA=|DATA=/.test(restore));
ok("archive restore errors are not swallowed", !/pg_restore[^\n]*\|\| true/.test(restore));
ok("restore uses a unique scratch database", /SCRATCH=.*\$\$.*RANDOM/.test(restore));
ok("restore traps cleanup on EXIT", /install_safe_exit_traps cleanup_on_exit/.test(restore));
ok("restore installs shared non-zero signal traps", /install_safe_exit_traps cleanup_on_exit/.test(restore));
ok("restore verifies RLS has no disabled public table", /rowsecurity\s*=\s*false/.test(restore));
ok("restore verifies exact ARIA migration identities", /EXPECTED_MIGRATION_IDENTITIES/.test(restore) && /ACTUAL_MIGRATION_IDENTITIES/.test(restore));
ok("restore checks the latest function fingerprint", /finalize_whatsapp_provider_failure/.test(restore));
ok("restore cleans up before reporting PASS", restore.indexOf("cleanup_scratch") < restore.lastIndexOf("RESTORE DRILL PASSED"));
ok("backup and restore share a local container resolver", /local-db-container\.sh/.test(backup) && /local-db-container\.sh/.test(restore));
ok("container resolver prefers the checked-in Compose db service", /docker compose ps -q db/.test(readFileSync("scripts/lib/local-db-container.sh", "utf8")));
ok("container resolver rejects remote Docker contexts", /Docker context is not local/.test(readFileSync("scripts/lib/local-db-container.sh", "utf8")));
ok("container resolver verifies current checkout labels", /com\.docker\.compose\.project\.working_dir/.test(readFileSync("scripts/lib/local-db-container.sh", "utf8")));
ok("backup refuses missing required tables", /REQUIRED_TABLES/.test(backup));
ok("backup refuses disabled RLS", /rowsecurity\s*=\s*false/.test(backup));
ok("backup requires the exact ARIA migration identities", /EXPECTED_MIGRATION_IDENTITIES/.test(backup) && /ACTUAL_MIGRATION_IDENTITIES/.test(backup));
ok("backup requires the latest schema fingerprint", /finalize_whatsapp_provider_failure/.test(backup));
ok("backup serializes publication with an owned atomic lock", /ln -s "\$\$" "\$LOCK_PATH"/.test(backup));
ok("backup publishes one archive plus manifest", /pg_dump[^\n]*-Fc/.test(backup) && /MANIFEST/.test(backup));
ok("backup and restore use the same manifest generator", /db-manifest\.sh/.test(backup) && /db-manifest\.sh/.test(restore));
const manifestSource = readFileSync("scripts/lib/db-manifest.sh", "utf8");
ok(
  "backup and restore use the direct owner for cross-schema archive access",
  /pg_dump -U supabase_admin/.test(backup) &&
    /pg_restore --exit-on-error --no-owner -U supabase_admin/.test(backup) &&
    /pg_restore --exit-on-error --no-owner -U supabase_admin/.test(restore) &&
    /-U supabase_admin/.test(manifestSource),
);
ok(
  "restricted migrator never performs cluster-level scratch database operations",
  /dex_owner\(\)/.test(backup) &&
    /dex_owner\(\)/.test(restore) &&
    /dex_owner -d postgres -c "create database/.test(backup) &&
    /dex_owner -d postgres -c "create database/.test(restore) &&
    /owner postgres/.test(backup) &&
    /owner postgres/.test(restore),
);
ok("restore compares the entire regenerated manifest", /cmp -s "\$MANIFEST" "\$ACTUAL_MANIFEST"/.test(restore));
ok("backup sets private permissions before writing", /umask 077/.test(backup));
ok("backup installs shared non-zero signal traps", /install_safe_exit_traps cleanup_on_exit/.test(backup));
ok(
  "backup, restore, and manifest use the production ARIA filename-plus-SHA ledger",
  /public\.aria_schema_migrations/.test(backup) &&
    /public\.aria_schema_migrations/.test(restore) &&
    /public\.aria_schema_migrations/.test(manifestSource) &&
    /filename\s*\|\|\s*':'\s*\|\|\s*sha256/.test(manifestSource) &&
    !/supabase_migrations\.schema_migrations/.test(`${backup}${restore}${manifestSource}`),
);
ok("manifest counts every non-system table", /all_tables/.test(manifestSource) && /row_count\.%s\.%s/.test(manifestSource));
ok("manifest records every non-system sequence state", /all_sequences/.test(manifestSource) && /sequence_state\.%s\.%s/.test(manifestSource));
ok(
  "manifest fingerprints function owners, ACLs, definer state, search paths, and effective roles",
  /function_acl_md5/.test(manifestSource) &&
    /proowner/.test(manifestSource) &&
    /prosecdef/.test(manifestSource) &&
    /proacl/.test(manifestSource) &&
    /proconfig/.test(manifestSource) &&
    /has_function_privilege/.test(manifestSource),
);
const backupArm = backup.indexOf("SCRATCH_CLEANUP_ARMED=1");
const backupCreate = backup.indexOf('dex_owner -d postgres -c "create database');
const restoreArm = restore.indexOf("SCRATCH_CLEANUP_ARMED=1");
const restoreCreate = restore.indexOf('dex_owner -d postgres -c "create database');
ok("backup arms scratch cleanup before create", backupArm >= 0 && backupCreate > backupArm);
ok("restore arms scratch cleanup before create", restoreArm >= 0 && restoreCreate > restoreArm);

for (const table of [
  "agent_events", "agent_runs", "agent_seats", "agent_specs", "api_keys", "aria_schema_migrations",
  "databricks_connection_events", "databricks_connections", "dust_connection_events",
  "dust_connections", "email_connections",
  "messages_inbound", "messages_outbound", "outbound_content_cache",
  "outreach_approvals", "outreach_ledger", "profiles", "suppression_list",
  "whatsapp_contacts", "whatsapp_conversation_windows", "whatsapp_delivery_events",
  "whatsapp_senders", "whatsapp_templates", "workspace_state", "workspaces",
]) {
  ok(`restore requires table ${table}`, restore.includes(table));
}

console.log(`RESULT restore-drill-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
