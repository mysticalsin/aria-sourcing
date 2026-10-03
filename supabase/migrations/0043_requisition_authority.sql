-- 0043_requisition_authority.sql
--
-- Rock 4b: a need arrives and becomes a campaign with zero /intake clicks. An
-- inbound need email (or a machine POST) is persisted as a requisition, parsed
-- (heuristic + grounded LLM, server-side), and — when ready — turned into a
-- campaign through the D1 write path (0042). Not-ready requisitions raise a
-- clarification draft that clears the SAME human approval gate (never auto-send).
--
-- source_ref (the provider message id) is THE idempotency key: re-forwarding a
-- need creates exactly one requisition and one campaign.
--
-- ⚠️ DEGRADED (Codex Integrator usage-limited until 2026-07-23; adversarial review
-- REQUIRED) and NOT runnable in the build sandbox (Docker denied). Ships dark:
-- record_requisition_campaign is only reached by the Rock 5 worker behind the 0038
-- loop kill switch; the /api/intake bearer path is a separate follow-up. Prove with
-- tests/requisitions-db.sh before any autonomous campaign creation.
--
-- Idempotent; safe to re-run. Run AFTER 0042_workspace_commit_authority.sql.

create table if not exists public.requisitions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces(id) on delete cascade,
  source_kind              text not null check (source_kind in ('inbound_email', 'manual', 'api', 'databricks')),
  source_ref               text not null check (char_length(source_ref) between 1 and 512),
  status                   text not null default 'received' check (status in (
                             'received', 'parsed', 'needs_clarification', 'clarification_sent',
                             'ready', 'campaign_created', 'rejected', 'erased')),
  parsed_job_analysis      jsonb,
  parse_warnings           jsonb not null default '[]'::jsonb,
  parse_confidence         numeric,
  clarification_outbound_id uuid references public.messages_outbound(id) on delete set null,
  campaign_id              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (workspace_id, source_kind, source_ref),
  check ((status = 'campaign_created') = (campaign_id is not null))
);

create index if not exists requisitions_ws_status_idx
  on public.requisitions (workspace_id, status, created_at desc);

alter table public.requisitions enable row level security;
alter table public.requisitions force row level security;
revoke all on public.requisitions from public, anon, authenticated, service_role, authenticator;
grant select on public.requisitions to authenticated;
drop policy if exists requisitions_owner_access on public.requisitions;
create policy requisitions_owner_access on public.requisitions
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists requisitions_member_read on public.requisitions;
create policy requisitions_member_read on public.requisitions
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- ingest_requisition — service-only, lock-and-return on source_ref (exact-once).
create or replace function public.ingest_requisition(
  p_workspace_id uuid,
  p_source_kind text,
  p_source_ref text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  existing public.requisitions%rowtype;
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_source_kind not in ('inbound_email', 'manual', 'api', 'databricks') then
    return json_build_object('ok', false, 'reason', 'invalid-source-kind');
  end if;
  if p_source_ref is null or char_length(btrim(p_source_ref)) < 1 or char_length(p_source_ref) > 512 then
    return json_build_object('ok', false, 'reason', 'invalid-source-ref');
  end if;

  select * into existing
    from public.requisitions
    where workspace_id = p_workspace_id and source_kind = p_source_kind and source_ref = btrim(p_source_ref);
  if found then
    return json_build_object('ok', true, 'requisition_id', existing.id, 'status', existing.status, 'duplicate', true);
  end if;

  begin
    insert into public.requisitions(workspace_id, source_kind, source_ref)
      values (p_workspace_id, p_source_kind, btrim(p_source_ref))
      returning id into new_id;
  exception when unique_violation then
    select id into new_id from public.requisitions
      where workspace_id = p_workspace_id and source_kind = p_source_kind and source_ref = btrim(p_source_ref);
    return json_build_object('ok', true, 'requisition_id', new_id, 'duplicate', true);
  end;

  return json_build_object('ok', true, 'requisition_id', new_id, 'status', 'received', 'duplicate', false);
end;
$$;

revoke all on function public.ingest_requisition(uuid, text, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.ingest_requisition(uuid, text, text) to service_role;

-- record_requisition_parse — service-only, one-shot from received/needs_clarification.
create or replace function public.record_requisition_parse(
  p_requisition_id uuid,
  p_job_analysis jsonb,
  p_warnings jsonb,
  p_confidence numeric,
  p_ready boolean
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  update public.requisitions
     set parsed_job_analysis = p_job_analysis,
         parse_warnings = coalesce(p_warnings, '[]'::jsonb),
         parse_confidence = p_confidence,
         status = case when p_ready then 'ready' else 'needs_clarification' end,
         updated_at = now()
   where id = p_requisition_id
     and status in ('received', 'parsed', 'needs_clarification');
  get diagnostics updated = row_count;
  if updated = 0 then
    return json_build_object('ok', false, 'reason', 'not-parseable-state');
  end if;
  return json_build_object('ok', true, 'status', case when p_ready then 'ready' else 'needs_clarification' end);
end;
$$;

revoke all on function public.record_requisition_parse(uuid, jsonb, jsonb, numeric, boolean)
  from public, anon, authenticated, authenticator;
grant execute on function public.record_requisition_parse(uuid, jsonb, jsonb, numeric, boolean) to service_role;

-- record_requisition_campaign — service-only, one-shot from 'ready'. The blob write
-- (append_campaign) is the caller's responsibility via apply_workspace_patch with
-- receipt_key = the requisition id FIRST; this seals provenance SECOND. Deterministic
-- campaign id (replay-proof) is supplied by the caller.
create or replace function public.record_requisition_campaign(
  p_requisition_id uuid,
  p_campaign_id text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_campaign_id is null or char_length(btrim(p_campaign_id)) < 1 or char_length(p_campaign_id) > 200 then
    return json_build_object('ok', false, 'reason', 'invalid-campaign-id');
  end if;
  update public.requisitions
     set status = 'campaign_created', campaign_id = btrim(p_campaign_id), updated_at = now()
   where id = p_requisition_id and status = 'ready';
  get diagnostics updated = row_count;
  if updated = 0 then
    return json_build_object('ok', false, 'reason', 'not-ready');
  end if;
  return json_build_object('ok', true, 'status', 'campaign_created', 'campaign_id', btrim(p_campaign_id));
end;
$$;

revoke all on function public.record_requisition_campaign(uuid, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.record_requisition_campaign(uuid, text) to service_role;

-- list_workspace_requisitions — authenticated, current-workspace scoped (inbox card).
create or replace function public.list_workspace_requisitions(
  p_limit int default 50,
  p_offset int default 0
) returns setof public.requisitions
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select *
    from public.requisitions
   where workspace_id = public.current_workspace_id()
   order by created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.list_workspace_requisitions(int, int)
  from public, anon, authenticator;
grant execute on function public.list_workspace_requisitions(int, int) to authenticated;

alter function public.ingest_requisition(uuid, text, text) owner to postgres;
alter function public.record_requisition_parse(uuid, jsonb, jsonb, numeric, boolean) owner to postgres;
alter function public.record_requisition_campaign(uuid, text) owner to postgres;
alter function public.list_workspace_requisitions(int, int) owner to postgres;
