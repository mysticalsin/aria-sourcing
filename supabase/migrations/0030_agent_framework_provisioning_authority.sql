-- 0030_agent_framework_provisioning_authority.sql
--
-- Audited control-plane authority for the private DeerFlow and Flowise
-- runtimes. Configuration is fail-closed, exact-identity, CAS protected, and
-- replay safe. The service role can invoke the narrow RPCs but receives no
-- direct table privileges.

alter table public.agent_framework_controls
  add column if not exists required_deerflow_instance_id uuid,
  add column if not exists required_flowise_instance_id uuid;

alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_instance_pair_check;
alter table public.agent_framework_controls
  add constraint agent_framework_controls_required_instance_pair_check check (
    (
      required_deerflow_instance_id is null
      and required_flowise_instance_id is null
    )
    or (
      required_deerflow_instance_id is not null
      and required_flowise_instance_id is not null
      and required_deerflow_instance_id <> required_flowise_instance_id
    )
  );

alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_enabled_instance_pair_check;
alter table public.agent_framework_controls
  add constraint agent_framework_controls_enabled_instance_pair_check check (
    not execution_enabled
    or (
      required_deerflow_instance_id is not null
      and required_flowise_instance_id is not null
    )
  );

alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_deerflow_instance_fkey;
alter table public.agent_framework_controls
  add constraint agent_framework_controls_deerflow_instance_fkey
  foreign key (workspace_id, required_deerflow_instance_id)
  references public.agent_framework_instances (workspace_id, id)
  on delete restrict;

alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_flowise_instance_fkey;
alter table public.agent_framework_controls
  add constraint agent_framework_controls_flowise_instance_fkey
  foreign key (workspace_id, required_flowise_instance_id)
  references public.agent_framework_instances (workspace_id, id)
  on delete restrict;

-- There may be historical revoked identities, but there can be only one
-- current identity for each framework in a workspace. This also closes the
-- race between a successful configuration receipt and later activation.
create unique index if not exists agent_framework_instances_one_current_per_kind
  on public.agent_framework_instances (workspace_id, framework)
  where status <> 'revoked';

