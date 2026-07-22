#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-agent-framework-pin-rotation-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
bootstrap_password="local_owner_current_password_00000000000000000"
rotation_migration="supabase/migrations/0048_agent_framework_upstream_pin_rotation.sql"
rotation_rollback="supabase/rollbacks/0048_agent_framework_upstream_pin_rotation.sql"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_db() {
  local database="$1"
  shift
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -q -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d "$database" "$@"
}

psql_stdin() {
  psql_db postgres "$@"
}

apply_pre_rotation_migrations() {
  local database="$1"
  local migration
  for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
    if [[ "$migration" == "$rotation_migration" ]]; then
      continue
    fi
    psql_db "$database" < "$migration" >/dev/null
  done
}

test -f "$rotation_migration"
test -f "$rotation_rollback"
source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority
apply_pre_rotation_migrations postgres
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

# Exercise the clean fallback before fixtures create any new-pin effect. Retry
# both directions, then leave the database on the historical pins for the live
# pre-rotation fixture below.
psql_stdin < "$rotation_migration" >/dev/null
psql_stdin < "$rotation_rollback" >/dev/null
psql_stdin <<'SQL'
do $clean_rollback_assertions$
declare definition text;
begin
  definition := pg_get_functiondef(to_regprocedure(
    'public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)'
  ));
  if strpos(definition,'fabadae4168db81f0eaaf62f209050f978e2f691') = 0
     or strpos(definition,'bb773ffa710bd22639c4ba2643413a0ea2b679d3') = 0
     or strpos(definition,'3c0a45ad772cdba388009b8d5ecad5e48cd22429') > 0
     or strpos(definition,'ed9e100fb71643cd3922b005908f9732bc0e07dc') > 0 then
    raise exception 'clean 0048 rollback left rotated function pins';
  end if;
end
$clean_rollback_assertions$;
SQL
psql_stdin < "$rotation_rollback" >/dev/null
psql_stdin < "$rotation_migration" >/dev/null
psql_stdin <<'SQL'
do $clean_roll_forward_assertions$
declare definition text;
begin
  definition := pg_get_functiondef(to_regprocedure(
    'public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)'
  ));
  if strpos(definition,'3c0a45ad772cdba388009b8d5ecad5e48cd22429') = 0
     or strpos(definition,'ed9e100fb71643cd3922b005908f9732bc0e07dc') = 0 then
    raise exception '0048 roll-forward after clean fallback did not restore pins';
  end if;
end
$clean_roll_forward_assertions$;
SQL
psql_stdin < "$rotation_rollback" >/dev/null

