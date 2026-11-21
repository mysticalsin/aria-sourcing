/**
 * Sentinel delta on 9e231dfc. These fail until the cap is server-owned,
 * the count read fails closed, and the wire hash matches SQL.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function migrations(): string {
  return readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => read(`supabase/migrations/${name}`))
    .join("\n");
}

test("test_consume_cap_is_service_owned", () => {
  const sql = migrations();
  assert.match(sql, /create (or replace )?function public\.consume_outreach_channel_daily_cap\(p_workspace_id uuid, p_channel text\)/i);
  assert.match(sql, /outreach_channel_cap_config/);
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.consume_outreach_channel_daily_cap\(uuid, text, integer\) to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.consume_outreach_channel_daily_cap\(uuid, text\) to authenticated/i,
  );
});

test("test_cap_table_row_security_denies_by_default", () => {
  const sql = migrations();
  assert.match(sql, /alter table public\.outreach_channel_daily_sends enable row level security/i);
  assert.match(sql, /alter table public\.outreach_channel_daily_sends force row level security/i);
});

test("test_daily_count_read_fails_closed_and_cap_is_after_the_gate", () => {
  const dispatch = read("src/lib/dispatch-outbound.ts");
  const send = read("src/app/api/outreach/send/route.ts");
  assert.match(dispatch, /daily-count-unavailable/);
  assert.ok(dispatch.indexOf("gateOutbound(") < dispatch.lastIndexOf("consume_outreach_channel_daily_cap"));
  const claimAt = send.indexOf('rpc("claim_email_outbound"');
  const consumeAt = send.lastIndexOf("consume_outreach_channel_daily_cap");
  assert.ok(claimAt >= 0 && consumeAt > claimAt);
  const claimCall = send.slice(claimAt, claimAt + 500);
  assert.match(claimCall, /p_body_hash:\s*wireHash/);
  assert.doesNotMatch(claimCall, /p_cap:/);
});
