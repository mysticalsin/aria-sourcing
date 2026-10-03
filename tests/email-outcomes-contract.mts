import { existsSync, readFileSync } from "node:fs";

// Rock 3 completion — candidate outcome events. Pins that outcomes are append-only
// (client read-only, service writes, erasure deletes), idempotent, tombstone-skipping
// for erased candidates, enrolled in 0033 erasure the proven candidate-derived way
// (a cleanup trigger on candidate_erasure_requests), and that a correlated reply
// records a reply_received outcome idempotently.

const migrationPath = "supabase/migrations/0041_email_outcomes.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const privPath = "tests/db/function-privileges.sql";
const priv = existsSync(privPath) ? readFileSync(privPath, "utf8") : "";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}
function section(source: string, start: string, end?: string): string {
  const startAt = source.indexOf(start);
  if (startAt < 0) return "";
  const endAt = end ? source.indexOf(end, startAt + start.length) : source.length;
  return source.slice(startAt, endAt < 0 ? source.length : endAt);
}

ok("migration 0041 exists", migration.length > 0);
ok(
  "migration leaves transaction ownership to the bootstrap runner",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);

// ── table: append-only grant model, force RLS, idempotency ──
const table = section(migration, "create table if not exists public.candidate_outcome_events");
ok(
  "candidate_outcome_events: constrained kind, per-workspace idempotency, force RLS",
  /kind\s+text not null check \(kind in \(/i.test(table) &&
    /unique \(workspace_id, idempotency_key\)/i.test(table) &&
    /alter table public\.candidate_outcome_events force row level security/i.test(migration),
);
ok(
  "candidate_outcome_events is append-only for clients (select-only grant, no client writes)",
  /revoke all on public\.candidate_outcome_events\s+from public, anon, authenticated, service_role, authenticator/i.test(
    migration,
  ) &&
    /grant select on public\.candidate_outcome_events to authenticated/i.test(migration) &&
    /for select to authenticated using \(workspace_id = public\.current_workspace_id\(\)\)/i.test(migration),
);

// ── record_candidate_outcome: service-only, idempotent, tombstone-skip ──
const record = section(
  migration,
  "create or replace function public.record_candidate_outcome(",
  "revoke all on function public.record_candidate_outcome",
);
ok(
  "record_candidate_outcome is service-only and idempotent",
  /auth\.role\(\)[\s\S]*?<> 'service_role'/i.test(record) &&
    /exception when unique_violation then[\s\S]*?'duplicate', true/i.test(record),
);
ok(
  "record_candidate_outcome refuses an erased (tombstoned) candidate, guarding the HMAC hoist",
  /from public\.candidate_erasure_suppression_tombstones t\s+where t\.workspace_id = p_workspace_id and t\.identifier_kind = 'candidate_id'/i.test(
    record,
  ) &&
    /identifier_hmac = public\.candidate_erasure_identifier_hmac\(\s*p_workspace_id, 'candidate_id', p_candidate_id\)/i.test(
      record,
    ) &&
    /'reason', 'candidate-erased'/i.test(record),
);

// ── erasure cleanup trigger on candidate_erasure_requests (proven 0035 shape) ──
ok(
  "erased candidates' outcomes are deleted via a cleanup trigger on candidate_erasure_requests",
  /create or replace function public\.cleanup_erased_candidate_outcomes\(\)[\s\S]*?delete from public\.candidate_outcome_events\s+where workspace_id = new\.workspace_id\s+and candidate_id = new\.candidate_id/i.test(
    migration,
  ) &&
    /create trigger candidate_erasure_requests_outcomes_cleanup\s+after insert or update on public\.candidate_erasure_requests[\s\S]*?when \(new\.status <> 'blocked_legal_hold'\)\s+execute function public\.cleanup_erased_candidate_outcomes\(\)/i.test(
      migration,
    ),
);

// ── correlate wiring: a single-match reply records reply_received idempotently ──
const correlate = section(
  migration,
  "create or replace function public.correlate_inbound_email(",
  "alter function public.record_candidate_outcome",
);
ok(
  "a correlated reply records a reply_received outcome keyed by the inbound id (result captured)",
  /outcome_result :=\s*public\.record_candidate_outcome\(\s*inbound\.workspace_id, ledger\.candidate_id, 'reply_received', 'reply:' \|\| inbound\.id::text, inbound\.id\)/i.test(
    correlate,
  ),
);
ok(
  "an erased-candidate outcome skips stamping candidate_id on the inbound",
  /if outcome_result->>'reason' = 'candidate-erased' then/i.test(correlate)
    && /last_processing_error = 'candidate-erased'/i.test(correlate),
);
ok(
  "outcome_recorded reflects the real record_candidate_outcome result",
  /'outcome_recorded', coalesce\(outcome_result->>'ok', 'false'\)::boolean/i.test(correlate),
);

// ── grants + registry ──
ok(
  "record_candidate_outcome is service_role-only, owner postgres",
  /grant execute on function public\.record_candidate_outcome\(uuid, text, text, text, uuid\) to service_role;/i.test(
    migration,
  ) && /alter function public\.record_candidate_outcome\(uuid, text, text, text, uuid\) owner to postgres;/i.test(migration),
);
ok(
  "function-privileges registers the outcome authority",
  /public\.record_candidate_outcome\(uuid,text,text,text,uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.cleanup_erased_candidate_outcomes\(\)'\s*,\s*'owner_only'/i.test(priv),
);

console.log(`RESULT email-outcomes-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
