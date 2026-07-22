-- 0057_requisition_input_retention.sql
--
-- Retains raw requisition material only for a bounded, workspace-controlled
-- period after a durable parse completion. Cleanup is service-only, bounded,
-- concurrent-safe, and commits the scrub plus its content-free receipt in one
-- transaction. The original hash and media type remain authoritative for
-- idempotent ingress replay after the raw text is gone.
-- Run after 0056_need_ingress_credential_authority.sql.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(570057202607210057::bigint);

alter table public.sourcing_loop_controls
  add column raw_requisition_retention_days integer not null default 30;
alter table public.sourcing_loop_controls
  add constraint sourcing_loop_controls_raw_requisition_retention_days_check
  check (raw_requisition_retention_days between 7 and 365);

alter table public.requisition_inputs
  drop constraint requisition_inputs_content_check;
alter table public.requisition_inputs
  add column content_scrubbed_at timestamptz;
alter table public.requisition_inputs
  alter column content drop not null;
alter table public.requisition_inputs
  add constraint requisition_inputs_content_lifecycle_check check (
    (
      content is not null
      and content_scrubbed_at is null
      and char_length(content) between 20 and 100000
      and octet_length(content) between 20 and 100000
      and content = btrim(content)
    )
    or (content is null and content_scrubbed_at is not null)
  );

create unique index requisition_inputs_workspace_requisition_uniq
  on public.requisition_inputs(workspace_id, requisition_id);

create table public.requisition_input_cleanup_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  parse_job_id uuid not null references public.requisition_parse_receipts(job_id) on delete restrict,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (
    content_type in ('text/plain', 'text/markdown', 'application/json')
  ),
  retention_days integer not null check (retention_days between 7 and 365),
  input_received_at timestamptz not null,
  parse_completed_at timestamptz not null,
  scrubbed_at timestamptz not null,
  receipt_sha256 text not null unique check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint requisition_input_cleanup_receipts_input_fkey
    foreign key (workspace_id, requisition_id)
    references public.requisition_inputs(workspace_id, requisition_id) on delete restrict,
  constraint requisition_input_cleanup_receipts_one_per_input
    unique (workspace_id, requisition_id),
  constraint requisition_input_cleanup_receipts_timeline_check check (
    parse_completed_at >= input_received_at
    and scrubbed_at >= parse_completed_at
  )
);

create index requisition_input_cleanup_receipts_workspace_scrubbed_idx
  on public.requisition_input_cleanup_receipts(workspace_id, scrubbed_at desc);

alter table public.requisition_input_cleanup_receipts enable row level security;
alter table public.requisition_input_cleanup_receipts force row level security;
revoke all on public.requisition_input_cleanup_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists requisition_input_cleanup_receipts_postgres_all
  on public.requisition_input_cleanup_receipts;
create policy requisition_input_cleanup_receipts_postgres_all
  on public.requisition_input_cleanup_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.enforce_requisition_input_content_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_setting('aria.requisition_input_cleanup_authorized', true)
       is distinct from '0057' then
    raise exception 'requisition input content is immutable outside cleanup authority'
      using errcode = '42501';
  end if;
  if old.content is null
     or new.content is not null
     or new.content_scrubbed_at is null
     or new.requisition_id <> old.requisition_id
     or new.workspace_id <> old.workspace_id
     or new.content_type <> old.content_type
     or new.need_sha256 <> old.need_sha256
     or new.received_at <> old.received_at then
    raise exception 'invalid requisition input cleanup transition'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_requisition_input_content_lifecycle()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists requisition_inputs_content_lifecycle
  on public.requisition_inputs;
create trigger requisition_inputs_content_lifecycle
  before update on public.requisition_inputs
  for each row execute function public.enforce_requisition_input_content_lifecycle();

create or replace function public.enforce_requisition_input_cleanup_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'requisition input cleanup receipts are append-only'
      using errcode = '42501';
  end if;
  if current_setting('aria.requisition_input_cleanup_authorized', true)
       is distinct from '0057' then
    raise exception 'requisition input cleanup receipt requires cleanup authority'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_requisition_input_cleanup_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists requisition_input_cleanup_receipts_enforce_mutation
  on public.requisition_input_cleanup_receipts;
create trigger requisition_input_cleanup_receipts_enforce_mutation
  before insert or update or delete on public.requisition_input_cleanup_receipts
  for each row execute function public.enforce_requisition_input_cleanup_receipt_mutation();

