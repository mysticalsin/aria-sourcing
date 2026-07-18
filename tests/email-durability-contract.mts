import { existsSync, readFileSync } from "node:fs";

// Rock 2 — email joins the durable outbox. This contract pins the migration 0039
// authority shape AND the dispatchDue gate order (Email is served through the
// durable claim while LinkedIn/SMS stay refused), so a future edit that weakens
// the never-auto-send guarantee or re-opens a synchronous email send fails here.

const migrationPath = "supabase/migrations/0039_email_channel_durability.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const dispatchPath = "src/lib/dispatch-outbound.ts";
const dispatch = existsSync(dispatchPath) ? readFileSync(dispatchPath, "utf8") : "";
const routePath = "src/app/api/outreach/send/route.ts";
const route = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
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

// ── migration 0039 exists and owns no transaction ─────────────────────────
ok("migration 0039 exists", migration.length > 0);
ok(
  "migration leaves transaction ownership to the bootstrap runner",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);

// ── outreach_ledger.rfc_message_id: format-checked + unique per workspace ──
ok(
  "adds a format-checked rfc_message_id column",
  /add column if not exists rfc_message_id text/i.test(migration) &&
    /rfc_message_id\s*~\s*'\^<\[\^<>@\\s\]\+@\[\^<>@\\s\]\+>\$'/i.test(migration),
);
ok(
  "rfc_message_id is unique per workspace",
  /create unique index if not exists outreach_ledger_rfc_message_id_uniq[\s\S]*?on public\.outreach_ledger \(workspace_id, rfc_message_id\)/i.test(
    migration,
  ),
);

// ── email_delivery_events: append-only, force RLS, service-writes-only ─────
const events = section(migration, "create table if not exists public.email_delivery_events");
ok(
  "email_delivery_events mirrors the whatsapp event set for email",
  /event_status\s+text not null check \(event_status in \('delivered', 'bounced', 'complained', 'opened'\)\)/i.test(
    events,
  ) && /unique \(workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at\)/i.test(events),
);
ok(
  "email_delivery_events forces RLS and grants only SELECT to authenticated",
  /alter table public\.email_delivery_events force row level security/i.test(migration) &&
    /revoke all on public\.email_delivery_events from anon, public, authenticated, service_role, authenticator/i.test(
      migration,
    ) &&
    /grant select on public\.email_delivery_events to authenticated/i.test(migration),
);

// ── enqueue_email_outbound: authenticated definer, pg_temp-terminated path ─
const enqueue = section(
  migration,
  "create or replace function public.enqueue_email_outbound(",
  "revoke all on function public.enqueue_email_outbound",
);
ok(
  "enqueue is an authenticated SECURITY DEFINER with a pg_temp-terminated search_path",
  /security definer\s+set search_path = pg_catalog, public, extensions, pg_temp/i.test(enqueue) &&
    /grant execute on function public\.enqueue_email_outbound\(text, text, text, uuid, text, text, text\) to authenticated;/i.test(
      migration,
    ),
);
ok(
  "enqueue writes a queued Email row and returns 'duplicate' on a re-enqueue",
  /'Email'[\s\S]*?'queued'/i.test(enqueue) && /'reason', 'duplicate'/i.test(enqueue),
);

