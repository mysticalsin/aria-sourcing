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

const migration = source("supabase/migrations/0032_agent_operational_authority.sql");
const rollback = source("supabase/rollbacks/0032_agent_operational_authority.sql");
const memoryRoute = source("src/app/api/agents/memories/route.ts");
const memoryPanel = source("src/components/memory/memory-panel.tsx");
const memoryPage = source("src/app/memory/page.tsx");
const store = source("src/lib/store.ts");
const storeContracts = source("src/lib/store/contracts.ts");
const fleetPage = source("src/app/fleet/page.tsx");
const specsRoute = source("src/app/api/agents/specs/route.ts");
const dispatcher = source("src/lib/dispatch-outbound.ts");
const complianceRoute = source("src/app/api/compliance/suppress/route.ts");

test("the authority migration and an explicit rollback script exist", () => {
  assert.ok(migration.length > 0);
  assert.ok(rollback.length > 0);
  assert.doesNotMatch(rollback, /drop table if exists public\.agent_framework_run_memory_context/i);
  assert.doesNotMatch(rollback, /drop column if exists (?:memory_context_attached_at|framework_run_id)/i);
});

test("agent specs and outbound senders are bound to seats in the same workspace", () => {
  assert.match(migration, /unique index[^;]+agent_seats[^;]+\(workspace_id,\s*id\)/is);
  assert.match(migration, /agent_specs_workspace_seat_fkey[\s\S]+foreign key \(workspace_id,\s*seat_id\)[\s\S]+references public\.agent_seats \(workspace_id,\s*id\)/i);
  assert.match(migration, /messages_outbound_workspace_seat_fkey[\s\S]+foreign key \(workspace_id,\s*seat_id\)[\s\S]+references public\.agent_seats \(workspace_id,\s*id\)/i);
  assert.match(migration, /whatsapp_senders_workspace_seat_fkey[\s\S]+foreign key \(workspace_id,\s*seat_id\)[\s\S]+references public\.agent_seats \(workspace_id,\s*id\)/i);
  assert.match(migration, /email_connections_workspace_seat_fkey[\s\S]+foreign key \(workspace_id,\s*seat_id\)[\s\S]+references public\.agent_seats \(workspace_id,\s*id\)/i);
  for (const constraint of [
    "agent_specs_workspace_seat_fkey",
    "messages_outbound_workspace_seat_fkey",
    "whatsapp_senders_workspace_seat_fkey",
  ]) {
    assert.match(
      migration,
      new RegExp(`${constraint}[\\s\\S]+on delete set null \\(seat_id\\)`, "i"),
      `${constraint} must preserve the non-null workspace on seat deletion`,
    );
  }
  for (const constraint of [
    "agent_specs_workspace_seat_fkey",
    "messages_outbound_workspace_seat_fkey",
    "whatsapp_senders_workspace_seat_fkey",
    "email_connections_workspace_seat_fkey",
  ]) {
    assert.doesNotMatch(
      rollback,
      new RegExp(`drop constraint if exists ${constraint}`, "i"),
      `${constraint} must survive an executable rollback`,
    );
  }
});

test("legacy cross-workspace seat bindings are neutralized before constraints validate", () => {
  assert.match(migration, /update public\.agent_specs[\s\S]+set seat_id = null[\s\S]+seat\.workspace_id <> spec\.workspace_id/i);
  assert.doesNotMatch(
    migration,
    /update public\.email_connections[\s\S]+set workspace_id\s*=\s*seat\.workspace_id/i,
  );
  assert.match(migration, /delete\s+from\s+public\.email_connections/i);
  assert.match(migration, /validate constraint agent_specs_workspace_seat_fkey/i);
});