psql_stdin <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@example.test','',now(),'{}','{}',now(),now()),
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('a4000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name, allowed_domain)
values ('11111111-1111-4111-8111-111111111111','Workspace A','example.test');
insert into public.workspace_state (workspace_id, state)
values ('11111111-1111-4111-8111-111111111111','{"candidates":[]}'::jsonb);
insert into public.profiles (id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','owner@example.test','Owner','11111111-1111-4111-8111-111111111111','member'),
  ('a3000000-0000-4000-8000-000000000003','admin-a@example.test','Admin A','11111111-1111-4111-8111-111111111111','admin'),
  ('a4000000-0000-4000-8000-000000000004','admin-b@example.test','Admin B','11111111-1111-4111-8111-111111111111','admin');
insert into public.agent_specs (id,workspace_id,owner_id,name,role_brief,status)
values (
  '61000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'Sourcing Agent','{"title":"Platform engineer"}','active'
);

create schema aria_pin_rotation_test;
revoke all on schema aria_pin_rotation_test from public;
grant usage on schema aria_pin_rotation_test to service_role;

create function aria_pin_rotation_test.set_claims(subject uuid, jwt_role text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', jwt_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
  perform set_config('request.jwt.claim.role', jwt_role, true);
end;
$$;

create function aria_pin_rotation_test.assert_scalar(
  case_name text, statement text, expected text
) returns void language plpgsql set search_path = pg_catalog as $$
declare actual text;
begin
  execute statement into actual;
  if actual is distinct from expected then
    raise exception 'Case "%" returned %, expected %', case_name, actual, expected;
  end if;
end;
$$;

create function aria_pin_rotation_test.assert_sqlstate(
  case_name text, statement text, expected_codes text[]
) returns void language plpgsql set search_path = pg_catalog as $$
declare caught text;
begin
  begin execute statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    if caught = any(expected_codes) then return; end if;
    raise exception 'Case "%" returned SQLSTATE %, expected %', case_name, caught, expected_codes;
  end;
  raise exception 'Case "%" unexpectedly succeeded', case_name;
end;
$$;

revoke all on all functions in schema aria_pin_rotation_test from public;
grant execute on all functions in schema aria_pin_rotation_test to service_role;
SQL

# Establish a valid, active pre-rotation authority plus immutable history.
psql_stdin <<'SQL'
begin;
select aria_pin_rotation_test.set_claims(null,'service_role');
set local role service_role;
select aria_pin_rotation_test.assert_scalar(
  'old pins configure before rotation',
  $$select public.configure_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001',1,repeat('6',64),
    '71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '72000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace'
  )->>'status'$$,
  'configured'
);
select aria_pin_rotation_test.assert_scalar(
  'old DeerFlow readiness records before rotation',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'dedicated-worker',repeat('6',64),repeat('1',64),true
  )->>'status'$$,
  'recorded'
);
select aria_pin_rotation_test.assert_scalar(
  'old Flowise readiness records before rotation',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','72000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace',repeat('6',64),repeat('2',64),true
  )->>'status'$$,
  'recorded'
);
select aria_pin_rotation_test.assert_scalar(
  'old pins activate before rotation',
  $$select public.activate_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000002',2,repeat('6',64),
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002'
  )->>'status'$$,
  'activated'
);
reset role;
commit;

insert into public.agent_workflow_versions (
  id,workspace_id,owner_id,spec_id,framework_instance_id,version,
  external_workflow_ref,workflow_sha256,workflow_json,status,created_by,
  approved_by,approved_at
) values (
  '73000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002',1,'old-approved',
  encode(extensions.digest('{"version":1,"name":"Old approved","nodes":[],"edges":[]}'::jsonb::text,'sha256'),'hex'),
  '{"version":1,"name":"Old approved","nodes":[],"edges":[]}',
  'approved','a3000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000004',now()
),(
  '73000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002',2,'old-draft',
  encode(extensions.digest('{"version":1,"name":"Old draft","nodes":[],"edges":[]}'::jsonb::text,'sha256'),'hex'),
  '{"version":1,"name":"Old draft","nodes":[],"edges":[]}',
  'draft','a3000000-0000-4000-8000-000000000003',null,null
);

begin;
select aria_pin_rotation_test.set_claims(null,'service_role');
set local role service_role;
select aria_pin_rotation_test.assert_scalar(
  'an old-pin run is claimable before rotation',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'campaign-old',repeat('5',64),
    '73000000-0000-4000-8000-000000000001','old-run',repeat('7',64)
  )->>'status'$$,
  'claimed'
);
reset role;
commit;
SQL

psql_stdin < "$rotation_migration" >/dev/null

