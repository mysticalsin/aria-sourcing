-- 0046_swarm_orchestration_authority.sql
--
-- ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
-- 2026-07-23); same banner as 0042-0045. Codex must attack this exact artifact
-- before anything here is enabled.
--
-- Swarm orchestration authority (PLAN.md Rock 8) — the hermes-workspace swarm
-- shape (roster → mission brief → assignments → proof-bearing checkpoints →
-- orchestrator loop → human escalation inbox) rebuilt on ARIA's enforcement
-- substrate. Where hermes DECLARES safety, this migration ENFORCES it in-DB:
--
--   * greenlight: hermes stores greenlightRequiredFor and never checks it.
--     Here a greenlight-gated assignment is mechanically undispatchable until
--     a workspace admin answers its escalation row — and the 'external-send'
--     category is rejected at planning time outright: agent output that should
--     reach a candidate always terminates at a DRAFT; the ONLY send path
--     remains the outreach approval authority (0006/0011/0013). This
--     migration mints NO new send path.
--   * dependsOn: hermes computes DAG-readiness and then dispatches everything
--     in parallel anyway. Here dispatch_ready_swarm_assignments only releases
--     an assignment when every dependency is 'done'.
--   * maxConcurrentTasks: hermes stores it, never checks it. Here dispatch
--     counts an agent's live assignments and respects the cap.
--   * checkpoint trust: hermes accepts any six-field message from any caller.
--     Here record_swarm_checkpoint demands the LIVE aria_jobs lease for the
--     assignment's job — a checkpoint is cryptographically tied to the worker
--     actually holding the work.
--   * scheduler: hermes's orchestrator loop only runs when a UI calls it.
--     Here the loop is a tick worker over durable rows (0038 conventions).
--   * notifications: hermes fire-and-forgets tmux send-keys. Here escalations
--     are durable rows answered only by an authenticated workspace admin.
--
-- Everything ships DARK and fail-closed: sourcing_loop_controls gains
-- swarm_enabled DEFAULT FALSE (folded into the fail-closed CHECK), roster
-- agents are seeded disabled, and the worker obeys the env kill switch.
--
-- Payload contract (0038): swarm rows carry ids, hashes, and operator-authored
-- task text ONLY — never candidate PII — so the orchestration spine stays
-- outside GDPR-erasure scope. Candidate data lives exclusively in the
-- candidate authority tables (0033/0035/0037).
--
-- Lockdown: every table RLS enabled + forced, every direct grant revoked,
-- postgres-only policy; every access path a SECURITY DEFINER RPC owned by
-- postgres (0038 pattern).

-- ---------------------------------------------------------------------------
-- sourcing_loop_controls: swarm_enabled stage flag (fail-closed evolution)
-- ---------------------------------------------------------------------------
alter table public.sourcing_loop_controls
  add column if not exists swarm_enabled boolean not null default false;

-- Recreate the fail-closed CHECK to include the new stage. The original
-- table-level CHECK from 0038 was unnamed (auto: sourcing_loop_controls_check).
alter table public.sourcing_loop_controls
  drop constraint if exists sourcing_loop_controls_check;
alter table public.sourcing_loop_controls
  drop constraint if exists sourcing_loop_controls_fail_closed;
alter table public.sourcing_loop_controls
  add constraint sourcing_loop_controls_fail_closed check (
    not (intake_enabled or sourcing_enabled or enrichment_enabled
         or sequences_enabled or swarm_enabled)
    or (not kill_switch and updated_by is not null)
  );

-- ---------------------------------------------------------------------------
-- aria_jobs: 12th kind 'swarm_assignment' (queue evolution)
-- ---------------------------------------------------------------------------
alter table public.aria_jobs
  drop constraint if exists aria_jobs_kind_check;
alter table public.aria_jobs
  add constraint aria_jobs_kind_check check (kind in (
    'email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create',
    'sourcing_batch', 'provider_poll', 'enrich_candidate', 'shortlist_build',
    'draft_generate', 'delivery_reconcile', 'outcome_feedback',
    'swarm_assignment'
  ));

-- ---------------------------------------------------------------------------
-- swarm_agents — the roster (hermes swarm.yaml, as enforced rows)
-- ---------------------------------------------------------------------------
create table if not exists public.swarm_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  role text not null check (char_length(role) between 1 and 120),
  specialty text check (specialty is null or char_length(specialty) <= 400),
  mission text check (mission is null or char_length(mission) <= 1000),
  capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities) = 'array' and pg_column_size(capabilities) <= 2048),
  preferred_task_types text[] not null default '{}'::text[]
    check (coalesce(array_length(preferred_task_types, 1), 0) <= 12),
  greenlight_categories text[] not null default '{}'::text[]
    check (greenlight_categories <@ array[
      'external-send', 'sequence-activate', 'budget-change',
      'erasure', 'destructive', 'credential-change'
    ]::text[]),
  max_concurrent integer not null default 1 check (max_concurrent between 1 and 8),
  review_required boolean not null default true,
  standing_mission text check (standing_mission is null or char_length(standing_mission) <= 2000),
  enabled boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint swarm_agents_workspace_slug_uniq unique (workspace_id, slug),
  foreign key (workspace_id, updated_by)
    references public.profiles (workspace_id, id) on delete restrict
);

create index if not exists swarm_agents_workspace_enabled_idx
  on public.swarm_agents (workspace_id) where enabled;

alter table public.swarm_agents enable row level security;
alter table public.swarm_agents force row level security;
revoke all on public.swarm_agents
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists swarm_agents_owner_access on public.swarm_agents;
create policy swarm_agents_owner_access on public.swarm_agents
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- swarm_missions — the SwarmBrief as a status-machine row
-- ---------------------------------------------------------------------------
create table if not exists public.swarm_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  goal text not null check (char_length(goal) between 1 and 2000),
  why_now text check (why_now is null or char_length(why_now) <= 1000),
  scope jsonb not null default '[]'::jsonb
    check (jsonb_typeof(scope) = 'array' and pg_column_size(scope) <= 4096),
  deliverables jsonb not null default '[]'::jsonb
    check (jsonb_typeof(deliverables) = 'array' and pg_column_size(deliverables) <= 4096),
  proof_contract jsonb not null default '[]'::jsonb
    check (jsonb_typeof(proof_contract) = 'array' and pg_column_size(proof_contract) <= 4096),
  constraints jsonb not null default '[]'::jsonb
    check (jsonb_typeof(constraints) = 'array' and pg_column_size(constraints) <= 4096),
  budget jsonb not null default '{}'::jsonb
    check (jsonb_typeof(budget) = 'object' and pg_column_size(budget) <= 1024),
  source_kind text check (source_kind is null or source_kind ~ '^[a-z][a-z0-9_]{0,40}$'),
  source_ref text check (source_ref is null or char_length(source_ref) between 1 and 160),
  requisition_id uuid references public.requisitions(id) on delete set null,
  status text not null default 'planning' check (status in (
    'planning', 'dispatching', 'executing', 'reviewing',
    'blocked', 'complete', 'cancelled'
  )),
  cancelled_reason text check (cancelled_reason is null or char_length(cancelled_reason) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_kind is null) = (source_ref is null)),
  foreign key (workspace_id, created_by)
    references public.profiles (workspace_id, id) on delete set null
);

create unique index if not exists swarm_missions_source_uniq
  on public.swarm_missions (workspace_id, source_kind, source_ref)
  where source_ref is not null;
create index if not exists swarm_missions_workspace_status_idx
  on public.swarm_missions (workspace_id, status, created_at desc);

