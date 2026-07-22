-- 0048_agent_framework_upstream_pin_rotation.sql
--
-- Expand-safe upstream rotation for the private DeerFlow and Flowise runtime
-- authority. Historical instances, receipts, workflows, and runs remain
-- queryable. Every pre-rotation control is atomically invalidated and left
-- dark before any new upstream identity can be configured.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

-- Drop only the superseded pin constraints. The replacement constraints have
-- stable names so a migration replay can distinguish the current contract.
alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_deerflow_commit_check;
alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_flowise_commit_check;
alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_deerflow_commit_pin_check;
alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_flowise_commit_pin_check;

alter table public.agent_framework_runs
  drop constraint if exists agent_framework_runs_deerflow_source_commit_check;
alter table public.agent_framework_runs
  drop constraint if exists agent_framework_runs_flowise_source_commit_check;
alter table public.agent_framework_runs
  drop constraint if exists agent_framework_runs_supported_source_commit_pair_check;

alter table public.agent_framework_configuration_receipts
  drop constraint if exists agent_framework_configuration_receipts_deerflow_source_commit_check;
alter table public.agent_framework_configuration_receipts
  drop constraint if exists agent_framework_configuration_receipts_flowise_source_commit_check;
alter table public.agent_framework_configuration_receipts
  drop constraint if exists agent_framework_configuration_receipts_pin_pair_check;

do $drop_superseded_receipt_pin_constraints$
declare
  item record;
begin
  for item in
    select constraint_row.conname
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
          'public.agent_framework_configuration_receipts'::regclass
      and constraint_row.contype = 'c'
      and (
        pg_catalog.pg_get_constraintdef(constraint_row.oid) like
          '%fabadae4168db81f0eaaf62f209050f978e2f691%'
        or pg_catalog.pg_get_constraintdef(constraint_row.oid) like
          '%bb773ffa710bd22639c4ba2643413a0ea2b679d3%'
      )
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) not like
          '%3c0a45ad772cdba388009b8d5ecad5e48cd22429%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) not like
          '%ed9e100fb71643cd3922b005908f9732bc0e07dc%'
  loop
    execute format(
      'alter table public.agent_framework_configuration_receipts drop constraint %I',
      item.conname
    );
  end loop;
end
$drop_superseded_receipt_pin_constraints$;

-- The 0029 instance source-pair check was unnamed in SQL and therefore has a
-- generated catalog name. Locate it by the two historical pins rather than by
-- relying on a PostgreSQL-generated identifier.
do $drop_superseded_instance_pin_constraints$
declare
  item record;
begin
  for item in
    select constraint_row.conname
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.agent_framework_instances'::regclass
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
        '%fabadae4168db81f0eaaf62f209050f978e2f691%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like
        '%bb773ffa710bd22639c4ba2643413a0ea2b679d3%'
  loop
    execute format(
      'alter table public.agent_framework_instances drop constraint %I',
      item.conname
    );
  end loop;
end
$drop_superseded_instance_pin_constraints$;

-- Old live identities become non-executable historical evidence. Revoked rows
-- stay revoked because the immutable-instance trigger deliberately prevents
-- reopening them.
do $degrade_historical_framework_instances$
declare
  historical_deerflow_pin constant text := 'fabadae4168db81f0eaaf62f209050f978e2f691';
  historical_flowise_pin constant text := 'bb773ffa710bd22639c4ba2643413a0ea2b679d3';
begin
  update public.agent_framework_instances
  set status = 'degraded',
      readiness_sha256 = null,
      last_ready_at = null,
      updated_at = now()
  where source_commit in (historical_deerflow_pin, historical_flowise_pin)
    and status <> 'revoked';
end
$degrade_historical_framework_instances$;

-- Rotate every legacy control as one transaction. Clearing the configuration,
-- digests, and instance IDs prevents an old deployment from becoming active
-- merely by recording a fresh heartbeat. The guarded WHERE makes replay a
-- no-op after a legitimate new-pin configuration or activation.
do $rotate_agent_framework_controls$
declare
  required_deerflow_pin constant text := '3c0a45ad772cdba388009b8d5ecad5e48cd22429';
  required_flowise_pin constant text := 'ed9e100fb71643cd3922b005908f9732bc0e07dc';
