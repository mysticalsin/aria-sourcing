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

// ── privilege registry knows all the new authority ──
ok(
  "function-privileges registers the 4a-6 authority",
  /public\.apply_workspace_patch\(uuid,timestamptz,text,jsonb,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.claim_enrichment_budget\(uuid,text,text,integer,text\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.activate_outreach_sequence\(uuid\)'\s*,\s*'service_role'/i.test(priv) &&
    /public\.list_workspace_requisitions\(integer,integer\)'\s*,\s*'authenticated'/i.test(priv),
);

console.log(`RESULT loop-authority-contract: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
