// Cross-channel daily-cap contract: the generic seat claim and the queued
// Email claim share one per-seat cap that counts ambiguous outcomes.
import { loadBaselineSchema } from "./lib/baseline-schema.mts";

const schema = loadBaselineSchema();

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const generic = schema.fn("claim_and_record");
const email = schema.fn("claim_email_outbound_queued");

ok(
  "generic claim preserves the exact six-parameter signature",
  generic.startsWith(
    "CREATE FUNCTION public.claim_and_record(p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid, p_channel text DEFAULT 'Email'::text, p_recontact_days integer DEFAULT 90) RETURNS json",
  ),
);
ok(
  "generic claim locks the workspace seat before counting and inserting",
  generic.indexOf("from public.agent_seats") >= 0 &&
    generic.indexOf("from public.agent_seats") < generic.indexOf("for update") &&
    generic.indexOf("for update") < generic.indexOf("count(*)") &&
    generic.indexOf("count(*)") < generic.indexOf("insert into public.outreach_ledger"),
);
ok(
  "generic claim counts worst-case ambiguous outcomes",
  /where seat_id = p_seat_id[\s\S]*?status in \('claimed','sent','ambiguous'\)/i.test(generic),
);
ok(
  "generic claim keeps its hardened definer boundary",
  /LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'pg_catalog', 'public', 'pg_temp'\n/.test(generic),
);

ok(
  "queued Email claim preserves its exact UUID signature",
  email.startsWith("CREATE FUNCTION public.claim_email_outbound_queued(p_message_id uuid) RETURNS json"),
);
ok(
  "queued Email claim keeps its in-body service-role assertion",
  /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?'service-only'/i.test(email),
);
ok(
  "queued Email claim preserves outbox, approval, then seat lock order",
  email.indexOf("from public.messages_outbound") >= 0 &&
    email.indexOf("from public.messages_outbound") < email.indexOf("pg_advisory_xact_lock") &&
    email.indexOf("pg_advisory_xact_lock") < email.indexOf("from public.outreach_approvals") &&
    email.indexOf("from public.outreach_approvals") < email.indexOf("from public.agent_seats") &&
    email.indexOf("from public.agent_seats") < email.indexOf("count(*)") &&
    email.indexOf("count(*)") < email.indexOf("insert into public.outreach_ledger"),
);
ok(
  "queued Email claim takes the same workspace-scoped seat row lock",
  /from public\.agent_seats\s+where id = outbound\.seat_id and workspace_id = outbound\.workspace_id\s+for update/i.test(email),
);
ok(
  "queued Email claim counts worst-case ambiguous outcomes",
  /where l\.seat_id = seat\.id[\s\S]*?l\.status in \('claimed', 'sent', 'ambiguous'\)/i.test(email),
);
ok(
  "queued Email claim keeps its hardened pgcrypto definer boundary",
  /SECURITY DEFINER\n    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'\n/.test(email),
);
ok(
  "both direct claim RPCs remain service-role only",
  JSON.stringify(schema.functionGrantees("claim_and_record")) === JSON.stringify(["service_role"]) &&
    JSON.stringify(schema.functionGrantees("claim_email_outbound_queued")) === JSON.stringify(["service_role"]),
);

console.log(`RESULT cross-channel-cap-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