# Rotation is atomic, preserves history, invalidates all old effects, and
# installs new defaults without creating executable bindings.
psql_stdin <<'SQL'
select aria_pin_rotation_test.assert_scalar(
  'control rotates fail-closed and invalidates the old binding',
  $$select concat_ws(':',version,execution_enabled,kill_switch,
    required_deerflow_commit,required_flowise_commit,
    configuration_sha256,required_deerflow_instance_id,required_flowise_instance_id,
    required_deerflow_image_digest,required_flowise_image_digest,required_flowise_isolation)
    from public.agent_framework_controls
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '4:f:t:3c0a45ad772cdba388009b8d5ecad5e48cd22429:ed9e100fb71643cd3922b005908f9732bc0e07dc'
);
select aria_pin_rotation_test.assert_scalar(
  'old instances remain immutable degraded history',
  $$select string_agg(framework || ':' || status || ':' || coalesce(readiness_sha256,'null'),',' order by framework)
    from public.agent_framework_instances
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'deerflow:degraded:null,flowise:degraded:null'
);
select aria_pin_rotation_test.assert_scalar(
  'old configuration receipts and run remain retained',
  $$select concat(
    (select count(*) from public.agent_framework_configuration_receipts),':',
    (select count(*) from public.agent_framework_runs),':',
    (select count(*) from public.agent_workflow_versions))$$,
  '2:1:2'
);
select aria_pin_rotation_test.assert_scalar(
  'old run authority is dead after rotation',
  $$select public.agent_framework_run_authority_is_active(
    (select id from public.agent_framework_runs where idempotency_key='old-run')
  )::text$$,
  'false'
);
select set_config('request.jwt.claim.role','service_role',false);
set role service_role;
select aria_pin_rotation_test.assert_scalar(
  'no old instance remains a heartbeat target',
  $$select jsonb_array_length(public.list_agent_framework_heartbeat_targets(
    '11111111-1111-4111-8111-111111111111'
  )->'targets')::text$$,
  '0'
);
reset role;
select aria_pin_rotation_test.assert_scalar(
  'all rotation constraints are validated',
  $$select bool_and(convalidated)::text from pg_constraint where conname in (
    'agent_framework_controls_required_deerflow_commit_pin_check',
    'agent_framework_controls_required_flowise_commit_pin_check',
    'agent_framework_instances_supported_source_commit_check',
    'agent_framework_runs_supported_source_commit_pair_check',
    'agent_framework_configuration_receipts_pin_pair_check'
  )$$,
  'true'
);
select aria_pin_rotation_test.assert_scalar(
  'all five stable rotation constraints exist',
  $$select count(*)::text from pg_constraint where conname in (
    'agent_framework_controls_required_deerflow_commit_pin_check',
    'agent_framework_controls_required_flowise_commit_pin_check',
    'agent_framework_instances_supported_source_commit_check',
    'agent_framework_runs_supported_source_commit_pair_check',
    'agent_framework_configuration_receipts_pin_pair_check'
  )$$,
  '5'
);

insert into public.workspaces (id,name,allowed_domain)
values ('22222222-2222-4222-8222-222222222222','Workspace B','b.example.test');
select aria_pin_rotation_test.assert_scalar(
  'new workspace defaults use only the rotated pins and stay dark',
  $$select concat(execution_enabled,':',kill_switch,':',required_deerflow_commit,':',required_flowise_commit)
    from public.agent_framework_controls
    where workspace_id='22222222-2222-4222-8222-222222222222'$$,
  'f:t:3c0a45ad772cdba388009b8d5ecad5e48cd22429:ed9e100fb71643cd3922b005908f9732bc0e07dc'
);
SQL

