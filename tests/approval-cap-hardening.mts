/**
 * Sentinel delta on 9e231dfc. These fail until the cap is server-owned,
 * the count read fails closed, and the wire hash matches SQL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("test_consume_cap_is_service_owned", () => {
  const latest = read("supabase/migrations/0012_server_owned_channel_cap.sql");
  assert.match(latest, /create function public\.consume_outreach_channel_daily_cap\(p_workspace_id uuid, p_channel text\)/i);
  assert.match(latest, /outreach_channel_cap_config/);
  assert.match(latest, /revoke all on function public\.consume_outreach_channel_daily_cap\(uuid, text, integer\) from public, anon, authenticated, service_role/i);
  assert.match(latest, /grant execute on function public\.consume_outreach_channel_daily_cap\(uuid, text\) to service_role;/i);
  assert.doesNotMatch(latest, /consume_outreach_channel_daily_cap\(uuid, text\) to authenticated/i);
});

test("test_cap_table_row_security_denies_by_default", () => {
  const latest = read("supabase/migrations/0012_server_owned_channel_cap.sql");
  assert.match(latest, /alter table public\.outreach_channel_daily_sends enable row level security/i);
  assert.match(latest, /alter table public\.outreach_channel_daily_sends force row level security/i);
  assert.match(latest, /revoke all on table public\.outreach_channel_daily_sends from public, anon, authenticated/i);
});

test("test_ttl_assertion_reads_effective_migration", () => {
  const source = read("tests/approval-devin-gate.mts");
  const start = source.indexOf("test_claim_email_outbound_requires_a_current_approved_at");
  const fn = source.slice(start, start + 700);
  assert.doesNotMatch(fn, /0001_baseline\.sql/);
  assert.match(fn, /0013_claim_exact_recompute\.sql/);
});

test("test_preview_reads_the_server_cap_table", () => {
  const send = read("src/app/api/outreach/send/route.ts");
  const dispatch = read("src/lib/dispatch-outbound.ts");
  for (const source of [send, dispatch]) {
    assert.match(source, /daily_cap/);
    assert.doesNotMatch(source, /channelDailyCapFromEnv/);
  }
});

test("test_daily_count_read_fails_closed_and_cap_is_after_the_gate", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const send = read("src/app/api/outreach/send/route.ts");
  assert.match(dispatch, /daily-count-unavailable/);
  const claimSql = read("supabase/migrations/0013_claim_exact_recompute.sql");
  const claimFn = claimSql.slice(claimSql.indexOf("create function public.claim_email_outbound("));
  assert.match(claimFn, /apply_channel_daily_cap/);
  assert.doesNotMatch(send, /consume_outreach_channel_daily_cap/);
  assert.doesNotMatch(dispatch, /consume_outreach_channel_daily_cap/);
  const claimAt = send.indexOf('rpc("claim_email_outbound"');
  const claimCall = send.slice(claimAt, claimAt + 700);
  assert.match(claimCall, /p_body_hash:\s*wireHash/);
  assert.match(claimCall, /p_subject:\s*subject/);
  assert.match(claimCall, /p_body:\s*body/);
  assert.doesNotMatch(claimCall, /p_cap:/);
});