alter table public.swarm_missions enable row level security;
alter table public.swarm_missions force row level security;
revoke all on public.swarm_missions
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists swarm_missions_owner_access on public.swarm_missions;
create policy swarm_missions_owner_access on public.swarm_missions
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- swarm_assignments — one bounded task for one agent, DAG- and gate-aware
-- ---------------------------------------------------------------------------
create table if not exists public.swarm_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null references public.swarm_missions(id) on delete cascade,
  agent_id uuid not null references public.swarm_agents(id) on delete restrict,
  kind text not null default 'task' check (kind in ('task', 'review')),
  reviews_assignment_id uuid references public.swarm_assignments(id) on delete cascade,
  task text not null check (char_length(task) between 1 and 32000),
  rationale text check (rationale is null or char_length(rationale) <= 2000),
  expected_output text check (expected_output is null or char_length(expected_output) <= 2000),
  depends_on uuid[] not null default '{}'::uuid[]
    check (coalesce(array_length(depends_on, 1), 0) <= 12),
  review_required boolean not null default true,
  -- 'external-send' is intentionally ABSENT: plan_swarm_assignments rejects it.
  greenlight_category text check (greenlight_category is null or greenlight_category in (
    'sequence-activate', 'budget-change', 'erasure', 'destructive', 'credential-change'
  )),
  greenlight_answered_by uuid,
  greenlight_answered_at timestamptz,
  status text not null default 'queued' check (status in (
    'queued', 'dispatched', 'executing', 'checkpointed', 'reviewing',
    'blocked', 'needs_input', 'done', 'cancelled'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  aria_job_id uuid references public.aria_jobs(id) on delete set null,
  last_checkpoint_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'review') = (reviews_assignment_id is not null)),
  check ((greenlight_answered_at is null) = (greenlight_answered_by is null)),
  foreign key (workspace_id, greenlight_answered_by)
    references public.profiles (workspace_id, id) on delete restrict
);

create index if not exists swarm_assignments_mission_idx
  on public.swarm_assignments (mission_id, created_at);
create index if not exists swarm_assignments_dispatchable_idx
  on public.swarm_assignments (workspace_id, created_at) where status = 'queued';
create index if not exists swarm_assignments_agent_live_idx
  on public.swarm_assignments (agent_id)
  where status in ('dispatched', 'executing');

alter table public.swarm_assignments enable row level security;
alter table public.swarm_assignments force row level security;
revoke all on public.swarm_assignments
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists swarm_assignments_owner_access on public.swarm_assignments;
create policy swarm_assignments_owner_access on public.swarm_assignments
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- swarm_checkpoints — append-only six-field proof ledger, lease-bound
-- ---------------------------------------------------------------------------
create table if not exists public.swarm_checkpoints (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null references public.swarm_missions(id) on delete cascade,
  assignment_id uuid not null references public.swarm_assignments(id) on delete cascade,
  agent_id uuid not null references public.swarm_agents(id) on delete restrict,
  state text not null check (state in (
    'in_progress', 'done', 'blocked', 'needs_input', 'handoff', 'needs_review'
  )),
  files_changed jsonb not null default '[]'::jsonb
    check (jsonb_typeof(files_changed) = 'array' and pg_column_size(files_changed) <= 4096),
  commands_run jsonb not null default '[]'::jsonb
    check (jsonb_typeof(commands_run) = 'array' and pg_column_size(commands_run) <= 4096),
  result text check (result is null or char_length(result) <= 8000),
  blocker text check (blocker is null or char_length(blocker) <= 2000),
  next_action text check (next_action is null or char_length(next_action) <= 2000),
  proof jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proof) = 'object' and pg_column_size(proof) <= 4096),
  -- provenance: which job lease authenticated this report
  job_id uuid not null,
  lease_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists swarm_checkpoints_assignment_idx
  on public.swarm_checkpoints (assignment_id, id desc);
create index if not exists swarm_checkpoints_workspace_idx
  on public.swarm_checkpoints (workspace_id, id desc);

alter table public.swarm_checkpoints enable row level security;
alter table public.swarm_checkpoints force row level security;
revoke all on public.swarm_checkpoints
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.swarm_checkpoints_id_seq
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists swarm_checkpoints_owner_access on public.swarm_checkpoints;
create policy swarm_checkpoints_owner_access on public.swarm_checkpoints
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_swarm_checkpoint_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'swarm checkpoints are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_swarm_checkpoint_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists swarm_checkpoints_append_only on public.swarm_checkpoints;
create trigger swarm_checkpoints_append_only
  before update or delete on public.swarm_checkpoints
  for each row execute function public.reject_swarm_checkpoint_mutation();

-- ---------------------------------------------------------------------------
-- swarm_escalations — the durable human inbox (only judgment-worthy items)
-- ---------------------------------------------------------------------------
create table if not exists public.swarm_escalations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid references public.swarm_missions(id) on delete cascade,
  assignment_id uuid references public.swarm_assignments(id) on delete cascade,
  kind text not null check (kind in ('needs_input', 'blocked', 'greenlight', 'review', 'stale')),
  summary text not null check (char_length(summary) between 1 and 500),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 4096),
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  answer text check (answer is null or char_length(answer) <= 4000),
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (answered_at is null)),
  check ((answered_at is null) = (answered_by is null)),
  foreign key (workspace_id, answered_by)
    references public.profiles (workspace_id, id) on delete restrict
);

-- one open escalation per (assignment, kind) — repeats fold into the open row
create unique index if not exists swarm_escalations_open_uniq
  on public.swarm_escalations (assignment_id, kind)
  where status = 'open' and assignment_id is not null;
create index if not exists swarm_escalations_workspace_open_idx
  on public.swarm_escalations (workspace_id, created_at desc) where status = 'open';

alter table public.swarm_escalations enable row level security;
alter table public.swarm_escalations force row level security;
revoke all on public.swarm_escalations
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists swarm_escalations_owner_access on public.swarm_escalations;
create policy swarm_escalations_owner_access on public.swarm_escalations
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- enqueue_aria_job — recreated. 'swarm_assignment' is legal at the TABLE level
-- but REJECTED here: swarm jobs may only be minted by the postgres-internal
-- dispatch/continuation paths that atomically bind an authorized assignment
-- state. A service component can therefore never conjure a swarm execution
-- that skipped the dispatch gates (Codex P0 finding, 2026-07-18).
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
-- set_sourcing_loop_controls — recreated with swarm_enabled (9 params).
-- The 8-param 0038 signature is dropped; no application caller exists yet
-- (verified: zero references in src/ and tests/ at migration time).
-- ---------------------------------------------------------------------------
drop function if exists public.set_sourcing_loop_controls(
  boolean, boolean, boolean, boolean, boolean, integer, integer, integer);

create or replace function public.set_sourcing_loop_controls(
  p_kill_switch boolean,
  p_intake_enabled boolean,
  p_sourcing_enabled boolean,
  p_enrichment_enabled boolean,
  p_sequences_enabled boolean,
  p_swarm_enabled boolean,
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
     or p_swarm_enabled is null
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

  -- The fail-closed CHECK remains the in-DB backstop.
  update public.sourcing_loop_controls
     set kill_switch = p_kill_switch,
         intake_enabled = p_intake_enabled,
         sourcing_enabled = p_sourcing_enabled,
         enrichment_enabled = p_enrichment_enabled,
         sequences_enabled = p_sequences_enabled,
         swarm_enabled = p_swarm_enabled,
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
      'sequences_enabled', p_sequences_enabled,
      'swarm_enabled', p_swarm_enabled
    )
  );

  return jsonb_build_object('status', 'updated');
end;
$$;

-- ---------------------------------------------------------------------------
-- swarm_recompute_mission_status — internal derivation (postgres-only)
-- ---------------------------------------------------------------------------
create or replace function public.swarm_recompute_mission_status(
  p_mission_id uuid
) returns void
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  mission_row public.swarm_missions%rowtype;
  total integer;
  n_done integer;
  n_cancelled integer;
  n_attention integer;
  n_reviewing integer;
  next_status text;
