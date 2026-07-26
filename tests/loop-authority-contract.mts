import { existsSync, readFileSync } from "node:fs";

// Rocks 4-6 authority (migrations 0042-0045). Pins the safety-critical invariants:
// the D1 single write path (optimistic concurrency + receipt + patch whitelist),
// requisition idempotency, fail-closed enrichment budget, and — most important —
// the never-auto-send sequence gate (activate requires every step approved; ships
// dark) + erasure enrollment. Structural only; Codex + Docker proof still required.

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const commit = read("supabase/migrations/0042_workspace_commit_authority.sql");
const req = read("supabase/migrations/0043_requisition_authority.sql");
const src = read("supabase/migrations/0044_sourcing_enrichment_authority.sql");
const seq = read("supabase/migrations/0045_outreach_sequence_authority.sql");
const sequenceRepair = read("supabase/migrations/0063_outreach_sequence_authority_repair.sql");
const priv = read("tests/db/function-privileges.sql");

const functionSql = (source: string, name: string) => {
  const lower = source.toLowerCase();
  const start = lower.indexOf(`create or replace function public.${name.toLowerCase()}`);
  if (start < 0) return "";
  const next = lower.indexOf("\ncreate or replace function public.", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
};

const locksInOrder = (sql: string, parentNeedle: string, childNeedle: string) => {
  const lower = sql.toLowerCase();
  const parent = lower.indexOf(parentNeedle.toLowerCase());
  const child = lower.indexOf(childNeedle.toLowerCase());
  return parent >= 0 && child > parent;
};

const outboundBindingSql = functionSql(sequenceRepair, "enforce_sequence_outbound_insert_binding");
const prepareOutboundClaimSql = functionSql(sequenceRepair, "prepare_sequence_outbound_claim");
const emailClaimSql = functionSql(sequenceRepair, "claim_email_outbound_queued");
const whatsappClaimSql = functionSql(sequenceRepair, "claim_whatsapp_outbound");
const manualCompletionSql = functionSql(sequenceRepair, "complete_sequence_manual_task");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.log("FAIL:", n); } };
const noTxn = (s: string) => !/^\s*(?:begin|commit|rollback)\s*;\s*(?:--.*)?$/im.test(s);

// ── 0042 apply_workspace_patch (D1) ──
ok("0042 exists, no txn control", commit.length > 0 && noTxn(commit));
ok("apply_workspace_patch is service-only", /auth\.role\(\)[\s\S]*?<> 'service_role'[\s\S]*?'service_only'/i.test(commit));
ok(
  "apply_workspace_patch has receipt idempotency + stale-token optimistic concurrency + patch whitelist",
  /'already_applied'/i.test(commit) && /'idempotency_conflict'/i.test(commit) &&
    /p_expected_updated_at is distinct from ws\.updated_at[\s\S]*?'stale_token'/i.test(commit) &&
    /p_patch_kind not in \([\s\S]*?'merge_outreach_status'\)/i.test(commit) &&
    /select \* into ws[\s\S]*?from public\.workspace_state[\s\S]*?for update/i.test(commit),
);
ok(
  "workspace_patch_receipts force RLS + apply grant service_role only",
  /alter table public\.workspace_patch_receipts force row level security/i.test(commit) &&
    /grant execute on function public\.apply_workspace_patch\(uuid, timestamptz, text, jsonb, text\) to service_role;/i.test(commit),
);

// ── 0043 requisitions ──
ok("0043 exists, no txn control", req.length > 0 && noTxn(req));
ok(
  "requisitions: source_ref idempotency + campaign_created<->campaign_id invariant",
  /unique \(workspace_id, source_kind, source_ref\)/i.test(req) &&
    /check \(\(status = 'campaign_created'\) = \(campaign_id is not null\)\)/i.test(req),
);
ok(
  "requisition RPCs service-only (except authenticated list)",
  /ingest_requisition[\s\S]*?auth\.role\(\)[\s\S]*?<> 'service_role'/i.test(req) &&
    /record_requisition_campaign[\s\S]*?status = 'ready'/i.test(req) &&
    /grant execute on function public\.list_workspace_requisitions\(int, int\) to authenticated;/i.test(req),
);