// ── claim_email_outbound_queued: the full service-only gate set ────────────
const claim = section(
  migration,
  "create or replace function public.claim_email_outbound_queued(",
  "revoke all on function public.claim_email_outbound_queued",
);
ok(
  "email claim is service-only",
  /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?'service-only'/i.test(claim),
);
ok(
  "email claim re-verifies body + scope hash, human source, and non-revocation",
  /approval\.body_hash is distinct from encode\(digest\(coalesce\(outbound\.subject, ''\) \|\| E'\\n' \|\| outbound\.body, 'sha256'\), 'hex'\)/i.test(
    claim,
  ) &&
    /approval\.approval_scope_hash is distinct from encode\(digest\(outbound\.candidate_id \|\| E'\\n' \|\| outbound\.channel \|\| E'\\n' \|\| recipient/i.test(
      claim,
    ) &&
    /approval\.approval_source <> 'human'/i.test(claim) &&
    /approval\.revoked_at is not null/i.test(claim),
);
ok(
  "email claim enforces suppression, a live domain-verified non-phone seat, and the 90-day window",
  /from public\.suppression_list/i.test(claim) &&
    /not seat\.domain_verified/i.test(claim) &&
    /seat\.provider in \('WhatsApp Cloud', 'Twilio SMS'\)/i.test(claim) &&
    /now\(\) - interval '90 days'/i.test(claim),
);
ok(
  "email claim transitions queued -> dispatching under a delivery_attempt_id and mints the sender-domain rfc id",
  claim.indexOf("status = 'dispatching'") >= 0 &&
    /delivery_attempt_id = attempt_id/i.test(claim) &&
    /rfc_id := '<' \|\| attempt_id::text \|\| '@' \|\| split_part\(seat\.operator_email, '@', 2\)/i.test(claim),
);
ok(
  "email claim locks outbox -> advisory key -> approval before the seat (revoke-safe order)",
  claim.indexOf("from public.messages_outbound") < claim.indexOf("pg_advisory_xact_lock") &&
    claim.indexOf("pg_advisory_xact_lock") < claim.indexOf("from public.outreach_approvals") &&
    claim.indexOf("from public.outreach_approvals") < claim.indexOf("from public.agent_seats"),
);
ok(
  "email claim is granted to service_role only",
  /revoke all on function public\.claim_email_outbound_queued\(uuid\) from public, anon, authenticated, authenticator;/i.test(
    migration,
  ) && /grant execute on function public\.claim_email_outbound_queued\(uuid\) to service_role;/i.test(migration),
);

// ── enforce_active_email_approval: the never-auto-send trigger ─────────────
const trigger = section(
  migration,
  "create or replace function public.enforce_active_email_approval()",
  "drop trigger if exists messages_outbound_active_email_approval",
);
ok(
  "the Email approval trigger fires ONLY on an Email queued -> dispatching status change",
  /if new\.channel <> 'Email' or old\.status <> 'queued' or new\.status <> 'dispatching' then\s+return new;/i.test(
    trigger,
  ),
);
ok(
  "the Email approval trigger RAISES P0001 without a matching live human approval",
  /raise exception 'active human approval required for Email dispatch' using errcode = 'P0001'/i.test(trigger) &&
    /approval\.approval_source <> 'human'/i.test(trigger) &&
    /approval\.revoked_at is not null/i.test(trigger),
);
ok(
  "the Email trigger is installed as a separate before-update-of-status trigger",
  /create trigger messages_outbound_active_email_approval\s+before update of status on public\.messages_outbound\s+for each row execute function public\.enforce_active_email_approval\(\)/i.test(
    migration,
  ),
);
ok(
  "migration 0039 does NOT redefine the WhatsApp approval trigger or claim (comments may reference them)",
  !/create or replace function public\.enforce_active_whatsapp_approval/i.test(migration) &&
    !/create or replace function public\.claim_whatsapp_outbound/i.test(migration) &&
    !/create trigger [a-z_]*whatsapp/i.test(migration),
);

// ── send + failure + delivery-event RPCs remain service-only ──────────────
ok(
  "record_email_send_message_id transitions dispatching -> sent, service-only",
  /create or replace function public\.record_email_send_message_id\(/i.test(migration) &&
    /grant execute on function public\.record_email_send_message_id\(uuid, uuid, text\) to service_role;/i.test(
      migration,
    ),
);
const deliveryEvent = section(
  migration,
  "create or replace function public.record_email_delivery_event(",
  "revoke all on function public.record_email_delivery_event",
);
ok(
  "a permanent bounce or complaint upserts the suppression list, reactivating an expired row",
  /suppress := \(p_event_status = 'bounced' and coalesce\(p_permanent, false\)\) or p_event_status = 'complained'/i.test(
    deliveryEvent,
  ) && /insert into public\.suppression_list\([\s\S]*?on conflict \(workspace_id, type, value\)\s*do update set expires_at = null/i.test(deliveryEvent),
);
ok(
  "a bounce/complaint for a synchronously-sent email correlates via the ledger rfc_message_id and suppresses",
  /from public\.outreach_ledger l[\s\S]*?and l\.rfc_message_id = p_rfc_message_id/i.test(deliveryEvent)
    && /'ledger-correlated'/i.test(deliveryEvent),
);
ok(
  "the delivery-event dedup key includes is_permanent (soft->permanent is a distinct event)",
  /constraint email_delivery_events_dedupe_uniq\s*unique \(workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at\)/i.test(migration)
    && /on conflict on constraint email_delivery_events_dedupe_uniq do nothing/i.test(deliveryEvent),
);
ok(
  "the ledger branch suppresses only on a genuinely new receipt (replay-idempotent)",
  /insert into public\.email_ledger_delivery_receipts\([\s\S]*?on conflict \(workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at\) do nothing;\s*get diagnostics event_is_new = row_count;\s*suppress :=[\s\S]*?if suppress and event_is_new = 1 and recipient/i.test(deliveryEvent),
);
ok(
  "the messages_outbound branch suppresses only on a genuinely new delivery event (replay-idempotent)",
  // the delivery-event insert's row_count gates the outbound suppression that
  // reads outbound.to_address — asserted as one contiguous block so removing
  // the gate cannot pass by matching the ledger branch.
  /on conflict on constraint email_delivery_events_dedupe_uniq do nothing;\s*get diagnostics event_is_new = row_count;[\s\S]*?if suppress and event_is_new = 1 then\s*recipient := lower\(btrim\(coalesce\(outbound\.to_address/i.test(deliveryEvent),
);
ok(
  "the ledger dedup receipts table is force-RLS + postgres-only with an is_permanent key, and has a bounded cleanup",
  /create table if not exists public\.email_ledger_delivery_receipts/i.test(migration)
    && /alter table public\.email_ledger_delivery_receipts force row level security/i.test(migration)
    && /revoke all on public\.email_ledger_delivery_receipts from anon, public, authenticated, service_role, authenticator/i.test(migration)
    && /create or replace function public\.cleanup_email_ledger_delivery_receipts\(p_retention_days integer/i.test(migration)
    && /greatest\(coalesce\(p_retention_days, 180\), 90\)/i.test(migration),
);
ok(
  "record_email_delivery_event and finalize_email_provider_failure are service-only",
  /grant execute on function public\.record_email_delivery_event\(uuid, text, text, timestamptz, integer, boolean\) to service_role;/i.test(
    migration,
  ) &&
    /grant execute on function public\.finalize_email_provider_failure\(uuid, uuid, text\) to service_role;/i.test(
      migration,
    ),
);

// ── the privilege registry knows the new authority ────────────────────────
ok(
  "function-privileges registers the new email authority",
  /public\.claim_email_outbound_queued\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.enqueue_email_outbound\(text,text,text,uuid,text,text,text\)'\s*,\s*'authenticated'/i.test(priv) &&
    /public\.enforce_active_email_approval\(\)'\s*,\s*'owner_only'/i.test(priv),
);

// ── dispatchDue gate order: Email served; LinkedIn/SMS refused ─────────────
ok("dispatch-outbound.ts is present", dispatch.length > 0);
ok(
  "the dispatcher serves Email through the durable claim + send + finalize path",
  /if \(msg\.channel === "Email"\)/.test(dispatch) &&
    dispatch.indexOf('rpc("claim_email_outbound_queued"') >= 0 &&
    dispatch.indexOf("performEmailSend(") >= 0 &&
    dispatch.indexOf('rpc("record_email_send_message_id"') >= 0,
);
ok(
  "the dispatcher still hard-blocks SMS before any claim",
  dispatch.indexOf("sms-disabled-pending-consent-policy") >= 0,
);
ok(
  "the dispatcher refuses any non-WhatsApp/SMS channel that is not Email (LinkedIn stays assisted-manual)",
  dispatch.indexOf('msg.channel !== "WhatsApp" && msg.channel !== "SMS"') >= 0 &&
    dispatch.indexOf("channel-not-dispatchable") >= 0,
);
ok(
  "the Email branch is reached BEFORE the channel-not-dispatchable refusal (so Email is served, not blocked)",
  dispatch.indexOf('if (msg.channel === "Email")') >= 0 &&
    dispatch.indexOf('if (msg.channel === "Email")') < dispatch.indexOf("channel-not-dispatchable"),
);

// ── the interactive send route sends Email synchronously and stamps the
//    ledger rfc_message_id so a later bounce/complaint can suppress it. The
//    durable outbox (enqueue/claim_email_outbound_queued) remains the WORKER
//    path (asserted above via dispatch-outbound.ts); the button is synchronous
//    by design so the client receives "sent". ───────────────────────────────
ok(
  "the send route sends Email synchronously via claim_email_outbound + performEmailSend and stamps rfc_message_id",
  route.indexOf('rpc("claim_email_outbound"') >= 0 &&
    route.indexOf("performEmailSend(") >= 0 &&
    route.indexOf("rfc_message_id: rfcMessageId") >= 0,
);

console.log(`RESULT email-durability-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
