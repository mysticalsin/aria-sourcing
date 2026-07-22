-- 0050_requisition_parse_authority.sql
--
-- Closes the requisition_parse authority gap found in independent review:
-- the worker-triggered internal route trusted caller-supplied
-- {job_id, lease_id, workspace_id, requisition_id} with no database proof
-- before calling a cloud model provider, and the write path
-- (record_requisition_parse + complete_aria_job) was two unrelated
-- service-only calls — record_requisition_parse alone required nothing but
-- a requisition_id, so any service-role caller could rewrite a requisition's
-- parse state with zero lease/job/workspace binding.
--
-- This migration adds two new service-only RPCs and tightens three existing
-- ones. It does not edit 0038/0043/0049 (append-only).
--
--   * authorize_requisition_parse_job — read-only pre-egress gate. Must
--     return status 'authorized' before any provider (model) call or any
--     requisition mutation may occur. Validates the exact live, unexpired
--     requisition_parse lease, job kind, workspace, payload requisition_id,
--     input hash, and enabled intake controls.
--   * finalize_requisition_parse — the ONE atomic write. Revalidates every
--     fact above again (closes the TOCTOU window between authorize and the
--     model call), computes readiness server-side from the grounded
--     job-analysis values (never trusts a caller-supplied ready flag),
--     records parse evidence (input hash, provider, model, result hash),
--     completes the aria_jobs row, emits one bounded loop_events row, and
--     enqueues exactly one deterministic campaign_create job when ready — or
--     rolls back every effect together.
--
-- record_requisition_parse(uuid,jsonb,jsonb,numeric,boolean) (0043) is the
-- old global requisition-id-only mutation; its execute grant is revoked so
-- it can no longer be called by anything, closing the bypass. The function
-- itself is left in place (append-only; migrations must stay replayable).
--
-- heartbeat_aria_job / complete_aria_job / fail_aria_job (0038) are
-- re-created with an added `lease_expires_at > now()` check on every
-- lease-bound WHERE clause: previously they checked only
-- (status = 'leased' AND lease_id = p_lease_id), so a stalled worker
-- holding a lease past its `lease_expires_at` could still heartbeat,
-- complete, or fail a job in the window before reap_expired_aria_job_leases
-- physically reclaims it.
--
-- Run after 0049_need_ingress_authority.sql.

