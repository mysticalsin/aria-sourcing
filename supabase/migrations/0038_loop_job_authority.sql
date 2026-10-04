-- 0038_loop_job_authority.sql
--
-- ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
-- 2026-07-23); Owner acknowledged hybrid build in-conversation (meeting 024).
-- Codex must attack this exact artifact before the banner comes off.
--
-- The job spine of the autonomous sourcing loop (PLAN.md Rock 1).
--
-- Three authority tables + one heartbeat table, all fully locked down
-- (RLS enabled + forced, every direct grant revoked, postgres-only policy —
-- the 0026/0031/0034 pattern). Every read and write goes through a
-- SECURITY DEFINER RPC owned by postgres.
--
--   * aria_jobs        — one generic durable queue for DISCRETE units of loop
--     work (an email sync, a sourcing batch, a provider poll). Recurring
--     scans (outbox drain, reapers) are worker tick tasks, NOT job rows.
--     Payloads carry ids ONLY — never candidate PII — so the queue itself
--     stays outside GDPR-erasure scope (contract-tested).
--   * loop_events      — append-only observability spine (ids + counters
--     only). UPDATE/DELETE raise 42501, mirroring the 0033 receipt guard.
--   * sourcing_loop_controls — per-workspace fail-closed switchboard:
--     kill_switch DEFAULT TRUE, every stage enable DEFAULT FALSE, daily
--     caps. Trigger-seeded per workspace (0029 pattern). Changing it
--     requires an authenticated workspace ADMIN (never the worker).
--   * loop_worker_heartbeats — worker liveness, release-identity stamped,
--     surfaced for ops; deliberately NOT wired into /api/ready.
--
-- Claim discipline: claim_due_aria_jobs uses FOR UPDATE SKIP LOCKED so any
-- number of loop machines can pull concurrently without coordination.
-- Completion/failure are one-shot transitions guarded by (status = 'leased'
-- AND lease_id = p_lease_id) — a reaped-then-reclaimed job's stale worker
-- can never complete somebody else's lease (0034 one-shot discipline).
-- complete_aria_job writes the job's loop_events and enqueues follow-on jobs
-- IN THE SAME TRANSACTION (transactional outbox): the loop can never record
-- success without also persisting what happens next.

-- ---------------------------------------------------------------------------
-- aria_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.aria_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in (
    'email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create',
    'sourcing_batch', 'provider_poll', 'enrich_candidate', 'shortlist_build',
    'draft_generate', 'delivery_reconcile', 'outcome_feedback'
  )),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
  -- ids only, never candidate PII; size-bounded as defense-in-depth
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 8192),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'succeeded', 'failed', 'dead')),
  priority integer not null default 100 check (priority between 0 and 1000),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  next_run_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  claimed_by text check (claimed_by is null or claimed_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aria_jobs_workspace_kind_idem_uniq unique (workspace_id, kind, idempotency_key),
  check ((status = 'leased') = (lease_id is not null and lease_expires_at is not null))
);

create index if not exists aria_jobs_due_idx
  on public.aria_jobs (next_run_at, priority)
  where status = 'queued';
create index if not exists aria_jobs_expired_lease_idx
  on public.aria_jobs (lease_expires_at)
  where status = 'leased';
create index if not exists aria_jobs_workspace_status_idx
  on public.aria_jobs (workspace_id, status, created_at desc);

alter table public.aria_jobs enable row level security;
alter table public.aria_jobs force row level security;
revoke all on public.aria_jobs
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists aria_jobs_owner_access on public.aria_jobs;
create policy aria_jobs_owner_access on public.aria_jobs
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- loop_events (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.loop_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{1,60}$'),
  subject_kind text check (subject_kind is null or subject_kind ~ '^[a-z][a-z0-9_]{0,40}$'),
  subject_id text check (subject_id is null or char_length(subject_id) between 1 and 160),
  job_id uuid references public.aria_jobs(id) on delete set null,
  -- ids + counters only, never candidate PII; size-bounded as defense-in-depth
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 4096),
  created_at timestamptz not null default now()
);

