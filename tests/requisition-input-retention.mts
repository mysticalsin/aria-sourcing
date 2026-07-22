import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/0057_requisition_input_retention.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/rollbacks/0057_requisition_input_retention.sql",
  "utf8",
);
const cleanupWorker = readFileSync(
  "scripts/apollo-authority-cleanup-worker.mjs",
  "utf8",
);

test("0057 makes raw input nullable under a bounded workspace retention control", () => {
  assert.match(migration, /alter table public\.requisition_inputs\s+alter column content drop not null/i);
  assert.match(migration, /raw_requisition_retention_days integer not null default 30/i);
  assert.match(migration, /raw_requisition_retention_days between 7 and 365/i);
  assert.match(migration, /content is null[\s\S]*content_scrubbed_at is not null/i);
});

test("only the current tenant authenticated administrator can configure retention", () => {
  assert.match(migration, /create or replace function public\.configure_requisition_input_retention\(\s*p_workspace_id uuid,\s*p_retention_days integer/i);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'authenticated'/i);
  assert.match(migration, /public\.current_workspace_id\(\)[\s\S]*p_workspace_id/i);
  assert.match(migration, /profile\.id = auth\.uid\(\)[\s\S]*profile\.workspace_id = p_workspace_id[\s\S]*profile\.role = 'admin'/i);
});

test("cleanup receipts are content-free, append-only, tenant-bound authority", () => {
  const receiptTable = migration.match(
    /create table public\.requisition_input_cleanup_receipts \([\s\S]*?\n\);/i,
  )?.[0] ?? "";
  assert.ok(receiptTable);
  assert.doesNotMatch(receiptTable, /\bcontent\s+text\b/i);
  assert.match(receiptTable, /content_type text not null/i);
  assert.match(receiptTable, /input_sha256 text not null/i);
  assert.match(migration, /requisition_input_cleanup_receipts[\s\S]*enable row level security/i);
  assert.match(migration, /requisition_input_cleanup_receipts[\s\S]*force row level security/i);
  assert.match(migration, /requisition input cleanup receipts are append-only/i);
});

test("service cleanup is bounded, receipt-backed, and skips concurrently locked rows", () => {
  assert.match(migration, /create or replace function public\.cleanup_requisition_input_authority\(\s*p_workspace_id uuid,\s*p_limit integer/i);
  assert.match(migration, /p_limit not between 1 and 500/i);
  assert.match(migration, /receipt\.completed_at <= wall_now - make_interval\(days => control\.raw_requisition_retention_days\)/i);
  assert.match(migration, /for update of input skip locked/i);
  assert.match(migration, /set content = null,[\s\S]*content_scrubbed_at = wall_now/i);
  assert.match(migration, /insert into public\.requisition_input_cleanup_receipts/i);
  assert.match(migration, /grant execute on function public\.cleanup_requisition_input_authority\(uuid, integer\)\s+to service_role/i);
});

test("scrubbed exact ingress replays by hash while changed input conflicts", () => {
  assert.match(migration, /rename to ingest_requisition_and_enqueue_pre0057/i);
  assert.match(migration, /existing_input\.content is null/i);
  assert.match(migration, /existing_input\.need_sha256 is distinct from request_hash[\s\S]*idempotency_conflict/i);
  assert.match(migration, /existing_input\.content_type is distinct from p_content_type[\s\S]*idempotency_conflict/i);
  assert.match(migration, /public\.ingest_requisition_and_enqueue_pre0057\(/i);
});

test("cleanup worker accepts only the exact bounded requisition counters", () => {
  assert.match(cleanupWorker, /cleanup_requisition_input_authority/);
  assert.match(cleanupWorker, /requisition_inputs_processed/);
  assert.match(cleanupWorker, /requisition_inputs_scrubbed/);
  assert.match(cleanupWorker, /requisition_cleanup_receipts_written/);
  assert.match(cleanupWorker, /processed > limit/);
  assert.match(cleanupWorker, /processed !== raw_inputs_scrubbed[\s\S]*processed !== receipts_written/);
});

test("rollback refuses to erase cleanup evidence or pretend scrubbed content is recoverable", () => {
  assert.match(rollback, /refusing 0057 rollback because raw requisition cleanup evidence exists/i);
  assert.match(rollback, /content is null/i);
  assert.match(rollback, /rename to ingest_requisition_and_enqueue/i);
});
