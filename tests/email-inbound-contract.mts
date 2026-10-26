import { loadBaselineSchema } from "./lib/baseline-schema.mts";
import { existsSync, readFileSync } from "node:fs";

// Inbound email persistence + reply correlation, as defined in the baseline
// schema: a reply threads back to the exact send via
// In-Reply-To <-> outreach_ledger.rfc_message_id, exactly-one-match correlates,
// zero/many fail closed to triage, and every RPC is service-role only.

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

// ── inbound_mailbox_routes: force-RLS routing config, service-writes-only ──
const routes = schema.table("inbound_mailbox_routes");
ok(
  "inbound_mailbox_routes: globally-unique lowercased mailbox, force RLS",
  /mailbox_address text NOT NULL[\s\S]*?mailbox_address = lower\(mailbox_address\)/.test(routes) &&
    migration.includes("ADD CONSTRAINT inbound_mailbox_routes_mailbox_address_key UNIQUE (mailbox_address);") &&
    schema.rls("inbound_mailbox_routes").forced,
);
ok(
  "inbound_mailbox_routes: members read own workspace, no client writes",
  JSON.stringify(schema.tableGrants("inbound_mailbox_routes")) === JSON.stringify({ authenticated: ["SELECT"] }) &&
    migration.includes(
      "CREATE POLICY inbound_mailbox_routes_member_read ON public.inbound_mailbox_routes FOR SELECT TO authenticated USING ((workspace_id = public.current_workspace_id()));",
    ),
);

// ── messages_inbound carries correlation provenance ──
ok(
  "messages_inbound has correlated_ledger_id + correlated_outbound_id",
  /^    correlated_ledger_id uuid,$/m.test(schema.table("messages_inbound")) &&
    /^    correlated_outbound_id uuid,$/m.test(schema.table("messages_inbound")),
);

// ── resolve_inbound_mailbox_route: service-only, no-route fail-closed ──
const resolve = schema.fn("resolve_inbound_mailbox_route");
ok(
  "resolve_inbound_mailbox_route is service-only and returns no-route on miss",
  /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?'service-only'/i.test(resolve) &&
    /'reason', 'no-route'/i.test(resolve) &&
    /SECURITY DEFINER\n    SET search_path TO 'pg_catalog', 'public', 'pg_temp'\n/.test(resolve),
);

// ── record_inbound_email: service-only, idempotent on redelivery ──
const record = schema.fn("record_inbound_email");
ok(
  "record_inbound_email is service-only, inserts channel Email, idempotent on redelivery",
  /auth\.role\(\)[\s\S]*?<> 'service_role'/i.test(record) &&
    /insert into public\.messages_inbound\([\s\S]*?'Email'/i.test(record) &&
    /exception when unique_violation then[\s\S]*?'duplicate', true/i.test(record),
);

// ── correlate_inbound_email: the fail-closed reply<->rfc correlation ──
const correlate = schema.fn("correlate_inbound_email");
ok(
  "correlate is service-only and locks the inbound row",
  /auth\.role\(\)[\s\S]*?<> 'service_role'/i.test(correlate) &&
    /from public\.messages_inbound[\s\S]*?where id = p_inbound_id[\s\S]*?for update/i.test(correlate),
);
ok(
  "correlate matches In-Reply-To against outreach_ledger.rfc_message_id (sent/ambiguous)",
  /l\.rfc_message_id = needle[\s\S]*?l\.status in \('sent', 'ambiguous'\)/i.test(correlate),
);
ok(
  "correlate FAILS CLOSED on no header / no match / ambiguous (never guesses identity)",
  /'reason', 'no-in-reply-to'/i.test(correlate) &&
    /if match_count = 0 then[\s\S]*?'reason', 'no-match'/i.test(correlate) &&
    /if match_count > 1 then[\s\S]*?'reason', 'ambiguous'/i.test(correlate),
);
ok(
  "correlate stamps candidate + ledger + outbound and marks processed on the single match",
  /set candidate_id = ledger\.candidate_id,\s*campaign_id = ledger\.campaign_id,\s*correlated_ledger_id = ledger\.id,\s*correlated_outbound_id = ledger\.outbound_message_id,[\s\S]*?correlation_status = 'correlated',\s*processed = true[\s\S]*?where id = inbound\.id\s+and processed = false;/i.test(
    correlate,
  ),
);

// ── all three RPCs are service_role only and owned by the migrator ──
ok(
  "all three inbound RPCs granted to service_role only",
  ["resolve_inbound_mailbox_route", "record_inbound_email", "correlate_inbound_email"].every(
    (name) => JSON.stringify(schema.functionGrantees(name)) === JSON.stringify(["service_role"]),
  ) && !/OWNER TO/.test(migration),
);

// ── privilege registry knows the new inbound authority ──
ok(
  "function-privileges registers the inbound RPCs as service_role",
  /public\.resolve_inbound_mailbox_route\(text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.record_inbound_email\(uuid,text,text,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.correlate_inbound_email\(uuid,text\)'\s*,\s*'service_role'/i.test(priv),
);

console.log(`RESULT email-inbound-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