create table if not exists public.agent_framework_configuration_receipts (
  change_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  operation text not null check (operation in ('configure', 'activate', 'kill')),
  actor_id uuid not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  expected_control_version bigint not null check (expected_control_version > 0),
  prior_control_version bigint not null check (prior_control_version > 0),
  resulting_control_version bigint not null
    check (resulting_control_version = prior_control_version + 1),
  version_drift boolean not null default false,
  configuration_sha256 text check (
    configuration_sha256 is null or configuration_sha256 ~ '^[0-9a-f]{64}$'
  ),
  prior_deerflow_instance_id uuid,
  prior_flowise_instance_id uuid,
  deerflow_instance_id uuid,
  flowise_instance_id uuid,
  deerflow_source_commit text check (
    deerflow_source_commit is null
    or deerflow_source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'
  ),
  flowise_source_commit text check (
    flowise_source_commit is null
    or flowise_source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
  ),
  deerflow_image_digest text check (
    deerflow_image_digest is null
    or (
      char_length(deerflow_image_digest) <= 460
      and deerflow_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
    )
  ),
  flowise_image_digest text check (
    flowise_image_digest is null
    or (
      char_length(flowise_image_digest) <= 460
      and flowise_image_digest ~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
    )
  ),
  flowise_isolation_mode text check (
    flowise_isolation_mode is null
    or flowise_isolation_mode in (
      'instance-per-workspace',
      'licensed-enterprise-workspace'
    )
  ),
  recorded_at timestamptz not null default now(),
  foreign key (workspace_id, actor_id)
    references public.profiles (workspace_id, id) on delete restrict,
  foreign key (workspace_id, prior_deerflow_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  foreign key (workspace_id, prior_flowise_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  foreign key (workspace_id, deerflow_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  foreign key (workspace_id, flowise_instance_id)
    references public.agent_framework_instances (workspace_id, id) on delete restrict,
  check (
    (operation in ('configure', 'activate') and not version_drift)
    or operation = 'kill'
  ),
  check (
    operation = 'kill'
    or (
      configuration_sha256 is not null
      and deerflow_instance_id is not null
      and flowise_instance_id is not null
      and deerflow_instance_id <> flowise_instance_id
      and deerflow_source_commit is not null
      and flowise_source_commit is not null
      and deerflow_image_digest is not null
      and flowise_image_digest is not null
      and flowise_isolation_mode is not null
    )
  )
);

create index if not exists agent_framework_configuration_receipts_workspace_recorded_idx
  on public.agent_framework_configuration_receipts (workspace_id, recorded_at, change_id);

create or replace function public.reject_agent_framework_configuration_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'agent framework configuration receipts are append-only'
    using errcode = '42501';
end;
$$;

create or replace function public.enforce_agent_framework_run_control_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  control public.agent_framework_controls%rowtype;
begin
  select * into control
  from public.agent_framework_controls
  where workspace_id = new.workspace_id
  for share;
  if not found
     or control.configuration_sha256 is distinct from new.configuration_sha256
     or control.required_deerflow_instance_id is distinct from new.deerflow_instance_id
     or control.required_flowise_instance_id is distinct from new.flowise_instance_id then
    raise exception 'agent framework run does not match provisioned control identity'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_agent_framework_configuration_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.enforce_agent_framework_run_control_identity()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists agent_framework_configuration_receipts_append_only
  on public.agent_framework_configuration_receipts;
create trigger agent_framework_configuration_receipts_append_only
  before update or delete on public.agent_framework_configuration_receipts
  for each row
  execute function public.reject_agent_framework_configuration_receipt_mutation();

drop trigger if exists agent_framework_runs_control_identity
  on public.agent_framework_runs;
create trigger agent_framework_runs_control_identity
  before insert on public.agent_framework_runs
  for each row
  execute function public.enforce_agent_framework_run_control_identity();

alter table public.agent_framework_configuration_receipts enable row level security;
alter table public.agent_framework_configuration_receipts force row level security;
revoke all on public.agent_framework_configuration_receipts
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists agent_framework_configuration_receipts_postgres_all
  on public.agent_framework_configuration_receipts;
create policy agent_framework_configuration_receipts_postgres_all
  on public.agent_framework_configuration_receipts
  for all to postgres using (true) with check (true);

create or replace function public.configure_agent_framework_authority(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_change_id uuid,
  p_expected_control_version bigint,
  p_configuration_sha256 text,
  p_deerflow_instance_id uuid,
  p_deerflow_source_commit text,
  p_deerflow_image_digest text,
  p_flowise_instance_id uuid,
  p_flowise_source_commit text,
  p_flowise_image_digest text,
  p_flowise_isolation_mode text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  nil_uuid constant uuid := '00000000-0000-0000-0000-000000000000';
  required_deerflow_commit constant text := 'fabadae4168db81f0eaaf62f209050f978e2f691';
  required_flowise_commit constant text := 'bb773ffa710bd22639c4ba2643413a0ea2b679d3';
  control public.agent_framework_controls%rowtype;
  receipt public.agent_framework_configuration_receipts%rowtype;
  instance public.agent_framework_instances%rowtype;
  request_hash text;
  next_version bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_workspace_id = nil_uuid
     or p_actor_id is null or p_actor_id = nil_uuid
     or p_change_id is null or p_change_id = nil_uuid
     or p_expected_control_version is null
     or p_expected_control_version < 1
     or p_expected_control_version > 9223372036854775806
     or p_configuration_sha256 is null
     or p_configuration_sha256 !~ '^[0-9a-f]{64}$'
     or p_deerflow_instance_id is null or p_deerflow_instance_id = nil_uuid
     or p_flowise_instance_id is null or p_flowise_instance_id = nil_uuid
     or p_deerflow_instance_id = p_flowise_instance_id
     or p_deerflow_source_commit is distinct from required_deerflow_commit
     or p_flowise_source_commit is distinct from required_flowise_commit
     or p_deerflow_image_digest is null
     or char_length(p_deerflow_image_digest) > 460
     or p_deerflow_image_digest !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
     or p_flowise_image_digest is null
     or char_length(p_flowise_image_digest) > 460
     or p_flowise_image_digest !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$'
     or p_flowise_isolation_mode is null
     or p_flowise_isolation_mode not in (
       'instance-per-workspace',
       'licensed-enterprise-workspace'
     ) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
  from public.profiles
  where workspace_id = p_workspace_id
    and id = p_actor_id
    and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_authorized');
  end if;

  request_hash := encode(digest(convert_to(jsonb_build_array(
    'configure', p_workspace_id, p_actor_id, p_change_id,
    p_expected_control_version, p_configuration_sha256,
    p_deerflow_instance_id, p_deerflow_source_commit, p_deerflow_image_digest,
    p_flowise_instance_id, p_flowise_source_commit, p_flowise_image_digest,
    p_flowise_isolation_mode
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'agent-framework-change:' || p_change_id::text,
    0
  ));
  select * into receipt
  from public.agent_framework_configuration_receipts
  where change_id = p_change_id
  for share;
  if found then
    if receipt.workspace_id = p_workspace_id
       and receipt.operation = 'configure'
       and receipt.request_sha256 = request_hash then
      return jsonb_build_object(
        'status', 'replay',
        'operation', receipt.operation,
        'control_version', receipt.resulting_control_version,
        'configuration_sha256', receipt.configuration_sha256,
        'deerflow_instance_id', receipt.deerflow_instance_id,
        'flowise_instance_id', receipt.flowise_instance_id
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into control
  from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if control.version is distinct from p_expected_control_version then
    return jsonb_build_object(
      'status', 'version_conflict',
      'control_version', control.version
    );
  end if;

  select * into instance
  from public.agent_framework_instances
  where id = p_deerflow_instance_id
  for update;
  if found and (
    instance.workspace_id is distinct from p_workspace_id
    or instance.framework <> 'deerflow'
    or instance.external_instance_ref <> 'deerflow-' || p_deerflow_instance_id::text
    or instance.source_commit <> p_deerflow_source_commit
    or instance.image_digest <> p_deerflow_image_digest
    or instance.isolation_mode <> 'dedicated-worker'
    or instance.status in ('paused', 'revoked')
  ) then
    return jsonb_build_object('status', 'instance_conflict');
  end if;
  select * into instance
  from public.agent_framework_instances
  where id = p_flowise_instance_id
  for update;
  if found and (
    instance.workspace_id is distinct from p_workspace_id
    or instance.framework <> 'flowise'
    or instance.external_instance_ref <> 'flowise-' || p_flowise_instance_id::text
    or instance.source_commit <> p_flowise_source_commit
    or instance.image_digest <> p_flowise_image_digest
    or instance.isolation_mode <> p_flowise_isolation_mode
    or instance.status in ('paused', 'revoked')
  ) then
    return jsonb_build_object('status', 'instance_conflict');
  end if;
  -- The control row remains locked until commit. Existing effect paths take a
  -- SHARE lock on that same row, so rotation linearizes after prior effects
  -- and before all new effects. Retiring both old identities and installing
  -- both new identities is one atomic transaction.
  update public.agent_framework_instances
  set status = 'revoked',
      readiness_sha256 = null,
      last_ready_at = null,
      updated_at = now()
  where workspace_id = p_workspace_id
    and framework = 'deerflow'
    and id <> p_deerflow_instance_id
    and status <> 'revoked';

  update public.agent_framework_instances
  set status = 'revoked',
      readiness_sha256 = null,
      last_ready_at = null,
      updated_at = now()
  where workspace_id = p_workspace_id
    and framework = 'flowise'
    and id <> p_flowise_instance_id
    and status <> 'revoked';

  insert into public.agent_framework_instances (
    id, workspace_id, framework, external_instance_ref, source_commit,
    image_digest, isolation_mode, status, readiness_sha256, last_ready_at,
    created_by
  ) values (
    p_deerflow_instance_id, p_workspace_id, 'deerflow',
    'deerflow-' || p_deerflow_instance_id::text,
    p_deerflow_source_commit, p_deerflow_image_digest, 'dedicated-worker',
    'registered', null, null, p_actor_id
  ) on conflict (id) do update
    set status = 'registered',
        readiness_sha256 = null,
        last_ready_at = null,
        updated_at = now();

  insert into public.agent_framework_instances (
    id, workspace_id, framework, external_instance_ref, source_commit,
    image_digest, isolation_mode, status, readiness_sha256, last_ready_at,
    created_by
  ) values (
    p_flowise_instance_id, p_workspace_id, 'flowise',
    'flowise-' || p_flowise_instance_id::text,
    p_flowise_source_commit, p_flowise_image_digest, p_flowise_isolation_mode,
    'registered', null, null, p_actor_id
  ) on conflict (id) do update
    set status = 'registered',
        readiness_sha256 = null,
        last_ready_at = null,
        updated_at = now();

  next_version := control.version + 1;
  update public.agent_framework_controls
  set execution_enabled = false,
      kill_switch = true,
      required_deerflow_instance_id = p_deerflow_instance_id,
      required_flowise_instance_id = p_flowise_instance_id,
      required_deerflow_commit = p_deerflow_source_commit,
      required_flowise_commit = p_flowise_source_commit,
      required_deerflow_image_digest = p_deerflow_image_digest,
      required_flowise_image_digest = p_flowise_image_digest,
      required_flowise_isolation = p_flowise_isolation_mode,
      configuration_sha256 = p_configuration_sha256,
      version = next_version,
      updated_by = p_actor_id,
      updated_at = now()
  where workspace_id = p_workspace_id;

  insert into public.agent_framework_configuration_receipts (
    change_id, workspace_id, operation, actor_id, request_sha256,
    expected_control_version, prior_control_version,
    resulting_control_version, version_drift, configuration_sha256,
    prior_deerflow_instance_id, prior_flowise_instance_id,
    deerflow_instance_id, flowise_instance_id,
    deerflow_source_commit, flowise_source_commit,
    deerflow_image_digest, flowise_image_digest, flowise_isolation_mode
  ) values (
    p_change_id, p_workspace_id, 'configure', p_actor_id, request_hash,
    p_expected_control_version, control.version, next_version, false,
    p_configuration_sha256,
    control.required_deerflow_instance_id,
    control.required_flowise_instance_id,
    p_deerflow_instance_id, p_flowise_instance_id,
    p_deerflow_source_commit, p_flowise_source_commit,
    p_deerflow_image_digest, p_flowise_image_digest, p_flowise_isolation_mode
  );

  return jsonb_build_object(
    'status', 'configured',
    'control_version', next_version,
    'configuration_sha256', p_configuration_sha256,
    'prior_deerflow_instance_id', control.required_deerflow_instance_id,
    'prior_flowise_instance_id', control.required_flowise_instance_id,
    'deerflow_instance_id', p_deerflow_instance_id,
    'flowise_instance_id', p_flowise_instance_id,
    'execution_enabled', false,
    'kill_switch', true
  );
end;
$$;

create or replace function public.activate_agent_framework_authority(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_change_id uuid,
  p_expected_control_version bigint,
  p_configuration_sha256 text,
  p_deerflow_instance_id uuid,
  p_flowise_instance_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  nil_uuid constant uuid := '00000000-0000-0000-0000-000000000000';
  control public.agent_framework_controls%rowtype;
  deerflow public.agent_framework_instances%rowtype;
  flowise public.agent_framework_instances%rowtype;
  receipt public.agent_framework_configuration_receipts%rowtype;
  request_hash text;
  next_version bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_workspace_id = nil_uuid
     or p_actor_id is null or p_actor_id = nil_uuid
     or p_change_id is null or p_change_id = nil_uuid
     or p_expected_control_version is null
     or p_expected_control_version < 1
     or p_expected_control_version > 9223372036854775806
     or p_configuration_sha256 is null
     or p_configuration_sha256 !~ '^[0-9a-f]{64}$'
     or p_deerflow_instance_id is null or p_deerflow_instance_id = nil_uuid
     or p_flowise_instance_id is null or p_flowise_instance_id = nil_uuid
     or p_deerflow_instance_id = p_flowise_instance_id then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
  from public.profiles
  where workspace_id = p_workspace_id
    and id = p_actor_id
    and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_authorized');
  end if;

  request_hash := encode(digest(convert_to(jsonb_build_array(
    'activate', p_workspace_id, p_actor_id, p_change_id,
    p_expected_control_version, p_configuration_sha256,
    p_deerflow_instance_id, p_flowise_instance_id
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'agent-framework-change:' || p_change_id::text,
    0
  ));
  select * into receipt
  from public.agent_framework_configuration_receipts
  where change_id = p_change_id
  for share;
  if found then
    if receipt.workspace_id = p_workspace_id
       and receipt.operation = 'activate'
       and receipt.request_sha256 = request_hash then
      return jsonb_build_object(
        'status', 'replay',
        'operation', receipt.operation,
        'control_version', receipt.resulting_control_version,
        'configuration_sha256', receipt.configuration_sha256,
        'deerflow_instance_id', receipt.deerflow_instance_id,
        'flowise_instance_id', receipt.flowise_instance_id
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into control
  from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if control.version is distinct from p_expected_control_version then
    return jsonb_build_object(
      'status', 'version_conflict',
      'control_version', control.version
    );
  end if;
  if control.configuration_sha256 is distinct from p_configuration_sha256
     or control.required_deerflow_instance_id is distinct from p_deerflow_instance_id
     or control.required_flowise_instance_id is distinct from p_flowise_instance_id
     or control.required_deerflow_commit <> 'fabadae4168db81f0eaaf62f209050f978e2f691'
     or control.required_flowise_commit <> 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
     or control.required_deerflow_image_digest is null
     or control.required_flowise_image_digest is null
     or control.required_flowise_isolation is null then
    return jsonb_build_object('status', 'configuration_mismatch');
  end if;
  if control.execution_enabled or not control.kill_switch then
    return jsonb_build_object('status', 'state_conflict');
  end if;

  select * into deerflow
  from public.agent_framework_instances
  where workspace_id = p_workspace_id
    and id = p_deerflow_instance_id
    and framework = 'deerflow'
  for share;
  if not found
     or deerflow.status <> 'ready'
     or deerflow.source_commit <> control.required_deerflow_commit
     or deerflow.image_digest <> control.required_deerflow_image_digest
     or deerflow.isolation_mode <> 'dedicated-worker'
     or deerflow.readiness_sha256 is null
     or deerflow.last_ready_at is null
     or deerflow.last_ready_at < now() - interval '5 minutes' then
    return jsonb_build_object('status', 'framework_unavailable', 'framework', 'deerflow');
  end if;

  select * into flowise
  from public.agent_framework_instances
  where workspace_id = p_workspace_id
    and id = p_flowise_instance_id
    and framework = 'flowise'
  for share;
  if not found
     or flowise.status <> 'ready'
     or flowise.source_commit <> control.required_flowise_commit
     or flowise.image_digest <> control.required_flowise_image_digest
     or flowise.isolation_mode <> control.required_flowise_isolation
     or flowise.readiness_sha256 is null
     or flowise.last_ready_at is null
     or flowise.last_ready_at < now() - interval '5 minutes' then
    return jsonb_build_object('status', 'framework_unavailable', 'framework', 'flowise');
  end if;

  next_version := control.version + 1;
  update public.agent_framework_controls
  set execution_enabled = true,
      kill_switch = false,
      version = next_version,
      updated_by = p_actor_id,
      updated_at = now()
  where workspace_id = p_workspace_id;

  insert into public.agent_framework_configuration_receipts (
    change_id, workspace_id, operation, actor_id, request_sha256,
    expected_control_version, prior_control_version,
    resulting_control_version, version_drift, configuration_sha256,
    deerflow_instance_id, flowise_instance_id,
    deerflow_source_commit, flowise_source_commit,
    deerflow_image_digest, flowise_image_digest, flowise_isolation_mode
  ) values (
    p_change_id, p_workspace_id, 'activate', p_actor_id, request_hash,
    p_expected_control_version, control.version, next_version, false,
    control.configuration_sha256,
    control.required_deerflow_instance_id,
    control.required_flowise_instance_id,
    control.required_deerflow_commit,
    control.required_flowise_commit,
    control.required_deerflow_image_digest,
    control.required_flowise_image_digest,
    control.required_flowise_isolation
  );

  return jsonb_build_object(
    'status', 'activated',
    'control_version', next_version,
    'configuration_sha256', control.configuration_sha256,
    'deerflow_instance_id', control.required_deerflow_instance_id,
    'flowise_instance_id', control.required_flowise_instance_id,
    'execution_enabled', true,
    'kill_switch', false
  );
end;
$$;

create or replace function public.engage_agent_framework_kill_switch(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_change_id uuid,
  p_expected_control_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  nil_uuid constant uuid := '00000000-0000-0000-0000-000000000000';
  control public.agent_framework_controls%rowtype;
  receipt public.agent_framework_configuration_receipts%rowtype;
  request_hash text;
  next_version bigint;
  drift boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_workspace_id = nil_uuid
     or p_actor_id is null or p_actor_id = nil_uuid
     or p_change_id is null or p_change_id = nil_uuid
     or p_expected_control_version is null
     or p_expected_control_version < 1
     or p_expected_control_version > 9223372036854775806 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  perform 1
  from public.profiles
  where workspace_id = p_workspace_id
    and id = p_actor_id
    and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_authorized');
  end if;

  request_hash := encode(digest(convert_to(jsonb_build_array(
    'kill', p_workspace_id, p_actor_id, p_change_id,
    p_expected_control_version
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'agent-framework-change:' || p_change_id::text,
    0
  ));
  select * into receipt
  from public.agent_framework_configuration_receipts
  where change_id = p_change_id
  for share;
  if found then
    if receipt.workspace_id = p_workspace_id
       and receipt.operation = 'kill'
       and receipt.request_sha256 = request_hash then
      return jsonb_build_object(
        'status', 'replay',
        'operation', receipt.operation,
        'control_version', receipt.resulting_control_version,
        'version_drift', receipt.version_drift
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into control
  from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  drift := control.version is distinct from p_expected_control_version;
  next_version := control.version + 1;
  update public.agent_framework_controls
  set execution_enabled = false,
      kill_switch = true,
      version = next_version,
      updated_by = p_actor_id,
      updated_at = now()
  where workspace_id = p_workspace_id;

  insert into public.agent_framework_configuration_receipts (
    change_id, workspace_id, operation, actor_id, request_sha256,
    expected_control_version, prior_control_version,
    resulting_control_version, version_drift, configuration_sha256,
    deerflow_instance_id, flowise_instance_id,
    deerflow_source_commit, flowise_source_commit,
    deerflow_image_digest, flowise_image_digest, flowise_isolation_mode
  ) values (
    p_change_id, p_workspace_id, 'kill', p_actor_id, request_hash,
    p_expected_control_version, control.version, next_version, drift,
    control.configuration_sha256,
    control.required_deerflow_instance_id,
    control.required_flowise_instance_id,
    control.required_deerflow_commit,
    control.required_flowise_commit,
    control.required_deerflow_image_digest,
    control.required_flowise_image_digest,
    control.required_flowise_isolation
  );

  return jsonb_build_object(
    'status', 'killed',
    'control_version', next_version,
    'version_drift', drift,
    'execution_enabled', false,
    'kill_switch', true
  );
end;
$$;

create or replace function public.cleanup_agent_framework_authority(
  p_workspace_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  nil_uuid constant uuid := '00000000-0000-0000-0000-000000000000';
  deleted_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_workspace_id = nil_uuid
     or p_limit is null or p_limit < 1 or p_limit > 1000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1 from public.workspaces where id = p_workspace_id for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  with expired as (
    select authz.framework_run_id
    from public.agent_framework_sourcing_authorizations as authz
    where authz.workspace_id = p_workspace_id
      and authz.expires_at <= now()
    order by authz.expires_at, authz.framework_run_id
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from public.agent_framework_sourcing_authorizations as authz
    using expired
    where authz.workspace_id = p_workspace_id
      and authz.framework_run_id = expired.framework_run_id
    returning 1
  )
  select count(*)::integer into deleted_count from deleted;

  return jsonb_build_object('status', 'cleaned', 'deleted', deleted_count);
end;
$$;

create or replace function public.inspect_agent_framework_control_authority(
  p_workspace_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  nil_uuid constant uuid := '00000000-0000-0000-0000-000000000000';
  control public.agent_framework_controls%rowtype;
  deerflow public.agent_framework_instances%rowtype;
  flowise public.agent_framework_instances%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_workspace_id = nil_uuid
     or p_actor_id is null or p_actor_id = nil_uuid then
    return jsonb_build_object('status', 'invalid_request');
  end if;
  perform 1
  from public.profiles
  where workspace_id = p_workspace_id
    and id = p_actor_id
    and role = 'admin'
  for share;
  if not found then
    return jsonb_build_object('status', 'not_authorized');
  end if;
  select * into control
  from public.agent_framework_controls
  where workspace_id = p_workspace_id
  for share;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if control.required_deerflow_instance_id is not null then
    select * into deerflow
    from public.agent_framework_instances
    where workspace_id = p_workspace_id
      and id = control.required_deerflow_instance_id
      and framework = 'deerflow'
    for share;
  end if;
  if control.required_flowise_instance_id is not null then
    select * into flowise
    from public.agent_framework_instances
    where workspace_id = p_workspace_id
      and id = control.required_flowise_instance_id
      and framework = 'flowise'
    for share;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'workspace_id', control.workspace_id,
    'control_version', control.version::text,
    'execution_enabled', control.execution_enabled,
    'kill_switch', control.kill_switch,
    'configuration_sha256', control.configuration_sha256,
    'deerflow_instance_id', control.required_deerflow_instance_id,
    'flowise_instance_id', control.required_flowise_instance_id,
    'deerflow_status', deerflow.status,
    'deerflow_readiness_sha256', deerflow.readiness_sha256,
    'deerflow_last_ready_at', deerflow.last_ready_at,
    'deerflow_fresh', coalesce(
      deerflow.status = 'ready'
      and deerflow.readiness_sha256 is not null
      and deerflow.last_ready_at >= now() - interval '5 minutes',
      false
    ),
    'flowise_status', flowise.status,
    'flowise_readiness_sha256', flowise.readiness_sha256,
    'flowise_last_ready_at', flowise.last_ready_at,
    'flowise_fresh', coalesce(
      flowise.status = 'ready'
      and flowise.readiness_sha256 is not null
      and flowise.last_ready_at >= now() - interval '5 minutes',
      false
    ),
    'updated_at', control.updated_at,
    'updated_by', control.updated_by
  );
end;
$$;

-- Reassert every effect boundary against the exact provisioned instance IDs,
-- not merely image digests that could be shared by another deployment.
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
     or control.required_deerflow_instance_id is distinct from run.deerflow_instance_id
     or control.required_flowise_instance_id is distinct from run.flowise_instance_id
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

revoke all on function public.configure_agent_framework_authority(
  uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.activate_agent_framework_authority(
  uuid,uuid,uuid,bigint,text,uuid,uuid
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.engage_agent_framework_kill_switch(
  uuid,uuid,uuid,bigint
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.cleanup_agent_framework_authority(uuid,integer)
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.inspect_agent_framework_control_authority(uuid,uuid)
  from public, anon, authenticated, service_role, authenticator;

grant execute on function public.configure_agent_framework_authority(
  uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text
) to service_role;
grant execute on function public.activate_agent_framework_authority(
  uuid,uuid,uuid,bigint,text,uuid,uuid
) to service_role;
grant execute on function public.engage_agent_framework_kill_switch(
  uuid,uuid,uuid,bigint
) to service_role;
grant execute on function public.cleanup_agent_framework_authority(uuid,integer)
  to service_role;
grant execute on function public.inspect_agent_framework_control_authority(uuid,uuid)
  to service_role;
