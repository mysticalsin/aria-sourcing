-- 0049_need_ingress_authority.sql
--
-- External need ingress authority. A timestamped HMAC adapter supplies an
-- opaque idempotency key and a bounded raw role brief. This migration binds
-- that key to the exact submitted material, persists the input, and enqueues
-- the first requisition_parse job in one transaction.
--
-- The queue payload contains only the requisition id. It grants no outbound
-- authority and does not change the human approval requirement for sends.
-- Run after 0046_swarm_orchestration_authority.sql.

create unique index if not exists requisitions_workspace_id_id_uniq
  on public.requisitions (workspace_id, id);

create table if not exists public.requisition_inputs (
  requisition_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content text not null check (
    char_length(content) between 20 and 100000
    and octet_length(content) between 20 and 100000
    and content = btrim(content)
  ),
  content_type text not null check (
    content_type in ('text/plain', 'text/markdown', 'application/json')
  ),
  need_sha256 text not null check (need_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  foreign key (workspace_id, requisition_id)
    references public.requisitions (workspace_id, id) on delete cascade
);

create index if not exists requisition_inputs_workspace_received_idx
  on public.requisition_inputs (workspace_id, received_at desc);

alter table public.requisition_inputs enable row level security;
alter table public.requisition_inputs force row level security;
revoke all on public.requisition_inputs
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists requisition_inputs_owner_access on public.requisition_inputs;
create policy requisition_inputs_owner_access on public.requisition_inputs
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.ingest_requisition_and_enqueue(
  p_workspace_id uuid,
  p_source_ref text,
  p_need_content text,
  p_content_type text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  control_row public.sourcing_loop_controls%rowtype;
  existing_requisition public.requisitions%rowtype;
  existing_input public.requisition_inputs%rowtype;
  existing_job public.aria_jobs%rowtype;
  requisition_id uuid;
  request_hash text;
  job_key text;
  job_payload jsonb;
  enqueue_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_source_ref is null
     or p_source_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
     or p_need_content is null
     or char_length(p_need_content) not between 20 and 100000
     or octet_length(p_need_content) not between 20 and 100000
     or p_need_content <> btrim(p_need_content)
     or p_content_type is null
     or p_content_type not in ('text/plain', 'text/markdown', 'application/json')
     or (p_content_type = 'application/json' and not (p_need_content is json object)) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- One writer owns (tenant, source reference) from lookup through enqueue.
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || E'\n' || p_source_ref, 0)
  );

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id
   for share;
  if not found or control_row.kill_switch or not control_row.intake_enabled then
    return jsonb_build_object('status', 'intake_disabled');
  end if;

  request_hash := encode(
    sha256(convert_to(p_content_type || E'\n' || p_need_content, 'UTF8')),
    'hex'
  );

  select * into existing_requisition
    from public.requisitions
   where workspace_id = p_workspace_id
     and source_kind = 'api'
     and source_ref = p_source_ref
   for update;

  if found then
    select * into existing_input
      from public.requisition_inputs input
     where input.workspace_id = p_workspace_id
       and input.requisition_id = existing_requisition.id
     for update;
    if not found then
      return jsonb_build_object('status', 'inconsistent_state');
    end if;
    if existing_input.need_sha256 is distinct from request_hash
       or existing_input.content_type is distinct from p_content_type
       or existing_input.content is distinct from p_need_content then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;

    job_key := 'requisition_parse:' || existing_requisition.id::text;
    job_payload := jsonb_build_object('requisition_id', existing_requisition.id::text);
    select * into existing_job
      from public.aria_jobs
     where workspace_id = p_workspace_id
       and kind = 'requisition_parse'
       and idempotency_key = job_key
     for update;
    if not found or existing_job.payload is distinct from job_payload then
      return jsonb_build_object('status', 'inconsistent_state');
    end if;

    return jsonb_build_object(
      'status', 'accepted',
      'requisition_id', existing_requisition.id,
      'job_id', existing_job.id,
      'replay', true
    );
  end if;

  insert into public.requisitions (
    workspace_id, source_kind, source_ref, status
  ) values (
    p_workspace_id, 'api', p_source_ref, 'received'
  ) returning id into requisition_id;

  insert into public.requisition_inputs (
    requisition_id, workspace_id, content, content_type, need_sha256
  ) values (
    requisition_id, p_workspace_id, p_need_content, p_content_type, request_hash
  );

  job_key := 'requisition_parse:' || requisition_id::text;
  job_payload := jsonb_build_object('requisition_id', requisition_id::text);
  enqueue_result := public.enqueue_aria_job(
    p_workspace_id,
    'requisition_parse',
    job_key,
    job_payload,
    now(),
    20
  );
  if enqueue_result->>'status' <> 'enqueued' then
    raise exception 'requisition parse enqueue failed' using errcode = 'P0001';
  end if;
  if coalesce((enqueue_result->>'replay')::boolean, false) then
    raise exception 'unexpected requisition parse replay' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'status', 'accepted',
    'requisition_id', requisition_id,
    'job_id', enqueue_result->>'id',
    'replay', false
  );
end;
$$;

-- get_requisition_input is workspace-bound: the caller must name BOTH the
-- workspace and the requisition, and the stored input's workspace_id must
-- match the one supplied. A requisition id alone (e.g. leaked or guessed by a
-- different tenant's job payload) can never read another workspace's need
-- content. Replaces the earlier single-argument (p_requisition_id) form.
drop function if exists public.get_requisition_input(uuid);

create or replace function public.get_requisition_input(
  p_workspace_id uuid,
  p_requisition_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_requisition_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select jsonb_build_object(
    'status', 'found',
    'requisition_id', input.requisition_id,
    'workspace_id', input.workspace_id,
    'content', input.content,
    'content_type', input.content_type,
    'need_sha256', input.need_sha256
  ) into result
    from public.requisition_inputs input
   where input.requisition_id = p_requisition_id
     and input.workspace_id = p_workspace_id;

  return coalesce(result, jsonb_build_object('status', 'not_found'));
end;
$$;

alter function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  owner to postgres;
alter function public.get_requisition_input(uuid, uuid) owner to postgres;

revoke all on function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  to service_role;

revoke all on function public.get_requisition_input(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_requisition_input(uuid, uuid) to service_role;
