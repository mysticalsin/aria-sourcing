import { existsSync, readFileSync } from "node:fs";

import { resolveTestGroup } from "../scripts/run-test-manifest.mjs";
import { testManifest } from "./test-manifest.mjs";

const database = readFileSync("fly.db.toml", "utf8");
const auth = readFileSync("fly.auth.toml", "utf8");
const rest = readFileSync("fly.rest.toml", "utf8");
const databaseDockerfile = readFileSync("docker/db/Dockerfile.fly", "utf8");
const databaseEntrypoint = readFileSync("docker/db/entrypoint.fly.sh", "utf8");
const databaseInitMarker = existsSync("docker/db/mark-init-complete.sh")
  ? readFileSync("docker/db/mark-init-complete.sh", "utf8")
  : "";
const databaseRoles = readFileSync("docker/db/01-roles.sql", "utf8");
const volumeTest = readFileSync("scripts/test-fly-db-volume.sh", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const databaseSecurityJob =
  workflow.match(/\n  database-security:[\s\S]*?\n  supply-chain:/)?.[0] ?? "";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", name);
  }
}

function serviceBlock(source: string) {
  return source.match(/\[\[services\]\]([\s\S]*?)(?=\n\[\[vm\]\]|$)/)?.[1] ?? "";
}

function isAlwaysOn(source: string) {
  const service = serviceBlock(source);
  return (
    /auto_stop_machines\s*=\s*"off"/.test(service) &&
    /auto_start_machines\s*=\s*false/.test(service) &&
    /min_machines_running\s*=\s*1/.test(service)
  );
}

ok(
  "database volume mounts above the image PGDATA directory",
  /destination\s*=\s*"\/var\/lib\/postgresql"/.test(database) &&
    !/destination\s*=\s*"\/var\/lib\/postgresql\/data"/.test(database),
);
ok(
  "database keeps the image PGDATA as a subdirectory of the durable mount",
  !/^\s*PGDATA\s*=/m.test(database),
);
ok("database service is explicitly always on", isAlwaysOn(database));
ok("Auth service is explicitly always on", isAlwaysOn(auth));
ok("REST service is explicitly always on", isAlwaysOn(rest));
ok(
  "database image uses the volume-layout guard without a mutable Dockerfile frontend",
  !/^#\s*syntax=/m.test(databaseDockerfile) &&
    /ENTRYPOINT\s+\["\/usr\/local\/bin\/aria-db-entrypoint"\]/.test(databaseDockerfile) &&
    /CMD\s+\["postgres",\s*"-D",\s*"\/etc\/postgresql"\]/.test(databaseDockerfile),
);
ok(
  "database entrypoint gates legacy root migration on a receipt-bound release approval",
  /\$mount_root\/PG_VERSION/.test(databaseEntrypoint) &&
    /ARIA_DB_LAYOUT_MIGRATION_APPROVAL/.test(databaseEntrypoint) &&
    /aria-db-root-to-child-v1/.test(databaseEntrypoint) &&
    /\.aria-layout-migration-v1/.test(databaseEntrypoint) &&
    /exit 78/.test(databaseEntrypoint) &&
    /docker-entrypoint\.sh/.test(databaseEntrypoint),
);
ok(
  "legacy cutover validates PostgreSQL 17 and writes completion only after the move",
  /legacy PostgreSQL cluster must be major version 17/.test(databaseEntrypoint) &&
    databaseEntrypoint.indexOf('mv "$source" "$destination"') <
      databaseEntrypoint.indexOf("aria-db-init-v1") &&
    /global\/pg_control/.test(databaseEntrypoint),
);
ok(
  "database refuses an interrupted child cluster until first boot completed",
  /\.aria-init-complete/.test(databaseEntrypoint) &&
    /aria-db-init-v1/.test(databaseEntrypoint) &&
    /incomplete PostgreSQL initialization/.test(databaseEntrypoint) &&
    /partial_volume/.test(volumeTest),
);
ok(
  "first boot writes an atomic completion marker after the pinned image migrations",
  /zz-aria-init-complete\.sh/.test(databaseDockerfile) &&
    /\.aria-init-complete/.test(databaseInitMarker) &&
    /mv /.test(databaseInitMarker),
);
ok(
  "container test covers the tempting but invalid PGDATA-only workaround",
  /PGDATA=\/var\/lib\/postgresql\/data\/pgdata/.test(volumeTest) &&
    /data_directory/.test(volumeTest),
);
ok(
  "container test covers authorized legacy cutover, partial resume, and the effective data directory",
  /legacy_volume/.test(volumeTest) &&
    /resume_volume/.test(volumeTest) &&
    /wrong_layout_approval/.test(volumeTest) &&
    /ambiguous_volume/.test(volumeTest) &&
    /ARIA_DB_LAYOUT_MIGRATION_APPROVAL/.test(volumeTest) &&
    /SHOW data_directory/i.test(volumeTest) &&
    /server_version_num/i.test(volumeTest),
);
ok(
  "legacy cutover test boots a real prior-layout PostgreSQL cluster and preserves a SQL probe",
  /legacy_real_volume/.test(volumeTest) &&
    /legacy_real_container/.test(volumeTest) &&
    /create table public\.__aria_layout_probe/i.test(volumeTest) &&
    /select value from public\.__aria_layout_probe/i.test(volumeTest),
);
ok(
  "container readiness waits for the final password-authenticated TCP server",
  /\/proc\/1\/cmdline/.test(volumeTest) &&
    /127\.0\.0\.1/.test(volumeTest) &&
    /PostgreSQL init process complete/.test(volumeTest) &&
    /PGPASSWORD/.test(volumeTest) &&
    /--network/.test(volumeTest) &&
    /authenticator/.test(volumeTest) &&
    /supabase_auth_admin/.test(volumeTest),
);
ok(
  "extension-dependent Functions role is optional while core database roles remain required",
  /from pg_roles[\s\S]*rolname\s*=\s*'supabase_functions_admin'[\s\S]*\\gexec/i.test(databaseRoles) &&
    !/ALTER USER supabase_functions_admin/i.test(databaseRoles) &&
    /ALTER USER authenticator/i.test(databaseRoles) &&
    /ALTER USER supabase_auth_admin/i.test(databaseRoles),
);
ok(
  "database volume regression has a real container test",
  packageJson.scripts?.["test:fly-db-volume"] === "bash scripts/test-fly-db-volume.sh" &&
    resolveTestGroup(testManifest, "pretest").some(({ argv }) =>
      argv.includes("tests/fly-backend-stability.mts"),
    ),
);
ok(
  "database security CI runs the real volume and restart test",
  (databaseSecurityJob.match(/run:\s+npm run test:database/g) ?? []).length === 1 &&
    !/run:\s+npm run test:fly-db-volume/.test(databaseSecurityJob) &&
    resolveTestGroup(testManifest, "database").filter(
      ({ id }) => id === "test-fly-db-volume",
    ).length === 1,
);

console.log(`RESULT fly-backend-stability: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