begin
  update public.agent_framework_controls
  set execution_enabled = false,
      kill_switch = true,
      required_deerflow_commit = required_deerflow_pin,
      required_flowise_commit = required_flowise_pin,
      required_deerflow_instance_id = null,
      required_flowise_instance_id = null,
      required_deerflow_image_digest = null,
      required_flowise_image_digest = null,
      required_flowise_isolation = null,
      configuration_sha256 = null,
      version = version + 1,
      updated_by = null,
      updated_at = now()
  where required_deerflow_commit is distinct from required_deerflow_pin
     or required_flowise_commit is distinct from required_flowise_pin;
end
$rotate_agent_framework_controls$;

alter table public.agent_framework_controls
  alter column required_deerflow_commit
    set default '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
  alter column required_flowise_commit
    set default 'ed9e100fb71643cd3922b005908f9732bc0e07dc';

alter table public.agent_framework_controls
  add constraint agent_framework_controls_required_deerflow_commit_pin_check
  check (required_deerflow_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429')
  not valid;
alter table public.agent_framework_controls
  validate constraint agent_framework_controls_required_deerflow_commit_pin_check;
alter table public.agent_framework_controls
  add constraint agent_framework_controls_required_flowise_commit_pin_check
  check (required_flowise_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc')
  not valid;
alter table public.agent_framework_controls
  validate constraint agent_framework_controls_required_flowise_commit_pin_check;

-- Old identities remain legal only as degraded/revoked history. New identities
-- may progress through the existing lifecycle.
alter table public.agent_framework_instances
  add constraint agent_framework_instances_supported_source_commit_check
  check (
    (
      framework = 'deerflow'
      and source_commit in (
        'fabadae4168db81f0eaaf62f209050f978e2f691',
        '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
      )
      and (
        source_commit <> 'fabadae4168db81f0eaaf62f209050f978e2f691'
        or status in ('degraded', 'revoked')
      )
    )
    or (
      framework = 'flowise'
      and source_commit in (
        'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
        'ed9e100fb71643cd3922b005908f9732bc0e07dc'
      )
      and (
        source_commit <> 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
        or status in ('degraded', 'revoked')
      )
    )
  ) not valid;
alter table public.agent_framework_instances
  validate constraint agent_framework_instances_supported_source_commit_check;

-- Runs and append-only configuration receipts retain the old pair, while all
-- new rows must use the rotated pair. Mixed generations are never valid.
alter table public.agent_framework_runs
  add constraint agent_framework_runs_supported_source_commit_pair_check
  check (
    (
      deerflow_source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'
      and flowise_source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
    )
    or (
      deerflow_source_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
      and flowise_source_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
    )
  ) not valid;
alter table public.agent_framework_runs
  validate constraint agent_framework_runs_supported_source_commit_pair_check;

alter table public.agent_framework_configuration_receipts
  add constraint agent_framework_configuration_receipts_pin_pair_check
  check (
    (deerflow_source_commit is null and flowise_source_commit is null)
    or (
      deerflow_source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'
      and flowise_source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
    )
    or (
      deerflow_source_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
      and flowise_source_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
    )
  ) not valid;
alter table public.agent_framework_configuration_receipts
  validate constraint agent_framework_configuration_receipts_pin_pair_check;

-- Degraded identities are history, not a current deployment. Build the new
-- narrower uniqueness guard before removing the old broader predicate.
create unique index if not exists agent_framework_instances_one_active_per_kind
  on public.agent_framework_instances (workspace_id, framework)
  where status in ('registered', 'ready', 'paused');
drop index if exists public.agent_framework_instances_one_current_per_kind;

-- Rebind function bodies without changing signatures, owners, SECURITY
-- DEFINER flags, search paths, or grants. Each replacement is shape-asserted:
-- it must find either the old fragment or the already-rotated fragment. This
-- makes the migration replay-safe and fails closed if a prior migration has
-- changed an authority boundary unexpectedly.
create function public.rotate_agent_framework_function_definition_0048(
  p_signature text,
  p_old_fragments text[],
  p_new_fragments text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  target_oid regprocedure;
  definition text;
  fragment_index integer;
begin
  if p_signature is null
     or p_old_fragments is null
     or p_new_fragments is null
     or cardinality(p_old_fragments) is distinct from cardinality(p_new_fragments)
     or cardinality(p_old_fragments) = 0 then
    raise exception 'invalid 0048 function rotation request' using errcode = '22023';
  end if;

  target_oid := to_regprocedure(p_signature);
  if target_oid is null then
    raise exception '0048 authority function is absent: %', p_signature
      using errcode = '55000';
  end if;
  definition := pg_get_functiondef(target_oid);

  -- A guarded rollback intentionally keeps the stricter 0048 predicates but
  -- restores their historical constants. Normalize those constants first so
  -- roll-forward can recognize the already-hardened function shape.
  definition := replace(
    definition,
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
  );
  definition := replace(
    definition,
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'ed9e100fb71643cd3922b005908f9732bc0e07dc'
  );

  for fragment_index in 1..cardinality(p_old_fragments) loop
    if p_old_fragments[fragment_index] is null
       or p_old_fragments[fragment_index] = ''
       or p_new_fragments[fragment_index] is null
       or p_new_fragments[fragment_index] = '' then
      raise exception 'invalid empty 0048 function fragment for %', p_signature
        using errcode = '22023';
    end if;
    if strpos(definition, p_old_fragments[fragment_index]) > 0 then
      definition := replace(
        definition,
        p_old_fragments[fragment_index],
        p_new_fragments[fragment_index]
      );
    elsif strpos(definition, p_new_fragments[fragment_index]) = 0 then
      raise exception '0048 function shape mismatch for % at fragment %',
        p_signature, fragment_index using errcode = '55000';
    end if;
  end loop;

  execute definition;
end;
$function$;

revoke all on function public.rotate_agent_framework_function_definition_0048(
  text,text[],text[]
) from public, anon, authenticated, service_role, authenticator;

select public.rotate_agent_framework_function_definition_0048(
  'public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)',
  array[
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    $fragment$set status = 'revoked',
      readiness_sha256$fragment$
  ],
  array[
    '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
    'ed9e100fb71643cd3922b005908f9732bc0e07dc',
    $fragment$set status = 'degraded',
      readiness_sha256$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid)',
  array[
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
  ],
  array[
    '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
    'ed9e100fb71643cd3922b005908f9732bc0e07dc'
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb)',
  array[
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    $fragment$if not found or flowise.status <> 'ready'$fragment$
  ],
  array[
    'ed9e100fb71643cd3922b005908f9732bc0e07dc',
    $fragment$if not found
     or control.required_flowise_instance_id is distinct from p_flowise_instance_id
     or flowise.status <> 'ready'$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.review_agent_workflow_version(uuid,uuid,uuid,text,text)',
  array[
    $fragment$declare
  workflow public.agent_workflow_versions%rowtype;
begin$fragment$,
    $fragment$if p_decision = 'approve' then
    if workflow.created_by = p_actor_id then$fragment$
  ],
  array[
    $fragment$declare
  workflow public.agent_workflow_versions%rowtype;
  control public.agent_framework_controls%rowtype;
  flowise public.agent_framework_instances%rowtype;
begin$fragment$,
    $fragment$if p_decision = 'approve' then
    select * into control
    from public.agent_framework_controls
    where workspace_id = p_workspace_id
    for share;
    if not found
       or control.required_deerflow_commit <> '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
       or control.required_flowise_commit <> 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
       or control.required_flowise_instance_id is distinct from workflow.framework_instance_id then
      return jsonb_build_object('status', 'configuration_invalid');
    end if;
    select * into flowise
    from public.agent_framework_instances
    where workspace_id = p_workspace_id
      and id = workflow.framework_instance_id
      and framework = 'flowise'
    for share;
    if not found
       or flowise.source_commit <> control.required_flowise_commit
       or flowise.image_digest is distinct from control.required_flowise_image_digest
       or flowise.isolation_mode is distinct from control.required_flowise_isolation
       or flowise.status <> 'ready'
       or flowise.readiness_sha256 is null
       or flowise.last_ready_at is null
       or flowise.last_ready_at < now() - interval '5 minutes' then
      return jsonb_build_object('status', 'workflow_unavailable');
    end if;
    if workflow.created_by = p_actor_id then$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.list_agent_framework_heartbeat_targets(uuid)',
  array[
    $fragment$and instance.status not in ('paused', 'revoked');$fragment$
  ],
  array[
    $fragment$and instance.status not in ('paused', 'revoked')
    and (
      (
        instance.framework = 'deerflow'
        and instance.id = control.required_deerflow_instance_id
        and instance.source_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
      )
      or (
        instance.framework = 'flowise'
        and instance.id = control.required_flowise_instance_id
        and instance.source_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
      )
    );$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)',
  array[
    $fragment$if not found or control.workspace_id is null
     or control.configuration_sha256 is distinct from p_configuration_sha256$fragment$
  ],
  array[
    $fragment$if not found or control.workspace_id is null
     or control.required_deerflow_commit <> '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
     or control.required_flowise_commit <> 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
     or (
       instance.framework = 'deerflow'
       and (
         control.required_deerflow_instance_id is distinct from instance.id
         or control.required_deerflow_image_digest is distinct from instance.image_digest
         or p_source_commit <> '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
       )
     )
     or (
       instance.framework = 'flowise'
       and (
         control.required_flowise_instance_id is distinct from instance.id
         or control.required_flowise_image_digest is distinct from instance.image_digest
         or control.required_flowise_isolation is distinct from instance.isolation_mode
         or p_source_commit <> 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
       )
     )
     or instance.framework not in ('deerflow', 'flowise')
     or control.configuration_sha256 is distinct from p_configuration_sha256$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.enforce_agent_framework_run_control_identity()',
  array[
    $fragment$if not found
     or control.configuration_sha256 is distinct from new.configuration_sha256$fragment$
  ],
  array[
    $fragment$if not found
     or control.required_deerflow_commit <> '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
     or control.required_flowise_commit <> 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
     or control.configuration_sha256 is distinct from new.configuration_sha256$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.agent_framework_run_authority_is_active(uuid)',
  array[
    $fragment$if not found
     or not control.execution_enabled$fragment$
  ],
  array[
    $fragment$if not found
     or control.required_deerflow_commit <> '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
     or control.required_flowise_commit <> 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
     or not control.execution_enabled$fragment$
  ]
);

select public.rotate_agent_framework_function_definition_0048(
  'public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)',
  array[
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    $fragment$if not found or flowise.status <> 'ready'$fragment$,
    $fragment$where workspace_id = p_workspace_id
    and framework = 'deerflow'
    and status = 'ready'$fragment$
  ],
  array[
    '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
    'ed9e100fb71643cd3922b005908f9732bc0e07dc',
    $fragment$if not found
     or control.required_flowise_instance_id is distinct from flowise.id
     or flowise.status <> 'ready'$fragment$,
    $fragment$where workspace_id = p_workspace_id
    and id = control.required_deerflow_instance_id
    and framework = 'deerflow'
    and status = 'ready'$fragment$
  ]
);

drop function public.rotate_agent_framework_function_definition_0048(
  text,text[],text[]
);

-- Historical objects stay directly inaccessible and existing RPC ACLs remain
-- unchanged because CREATE OR REPLACE preserves ownership and grants.
comment on column public.agent_framework_controls.required_deerflow_commit is
  'Exact DeerFlow upstream commit required for all new executable effects.';
comment on column public.agent_framework_controls.required_flowise_commit is
  'Exact Flowise upstream commit required for all new executable effects.';