alter table public.requisitions
  add column if not exists parse_provider text
    check (parse_provider is null or char_length(parse_provider) between 1 and 100),
  add column if not exists parse_model text
    check (parse_model is null or char_length(parse_model) between 1 and 200),
  add column if not exists parse_input_sha256 text
    check (parse_input_sha256 is null or parse_input_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists parse_result_sha256 text
    check (parse_result_sha256 is null or parse_result_sha256 ~ '^[0-9a-f]{64}$');

create table if not exists public.requisition_parse_receipts (
  job_id uuid primary key references public.aria_jobs(id) on delete cascade,
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null check (char_length(provider) between 1 and 100),
  model text not null check (char_length(model) between 1 and 200),
  ready boolean not null,
  completed_at timestamptz not null default now(),
  foreign key (workspace_id, requisition_id)
    references public.requisitions(workspace_id, id) on delete cascade
);

alter table public.requisition_parse_receipts enable row level security;
alter table public.requisition_parse_receipts force row level security;
revoke all on public.requisition_parse_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists requisition_parse_receipts_postgres_all
  on public.requisition_parse_receipts;
create policy requisition_parse_receipts_postgres_all
  on public.requisition_parse_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_requisition_parse_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'requisition parse receipts are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_requisition_parse_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists requisition_parse_receipts_append_only
  on public.requisition_parse_receipts;
create trigger requisition_parse_receipts_append_only
  before update or delete on public.requisition_parse_receipts
  for each row execute function public.reject_requisition_parse_receipt_mutation();

-- ---------------------------------------------------------------------------
-- authorize_requisition_parse_job — read-only pre-egress authority gate
-- ---------------------------------------------------------------------------
create or replace function public.authorize_requisition_parse_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  input_row public.requisition_inputs%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_requisition_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'requisition_parse' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lease_expired');
  end if;
  if job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  select * into input_row
    from public.requisition_inputs
   where requisition_id = p_requisition_id
     and workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'input_not_found');
  end if;

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id;
  if not found or control_row.kill_switch or not control_row.intake_enabled then
    return jsonb_build_object('status', 'intake_disabled');
  end if;

  -- Raw input is returned only after the exact handler authority has been
  -- proven. This prevents the internal route from reading another tenant's
  -- need, or mutating an unrelated job through fail_aria_job, before it
  -- knows that it owns this exact requisition_parse lease.
  return jsonb_build_object(
    'status', 'authorized',
    'workspace_id', input_row.workspace_id,
    'requisition_id', input_row.requisition_id,
    'content', input_row.content,
    'content_type', input_row.content_type,
    'need_sha256', input_row.need_sha256
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_requisition_parse — the one atomic write
-- ---------------------------------------------------------------------------
create or replace function public.finalize_requisition_parse(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid,
  p_input_sha256 text,
  p_job_analysis jsonb,
  p_warnings jsonb,
  p_provider text,
  p_model text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  input_row public.requisition_inputs%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  receipt_row public.requisition_parse_receipts%rowtype;
  ready boolean;
  result_hash text;
  confidence numeric;
  updated int;
  enqueue_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_requisition_id is null or p_input_sha256 is null
     or p_input_sha256 !~ '^[0-9a-f]{64}$'
     or p_job_analysis is null or jsonb_typeof(p_job_analysis) <> 'object'
     or p_warnings is null or jsonb_typeof(p_warnings) <> 'array'
     or p_provider is null or char_length(p_provider) not between 1 and 100
     or p_model is null or char_length(p_model) not between 1 and 200 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Lock the job row for the rest of this transaction: nothing else can
  -- change its status/lease under us from here on.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'requisition_parse' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.status not in ('leased', 'succeeded') then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  if job_row.status = 'leased' then
    if job_row.lease_id <> p_lease_id then
      return jsonb_build_object('status', 'lease_mismatch');
    end if;
    if job_row.lease_expires_at is null or job_row.lease_expires_at <= clock_timestamp() then
      return jsonb_build_object('status', 'lease_expired');
    end if;
  end if;
  if job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  select * into input_row
    from public.requisition_inputs
   where requisition_id = p_requisition_id
     and workspace_id = p_workspace_id;
  if not found or input_row.need_sha256 <> p_input_sha256 then
    return jsonb_build_object('status', 'input_mismatch');
  end if;

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id
     for share;
  if not found or control_row.kill_switch or not control_row.intake_enabled then
    return jsonb_build_object('status', 'intake_disabled');
  end if;

  -- Readiness is computed HERE, from the grounded job-analysis values, and
  -- is never taken from a caller-supplied flag. Mirrors
  -- src/lib/needs/readiness.ts::evaluateNeedReadiness exactly.
  ready := (
    length(btrim(coalesce(p_job_analysis->>'title', ''))) >= 2
    and coalesce(p_job_analysis->>'seniority', 'Unspecified') <> 'Unspecified'
    and coalesce(p_job_analysis->>'employmentType', 'Unspecified') <> 'Unspecified'
    and coalesce(p_job_analysis->>'locationType', 'Unspecified') <> 'Unspecified'
    and exists (
      select 1
        from jsonb_array_elements_text(coalesce(p_job_analysis->'requiredSkills', '[]'::jsonb)) skill
       where length(btrim(skill)) > 0
    )
  );
  confidence := (
    select round((count(*) filter (where present))::numeric / 5, 4)
      from (values
        (length(btrim(coalesce(p_job_analysis->>'title', ''))) > 0),
        (coalesce(p_job_analysis->>'seniority', 'Unspecified') <> 'Unspecified'),
        (coalesce(p_job_analysis->>'employmentType', 'Unspecified') <> 'Unspecified'),
        (coalesce(p_job_analysis->>'locationType', 'Unspecified') <> 'Unspecified'),
        (jsonb_array_length(coalesce(p_job_analysis->'requiredSkills', '[]'::jsonb)) > 0)
      ) as f(present)
  );
  -- The receipt commits to every persisted model-derived field. Hashing only
  -- job_analysis would incorrectly accept a replay whose warnings drifted.
  result_hash := encode(sha256(convert_to(
    jsonb_build_object('job_analysis', p_job_analysis, 'warnings', p_warnings)::text,
    'UTF8'
  )), 'hex');

  -- Lost-response retry: only the exact completed lease and exact immutable
  -- parse evidence may replay successfully. A different job, lease, input,
  -- model or output is a conflict and can never be mistaken for completion.
  if job_row.status = 'succeeded' then
    select * into receipt_row
      from public.requisition_parse_receipts
     where job_id = p_job_id;
    if found
       and receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.requisition_id = p_requisition_id
       and receipt_row.input_sha256 = p_input_sha256
       and receipt_row.result_sha256 = result_hash
       and receipt_row.provider = p_provider
       and receipt_row.model = p_model then
      return jsonb_build_object(
        'status', 'no_op_replay',
        'ready', receipt_row.ready
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  update public.requisitions
     set parsed_job_analysis = p_job_analysis,
         parse_warnings = p_warnings,
         parse_confidence = confidence,
         status = case when ready then 'ready' else 'needs_clarification' end,
         parse_provider = p_provider,
         parse_model = p_model,
         parse_input_sha256 = p_input_sha256,
         parse_result_sha256 = result_hash,
         updated_at = now()
   where id = p_requisition_id
     and workspace_id = p_workspace_id
     and status in ('received', 'parsed');
  get diagnostics updated = row_count;

  if updated = 0 then
    return jsonb_build_object('status', 'state_conflict');
  end if;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
  values (
    p_workspace_id, 'requisition.parsed', 'requisition', p_requisition_id::text, p_job_id,
    jsonb_build_object('ready', ready)
  );

  -- The requisitions row is already written at this point: any failure from
  -- here on must raise (never return) so the whole transaction rolls back
  -- together, never leaving a parsed requisition with a job that isn't
  -- actually complete.
  update public.aria_jobs
     set status = 'succeeded',
         result_sha256 = result_hash,
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
     and lease_expires_at > clock_timestamp();
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'requisition parse job lease lost mid-commit' using errcode = 'P0001';
  end if;

  if ready then
    enqueue_result := public.enqueue_aria_job(
      p_workspace_id,
      'campaign_create',
      'campaign_create:' || p_requisition_id::text,
      jsonb_build_object('requisition_id', p_requisition_id::text),
      now(),
      100
    );
    if enqueue_result->>'status' <> 'enqueued' then
      raise exception 'campaign_create enqueue failed: %', enqueue_result->>'status'
        using errcode = '22023';
    end if;
  end if;

  insert into public.requisition_parse_receipts (
    job_id, lease_id, workspace_id, requisition_id,
    input_sha256, result_sha256, provider, model, ready
  ) values (
    p_job_id, p_lease_id, p_workspace_id, p_requisition_id,
    p_input_sha256, result_hash, p_provider, p_model, ready
  );

  return jsonb_build_object('status', 'completed', 'ready', ready);
end;
$$;

alter function public.authorize_requisition_parse_job(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.finalize_requisition_parse(uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text) owner to postgres;

revoke all on function public.authorize_requisition_parse_job(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.authorize_requisition_parse_job(uuid, uuid, uuid, uuid)
  to service_role;

revoke all on function public.finalize_requisition_parse(uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.finalize_requisition_parse(uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, text)
  to service_role;

-- Close the bypass: the old requisition-id-only mutation can no longer be
-- called by anything. Left in place (not dropped) because migrations are
-- append-only and 0043 must stay replayable.
revoke execute on function public.record_requisition_parse(uuid, jsonb, jsonb, numeric, boolean)
  from service_role;

-- ---------------------------------------------------------------------------
-- Make expiry authoritative: heartbeat/complete/fail now also require
-- lease_expires_at > clock_timestamp() at the exact boundary, closing the window
-- between a lease's logical expiry and the reaper physically reclaiming it.
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat_aria_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_lease_seconds integer
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  updated_count integer;
  job_row public.aria_jobs%rowtype;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    return false;
  end if;

  -- Lock first, then evaluate expiry against a wall-clock value captured
  -- after any lock wait. An UPDATE predicate may be evaluated before waiting
  -- on a concurrent row lock and must not authorize a lease that expires
  -- while blocked.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return false;
  end if;
  wall_now := clock_timestamp();
  if job_row.status <> 'leased'
     or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at is null
     or job_row.lease_expires_at <= wall_now then
    return false;
  end if;

  update public.aria_jobs
     set lease_expires_at = wall_now + make_interval(secs => p_lease_seconds),
         updated_at = wall_now
   where id = p_job_id;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.complete_aria_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_result_sha256 text,
  p_events jsonb default '[]'::jsonb,
  p_enqueue jsonb default '[]'::jsonb
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  event_item jsonb;
  enqueue_item jsonb;
  enqueue_result jsonb;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null
     or (p_result_sha256 is not null and p_result_sha256 !~ '^[0-9a-f]{64}$')
     or p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 20
     or p_enqueue is null or jsonb_typeof(p_enqueue) <> 'array'
     or jsonb_array_length(p_enqueue) > 50 then
    return false;
  end if;

  -- One-shot: lock first, then evaluate expiry against a wall-clock value
  -- captured after any concurrent lock wait.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return false;
  end if;
  wall_now := clock_timestamp();
  if job_row.status <> 'leased'
     or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at is null
     or job_row.lease_expires_at <= wall_now then
    return false;
  end if;

  update public.aria_jobs
     set status = 'succeeded',
         result_sha256 = p_result_sha256,
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = wall_now
   where id = p_job_id;

  for event_item in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(event_item) <> 'object'
       or event_item->>'event_type' is null
       or (event_item->>'event_type') !~ '^[a-z][a-z0-9_.]{1,60}$' then
      raise exception 'invalid loop event' using errcode = '22023';
    end if;
    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      job_row.workspace_id,
      event_item->>'event_type',
      event_item->>'subject_kind',
      event_item->>'subject_id',
      job_row.id,
      coalesce(event_item->'payload', '{}'::jsonb)
    );
  end loop;

  for enqueue_item in select value from jsonb_array_elements(p_enqueue)
  loop
    if jsonb_typeof(enqueue_item) <> 'object' then
      raise exception 'invalid follow-on job' using errcode = '22023';
    end if;
    enqueue_result := public.enqueue_aria_job(
      job_row.workspace_id,
      enqueue_item->>'kind',
      enqueue_item->>'idempotency_key',
      coalesce(enqueue_item->'payload', '{}'::jsonb),
      coalesce((enqueue_item->>'run_at')::timestamptz, wall_now),
      coalesce((enqueue_item->>'priority')::integer, 100)
    );
    if enqueue_result->>'status' not in ('enqueued') then
      raise exception 'follow-on enqueue failed: %', enqueue_result->>'status'
        using errcode = '22023';
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.fail_aria_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_error text,
  p_retryable boolean
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  new_status text;
  backoff interval;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_retryable is null then
    return 'invalid_request';
  end if;

  -- Lock first, then evaluate expiry. This prevents a statement that began
  -- while the lease was live from failing/requeueing it after a lock wait
  -- carried the statement past lease_expires_at.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return 'not_found';
  end if;
  wall_now := clock_timestamp();
  if job_row.status <> 'leased'
     or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at is null
     or job_row.lease_expires_at <= wall_now then
    return 'not_found';
  end if;

  if p_retryable and job_row.attempt_count < job_row.max_attempts then
    new_status := 'queued';
    backoff := least(
      make_interval(mins => 1) * power(2, job_row.attempt_count),
      make_interval(hours => 4)
    ) + make_interval(secs => floor(random() * 30)::integer);
  else
    new_status := 'dead';
  end if;

  update public.aria_jobs
     set status = new_status,
         lease_id = null,
         lease_expires_at = null,
         next_run_at = case when new_status = 'queued' then wall_now + backoff else next_run_at end,
         last_error = left(coalesce(p_error, 'unknown'), 2000),
         updated_at = wall_now
   where id = p_job_id;

  if new_status = 'dead' then
    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      job_row.workspace_id, 'job.dead', 'aria_job', job_row.id::text, job_row.id,
      jsonb_build_object('kind', job_row.kind, 'attempts', job_row.attempt_count)
    );
  end if;

  return new_status;
end;
$$;

alter function public.heartbeat_aria_job(uuid, uuid, integer) owner to postgres;
alter function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb) owner to postgres;
alter function public.fail_aria_job(uuid, uuid, text, boolean) owner to postgres;

revoke all on function public.heartbeat_aria_job(uuid, uuid, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.heartbeat_aria_job(uuid, uuid, integer)
  to service_role;

revoke all on function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb)
  to service_role;

revoke all on function public.fail_aria_job(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.fail_aria_job(uuid, uuid, text, boolean)
  to service_role;
