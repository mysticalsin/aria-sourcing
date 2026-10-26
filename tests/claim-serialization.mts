// Seat-claim serialization contract for public.claim_and_record in the baseline schema.
import { loadBaselineSchema } from "./lib/baseline-schema.mts";

const schema = loadBaselineSchema();
const migration = schema.fn("claim_and_record");

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
  "claim_and_record keeps the exact six-parameter signature",
  migration.startsWith(
    "CREATE FUNCTION public.claim_and_record(p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid, p_channel text DEFAULT 'Email'::text, p_recontact_days integer DEFAULT 90) RETURNS json",
  ),
);
ok(
  "function stays SECURITY DEFINER",
  /language plpgsql security definer/i.test(migration),
);
ok(
  "header saves the hardened search_path",
  /SET search_path TO 'pg_catalog', 'public', 'pg_temp'\n/.test(migration),
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
  "daily count filters per seat, per day, over claimed, sent, and ambiguous",
  /select count\(\*\) into used_today from public\.outreach_ledger\s+where seat_id = p_seat_id and at::date = now\(\)::date and status in \('claimed','sent','ambiguous'\)/i.test(
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
const body = migration.slice(migration.indexOf("AS $$"), migration.lastIndexOf("$$;"));
ok(
  "function body has no auth.role() service assertion (the authenticated claim_email_outbound wrapper invokes this as owner)",
  body.length > 0 && !/auth\.role\(\)/.test(body),
);
ok(
  "execution is granted to service_role only",
  JSON.stringify(schema.functionGrantees("claim_and_record")) === JSON.stringify(["service_role"]),
);
ok(
  "no standalone transaction statements in the baseline (bootstrap owns the transaction)",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(schema.source),
);

console.log(`RESULT claim-serialization: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
