import { loadBaselineSchema } from "./lib/baseline-schema.mts";
import { existsSync, readFileSync } from "node:fs";

// Rock 3 completion — candidate outcome events. Pins that outcomes are append-only
// (client read-only, service writes, erasure deletes), idempotent, tombstone-skipping
// for erased candidates, enrolled in 0033 erasure the proven candidate-derived way
// (a cleanup trigger on candidate_erasure_requests), and that a correlated reply
// records a reply_received outcome idempotently.

const migrationPath = "supabase/migrations/0001_baseline.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const schema = loadBaselineSchema();
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

ok("baseline schema exists", migration.length > 0);
ok(
  "baseline leaves transaction ownership to the bootstrap runner",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);

// ── table: append-only grant model, force RLS, idempotency ──
const table = schema.table("candidate_outcome_events");
ok(
  "candidate_outcome_events: constrained kind, per-workspace idempotency, force RLS",
  /CONSTRAINT candidate_outcome_events_kind_check CHECK \(\(kind = ANY \(ARRAY\[/.test(table) &&
    migration.includes(
      "ADD CONSTRAINT candidate_outcome_events_workspace_id_idempotency_key_key UNIQUE (workspace_id, idempotency_key);",
    ) &&
    schema.rls("candidate_outcome_events").forced,
);
ok(
  "candidate_outcome_events is append-only for clients (select-only grant, no client writes)",
  JSON.stringify(schema.tableGrants("candidate_outcome_events")) === JSON.stringify({ authenticated: ["SELECT"] }) &&
    migration.includes(
      "CREATE POLICY candidate_outcome_events_member_read ON public.candidate_outcome_events FOR SELECT TO authenticated USING ((workspace_id = public.current_workspace_id()));",
    ),
);

// ── record_candidate_outcome: service-only, idempotent, tombstone-skip ──
const record = schema.fn("record_candidate_outcome");
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

// ── erasure cleanup trigger on candidate_erasure_requests ──
ok(
  "erased candidates' outcomes are deleted via a cleanup trigger on candidate_erasure_requests",
  /delete from public\.candidate_outcome_events\s+where workspace_id = new\.workspace_id\s+and candidate_id = new\.candidate_id/i.test(
    schema.fn("cleanup_erased_candidate_outcomes"),
  ) &&
    migration.includes(
      "CREATE TRIGGER candidate_erasure_requests_outcomes_cleanup AFTER INSERT OR UPDATE ON public.candidate_erasure_requests FOR EACH ROW WHEN ((new.status <> 'blocked_legal_hold'::text)) EXECUTE FUNCTION public.cleanup_erased_candidate_outcomes();",
    ),
);

// ── correlate wiring: a single-match reply records reply_received idempotently ──
const correlate = schema.fn("correlate_inbound_email");
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
  "record_candidate_outcome is service_role-only and owned by the migrator",
  JSON.stringify(schema.functionGrantees("record_candidate_outcome")) === JSON.stringify(["service_role"]) &&
    !/OWNER TO/.test(migration),
);
ok(
  "function-privileges registers the outcome authority",
  /public\.record_candidate_outcome\(uuid,text,text,text,uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.cleanup_erased_candidate_outcomes\(\)'\s*,\s*'owner_only'/i.test(priv),
);

console.log(`RESULT email-outcomes-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
