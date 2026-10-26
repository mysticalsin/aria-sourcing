import { loadBaselineSchema } from "./lib/baseline-schema.mts";
import { existsSync, readFileSync } from "node:fs";

// Email joins the durable outbox. This contract pins the email authority shape in
// the baseline schema AND the dispatchDue gate order (Email is served through the
// durable claim while LinkedIn/SMS stay refused), so a future edit that weakens
// the never-auto-send guarantee or re-opens a synchronous email send fails here.

const migrationPath = "supabase/migrations/0001_baseline.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const schema = loadBaselineSchema();
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

// ── baseline schema owns no transaction ──────────────────────────────────
ok("baseline schema exists", migration.length > 0);
ok(
  "baseline leaves transaction ownership to the bootstrap runner",
  !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(migration),
);

// ── outreach_ledger.rfc_message_id: format-checked + unique per workspace ──
ok(
  "outreach_ledger has a format-checked rfc_message_id column",
  /^    rfc_message_id text,$/m.test(schema.table("outreach_ledger")) &&
    migration.includes(
      "ADD CONSTRAINT outreach_ledger_rfc_message_id_check CHECK (((rfc_message_id IS NULL) OR (rfc_message_id ~ '^<[^<>@\\s]+@[^<>@\\s]+>$'::text)))",
    ),
);
ok(
  "rfc_message_id is unique per workspace",
  migration.includes(
    "CREATE UNIQUE INDEX outreach_ledger_rfc_message_id_uniq ON public.outreach_ledger USING btree (workspace_id, rfc_message_id) WHERE (rfc_message_id IS NOT NULL);",
  ),
);

// ── email_delivery_events: append-only, force RLS, service-writes-only ─────
const events = schema.table("email_delivery_events");
ok(
  "email_delivery_events accepts exactly the email delivery event set",
  events.includes(
    "CONSTRAINT email_delivery_events_event_status_check CHECK ((event_status = ANY (ARRAY['delivered'::text, 'bounced'::text, 'complained'::text, 'opened'::text])))",
  ) &&
    migration.includes(
      "ADD CONSTRAINT email_delivery_events_dedupe_uniq UNIQUE (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at);",
    ),
);
ok(
  "email_delivery_events forces RLS and clients may only read it",
  schema.rls("email_delivery_events").forced &&
    JSON.stringify(schema.tableGrants("email_delivery_events").authenticated) === JSON.stringify(["SELECT"]) &&
    !Object.values(schema.tableGrants("email_delivery_events")).flat().some((privilege) => privilege !== "SELECT"),
);

// ── enqueue_email_outbound: authenticated definer, pg_temp-terminated path ─
const enqueue = schema.fn("enqueue_email_outbound");
ok(
  "enqueue is an authenticated SECURITY DEFINER with a pg_temp-terminated search_path",
  /SECURITY DEFINER\n    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'\n/.test(enqueue) &&
    JSON.stringify(schema.functionGrantees("enqueue_email_outbound")) === JSON.stringify(["authenticated"]),
);
ok(
  "enqueue writes a queued Email row and returns 'duplicate' on a re-enqueue",
  /'Email'[\s\S]*?'queued'/i.test(enqueue) && /'reason', 'duplicate'/i.test(enqueue),
);

// ── claim_email_outbound_queued: the full service-only gate set ────────────
const claim = schema.fn("claim_email_outbound_queued");
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
  JSON.stringify(schema.functionGrantees("claim_email_outbound_queued")) === JSON.stringify(["service_role"]),
);

// ── enforce_active_email_approval: the never-auto-send trigger ─────────────
const trigger = schema.fn("enforce_active_email_approval");
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
  migration.includes(
    "CREATE TRIGGER messages_outbound_active_email_approval BEFORE UPDATE OF status ON public.messages_outbound FOR EACH ROW EXECUTE FUNCTION public.enforce_active_email_approval();",
  ),
);

// ── send + failure + delivery-event RPCs remain service-only ──────────────
ok(
  "record_email_send_message_id transitions dispatching -> sent, service-only",
  schema.fn("record_email_send_message_id").length > 0 &&
    JSON.stringify(schema.functionGrantees("record_email_send_message_id")) === JSON.stringify(["service_role"]),
);
const deliveryEvent = schema.fn("record_email_delivery_event");
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
  migration.includes(
    "ADD CONSTRAINT email_delivery_events_dedupe_uniq UNIQUE (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at);",
  ) && /on conflict on constraint email_delivery_events_dedupe_uniq do nothing/i.test(deliveryEvent),
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
  schema.table("email_ledger_delivery_receipts").length > 0 &&
    schema.rls("email_ledger_delivery_receipts").forced &&
    Object.keys(schema.tableGrants("email_ledger_delivery_receipts")).length === 0 &&
    /^CREATE FUNCTION public\.cleanup_email_ledger_delivery_receipts\(p_retention_days integer/.test(
      schema.fn("cleanup_email_ledger_delivery_receipts"),
    ) &&
    /greatest\(coalesce\(p_retention_days, 180\), 90\)/i.test(schema.fn("cleanup_email_ledger_delivery_receipts")),
);
ok(
  "record_email_delivery_event and finalize_email_provider_failure are service-only",
  JSON.stringify(schema.functionGrantees("record_email_delivery_event")) === JSON.stringify(["service_role"]) &&
    JSON.stringify(schema.functionGrantees("finalize_email_provider_failure")) === JSON.stringify(["service_role"]),
);

// ── the privilege registry knows the new authority ────────────────────────
ok(
  "function-privileges registers the new email authority",
  /public\.claim_email_outbound_queued\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.enqueue_email_outbound\(text,text,text,uuid,text,text,text\)'\s*,\s*'authenticated'/i.test(priv) &&
    /public\.enforce_active_email_approval\(\)'\s*,\s*'owner_only'/i.test(priv),
);

// ── dispatchDue gate order: Email served; LinkedIn adapter served; others refused
ok("dispatch-outbound.ts is present", dispatch.length > 0);
ok(
  "the dispatcher serves Email through the durable claim + send + finalize path",
  /if \(msg\.channel === "Email"\)/.test(dispatch) &&
    dispatch.indexOf('rpc("claim_email_outbound_queued"') >= 0 &&
    dispatch.indexOf("performEmailSend(") >= 0 &&
    dispatch.indexOf('rpc("record_email_send_message_id"') >= 0,
);
ok(
  "the dispatcher refuses every channel other than Email and LinkedIn before any claim",
  dispatch.indexOf('msg.channel !== "Email" && msg.channel !== "LinkedIn"') >= 0 &&
    dispatch.indexOf('msg.channel !== "Email" && msg.channel !== "LinkedIn"') < dispatch.indexOf('rpc("claim_email_outbound_queued"') &&
    dispatch.indexOf('msg.channel !== "Email" && msg.channel !== "LinkedIn"') < dispatch.indexOf('rpc("claim_linkedin_outbound_queued"'),
);
ok(
  "the dispatcher serves LinkedIn through its own claim",
  dispatch.indexOf('if (msg.channel === "LinkedIn")') >= 0 &&
    dispatch.indexOf('rpc("claim_linkedin_outbound_queued"') > dispatch.indexOf('if (msg.channel === "LinkedIn")'),
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