// ── 0044 sourcing/enrichment ──
ok("0044 exists, no txn control", src.length > 0 && noTxn(src));
ok(
  "enrichment budget claim FAILS CLOSED as budget_exhausted",
  /if used \+ p_amount_cents > budget\.budget_cents then[\s\S]*?'budget_exhausted'/i.test(src) &&
    /sourcing_provider_runs[\s\S]*?unique \(workspace_id, provider, external_run_id\)/i.test(src),
);
ok(
  "enrichment spend RPCs service-only",
  /claim_enrichment_budget[\s\S]*?auth\.role\(\)[\s\S]*?<> 'service_role'/i.test(src),
);

// ── 0045 sequences (never-auto-send, dark) ──
ok("0045 exists, no txn control", seq.length > 0 && noTxn(seq));
ok(
  "one live sequence per candidate + step ordinal/channel constraints",
  /create unique index if not exists outreach_sequences_one_live_idx[\s\S]*?status in \('drafting', 'pending_approval', 'active', 'paused_ambiguous'\)/i.test(seq) &&
    /ordinal\s+int not null check \(ordinal between 0 and 4\)/i.test(seq),
);
ok(
  "activate REQUIRES every step to have a live human unrevoked approval (mechanical never-auto-send)",
  /not exists \(\s*select 1 from public\.outreach_approvals a[\s\S]*?a\.body_hash = s\.body_hash[\s\S]*?a\.approval_scope_hash = s\.scope_hash[\s\S]*?a\.approval_source = 'human'[\s\S]*?a\.revoked_at is null\)/i.test(seq) &&
    /'steps-unapproved'/i.test(seq),
);
ok(
  "0045 mints NO new approval path (uses existing record_outreach_approval) and stop cancels remaining steps",
  !/insert into public\.outreach_approvals/i.test(seq) &&
    /stop_outreach_sequence[\s\S]*?update public\.outreach_sequence_steps set status = 'cancelled'/i.test(seq),
);
ok(
  "erased candidate's sequences are deleted via a candidate_erasure_requests cleanup trigger",
  /create trigger candidate_erasure_requests_sequences_cleanup\s+after insert or update on public\.candidate_erasure_requests[\s\S]*?when \(new\.status <> 'blocked_legal_hold'\)/i.test(seq),
);
ok(
  "0063 repairs recipient checks and makes LinkedIn manual-only without a provider path",
  /outreach_sequence_tombstone_exists/i.test(sequenceRepair) &&
    /suppression_list s[\s\S]*?s\.type = 'linkedin'/i.test(sequenceRepair) &&
    /step\.channel = 'LinkedIn'[\s\S]*?status = 'manual_task'/i.test(sequenceRepair) &&
    /complete_sequence_manual_task\(p_step_id uuid\)/i.test(sequenceRepair) &&
    /grant execute on function public\.complete_sequence_manual_task\(uuid\) to authenticated/i.test(sequenceRepair),
);
ok(
  "0063 recomputes content and recipient-bound scope hashes before a claim schedules",
  /digest\(E'\\n' \|\| step\.body, 'sha256'\)/i.test(sequenceRepair) &&
    /seq\.candidate_id \|\| E'\\n' \|\| step\.channel \|\| E'\\n' \|\| recipient/i.test(sequenceRepair),
);
ok(
  "0063 canonicalizes LinkedIn identities and consumes each manual approval once",
  /normalize_linkedin_profile_url\(p_value text\)/i.test(sequenceRepair) &&
    /create table if not exists public\.outreach_sequence_manual_approval_consumptions/i.test(sequenceRepair) &&
    /approval-already-consumed/i.test(sequenceRepair) &&
    /completion_mode', 'operator_assertion'/i.test(sequenceRepair),
);
ok(
  "0063 completion rechecks kill, approval, recipient eligibility, and touch cap",
  (sequenceRepair.match(/outreach_sequence_execution_enabled\(seq\.workspace_id\)/g)?.length ?? 0) >= 5 &&
    /approval-revoked-or-consumed/i.test(sequenceRepair) &&
    /outreach_sequence_recipient_blocked\(seq, step\)/i.test(sequenceRepair) &&
    /ordinal < seq\.max_touches/i.test(sequenceRepair),
);
ok(
  "0063 keeps sequence execution release-dark and binds each queued provider receipt atomically once",
  /create table if not exists public\.outreach_sequence_release_controls/i.test(sequenceRepair) &&
    /revoke all on public\.outreach_sequence_release_controls[\s\S]*?service_role/i.test(sequenceRepair) &&
    /create unique index if not exists messages_outbound_sequence_step_uniq/i.test(sequenceRepair) &&
    /create unique index if not exists outreach_sequence_steps_outbound_uniq/i.test(sequenceRepair) &&
    /create trigger messages_outbound_sequence_binding_origin\s+before insert on public\.messages_outbound/i.test(sequenceRepair) &&
    /current_user <> 'postgres'/i.test(functionSql(sequenceRepair, "enforce_sequence_outbound_insert_origin")) &&
    /create trigger messages_outbound_sequence_binding_validate\s+before insert on public\.messages_outbound/i.test(sequenceRepair) &&
    /sequence_authority_bound boolean not null default false/i.test(sequenceRepair) &&
    /check \(sequence_step_id is null or sequence_authority_bound\)/i.test(sequenceRepair) &&
    /create trigger messages_outbound_sequence_update_authority\s+before update on public\.messages_outbound/i.test(sequenceRepair) &&
    /historical sequence outbound cannot be reactivated/i.test(sequenceRepair) &&
    /sequence outbound requires atomic enqueue and binding/i.test(sequenceRepair) &&
    /enqueue_and_bind_sequence_step_outbound\(\s*p_step_id uuid,\s*p_seat_id uuid/i.test(sequenceRepair) &&
    /grant execute on function public\.enqueue_and_bind_sequence_step_outbound\(uuid, uuid\)\s+to authenticated/i.test(sequenceRepair) &&
    /outbound\.status <> 'composed'/i.test(sequenceRepair),
);
ok(
  "0063 refuses unsafe legacy outbound pointers before reciprocal backfill",
  /left join public\.messages_outbound outbound on outbound\.id = step\.queued_outbound_id/i.test(sequenceRepair) &&
    /outbound\.sequence_step_id is distinct from step\.id/i.test(sequenceRepair) &&
    /outbound\.workspace_id is distinct from seq\.workspace_id/i.test(sequenceRepair) &&
    /outbound\.candidate_id is distinct from seq\.candidate_id/i.test(sequenceRepair) &&
    /outbound\.campaign_id is distinct from seq\.campaign_id/i.test(sequenceRepair) &&
    /outbound\.approval_message_id is distinct from step\.message_id/i.test(sequenceRepair) &&
    /outbound\.body is distinct from step\.body/i.test(sequenceRepair) &&
    /select count\(\*\)[\s\S]*?owner_step\.queued_outbound_id = step\.queued_outbound_id/i.test(sequenceRepair) &&
    /raise exception '0063 refuses % unsafe legacy sequence outbound binding\(s\)'/i.test(sequenceRepair) &&
    sequenceRepair.indexOf("0063 refuses % unsafe legacy sequence outbound binding(s)") <
      sequenceRepair.indexOf("update public.messages_outbound outbound\n   set sequence_step_id = step.id") &&
    /foreign key \(queued_outbound_id\)[\s\S]*?references public\.messages_outbound\(id\)/i.test(sequenceRepair),
);
ok(
  "0063 fills the mature WhatsApp enqueue campaign authority field only after validation",
  /step\.channel = 'Email' and new\.campaign_id is distinct from seq\.campaign_id/i.test(outboundBindingSql) &&
    /step\.channel = 'WhatsApp' and new\.campaign_id is not null[\s\S]*?new\.campaign_id is distinct from seq\.campaign_id/i.test(outboundBindingSql) &&
    outboundBindingSql.indexOf("new.campaign_id := seq.campaign_id") >
      outboundBindingSql.indexOf("sequence outbound approval is not active") &&
    outboundBindingSql.indexOf("new.sequence_step_id := step.id") >
      outboundBindingSql.indexOf("new.campaign_id := seq.campaign_id"),
);
ok(
  "0063 gates sequence-owned provider claims before delegating to mature channel policy",
  /alter function public\.claim_email_outbound_queued\(uuid\)[\s\S]*?rename to claim_email_outbound_queued_pre0063/i.test(sequenceRepair) &&
    /alter function public\.claim_whatsapp_outbound\(uuid\)[\s\S]*?rename to claim_whatsapp_outbound_pre0063/i.test(sequenceRepair) &&
    /revoke all on function public\.claim_email_outbound_queued_pre0063\(uuid\)[\s\S]*?service_role/i.test(sequenceRepair) &&
    /revoke all on function public\.claim_whatsapp_outbound_pre0063\(uuid\)[\s\S]*?service_role/i.test(sequenceRepair) &&
    locksInOrder(
      prepareOutboundClaimSql,
      "select * into seq from public.outreach_sequences",
      "perform 1 from public.outreach_sequence_steps",
    ) &&
    /step\.queued_outbound_id is distinct from outbound\.id/i.test(prepareOutboundClaimSql) &&
    /outbound\.sequence_step_id is distinct from step\.id/i.test(prepareOutboundClaimSql) &&
    /outreach_sequence_execution_enabled\(seq\.workspace_id\)/i.test(prepareOutboundClaimSql) &&
    /outreach_sequence_stop_internal\(seq\.id, 'campaign'\)/i.test(prepareOutboundClaimSql) &&
    emailClaimSql.indexOf("public.prepare_sequence_outbound_claim(p_message_id, 'Email')") >= 0 &&
    emailClaimSql.indexOf("public.claim_email_outbound_queued_pre0063(p_message_id)") >
      emailClaimSql.indexOf("guard_result ->> 'allowed'") &&
    whatsappClaimSql.indexOf("public.prepare_sequence_outbound_claim(p_message_id, 'WhatsApp')") >= 0 &&
    whatsappClaimSql.indexOf("public.claim_whatsapp_outbound_pre0063(p_message_id)") >
      whatsappClaimSql.indexOf("guard_result ->> 'allowed'"),
);
ok(
  "0063 records append-only manual action evidence before current advancement gates",
  /create table if not exists public\.outreach_sequence_manual_action_receipts/i.test(sequenceRepair) &&
    /alter table public\.outreach_sequence_manual_action_receipts enable row level security/i.test(sequenceRepair) &&
    /alter table public\.outreach_sequence_manual_action_receipts force row level security/i.test(sequenceRepair) &&
    /revoke all on public\.outreach_sequence_manual_action_receipts[\s\S]*?service_role[\s\S]*?authenticator/i.test(sequenceRepair) &&
    /create policy outreach_sequence_manual_action_receipts_owner_access[\s\S]*?for all to postgres, supabase_admin/i.test(sequenceRepair) &&
    /reject_sequence_manual_action_receipt_mutation\(\)[\s\S]*?sequence manual action receipts are append-only/i.test(sequenceRepair) &&
    /create trigger outreach_sequence_manual_action_receipts_append_only[\s\S]*?before update or delete/i.test(sequenceRepair) &&
    manualCompletionSql.indexOf("insert into public.outreach_sequence_manual_action_receipts") >= 0 &&
    manualCompletionSql.indexOf("if seq.status <> 'active'") >
      manualCompletionSql.indexOf("insert into public.outreach_sequence_manual_action_receipts") &&
    manualCompletionSql.indexOf("outreach_sequence_execution_enabled(seq.workspace_id)") >
      manualCompletionSql.indexOf("insert into public.outreach_sequence_manual_action_receipts") &&
    manualCompletionSql.indexOf("join public.outreach_approvals approval") >
      manualCompletionSql.indexOf("insert into public.outreach_sequence_manual_action_receipts") &&
    manualCompletionSql.indexOf("outreach_sequence_recipient_blocked(seq, step)") >
      manualCompletionSql.indexOf("insert into public.outreach_sequence_manual_action_receipts"),
);
ok(
  "0063 state-changing sequence RPCs lock parent before child rows",
  locksInOrder(
    functionSql(sequenceRepair, "outreach_sequence_stop_internal"),
    "from public.outreach_sequences",
    "from public.outreach_sequence_steps",
  ) &&
    locksInOrder(
      functionSql(sequenceRepair, "activate_outreach_sequence"),
      "from public.outreach_sequences",
      "from public.outreach_sequence_steps",
    ) &&
    locksInOrder(
      functionSql(sequenceRepair, "claim_sequence_step_for_schedule"),
      "select * into seq from public.outreach_sequences",
      "select * into step from public.outreach_sequence_steps",
    ) &&
    locksInOrder(
      functionSql(sequenceRepair, "bind_sequence_step_outbound"),
      "select * into seq from public.outreach_sequences",
      "select * into step from public.outreach_sequence_steps",
    ) &&
    locksInOrder(
      functionSql(sequenceRepair, "enqueue_and_bind_sequence_step_outbound"),
      "select * into seq from public.outreach_sequences",
      "select * into step from public.outreach_sequence_steps",
    ) &&
    locksInOrder(
      functionSql(sequenceRepair, "complete_sequence_step_send"),
      "select * into seq from public.outreach_sequences",
      "select * into step from public.outreach_sequence_steps",
    ) &&
    locksInOrder(
      functionSql(sequenceRepair, "complete_sequence_manual_task"),
      "select * into seq from public.outreach_sequences",
      "select * into step from public.outreach_sequence_steps",
    ),
);

// ── privilege registry knows all the new authority ──
ok(
  "function-privileges registers the 4a-6 authority",
  /public\.apply_workspace_patch\(uuid,timestamptz,text,jsonb,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.claim_enrichment_budget\(uuid,text,text,integer,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.activate_outreach_sequence\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.claim_email_outbound_queued\(uuid\)'\s*,\s*'service_role'\s*,\s*true/i.test(priv) &&
    /public\.claim_email_outbound_queued_pre0063\(uuid\)'\s*,\s*'owner_only'\s*,\s*true/i.test(priv) &&
    /public\.claim_whatsapp_outbound\(uuid\)'\s*,\s*'service_role'\s*,\s*true/i.test(priv) &&
    /public\.claim_whatsapp_outbound_pre0063\(uuid\)'\s*,\s*'owner_only'\s*,\s*true/i.test(priv) &&
    /public\.enqueue_and_bind_sequence_step_outbound\(uuid,uuid\)'\s*,\s*'authenticated'/i.test(priv) &&
    /public\.enforce_sequence_outbound_insert_origin\(\)'\s*,\s*'owner_only'\s*,\s*false/i.test(priv) &&
    /public\.enforce_sequence_outbound_update_authority\(\)'\s*,\s*'owner_only'\s*,\s*false/i.test(priv) &&
    /public\.prepare_sequence_outbound_claim\(uuid,text\)'\s*,\s*'owner_only'\s*,\s*false/i.test(priv) &&
    /public\.reject_sequence_manual_action_receipt_mutation\(\)'\s*,\s*'owner_only'\s*,\s*false/i.test(priv) &&
    /public\.list_workspace_requisitions\(integer,integer\)'\s*,\s*'authenticated'/i.test(priv),
);

console.log(`RESULT loop-authority-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
