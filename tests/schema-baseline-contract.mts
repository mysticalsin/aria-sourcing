// Security contract for the squashed schema (supabase/migrations/0001_baseline.sql).
//
// The historical per-migration text tests were retired with the squash; this
// suite asserts the resulting schema instead. The privilege snapshot in
// tests/fixtures/baseline-schema-snapshot.json is a reviewed artefact: a change
// to it must come with a migration and a reason in the commit message.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { loadBaselineSchema } from "./lib/baseline-schema.mts";

const schema = loadBaselineSchema();
const snapshot = JSON.parse(readFileSync("tests/fixtures/baseline-schema-snapshot.json", "utf8")) as {
  tables: string[];
  forced: string[];
  functionGrants: Record<string, string[]>;
  tableGrants: Record<string, Record<string, string[]>>;
};

test("the baseline is the first and only historical migration", () => {
  const migrations = readdirSync("supabase/migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  assert.equal(migrations[0], "0001_baseline.sql");
});

test("every public table has row-level security enabled", () => {
  assert.deepEqual(schema.tables.filter((table) => !schema.rls(table).enabled), []);
});

test("the table inventory and forced-RLS set match the reviewed snapshot", () => {
  assert.deepEqual([...schema.tables].sort(), snapshot.tables);
  assert.deepEqual(schema.tables.filter((table) => schema.rls(table).forced).sort(), snapshot.forced);
});

test("anonymous callers hold no table or function privilege", () => {
  assert.equal(/ TO anon;$/m.test(schema.source), false);
});

test("table and function privileges match the reviewed snapshot", () => {
  const tableGrants: Record<string, Record<string, string[]>> = {};
  for (const table of [...schema.tables].sort()) {
    const grants = schema.tableGrants(table);
    if (Object.keys(grants).length) tableGrants[table] = Object.fromEntries(Object.entries(grants).sort());
  }
  assert.deepEqual(tableGrants, snapshot.tableGrants);

  const functionGrants: Record<string, string[]> = {};
  for (const name of schema.functionNames) {
    const grantees = schema.functionGrantees(name);
    if (grantees.length) functionGrants[name] = grantees;
  }
  assert.deepEqual(functionGrants, snapshot.functionGrants);
});

test("every SECURITY DEFINER function pins a search_path ending in pg_temp", () => {
  const unsafe = schema.blocks
    .filter((block) => block.type === "FUNCTION" && /SECURITY DEFINER/.test(block.sql))
    .filter((block) => !/SET search_path TO [^\n]*'pg_temp'\n/.test(block.sql))
    .map((block) => block.name);
  assert.deepEqual(unsafe, []);
});

test("default privileges are revoked before any object is created", () => {
  const revoke = schema.source.indexOf("alter default privileges in schema public revoke execute on functions from anon");
  const firstObject = schema.source.search(/^CREATE (FUNCTION|TABLE) /m);
  assert.ok(revoke > 0 && revoke < firstObject);
});

test("no retired feature remains in the schema", () => {
  const retired = /\b(whatsapp_\w+|apollo_\w+|swarm_\w+|aria_jobs|agent_framework_\w+|agent_runs|agent_memories|databricks_\w+|loop_events|sourcing_loop_controls|outreach_sequences)\b/;
  assert.deepEqual(schema.tables.filter((table) => retired.test(table)), []);
  assert.deepEqual(schema.functionNames.filter((name) => retired.test(name) || /whatsapp|apollo|swarm|aria_job/.test(name)), []);
  assert.equal(retired.test(schema.fn("request_candidate_erasure")), false);
});

test("ensure_workspace reads the caller email from the JWT, not auth.users", () => {
  const body = schema.fn("ensure_workspace");
  assert.match(body, /current_setting\('request\.jwt\.claims', true\)[\s\S]*->> 'email'/);
  assert.doesNotMatch(body, /from auth\.users/);
  assert.match(body, /SECURITY DEFINER/);
});

test("provider runs and enrichment budgets no longer depend on autopilot loop controls", () => {
  assert.doesNotMatch(schema.fn("begin_provider_run"), /sourcing_loop_controls|control_blocked/);
  assert.doesNotMatch(schema.fn("claim_enrichment_budget"), /sourcing_loop_controls|control_blocked/);
});

test("client roles lose table privileges that bypass row-level security", () => {
  const migration = readFileSync("supabase/migrations/0002_revoke_unused_client_table_privileges.sql", "utf8");
  assert.match(migration, /revoke truncate, trigger, references, maintain on table %s from anon, authenticated, authenticator/);
  assert.match(migration, /c\.relkind in \('r', 'p'\)/);
});