test("spec writes validate the seat against the authenticated workspace", () => {
  assert.match(specsRoute, /validateWorkspaceSeat/i);
  assert.match(specsRoute, /\.from\("agent_seats"\)[\s\S]+\.eq\("workspace_id",\s*workspaceId\)[\s\S]+\.eq\("id",\s*seatId\)/i);
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

test("Agent Studio demo mutations fail instead of claiming persistence", () => {
  assert.match(
    specsRoute,
    /!supabaseEnabled[\s\S]+req\.method === "GET"[\s\S]+Agent persistence is unavailable in demo mode[\s\S]+status:\s*503/i,
  );
});

test("live compliance persistence unavailability fails closed", () => {
  const unavailableBranches = [...complianceRoute.matchAll(/if \(!supabase\)\s*\{([\s\S]*?)\n\s*\}/g)];
  assert.equal(unavailableBranches.length, 2);
  for (const branch of unavailableBranches) {
    assert.match(branch[1], /status:\s*503/);
    assert.doesNotMatch(branch[1], /ok:\s*true/);
  }
});

test("normalized AgentSpec memory has an authenticated server-owned management API", () => {
  assert.match(memoryRoute, /export async function GET/);
  assert.match(memoryRoute, /export async function POST/);
  assert.match(memoryRoute, /export async function PATCH/);
  assert.match(memoryRoute, /export async function DELETE/);
  assert.match(memoryRoute, /encryptionRequiredButMissing|secretEncryptionEnabled/);
  assert.match(memoryRoute, /encryptSecret/);
  assert.match(memoryRoute, /content_sha256/);
  assert.match(memoryRoute, /content_byte_count/);
  assert.match(memoryRoute, /pending_review/);
  assert.match(memoryRoute, /Cache-Control[^\n]+no-store/i);
});

test("the Memory screen uses AgentSpecs and never reports legacy workspace memory as durable", () => {
  assert.match(memoryPanel, /\/api\/agents\/memories/);
  assert.match(memoryPanel, /specId/);
  assert.doesNotMatch(memoryPanel, /useMemory|addMemory|updateMemory|removeMemory|togglePinMemory/);
  assert.doesNotMatch(memoryPage, /HermesMemoryPanel/);
});

test("the Memory screen refetches exact-spec pages and exposes incremental loading", () => {
  assert.match(memoryPanel, /params\.set\("specId",\s*specId\)/);
  assert.match(memoryPanel, /params\.set\("limit",\s*String\(MEMORY_PAGE_LIMIT\)\)/);
  assert.match(memoryPanel, /params\.set\("cursor",\s*cursor\)/);
  assert.match(memoryPanel, /React\.useEffect\([\s\S]+selectedSpecId[\s\S]+loadMemories/);
  assert.match(memoryPanel, /append[\s\S]+setMemories/);
  assert.match(memoryPanel, />\s*Load more\s*</);
  assert.doesNotMatch(memoryPanel, /memories\.filter\(\(memory\) => memory\.specId === selectedSpecId\)/);
});

test("the Memory screen incrementally pages AgentSpecs without duplicates", () => {
  assert.match(memoryPanel, /params\.set\("specCursor",\s*specCursor\)/);
  assert.match(memoryPanel, /append[\s\S]+setSpecs[\s\S]+new Set\(current\.map\(\(spec\) => spec\.id\)\)/);
  assert.match(memoryPanel, />\s*Load more agents\s*</);
  assert.match(memoryPanel, /nextSpecCursor/);
});

test("deferred mutations reload only the AgentSpec that is still selected", () => {
  assert.match(memoryPanel, /selectedSpecIdRef/);
  assert.match(memoryPanel, /mutationSpecId/);
  assert.match(memoryPanel, /selectedSpecIdRef\.current === mutationSpecId/);
  assert.doesNotMatch(
    memoryPanel,
    /if \(selectedSpecId\) await loadMemories\(selectedSpecId\)/,
  );
});

test("framework runs persist immutable, bounded memory receipts", () => {
  assert.match(migration, /create table if not exists public\.agent_framework_run_memory_context/i);
  assert.match(migration, /primary key \(framework_run_id,\s*memory_id\)/i);
  assert.match(migration, /position\s+integer[^\n]+between 0 and 7/i);
  assert.match(migration, /byte_count\s+integer[^\n]+between 1 and 8192/i);
  assert.match(migration, /create or replace function public\.claim_agent_framework_run/i);
  assert.match(migration, /from public\.agent_memories[\s\S]+status = 'approved'[\s\S]+for share/i);
  assert.match(migration, /insert into public\.agent_framework_run_memory_context/i);
  assert.match(migration, /memory_context_attached_at/i);
  assert.match(
    migration,
    /if framework_run\.memory_context_attached_at is not null[\s\S]+return selected_count/i,
  );
  assert.match(
    migration,
    /set memory_context_attached_at\s*=\s*now\(\)/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.claim_agent_framework_run_v0029[\s\S]+service_role/i,
  );
});

test("framework memory plaintext crosses the adapter boundary only under a bounded database lease", () => {
  assert.match(migration, /create table if not exists public\.agent_framework_memory_egress_leases/i);
  assert.match(migration, /expires_at\s+timestamptz[\s\S]+expires_at > created_at/i);
  assert.match(migration, /create or replace function public\.authorize_agent_framework_memory_egress/i);
  assert.match(migration, /framework_run\.lease_expires_at <= egress_expires_at/i);
  assert.match(migration, /order by memory\.id[\s\S]+for update of memory/i);
  assert.match(migration, /memory\.revision = context\.memory_revision/i);
  assert.match(migration, /memory\.content_sha256 = context\.content_sha256/i);
  assert.match(migration, /memory\.status = 'approved'/i);
  assert.match(migration, /create or replace function public\.release_agent_framework_memory_egress/i);
  assert.match(migration, /egress\.expires_at <= clock_timestamp\(\)[\s\S]+status', 'lease_expired'/i);
  assert.match(migration, /egress\.released_at is null[\s\S]+egress\.expires_at > clock_timestamp\(\)/i);
  assert.match(rollback, /drop function if exists public\.release_agent_framework_memory_egress/i);
  assert.match(rollback, /drop function if exists public\.authorize_agent_framework_memory_egress/i);
  assert.doesNotMatch(rollback, /drop table if exists public\.agent_framework_memory_egress_leases/i);
});

test("memory content never returns to legacy workspace activity or state", () => {
  assert.doesNotMatch(memoryPanel, /actions\.(?:add|update|remove|togglePin)Memory/);
  assert.doesNotMatch(store, /title:\s*`Memory stored/);
  assert.doesNotMatch(store, /notes:\s*content\.trim\(\)\.slice\(0,\s*80\)/);
});

console.log(`RESULT agent-operational-authority: ${pass} passed, 0 failed`);
