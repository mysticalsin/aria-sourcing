import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

let pass = 0;

function test(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`PASS: ${name}`);
}

function source(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const migration = source("supabase/migrations/0001_baseline.sql");
const store = source("src/lib/store.ts");
const storeContracts = source("src/lib/store/contracts.ts");
const fleetPage = source("src/app/fleet/page.tsx");
const dispatcher = source("src/lib/dispatch-outbound.ts");
const complianceRoute = source("src/app/api/compliance/suppress/route.ts");

test("agent specs, outbound messages, and mailboxes are bound to seats in the same workspace", () => {
  assert.ok(migration.length > 0);
  assert.match(migration, /CREATE UNIQUE INDEX agent_seats_workspace_id_id_key ON public\.agent_seats USING btree \(workspace_id, id\);/);
  for (const [constraint, onDelete] of [
    ["agent_specs_workspace_seat_fkey", "ON DELETE SET NULL (seat_id)"],
    ["messages_outbound_workspace_seat_fkey", "ON DELETE SET NULL (seat_id)"],
    ["email_connections_workspace_seat_fkey", "ON DELETE CASCADE"],
  ]) {
    const table = constraint.replace(/_workspace_seat_fkey$/, "");
    assert.ok(
      migration.includes(
        `ALTER TABLE ONLY public.${table}\n    ADD CONSTRAINT ${constraint} FOREIGN KEY (workspace_id, seat_id) REFERENCES public.agent_seats(workspace_id, id) ${onDelete};`,
      ),
      `${constraint} must bind the seat within the same workspace`,
    );
  }
});

test("seat bindings are validated constraints, not NOT VALID placeholders", () => {
  assert.doesNotMatch(migration, /workspace_seat_fkey[^;]*NOT VALID;/);
});

test("the dispatcher scopes both spec and seat reads to the outbox workspace", () => {
  assert.match(dispatcher, /\.from\("agent_specs"\)[\s\S]+\.eq\("id",\s*msg\.spec_id\)[\s\S]+\.eq\("workspace_id",\s*msg\.workspace_id\)/i);
  assert.match(dispatcher, /\.from\("agent_seats"\)[\s\S]+\.eq\("id",\s*msg\.seat_id[^)]*\)[\s\S]+\.eq\("workspace_id",\s*msg\.workspace_id\)/i);
});

test("Fleet sourcing uses the reviewed real-provider path and never the synthetic generator", () => {
  assert.doesNotMatch(store, /\bconst runFleetSourcing\b/);
  assert.doesNotMatch(storeContracts, /\brunFleetSourcing\s*:/);
  assert.doesNotMatch(store, /\bsourceCandidates\b/);
  assert.match(fleetPage, /await actions\.sourceNextBatch\(campaignId/);
  assert.match(fleetPage, /Select one reviewed campaign before sourcing/i);
});

test("Fleet bulk demo seeding is unreachable in a live workspace", () => {
  assert.match(store, /const deployAgents[\s\S]+if \(supabaseEnabled\)[\s\S]+created:\s*0/i);
  assert.match(fleetPage, /!supabaseEnabled[\s\S]+Generate demo agents/i);
  assert.doesNotMatch(fleetPage, />\s*Deploy agents\s*</i);
});


test("live compliance persistence unavailability fails closed", () => {
  const unavailableBranches = [...complianceRoute.matchAll(/if \(!supabase\)\s*\{([\s\S]*?)\n\s*\}/g)];
  assert.equal(unavailableBranches.length, 2);
  for (const branch of unavailableBranches) {
    assert.match(branch[1], /status:\s*503/);
    assert.doesNotMatch(branch[1], /ok:\s*true/);
  }
});






test("memory content never returns to legacy workspace activity or state", () => {
  assert.doesNotMatch(store, /title:\s*`Memory stored/);
  assert.doesNotMatch(store, /notes:\s*content\.trim\(\)\.slice\(0,\s*80\)/);
});

console.log(`RESULT agent-operational-authority: ${pass} passed, 0 failed`);
