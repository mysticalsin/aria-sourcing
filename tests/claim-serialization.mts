import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/0021_claim_serialization.sql", "utf8");
const fleet = readFileSync("supabase/migrations/0002_fleet.sql", "utf8");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok(
  "claim_and_record is redefined with the exact six-parameter signature",
  /create or replace function public\.claim_and_record\(\s*p_candidate_id\s+text,\s*p_candidate_email\s+text,\s*p_campaign_id\s+text,\s*p_seat_id\s+uuid,\s*p_channel\s+text default 'Email',\s*p_recontact_days\s+int\s+default 90\s*\) returns json/i.test(
    migration,
  ),
);
ok(
  "function stays SECURITY DEFINER",
  /language plpgsql security definer/i.test(migration),
);
ok(
  "header saves the 0019-hardened search_path (create or replace resets proconfig)",
  /set search_path = pg_catalog, public, pg_temp/.test(migration) &&
    !/set search_path = public\s+as/i.test(migration),
);
ok(
  "seat row is locked per workspace before the cap check",
  /from public\.agent_seats\s+where id = p_seat_id and workspace_id = wid\s+for update/i.test(migration),
);
ok(
  "seat lock precedes the daily count, and the count precedes the claimed insert",
  migration.indexOf("for update") !== -1 &&
    migration.indexOf("for update") < migration.indexOf("count(*)") &&
    migration.indexOf("count(*)") < migration.indexOf("insert into public.outreach_ledger"),
);
ok(
  "daily count still filters per seat, per day, over claimed+sent",
  /select count\(\*\) into used_today from public\.outreach_ledger\s+where seat_id = p_seat_id and at::date = now\(\)::date and status in \('claimed','sent'\)/i.test(
    migration,
  ),
);
ok(
  "cap breach fails closed with the exact load-bearing reason",
  /if used_today >= cap then[\s\S]*?'seat daily cap reached'/i.test(migration),
);
ok(
  "unique_violation handler is preserved (same-candidate race stays fail-closed)",
  /exception when unique_violation then[\s\S]*?'already contacted'/i.test(migration),
);
ok(
  "every caller-facing reason string and the JSON shape survive the replacement",
  ["'no workspace'", "'suppressed'", "'recently contacted'", "'seat not found'", "'seat not active'", "'seat daily cap reached'", "'already contacted'", "'ok', 'ledger_id', new_id"].every(
    (reason) => migration.includes(reason),
  ),
);
// Mirror tests/db/function-privileges.sql: pg_get_functiondef sees only the
// dollar-quoted body, so scope the assertion there (the header comment may
// legitimately explain WHY the assertion is absent).
const body = migration.slice(migration.indexOf("as $$"), migration.lastIndexOf("$$;"));
ok(
  "function body has no auth.role() service assertion (the authenticated claim_email_outbound wrapper invokes this as owner)",
  body.length > 0 && !/auth\.role\(\)/.test(body),
);
ok(
  "ACL trailer re-asserts the 0019 end-state: revoke everywhere, grant service_role only",
  /revoke all on function public\.claim_and_record\(text,text,text,uuid,text,int\) from public, anon, authenticated, service_role, authenticator;/i.test(
    migration,
  ) &&
    /grant execute on function public\.claim_and_record\(text,text,text,uuid,text,int\) to service_role;/i.test(migration) &&
    !/grant[^;]*claim_and_record[^;]*to authenticated/i.test(migration),
);
ok(
  "no standalone transaction statements (bootstrap owns the transaction)",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);
ok(
  "no new tables, indexes or helper functions (legacy baseline pins the schema shape)",
  !/create table/i.test(migration) &&
    !/create index/i.test(migration) &&
    (migration.match(/create (?:or replace )?function/gi) ?? []).length === 1,
);
ok(
  "0002_fleet.sql is untouched — the fix landed as a NEW migration, not a ledger edit",
  fleet.includes(
    "select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;",
  ) && !fleet.includes("for update"),
);

console.log(`RESULT claim-serialization: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
