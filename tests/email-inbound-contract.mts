import { existsSync, readFileSync } from "node:fs";

// Rock 3 (core) — inbound email persistence + reply correlation. Pins the 0040
// authority shape: a reply threads back to the exact send via
// In-Reply-To <-> outreach_ledger.rfc_message_id, exactly-one-match correlates,
// zero/many fail closed to triage, and every RPC is service-role only. Also
// pins that the higher-risk candidate_outcome_events erasure enrollment is NOT
// smuggled into this migration (deferred to a Codex + erasure-suite session).

const migrationPath = "supabase/migrations/0040_email_inbound_correlation.sql";
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

ok("migration 0040 exists", migration.length > 0);
ok(
  "migration leaves transaction ownership to the bootstrap runner",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);

// ── inbound_mailbox_routes: force-RLS routing config, service-writes-only ──
const routes = section(migration, "create table if not exists public.inbound_mailbox_routes");
ok(
  "inbound_mailbox_routes: globally-unique lowercased mailbox, force RLS",
  /mailbox_address text not null[\s\S]*?mailbox_address = lower\(mailbox_address\)/i.test(routes) &&
    /unique \(mailbox_address\)/i.test(routes) &&
    /alter table public\.inbound_mailbox_routes force row level security/i.test(migration),
);
ok(
  "inbound_mailbox_routes: members read own workspace, no client writes",
  /grant select on public\.inbound_mailbox_routes to authenticated/i.test(migration) &&
    /for select to authenticated using \(workspace_id = public\.current_workspace_id\(\)\)/i.test(migration) &&
    /revoke all on public\.inbound_mailbox_routes\s+from public, anon, authenticated, service_role, authenticator/i.test(
      migration,
    ),
);

// ── messages_inbound gains correlation provenance (additive) ──
ok(
  "messages_inbound gains correlated_ledger_id + correlated_outbound_id",
  /add column if not exists correlated_ledger_id uuid/i.test(migration) &&
    /add column if not exists correlated_outbound_id uuid/i.test(migration),
);

// ── resolve_inbound_mailbox_route: service-only, no-route fail-closed ──
const resolve = section(
  migration,
  "create or replace function public.resolve_inbound_mailbox_route(",
  "revoke all on function public.resolve_inbound_mailbox_route",
);
ok(
  "resolve_inbound_mailbox_route is service-only and returns no-route on miss",
  /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?'service-only'/i.test(resolve) &&
    /'reason', 'no-route'/i.test(resolve) &&
    /security definer\s+set search_path = pg_catalog, public, pg_temp/i.test(resolve),
);

// ── record_inbound_email: service-only, idempotent on redelivery ──
const record = section(
  migration,
  "create or replace function public.record_inbound_email(",
  "revoke all on function public.record_inbound_email",
);
ok(
  "record_inbound_email is service-only, inserts channel Email, idempotent on redelivery",
  /auth\.role\(\)[\s\S]*?<> 'service_role'/i.test(record) &&
    /insert into public\.messages_inbound\([\s\S]*?'Email'/i.test(record) &&
    /exception when unique_violation then[\s\S]*?'duplicate', true/i.test(record),
);

// ── correlate_inbound_email: the fail-closed reply<->rfc correlation ──
const correlate = section(
  migration,
  "create or replace function public.correlate_inbound_email(",
  "revoke all on function public.correlate_inbound_email",
);
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
  /set candidate_id = ledger\.candidate_id,\s*correlated_ledger_id = ledger\.id,\s*correlated_outbound_id = ledger\.outbound_message_id,\s*processed = true/i.test(
    correlate,
  ),
);

// ── all three RPCs are service_role only, owner postgres ──
ok(
  "all three inbound RPCs granted to service_role only",
  /grant execute on function public\.resolve_inbound_mailbox_route\(text\) to service_role;/i.test(migration) &&
    /grant execute on function public\.record_inbound_email\(uuid, text, text, text\) to service_role;/i.test(migration) &&
    /grant execute on function public\.correlate_inbound_email\(uuid, text\) to service_role;/i.test(migration) &&
    /alter function public\.correlate_inbound_email\(uuid, text\) owner to postgres;/i.test(migration),
);

// ── the deferred high-risk piece is genuinely absent (not smuggled in) ──
// Inspect CODE, not comments: the deferral rationale legitimately names these in
// the migration's -- header, so strip line comments before asserting absence.
const migrationCode = migration.replace(/--[^\n]*/g, "");
ok(
  "candidate_outcome_events + a new 0033 erasure store enrollment are NOT in this migration (deferred)",
  !/candidate_outcome_events/i.test(migrationCode) &&
    !/store_name/i.test(migrationCode) &&
    !/candidate_erasure/i.test(migrationCode),
);

// ── privilege registry knows the new inbound authority ──
ok(
  "function-privileges registers the inbound RPCs as service_role",
  /public\.resolve_inbound_mailbox_route\(text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.record_inbound_email\(uuid,text,text,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.correlate_inbound_email\(uuid,text\)'\s*,\s*'service_role'/i.test(priv),
);

const webhookRoute = existsSync("src/app/api/webhooks/email-inbound/route.ts")
  ? readFileSync("src/app/api/webhooks/email-inbound/route.ts", "utf8")
  : "";
const inboundIngest = existsSync("src/lib/inbound-email-ingest.ts")
  ? readFileSync("src/lib/inbound-email-ingest.ts", "utf8")
  : "";
const graphWebhook = existsSync("src/app/api/webhooks/microsoft-graph/route.ts")
  ? readFileSync("src/app/api/webhooks/microsoft-graph/route.ts", "utf8")
  : "";
ok(
  "email-inbound webhook routes replies and hiring needs (event-driven, no polling)",
  /ingestNormalizedInboundEmail/i.test(webhookRoute) &&
    /routeInboundEmail/i.test(inboundIngest) &&
    /enqueue_aria_job/i.test(inboundIngest) &&
    /requisition_parse|inbound_classify|jobDecision\.kind/i.test(inboundIngest),
);
ok(
  "email-inbound webhook skips classify enqueue on duplicate redelivery",
  /duplicate/i.test(webhookRoute) && /duplicate/i.test(inboundIngest),
);
ok(
  "Microsoft Graph mail webhook validates clientState and ingests without polling",
  /validationToken/i.test(graphWebhook) &&
    /verifyGraphClientState/i.test(graphWebhook) &&
    /ingestNormalizedInboundEmail/i.test(graphWebhook) &&
    /fetchGraphMessageForIngest/i.test(graphWebhook),
);

const graphSubs = existsSync("src/lib/email-graph-subscriptions.ts")
  ? readFileSync("src/lib/email-graph-subscriptions.ts", "utf8")
  : "";
ok(
  "Graph message ingest prefers text body and normalizes HTML for hiring-need fields",
  /outlook\.body-content-type="text"/i.test(graphSubs) &&
    /normalizeGraphMessageBody/i.test(graphSubs) &&
    /decodeBasicHtmlEntities|&nbsp;/i.test(graphSubs),
);
ok(
  "inbound ingest requires durable enqueue status (not transport-only success)",
  /already_enqueued/i.test(inboundIngest) && /Job enqueue rejected/i.test(inboundIngest),
);

console.log(`RESULT email-inbound-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
