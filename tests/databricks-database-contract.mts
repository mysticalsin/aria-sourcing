/*
 * Fast wiring contract. The SQL source below is only executable evidence when
 * scripts/test-db-privileges.sh runs it against a disposable PostgreSQL server.
 */
import { existsSync, readFileSync } from "node:fs";

import { resolveTestGroup } from "../scripts/run-test-manifest.mjs";
import { testManifest } from "./test-manifest.mjs";

const databaseTestPath = "tests/db/databricks-authority.sql";
const databaseTest = existsSync(databaseTestPath)
  ? readFileSync(databaseTestPath, "utf8")
  : "";
const migration = readFileSync("supabase/migrations/0019_agent_authority_and_integrations.sql", "utf8");
const harness = readFileSync("scripts/test-db-privileges.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const requiredEvidence = [
  "member cannot read Databricks connections",
  "viewer cannot read Databricks connections",
  "anonymous callers cannot access Databricks connections",
  "admin can manage its workspace Databricks connection",
  "admin cannot manage a foreign workspace Databricks connection",
  "wrong-provider credential binding is rejected",
  "foreign-workspace credential binding is rejected",
  "bound Databricks credential cannot be deleted",
  "service role can read normalized Databricks connections",
  "service role cannot write normalized Databricks connections",
  "service role cannot access Databricks audit events",
  "service role cannot execute Databricks trigger helpers",
  "Databricks audit events are append-only and non-secret",
  "legacy Databricks state is stripped without losing unrelated state",
  "Databricks revision and immutable authority fields are database-owned",
];

ok("real Databricks database authority test exists", databaseTest.length > 0);
ok(
  "real database test names every required authority case",
  requiredEvidence.every((marker) => databaseTest.includes(marker)),
);
ok(
  "real database test changes PostgreSQL roles and JWT claims",
  /set local role authenticated/i.test(databaseTest) &&
    /request\.jwt\.claims/i.test(databaseTest) &&
    /set local role service_role/i.test(databaseTest) &&
    /set local role anon/i.test(databaseTest),
);
ok(
  "real database test checks RLS, foreign keys, audit immutability, and trigger helpers",
  /42501/.test(databaseTest) &&
    /23503/.test(databaseTest) &&
    /databricks_connection_events/i.test(databaseTest) &&
    /has_function_privilege/i.test(databaseTest),
);
ok(
  "migration resets service and authenticator table privileges before allowlisting",
  /revoke all on public\.databricks_connections\s+from public, anon, authenticated, service_role, authenticator/i.test(
    migration,
  ) &&
    /revoke all on public\.databricks_connection_events\s+from public, anon, authenticated, service_role, authenticator/i.test(
      migration,
    ),
);
ok(
  "audit hashes an unambiguous structured authority value",
  /digest\(\s*jsonb_build_array\(/i.test(migration) && !/digest\(\s*concat_ws\(/i.test(migration),
);
ok(
  "Databricks audit reads have a tenant and connection index",
  /create index if not exists [^\n]+[\s\S]*?on public\.databricks_connection_events\s*\(workspace_id, connection_id, created_at desc\)/i.test(
    migration,
  ),
);
ok(
  "disposable database harness runs Databricks authority verification",
  /tests\/db\/databricks-authority\.sql/.test(harness),
);
ok(
  "package exposes the disposable database security test",
  typeof packageJson.scripts?.["test:db-privileges"] === "string" &&
    resolveTestGroup(testManifest, "pretest").some(({ argv }) =>
      argv.includes("tests/databricks-database-contract.mts"),
    ),
);
ok(
  "CI runs the disposable database security test",
  /database-security:[\s\S]*test:db-privileges/i.test(workflow),
);

console.log(`RESULT databricks-database-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