create or replace function public.configure_requisition_input_retention(
  p_workspace_id uuid,
  p_retention_days integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  caller_id uuid := auth.uid();
  wall_now timestamptz := clock_timestamp();
begin
  if coalesce(auth.role(), '') <> 'authenticated' or caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_workspace_id is null
     or p_retention_days is null
     or p_retention_days not between 7 and 365 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  caller_workspace := public.current_workspace_id();
  if caller_workspace is null or caller_workspace <> p_workspace_id then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  perform 1
    from public.profiles profile
   where profile.id = auth.uid()
     and profile.workspace_id = p_workspace_id
     and profile.role = 'admin'
   for key share;
  if not found then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  update public.sourcing_loop_controls control
     set raw_requisition_retention_days = p_retention_days,
         updated_at = wall_now
   where control.workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.loop_events(
    workspace_id, event_type, subject_kind, subject_id, payload
  ) values (
    p_workspace_id,
    'requisition.input_retention_configured',
    'workspace',
    p_workspace_id::text,
    jsonb_build_object(
      'actor_id', caller_id::text,
      'retention_days', p_retention_days
    )
  );

  return jsonb_build_object(
    'status', 'configured',
    'workspace_id', p_workspace_id,
    'retention_days', p_retention_days
  );
end;
$$;

-- Keep the exact public signature used by the credential-bound 0056 ingress
-- adapter. The prior implementation becomes a revoked internal primitive for
-- new inputs and for pre-cleanup exact replays.
alter function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  rename to ingest_requisition_and_enqueue_pre0057;
revoke all on function public.ingest_requisition_and_enqueue_pre0057(uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;

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
  request_hash text;
  job_key text;
  job_payload jsonb;
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

    if existing_input.content is null then
      if existing_input.need_sha256 is distinct from request_hash
         or existing_input.content_type is distinct from p_content_type then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      if not exists (
        select 1
          from public.requisition_input_cleanup_receipts receipt
         where receipt.workspace_id = p_workspace_id
           and receipt.requisition_id = existing_requisition.id
           and receipt.input_sha256 = existing_input.need_sha256
           and receipt.content_type = existing_input.content_type
      ) then
        return jsonb_build_object('status', 'inconsistent_state');
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
  end if;

  return public.ingest_requisition_and_enqueue_pre0057(
    p_workspace_id,
    p_source_ref,
    p_need_content,
    p_content_type
  );
end;
$$;

create or replace function public.cleanup_requisition_input_authority(
  p_workspace_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  control public.sourcing_loop_controls%rowtype;
  candidate record;
  wall_now timestamptz := clock_timestamp();
  receipt_id uuid;
  receipt_hash text;
  updated integer;
  processed integer := 0;
  raw_inputs_scrubbed integer := 0;
  receipts_written integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_limit is null or p_limit not between 1 and 500 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into control
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id
   for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  for candidate in
    select
      input.workspace_id,
      input.requisition_id,
      input.need_sha256,
      input.content_type,
      input.received_at,
      receipt.job_id as parse_job_id,
      receipt.completed_at as parse_completed_at
    from public.requisition_inputs input
    join lateral (
      select parsed.job_id, parsed.completed_at
        from public.requisition_parse_receipts parsed
       where parsed.workspace_id = input.workspace_id
         and parsed.requisition_id = input.requisition_id
         and parsed.input_sha256 = input.need_sha256
       order by parsed.completed_at desc, parsed.job_id
       limit 1
    ) receipt on true
   where input.workspace_id = p_workspace_id
     and input.content is not null
     and input.content_scrubbed_at is null
     and receipt.completed_at <= wall_now - make_interval(days => control.raw_requisition_retention_days)
     and not exists (
       select 1
         from public.requisition_input_cleanup_receipts cleanup_receipt
        where cleanup_receipt.workspace_id = input.workspace_id
          and cleanup_receipt.requisition_id = input.requisition_id
     )
   order by receipt.completed_at, input.requisition_id
   limit p_limit
   for update of input skip locked
  loop
    receipt_id := gen_random_uuid();
    receipt_hash := encode(sha256(convert_to(concat_ws(E'\n',
      'aria.requisition-input-cleanup-receipt.v1',
      receipt_id::text,
      candidate.workspace_id::text,
      candidate.requisition_id::text,
      candidate.parse_job_id::text,
      candidate.need_sha256,
      candidate.content_type,
      control.raw_requisition_retention_days::text,
      candidate.received_at::text,
      candidate.parse_completed_at::text,
      wall_now::text
    ), 'UTF8')), 'hex');

    perform set_config('aria.requisition_input_cleanup_authorized', '0057', true);
    update public.requisition_inputs input
       set content = null,
           content_scrubbed_at = wall_now
     where input.workspace_id = candidate.workspace_id
       and input.requisition_id = candidate.requisition_id
       and input.content is not null;
    get diagnostics updated = row_count;
    if updated <> 1 then
      raise exception 'requisition input cleanup lock lost'
        using errcode = '40001';
    end if;
    raw_inputs_scrubbed := raw_inputs_scrubbed + 1;

    insert into public.requisition_input_cleanup_receipts(
      id, workspace_id, requisition_id, parse_job_id, input_sha256,
      content_type, retention_days, input_received_at, parse_completed_at,
      scrubbed_at, receipt_sha256
    ) values (
      receipt_id, candidate.workspace_id, candidate.requisition_id,
      candidate.parse_job_id, candidate.need_sha256, candidate.content_type,
      control.raw_requisition_retention_days, candidate.received_at,
      candidate.parse_completed_at, wall_now, receipt_hash
    );
    perform set_config('aria.requisition_input_cleanup_authorized', '', true);
    receipts_written := receipts_written + 1;
    processed := processed + 1;
  end loop;

  return jsonb_build_object(
    'status', 'cleaned',
    'processed', processed,
    'raw_inputs_scrubbed', raw_inputs_scrubbed,
    'receipts_written', receipts_written
  );
end;
$$;

alter function public.enforce_requisition_input_content_lifecycle() owner to postgres;
alter function public.enforce_requisition_input_cleanup_receipt_mutation() owner to postgres;
alter function public.configure_requisition_input_retention(uuid, integer) owner to postgres;
alter function public.ingest_requisition_and_enqueue_pre0057(uuid, text, text, text)
  owner to postgres;
alter function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  owner to postgres;
alter function public.cleanup_requisition_input_authority(uuid, integer)
  owner to postgres;

revoke all on function public.configure_requisition_input_retention(uuid, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.configure_requisition_input_retention(uuid, integer)
  to authenticated;

revoke all on function public.ingest_requisition_and_enqueue(uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.ingest_requisition_and_enqueue_pre0057(uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;

revoke all on function public.cleanup_requisition_input_authority(uuid, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.cleanup_requisition_input_authority(uuid, integer)
  to service_role;