psql_stdin <<'SQL'
begin;
select aria_pin_rotation_test.set_claims(null,'service_role');
set local role service_role;
select aria_pin_rotation_test.assert_scalar(
  'old configuration pins are rejected after rotation',
  $$select public.configure_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000001',4,repeat('7',64),
    '71000000-0000-4000-8000-000000000011',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '72000000-0000-4000-8000-000000000012',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'instance-per-workspace'
  )->>'status'$$,
  'invalid_request'
);
select aria_pin_rotation_test.assert_scalar(
  'old readiness cannot reopen a degraded instance',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'dedicated-worker',repeat('7',64),repeat('1',64),true
  )->>'status'$$,
  'identity_mismatch'
);
select aria_pin_rotation_test.assert_scalar(
  'old workflow cannot be approved under rotated controls',
  $$select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111',
    'a4000000-0000-4000-8000-000000000004',
    '73000000-0000-4000-8000-000000000002',
    encode(extensions.digest('{"version":1,"name":"Old draft","nodes":[],"edges":[]}'::jsonb::text,'sha256'),'hex'),
    'approve'
  )->>'status'$$,
  'configuration_invalid'
);
select aria_pin_rotation_test.assert_scalar(
  'new pins configure in the same authority contract',
  $$select public.configure_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000002',4,repeat('7',64),
    '71000000-0000-4000-8000-000000000011',
    '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
    'registry.internal/deerflow@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '72000000-0000-4000-8000-000000000012',
    'ed9e100fb71643cd3922b005908f9732bc0e07dc',
    'registry.internal/flowise@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'instance-per-workspace'
  )->>'status'$$,
  'configured'
);
select aria_pin_rotation_test.assert_scalar(
  'old workflow stays unapprovable after a new configuration',
  $$select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111',
    'a4000000-0000-4000-8000-000000000004',
    '73000000-0000-4000-8000-000000000002',
    encode(extensions.digest('{"version":1,"name":"Old draft","nodes":[],"edges":[]}'::jsonb::text,'sha256'),'hex'),
    'approve'
  )->>'status'$$,
  'configuration_invalid'
);
select aria_pin_rotation_test.assert_scalar(
  'new DeerFlow readiness records',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000011',
    '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
    'registry.internal/deerflow@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'dedicated-worker',repeat('7',64),repeat('8',64),true
  )->>'status'$$,
  'recorded'
);
select aria_pin_rotation_test.assert_scalar(
  'new Flowise readiness records',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','72000000-0000-4000-8000-000000000012',
    'ed9e100fb71643cd3922b005908f9732bc0e07dc',
    'registry.internal/flowise@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'instance-per-workspace',repeat('7',64),repeat('9',64),true
  )->>'status'$$,
  'recorded'
);
select aria_pin_rotation_test.assert_scalar(
  'new pins activate after exact readiness',
  $$select public.activate_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000003',5,repeat('7',64),
    '71000000-0000-4000-8000-000000000011',
    '72000000-0000-4000-8000-000000000012'
  )->>'status'$$,
  'activated'
);
select aria_pin_rotation_test.assert_scalar(
  'a new-pin workflow imports',
  $$select public.import_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000012','new-workflow',3,
    '{"version":1,"name":"New workflow","nodes":[],"edges":[]}'::jsonb
  )->>'status'$$,
  'imported'
);
select aria_pin_rotation_test.assert_scalar(
  'a new-pin workflow approves',
  $$with imported as (
    select public.import_agent_workflow_version(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000012','new-workflow',3,
      '{"version":1,"name":"New workflow","nodes":[],"edges":[]}'::jsonb
    ) as result
  )
  select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111',
    'a4000000-0000-4000-8000-000000000004',
    (result->>'workflow_version_id')::uuid,result->>'workflow_sha256','approve'
  )->>'status' from imported$$,
  'approved'
);
select aria_pin_rotation_test.assert_scalar(
  'a new-pin run is claimable',
  $$with imported as (
    select public.import_agent_workflow_version(
      '11111111-1111-4111-8111-111111111111',
      'a1000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000012','new-workflow',3,
      '{"version":1,"name":"New workflow","nodes":[],"edges":[]}'::jsonb
    ) as result
  )
  select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'campaign-new',repeat('a',64),(result->>'workflow_version_id')::uuid,
    'new-run',repeat('b',64)
  )->>'status' from imported$$,
  'claimed'
);
reset role;
commit;
SQL

psql_stdin <<'SQL'
select aria_pin_rotation_test.assert_scalar(
  'new effects carry only the rotated pin pair',
  $$select concat(deerflow_source_commit,':',flowise_source_commit)
    from public.agent_framework_runs where idempotency_key='new-run'$$,
  '3c0a45ad772cdba388009b8d5ecad5e48cd22429:ed9e100fb71643cd3922b005908f9732bc0e07dc'
);
select aria_pin_rotation_test.assert_scalar(
  'old and new instances coexist as degraded history and current authority',
  $$select string_agg(source_commit || ':' || status,',' order by source_commit)
    from public.agent_framework_instances
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '3c0a45ad772cdba388009b8d5ecad5e48cd22429:ready,' ||
  'bb773ffa710bd22639c4ba2643413a0ea2b679d3:degraded,' ||
  'ed9e100fb71643cd3922b005908f9732bc0e07dc:ready,' ||
  'fabadae4168db81f0eaaf62f209050f978e2f691:degraded'
);
select aria_pin_rotation_test.assert_sqlstate(
  'an unsupported instance commit violates the stable constraint',
  $$insert into public.agent_framework_instances (
    id,workspace_id,framework,external_instance_ref,source_commit,image_digest,
    isolation_mode,status,created_by
  ) values (
    '71000000-0000-4000-8000-000000000099',
    '11111111-1111-4111-8111-111111111111','deerflow','unsupported',
    '0000000000000000000000000000000000000000',
    'registry.internal/deerflow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'dedicated-worker','degraded','a3000000-0000-4000-8000-000000000003'
  )$$,
  array['23514']
);
SQL