begin
  select * into mission_row
    from public.swarm_missions
   where id = p_mission_id
   for update;
  if not found or mission_row.status in ('cancelled', 'complete') then
    return;
  end if;

  select count(*),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'cancelled'),
         count(*) filter (where status in ('blocked', 'needs_input')),
         count(*) filter (where status in ('checkpointed', 'reviewing'))
    into total, n_done, n_cancelled, n_attention, n_reviewing
    from public.swarm_assignments
   where mission_id = p_mission_id;

  if total = 0 then
    next_status := 'planning';
  elsif n_attention > 0 then
    next_status := 'blocked';
  elsif n_done + n_cancelled = total then
    next_status := 'complete';
  elsif n_reviewing > 0 then
    next_status := 'reviewing';
  else
    next_status := 'executing';
  end if;

  if next_status <> mission_row.status then
    update public.swarm_missions
       set status = next_status, updated_at = now()
     where id = p_mission_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- seed_swarm_roster — authenticated ADMIN opt-in (never auto-seeded)
-- ---------------------------------------------------------------------------
create or replace function public.seed_swarm_roster()
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
  inserted_count integer := 0;
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

  with seeded as (
    insert into public.swarm_agents
      (workspace_id, slug, name, role, specialty, mission, capabilities,
       preferred_task_types, greenlight_categories, max_concurrent,
       review_required, standing_mission, updated_by)
    values
      (caller_workspace, 'aria-orchestrator', 'Orchestrator',
       'Swarm Orchestrator / Greenlight Gate',
       'mission routing, decomposition, checkpoint interpretation, escalation',
       'Decompose missions into safe, proof-bearing work and route it while preserving human greenlight control.',
       '["orchestration","routing","escalation"]'::jsonb,
       array['orchestration','planning','routing'], '{}'::text[], 1, false, null, auth.uid()),
      (caller_workspace, 'aria-scout', 'Scout',
       'Sourcing Scout',
       'candidate sourcing queries, market maps, source trails',
       'Find decision-grade candidate pools with explicit source trails and uncertainty.',
       '["sourcing","research"]'::jsonb,
       array['sourcing','research','analysis'], '{}'::text[], 2, true, null, auth.uid()),
      (caller_workspace, 'aria-enricher', 'Enricher',
       'Enrichment Analyst',
       'profile enrichment, verification, budget-aware provider use',
       'Enrich shortlisted profiles within budget authority, verified against provider receipts.',
       '["enrichment","verification"]'::jsonb,
       array['enrichment','verification'], array['budget-change'], 2, true, null, auth.uid()),
      (caller_workspace, 'aria-drafter', 'Drafter',
       'Outreach Drafter',
       'personalized outreach drafts; NEVER sends — drafts terminate at the approval gate',
       'Draft outreach that a human approves; the outreach approval authority remains the only send path.',
       '["drafting"]'::jsonb,
       array['drafting','messaging'], array['external-send'], 2, true, null, auth.uid()),
      (caller_workspace, 'aria-reviewer', 'Reviewer',
       'Independent Review / Merge Gate',
       'reviews other agents'' checkpoints; blocks unproven or unsafe work',
       'Independently review swarm output and block anything unproven before it counts as done.',
       '["review"]'::jsonb,
       array['review','verification'], '{}'::text[], 3, false, null, auth.uid()),
      (caller_workspace, 'aria-ops', 'Ops Watch',
       'Loop Health Watch',
       'loop health, dead jobs, heartbeat gaps, boring reliability',
       'Keep the sourcing loop observable and healthy with quiet, low-risk checks.',
       '["ops","monitoring"]'::jsonb,
       array['ops','health','monitoring'], '{}'::text[], 1, false,
       'Review loop_events and dead aria_jobs; summarize anomalies for the escalation inbox.', auth.uid())
    on conflict (workspace_id, slug) do nothing
    returning 1
  )
  select count(*) into inserted_count from seeded;

  if inserted_count > 0 then
    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
    values (
      caller_workspace, 'swarm.roster_seeded', 'swarm_agents', caller_workspace::text,
      jsonb_build_object('actor_id', auth.uid()::text, 'inserted', inserted_count)
    );
  end if;

  return jsonb_build_object('status', 'seeded', 'inserted', inserted_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_swarm_agent — authenticated ADMIN roster control (enable stays human)
-- ---------------------------------------------------------------------------
create or replace function public.set_swarm_agent(
  p_agent_id uuid,
  p_enabled boolean,
  p_max_concurrent integer,
  p_review_required boolean,
  p_standing_mission text
) returns jsonb
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

  if p_agent_id is null or p_enabled is null
     or p_max_concurrent is null or p_max_concurrent not between 1 and 8
     or p_review_required is null
     or (p_standing_mission is not null and char_length(p_standing_mission) > 2000) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  update public.swarm_agents
     set enabled = p_enabled,
         max_concurrent = p_max_concurrent,
         review_required = p_review_required,
         standing_mission = p_standing_mission,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_agent_id
     and workspace_id = caller_workspace;
  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    caller_workspace, 'swarm.agent_updated', 'swarm_agents', p_agent_id::text,
    jsonb_build_object('actor_id', auth.uid()::text, 'enabled', p_enabled)
  );

  return jsonb_build_object('status', 'updated');
end;
$$;

