-- 0042_workspace_commit_authority.sql
--
-- Rock 4a of the industrial autonomous loop: the ONE server write path into the
-- workspace_state blob (binding decision D1). Today only the browser mutates the
-- shared JSONB document (optimistic-concurrency on updated_at). For the headless
-- worker to commit sourced candidates / campaigns / replies with no browser open,
-- it needs the SAME optimistic-concurrency + a receipt so a retry is exact-once.
--
-- Contract (D1): TS computes the patch; SQL only APPLIES it — a patch_kind
-- whitelist + shallow jsonb concat/merge. No client logic is re-implemented here.
-- One UPDATE fires the 0035/0036 mirror triggers + the 0033 erasure reimport guard
-- in-transaction, exactly as a browser write does.
--
-- ⚠️ DEGRADED + HIGH-RISK-BLIND: this is the D1 core write path. Built solo-Visionary
-- (Codex Integrator usage-limited until 2026-07-23) and NOT runnable in the build
-- sandbox (Docker denied). Codex adversarial review + the disposable-Postgres proof
-- (tests/workspace-commit-db.sh) are REQUIRED before any worker uses it. Ships dark:
-- nothing calls it until Rock 5's worker does, behind the 0038 loop kill switch.
--
-- Idempotent; safe to re-run. Run AFTER 0041_email_outcomes.sql.

-- ---------------------------------------------------------------------------
-- 1. workspace_patch_receipts — exact-once ledger for server blob writes.
--    A retry with the same receipt_key + same payload returns already_applied;
--    the same key with a DIFFERENT payload is an idempotency_conflict (never a
--    silent second apply). Lineage: 0026 apollo / 0034 calendar claim receipts.
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_patch_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  receipt_key  text not null check (char_length(receipt_key) between 1 and 200),
  patch_kind   text not null,
  patch_sha256 text not null check (patch_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at   timestamptz not null default now(),
  primary key (workspace_id, receipt_key)
);

alter table public.workspace_patch_receipts enable row level security;
alter table public.workspace_patch_receipts force row level security;
revoke all on public.workspace_patch_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists workspace_patch_receipts_owner_access on public.workspace_patch_receipts;
create policy workspace_patch_receipts_owner_access on public.workspace_patch_receipts
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. apply_workspace_patch — service-only. Optimistic-concurrency + receipt +
--    patch_kind whitelist + shallow jsonb apply, in ONE locked transaction.
--
--    Returns json {status, new_updated_at, latest_updated_at}:
--      applied              — patch applied, receipt written, new_updated_at set
--      already_applied      — receipt_key + same payload already applied (no-op)
--      idempotency_conflict — receipt_key reused with a different payload
--      stale_token          — expected_updated_at != current (caller recomputes,
--                             latest_updated_at returned so the worker retries)
--      invalid_request      — unknown patch_kind or malformed patch
-- ---------------------------------------------------------------------------
create or replace function public.apply_workspace_patch(
  p_workspace_id uuid,
  p_expected_updated_at timestamptz,
  p_patch_kind text,
  p_patch jsonb,
  p_receipt_key text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  ws public.workspace_state%rowtype;
  receipt public.workspace_patch_receipts%rowtype;
  sha text;
  new_state jsonb;
  append_kinds constant text[] := array[
    'append_campaign', 'append_candidates', 'append_activities', 'append_reply', 'append_enrichment_ledger'];
  append_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_patch_kind is null or p_patch_kind not in (
      'append_campaign', 'append_candidates', 'append_activities', 'append_reply',
      'append_enrichment_ledger', 'merge_candidate_patch', 'merge_outreach_status') then
    return json_build_object('status', 'invalid_request', 'reason', 'unknown-patch-kind');
  end if;
  if p_patch is null then
    return json_build_object('status', 'invalid_request', 'reason', 'null-patch');
  end if;
  if p_receipt_key is null or char_length(btrim(p_receipt_key)) < 1 or char_length(p_receipt_key) > 200 then
    return json_build_object('status', 'invalid_request', 'reason', 'invalid-receipt-key');
  end if;

  sha := encode(digest(p_patch_kind || E'\n' || p_patch::text, 'sha256'), 'hex');

  -- Lock the workspace document first (optimistic-concurrency + apply serialize here).
  select * into ws
    from public.workspace_state
    where workspace_id = p_workspace_id
    for update;
  if not found then
    return json_build_object('status', 'invalid_request', 'reason', 'unknown-workspace');
  end if;

  -- Receipt lock-and-return (exact-once across retries).
  select * into receipt
    from public.workspace_patch_receipts
    where workspace_id = p_workspace_id and receipt_key = p_receipt_key
    for update;
  if found then
    if receipt.patch_sha256 = sha then
      return json_build_object('status', 'already_applied', 'new_updated_at', ws.updated_at);
    end if;
    return json_build_object('status', 'idempotency_conflict', 'latest_updated_at', ws.updated_at);
  end if;

  -- Optimistic-concurrency: same token the browser uses (workspace.ts).
  if p_expected_updated_at is distinct from ws.updated_at then
    return json_build_object('status', 'stale_token', 'latest_updated_at', ws.updated_at);
  end if;

  -- Shallow apply per kind. Append kinds concatenate a jsonb ARRAY of items onto a
  -- top-level array; merge kinds shallow-merge one object into the array element(s)
  -- keyed by id (+ campaignId for candidates). No client logic beyond this.
  if p_patch_kind = any(append_kinds) then
    if jsonb_typeof(p_patch) <> 'array' then
      return json_build_object('status', 'invalid_request', 'reason', 'append-patch-not-array');
    end if;
    append_key := case p_patch_kind
      when 'append_campaign' then 'campaigns'
      when 'append_candidates' then 'candidates'
      when 'append_activities' then 'activities'
      when 'append_reply' then 'replies'
      when 'append_enrichment_ledger' then 'enrichmentLedger'
    end;
    new_state := jsonb_set(
      ws.state,
      array[append_key],
      coalesce(ws.state -> append_key, '[]'::jsonb) || p_patch,
      true);

  elsif p_patch_kind = 'merge_candidate_patch' then
    if p_patch->>'id' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-candidate-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{candidates}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'id'
                and (p_patch->>'campaignId' is null or elem->>'campaignId' = p_patch->>'campaignId')
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);

  elsif p_patch_kind = 'merge_outreach_status' then
    if p_patch->>'candidateId' is null or p_patch->'patch' is null then
      return json_build_object('status', 'invalid_request', 'reason', 'merge-outreach-shape');
    end if;
    new_state := jsonb_set(
      ws.state,
      '{candidates}',
      coalesce((
        select jsonb_agg(
          case when elem->>'id' = p_patch->>'candidateId'
               then elem || (p_patch->'patch')
               else elem end)
        from jsonb_array_elements(coalesce(ws.state->'candidates', '[]'::jsonb)) elem
      ), '[]'::jsonb),
      true);
  end if;

  -- ONE update — fires touch_updated_at + the 0035/0036 mirror + 0033 reimport guard.
  update public.workspace_state
     set state = new_state
   where workspace_id = p_workspace_id;

  insert into public.workspace_patch_receipts(workspace_id, receipt_key, patch_kind, patch_sha256)
    values (p_workspace_id, p_receipt_key, p_patch_kind, sha);

  select updated_at into ws.updated_at from public.workspace_state where workspace_id = p_workspace_id;
  return json_build_object('status', 'applied', 'new_updated_at', ws.updated_at);
end;
$$;

revoke all on function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text) to service_role;

alter function public.apply_workspace_patch(uuid, timestamptz, text, jsonb, text) owner to postgres;