# Reapplication must not kill or reset a legitimately configured new control.
psql_stdin < "$rotation_migration" >/dev/null
psql_stdin <<'SQL'
select aria_pin_rotation_test.assert_scalar(
  'migration replay preserves post-rotation authority and receipts',
  $$select concat(control.version,':',control.execution_enabled,':',control.kill_switch,':',
    control.configuration_sha256,':',count(receipt.change_id))
    from public.agent_framework_controls control
    join public.agent_framework_configuration_receipts receipt
      on receipt.workspace_id=control.workspace_id
    where control.workspace_id='11111111-1111-4111-8111-111111111111'
    group by control.version,control.execution_enabled,control.kill_switch,control.configuration_sha256$$,
  '6:t:f:' || repeat('7',64) || ':4'
);

do $acl_assertions$
declare signature text;
begin
  foreach signature in array array[
    'public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)',
    'public.activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid)',
    'public.import_agent_workflow_version(uuid,uuid,uuid,uuid,uuid,text,integer,jsonb)',
    'public.review_agent_workflow_version(uuid,uuid,uuid,text,text)',
    'public.record_agent_framework_readiness(uuid,uuid,text,text,text,text,text,boolean)',
    'public.claim_agent_framework_run(uuid,uuid,uuid,uuid,text,text,uuid,text,text)'
  ] loop
    if not has_function_privilege('service_role',signature,'EXECUTE') then
      raise exception 'service_role lost EXECUTE on %', signature;
    end if;
    if has_function_privilege('anon',signature,'EXECUTE')
       or has_function_privilege('authenticated',signature,'EXECUTE')
       or has_function_privilege('authenticator',signature,'EXECUTE') then
      raise exception 'browser role gained EXECUTE on %', signature;
    end if;
    if not (select prosecdef from pg_proc where oid=to_regprocedure(signature)) then
      raise exception 'authority function lost SECURITY DEFINER: %', signature;
    end if;
  end loop;
  if has_function_privilege(
    'service_role',
    'public.claim_agent_framework_run_v0029(uuid,uuid,uuid,uuid,text,text,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'private preserved claim function became executable';
  end if;
end
$acl_assertions$;
SQL

# A rollback after new-pin effects must fail closed and leave authority intact.
if psql_stdin < "$rotation_rollback" >/tmp/aria-pin-rotation-rollback.log 2>&1; then
  echo "guarded rollback unexpectedly accepted a database with new-pin effects" >&2
  exit 1
fi
if ! grep -q "new-pin effects" /tmp/aria-pin-rotation-rollback.log; then
  cat /tmp/aria-pin-rotation-rollback.log >&2
  echo "guarded rollback did not return the expected refusal" >&2
  exit 1
fi
rm -f /tmp/aria-pin-rotation-rollback.log
psql_stdin <<'SQL'
select aria_pin_rotation_test.assert_scalar(
  'refused rollback leaves the new authority intact',
  $$select concat(version,':',execution_enabled,':',kill_switch,':',required_deerflow_commit,':',required_flowise_commit)
    from public.agent_framework_controls
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '6:t:f:3c0a45ad772cdba388009b8d5ecad5e48cd22429:ed9e100fb71643cd3922b005908f9732bc0e07dc'
);
SQL

echo "RESULT agent-framework-pin-rotation-db: passed"