-- ---------------------------------------------------------------------------
-- create_swarm_mission — service-role, idempotent on (source_kind, source_ref)
-- ---------------------------------------------------------------------------
create or replace function public.create_swarm_mission(
  p_workspace_id uuid,
  p_title text,
  p_goal text,
  p_why_now text default null,
  p_scope jsonb default '[]'::jsonb,
  p_deliverables jsonb default '[]'::jsonb,
  p_proof_contract jsonb default '[]'::jsonb,
  p_constraints jsonb default '[]'::jsonb,
  p_budget jsonb default '{}'::jsonb,
  p_source_kind text default null,
  p_source_ref text default null,
  p_requisition_id uuid default null,
  p_created_by uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  existing_row public.swarm_missions%rowtype;
  new_row public.swarm_missions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_title is null or char_length(p_title) not between 1 and 200
     or p_goal is null or char_length(p_goal) not between 1 and 2000
     or (p_why_now is not null and char_length(p_why_now) > 1000)
     or p_scope is null or jsonb_typeof(p_scope) <> 'array' or pg_column_size(p_scope) > 4096
     or p_deliverables is null or jsonb_typeof(p_deliverables) <> 'array' or pg_column_size(p_deliverables) > 4096
     or p_proof_contract is null or jsonb_typeof(p_proof_contract) <> 'array' or pg_column_size(p_proof_contract) > 4096
     or p_constraints is null or jsonb_typeof(p_constraints) <> 'array' or pg_column_size(p_constraints) > 4096
     or p_budget is null or jsonb_typeof(p_budget) <> 'object' or pg_column_size(p_budget) > 1024
     or ((p_source_kind is null) <> (p_source_ref is null))
     or (p_source_kind is not null and p_source_kind !~ '^[a-z][a-z0-9_]{0,40}$')
     or (p_source_ref is not null and char_length(p_source_ref) not between 1 and 160) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if p_requisition_id is not null and not exists (
    select 1 from public.requisitions
     where id = p_requisition_id and workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if p_created_by is not null and not exists (
    select 1 from public.profiles
     where id = p_created_by and workspace_id = p_workspace_id
  ) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if p_source_ref is not null then
    select * into existing_row
      from public.swarm_missions
     where workspace_id = p_workspace_id
       and source_kind = p_source_kind
       and source_ref = p_source_ref
     for update;
    if found then
      if existing_row.goal <> p_goal then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'created', 'id', existing_row.id,
        'mission_status', existing_row.status, 'replay', true
      );
    end if;
  end if;

  begin
    insert into public.swarm_missions (
      workspace_id, title, goal, why_now, scope, deliverables, proof_contract,
      constraints, budget, source_kind, source_ref, requisition_id, created_by
    ) values (
      p_workspace_id, p_title, p_goal, p_why_now, p_scope, p_deliverables,
      p_proof_contract, p_constraints, p_budget, p_source_kind, p_source_ref,
      p_requisition_id, p_created_by
    )
    returning * into new_row;
  exception when unique_violation then
    select * into existing_row
      from public.swarm_missions
     where workspace_id = p_workspace_id
       and source_kind = p_source_kind
       and source_ref = p_source_ref
     for update;
    if found then
      if existing_row.goal <> p_goal then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'created', 'id', existing_row.id,
        'mission_status', existing_row.status, 'replay', true
      );
    end if;
    raise;
  end;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    p_workspace_id, 'swarm.mission_created', 'swarm_mission', new_row.id::text,
    jsonb_build_object('requisition_id', p_requisition_id::text,
                       'created_by', p_created_by::text)
  );

  return jsonb_build_object(
    'status', 'created', 'id', new_row.id,
    'mission_status', new_row.status, 'replay', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- plan_swarm_assignments — atomic decomposition write (≤12, DAG by ordinal)
--
-- depends_on entries are ORDINALS into the same batch (0-based), resolved to
-- assignment ids inside the transaction, so a decomposition can never point
-- outside its own mission. greenlight_category 'external-send' is REJECTED:
-- outreach work is planned as an ordinary drafting task and the outreach
-- approval authority stays the only send path.
-- ---------------------------------------------------------------------------
create or replace function public.plan_swarm_assignments(
  p_workspace_id uuid,
  p_mission_id uuid,
  p_assignments jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  mission_row public.swarm_missions%rowtype;
  item jsonb;
  item_count integer;
  idx integer := 0;
  dep_idx integer;
  dep_value jsonb;
  agent_row public.swarm_agents%rowtype;
  new_ids uuid[] := '{}'::uuid[];
  dep_ids uuid[];
  new_id uuid;
  category text;
  greenlight_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_mission_id is null
     or p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  item_count := jsonb_array_length(p_assignments);
  if item_count not between 1 and 12 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into mission_row
    from public.swarm_missions
   where id = p_mission_id and workspace_id = p_workspace_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if mission_row.status <> 'planning' then
    return jsonb_build_object('status', 'already_planned',
                              'mission_status', mission_row.status);
  end if;

  -- pass 1: validate + insert without dependencies
  for item in select value from jsonb_array_elements(p_assignments)
  loop
    if jsonb_typeof(item) <> 'object'
       or item->>'agent_slug' is null
       or item->>'task' is null
       or char_length(item->>'task') not between 1 and 32000
       or (item->>'rationale' is not null and char_length(item->>'rationale') > 2000)
       or (item->>'expected_output' is not null and char_length(item->>'expected_output') > 2000) then
      raise exception 'invalid assignment item' using errcode = '22023';
    end if;

    category := item->>'greenlight_category';
    if category is not null then
      if category = 'external-send' then
        raise exception 'external-send is never a swarm dispatch: plan a draft task; sends go only through the outreach approval authority'
          using errcode = '22023';
      end if;
      if category not in ('sequence-activate', 'budget-change', 'erasure',
                          'destructive', 'credential-change') then
        raise exception 'invalid greenlight category' using errcode = '22023';
      end if;
    end if;

    select * into agent_row
      from public.swarm_agents
     where workspace_id = p_workspace_id
       and slug = item->>'agent_slug';
    if not found then
      raise exception 'unknown agent slug %', item->>'agent_slug' using errcode = '22023';
    end if;

    insert into public.swarm_assignments (
      workspace_id, mission_id, agent_id, task, rationale, expected_output,
      review_required, greenlight_category
    ) values (
      p_workspace_id, p_mission_id, agent_row.id,
      item->>'task', item->>'rationale', item->>'expected_output',
      coalesce((item->>'review_required')::boolean, agent_row.review_required),
      category
    )
    returning id into new_id;
    new_ids := new_ids || new_id;

    if category is not null then
      greenlight_count := greenlight_count + 1;
      insert into public.swarm_escalations (
        workspace_id, mission_id, assignment_id, kind, summary, detail
      ) values (
        p_workspace_id, p_mission_id, new_id, 'greenlight',
        left('Greenlight required (' || category || '): ' || (item->>'task'), 500),
        jsonb_build_object('category', category)
      )
      on conflict do nothing;
    end if;
  end loop;

  -- pass 2: resolve ordinal dependencies
  idx := 0;
  for item in select value from jsonb_array_elements(p_assignments)
  loop
    idx := idx + 1;
    dep_ids := '{}'::uuid[];
    if item->'depends_on' is not null then
      if jsonb_typeof(item->'depends_on') <> 'array'
         or jsonb_array_length(item->'depends_on') > 12 then
        raise exception 'invalid depends_on' using errcode = '22023';
      end if;
      for dep_value in select value from jsonb_array_elements(item->'depends_on')
      loop
        if jsonb_typeof(dep_value) <> 'number' then
          raise exception 'invalid depends_on' using errcode = '22023';
        end if;
        dep_idx := (dep_value#>>'{}')::integer;
        -- Forward-only DAG: a dependency must reference a STRICTLY EARLIER
        -- ordinal, which makes cycles unrepresentable (Codex P1-7).
        if dep_idx is null or dep_idx < 0 or dep_idx >= idx - 1 then
          raise exception 'invalid depends_on ordinal (must reference an earlier item)' using errcode = '22023';
        end if;
        dep_ids := dep_ids || new_ids[dep_idx + 1];
      end loop;
      update public.swarm_assignments
         set depends_on = dep_ids, updated_at = now()
       where id = new_ids[idx];
    end if;
  end loop;

  update public.swarm_missions
     set status = 'dispatching', updated_at = now()
   where id = p_mission_id;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    p_workspace_id, 'swarm.mission_planned', 'swarm_mission', p_mission_id::text,
    jsonb_build_object('assignments', item_count, 'greenlight_gated', greenlight_count)
  );

  return jsonb_build_object(
    'status', 'planned', 'assignments', item_count,
    'greenlight_gated', greenlight_count,
    'assignment_ids', to_jsonb(new_ids)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- dispatch_ready_swarm_assignments — THE mechanical gate hermes never built.
-- Releases queued assignments only when, atomically:
--   workspace: kill_switch off AND swarm_enabled on (fail-closed switchboard)
--   agent:     enabled AND live assignments < max_concurrent
--   DAG:       every depends_on assignment is 'done'
--   greenlight: category null OR answered by a workspace admin
-- Each release enqueues one aria_jobs 'swarm_assignment' row (ids only).
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_ready_swarm_assignments(
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  assignment_row public.swarm_assignments%rowtype;
  agent_row public.swarm_agents%rowtype;
  new_job_id uuid;
  job_payload jsonb;
  dispatched integer := 0;
  skipped integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  for assignment_row in
    select assignment.*
      from public.swarm_assignments assignment
      join public.sourcing_loop_controls controls
        on controls.workspace_id = assignment.workspace_id
      join public.swarm_agents agent
        on agent.id = assignment.agent_id
     where assignment.status = 'queued'
       and controls.kill_switch = false
       and controls.swarm_enabled = true
       and agent.enabled = true
       and (assignment.greenlight_category is null
            or assignment.greenlight_answered_at is not null)
     order by assignment.created_at asc
     limit p_limit
       for update of assignment skip locked
  loop
    -- DAG gate: every dependency must be done.
    if exists (
      select 1
        from unnest(assignment_row.depends_on) as dep_id
        left join public.swarm_assignments dep on dep.id = dep_id
       where dep.id is null or dep.status <> 'done'
    ) then
      skipped := skipped + 1;
      continue;
    end if;

    -- Concurrency cap under a per-agent row lock: concurrent dispatchers
    -- serialize on the agent before counting, so two of them can never both
    -- observe a free slot for a max_concurrent=1 agent (Codex P1-8).
    select * into agent_row
      from public.swarm_agents
     where id = assignment_row.agent_id
     for update;
    if not agent_row.enabled then
      skipped := skipped + 1;
      continue;
    end if;
    if (
      select count(*)
        from public.swarm_assignments live
       where live.agent_id = assignment_row.agent_id
         and live.status in ('dispatched', 'executing')
    ) >= agent_row.max_concurrent then
      skipped := skipped + 1;
      continue;
    end if;

    -- Mint the job INTERNALLY: 'swarm_assignment' is rejected by the public
    -- enqueue RPC, so this insert — bound to the authorized assignment state
    -- inside this transaction — is the only way a swarm job exists (P0 fix).
    job_payload := jsonb_build_object(
      'assignment_id', assignment_row.id::text,
      'mission_id', assignment_row.mission_id::text,
      'attempt', assignment_row.attempt_count
    );
    insert into public.aria_jobs (
      workspace_id, kind, idempotency_key, payload, payload_sha256,
      next_run_at, priority
    ) values (
      assignment_row.workspace_id, 'swarm_assignment',
      'swarm:' || assignment_row.id::text || ':' || assignment_row.attempt_count::text,
      job_payload,
      encode(sha256(convert_to(job_payload::text, 'UTF8')), 'hex'),
      now(), 100
    )
    on conflict on constraint aria_jobs_workspace_kind_idem_uniq do nothing
    returning id into new_job_id;
    if new_job_id is null then
      -- This attempt was already minted (crash replay); leave it be.
      skipped := skipped + 1;
      continue;
    end if;

    update public.swarm_assignments
       set status = 'dispatched',
           attempt_count = assignment_row.attempt_count + 1,
           aria_job_id = new_job_id,
           updated_at = now()
     where id = assignment_row.id;

    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      assignment_row.workspace_id, 'swarm.assignment_dispatched', 'swarm_assignment',
      assignment_row.id::text, new_job_id,
      jsonb_build_object('mission_id', assignment_row.mission_id::text,
                         'attempt', assignment_row.attempt_count + 1)
    );

    perform public.swarm_recompute_mission_status(assignment_row.mission_id);
    dispatched := dispatched + 1;
  end loop;

  return jsonb_build_object('status', 'ok', 'dispatched', dispatched, 'skipped', skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_swarm_checkpoint — lease-authenticated proof ingestion.
-- The reporter must hold the LIVE lease on the assignment's swarm_assignment
-- job; anything else is rejected. This is the anti-spoofing upgrade over
-- hermes's trust-any-message ingestion.
-- ---------------------------------------------------------------------------
create or replace function public.record_swarm_checkpoint(
  p_job_id uuid,
  p_lease_id uuid,
  p_state text,
  p_files_changed jsonb default '[]'::jsonb,
  p_commands_run jsonb default '[]'::jsonb,
  p_result text default null,
  p_blocker text default null,
  p_next_action text default null,
  p_proof jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  assignment_row public.swarm_assignments%rowtype;
  reviewed_row public.swarm_assignments%rowtype;
  verdict text;
  next_assignment_status text;
  continuation_payload jsonb;
  continued boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null
     or p_state is null or p_state not in (
       'in_progress', 'done', 'blocked', 'needs_input', 'handoff', 'needs_review'
     )
     or p_files_changed is null or jsonb_typeof(p_files_changed) <> 'array'
     or pg_column_size(p_files_changed) > 4096
     or p_commands_run is null or jsonb_typeof(p_commands_run) <> 'array'
     or pg_column_size(p_commands_run) > 4096
     or (p_result is not null and char_length(p_result) > 8000)
     or (p_blocker is not null and char_length(p_blocker) > 2000)
     or (p_next_action is not null and char_length(p_next_action) > 2000)
     or p_proof is null or jsonb_typeof(p_proof) <> 'object'
     or pg_column_size(p_proof) > 4096 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Lease authentication: live, UNEXPIRED lease on a swarm_assignment job
  -- (Codex P1-4: expiry checked here, not just by the reaper).
  select * into job_row
    from public.aria_jobs
   where id = p_job_id
     and kind = 'swarm_assignment'
     and status = 'leased'
     and lease_id = p_lease_id
     and lease_expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  select * into assignment_row
    from public.swarm_assignments
   where id = (job_row.payload->>'assignment_id')::uuid
     and workspace_id = job_row.workspace_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- CAS transition table (Codex P1-9): a lease may only report progress for
  -- an assignment that is actually mid-execution. checkpointed/reviewing/
  -- blocked/needs_input/queued states belong to the orchestrator and the
  -- human inbox — a stale or replayed lease can never regress them.
  if assignment_row.status not in ('dispatched', 'executing') then
    return jsonb_build_object('status', 'terminal',
                              'assignment_status', assignment_row.status);
  end if;

  insert into public.swarm_checkpoints (
    workspace_id, mission_id, assignment_id, agent_id, state,
    files_changed, commands_run, result, blocker, next_action, proof,
    job_id, lease_id
  ) values (
    assignment_row.workspace_id, assignment_row.mission_id, assignment_row.id,
    assignment_row.agent_id, p_state, p_files_changed, p_commands_run,
    p_result, p_blocker, p_next_action, p_proof, p_job_id, p_lease_id
  );

  next_assignment_status := case p_state
    -- in_progress AND handoff keep the assignment executable: the
    -- continuation minted below is what carries the work forward
    -- (Codex P1-5: handoff used to strand the assignment in a state the
    -- envelope treats as terminal).
    when 'in_progress' then 'executing'
    when 'handoff' then 'executing'
    when 'needs_review' then 'checkpointed'
    when 'blocked' then 'blocked'
    when 'needs_input' then 'needs_input'
    when 'done' then
      case
        when assignment_row.kind = 'review' then 'done'
        when assignment_row.review_required then 'checkpointed'
        else 'done'
      end
  end;

  update public.swarm_assignments
     set status = next_assignment_status,
         review_required = case when p_state = 'needs_review' then true
                                else review_required end,
         last_checkpoint_at = now(),
         completed_at = case when next_assignment_status = 'done' then now()
                             else completed_at end,
         updated_at = now()
   where id = assignment_row.id;

  if p_state = 'blocked' then
    insert into public.swarm_escalations (
      workspace_id, mission_id, assignment_id, kind, summary, detail
    ) values (
      assignment_row.workspace_id, assignment_row.mission_id, assignment_row.id,
      'blocked', left(coalesce(p_blocker, 'blocked without stated blocker'), 500),
      jsonb_build_object('next_action', p_next_action)
    )
    on conflict do nothing;
  elsif p_state = 'needs_input' then
    insert into public.swarm_escalations (
      workspace_id, mission_id, assignment_id, kind, summary, detail
    ) values (
      assignment_row.workspace_id, assignment_row.mission_id, assignment_row.id,
      'needs_input', left(coalesce(p_blocker, p_next_action, 'agent needs input'), 500),
      jsonb_build_object('next_action', p_next_action)
    )
    on conflict do nothing;
  end if;

  -- Review verdict resolution: a reviewer's DONE checkpoint carries
  -- proof.verdict = approved | changes_requested for the reviewed assignment.
  if assignment_row.kind = 'review' and p_state = 'done' then
    verdict := p_proof->>'verdict';
    select * into reviewed_row
      from public.swarm_assignments
     where id = assignment_row.reviews_assignment_id
     for update;
    if found and reviewed_row.status not in ('done', 'cancelled') then
      if verdict = 'approved' then
        update public.swarm_assignments
           set status = 'done', completed_at = now(), updated_at = now()
         where id = reviewed_row.id;
      else
        update public.swarm_assignments
           set status = 'blocked', updated_at = now()
         where id = reviewed_row.id;
        insert into public.swarm_escalations (
          workspace_id, mission_id, assignment_id, kind, summary, detail
        ) values (
          reviewed_row.workspace_id, reviewed_row.mission_id, reviewed_row.id,
          'review',
          left('Review rejected: ' || coalesce(p_result, 'no reviewer summary'), 500),
          jsonb_build_object('verdict', coalesce(verdict, 'missing'),
                             'reviewer_assignment_id', assignment_row.id::text)
        )
        on conflict do nothing;
      end if;
    end if;
  end if;

  -- Consume the reporting job IN THIS TRANSACTION (Codex P1-6): checkpoint,
  -- job success, and any continuation commit or roll back together. The
  -- worker no longer calls complete_aria_job for swarm jobs.
  update public.aria_jobs
     set status = 'succeeded',
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where id = p_job_id;

  -- Continuation for in_progress/handoff, minted internally and ONLY while
  -- the workspace switchboard still allows swarm work (Codex P1-2): with the
  -- kill switch engaged or swarm disabled no new execution is created — the
  -- assignment stays 'executing' with no live job, and the stale sweep will
  -- requeue it into the (closed) dispatch gate.
  if p_state in ('in_progress', 'handoff') then
    if exists (
      select 1 from public.sourcing_loop_controls controls
       where controls.workspace_id = assignment_row.workspace_id
         and controls.kill_switch = false
         and controls.swarm_enabled = true
    ) then
      continuation_payload := jsonb_build_object(
        'assignment_id', assignment_row.id::text,
        'mission_id', assignment_row.mission_id::text,
        'attempt', assignment_row.attempt_count
      );
      insert into public.aria_jobs (
        workspace_id, kind, idempotency_key, payload, payload_sha256,
        next_run_at, priority
      ) values (
        assignment_row.workspace_id, 'swarm_assignment',
        'swarm:' || assignment_row.id::text || ':job:' || p_job_id::text || ':next',
        continuation_payload,
        encode(sha256(convert_to(continuation_payload::text, 'UTF8')), 'hex'),
        now(), 100
      )
      on conflict on constraint aria_jobs_workspace_kind_idem_uniq do nothing;
      continued := true;
    end if;
  end if;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
  values (
    assignment_row.workspace_id, 'swarm.checkpoint', 'swarm_assignment',
    assignment_row.id::text, p_job_id,
    jsonb_build_object('state', p_state, 'mission_id', assignment_row.mission_id::text,
                       'continued', continued)
  );

  perform public.swarm_recompute_mission_status(assignment_row.mission_id);

  return jsonb_build_object(
    'status', 'recorded',
    'assignment_status', next_assignment_status,
    'continued', continued
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- route_swarm_reviews — the review-gate lane, mechanically wired (hermes
-- imported its reviewer-completion helper and never called it).
-- ---------------------------------------------------------------------------
create or replace function public.route_swarm_reviews(
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  assignment_row public.swarm_assignments%rowtype;
  reviewer_id uuid;
  routed integer := 0;
  escalated integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  for assignment_row in
    select assignment.*
      from public.swarm_assignments assignment
     where assignment.kind = 'task'
       and assignment.status = 'checkpointed'
       and assignment.review_required = true
       -- Only an ACTIVE review blocks routing: a completed (rejecting) review
       -- must not prevent the versioned re-review after rework (Codex P1-10).
       and not exists (
         select 1 from public.swarm_assignments review
          where review.reviews_assignment_id = assignment.id
            and review.status not in ('cancelled', 'done')
       )
     order by assignment.updated_at asc
     limit p_limit
       for update of assignment skip locked
  loop
    select agent.id into reviewer_id
      from public.swarm_agents agent
     where agent.workspace_id = assignment_row.workspace_id
       and agent.enabled = true
       and agent.capabilities @> '["review"]'::jsonb
       and agent.id <> assignment_row.agent_id
     order by agent.slug
     limit 1;

    if reviewer_id is null then
      insert into public.swarm_escalations (
        workspace_id, mission_id, assignment_id, kind, summary, detail
      ) values (
        assignment_row.workspace_id, assignment_row.mission_id, assignment_row.id,
        'review', 'No enabled reviewer agent available for a required review.',
        jsonb_build_object('agent_id', assignment_row.agent_id::text)
      )
      on conflict do nothing;
      escalated := escalated + 1;
      continue;
    end if;

    insert into public.swarm_assignments (
      workspace_id, mission_id, agent_id, kind, reviews_assignment_id, task,
      rationale, review_required
    ) values (
      assignment_row.workspace_id, assignment_row.mission_id, reviewer_id,
      'review', assignment_row.id,
      left('Review assignment ' || assignment_row.id::text
           || ' against its latest checkpoint. Verify the claimed proof; do not edit files. '
           || 'Finish with a done checkpoint whose proof.verdict is approved or changes_requested.',
           32000),
      'mechanical review gate', false
    );

    update public.swarm_assignments
       set status = 'reviewing', updated_at = now()
     where id = assignment_row.id;

    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
    values (
      assignment_row.workspace_id, 'swarm.review_routed', 'swarm_assignment',
      assignment_row.id::text,
      jsonb_build_object('reviewer_agent_id', reviewer_id::text)
    );
    routed := routed + 1;
  end loop;

  return jsonb_build_object('status', 'ok', 'routed', routed, 'escalated', escalated);
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_stale_swarm_assignments — bounded auto-repair: requeue up to 3 dispatch
-- attempts, then block + escalate. Never destructive, never silent.
-- ---------------------------------------------------------------------------
create or replace function public.mark_stale_swarm_assignments(
  p_stale_minutes integer,
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  assignment_row public.swarm_assignments%rowtype;
  requeued integer := 0;
  blocked integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_stale_minutes is null or p_stale_minutes not between 1 and 240
     or p_limit is null or p_limit not between 1 and 50 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  for assignment_row in
    select assignment.*
      from public.swarm_assignments assignment
     where assignment.status in ('dispatched', 'executing')
       and assignment.updated_at < now() - make_interval(mins => p_stale_minutes)
       and not exists (
         select 1 from public.aria_jobs job
          where job.workspace_id = assignment.workspace_id
            and job.kind = 'swarm_assignment'
            and job.status in ('queued', 'leased')
            and job.payload->>'assignment_id' = assignment.id::text
       )
     order by assignment.updated_at asc
     limit p_limit
       for update of assignment skip locked
  loop
    if assignment_row.attempt_count < 3 then
      update public.swarm_assignments
         set status = 'queued', updated_at = now()
       where id = assignment_row.id;
      requeued := requeued + 1;
      insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
      values (
        assignment_row.workspace_id, 'swarm.assignment_requeued', 'swarm_assignment',
        assignment_row.id::text,
        jsonb_build_object('attempt', assignment_row.attempt_count)
      );
    else
      update public.swarm_assignments
         set status = 'blocked', updated_at = now()
       where id = assignment_row.id;
      insert into public.swarm_escalations (
        workspace_id, mission_id, assignment_id, kind, summary, detail
      ) values (
        assignment_row.workspace_id, assignment_row.mission_id, assignment_row.id,
        'stale',
        'Assignment went stale after ' || assignment_row.attempt_count::text
          || ' dispatch attempts with no live job.',
        jsonb_build_object('attempts', assignment_row.attempt_count)
      )
      on conflict do nothing;
      blocked := blocked + 1;
      perform public.swarm_recompute_mission_status(assignment_row.mission_id);
    end if;
  end loop;

  return jsonb_build_object('status', 'ok', 'requeued', requeued, 'blocked', blocked);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_swarm_runtime — service read for the orchestrator tick + admin console
-- ---------------------------------------------------------------------------
create or replace function public.get_swarm_runtime(
  p_workspace_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  agents jsonb;
  missions jsonb;
  open_escalations integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', agent.id,
           'slug', agent.slug,
           'name', agent.name,
           'role', agent.role,
           'enabled', agent.enabled,
           'max_concurrent', agent.max_concurrent,
           'live', (
             select count(*) from public.swarm_assignments live
              where live.agent_id = agent.id
                and live.status in ('dispatched', 'executing')
           ),
           'last_checkpoint_at', (
             select max(checkpoint.created_at) from public.swarm_checkpoints checkpoint
              where checkpoint.agent_id = agent.id
           )
         ) order by agent.slug), '[]'::jsonb)
    into agents
    from public.swarm_agents agent
   where agent.workspace_id = p_workspace_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', mission.id,
           'title', mission.title,
           'status', mission.status,
           'assignments', (
             select count(*) from public.swarm_assignments assignment
              where assignment.mission_id = mission.id
           )
         ) order by mission.created_at desc), '[]'::jsonb)
    into missions
    from (
      select * from public.swarm_missions
       where workspace_id = p_workspace_id
         and status not in ('complete', 'cancelled')
       order by created_at desc
       limit 50
    ) mission;

  select count(*) into open_escalations
    from public.swarm_escalations
   where workspace_id = p_workspace_id and status = 'open';

  return jsonb_build_object(
    'status', 'ok',
    'agents', agents,
    'missions', missions,
    'open_escalations', open_escalations
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- answer_swarm_escalation — authenticated ADMIN. Greenlight answers stamp the
-- assignment dispatchable; needs_input/blocked/stale answers requeue it with
-- the operator's answer available to the next dispatch envelope.
-- ---------------------------------------------------------------------------
create or replace function public.answer_swarm_escalation(
  p_escalation_id uuid,
  p_action text,
  p_answer text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
  escalation_row public.swarm_escalations%rowtype;
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

  if p_escalation_id is null
     or p_action is null or p_action not in ('answer', 'approve', 'reject', 'dismiss')
     or (p_answer is not null and char_length(p_answer) > 4000)
     or (p_action in ('answer', 'reject') and (p_answer is null or char_length(p_answer) < 1)) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into escalation_row
    from public.swarm_escalations
   where id = p_escalation_id
     and workspace_id = caller_workspace
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if escalation_row.status <> 'open' then
    return jsonb_build_object('status', 'already_closed');
  end if;

  -- Greenlight is a decision, not a chat (Codex P1-12): it accepts ONLY
  -- approve or reject, and only approve stamps the dispatch gate. Every
  -- other escalation kind uses answer/dismiss and never touches the gate.
  if escalation_row.kind = 'greenlight' and p_action not in ('approve', 'reject') then
    return jsonb_build_object('status', 'invalid_request',
                              'hint', 'greenlight requires approve or reject');
  end if;
  if escalation_row.kind <> 'greenlight' and p_action in ('approve', 'reject') then
    return jsonb_build_object('status', 'invalid_request',
                              'hint', 'approve/reject apply only to greenlight');
  end if;

  update public.swarm_escalations
     set status = case when p_action = 'dismiss' then 'dismissed' else 'answered' end,
         answer = case when p_action = 'approve' then coalesce(p_answer, 'approved')
                       else p_answer end,
         answered_by = auth.uid(),
         answered_at = now()
   where id = p_escalation_id;

  if escalation_row.assignment_id is not null then
    if p_action = 'approve' then
      update public.swarm_assignments
         set greenlight_answered_by = auth.uid(),
             greenlight_answered_at = now(),
             updated_at = now()
       where id = escalation_row.assignment_id
         and workspace_id = caller_workspace
         and greenlight_category is not null;
    elsif p_action = 'reject' then
      update public.swarm_assignments
         set status = 'cancelled', updated_at = now()
       where id = escalation_row.assignment_id
         and workspace_id = caller_workspace
         and status not in ('done', 'cancelled');
      perform public.swarm_recompute_mission_status(
        (select mission_id from public.swarm_assignments
          where id = escalation_row.assignment_id));
    elsif p_action = 'answer'
          and escalation_row.kind in ('needs_input', 'blocked', 'stale', 'review') then
      -- An answered review escalation requeues the reworked assignment so the
      -- versioned re-review can route (Codex P1-10).
      update public.swarm_assignments
         set status = 'queued', updated_at = now()
       where id = escalation_row.assignment_id
         and workspace_id = caller_workspace
         and status in ('needs_input', 'blocked');
    end if;
  end if;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    caller_workspace, 'swarm.escalation_' ||
      case when p_action = 'dismiss' then 'dismissed' else 'answered' end,
    'swarm_escalation', p_escalation_id::text,
    jsonb_build_object('actor_id', auth.uid()::text, 'kind', escalation_row.kind,
                       'action', p_action)
  );

  return jsonb_build_object('status', 'ok', 'action', p_action);
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_swarm_mission — authenticated ADMIN, audited
-- ---------------------------------------------------------------------------
create or replace function public.cancel_swarm_mission(
  p_mission_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
  mission_row public.swarm_missions%rowtype;
  cancelled_assignments integer;
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

  if p_mission_id is null
     or p_reason is null or char_length(p_reason) not between 1 and 500 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into mission_row
    from public.swarm_missions
   where id = p_mission_id
     and workspace_id = caller_workspace
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if mission_row.status in ('complete', 'cancelled') then
    return jsonb_build_object('status', 'already_closed');
  end if;

  update public.swarm_assignments
     set status = 'cancelled', updated_at = now()
   where mission_id = p_mission_id
     and status not in ('done', 'cancelled');
  get diagnostics cancelled_assignments = row_count;

  update public.swarm_missions
     set status = 'cancelled',
         cancelled_reason = p_reason,
         updated_at = now()
   where id = p_mission_id;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, payload)
  values (
    caller_workspace, 'swarm.mission_cancelled', 'swarm_mission', p_mission_id::text,
    jsonb_build_object('actor_id', auth.uid()::text,
                       'cancelled_assignments', cancelled_assignments)
  );

  return jsonb_build_object('status', 'cancelled',
                            'cancelled_assignments', cancelled_assignments);
end;
$$;

-- ---------------------------------------------------------------------------
-- list_swarm_missions / list_swarm_escalations — authenticated member reads
-- ---------------------------------------------------------------------------
create or replace function public.list_swarm_missions(
  p_limit integer default 50
) returns setof public.swarm_missions
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
  select * from public.swarm_missions
   where workspace_id = caller_workspace
   order by created_at desc
   limit safe_limit;
end;
$$;

create or replace function public.list_swarm_escalations(
  p_status text default 'open',
  p_limit integer default 50
) returns setof public.swarm_escalations
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
  if p_status is null or p_status not in ('open', 'answered', 'dismissed') then
    return;
  end if;

  return query
  select * from public.swarm_escalations
   where workspace_id = caller_workspace
     and status = p_status
   order by created_at desc
   limit safe_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_swarm_assignment_envelope — service read used by the worker to build
-- the dispatch envelope for a claimed job (identity + task + answered
-- escalations + latest checkpoint next_action; ids and operator text only).
-- ---------------------------------------------------------------------------
create or replace function public.get_swarm_assignment_envelope(
  p_job_id uuid,
  p_lease_id uuid
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  assignment_row public.swarm_assignments%rowtype;
  agent_row public.swarm_agents%rowtype;
  mission_row public.swarm_missions%rowtype;
  latest_next_action text;
  answers jsonb;
  reviewed jsonb;
  dependency_context jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  select * into job_row
    from public.aria_jobs
   where id = p_job_id
     and kind = 'swarm_assignment'
     and status = 'leased'
     and lease_id = p_lease_id
     and lease_expires_at > now();
  if not found then
    return jsonb_build_object('status', 'lease_invalid');
  end if;

  -- Workspace switchboard recheck (Codex P1-2): queued work stops executing
  -- the moment an admin kills the workspace, not just at dispatch time.
  if not exists (
    select 1 from public.sourcing_loop_controls controls
     where controls.workspace_id = job_row.workspace_id
       and controls.kill_switch = false
       and controls.swarm_enabled = true
  ) then
    return jsonb_build_object('status', 'suspended');
  end if;

  select * into assignment_row
    from public.swarm_assignments
   where id = (job_row.payload->>'assignment_id')::uuid
     and workspace_id = job_row.workspace_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Only actually-dispatched work is executable: a directly-minted job for a
  -- queued assignment must never yield an envelope (part of the P0 fix).
  if assignment_row.status not in ('dispatched', 'executing') then
    return jsonb_build_object('status', 'terminal',
                              'assignment_status', assignment_row.status);
  end if;

  select * into agent_row from public.swarm_agents where id = assignment_row.agent_id;
  select * into mission_row from public.swarm_missions where id = assignment_row.mission_id;

  select checkpoint.next_action into latest_next_action
    from public.swarm_checkpoints checkpoint
   where checkpoint.assignment_id = assignment_row.id
   order by checkpoint.id desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', escalation.kind, 'answer', escalation.answer
         ) order by escalation.answered_at desc), '[]'::jsonb)
    into answers
    from public.swarm_escalations escalation
   where escalation.assignment_id = assignment_row.id
     and escalation.status = 'answered';

  -- A review envelope carries the reviewed assignment's task and its latest
  -- checkpoint verbatim — a reviewer must never be asked to verify work it
  -- cannot see.
  if assignment_row.kind = 'review' and assignment_row.reviews_assignment_id is not null then
    select jsonb_build_object(
             'assignment_id', target.id,
             'task', target.task,
             'expected_output', target.expected_output,
             'checkpoint', (
               select jsonb_build_object(
                        'state', checkpoint.state,
                        'result', checkpoint.result,
                        'files_changed', checkpoint.files_changed,
                        'commands_run', checkpoint.commands_run,
                        'proof', checkpoint.proof,
                        'next_action', checkpoint.next_action
                      )
                 from public.swarm_checkpoints checkpoint
                where checkpoint.assignment_id = target.id
                order by checkpoint.id desc
                limit 1
             ),
             -- what the reviewed work was BUILT ON, so the reviewer can verify
             -- against upstream output instead of asking the human for it
             'dependencies', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'assignment_id', dep.id,
                        'task', dep.task,
                        'checkpoint', (
                          select jsonb_build_object(
                                   'state', checkpoint.state,
                                   'result', checkpoint.result,
                                   'proof', checkpoint.proof
                                 )
                            from public.swarm_checkpoints checkpoint
                           where checkpoint.assignment_id = dep.id
                           order by checkpoint.id desc
                           limit 1
                        )
                      )), '[]'::jsonb)
                 from public.swarm_assignments dep
                where dep.id = any(target.depends_on)
             )
           )
      into reviewed
      from public.swarm_assignments target
     where target.id = assignment_row.reviews_assignment_id;
  end if;

  -- A task that depends on other assignments receives their latest DONE
  -- checkpoints verbatim — downstream work must never guess upstream output.
  if assignment_row.kind = 'task'
     and coalesce(array_length(assignment_row.depends_on, 1), 0) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'assignment_id', dep.id,
             'task', dep.task,
             'checkpoint', (
               select jsonb_build_object(
                        'state', checkpoint.state,
                        'result', checkpoint.result,
                        'proof', checkpoint.proof
                      )
                 from public.swarm_checkpoints checkpoint
                where checkpoint.assignment_id = dep.id
                order by checkpoint.id desc
                limit 1
             )
           )), '[]'::jsonb)
      into dependency_context
      from public.swarm_assignments dep
     where dep.id = any(assignment_row.depends_on);
  end if;

  -- Mark executing: the envelope handoff is the execution start.
  update public.swarm_assignments
     set status = 'executing', updated_at = now()
   where id = assignment_row.id
     and status = 'dispatched';

  return jsonb_build_object(
    'status', 'ok',
    'assignment_id', assignment_row.id,
    'mission_id', assignment_row.mission_id,
    'kind', assignment_row.kind,
    'task', assignment_row.task,
    'rationale', assignment_row.rationale,
    'expected_output', assignment_row.expected_output,
    'agent', jsonb_build_object(
      'slug', agent_row.slug, 'name', agent_row.name, 'role', agent_row.role,
      'specialty', agent_row.specialty, 'mission', agent_row.mission,
      'capabilities', agent_row.capabilities
    ),
    'mission', jsonb_build_object(
      'title', mission_row.title, 'goal', mission_row.goal,
      'proof_contract', mission_row.proof_contract,
      'constraints', mission_row.constraints
    ),
    'reviewed', reviewed,
    'dependencies', dependency_context,
    'continuation', jsonb_build_object(
      'attempt', assignment_row.attempt_count,
      'last_next_action', latest_next_action,
      'operator_answers', answers
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership + privileges (revoke everything, then grant exactly one role)
-- ---------------------------------------------------------------------------
alter function public.reject_swarm_checkpoint_mutation() owner to postgres;
alter function public.swarm_recompute_mission_status(uuid) owner to postgres;
alter function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) owner to postgres;
alter function public.set_sourcing_loop_controls(boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, integer) owner to postgres;
alter function public.seed_swarm_roster() owner to postgres;
alter function public.set_swarm_agent(uuid, boolean, integer, boolean, text) owner to postgres;
alter function public.create_swarm_mission(uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid, uuid) owner to postgres;
alter function public.plan_swarm_assignments(uuid, uuid, jsonb) owner to postgres;
alter function public.dispatch_ready_swarm_assignments(integer) owner to postgres;
alter function public.record_swarm_checkpoint(uuid, uuid, text, jsonb, jsonb, text, text, text, jsonb) owner to postgres;
alter function public.route_swarm_reviews(integer) owner to postgres;
alter function public.mark_stale_swarm_assignments(integer, integer) owner to postgres;
alter function public.get_swarm_runtime(uuid) owner to postgres;
alter function public.answer_swarm_escalation(uuid, text, text) owner to postgres;
alter function public.cancel_swarm_mission(uuid, text) owner to postgres;
alter function public.list_swarm_missions(integer) owner to postgres;
alter function public.list_swarm_escalations(text, integer) owner to postgres;
alter function public.get_swarm_assignment_envelope(uuid, uuid) owner to postgres;

-- internal: callable only from definer functions running as postgres
revoke all on function public.swarm_recompute_mission_status(uuid)
  from public, anon, authenticated, service_role, authenticator;

revoke all on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  to service_role;

revoke all on function public.set_sourcing_loop_controls(boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.set_sourcing_loop_controls(boolean, boolean, boolean, boolean, boolean, boolean, integer, integer, integer)
  to authenticated;

revoke all on function public.seed_swarm_roster()
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.seed_swarm_roster()
  to authenticated;

revoke all on function public.set_swarm_agent(uuid, boolean, integer, boolean, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.set_swarm_agent(uuid, boolean, integer, boolean, text)
  to authenticated;

revoke all on function public.create_swarm_mission(uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_swarm_mission(uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid, uuid)
  to service_role;

revoke all on function public.plan_swarm_assignments(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.plan_swarm_assignments(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.dispatch_ready_swarm_assignments(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.dispatch_ready_swarm_assignments(integer)
  to service_role;

revoke all on function public.record_swarm_checkpoint(uuid, uuid, text, jsonb, jsonb, text, text, text, jsonb)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.record_swarm_checkpoint(uuid, uuid, text, jsonb, jsonb, text, text, text, jsonb)
  to service_role;

revoke all on function public.route_swarm_reviews(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.route_swarm_reviews(integer)
  to service_role;

revoke all on function public.mark_stale_swarm_assignments(integer, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.mark_stale_swarm_assignments(integer, integer)
  to service_role;

revoke all on function public.get_swarm_runtime(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_swarm_runtime(uuid)
  to service_role;

revoke all on function public.answer_swarm_escalation(uuid, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.answer_swarm_escalation(uuid, text, text)
  to authenticated;

revoke all on function public.cancel_swarm_mission(uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.cancel_swarm_mission(uuid, text)
  to authenticated;

revoke all on function public.list_swarm_missions(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_swarm_missions(integer)
  to authenticated;

revoke all on function public.list_swarm_escalations(text, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_swarm_escalations(text, integer)
  to authenticated;

revoke all on function public.get_swarm_assignment_envelope(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_swarm_assignment_envelope(uuid, uuid)
  to service_role;
