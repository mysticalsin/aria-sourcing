-- 0029_agent_framework_authority.sql
--
-- Flowise is a private authoring/import surface and DeerFlow is a private
-- orchestration worker. Neither framework owns identity, campaign truth,
-- candidates, provider credentials, memory promotion, approvals, or delivery.
-- Every executable binding is exact, immutable, digest-pinned, disabled by
-- default, and claimed through service-only database authority.

-- Browser-authored external identifiers were circular authority: a caller
-- could bind a guessed Flowise ID and then use that same row as ownership
-- proof. Invalidate all legacy values and remove the column update grant.
update public.agent_specs
set flowise_chatflow_id = null
where flowise_chatflow_id is not null;
revoke update (flowise_chatflow_id) on public.agent_specs from authenticated;
comment on column public.agent_specs.flowise_chatflow_id is
  'Deprecated and intentionally null. Use service-owned agent_workflow_versions.';

create table if not exists public.agent_framework_controls (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  execution_enabled boolean not null default false,
  kill_switch boolean not null default true,
  required_deerflow_commit text not null
    default 'fabadae4168db81f0eaaf62f209050f978e2f691'
    check (required_deerflow_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'),
  required_flowise_commit text not null
    default 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
    check (required_flowise_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'),
  required_deerflow_image_digest text check (
    required_deerflow_image_digest is null
    or required_deerflow_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
  ),
  required_flowise_image_digest text check (
    required_flowise_image_digest is null
    or required_flowise_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
  ),
  required_flowise_isolation text check (
    required_flowise_isolation is null
    or required_flowise_isolation in ('instance-per-workspace', 'licensed-enterprise-workspace')
  ),
  configuration_sha256 text check (
    configuration_sha256 is null or configuration_sha256 ~ '^[0-9a-f]{64}$'
  ),
  version bigint not null default 1 check (version > 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (
    not execution_enabled
    or (
      not kill_switch
      and configuration_sha256 is not null
      and required_deerflow_image_digest is not null
      and required_flowise_image_digest is not null
      and required_flowise_isolation is not null
      and updated_by is not null
    )
  ),
  foreign key (workspace_id, updated_by)
    references public.profiles (workspace_id, id) on delete restrict
);

insert into public.agent_framework_controls (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;

create or replace function public.seed_agent_framework_control()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.agent_framework_controls (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function public.seed_agent_framework_control()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists workspaces_seed_agent_framework_control on public.workspaces;
create trigger workspaces_seed_agent_framework_control
  after insert on public.workspaces
  for each row execute function public.seed_agent_framework_control();

create table if not exists public.agent_framework_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  framework text not null check (framework in ('deerflow', 'flowise')),
  external_instance_ref text not null
    check (external_instance_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  image_digest text not null
    check (image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'),
  isolation_mode text not null check (
    (framework = 'deerflow' and isolation_mode = 'dedicated-worker')
    or (
      framework = 'flowise'
      and isolation_mode in ('instance-per-workspace', 'licensed-enterprise-workspace')
    )
  ),
  status text not null default 'registered'
    check (status in ('registered', 'ready', 'degraded', 'paused', 'revoked')),
  readiness_sha256 text check (
    readiness_sha256 is null or readiness_sha256 ~ '^[0-9a-f]{64}$'
  ),
  last_ready_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (framework = 'deerflow' and source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691')
    or (framework = 'flowise' and source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3')
  ),
  check (status <> 'ready' or (readiness_sha256 is not null and last_ready_at is not null)),
  unique (workspace_id, framework, external_instance_ref),
  foreign key (workspace_id, created_by)
    references public.profiles (workspace_id, id) on delete restrict
);

alter table public.agent_framework_instances
  drop constraint if exists agent_framework_instances_status_check;
alter table public.agent_framework_instances
  add constraint agent_framework_instances_status_check
  check (status in ('registered', 'ready', 'degraded', 'paused', 'revoked'));

create unique index if not exists agent_framework_instances_workspace_id_id_key
  on public.agent_framework_instances (workspace_id, id);
create unique index if not exists agent_framework_instances_one_ready_per_kind
  on public.agent_framework_instances (workspace_id, framework)
  where status = 'ready';

create table if not exists public.agent_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  spec_id uuid not null,
  framework_instance_id uuid not null,
  version integer not null check (version > 0),
  external_workflow_ref text not null
    check (external_workflow_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  workflow_sha256 text not null check (workflow_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_json jsonb not null check (jsonb_typeof(workflow_json) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'revoked')),
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'revoked' or (revoked_by is not null and revoked_at is not null)),
  constraint agent_workflow_versions_workspace_owner_spec_fkey
    foreign key (workspace_id, owner_id, spec_id)
    references public.agent_specs (workspace_id, owner_id, id) on delete restrict,
  constraint agent_workflow_versions_workspace_instance_fkey
    foreign key (workspace_id, framework_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  foreign key (workspace_id, created_by)
    references public.profiles (workspace_id, id) on delete restrict,
  foreign key (workspace_id, approved_by)
    references public.profiles (workspace_id, id) on delete restrict,
  foreign key (workspace_id, revoked_by)
    references public.profiles (workspace_id, id) on delete restrict,
  unique (workspace_id, owner_id, spec_id, version),
  unique (workspace_id, framework_instance_id, external_workflow_ref, version)
);

alter table public.agent_workflow_versions
  drop constraint if exists agent_workflow_versions_json_sha256_check;
alter table public.agent_workflow_versions
  add constraint agent_workflow_versions_json_sha256_check
  check (workflow_sha256 = encode(digest(workflow_json::text, 'sha256'), 'hex'));

create unique index if not exists agent_workflow_versions_authority_id_key
  on public.agent_workflow_versions (workspace_id, owner_id, spec_id, id);

create table if not exists public.agent_framework_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  actor_id uuid not null,
  spec_id uuid not null,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  campaign_fingerprint text not null check (campaign_fingerprint ~ '^[0-9a-f]{64}$'),
  workflow_version_id uuid not null,
  deerflow_instance_id uuid not null,
  flowise_instance_id uuid not null,
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  capability_sha256 text not null check (capability_sha256 ~ '^[0-9a-f]{64}$'),
  configuration_sha256 text not null check (configuration_sha256 ~ '^[0-9a-f]{64}$'),
  workflow_sha256 text not null check (workflow_sha256 ~ '^[0-9a-f]{64}$'),
  deerflow_source_commit text not null
    check (deerflow_source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'),
  deerflow_image_digest text not null
    check (deerflow_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'),
  deerflow_readiness_sha256 text not null check (deerflow_readiness_sha256 ~ '^[0-9a-f]{64}$'),
  deerflow_last_ready_at timestamptz not null,
  flowise_source_commit text not null
    check (flowise_source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'),
  flowise_image_digest text not null
    check (flowise_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'),
  flowise_isolation_mode text not null
    check (flowise_isolation_mode in ('instance-per-workspace', 'licensed-enterprise-workspace')),
  flowise_readiness_sha256 text not null check (flowise_readiness_sha256 ~ '^[0-9a-f]{64}$'),
  flowise_last_ready_at timestamptz not null,
  status text not null default 'claimed'
    check (status in ('claimed', 'running', 'proposed', 'failed', 'cancelled')),
  lease_id uuid not null,
  lease_expires_at timestamptz not null,
  proposal_sha256 text check (proposal_sha256 is null or proposal_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint agent_framework_runs_workspace_owner_spec_fkey
    foreign key (workspace_id, owner_id, spec_id)
    references public.agent_specs (workspace_id, owner_id, id) on delete restrict,
  constraint agent_framework_runs_workspace_actor_fkey
    foreign key (workspace_id, actor_id)
    references public.profiles (workspace_id, id) on delete restrict,
  constraint agent_framework_runs_workflow_fkey
    foreign key (workspace_id, owner_id, spec_id, workflow_version_id)
    references public.agent_workflow_versions (workspace_id, owner_id, spec_id, id)
    on delete restrict,
  constraint agent_framework_runs_deerflow_instance_fkey
    foreign key (workspace_id, deerflow_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  constraint agent_framework_runs_flowise_instance_fkey
    foreign key (workspace_id, flowise_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  unique (workspace_id, owner_id, spec_id, idempotency_key),
  check (
    (status in ('claimed', 'running') and finished_at is null)
    or (status in ('proposed', 'failed', 'cancelled') and finished_at is not null)
  )
);

create unique index if not exists agent_framework_runs_workspace_id_key
  on public.agent_framework_runs (workspace_id, id);
create index if not exists agent_framework_runs_active_lease_idx
  on public.agent_framework_runs (workspace_id, lease_expires_at)
  where status in ('claimed', 'running');

create table if not exists public.agent_framework_step_receipts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 99),
  node_kind text not null check (
    node_kind in ('plan', 'source_reviewed_campaign', 'report')
  ),
  idempotency_key text not null
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  response_sha256 text not null check (response_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  foreign key (workspace_id, run_id)
    references public.agent_framework_runs (workspace_id, id) on delete cascade,
  unique (workspace_id, run_id, ordinal),
  unique (workspace_id, run_id, idempotency_key)
);

alter table public.agent_framework_step_receipts
  drop constraint if exists agent_framework_step_receipts_node_kind_check;
alter table public.agent_framework_step_receipts
  add constraint agent_framework_step_receipts_node_kind_check
  check (node_kind in ('plan', 'source_reviewed_campaign', 'report'));

create table if not exists public.agent_framework_sourcing_authorizations (
  framework_run_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  actor_id uuid not null,
  campaign_id text not null
    check (campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  campaign_fingerprint text not null check (campaign_fingerprint ~ '^[0-9a-f]{64}$'),
  sourcing_count integer not null check (sourcing_count between 1 and 8),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  source_query text not null check (
    char_length(source_query) between 3 and 256
    and source_query = btrim(source_query)
    and source_query !~ '[[:cntrl:]]'
  ),
  capability_sha256 text not null unique check (capability_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'authorized'
    check (status in ('authorized', 'claimed', 'ready', 'completed', 'failed')),
  sourcing_run_id uuid,
  result_sha256 text check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  result_payload jsonb check (
    result_payload is null
    or (jsonb_typeof(result_payload) = 'object' and octet_length(result_payload::text) <= 524288)
  ),
  authorized_at timestamptz not null default now(),
  claimed_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  constraint agent_framework_sourcing_authorizations_run_fkey
    foreign key (workspace_id, framework_run_id)
    references public.agent_framework_runs (workspace_id, id) on delete cascade,
  constraint agent_framework_sourcing_authorizations_actor_fkey
    foreign key (workspace_id, actor_id)
    references public.profiles (workspace_id, id) on delete restrict,
  constraint agent_framework_sourcing_authorizations_sourcing_run_fkey
    foreign key (workspace_id, sourcing_run_id)
    references public.sourcing_runs (workspace_id, id) on delete cascade,
  unique (workspace_id, sourcing_run_id),
  check (
    (status = 'authorized' and sourcing_run_id is null and claimed_at is null and ready_at is null and completed_at is null and failed_at is null and result_sha256 is null and result_payload is null)
    or (status = 'claimed' and sourcing_run_id is not null and claimed_at is not null and ready_at is null and completed_at is null and failed_at is null and result_sha256 is null and result_payload is null)
    or (status = 'ready' and sourcing_run_id is not null and claimed_at is not null and ready_at is not null and completed_at is null and failed_at is null and result_sha256 is not null and result_payload is not null)
    or (status = 'completed' and sourcing_run_id is not null and claimed_at is not null and ready_at is not null and completed_at is not null and failed_at is null and result_sha256 is not null and result_payload is not null)
    or (status = 'failed' and sourcing_run_id is not null and claimed_at is not null and ready_at is null and completed_at is null and failed_at is not null and result_sha256 is null and result_payload is null)
  )
);

create unique index if not exists agent_framework_sourcing_authorizations_workspace_run_key
  on public.agent_framework_sourcing_authorizations (workspace_id, framework_run_id);

create or replace function public.enforce_agent_workflow_version_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id
     or new.spec_id is distinct from old.spec_id
     or new.framework_instance_id is distinct from old.framework_instance_id
     or new.version is distinct from old.version
     or new.external_workflow_ref is distinct from old.external_workflow_ref
     or new.workflow_sha256 is distinct from old.workflow_sha256
     or new.workflow_json is distinct from old.workflow_json
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'agent workflow version authority is immutable' using errcode = '42501';
  end if;
  if old.status in ('approved', 'revoked') and new.status <> 'revoked' then
    raise exception 'approved agent workflow versions cannot be reopened' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_agent_framework_instance_identity_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.framework is distinct from old.framework
     or new.external_instance_ref is distinct from old.external_instance_ref
     or new.source_commit is distinct from old.source_commit
     or new.image_digest is distinct from old.image_digest
     or new.isolation_mode is distinct from old.isolation_mode
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'agent framework instance identity is immutable' using errcode = '42501';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'revoked agent framework instances cannot be reopened' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.reject_agent_framework_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'agent framework step receipts are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_agent_workflow_version_immutable()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.enforce_agent_framework_instance_identity_immutable()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reject_agent_framework_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_workflow_versions_immutable on public.agent_workflow_versions;
create trigger agent_workflow_versions_immutable
  before update on public.agent_workflow_versions
  for each row execute function public.enforce_agent_workflow_version_immutable();
drop trigger if exists agent_framework_instances_identity_immutable on public.agent_framework_instances;
create trigger agent_framework_instances_identity_immutable
  before update on public.agent_framework_instances
  for each row execute function public.enforce_agent_framework_instance_identity_immutable();
drop trigger if exists agent_framework_step_receipts_append_only on public.agent_framework_step_receipts;
create trigger agent_framework_step_receipts_append_only
  before update or delete on public.agent_framework_step_receipts
  for each row execute function public.reject_agent_framework_receipt_mutation();

alter table public.agent_framework_controls enable row level security;
alter table public.agent_framework_controls force row level security;
alter table public.agent_framework_instances enable row level security;
alter table public.agent_framework_instances force row level security;
alter table public.agent_workflow_versions enable row level security;
alter table public.agent_workflow_versions force row level security;
alter table public.agent_framework_runs enable row level security;
alter table public.agent_framework_runs force row level security;
alter table public.agent_framework_step_receipts enable row level security;
alter table public.agent_framework_step_receipts force row level security;
alter table public.agent_framework_sourcing_authorizations enable row level security;
alter table public.agent_framework_sourcing_authorizations force row level security;

revoke all on public.agent_framework_controls
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_framework_instances
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_workflow_versions
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_framework_runs
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_framework_step_receipts
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.agent_framework_step_receipts_id_seq
  from public, anon, authenticated, service_role, authenticator;
revoke all on public.agent_framework_sourcing_authorizations
  from public, anon, authenticated, service_role, authenticator;

drop policy if exists agent_framework_controls_postgres_all on public.agent_framework_controls;
create policy agent_framework_controls_postgres_all on public.agent_framework_controls
  for all to postgres using (true) with check (true);
drop policy if exists agent_framework_instances_postgres_all on public.agent_framework_instances;
create policy agent_framework_instances_postgres_all on public.agent_framework_instances
  for all to postgres using (true) with check (true);
drop policy if exists agent_workflow_versions_postgres_all on public.agent_workflow_versions;
create policy agent_workflow_versions_postgres_all on public.agent_workflow_versions
  for all to postgres using (true) with check (true);
drop policy if exists agent_framework_runs_postgres_all on public.agent_framework_runs;
create policy agent_framework_runs_postgres_all on public.agent_framework_runs
  for all to postgres using (true) with check (true);
drop policy if exists agent_framework_step_receipts_postgres_all on public.agent_framework_step_receipts;
create policy agent_framework_step_receipts_postgres_all on public.agent_framework_step_receipts
  for all to postgres using (true) with check (true);
drop policy if exists agent_framework_sourcing_authorizations_postgres_all
  on public.agent_framework_sourcing_authorizations;
create policy agent_framework_sourcing_authorizations_postgres_all
  on public.agent_framework_sourcing_authorizations
  for all to postgres using (true) with check (true);

create or replace function public.import_agent_workflow_version(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_actor_id uuid,
  p_spec_id uuid,
  p_flowise_instance_id uuid,
  p_external_workflow_ref text,
  p_version integer,
  p_workflow_json jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  control public.agent_framework_controls%rowtype;
  flowise public.agent_framework_instances%rowtype;
  existing public.agent_workflow_versions%rowtype;
  workflow_id uuid;
  workflow_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_owner_id is null or p_actor_id is null
     or p_spec_id is null or p_flowise_instance_id is null
     or p_external_workflow_ref is null
     or p_external_workflow_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_version is null or p_version < 1 or p_version > 1000000
     or p_workflow_json is null or jsonb_typeof(p_workflow_json) <> 'object' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_owner_id::text || ':' || p_spec_id::text || ':' || p_version::text,
    0
  ));
  perform 1 from public.profiles
  where workspace_id = p_workspace_id and id = p_actor_id and role = 'admin'
  for share;
  if not found then return jsonb_build_object('status', 'not_authorized'); end if;

  perform 1 from public.agent_specs
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and id = p_spec_id
    and status = 'active'
  for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into control from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for share;
  if not found
     or control.configuration_sha256 is null
     or control.required_flowise_image_digest is null
     or control.required_flowise_isolation is null
     or control.required_flowise_commit <> 'bb773ffa710bd22639c4ba2643413a0ea2b679d3' then
    return jsonb_build_object('status', 'configuration_invalid');
  end if;

  select * into flowise from public.agent_framework_instances
  where workspace_id = p_workspace_id
    and id = p_flowise_instance_id
    and framework = 'flowise'
  for share;
  if not found or flowise.status <> 'ready'
     or flowise.source_commit <> control.required_flowise_commit
     or flowise.image_digest <> control.required_flowise_image_digest
     or flowise.isolation_mode <> control.required_flowise_isolation
     or flowise.readiness_sha256 is null
     or flowise.last_ready_at is null
     or flowise.last_ready_at < now() - interval '5 minutes' then
    return jsonb_build_object('status', 'flowise_unavailable');
  end if;

  workflow_hash := encode(digest(p_workflow_json::text, 'sha256'), 'hex');
  select * into existing from public.agent_workflow_versions
  where workspace_id = p_workspace_id
    and version = p_version
    and (
      (owner_id = p_owner_id and spec_id = p_spec_id)
      or (
        framework_instance_id = p_flowise_instance_id
        and external_workflow_ref = p_external_workflow_ref
      )
    )
  limit 1
  for update;
  if found then
    if existing.owner_id = p_owner_id
       and existing.spec_id = p_spec_id
       and existing.framework_instance_id = p_flowise_instance_id
       and existing.external_workflow_ref = p_external_workflow_ref
       and existing.workflow_sha256 = workflow_hash
       and existing.workflow_json = p_workflow_json then
      return jsonb_build_object(
        'status', 'replay',
        'workflow_version_id', existing.id,
        'workflow_sha256', existing.workflow_sha256,
        'workflow_status', existing.status
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  insert into public.agent_workflow_versions (
    workspace_id, owner_id, spec_id, framework_instance_id, version,
    external_workflow_ref, workflow_sha256, workflow_json, status, created_by
  ) values (
    p_workspace_id, p_owner_id, p_spec_id, p_flowise_instance_id, p_version,
    p_external_workflow_ref, workflow_hash, p_workflow_json, 'draft', p_actor_id
  ) returning id into workflow_id;

  return jsonb_build_object(
    'status', 'imported',
    'workflow_version_id', workflow_id,
    'workflow_sha256', workflow_hash,
    'workflow_status', 'draft'
  );
end;
$$;

create or replace function public.review_agent_workflow_version(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_workflow_version_id uuid,
  p_expected_sha256 text,
  p_decision text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  workflow public.agent_workflow_versions%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_workflow_version_id is null
     or p_expected_sha256 is null
     or p_expected_sha256 !~ '^[0-9a-f]{64}$'
     or p_decision is null
     or p_decision not in ('approve', 'revoke') then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.profiles
  where workspace_id = p_workspace_id and id = p_actor_id and role = 'admin'
  for share;
  if not found then return jsonb_build_object('status', 'not_authorized'); end if;

  select * into workflow from public.agent_workflow_versions
  where workspace_id = p_workspace_id and id = p_workflow_version_id
  for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if workflow.workflow_sha256 <> p_expected_sha256 then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_decision = 'approve' then
    if workflow.created_by = p_actor_id then
      return jsonb_build_object('status', 'reviewer_conflict');
    end if;
    if workflow.status = 'approved' then
      return jsonb_build_object(
        'status', 'approved',
        'workflow_version_id', workflow.id,
        'workflow_sha256', workflow.workflow_sha256
      );
    end if;
    if workflow.status <> 'draft' then
      return jsonb_build_object('status', 'conflict');
    end if;
    update public.agent_workflow_versions
    set status = 'approved', approved_by = p_actor_id, approved_at = now()
    where id = workflow.id;
    return jsonb_build_object(
      'status', 'approved',
      'workflow_version_id', workflow.id,
      'workflow_sha256', workflow.workflow_sha256
    );
  end if;

  if workflow.status = 'revoked' then
    return jsonb_build_object(
      'status', 'revoked',
      'workflow_version_id', workflow.id,
      'workflow_sha256', workflow.workflow_sha256
    );
  end if;
  if workflow.status <> 'approved' then
    return jsonb_build_object('status', 'conflict');
  end if;
  update public.agent_workflow_versions
  set status = 'revoked', revoked_by = p_actor_id, revoked_at = now()
  where id = workflow.id;
  return jsonb_build_object(
    'status', 'revoked',
    'workflow_version_id', workflow.id,
    'workflow_sha256', workflow.workflow_sha256
  );
end;
$$;

create or replace function public.list_agent_framework_workflows(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  workflows jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_owner_id is null or p_actor_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  if p_owner_id is distinct from p_actor_id then
    return jsonb_build_object('status', 'actor_mismatch');
  end if;
  perform 1 from public.profiles
  where workspace_id = p_workspace_id
    and id = p_actor_id
    and role in ('admin', 'member')
  for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select coalesce(jsonb_agg(to_jsonb(latest) order by latest.spec_id), '[]'::jsonb)
  into workflows
  from (
    select distinct on (workflow.spec_id)
      workflow.spec_id,
      workflow.id as workflow_version_id,
      workflow.version,
      workflow.external_workflow_ref,
      workflow.workflow_sha256,
      workflow.workflow_json->>'name' as workflow_name
    from public.agent_workflow_versions workflow
    join public.agent_specs spec
      on spec.workspace_id = workflow.workspace_id
     and spec.owner_id = workflow.owner_id
     and spec.id = workflow.spec_id
    where workflow.workspace_id = p_workspace_id
      and workflow.owner_id = p_owner_id
      and workflow.status = 'approved'
      and spec.status = 'active'
    order by workflow.spec_id, workflow.version desc, workflow.created_at desc, workflow.id desc
  ) latest;
  return jsonb_build_object('status', 'ok', 'workflows', workflows);
end;
$$;

drop function if exists public.list_agent_framework_heartbeat_targets();
create or replace function public.list_agent_framework_heartbeat_targets(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  targets jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', instance.workspace_id,
    'instance_id', instance.id,
    'framework', instance.framework,
    'source_commit', instance.source_commit,
    'image_digest', instance.image_digest,
    'isolation_mode', instance.isolation_mode,
    'configuration_sha256', control.configuration_sha256
  ) order by instance.workspace_id, instance.framework, instance.id), '[]'::jsonb)
  into targets
  from public.agent_framework_instances as instance
  join public.agent_framework_controls as control
    on control.workspace_id = instance.workspace_id
  where control.configuration_sha256 is not null
    and instance.workspace_id = p_workspace_id
    and instance.status not in ('paused', 'revoked');
  return jsonb_build_object('status', 'ok', 'targets', targets);
end;
$$;

create or replace function public.record_agent_framework_readiness(
  p_workspace_id uuid,
  p_instance_id uuid,
  p_source_commit text,
  p_image_digest text,
  p_isolation_mode text,
  p_configuration_sha256 text,
  p_readiness_sha256 text,
  p_ready boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  instance public.agent_framework_instances%rowtype;
  control public.agent_framework_controls%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_instance_id is null or p_ready is null
     or p_source_commit is null or p_source_commit !~ '^[0-9a-f]{40}$'
     or p_image_digest is null
     or char_length(p_image_digest) > 456
     or p_image_digest !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
     or p_isolation_mode not in ('dedicated-worker','instance-per-workspace','licensed-enterprise-workspace')
     or p_configuration_sha256 is null or p_configuration_sha256 !~ '^[0-9a-f]{64}$'
     or p_readiness_sha256 is null or p_readiness_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into control
  from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for share;
  select * into instance
  from public.agent_framework_instances
  where workspace_id = p_workspace_id and id = p_instance_id
  for update;
  if not found or control.workspace_id is null
     or control.configuration_sha256 is distinct from p_configuration_sha256
     or instance.source_commit is distinct from p_source_commit
     or instance.image_digest is distinct from p_image_digest
     or instance.isolation_mode is distinct from p_isolation_mode then
    return jsonb_build_object('status', 'identity_mismatch');
  end if;
  if instance.status in ('paused', 'revoked') then
    return jsonb_build_object('status', 'state_locked');
  end if;
  update public.agent_framework_instances
  set status = case when p_ready then 'ready' else 'degraded' end,
      readiness_sha256 = p_readiness_sha256,
      last_ready_at = case when p_ready then now() else null end
  where workspace_id = p_workspace_id and id = p_instance_id;
  return jsonb_build_object('status', 'recorded');
end;
$$;

create or replace function public.agent_framework_run_authority_is_active(
  p_run_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  run public.agent_framework_runs%rowtype;
  control public.agent_framework_controls%rowtype;
  workflow public.agent_workflow_versions%rowtype;
  spec public.agent_specs%rowtype;
  deerflow public.agent_framework_instances%rowtype;
  flowise public.agent_framework_instances%rowtype;
begin
  -- These SHARE locks are held until the caller's transaction commits. Every
  -- effect boundary therefore linearizes before or after a concurrent control,
  -- workflow, spec, or instance revocation; it cannot pass a stale check and
  -- then write after the revocation has committed.
  select * into run
  from public.agent_framework_runs
  where id = p_run_id
  for share;
  if not found or run.status not in ('claimed', 'running', 'proposed') then
    return false;
  end if;

  select * into control
  from public.agent_framework_controls
  where workspace_id = run.workspace_id
  for share;
  if not found
     or not control.execution_enabled
     or control.kill_switch
     or control.configuration_sha256 is distinct from run.configuration_sha256
     or control.required_deerflow_commit is distinct from run.deerflow_source_commit
     or control.required_deerflow_image_digest is distinct from run.deerflow_image_digest
     or control.required_flowise_commit is distinct from run.flowise_source_commit
     or control.required_flowise_image_digest is distinct from run.flowise_image_digest
     or control.required_flowise_isolation is distinct from run.flowise_isolation_mode then
    return false;
  end if;

  select * into workflow
  from public.agent_workflow_versions
  where workspace_id = run.workspace_id
    and owner_id = run.owner_id
    and spec_id = run.spec_id
    and id = run.workflow_version_id
  for share;
  if not found
     or workflow.status <> 'approved'
     or workflow.workflow_sha256 is distinct from run.workflow_sha256 then
    return false;
  end if;

  select * into spec
  from public.agent_specs
  where workspace_id = run.workspace_id
    and owner_id = run.owner_id
    and id = run.spec_id
  for share;
  if not found or spec.status <> 'active' then
    return false;
  end if;

  select * into deerflow
  from public.agent_framework_instances
  where workspace_id = run.workspace_id
    and id = run.deerflow_instance_id
    and framework = 'deerflow'
  for share;
  if not found
     or deerflow.status <> 'ready'
     or deerflow.source_commit is distinct from run.deerflow_source_commit
     or deerflow.image_digest is distinct from run.deerflow_image_digest
     or deerflow.readiness_sha256 is null
     or deerflow.last_ready_at is null
     or deerflow.last_ready_at < now() - interval '5 minutes' then
    return false;
  end if;

  select * into flowise
  from public.agent_framework_instances
  where workspace_id = run.workspace_id
    and id = run.flowise_instance_id
    and framework = 'flowise'
  for share;
  if not found
     or flowise.status <> 'ready'
     or flowise.source_commit is distinct from run.flowise_source_commit
     or flowise.image_digest is distinct from run.flowise_image_digest
     or flowise.isolation_mode is distinct from run.flowise_isolation_mode
     or flowise.readiness_sha256 is null
     or flowise.last_ready_at is null
     or flowise.last_ready_at < now() - interval '5 minutes' then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.agent_framework_run_authority_is_active(uuid)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.claim_agent_framework_run(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_actor_id uuid,
  p_spec_id uuid,
  p_campaign_id text,
  p_campaign_fingerprint text,
  p_workflow_version_id uuid,
  p_idempotency_key text,
  p_capability_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  control public.agent_framework_controls%rowtype;
  workflow public.agent_workflow_versions%rowtype;
  flowise public.agent_framework_instances%rowtype;
  deerflow public.agent_framework_instances%rowtype;
  existing public.agent_framework_runs%rowtype;
  recovery_authz public.agent_framework_sourcing_authorizations%rowtype;
  run_id uuid;
  new_lease_id uuid := gen_random_uuid();
  new_lease_expires_at timestamptz := now() + interval '5 minutes';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_owner_id is null or p_actor_id is null
     or p_spec_id is null or p_workflow_version_id is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_campaign_fingerprint !~ '^[0-9a-f]{64}$'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_capability_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_owner_id::text || ':' || p_spec_id::text || ':' || p_idempotency_key,
    0
  ));

  select * into control from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for share;
  if not found or not control.execution_enabled or control.kill_switch then
    return jsonb_build_object('status', 'framework_disabled');
  end if;
  if control.configuration_sha256 is null
     or control.required_deerflow_image_digest is null
     or control.required_flowise_image_digest is null
     or control.required_flowise_isolation is null
     or control.required_deerflow_commit <> 'fabadae4168db81f0eaaf62f209050f978e2f691'
     or control.required_flowise_commit <> 'bb773ffa710bd22639c4ba2643413a0ea2b679d3' then
    return jsonb_build_object('status', 'configuration_invalid');
  end if;

  perform 1 from public.profiles
  where workspace_id = p_workspace_id
    and id = p_actor_id
    and role in ('admin', 'member')
  for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  perform 1 from public.agent_specs
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and id = p_spec_id
    and status = 'active'
  for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into workflow from public.agent_workflow_versions
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and spec_id = p_spec_id
    and id = p_workflow_version_id
  for share;
  if not found or workflow.status <> 'approved' then
    return jsonb_build_object('status', 'workflow_unavailable');
  end if;

  select * into flowise from public.agent_framework_instances
  where workspace_id = p_workspace_id
    and id = workflow.framework_instance_id
    and framework = 'flowise'
  for share;
  if not found or flowise.status <> 'ready'
     or flowise.source_commit <> control.required_flowise_commit
     or flowise.image_digest <> control.required_flowise_image_digest
     or flowise.isolation_mode <> control.required_flowise_isolation
     or flowise.readiness_sha256 is null
     or flowise.last_ready_at is null
     or flowise.last_ready_at < now() - interval '5 minutes' then
    return jsonb_build_object('status', 'flowise_unavailable');
  end if;

  select * into deerflow from public.agent_framework_instances
  where workspace_id = p_workspace_id
    and framework = 'deerflow'
    and status = 'ready'
  for share;
  if not found or deerflow.status <> 'ready'
     or deerflow.source_commit <> control.required_deerflow_commit
     or deerflow.image_digest <> control.required_deerflow_image_digest
     or deerflow.readiness_sha256 is null
     or deerflow.last_ready_at is null
     or deerflow.last_ready_at < now() - interval '5 minutes' then
    return jsonb_build_object('status', 'deerflow_unavailable');
  end if;

  select * into existing from public.agent_framework_runs
  where workspace_id = p_workspace_id
    and owner_id = p_owner_id
    and spec_id = p_spec_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.actor_id is distinct from p_actor_id
       or existing.campaign_id is distinct from p_campaign_id
       or existing.campaign_fingerprint is distinct from p_campaign_fingerprint
       or existing.workflow_version_id is distinct from p_workflow_version_id
       or existing.capability_sha256 is distinct from p_capability_sha256 then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    if not public.agent_framework_run_authority_is_active(existing.id) then
      return jsonb_build_object('status', 'authority_changed');
    end if;
    if existing.status in ('claimed', 'running') and existing.lease_expires_at > now() then
      return jsonb_build_object(
        'status', 'in_progress',
        'run_id', existing.id
      );
    end if;
    if existing.status in ('claimed', 'running') then
      update public.agent_framework_runs
      set lease_id = new_lease_id,
          lease_expires_at = new_lease_expires_at,
          status = 'claimed'
      where id = existing.id
      returning lease_id, lease_expires_at into new_lease_id, new_lease_expires_at;
    elsif existing.status = 'proposed' then
      select * into recovery_authz
      from public.agent_framework_sourcing_authorizations
      where framework_run_id = existing.id
        and workspace_id = existing.workspace_id;
      if not found then return jsonb_build_object('status', 'authority_unavailable'); end if;
      return jsonb_build_object(
        'status', 'already_completed',
        'run_id', existing.id,
        'run_status', existing.status,
        'source_query', recovery_authz.source_query,
        'sourcing_count', recovery_authz.sourcing_count
      );
    else
      return jsonb_build_object(
        'status', 'already_completed',
        'run_id', existing.id,
        'run_status', existing.status
      );
    end if;
    return jsonb_build_object(
      'status', 'claimed',
      'run_id', existing.id,
      'lease_id', new_lease_id,
      'lease_expires_at', new_lease_expires_at,
      'configuration_sha256', existing.configuration_sha256,
      'workflow_version_id', existing.workflow_version_id,
      'workflow_sha256', existing.workflow_sha256,
      'workflow', workflow.workflow_json,
      'deerflow_instance_id', existing.deerflow_instance_id,
      'deerflow_source_commit', existing.deerflow_source_commit,
      'deerflow_image_digest', existing.deerflow_image_digest,
      'deerflow_readiness_sha256', existing.deerflow_readiness_sha256,
      'flowise_instance_id', existing.flowise_instance_id,
      'flowise_source_commit', existing.flowise_source_commit,
      'flowise_image_digest', existing.flowise_image_digest,
      'flowise_isolation_mode', existing.flowise_isolation_mode,
      'flowise_readiness_sha256', existing.flowise_readiness_sha256
    );
  end if;

  insert into public.agent_framework_runs (
    workspace_id, owner_id, actor_id, spec_id, campaign_id,
    campaign_fingerprint, workflow_version_id, deerflow_instance_id, flowise_instance_id,
    idempotency_key, capability_sha256, configuration_sha256,
    workflow_sha256, deerflow_source_commit, deerflow_image_digest,
    deerflow_readiness_sha256, deerflow_last_ready_at,
    flowise_source_commit, flowise_image_digest, flowise_isolation_mode,
    flowise_readiness_sha256, flowise_last_ready_at,
    lease_id, lease_expires_at
  ) values (
    p_workspace_id, p_owner_id, p_actor_id, p_spec_id, p_campaign_id,
    p_campaign_fingerprint, workflow.id, deerflow.id, flowise.id,
    p_idempotency_key, p_capability_sha256, control.configuration_sha256,
    workflow.workflow_sha256, deerflow.source_commit, deerflow.image_digest,
    deerflow.readiness_sha256, deerflow.last_ready_at,
    flowise.source_commit, flowise.image_digest, flowise.isolation_mode,
    flowise.readiness_sha256, flowise.last_ready_at,
    new_lease_id, new_lease_expires_at
  ) returning id into run_id;

  return jsonb_build_object(
    'status', 'claimed',
    'run_id', run_id,
    'lease_id', new_lease_id,
    'lease_expires_at', new_lease_expires_at,
    'configuration_sha256', control.configuration_sha256,
    'workflow_version_id', workflow.id,
    'workflow_sha256', workflow.workflow_sha256,
    'workflow', workflow.workflow_json,
    'deerflow_instance_id', deerflow.id,
    'deerflow_source_commit', deerflow.source_commit,
    'deerflow_image_digest', deerflow.image_digest,
    'deerflow_readiness_sha256', deerflow.readiness_sha256,
    'flowise_instance_id', flowise.id,
    'flowise_source_commit', flowise.source_commit,
    'flowise_image_digest', flowise.image_digest,
    'flowise_isolation_mode', flowise.isolation_mode,
    'flowise_readiness_sha256', flowise.readiness_sha256
  );
end;
$$;

create or replace function public.record_agent_framework_step_receipt(
  p_run_id uuid,
  p_lease_id uuid,
  p_ordinal integer,
  p_node_kind text,
  p_idempotency_key text,
  p_request_sha256 text,
  p_response_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  run public.agent_framework_runs%rowtype;
  existing public.agent_framework_step_receipts%rowtype;
  receipt_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_ordinal not between 0 and 99
     or p_node_kind not in ('plan', 'source_reviewed_campaign', 'report')
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_request_sha256 !~ '^[0-9a-f]{64}$'
     or p_response_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into run from public.agent_framework_runs where id = p_run_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not public.agent_framework_run_authority_is_active(run.id) then
    return jsonb_build_object('status', 'framework_disabled');
  end if;
  if run.lease_id is distinct from p_lease_id or run.lease_expires_at <= now() then
    return jsonb_build_object('status', 'lease_invalid');
  end if;
  if run.status not in ('claimed', 'running') then
    return jsonb_build_object('status', 'run_closed');
  end if;

  select * into existing from public.agent_framework_step_receipts
  where workspace_id = run.workspace_id
    and run_id = run.id
    and (ordinal = p_ordinal or idempotency_key = p_idempotency_key)
  limit 1;
  if found then
    if existing.ordinal = p_ordinal
       and existing.node_kind = p_node_kind
       and existing.idempotency_key = p_idempotency_key
       and existing.request_sha256 = p_request_sha256
       and existing.response_sha256 = p_response_sha256 then
      return jsonb_build_object('status', 'replay', 'receipt_id', existing.id);
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  insert into public.agent_framework_step_receipts (
    workspace_id, run_id, ordinal, node_kind, idempotency_key,
    request_sha256, response_sha256
  ) values (
    run.workspace_id, run.id, p_ordinal, p_node_kind, p_idempotency_key,
    p_request_sha256, p_response_sha256
  ) returning id into receipt_id;
  update public.agent_framework_runs set status = 'running' where id = run.id;
  return jsonb_build_object('status', 'recorded', 'receipt_id', receipt_id);
end;
$$;

drop function if exists public.complete_agent_framework_run(uuid,uuid,text);
drop function if exists public.complete_agent_framework_run(uuid,uuid,text,text,integer);
drop function if exists public.complete_agent_framework_run(uuid,uuid,text,text,integer,text);
create or replace function public.complete_agent_framework_run(
  p_run_id uuid,
  p_lease_id uuid,
  p_proposal_sha256 text,
  p_sourcing_capability_sha256 text,
  p_sourcing_count integer,
  p_source_query text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  run public.agent_framework_runs%rowtype;
  authz public.agent_framework_sourcing_authorizations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_run_id is null or p_lease_id is null
     or p_proposal_sha256 is null or p_proposal_sha256 !~ '^[0-9a-f]{64}$'
     or p_sourcing_capability_sha256 is null
     or p_sourcing_capability_sha256 !~ '^[0-9a-f]{64}$'
     or p_sourcing_count is null or p_sourcing_count < 1 or p_sourcing_count > 8
     or p_source_query is null or char_length(p_source_query) not between 3 and 256
     or p_source_query is distinct from btrim(p_source_query)
     or p_source_query ~ '[[:cntrl:]]' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into run from public.agent_framework_runs where id = p_run_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not public.agent_framework_run_authority_is_active(run.id) then
    return jsonb_build_object('status', 'framework_disabled');
  end if;
  if run.status = 'proposed' then
    select * into authz
    from public.agent_framework_sourcing_authorizations
    where framework_run_id = run.id
    for update;
    if run.proposal_sha256 = p_proposal_sha256
       and found
       and authz.capability_sha256 = p_sourcing_capability_sha256
       and authz.sourcing_count = p_sourcing_count
       and authz.source_query = p_source_query then
      return jsonb_build_object('status', 'replay');
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;
  if run.lease_id is distinct from p_lease_id or run.lease_expires_at <= now() then
    return jsonb_build_object('status', 'lease_invalid');
  end if;
  if run.status not in ('claimed', 'running') then
    return jsonb_build_object('status', 'run_closed');
  end if;
  update public.agent_framework_runs
  set status = 'proposed', proposal_sha256 = p_proposal_sha256, finished_at = now()
  where id = run.id;
  insert into public.agent_framework_sourcing_authorizations (
    framework_run_id, workspace_id, owner_id, actor_id, campaign_id,
    campaign_fingerprint, sourcing_count, source_query, capability_sha256
  ) values (
    run.id, run.workspace_id, run.owner_id, run.actor_id, run.campaign_id,
    run.campaign_fingerprint, p_sourcing_count, p_source_query, p_sourcing_capability_sha256
  );
  return jsonb_build_object('status', 'proposed');
end;
$$;

drop function if exists public.begin_agent_framework_sourcing_run(
  uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,uuid,text
);
drop function if exists public.begin_agent_framework_sourcing_run(
  uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text
);
create or replace function public.begin_agent_framework_sourcing_run(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_role_basis jsonb,
  p_configuration_fingerprint text,
  p_mode text,
  p_provider text,
  p_model text,
  p_idempotency_key uuid,
  p_request_id text,
  p_count integer,
  p_campaign_fingerprint text,
  p_source_query text,
  p_framework_run_id uuid,
  p_sourcing_capability_token text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  authz public.agent_framework_sourcing_authorizations%rowtype;
  begun jsonb;
  begun_run_id uuid;
  supplied_capability_sha256 text;
  stale_failure jsonb;
  internal_idempotency_key uuid := p_idempotency_key;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_framework_run_id is null
     or p_idempotency_key is distinct from p_framework_run_id
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_count is null or p_count < 1 or p_count > 8
     or p_campaign_fingerprint is null or p_campaign_fingerprint !~ '^[0-9a-f]{64}$'
     or p_source_query is null or char_length(p_source_query) not between 3 and 256
     or p_source_query is distinct from btrim(p_source_query)
     or p_source_query ~ '[[:cntrl:]]'
     or p_sourcing_capability_token is null
     or p_sourcing_capability_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_framework_run_id::text,
    0
  ));
  -- Global lock order is framework run/authority rows first, then sourcing
  -- authorization. This matches proposal completion and avoids run/authz
  -- deadlocks during concurrent replay or revocation.
  if not public.agent_framework_run_authority_is_active(p_framework_run_id) then
    return jsonb_build_object('status', 'framework_disabled');
  end if;
  select * into authz
  from public.agent_framework_sourcing_authorizations
  where workspace_id = p_workspace_id
    and framework_run_id = p_framework_run_id
  for update;
  if not found
     or authz.actor_id is distinct from p_actor_id
     or authz.campaign_id is distinct from p_campaign_id
     or authz.campaign_fingerprint is distinct from p_campaign_fingerprint
     or authz.sourcing_count is distinct from p_count
     or authz.source_query is distinct from p_source_query then
    return jsonb_build_object('status', 'not_found');
  end if;
  supplied_capability_sha256 := encode(
    digest(convert_to(p_sourcing_capability_token, 'UTF8'), 'sha256'),
    'hex'
  );
  if authz.capability_sha256 is distinct from supplied_capability_sha256 then
    return jsonb_build_object('status', 'not_found');
  end if;
  if authz.status in ('ready', 'completed') and authz.expires_at <= now() then
    return jsonb_build_object('status', 'authorization_expired');
  end if;
  if authz.status in ('ready', 'completed') then
    return jsonb_build_object(
      'status', 'result_ready',
      'run_id', authz.sourcing_run_id,
      'framework_run_id', authz.framework_run_id,
      'result_sha256', authz.result_sha256,
      'result_payload', authz.result_payload
    );
  end if;
  if authz.status = 'failed' then
    return jsonb_build_object('status', 'already_consumed');
  end if;
  if authz.status = 'claimed' and authz.expires_at > now() then
    return jsonb_build_object(
      'status', 'in_progress',
      'run_id', authz.sourcing_run_id
    );
  end if;
  if authz.status = 'claimed' then
    stale_failure := public.fail_sourcing_run(
      p_workspace_id,
      p_actor_id,
      authz.sourcing_run_id,
      'FRAMEWORK_CLAIM_EXPIRED'
    );
    if stale_failure->>'status' <> 'failed' then return stale_failure; end if;
    if authz.attempt_count >= 3 then
      update public.agent_framework_sourcing_authorizations
      set status = 'failed', failed_at = now()
      where framework_run_id = authz.framework_run_id;
      return jsonb_build_object('status', 'authorization_expired');
    end if;
    internal_idempotency_key := gen_random_uuid();
    update public.agent_framework_sourcing_authorizations
    set status = 'authorized', sourcing_run_id = null, claimed_at = null,
        expires_at = now() + interval '5 minutes'
    where framework_run_id = authz.framework_run_id;
    authz.status := 'authorized';
    authz.sourcing_run_id := null;
    authz.claimed_at := null;
    authz.expires_at := now() + interval '5 minutes';
  end if;
  perform 1
  from public.agent_framework_runs as framework_run
  join public.agent_framework_controls as control
    on control.workspace_id = framework_run.workspace_id
  where framework_run.id = authz.framework_run_id
    and framework_run.workspace_id = authz.workspace_id
    and framework_run.status = 'proposed'
    and control.execution_enabled
    and not control.kill_switch;
  if not found then return jsonb_build_object('status', 'framework_disabled'); end if;
  if authz.status <> 'authorized' or authz.expires_at <= now() then
    return jsonb_build_object('status', 'authorization_expired');
  end if;

  begun := public.begin_sourcing_run(
    p_workspace_id,
    p_actor_id,
    p_campaign_id,
    p_role_basis,
    p_configuration_fingerprint,
    p_mode,
    p_provider,
    p_model,
    internal_idempotency_key,
    p_request_id
  );
  if begun->>'status' <> 'claimed' then return begun; end if;
  begin
    begun_run_id := (begun->>'run_id')::uuid;
  exception when others then
    raise exception 'invalid sourcing claim receipt' using errcode = '55000';
  end;
  update public.agent_framework_sourcing_authorizations
  set status = 'claimed', sourcing_run_id = begun_run_id, claimed_at = now(),
      attempt_count = attempt_count + 1,
      expires_at = now() + interval '5 minutes'
  where framework_run_id = authz.framework_run_id;
  return begun || jsonb_build_object('framework_run_id', authz.framework_run_id);
end;
$$;

create or replace function public.check_agent_framework_sourcing_execution(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_framework_run_id uuid,
  p_sourcing_run_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform 1
  from public.agent_framework_sourcing_authorizations as authz
  join public.agent_framework_runs as framework_run
    on framework_run.workspace_id = authz.workspace_id
   and framework_run.id = authz.framework_run_id
  where authz.workspace_id = p_workspace_id
    and authz.actor_id = p_actor_id
    and authz.framework_run_id = p_framework_run_id
    and authz.sourcing_run_id = p_sourcing_run_id
    and authz.status = 'claimed'
    and authz.expires_at > now()
    and framework_run.status = 'proposed'
    and public.agent_framework_run_authority_is_active(framework_run.id);
  return jsonb_build_object('status', case when found then 'allowed' else 'blocked' end);
end;
$$;

drop function if exists public.complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb);
drop function if exists public.complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb);
create or replace function public.complete_agent_framework_sourcing_effect(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_framework_run_id uuid,
  p_sourcing_run_id uuid,
  p_query_receipts jsonb,
  p_result_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  authz public.agent_framework_sourcing_authorizations%rowtype;
  sourcing public.sourcing_runs%rowtype;
  completion jsonb;
  receipt jsonb;
  normalized_query text;
  staged_result jsonb;
  staged_sha256 text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_framework_run_id is null
     or p_sourcing_run_id is null or p_query_receipts is null or p_result_payload is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  -- Keep the same run/authority -> authorization lock order used by proposal
  -- completion and sourcing claim. The locks remain held through staging.
  if not public.agent_framework_run_authority_is_active(p_framework_run_id) then
    return jsonb_build_object('status', 'framework_disabled');
  end if;
  select * into authz
  from public.agent_framework_sourcing_authorizations
  where workspace_id = p_workspace_id
    and framework_run_id = p_framework_run_id
  for update;
  if not found
     or authz.actor_id is distinct from p_actor_id
     or authz.sourcing_run_id is distinct from p_sourcing_run_id then
    return jsonb_build_object('status', 'not_found');
  end if;
  if authz.status = 'claimed' and authz.expires_at <= now() then
    return jsonb_build_object('status', 'authorization_expired');
  end if;
  if authz.status not in ('claimed', 'ready', 'completed') then
    return jsonb_build_object('status', 'run_closed');
  end if;
  if jsonb_typeof(p_query_receipts) <> 'array'
     or jsonb_array_length(p_query_receipts) <> 1 then
    return jsonb_build_object('status', 'invalid_receipts');
  end if;
  receipt := p_query_receipts -> 0;
  if jsonb_typeof(receipt) <> 'object'
     or not (receipt ?& array['platform', 'query', 'ok', 'candidateCount', 'skippedCount'])
     or receipt - array['platform', 'query', 'ok', 'candidateCount', 'skippedCount'] <> '{}'::jsonb
     or receipt->>'platform' <> 'GitHub'
     or jsonb_typeof(receipt->'query') <> 'string'
     or receipt->'ok' <> 'true'::jsonb
     or jsonb_typeof(receipt->'candidateCount') <> 'number'
     or receipt->>'candidateCount' !~ '^[0-9]{1,3}$'
     or (receipt->>'candidateCount')::integer > authz.sourcing_count then
    return jsonb_build_object('status', 'authority_changed');
  end if;
  begin
    normalized_query := public.validate_sourcing_learning_query('GitHub', receipt->>'query');
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'authority_changed');
  end;
  if normalized_query is distinct from authz.source_query then
    return jsonb_build_object('status', 'authority_changed');
  end if;
  select * into sourcing
  from public.sourcing_runs
  where workspace_id = p_workspace_id
    and actor_id = p_actor_id
    and id = p_sourcing_run_id
  for share;
  if not found or sourcing.status not in ('in_progress', 'completed') then
    return jsonb_build_object('status', 'sourcing_incomplete');
  end if;
  if jsonb_typeof(p_result_payload) <> 'object'
     or octet_length(p_result_payload::text) > 524288
     or not (p_result_payload ?& array[
       'ok','mode','campaignId','campaignFingerprint','candidates','totalFound',
       'requestId','idempotencyKey','sourcingRunId','agentFrameworkRunId','appliedLessonIds'
     ])
     or p_result_payload - array[
       'ok','mode','campaignId','campaignFingerprint','candidates','totalFound',
       'requestId','idempotencyKey','sourcingRunId','agentFrameworkRunId','appliedLessonIds'
     ] <> '{}'::jsonb
     or p_result_payload->'ok' <> 'true'::jsonb
     or p_result_payload->>'mode' <> 'deterministic'
     or p_result_payload->>'campaignId' <> authz.campaign_id
     or encode(digest(convert_to(p_result_payload->>'campaignFingerprint', 'UTF8'), 'sha256'), 'hex') <> authz.campaign_fingerprint
     or p_result_payload->>'idempotencyKey' <> authz.framework_run_id::text
     or p_result_payload->>'sourcingRunId' <> p_sourcing_run_id::text
     or p_result_payload->>'agentFrameworkRunId' <> authz.framework_run_id::text
     or jsonb_typeof(p_result_payload->'totalFound') <> 'number'
     or p_result_payload->>'totalFound' !~ '^[0-9]{1,6}$'
     or (p_result_payload->>'totalFound')::integer > 100000
     or jsonb_typeof(p_result_payload->'requestId') <> 'string'
     or p_result_payload->>'requestId' !~ '^[A-Za-z0-9._:-]{1,100}$'
     or jsonb_typeof(p_result_payload->'candidates') <> 'array'
     or jsonb_array_length(p_result_payload->'candidates') > authz.sourcing_count
     or jsonb_typeof(p_result_payload->'appliedLessonIds') <> 'array'
     or (
       authz.status = 'claimed'
       and (
         jsonb_array_length(p_result_payload->'appliedLessonIds') > 10
         or exists (
           select 1
           from jsonb_array_elements(p_result_payload->'appliedLessonIds') as applied(value)
           where jsonb_typeof(applied.value) <> 'string'
              or applied.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         )
         or (
           select count(*) <> count(distinct applied.value #>> '{}')
           from jsonb_array_elements(p_result_payload->'appliedLessonIds') as applied(value)
         )
         or exists (
           select 1
           from jsonb_array_elements_text(p_result_payload->'appliedLessonIds') as applied(lesson_id)
           left join public.sourcing_lessons as lesson
             on lesson.workspace_id = p_workspace_id
            and lesson.id::text = applied.lesson_id
            and lesson.role_fingerprint = sourcing.role_fingerprint
            and lesson.platform = 'GitHub'
            and lesson.query_text = authz.source_query
            and lesson.status = 'promoted'
            and lesson.promoted_by is not null
            and lesson.expires_at > now()
           where lesson.id is null
              or not exists (
                select 1
                from public.sourcing_learning_controls as learning_control
                where learning_control.workspace_id = p_workspace_id
                  and learning_control.enabled
              )
              or not exists (
                select 1
                from public.sourcing_lesson_reviews as review
                where review.workspace_id = lesson.workspace_id
                  and review.lesson_id = lesson.id
                  and review.reviewer_kind = 'human'
                  and review.reviewer_id = lesson.promoted_by
                  and review.new_status = 'promoted'
                  and review.lesson_version = lesson.version
              )
         )
       )
     )
     or exists (
       select 1
       from jsonb_array_elements(p_result_payload->'candidates') as candidate(value)
       where jsonb_typeof(candidate.value) <> 'object'
          or not (candidate.value ?& array['id','campaignId','sourcePlatform','sourceQuery'])
          or jsonb_typeof(candidate.value->'id') <> 'string'
          or candidate.value->>'campaignId' <> authz.campaign_id
          or candidate.value->>'sourcePlatform' <> 'GitHub'
          or candidate.value->>'sourceQuery' <> authz.source_query
     ) then
    return jsonb_build_object('status', 'result_invalid');
  end if;
  completion := public.complete_sourcing_run(
    p_workspace_id,
    p_actor_id,
    p_sourcing_run_id,
    p_query_receipts
  );
  if completion->>'status' <> 'completed' then return completion; end if;
  staged_result := p_result_payload || jsonb_build_object(
    'feedbackReceipts', completion->'receipts'
  );
  staged_sha256 := encode(
    digest(convert_to(staged_result::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if authz.status in ('ready', 'completed') then
    if authz.result_sha256 is distinct from staged_sha256 then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'result_ready',
      'run_id', authz.sourcing_run_id,
      'framework_run_id', authz.framework_run_id,
      'result_sha256', authz.result_sha256,
      'result_payload', authz.result_payload
    );
  end if;
  select * into sourcing
  from public.sourcing_runs
  where workspace_id = p_workspace_id
    and actor_id = p_actor_id
    and id = p_sourcing_run_id
  for share;
  if not found or sourcing.status <> 'completed' then
    return jsonb_build_object('status', 'sourcing_incomplete');
  end if;
  update public.agent_framework_sourcing_authorizations
  set status = 'ready', ready_at = now(), result_sha256 = staged_sha256,
      result_payload = staged_result, expires_at = now() + interval '24 hours'
  where framework_run_id = authz.framework_run_id;
  return jsonb_build_object(
    'status', 'result_ready',
    'run_id', authz.sourcing_run_id,
    'framework_run_id', authz.framework_run_id,
    'result_sha256', staged_sha256,
    'result_payload', staged_result
  );
end;
$$;

create or replace function public.ack_agent_framework_sourcing_effect(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_framework_run_id uuid,
  p_sourcing_capability_token text,
  p_result_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  authz public.agent_framework_sourcing_authorizations%rowtype;
  workspace_state jsonb;
  supplied_capability_sha256 text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_framework_run_id is null
     or p_sourcing_capability_token is null
     or p_sourcing_capability_token !~ '^[A-Za-z0-9_-]{43}$'
     or p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into authz
  from public.agent_framework_sourcing_authorizations
  where workspace_id = p_workspace_id
    and framework_run_id = p_framework_run_id
  for update;
  if not found or authz.actor_id is distinct from p_actor_id then
    return jsonb_build_object('status', 'not_found');
  end if;
  supplied_capability_sha256 := encode(
    digest(convert_to(p_sourcing_capability_token, 'UTF8'), 'sha256'),
    'hex'
  );
  if authz.capability_sha256 is distinct from supplied_capability_sha256
     or authz.result_sha256 is distinct from p_result_sha256 then
    return jsonb_build_object('status', 'not_found');
  end if;
  if authz.status = 'completed' then
    return jsonb_build_object(
      'status', 'completed',
      'framework_run_id', authz.framework_run_id,
      'sourcing_run_id', authz.sourcing_run_id,
      'result_sha256', authz.result_sha256
    );
  end if;
  if authz.status <> 'ready' then
    return jsonb_build_object('status', 'run_closed');
  end if;
  select state into workspace_state
  from public.workspace_state
  where workspace_id = p_workspace_id
  for share;
  if not found or jsonb_typeof(workspace_state->'candidates') <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(authz.result_payload->'candidates') as expected(value)
       where not exists (
         select 1
         from jsonb_array_elements(workspace_state->'candidates') as persisted(value)
         where persisted.value @> (
           expected.value - array['matchScore', 'matchBreakdown', 'draftSubject', 'draftBody']
         )
       )
     ) then
    return jsonb_build_object('status', 'persistence_unverified');
  end if;
  update public.agent_framework_sourcing_authorizations
  set status = 'completed', completed_at = now(), expires_at = now() + interval '24 hours',
      result_payload = jsonb_set(
        jsonb_set(result_payload, '{candidates}', '[]'::jsonb, false),
        '{totalFound}', '0'::jsonb, false
      )
  where framework_run_id = authz.framework_run_id;
  return jsonb_build_object(
    'status', 'completed',
    'framework_run_id', authz.framework_run_id,
    'sourcing_run_id', authz.sourcing_run_id,
    'result_sha256', authz.result_sha256
  );
end;
$$;

create or replace function public.fail_agent_framework_sourcing_effect(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_framework_run_id uuid,
  p_sourcing_run_id uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  authz public.agent_framework_sourcing_authorizations%rowtype;
  sourcing public.sourcing_runs%rowtype;
  failure jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into authz
  from public.agent_framework_sourcing_authorizations
  where workspace_id = p_workspace_id
    and framework_run_id = p_framework_run_id
  for update;
  if not found
     or authz.actor_id is distinct from p_actor_id
     or authz.sourcing_run_id is distinct from p_sourcing_run_id then
    return jsonb_build_object('status', 'not_found');
  end if;
  if authz.status not in ('claimed', 'failed') then
    return jsonb_build_object('status', 'run_closed');
  end if;
  failure := public.fail_sourcing_run(
    p_workspace_id,
    p_actor_id,
    p_sourcing_run_id,
    p_error_code
  );
  if failure->>'status' <> 'failed' then return failure; end if;
  select * into sourcing
  from public.sourcing_runs
  where workspace_id = p_workspace_id
    and actor_id = p_actor_id
    and id = p_sourcing_run_id
  for share;
  if not found or sourcing.status <> 'failed' then
    return jsonb_build_object('status', 'sourcing_incomplete');
  end if;
  update public.agent_framework_sourcing_authorizations
  set status = 'failed', failed_at = now()
  where framework_run_id = authz.framework_run_id
    and status = 'claimed';
  return jsonb_build_object(
    'status', 'failed',
    'framework_run_id', authz.framework_run_id,
    'sourcing_run_id', authz.sourcing_run_id
  );
end;
$$;

create or replace function public.fail_agent_framework_run(
  p_run_id uuid,
  p_lease_id uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  run public.agent_framework_runs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  select * into run from public.agent_framework_runs where id = p_run_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if run.status = 'failed' and run.error_code = p_error_code then
    return jsonb_build_object('status', 'replay');
  end if;
  if run.lease_id is distinct from p_lease_id or run.lease_expires_at <= now() then
    return jsonb_build_object('status', 'lease_invalid');
  end if;
  if run.status not in ('claimed', 'running') then
    return jsonb_build_object('status', 'run_closed');
  end if;
  update public.agent_framework_runs
  set status = 'failed', error_code = p_error_code, finished_at = now()
  where id = run.id;
  return jsonb_build_object('status', 'failed');
end;
$$;

revoke all on function public.claim_agent_framework_run(
  uuid,uuid,uuid,uuid,text,text,uuid,text,text
) from public, anon, authenticated, authenticator;
revoke all on function public.list_agent_framework_heartbeat_targets(uuid)
  from public, anon, authenticated, authenticator;
revoke all on function public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)
  from public, anon, authenticated, authenticator;
revoke all on function public.record_agent_framework_step_receipt(
  uuid,uuid,integer,text,text,text,text
) from public, anon, authenticated, authenticator;
revoke all on function public.complete_agent_framework_run(uuid,uuid,text,text,integer,text)
  from public, anon, authenticated, authenticator;
revoke all on function public.fail_agent_framework_run(uuid,uuid,text)
  from public, anon, authenticated, authenticator;
revoke all on function public.import_agent_workflow_version(
  uuid,uuid,uuid,uuid,uuid,text,integer,jsonb
) from public, anon, authenticated, authenticator;
revoke all on function public.review_agent_workflow_version(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, authenticator;
revoke all on function public.list_agent_framework_workflows(uuid,uuid,uuid)
  from public, anon, authenticated, authenticator;
revoke all on function public.begin_agent_framework_sourcing_run(
  uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text
) from public, anon, authenticated, authenticator;
revoke all on function public.complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated, authenticator;
revoke all on function public.check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, authenticator;
revoke all on function public.ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text)
  from public, anon, authenticated, authenticator;
revoke all on function public.fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated, authenticator;

grant execute on function public.claim_agent_framework_run(
  uuid,uuid,uuid,uuid,text,text,uuid,text,text
) to service_role;
grant execute on function public.list_agent_framework_heartbeat_targets(uuid)
  to service_role;
grant execute on function public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)
  to service_role;
grant execute on function public.record_agent_framework_step_receipt(
  uuid,uuid,integer,text,text,text,text
) to service_role;
grant execute on function public.complete_agent_framework_run(uuid,uuid,text,text,integer,text)
  to service_role;
grant execute on function public.fail_agent_framework_run(uuid,uuid,text)
  to service_role;
grant execute on function public.import_agent_workflow_version(
  uuid,uuid,uuid,uuid,uuid,text,integer,jsonb
) to service_role;
grant execute on function public.review_agent_workflow_version(uuid,uuid,uuid,text,text)
  to service_role;
grant execute on function public.list_agent_framework_workflows(uuid,uuid,uuid)
  to service_role;
grant execute on function public.begin_agent_framework_sourcing_run(
  uuid,uuid,text,jsonb,text,text,text,text,uuid,text,integer,text,text,uuid,text
) to service_role;
grant execute on function public.complete_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,jsonb,jsonb)
  to service_role;
grant execute on function public.check_agent_framework_sourcing_execution(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.ack_agent_framework_sourcing_effect(uuid,uuid,uuid,text,text)
  to service_role;
grant execute on function public.fail_agent_framework_sourcing_effect(uuid,uuid,uuid,uuid,text)
  to service_role;