create index if not exists loop_events_workspace_id_idx
  on public.loop_events (workspace_id, id desc);

alter table public.loop_events enable row level security;
alter table public.loop_events force row level security;
revoke all on public.loop_events
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.loop_events_id_seq
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists loop_events_owner_access on public.loop_events;
create policy loop_events_owner_access on public.loop_events
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_loop_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'loop events are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_loop_event_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists loop_events_append_only on public.loop_events;
create trigger loop_events_append_only
  before update or delete on public.loop_events
  for each row execute function public.reject_loop_event_mutation();

-- ---------------------------------------------------------------------------
-- sourcing_loop_controls (fail-closed switchboard, trigger-seeded)
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_loop_controls (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  kill_switch boolean not null default true,
  intake_enabled boolean not null default false,
  sourcing_enabled boolean not null default false,
  enrichment_enabled boolean not null default false,
  sequences_enabled boolean not null default false,
  max_sourcing_runs_per_day integer not null default 10
    check (max_sourcing_runs_per_day between 0 and 100),
  max_sequence_sends_per_day integer not null default 50
    check (max_sequence_sends_per_day between 0 and 1000),
  max_enrichment_units_per_day integer not null default 200
    check (max_enrichment_units_per_day between 0 and 10000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  -- Fail-closed: no stage may be enabled while the kill switch is engaged,
  -- and every enable must be attributable to a named admin.
  check (
    not (intake_enabled or sourcing_enabled or enrichment_enabled or sequences_enabled)
    or (not kill_switch and updated_by is not null)
  ),
  foreign key (workspace_id, updated_by)
    references public.profiles (workspace_id, id) on delete restrict
);

insert into public.sourcing_loop_controls (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;

create or replace function public.seed_sourcing_loop_control()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.sourcing_loop_controls (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_sourcing_loop_control()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists workspaces_seed_sourcing_loop_control on public.workspaces;
create trigger workspaces_seed_sourcing_loop_control
  after insert on public.workspaces
  for each row execute function public.seed_sourcing_loop_control();

alter table public.sourcing_loop_controls enable row level security;
alter table public.sourcing_loop_controls force row level security;
revoke all on public.sourcing_loop_controls
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists sourcing_loop_controls_owner_access on public.sourcing_loop_controls;
create policy sourcing_loop_controls_owner_access on public.sourcing_loop_controls
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- loop_worker_heartbeats
-- ---------------------------------------------------------------------------
create table if not exists public.loop_worker_heartbeats (
  worker_id text primary key check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
  tick_count bigint not null default 1 check (tick_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.loop_worker_heartbeats enable row level security;
alter table public.loop_worker_heartbeats force row level security;
revoke all on public.loop_worker_heartbeats
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists loop_worker_heartbeats_owner_access on public.loop_worker_heartbeats;
create policy loop_worker_heartbeats_owner_access on public.loop_worker_heartbeats
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- enqueue_aria_job — idempotent lock-and-return (0034 claim discipline)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_aria_job(
  p_workspace_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_payload jsonb,
  p_run_at timestamptz default now(),
  p_priority integer default 100
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  existing_row public.aria_jobs%rowtype;
  new_row public.aria_jobs%rowtype;
  violated_constraint text;
  payload_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_kind is null
     or p_kind not in (
       'email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create',
       'sourcing_batch', 'provider_poll', 'enrich_candidate', 'shortlist_build',
       'draft_generate', 'delivery_reconcile', 'outcome_feedback'
     )
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 8192
     or p_run_at is null
     or p_run_at > now() + interval '30 days'
     or p_priority is null
     or p_priority not between 0 and 1000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  payload_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

  -- Idempotent retry check FIRST, locking the existing row. The same
  -- idempotency key always resolves to the same job; a key reused with a
  -- DIFFERENT payload is an idempotency conflict, never a silent replay.
  select * into existing_row
    from public.aria_jobs
   where workspace_id = p_workspace_id
     and kind = p_kind
     and idempotency_key = p_idempotency_key
   for update;
  if found then
    if existing_row.payload_sha256 <> payload_hash then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'enqueued',
      'id', existing_row.id,
      'job_status', existing_row.status,
      'replay', true
    );
  end if;

  begin
    insert into public.aria_jobs (
      workspace_id, kind, idempotency_key, payload, payload_sha256,
      next_run_at, priority
    ) values (
      p_workspace_id, p_kind, p_idempotency_key, p_payload, payload_hash,
      p_run_at, p_priority
    )
    returning * into new_row;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'aria_jobs_workspace_kind_idem_uniq' then
      select * into existing_row
        from public.aria_jobs
       where workspace_id = p_workspace_id
         and kind = p_kind
         and idempotency_key = p_idempotency_key
       for update;
      if existing_row.payload_sha256 <> payload_hash then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'enqueued',
        'id', existing_row.id,
        'job_status', existing_row.status,
        'replay', true
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'enqueued',
    'id', new_row.id,
    'job_status', new_row.status,
    'replay', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_due_aria_jobs — FOR UPDATE SKIP LOCKED, horizontal-scale safe
-- ---------------------------------------------------------------------------
create or replace function public.claim_due_aria_jobs(
  p_worker_id text,
  p_lease_seconds integer,
  p_kinds text[],
  p_limit integer
) returns setof public.aria_jobs
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600
     or p_kinds is null or array_length(p_kinds, 1) is null
     or p_limit is null or p_limit not between 1 and 50 then
    return;
  end if;

  return query
  update public.aria_jobs job
     set status = 'leased',
         lease_id = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         claimed_by = p_worker_id,
         attempt_count = job.attempt_count + 1,
         updated_at = now()
   where job.id in (
     select due.id
       from public.aria_jobs due
      where due.status = 'queued'
        and due.next_run_at <= now()
        and due.kind = any(p_kinds)
      order by due.priority asc, due.next_run_at asc
      limit p_limit
        for update skip locked
   )
  returning job.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- heartbeat_aria_job — lease extension, lease-bound
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat_aria_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_lease_seconds integer
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  updated_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    return false;
  end if;

  update public.aria_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_aria_job — one-shot success + transactional outbox
-- ---------------------------------------------------------------------------
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

  -- One-shot: only the live lease holder may complete.
  update public.aria_jobs
     set status = 'succeeded',
         result_sha256 = p_result_sha256,
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
  returning * into job_row;
  if not found then
    return false;
  end if;

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
      coalesce((enqueue_item->>'run_at')::timestamptz, now()),
      coalesce((enqueue_item->>'priority')::integer, 100)
    );
    -- Fail the WHOLE completion if a follow-on cannot be enqueued: recording
    -- success while dropping the next step would silently break the chain.
    if enqueue_result->>'status' not in ('enqueued') then
      raise exception 'follow-on enqueue failed: %', enqueue_result->>'status'
        using errcode = '22023';
    end if;
  end loop;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- fail_aria_job — one-shot failure: capped exponential backoff or dead-letter
-- ---------------------------------------------------------------------------
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_retryable is null then
    return 'invalid_request';
  end if;

  select * into job_row
    from public.aria_jobs
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
   for update;
  if not found then
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
         next_run_at = case when new_status = 'queued' then now() + backoff else next_run_at end,
         last_error = left(coalesce(p_error, 'unknown'), 2000),
         updated_at = now()
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

-- ---------------------------------------------------------------------------
-- requeue_dead_aria_job — human dead-letter recovery (authenticated ADMIN)
-- ---------------------------------------------------------------------------
create or replace function public.requeue_dead_aria_job(
  p_job_id uuid
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_job_id is null then
    return false;
  end if;

  update public.aria_jobs
     set status = 'queued',
         attempt_count = 0,
         next_run_at = now(),
         lease_id = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_job_id
     and workspace_id = caller_workspace
     and status = 'dead';
  get diagnostics updated_count = row_count;

  if updated_count = 1 then
    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      caller_workspace, 'job.requeued', 'aria_job', p_job_id::text, p_job_id,
      jsonb_build_object('actor_id', auth.uid()::text)
    );
  end if;
  return updated_count = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- reap_expired_aria_job_leases — crash recovery for the job spine
-- ---------------------------------------------------------------------------
create or replace function public.reap_expired_aria_job_leases(
  p_limit integer
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  reaped_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    return 0;
  end if;

  with expired as (
    select id, attempt_count, max_attempts
      from public.aria_jobs
     where status = 'leased'
       and lease_expires_at < now()
     order by lease_expires_at asc
     limit p_limit
       for update skip locked
  )
  update public.aria_jobs job
     set status = case when expired.attempt_count >= expired.max_attempts then 'dead' else 'queued' end,
         lease_id = null,
         lease_expires_at = null,
         next_run_at = now() + make_interval(secs => 30 + floor(random() * 30)::integer),
         last_error = coalesce(job.last_error, 'lease expired'),
         updated_at = now()
    from expired
   where job.id = expired.id;
  get diagnostics reaped_count = row_count;
  return reaped_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- reap_expired_agent_framework_leases — closes the 0029 reaper gap: a crashed
-- executor left runs stuck in claimed/running forever.
-- ---------------------------------------------------------------------------
create or replace function public.reap_expired_agent_framework_leases(
  p_limit integer
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  reaped_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    return 0;
  end if;

  with expired as (
    select id
      from public.agent_framework_runs
     where status in ('claimed', 'running')
       and lease_expires_at < now()
     order by lease_expires_at asc
     limit p_limit
       for update skip locked
  )
  update public.agent_framework_runs run
     set status = 'failed',
         error_code = 'LEASE_EXPIRED',
         finished_at = now()
    from expired
   where run.id = expired.id;
  get diagnostics reaped_count = row_count;
  return reaped_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- sourcing_loop_controls RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_sourcing_loop_controls(
  p_workspace_id uuid
) returns setof public.sourcing_loop_controls
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    return;
  end if;
  -- Defensive: a workspace created before this migration's trigger existed
  -- still resolves to a fail-closed default row.
  insert into public.sourcing_loop_controls (workspace_id)
  select p_workspace_id
   where exists (select 1 from public.workspaces where id = p_workspace_id)
  on conflict (workspace_id) do nothing;

  return query
  select * from public.sourcing_loop_controls
   where workspace_id = p_workspace_id;
end;
$$;

create or replace function public.set_sourcing_loop_controls(
  p_kill_switch boolean,
  p_intake_enabled boolean,
  p_sourcing_enabled boolean,
  p_enrichment_enabled boolean,
  p_sequences_enabled boolean,
  p_max_sourcing_runs_per_day integer,
  p_max_sequence_sends_per_day integer,
  p_max_enrichment_units_per_day integer
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  if p_kill_switch is null
     or p_intake_enabled is null or p_sourcing_enabled is null
     or p_enrichment_enabled is null or p_sequences_enabled is null
     or p_max_sourcing_runs_per_day is null
     or p_max_sourcing_runs_per_day not between 0 and 100
     or p_max_sequence_sends_per_day is null
     or p_max_sequence_sends_per_day not between 0 and 1000
     or p_max_enrichment_units_per_day is null
     or p_max_enrichment_units_per_day not between 0 and 10000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  insert into public.sourcing_loop_controls (workspace_id)
  values (caller_workspace)
  on conflict (workspace_id) do nothing;

  -- The table CHECK constraint is the fail-closed backstop: enables with the
  -- kill switch engaged, or without a named admin, are rejected in-DB.
  update public.sourcing_loop_controls
     set kill_switch = p_kill_switch,
         intake_enabled = p_intake_enabled,
         sourcing_enabled = p_sourcing_enabled,
         enrichment_enabled = p_enrichment_enabled,
         sequences_enabled = p_sequences_enabled,
         max_sourcing_runs_per_day = p_max_sourcing_runs_per_day,
         max_sequence_sends_per_day = p_max_sequence_sends_per_day,
         max_enrichment_units_per_day = p_max_enrichment_units_per_day,
         updated_by = auth.uid(),
         updated_at = now()
   where workspace_id = caller_workspace;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    caller_workspace, 'controls.updated', 'sourcing_loop_controls', caller_workspace::text,
    jsonb_build_object(
      'actor_id', auth.uid()::text,
      'kill_switch', p_kill_switch,
      'intake_enabled', p_intake_enabled,
      'sourcing_enabled', p_sourcing_enabled,
      'enrichment_enabled', p_enrichment_enabled,
      'sequences_enabled', p_sequences_enabled
    )
  );

  return jsonb_build_object('status', 'updated');
end;
$$;

-- ---------------------------------------------------------------------------
-- list_loop_events — authenticated, workspace-scoped observability read
-- ---------------------------------------------------------------------------
create or replace function public.list_loop_events(
  p_after_id bigint default 0,
  p_limit integer default 50
) returns setof public.loop_events
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if auth.uid() is null then
    return;
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    return;
  end if;

  return query
  select * from public.loop_events
   where workspace_id = caller_workspace
     and id > coalesce(p_after_id, 0)
   order by id desc
   limit safe_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_loop_worker_heartbeat
-- ---------------------------------------------------------------------------
create or replace function public.record_loop_worker_heartbeat(
  p_worker_id text,
  p_release_sha text
) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$' then
    return;
  end if;

  insert into public.loop_worker_heartbeats (worker_id, release_sha)
  values (p_worker_id, p_release_sha)
  on conflict (worker_id) do update
    set release_sha = excluded.release_sha,
        tick_count = public.loop_worker_heartbeats.tick_count + 1,
        last_seen_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership + privileges (revoke everything, then grant exactly one role)
-- ---------------------------------------------------------------------------
alter function public.reject_loop_event_mutation() owner to postgres;
alter function public.seed_sourcing_loop_control() owner to postgres;
alter function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) owner to postgres;
alter function public.claim_due_aria_jobs(text, integer, text[], integer) owner to postgres;
alter function public.heartbeat_aria_job(uuid, uuid, integer) owner to postgres;
alter function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb) owner to postgres;
alter function public.fail_aria_job(uuid, uuid, text, boolean) owner to postgres;
alter function public.requeue_dead_aria_job(uuid) owner to postgres;
alter function public.reap_expired_aria_job_leases(integer) owner to postgres;
alter function public.reap_expired_agent_framework_leases(integer) owner to postgres;
alter function public.get_sourcing_loop_controls(uuid) owner to postgres;
alter function public.set_sourcing_loop_controls(boolean, boolean, boolean, boolean, boolean, integer, integer, integer) owner to postgres;
alter function public.list_loop_events(bigint, integer) owner to postgres;
alter function public.record_loop_worker_heartbeat(text, text) owner to postgres;

revoke all on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  to service_role;

revoke all on function public.claim_due_aria_jobs(text, integer, text[], integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_due_aria_jobs(text, integer, text[], integer)
  to service_role;

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

revoke all on function public.requeue_dead_aria_job(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.requeue_dead_aria_job(uuid)
  to authenticated;

revoke all on function public.reap_expired_aria_job_leases(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reap_expired_aria_job_leases(integer)
  to service_role;

revoke all on function public.reap_expired_agent_framework_leases(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reap_expired_agent_framework_leases(integer)
  to service_role;

revoke all on function public.get_sourcing_loop_controls(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_sourcing_loop_controls(uuid)
  to service_role;

revoke all on function public.set_sourcing_loop_controls(boolean, boolean, boolean, boolean, boolean, integer, integer, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.set_sourcing_loop_controls(boolean, boolean, boolean, boolean, boolean, integer, integer, integer)
  to authenticated;

revoke all on function public.list_loop_events(bigint, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_loop_events(bigint, integer)
  to authenticated;

revoke all on function public.record_loop_worker_heartbeat(text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.record_loop_worker_heartbeat(text, text)
  to service_role;
