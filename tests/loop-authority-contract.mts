import { existsSync, readFileSync } from "node:fs";

// Rocks 4-6 authority plus Rock 1's loop patch bridge (migrations 0042-0045, 0049).
// Pins the safety-critical invariants:
// the D1 single write path (optimistic concurrency + receipt + patch whitelist),
// requisition idempotency, fail-closed enrichment budget, and — most important —
// the never-auto-send sequence gate (activate requires every step approved; ships
// dark) + erasure enrollment. Structural only; Codex + Docker proof still required.

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const commit = read("supabase/migrations/0042_workspace_commit_authority.sql");
const req = read("supabase/migrations/0043_requisition_authority.sql");
const src = read("supabase/migrations/0044_sourcing_enrichment_authority.sql");
const seq = read("supabase/migrations/0045_outreach_sequence_authority.sql");
const seqReal = read("supabase/migrations/0053_sequence_engine_real_authority.sql");
const loopPatch = read("supabase/migrations/0049_loop_workspace_patch_completion.sql");
const dataProtection = read("supabase/migrations/0052_data_protection_false_blockers.sql");
const priv = read("tests/db/function-privileges.sql");

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
ok("0049 exists, no txn control", loopPatch.length > 0 && noTxn(loopPatch));
ok(
  "0049 completes workspace patch and aria job through existing authorities",
  /public\.apply_workspace_patch\(/i.test(loopPatch) &&
    /public\.complete_aria_job\(/i.test(loopPatch) &&
    !/update public\.workspace_state/i.test(loopPatch) &&
    /grant execute on function public\.complete_aria_job_with_workspace_patch/i.test(loopPatch),
);

// ── 0052 payload contract ──
ok("0052 exists, no txn control", dataProtection.length > 0 && noTxn(dataProtection));
ok(
  "enqueue_aria_job enforces the ids-only payload contract structurally",
  /aria_job_payload_contract_ok\(p_kind, p_payload\)/i.test(dataProtection) &&
    /not public\.aria_job_payload_contract_ok\(p_kind, p_payload\)/i.test(dataProtection) &&
    /when 'inbound_classify' then allowed_keys := array\['inboundId'\]/i.test(dataProtection) &&
    /when 'shortlist_build' then allowed_keys := array\[[^\]]*'providerRunId'[^\]]*\]/i.test(dataProtection) &&
    !/allowed_keys := array\[[^\]]*'replyText'/i.test(dataProtection) &&
    !/allowed_keys := array\[[^\]]*'candidates'/i.test(dataProtection),
);
const mig62 = read("supabase/migrations/0062_requisition_parse_inbound_id.sql");
ok(
  "0062 allows inboundId on requisition_parse payloads",
  mig62.length > 0 &&
    /when 'requisition_parse' then allowed_keys := array\['inboundId', 'requisitionId', 'campaignId'\]/i.test(mig62),
);
ok(
  "0063 allows append_outreach workspace patches for loop drafts",
  (() => {
    const mig63 = read("supabase/migrations/0063_loop_append_outreach.sql");
    return (
      mig63.length > 0 &&
      /append_outreach/.test(mig63) &&
      /when 'append_outreach' then 'outreach'/i.test(mig63)
    );
  })(),
);
ok(
  "0068 restores digest resolution for apply_workspace_patch (0063 search_path regression)",
  (() => {
    const mig68 = read("supabase/migrations/0068_apply_workspace_patch_digest_path.sql");
    return (
      mig68.length > 0 &&
      noTxn(mig68) &&
      /set search_path = pg_catalog, public, extensions, pg_temp/i.test(mig68) &&
      /public\.digest\(convert_to\(payload, 'UTF8'\), 'sha256'::text\)/i.test(mig68) &&
      /extensions\.digest\(convert_to\(payload, 'UTF8'\), 'sha256'::text\)/i.test(mig68) &&
      /append_outreach/.test(mig68) &&
      /md5\(payload\) \|\| md5\(reverse\(payload\)\)/i.test(mig68)
    );
  })(),
);
ok(
  "0069 allows pre_call_propose + first_interview_book loop payloads (Mantu interview pipeline)",
  (() => {
    const mig69 = read("supabase/migrations/0069_pre_call_first_interview_loop_kinds.sql");
    return (
      mig69.length > 0 &&
      noTxn(mig69) &&
      /when 'pre_call_propose' then allowed_keys := array\['campaignId', 'candidateId', 'intent', 'trigger', 'approvedBy'\]/i.test(mig69) &&
      /when 'first_interview_book' then allowed_keys := array\['campaignId', 'candidateId', 'intent', 'trigger', 'approvedBy'\]/i.test(mig69)
    );
  })(),
);
ok(
  "0070 fixes sourcing_loop_stage_enabled (real intake_enabled columns; enqueue kinds)",
  (() => {
    const mig70 = read("supabase/migrations/0070_fix_sourcing_loop_stage_enabled.sql");
    return (
      mig70.length > 0 &&
      noTxn(mig70) &&
      /controls\.intake_enabled/i.test(mig70) &&
      !/controls\.requisition_parse_enabled/i.test(mig70) &&
      /'pre_call_propose', 'first_interview_book'/i.test(mig70)
    );
  })(),
);
ok(
  "0071 allows interview_prep_send loop payloads (post-booking prep drafts)",
  (() => {
    const mig71 = read("supabase/migrations/0071_interview_prep_send_loop_kind.sql");
    return (
      mig71.length > 0 &&
      noTxn(mig71) &&
      /when 'interview_prep_send' then allowed_keys := array\['campaignId', 'candidateId', 'bookingId', 'trigger'\]/i.test(mig71) &&
      /'interview_prep_send'/i.test(mig71)
    );
  })(),
);
ok(
  "0072 allows append_booking so Calendar Agenda sees loop Teams books",
  (() => {
    const mig72 = read("supabase/migrations/0072_loop_append_booking.sql");
    return (
      mig72.length > 0 &&
      noTxn(mig72) &&
      /append_booking/.test(mig72) &&
      /when 'append_booking' then 'bookings'/.test(mig72)
    );
  })(),
);
ok(
  "0073 registers HMAC inbound mailbox routes without OAuth connection",
  (() => {
    const mig73 = read("supabase/migrations/0073_hmac_inbound_mailbox_route.sql");
    return (
      mig73.length > 0 &&
      noTxn(mig73) &&
      /upsert_hmac_inbound_mailbox_route/.test(mig73) &&
      /connection_id, purpose, active/.test(mig73) &&
      /null, purpose, true/.test(mig73)
    );
  })(),
);
ok(
  "0074 loop workspace revision omits full state; campaign/candidate slice RPCs",
  (() => {
    const mig74 = read("supabase/migrations/0074_workspace_loop_revision_only.sql");
    const worker = read("scripts/sourcing-loop-worker.mjs");
    return (
      mig74.length > 0 &&
      noTxn(mig74) &&
      /read_workspace_campaign_for_loop/.test(mig74) &&
      /read_workspace_candidates_for_loop/.test(mig74) &&
      /'updated_at', ws\.updated_at/.test(mig74) &&
      !/state', ws\.state/.test(mig74) &&
      /read_workspace_campaign_for_loop/.test(worker) &&
      /read_workspace_candidates_for_loop/.test(worker)
    );
  })(),
);
ok(
  "0078 adds outreach/booking slices + merge_outreach_message for Autopilot post-0074",
  (() => {
    const mig78 = read("supabase/migrations/0078_loop_outreach_slices_and_merge.sql");
    return (
      mig78.length > 0 &&
      noTxn(mig78) &&
      /read_workspace_booking_for_loop/.test(mig78) &&
      /cand->'booking'->>'id' = p_booking_id/.test(mig78) &&
      /read_workspace_heyreach_settings_for_loop/.test(mig78) &&
      /read_workspace_outreach_for_loop/.test(mig78) &&
      /read_workspace_skills_for_loop/.test(mig78) &&
      /'merge_outreach_message'/.test(mig78) &&
      /\{outreach\}/.test(mig78)
    );
  })(),
);
ok(
  "0079 Autopilot enqueue binds approval body_hash + scope (Email/WA/LinkedIn)",
  (() => {
    const mig79 = read("supabase/migrations/0079_autopilot_enqueue_approval_hash_bind.sql");
    return (
      mig79.length > 0 &&
      noTxn(mig79) &&
      (mig79.match(/reason', 'approval-mismatch'/g) ?? []).length === 3 &&
      /enqueue_email_outbound_service/.test(mig79) &&
      /enqueue_whatsapp_outbound_service/.test(mig79) &&
      /enqueue_linkedin_outbound_service/.test(mig79)
    );
  })(),
);
ok(
  "loop event erasure has a narrow trigger-recognized redaction path",
  /redact_loop_events_for_candidate_erasure\(uuid, text, text\[\], text\[\]\)/i.test(dataProtection) &&
    /set_config\('aria\.candidate_erasure_loop_event_redaction', 'on', true\)/i.test(dataProtection) &&
    /new\.subject_id is null/i.test(dataProtection) &&
    /raise exception 'loop events are append-only' using errcode = '42501'/i.test(dataProtection),
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
ok("0053 exists, no txn control", seqReal.length > 0 && noTxn(seqReal));
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
  "0053 fixes sequence suppression by identity and honors expires_at",
  /from public\.suppression_list sl[\s\S]*?sl\.expires_at is null or sl\.expires_at > now\(\)[\s\S]*?sl\.type = 'email'[\s\S]*?sl\.type = 'domain'[\s\S]*?sl\.type = 'linkedin'/i.test(seqReal) &&
    !/sl\.candidate_id = seq\.candidate_id/i.test(seqReal),
);
ok(
  "0053 sequence scheduling locks controls before counting the daily send cap",
  /select \* into controls[\s\S]*?from public\.sourcing_loop_controls[\s\S]*?for update[\s\S]*?select count\(\*\)::int into used_workspace_today[\s\S]*?max_sequence_sends_per_day/i.test(seqReal),
);
ok(
  "0053 releases elapsed re-contact slots before a new active ledger claim",
  /create or replace function public\.release_elapsed_outreach_contact_window\(\)[\s\S]*?pg_advisory_xact_lock[\s\S]*?status = 'recontact_elapsed'[\s\S]*?interval '90 days'/i.test(seqReal) &&
    /create trigger outreach_ledger_release_elapsed_contact_window\s+before insert on public\.outreach_ledger/i.test(seqReal),
);
ok(
  "0053 requires approval and credits before scheduling a sequence step",
  /not exists \([\s\S]*?from public\.outreach_approvals a[\s\S]*?a\.approval_source = 'human'[\s\S]*?a\.revoked_at is null/i.test(seqReal) &&
    /from public\.outreach_sequence_credit_accounts[\s\S]*?for update[\s\S]*?credits_available < 1[\s\S]*?outreach_sequence_credit_ledger/i.test(seqReal),
);
ok(
  "0053 provides the missing sent-to-next-step advancement surface",
  /create or replace function public\.record_sequence_step_sent\(p_step_id uuid, p_outbound_id uuid default null\)/i.test(seqReal) &&
    /create or replace function public\.promote_due_sequence_steps\(p_workspace_id uuid, p_limit integer default 50\)/i.test(seqReal) &&
    /for update(?: of due)? skip locked/i.test(seqReal),
);

// ── privilege registry knows all the new authority ──
ok(
  "function-privileges registers the 4a-6 authority",
  /public\.apply_workspace_patch\(uuid,timestamptz,text,jsonb,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.complete_aria_job_with_workspace_patch\(uuid,uuid,timestamp with time zone,text,jsonb,text,text,jsonb,jsonb\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.redact_loop_events_for_candidate_erasure\(uuid,text,text\[\],text\[\]\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.read_workspace_state_for_loop\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.claim_enrichment_budget\(uuid,text,text,integer,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.activate_outreach_sequence\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.record_sequence_step_sent\(uuid,uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.promote_due_sequence_steps\(uuid,integer\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.list_workspace_requisitions\(integer,integer\)'\s*,\s*'authenticated'/i.test(priv),
);

// ── recruiting-graph-stage HTTP contract (interest → pre-call → interview) ──
ok(
  "recruiting-graph-stage route accepts pre_call_only + interview_only checkpoint intents",
  (() => {
    const route = read("src/app/api/cron/recruiting-graph-stage/route.ts");
    return (
      route.length > 0 &&
      /"pre_call_only"/.test(route) &&
      /"interview_only"/.test(route) &&
      /intent: z\.enum\(\[[\s\S]*"pre_call_only"[\s\S]*"interview_only"/.test(route)
    );
  })(),
);

console.log(`RESULT loop-authority-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
