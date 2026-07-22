-- Guarded, fail-closed rollback for 0048.
--
-- This fallback is allowed only before any new-pin instance, configuration
-- receipt, or run exists. It never deletes historical evidence. Once a new
-- effect exists, roll forward with a later migration instead.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

do $guard_agent_framework_pin_rollback$
begin
  if exists (
    select 1
    from public.agent_framework_controls
    where required_deerflow_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
      and (
        execution_enabled
        or not kill_switch
        or configuration_sha256 is not null
        or required_deerflow_instance_id is not null
        or required_flowise_instance_id is not null
        or required_deerflow_image_digest is not null
        or required_flowise_image_digest is not null
        or required_flowise_isolation is not null
      )
  ) or exists (
    select 1
    from public.agent_framework_instances
    where source_commit in (
      '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
      'ed9e100fb71643cd3922b005908f9732bc0e07dc'
    )
  ) or exists (
    select 1
    from public.agent_framework_configuration_receipts
    where deerflow_source_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
       or flowise_source_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
  ) or exists (
    select 1
    from public.agent_framework_runs
    where deerflow_source_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
       or flowise_source_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc'
  ) then
    raise exception '0048 rollback refused: new-pin effects exist; roll forward'
      using errcode = '55000';
  end if;
end
$guard_agent_framework_pin_rollback$;

alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_deerflow_commit_pin_check;
alter table public.agent_framework_controls
  drop constraint if exists agent_framework_controls_required_flowise_commit_pin_check;

update public.agent_framework_controls
set execution_enabled = false,
    kill_switch = true,
    required_deerflow_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691',
    required_flowise_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    required_deerflow_instance_id = null,
    required_flowise_instance_id = null,
    required_deerflow_image_digest = null,
    required_flowise_image_digest = null,
    required_flowise_isolation = null,
    configuration_sha256 = null,
    version = version + 1,
    updated_by = null,
    updated_at = now()
where required_deerflow_commit = '3c0a45ad772cdba388009b8d5ecad5e48cd22429'
   or required_flowise_commit = 'ed9e100fb71643cd3922b005908f9732bc0e07dc';

alter table public.agent_framework_controls
  alter column required_deerflow_commit
    set default 'fabadae4168db81f0eaaf62f209050f978e2f691',
  alter column required_flowise_commit
    set default 'bb773ffa710bd22639c4ba2643413a0ea2b679d3';
alter table public.agent_framework_controls
  add constraint agent_framework_controls_required_deerflow_commit_pin_check
  check (required_deerflow_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691')
  not valid;
alter table public.agent_framework_controls
  validate constraint agent_framework_controls_required_deerflow_commit_pin_check;
alter table public.agent_framework_controls
  add constraint agent_framework_controls_required_flowise_commit_pin_check
  check (required_flowise_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3')
  not valid;
alter table public.agent_framework_controls
  validate constraint agent_framework_controls_required_flowise_commit_pin_check;

-- The guard above proves that no rotated identities, receipts, or runs exist.
-- Restore the historical generation as the only writable generation so the
-- fallback authority can provision and operate it again. Migration 0048 drops
-- these stable names before recreating its dual-generation history checks.
alter table public.agent_framework_instances
  drop constraint if exists agent_framework_instances_supported_source_commit_check;
alter table public.agent_framework_instances
  add constraint agent_framework_instances_supported_source_commit_check
  check (
    (
      framework = 'deerflow'
      and source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'
    )
    or (
      framework = 'flowise'
      and source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
    )
  ) not valid;
alter table public.agent_framework_instances
  validate constraint agent_framework_instances_supported_source_commit_check;

alter table public.agent_framework_runs
  drop constraint if exists agent_framework_runs_supported_source_commit_pair_check;
alter table public.agent_framework_runs
  add constraint agent_framework_runs_supported_source_commit_pair_check
  check (
    deerflow_source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'
    and flowise_source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
  ) not valid;
alter table public.agent_framework_runs
  validate constraint agent_framework_runs_supported_source_commit_pair_check;

alter table public.agent_framework_configuration_receipts
  drop constraint if exists agent_framework_configuration_receipts_pin_pair_check;
alter table public.agent_framework_configuration_receipts
  add constraint agent_framework_configuration_receipts_pin_pair_check
  check (
    (deerflow_source_commit is null and flowise_source_commit is null)
    or (
      deerflow_source_commit = 'fabadae4168db81f0eaaf62f209050f978e2f691'
      and flowise_source_commit = 'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
    )
  ) not valid;
alter table public.agent_framework_configuration_receipts
  validate constraint agent_framework_configuration_receipts_pin_pair_check;

-- Keep the stricter 0048 instance-ID and workflow gates during fallback. Only
-- their exact upstream constants move back. This is safer than reopening the
-- broader 0030 selection behavior and preserves every function signature/ACL.
do $restore_historical_agent_framework_function_pins$
declare
  signature text;
  target_oid regprocedure;
  definition text;
begin
  foreach signature in array array[
    'public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)',
    'public.activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid)',
    'public.import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb)',
    'public.review_agent_workflow_version(uuid,uuid,uuid,text,text)',
    'public.list_agent_framework_heartbeat_targets(uuid)',
    'public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)',
    'public.enforce_agent_framework_run_control_identity()',
    'public.agent_framework_run_authority_is_active(uuid)',
    'public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'
  ] loop
    target_oid := to_regprocedure(signature);
    if target_oid is null then
      raise exception '0048 rollback authority function is absent: %', signature
        using errcode = '55000';
    end if;
    definition := pg_get_functiondef(target_oid);
    if strpos(definition, '3c0a45ad772cdba388009b8d5ecad5e48cd22429') > 0 then
      definition := replace(
        definition,
        '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
        'fabadae4168db81f0eaaf62f209050f978e2f691'
      );
    elsif strpos(definition, 'fabadae4168db81f0eaaf62f209050f978e2f691') = 0
          and signature not like '%import_agent_workflow_version%'
          and signature not like '%review_agent_workflow_version%'
          and signature not like '%list_agent_framework_heartbeat_targets%'
          and signature not like '%record_agent_framework_readiness%' then
      raise exception '0048 rollback DeerFlow function shape mismatch: %', signature
        using errcode = '55000';
    end if;
    if strpos(definition, 'ed9e100fb71643cd3922b005908f9732bc0e07dc') > 0 then
      definition := replace(
        definition,
        'ed9e100fb71643cd3922b005908f9732bc0e07dc',
        'bb773ffa710bd22639c4ba2643413a0ea2b679d3'
      );
    elsif strpos(definition, 'bb773ffa710bd22639c4ba2643413a0ea2b679d3') = 0 then
      raise exception '0048 rollback Flowise function shape mismatch: %', signature
        using errcode = '55000';
    end if;
    execute definition;
  end loop;
end
$restore_historical_agent_framework_function_pins$;

commit;
