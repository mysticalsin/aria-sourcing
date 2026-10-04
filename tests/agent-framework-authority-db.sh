#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-agent-framework-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "${race_kill_log:-}" "${race_complete_log:-}" \
    "${race_egress_log:-}" "${race_mutate_log:-}"
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -q -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin < "$migration" >/dev/null
done

psql_stdin <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b@example.test','',now(),'{}','{}',now(),now()),
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('a4000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name, allowed_domain) values
  ('11111111-1111-4111-8111-111111111111','Workspace A','example.test');
insert into public.workspace_state (workspace_id, state) values
  ('11111111-1111-4111-8111-111111111111','{"candidates":[]}'::jsonb);
insert into public.profiles (id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','owner-a@example.test','Owner A','11111111-1111-4111-8111-111111111111','member'),
  ('a2000000-0000-4000-8000-000000000002','owner-b@example.test','Owner B','11111111-1111-4111-8111-111111111111','member'),
  ('a3000000-0000-4000-8000-000000000003','admin-a@example.test','Admin A','11111111-1111-4111-8111-111111111111','admin'),
  ('a4000000-0000-4000-8000-000000000004','admin-b@example.test','Admin B','11111111-1111-4111-8111-111111111111','admin');

insert into public.agent_specs (id,workspace_id,owner_id,name,role_brief,status) values
  ('61000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001','Owner A Agent','{"title":"Platform engineer"}','active'),
  ('62000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','a2000000-0000-4000-8000-000000000002','Owner B Agent','{"title":"Security engineer"}','active');

update public.agent_framework_controls
set execution_enabled = false,
    kill_switch = true,
    configuration_sha256 = repeat('6',64),
    required_deerflow_image_digest =
      'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    required_flowise_image_digest =
      'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    required_flowise_isolation = 'instance-per-workspace',
    updated_by = 'a3000000-0000-4000-8000-000000000003'
where workspace_id = '11111111-1111-4111-8111-111111111111';

insert into public.agent_framework_instances (
  id, workspace_id, framework, external_instance_ref, source_commit,
  image_digest, isolation_mode, status, readiness_sha256, last_ready_at, created_by
) values
  (
    '71000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
    'deerflow','deerflow-workspace-a','fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'dedicated-worker','ready',repeat('1',64),now(),'a3000000-0000-4000-8000-000000000003'
  ),
  (
    '72000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
    'flowise','flowise-workspace-a','bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace','ready',repeat('2',64),now(),'a3000000-0000-4000-8000-000000000003'
  );

update public.agent_framework_controls
set required_deerflow_instance_id = '71000000-0000-4000-8000-000000000001',
    required_flowise_instance_id = '72000000-0000-4000-8000-000000000002'
where workspace_id = '11111111-1111-4111-8111-111111111111';

insert into public.agent_workflow_versions (
  id, workspace_id, owner_id, spec_id, framework_instance_id, version,
  external_workflow_ref, workflow_sha256, workflow_json, status,
  created_by, approved_by, approved_at
) values (
  '73000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002',1,'flow-owner-a-v1',
    encode(extensions.digest('{"version":1,"name":"Reviewed sourcing","nodes":[{"id":"plan","kind":"plan"},{"id":"source","kind":"source_reviewed_campaign"},{"id":"report","kind":"report"}],"edges":[{"from":"plan","to":"source"},{"from":"source","to":"report"}]}'::jsonb::text,'sha256'),'hex'),
    '{"version":1,"name":"Reviewed sourcing","nodes":[{"id":"plan","kind":"plan"},{"id":"source","kind":"source_reviewed_campaign"},{"id":"report","kind":"report"}],"edges":[{"from":"plan","to":"source"},{"from":"source","to":"report"}]}',
  'approved','a1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000003',now()
);

create schema aria_agent_framework_test;
revoke all on schema aria_agent_framework_test from public;
grant usage on schema aria_agent_framework_test to authenticated, service_role;

create function aria_agent_framework_test.set_claims(subject uuid, jwt_role text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', jwt_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
  perform set_config('request.jwt.claim.role', jwt_role, true);
end;
$$;

create function aria_agent_framework_test.assert_scalar(
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

create function aria_agent_framework_test.assert_sqlstate(
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

create function aria_agent_framework_test.kill_after_control_hold()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, aria_agent_framework_test, pg_temp
as $$
declare
  result jsonb;
  expected_version bigint;
begin
  select version into expected_version
  from public.agent_framework_controls
  where workspace_id='11111111-1111-4111-8111-111111111111'
  for update;
  perform pg_sleep(2);
  result := public.engage_agent_framework_kill_switch(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '83000000-0000-4000-8000-000000000099',
    expected_version
  );
  return result->>'status';
end;
$$;

create function aria_agent_framework_test.complete_after_control_race()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, aria_agent_framework_test, pg_temp
as $$
declare
  framework_run_id uuid;
  sourcing_run_id uuid;
  result jsonb;
begin
  select framework_run.id, authz.sourcing_run_id
  into framework_run_id, sourcing_run_id
  from public.agent_framework_runs as framework_run
  join public.agent_framework_sourcing_authorizations as authz
    on authz.framework_run_id=framework_run.id
  where framework_run.idempotency_key='run-a';
  result := public.complete_agent_framework_sourcing_effect(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    framework_run_id,
    sourcing_run_id,
    jsonb_build_array(jsonb_build_object(
      'platform','GitHub','query','language:typescript location:montreal','ok',true,
      'candidateCount',1,'skippedCount',0
    )),
    jsonb_build_object(
      'ok',true,'mode','deterministic','campaignId','campaign-a',
      'campaignFingerprint','campaign-state-v1',
      'candidates',jsonb_build_array(jsonb_build_object(
        'id','candidate-race','campaignId','campaign-a','sourcePlatform','GitHub',
        'sourceQuery','language:typescript location:montreal'
      )),
      'totalFound',1,'requestId','framework-race-complete',
      'idempotencyKey',framework_run_id::text,
      'sourcingRunId',sourcing_run_id::text,
      'agentFrameworkRunId',framework_run_id::text,
      'appliedLessonIds',jsonb_build_array('74000000-0000-4000-8000-000000000004')
    )
  );
  return result->>'status';
end;
$$;

create function aria_agent_framework_test.authorize_memory_egress_for_run(
  run_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, aria_agent_framework_test, pg_temp
as $$
declare
  framework_run_id uuid;
  framework_run_lease_id uuid;
begin
  select id, lease_id into framework_run_id, framework_run_lease_id
  from public.agent_framework_runs
  where idempotency_key=run_idempotency_key;
  return public.authorize_agent_framework_memory_egress(
    framework_run_id, framework_run_lease_id
  );
end;
$$;

create function aria_agent_framework_test.release_memory_egress_for_run(
  run_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, aria_agent_framework_test, pg_temp
as $$
declare
  framework_run_id uuid;
  framework_run_lease_id uuid;
  memory_egress_lease_id uuid;
begin
  select run.id, run.lease_id, egress.id
    into framework_run_id, framework_run_lease_id, memory_egress_lease_id
  from public.agent_framework_runs as run
  join public.agent_framework_memory_egress_leases as egress
    on egress.framework_run_id=run.id and egress.run_lease_id=run.lease_id
  where run.idempotency_key=run_idempotency_key;
  return public.release_agent_framework_memory_egress(
    framework_run_id, framework_run_lease_id, memory_egress_lease_id
  );
end;
$$;

revoke all on all functions in schema aria_agent_framework_test from public;
grant execute on all functions in schema aria_agent_framework_test to authenticated, service_role;
SQL

# Heartbeats are service-only and must bind the exact immutable tenant instance
# plus the currently accepted configuration before mutating readiness.
psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'heartbeat inventory returns the two exact registered workspace instances',
  $$select jsonb_array_length(public.list_agent_framework_heartbeat_targets(
      '11111111-1111-4111-8111-111111111111'
    )->'targets')::text$$,
  '2'
);
select aria_agent_framework_test.assert_scalar(
  'configuration drift cannot mutate a registered framework heartbeat',
  $$select public.record_agent_framework_readiness(
      '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
      'fabadae4168db81f0eaaf62f209050f978e2f691',
      'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'dedicated-worker',repeat('0',64),repeat('7',64),false
    )->>'status'$$,
  'identity_mismatch'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'rejected heartbeat leaves prior readiness unchanged',
  $$select concat(status,':',readiness_sha256) from public.agent_framework_instances
    where id='71000000-0000-4000-8000-000000000001'$$,
  'ready:1111111111111111111111111111111111111111111111111111111111111111'
);
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'an exact unhealthy heartbeat degrades and clears fresh readiness',
  $$select public.record_agent_framework_readiness(
      '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
      'fabadae4168db81f0eaaf62f209050f978e2f691',
      'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'dedicated-worker',repeat('6',64),repeat('7',64),false
    )->>'status'$$,
  'recorded'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'degraded heartbeat cannot retain a usable last-ready timestamp',
  $$select concat(status,':',readiness_sha256,':',last_ready_at is null) from public.agent_framework_instances
    where id='71000000-0000-4000-8000-000000000001'$$,
  'degraded:7777777777777777777777777777777777777777777777777777777777777777:t'
);
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'an exact healthy heartbeat restores the same registered instance',
  $$select public.record_agent_framework_readiness(
      '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
      'fabadae4168db81f0eaaf62f209050f978e2f691',
      'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'dedicated-worker',repeat('6',64),repeat('8',64),true
    )->>'status'$$,
  'recorded'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'healthy heartbeat records fresh exact evidence',
  $$select concat(status,':',readiness_sha256,':',last_ready_at is not null) from public.agent_framework_instances
    where id='71000000-0000-4000-8000-000000000001'$$,
  'ready:8888888888888888888888888888888888888888888888888888888888888888:t'
);
update public.agent_framework_instances
set status='paused', readiness_sha256=null, last_ready_at=null
where id='71000000-0000-4000-8000-000000000001';
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'paused instances are removed from the workspace heartbeat inventory',
  $$select jsonb_array_length(public.list_agent_framework_heartbeat_targets(
      '11111111-1111-4111-8111-111111111111'
    )->'targets')::text$$,
  '1'
);
select aria_agent_framework_test.assert_scalar(
  'a direct heartbeat cannot reopen a paused instance',
  $$select public.record_agent_framework_readiness(
      '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
      'fabadae4168db81f0eaaf62f209050f978e2f691',
      'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'dedicated-worker',repeat('6',64),repeat('9',64),true
    )->>'status'$$,
  'state_locked'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'paused instance remains paused after a valid readiness receipt',
  $$select concat(status,':',readiness_sha256 is null,':',last_ready_at is null)
    from public.agent_framework_instances
    where id='71000000-0000-4000-8000-000000000001'$$,
  'paused:t:t'
);
rollback;
SQL

# No browser role can inspect or mutate framework authority or call service RPCs.
psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims('a1000000-0000-4000-8000-000000000001','authenticated');
set local role authenticated;
select aria_agent_framework_test.assert_sqlstate(
  'authenticated cannot read framework controls',
  $$select count(*) from public.agent_framework_controls$$,
  array['42501']
);
select aria_agent_framework_test.assert_sqlstate(
  'authenticated cannot claim a framework run',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',repeat('4',64),'73000000-0000-4000-8000-000000000003','run-a',repeat('5',64)
  )$$,
  array['42501']
);
select aria_agent_framework_test.assert_sqlstate(
  'authenticated cannot authorize framework memory plaintext egress',
  $$select public.authorize_agent_framework_memory_egress(
    gen_random_uuid(),gen_random_uuid()
  )$$,
  array['42501']
);
select aria_agent_framework_test.assert_sqlstate(
  'authenticated cannot import a Flowise workflow version',
  $$select public.import_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002','flow-owner-a-v2',2,
    '{"version":1,"name":"Imported sourcing","nodes":[{"id":"source","kind":"source_reviewed_campaign"}],"edges":[]}'::jsonb
  )$$,
  array['42501']
);
rollback;
SQL

# Flowise authoring stays available while execution is killed, but approval is
# a separate admin act and owners can list only their own latest approval.
psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_sqlstate(
  'service role cannot bypass workflow RPC authority with a direct table read',
  $$select count(*) from public.agent_workflow_versions$$,
  array['42501']
);
select aria_agent_framework_test.assert_scalar(
  'workflow review rejects a null expected hash before authority lookup',
  $$select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a3000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000003',null::text,'approve'
  )->>'status'$$,
  'invalid_request'
);
select aria_agent_framework_test.assert_scalar(
  'workflow review rejects a null decision before authority lookup',
  $$select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a3000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000003',repeat('0',64),null::text
  )->>'status'$$,
  'invalid_request'
);
select aria_agent_framework_test.assert_scalar(
  'admin imports an exact Flowise workflow as draft while execution is disabled',
  $$select public.import_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002','flow-owner-a-v2',2,
    '{"version":1,"name":"Imported sourcing","nodes":[{"id":"source","kind":"source_reviewed_campaign"}],"edges":[]}'::jsonb
  )->>'status'$$,
  'imported'
);
select aria_agent_framework_test.assert_scalar(
  'exact Flowise import replay is idempotent',
  $$select public.import_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002','flow-owner-a-v2',2,
    '{"version":1,"name":"Imported sourcing","nodes":[{"id":"source","kind":"source_reviewed_campaign"}],"edges":[]}'::jsonb
  )->>'status'$$,
  'replay'
);
select aria_agent_framework_test.assert_scalar(
  'same workflow version cannot change compiled authority',
  $$select public.import_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002','flow-owner-a-v2',2,
    '{"version":1,"name":"Changed","nodes":[{"id":"source","kind":"source_reviewed_campaign"}],"edges":[]}'::jsonb
  )->>'status'$$,
  'idempotency_conflict'
);
select aria_agent_framework_test.assert_scalar(
  'workflow author cannot approve the same version',
  $$with imported as (
    select public.import_agent_workflow_version(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000002','flow-owner-a-v2',2,
      '{"version":1,"name":"Imported sourcing","nodes":[{"id":"source","kind":"source_reviewed_campaign"}],"edges":[]}'::jsonb
    ) as result
  )
  select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a3000000-0000-4000-8000-000000000003',
    (result->>'workflow_version_id')::uuid,result->>'workflow_sha256','approve'
  )->>'status' from imported$$,
  'reviewer_conflict'
);
select aria_agent_framework_test.assert_scalar(
  'independent admin approves the exact workflow hash',
  $$with imported as (
    select public.import_agent_workflow_version(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000002','flow-owner-a-v2',2,
      '{"version":1,"name":"Imported sourcing","nodes":[{"id":"source","kind":"source_reviewed_campaign"}],"edges":[]}'::jsonb
    ) as result
  )
  select public.review_agent_workflow_version(
    '11111111-1111-4111-8111-111111111111','a4000000-0000-4000-8000-000000000004',
    (result->>'workflow_version_id')::uuid,result->>'workflow_sha256','approve'
  )->>'status' from imported$$,
  'approved'
);
select aria_agent_framework_test.assert_scalar(
  'owner lists the latest approved workflow for its own spec',
  $$select public.list_agent_framework_workflows(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001'
  )#>>'{workflows,0,external_workflow_ref}'$$,
  'flow-owner-a-v2'
);
select aria_agent_framework_test.assert_scalar(
  'one owner cannot list another owner workflow authority',
  $$select public.list_agent_framework_workflows(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002'
  )->>'status'$$,
  'actor_mismatch'
);
commit;
SQL

# Defaults block execution even when valid, ready instances are registered.
psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'default execution switch and kill switch block a run',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',repeat('4',64),'73000000-0000-4000-8000-000000000003','run-disabled',repeat('5',64)
  )->>'status'$$,
  'framework_disabled'
);
rollback;
SQL

psql_stdin <<'SQL'
update public.agent_framework_controls
set execution_enabled = true,
    kill_switch = false,
    configuration_sha256 = repeat('6',64),
    required_deerflow_image_digest = 'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    required_flowise_image_digest = 'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    required_flowise_isolation = 'instance-per-workspace',
    updated_by = 'a3000000-0000-4000-8000-000000000003',
    version = version + 1,
    updated_at = now()
where workspace_id = '11111111-1111-4111-8111-111111111111';

insert into public.agent_memories (
  id, workspace_id, owner_id, spec_id, kind, content_ciphertext,
  content_sha256, content_byte_count, revision, status, source_type, created_by
) values (
  '75000000-0000-4000-8000-000000000005',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000001',
  'fact',
  'enc:v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:AA==:AA==:AA==',
  repeat('a',64),
  128,
  1,
  'approved',
  'operator',
  'a1000000-0000-4000-8000-000000000001'
);
SQL

# Claim, replay, conflict, owner isolation, lease, append-only receipts, and completion.
psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;

create temporary table aria_framework_claim(result jsonb) on commit drop;
insert into aria_framework_claim(result)
select public.claim_agent_framework_run(
  '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
  'campaign-a',encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),'73000000-0000-4000-8000-000000000003','run-a',repeat('5',64)
);

select aria_agent_framework_test.assert_scalar(
  'exact approved workflow claim succeeds',
  $$select result->>'status' from aria_framework_claim$$,
  'claimed'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'framework claim atomically stores the exact approved memory receipt',
  $$select concat(context.memory_revision,':',context.content_sha256,':',context.position,':',context.byte_count)
      from public.agent_framework_run_memory_context as context
      join aria_framework_claim as claim
        on context.framework_run_id=(claim.result->>'run_id')::uuid$$,
  '1:' || repeat('a',64) || ':0:128'
);
select aria_agent_framework_test.assert_scalar(
  'framework claim marks its memory snapshot attached',
  $$select (run.memory_context_attached_at is not null)::text
      from public.agent_framework_runs as run
      join aria_framework_claim as claim on run.id=(claim.result->>'run_id')::uuid$$,
  'true'
);
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'wrong run lease cannot authorize memory plaintext egress',
  $$select public.authorize_agent_framework_memory_egress(
      (result->>'run_id')::uuid, gen_random_uuid()
    )->>'status' from aria_framework_claim$$,
  'lease_invalid'
);
create temporary table aria_memory_egress(result jsonb) on commit drop;
insert into aria_memory_egress(result)
select public.authorize_agent_framework_memory_egress(
  (result->>'run_id')::uuid, (result->>'lease_id')::uuid
)
from aria_framework_claim;
select aria_agent_framework_test.assert_scalar(
  'exact run lease authorizes one bounded memory plaintext egress',
  $$select concat(result->>'status',':',result->>'replayed') from aria_memory_egress$$,
  'authorized:false'
);
select aria_agent_framework_test.assert_scalar(
  'memory egress authorization is one-shot even while its lease is active',
  $$select public.authorize_agent_framework_memory_egress(
      (select (result->>'run_id')::uuid from aria_framework_claim),
      (select (result->>'lease_id')::uuid from aria_framework_claim)
    )->>'status'$$,
  'lease_invalid'
);
select aria_agent_framework_test.assert_scalar(
  'active memory egress lease blocks a concurrent metadata mutation',
  $$select public.mutate_agent_memory(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000001',1,'edit',null,null,null,null,true,false,null
    )->>'status'$$,
  'memory_in_use'
);
select aria_agent_framework_test.assert_scalar(
  'active memory egress lease blocks content deletion',
  $$select public.delete_agent_memory_content(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000001',1,
      'enc:v2:' || repeat('e',64) || ':AA==:AA==:AA==',repeat('e',64),16
    )->>'status'$$,
  'memory_in_use'
);
select aria_agent_framework_test.assert_scalar(
  'blocked memory operations leave the receipted revision unchanged',
  $$select concat(revision,':',status,':',pinned) from public.agent_memories
    where id='75000000-0000-4000-8000-000000000005'$$,
  '1:approved:f'
);
savepoint before_memory_egress_expiry_drill;
reset role;
update public.agent_framework_memory_egress_leases
   set created_at = clock_timestamp() - interval '2 seconds',
       expires_at = clock_timestamp() - interval '1 second'
 where id=(select (result->>'egress_lease_id')::uuid from aria_memory_egress);
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'an expired egress lease cannot authorize plaintext-derived proposal effects',
  $$select public.release_agent_framework_memory_egress(
      (claim.result->>'run_id')::uuid,(claim.result->>'lease_id')::uuid,
      (egress.result->>'egress_lease_id')::uuid
    )->>'status'
    from aria_framework_claim as claim cross join aria_memory_egress as egress$$,
  'lease_expired'
);
rollback to savepoint before_memory_egress_expiry_drill;
reset role;
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'exact egress lease release is recorded before proposal effects',
  $$select public.release_agent_framework_memory_egress(
      (claim.result->>'run_id')::uuid,(claim.result->>'lease_id')::uuid,
      (egress.result->>'egress_lease_id')::uuid
    )->>'status'
    from aria_framework_claim as claim cross join aria_memory_egress as egress$$,
  'released'
);
savepoint after_memory_egress_release;
select aria_agent_framework_test.assert_scalar(
  'memory mutation resumes after the exact egress lease is released',
  $$select public.mutate_agent_memory(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000001',1,'edit',null,null,null,null,true,false,null
    )->>'status'$$,
  'updated'
);
rollback to savepoint after_memory_egress_release;
select aria_agent_framework_test.assert_scalar(
  'run snapshots both exact framework images, isolation, and readiness receipts',
  $$select concat(
      result->>'deerflow_image_digest',':',result->>'deerflow_readiness_sha256',':',
      result->>'flowise_image_digest',':',result->>'flowise_isolation_mode',':',
      result->>'flowise_readiness_sha256'
    ) from aria_framework_claim$$,
  'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:' ||
  repeat('1',64) ||
  ':registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd:' ||
  'instance-per-workspace:' || repeat('2',64)
);
select aria_agent_framework_test.assert_scalar(
  'unexpired active claim replay cannot reuse the execution lease',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),'73000000-0000-4000-8000-000000000003','run-a',repeat('5',64)
  )->>'status'$$,
  'in_progress'
);
select aria_agent_framework_test.assert_scalar(
  'same idempotency key cannot change campaign authority',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-other',encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),'73000000-0000-4000-8000-000000000003','run-a',repeat('5',64)
  )->>'status'$$,
  'idempotency_conflict'
);
select aria_agent_framework_test.assert_scalar(
  'another owner cannot claim owner A workflow',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a2000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002',
    'campaign-b',repeat('7',64),'73000000-0000-4000-8000-000000000003','run-b',repeat('8',64)
  )->>'status'$$,
  'workflow_unavailable'
);
select aria_agent_framework_test.assert_scalar(
  'wrong lease cannot record a step',
  $$select public.record_agent_framework_step_receipt(
      (result->>'run_id')::uuid, gen_random_uuid(), 0, 'plan', 'step-0', repeat('9',64), repeat('a',64)
    )->>'status' from aria_framework_claim$$,
  'lease_invalid'
);
select aria_agent_framework_test.assert_scalar(
  'exact lease records a content-free step receipt',
  $$select public.record_agent_framework_step_receipt(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, 0, 'plan', 'step-0', repeat('9',64), repeat('a',64)
    )->>'status' from aria_framework_claim$$,
  'recorded'
);
select aria_agent_framework_test.assert_scalar(
  'exact step replay is idempotent',
  $$select public.record_agent_framework_step_receipt(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, 0, 'plan', 'step-0', repeat('9',64), repeat('a',64)
    )->>'status' from aria_framework_claim$$,
  'replay'
);
select aria_agent_framework_test.assert_scalar(
  'same step cannot change its receipt hash',
  $$select public.record_agent_framework_step_receipt(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, 0, 'plan', 'step-0', repeat('9',64), repeat('b',64)
    )->>'status' from aria_framework_claim$$,
  'idempotency_conflict'
);
select aria_agent_framework_test.assert_scalar(
  'proposal reports must be a bounded public response array',
  $$select public.complete_agent_framework_run(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, repeat('c',64),
      encode(extensions.digest(convert_to(repeat('s',43),'UTF8'),'sha256'),'hex'), 5,
      'language:typescript location:montreal', '[]'::jsonb
    )->>'status' from aria_framework_claim$$,
  'invalid_request'
);
select aria_agent_framework_test.assert_scalar(
  'exact lease completes one typed proposal',
  $$select public.complete_agent_framework_run(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, repeat('c',64),
      encode(extensions.digest(convert_to(repeat('s',43),'UTF8'),'sha256'),'hex'), 5,
      'language:typescript location:montreal',
      jsonb_build_array('Run the exact reviewed campaign query.')
    )->>'status' from aria_framework_claim$$,
  'proposed'
);
select aria_agent_framework_test.assert_scalar(
  'completed proposal replay is content-bound',
  $$select public.complete_agent_framework_run(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, repeat('c',64),
      encode(extensions.digest(convert_to(repeat('s',43),'UTF8'),'sha256'),'hex'), 5,
      'language:typescript location:montreal',
      jsonb_build_array('Run the exact reviewed campaign query.')
    )->>'status' from aria_framework_claim$$,
  'replay'
);
select aria_agent_framework_test.assert_scalar(
  'completed proposal reports cannot change on replay',
  $$select public.complete_agent_framework_run(
      (result->>'run_id')::uuid, (result->>'lease_id')::uuid, repeat('c',64),
      encode(extensions.digest(convert_to(repeat('s',43),'UTF8'),'sha256'),'hex'), 5,
      'language:typescript location:montreal',
      jsonb_build_array('Different public report.')
    )->>'status' from aria_framework_claim$$,
  'idempotency_conflict'
);
select aria_agent_framework_test.assert_scalar(
  'wrong sourcing capability cannot consume proposal authority',
  $$select public.begin_agent_framework_sourcing_run(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      'campaign-a','{"title":"Platform engineer","skills":["TypeScript"]}'::jsonb,
      repeat('d',64),'deterministic',null,null,(result->>'run_id')::uuid,'framework-source-1',5,
      encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),
      'language:typescript location:montreal',(result->>'run_id')::uuid,repeat('x',43)
    )->>'status' from aria_framework_claim$$,
  'not_found'
);
create temporary table aria_sourcing_claim(result jsonb) on commit drop;
insert into aria_sourcing_claim(result)
select public.begin_agent_framework_sourcing_run(
  '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
  'campaign-a','{"title":"Platform engineer","skills":["TypeScript"]}'::jsonb,
  repeat('d',64),'deterministic',null,null,(result->>'run_id')::uuid,'framework-source-1',5,
  encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),
  'language:typescript location:montreal',(result->>'run_id')::uuid,repeat('s',43)
)
from aria_framework_claim;
select aria_agent_framework_test.assert_scalar(
  'exact one-time framework authority claims a sourcing run',
  $$select result->>'status' from aria_sourcing_claim$$,
  'claimed'
);
select aria_agent_framework_test.assert_scalar(
  'active sourcing claim replay exposes no new effect authority',
  $$select public.begin_agent_framework_sourcing_run(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      'campaign-a','{"title":"Platform engineer","skills":["TypeScript"]}'::jsonb,
      repeat('d',64),'deterministic',null,null,(f.result->>'run_id')::uuid,'framework-source-1',5,
      encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),
      'language:typescript location:montreal',(f.result->>'run_id')::uuid,repeat('s',43)
    )->>'status' from aria_framework_claim f$$,
  'in_progress'
);
select aria_agent_framework_test.assert_scalar(
  'claimed framework effect is execution-authorized before emergency stop',
  $$select public.check_agent_framework_sourcing_execution(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid
    )->>'status' from aria_framework_claim f cross join aria_sourcing_claim s$$,
  'allowed'
);
reset role;
update public.sourcing_learning_controls
set enabled = true, updated_at = now()
where workspace_id = '11111111-1111-4111-8111-111111111111';
insert into public.sourcing_lessons (
  id, workspace_id, role_fingerprint, platform, query_hmac, query_text,
  status, version, promoted_at, promoted_by, expires_at
)
select
  '74000000-0000-4000-8000-000000000004',
  run.workspace_id,
  run.role_fingerprint,
  'GitHub',
  public.sourcing_authority_hmac(
    run.workspace_id,
    'query:GitHub:language:typescript location:montreal'
  ),
  'language:typescript location:montreal',
  'promoted',
  1,
  now(),
  'a3000000-0000-4000-8000-000000000003',
  now() + interval '30 days'
from public.sourcing_runs as run
join aria_sourcing_claim as claim on run.id = (claim.result->>'run_id')::uuid;
insert into public.sourcing_lesson_reviews (
  workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
  prior_status, new_status, reason_code, lesson_version
) values (
  '11111111-1111-4111-8111-111111111111',
  '74000000-0000-4000-8000-000000000004',
  'a3000000-0000-4000-8000-000000000003',
  'human',
  'framework-lesson-review-1',
  'draft',
  'promoted',
  'reviewed_useful',
  1
);
set local role service_role;
create temporary table aria_framework_effect(query_receipts jsonb, result_payload jsonb) on commit drop;
insert into aria_framework_effect(query_receipts, result_payload)
select
  jsonb_build_array(jsonb_build_object(
    'platform','GitHub','query','language:typescript location:montreal','ok',true,
    'candidateCount',1,'skippedCount',0
  )),
  jsonb_build_object(
    'ok',true,'mode','deterministic','campaignId','campaign-a',
    'campaignFingerprint','campaign-state-v1',
    'candidates',jsonb_build_array(jsonb_build_object(
      'id','candidate-1','campaignId','campaign-a','sourcePlatform','GitHub',
      'sourceQuery','language:typescript location:montreal'
    )),
    'totalFound',1,'requestId','framework-source-1',
    'idempotencyKey',f.result->>'run_id','sourcingRunId',s.result->>'run_id',
    'agentFrameworkRunId',f.result->>'run_id','appliedLessonIds',
    jsonb_build_array('74000000-0000-4000-8000-000000000004')
  )
from aria_framework_claim f cross join aria_sourcing_claim s;
select aria_agent_framework_test.assert_scalar(
  'authorized query count cannot be exceeded at durable completion',
  $$select public.complete_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid,
      jsonb_set(e.query_receipts,'{0,candidateCount}','6'::jsonb),e.result_payload
    )->>'status' from aria_framework_claim f cross join aria_sourcing_claim s cross join aria_framework_effect e$$,
  'authority_changed'
);
select aria_agent_framework_test.assert_scalar(
  'an unbound lesson id cannot enter a durable framework result',
  $$select public.complete_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid,e.query_receipts,
      jsonb_set(e.result_payload,'{appliedLessonIds}',
        '["75000000-0000-4000-8000-000000000005"]'::jsonb)
    )->>'status' from aria_framework_claim f cross join aria_sourcing_claim s cross join aria_framework_effect e$$,
  'result_invalid'
);
reset role;
update public.agent_framework_sourcing_authorizations
set expires_at=now()-interval '1 second'
where framework_run_id=(select (result->>'run_id')::uuid from aria_framework_claim);
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'an expired claimed sourcing authorization cannot complete an effect',
  $$select public.complete_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid,
      e.query_receipts,e.result_payload
    )->>'status' from aria_framework_claim f cross join aria_sourcing_claim s cross join aria_framework_effect e$$,
  'authorization_expired'
);
reset role;
update public.agent_framework_sourcing_authorizations
set expires_at=now()+interval '5 minutes'
where framework_run_id=(select (result->>'run_id')::uuid from aria_framework_claim);
update public.agent_framework_controls set execution_enabled=false, kill_switch=true, version=version+1
where workspace_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'emergency stop revokes an already-claimed sourcing effect',
  $$select public.check_agent_framework_sourcing_execution(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid
    )->>'status' from aria_framework_claim f cross join aria_sourcing_claim s$$,
  'blocked'
);
select aria_agent_framework_test.assert_scalar(
  'emergency stop blocks durable sourcing completion',
  $$select public.complete_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid,e.query_receipts,e.result_payload
    )->>'status' from aria_framework_claim f cross join aria_sourcing_claim s cross join aria_framework_effect e$$,
  'framework_disabled'
);
reset role;
update public.agent_framework_controls set execution_enabled=true, kill_switch=false, version=version+1
where workspace_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
create temporary table aria_sourcing_result(result jsonb) on commit drop;
insert into aria_sourcing_result(result)
select public.complete_agent_framework_sourcing_effect(
  '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
  (f.result->>'run_id')::uuid,(s.result->>'run_id')::uuid,e.query_receipts,e.result_payload
)
from aria_framework_claim f cross join aria_sourcing_claim s cross join aria_framework_effect e;
select aria_agent_framework_test.assert_scalar(
  'provider result is durably staged before browser persistence',
  $$select result->>'status' from aria_sourcing_result$$,
  'result_ready'
);
select aria_agent_framework_test.assert_scalar(
  'the exact promoted lesson receipt is retained in the durable staged result',
  $$select result->'result_payload'->'appliedLessonIds'->>0 from aria_sourcing_result$$,
  '74000000-0000-4000-8000-000000000004'
);
select aria_agent_framework_test.assert_scalar(
  'ack cannot complete before candidate persistence is verified',
  $$select public.ack_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,repeat('s',43),r.result->>'result_sha256'
    )->>'status' from aria_framework_claim f cross join aria_sourcing_result r$$,
  'persistence_unverified'
);
reset role;
update public.workspace_state
set state=jsonb_set(state,'{candidates}','[{"id":"candidate-1","campaignId":"campaign-a","sourcePlatform":"GitHub","sourceQuery":"language:typescript location:montreal"}]'::jsonb),
    updated_at=now()
where workspace_id='11111111-1111-4111-8111-111111111111';
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'persisted candidates atomically acknowledge the staged framework effect',
  $$select public.ack_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,repeat('s',43),r.result->>'result_sha256'
    )->>'status' from aria_framework_claim f cross join aria_sourcing_result r$$,
  'completed'
);
select aria_agent_framework_test.assert_scalar(
  'exact persistence acknowledgement replay is canonical',
  $$select public.ack_agent_framework_sourcing_effect(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      (f.result->>'run_id')::uuid,repeat('s',43),r.result->>'result_sha256'
    )->>'status' from aria_framework_claim f cross join aria_sourcing_result r$$,
  'completed'
);
select aria_agent_framework_test.assert_scalar(
  'closed claim replay cannot recover a lease',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),'73000000-0000-4000-8000-000000000003','run-a',repeat('5',64)
  )->>'status'$$,
  'already_completed'
);
select aria_agent_framework_test.assert_scalar(
  'closed claim replay returns the original public reports',
  $$select (public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',encode(extensions.digest(convert_to('campaign-state-v1','UTF8'),'sha256'),'hex'),'73000000-0000-4000-8000-000000000003','run-a',repeat('5',64)
  )->'reports')::text$$,
  '["Run the exact reviewed campaign query."]'
);
select aria_agent_framework_test.assert_scalar(
  'a second active run is claimed for the kill-switch drill',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',repeat('4',64),'73000000-0000-4000-8000-000000000003','run-kill-active',repeat('5',64)
  )->>'status'$$,
  'claimed'
);
commit;
SQL

# The database revalidates every receipted memory revision immediately before
# egress, then serializes that authorization against an actual concurrent edit.
psql_stdin <<'SQL'
begin;
update public.agent_memories
set content_ciphertext='enc:v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:AA==:AA==:AA==',
    content_sha256=repeat('b',64),
    content_byte_count=64,
    updated_by='a1000000-0000-4000-8000-000000000001'
where id='75000000-0000-4000-8000-000000000005';
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'memory revision drift before egress is rejected',
  $$select aria_agent_framework_test.authorize_memory_egress_for_run(
      'run-kill-active'
    )->>'status'$$,
  'memory_changed'
);
rollback;
SQL

race_egress_log="$(mktemp /tmp/aria-memory-egress-race.XXXXXX)"
race_mutate_log="$(mktemp /tmp/aria-memory-mutate-race.XXXXXX)"
(
  psql_stdin >"$race_egress_log" 2>&1 <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select 'RACE_EGRESS=' || (
  aria_agent_framework_test.authorize_memory_egress_for_run(
    'run-kill-active'
  )->>'status'
);
select pg_sleep(2);
commit;
SQL
) &
race_egress_pid=$!

sleep 0.5

(
  psql_stdin >"$race_mutate_log" 2>&1 <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select 'RACE_MUTATE=' || (
  public.mutate_agent_memory(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000001',1,'edit',null,null,null,null,true,false,null
  )->>'status'
);
commit;
SQL
) &
race_mutate_pid=$!

if ! wait "$race_egress_pid"; then
  echo "memory egress race session failed" >&2
  cat "$race_egress_log" >&2
  exit 1
fi
if ! wait "$race_mutate_pid"; then
  echo "memory mutation race session failed" >&2
  cat "$race_mutate_log" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*RACE_EGRESS=authorized[[:space:]]*$' "$race_egress_log"; then
  echo "memory egress race did not authorize the exact receipted revision" >&2
  cat "$race_egress_log" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*RACE_MUTATE=memory_in_use[[:space:]]*$' "$race_mutate_log"; then
  echo "concurrent memory mutation escaped the committed egress lease" >&2
  cat "$race_mutate_log" >&2
  exit 1
fi

psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'race egress lease is released under its exact run authority',
  $$select aria_agent_framework_test.release_memory_egress_for_run(
      'run-kill-active'
    )->>'status'$$,
  'released'
);
commit;

begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'mutation proceeds after the race egress lease is released',
  $$select public.mutate_agent_memory(
      '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000005',
      'a1000000-0000-4000-8000-000000000001',1,'edit',null,null,null,null,true,false,null
    )->>'status'$$,
  'updated'
);
rollback;
SQL

# A content edit after receipt creation must remain possible, and an empty
# snapshot must stay empty across expired-lease recovery even if memory is
# approved later.
psql_stdin <<'SQL'
begin;
update public.agent_memories
set content_ciphertext='enc:v2:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:AA==:AA==:AA==',
    content_sha256=repeat('b',64),
    content_byte_count=64,
    updated_by='a1000000-0000-4000-8000-000000000001'
where id='75000000-0000-4000-8000-000000000005';
select aria_agent_framework_test.assert_scalar(
  'content can enter a new pending revision after an immutable framework receipt',
  $$select concat(status,':',revision) from public.agent_memories
    where id='75000000-0000-4000-8000-000000000005'$$,
  'pending_review:2'
);

select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
create temporary table aria_zero_memory_claim(result jsonb) on commit drop;
insert into aria_zero_memory_claim(result)
select public.claim_agent_framework_run(
  '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
  'campaign-zero-memory',repeat('e',64),'73000000-0000-4000-8000-000000000003',
  'run-zero-memory',repeat('f',64)
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'zero-memory framework claim still persists an attached snapshot marker',
  $$select concat(
      run.memory_context_attached_at is not null,':',count(context.memory_id)
    )
    from aria_zero_memory_claim as claim
    join public.agent_framework_runs as run on run.id=(claim.result->>'run_id')::uuid
    left join public.agent_framework_run_memory_context as context
      on context.framework_run_id=run.id
    group by run.memory_context_attached_at$$,
  't:0'
);
update public.agent_memories
set status='approved'
where id='75000000-0000-4000-8000-000000000005';
update public.agent_framework_runs
set lease_expires_at=now()-interval '1 second'
where idempotency_key='run-zero-memory';
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'expired zero-memory claim can recover its lease',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-zero-memory',repeat('e',64),'73000000-0000-4000-8000-000000000003',
    'run-zero-memory',repeat('f',64)
  )->>'status'$$,
  'claimed'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'expired zero-memory recovery never selects newly approved memory',
  $$select count(*)::text from public.agent_framework_run_memory_context
    where framework_run_id=(select id from public.agent_framework_runs
      where idempotency_key='run-zero-memory')$$,
  '0'
);
rollback;
SQL

# A real two-session kill-vs-complete race: the kill transaction takes the
# control row first. Completion must wait, re-read the committed kill state,
# and refuse to stage any candidate payload.
psql_stdin <<'SQL'
update public.agent_framework_sourcing_authorizations
set status='claimed',
    result_sha256=null,
    result_payload=null,
    ready_at=null,
    completed_at=null,
    failed_at=null,
    expires_at=now()+interval '5 minutes'
where framework_run_id=(
  select id from public.agent_framework_runs where idempotency_key='run-a'
);
update public.agent_framework_controls
set execution_enabled=true,
    kill_switch=false,
    required_deerflow_instance_id='71000000-0000-4000-8000-000000000001',
    required_flowise_instance_id='72000000-0000-4000-8000-000000000002',
    version=version+1
where workspace_id='11111111-1111-4111-8111-111111111111';
SQL

race_kill_log="$(mktemp /tmp/aria-framework-race-kill.XXXXXX)"
race_complete_log="$(mktemp /tmp/aria-framework-race-complete.XXXXXX)"
(
  psql_stdin >"$race_kill_log" 2>&1 <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select 'RACE_KILL=' || aria_agent_framework_test.kill_after_control_hold();
commit;
SQL
) &
race_kill_pid=$!

# The helper holds the control row for two seconds. Give its psql client time
# to enter the function; if completion wins the race, the assertions below
# fail rather than accepting a non-overlapping execution.
sleep 0.5

(
  psql_stdin >"$race_complete_log" 2>&1 <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select 'RACE_COMPLETE=' || aria_agent_framework_test.complete_after_control_race();
commit;
SQL
) &
race_complete_pid=$!

if ! wait "$race_kill_pid"; then
  echo "kill race session failed" >&2
  cat "$race_kill_log" >&2
  exit 1
fi
if ! wait "$race_complete_pid"; then
  echo "completion race session failed" >&2
  cat "$race_complete_log" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*RACE_KILL=killed[[:space:]]*$' "$race_kill_log"; then
  echo "kill race session did not commit the expected receipt" >&2
  cat "$race_kill_log" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*RACE_COMPLETE=framework_disabled[[:space:]]*$' "$race_complete_log"; then
  echo "completion race session escaped the committed kill" >&2
  cat "$race_complete_log" >&2
  exit 1
fi

psql_stdin <<'SQL'
select aria_agent_framework_test.assert_scalar(
  'kill-first race leaves no staged sourcing effect',
  $$select concat(status,':',result_sha256 is null,':',result_payload is null)
    from public.agent_framework_sourcing_authorizations
    where framework_run_id=(
      select id from public.agent_framework_runs where idempotency_key='run-a'
    )$$,
  'claimed:t:t'
);
select aria_agent_framework_test.assert_scalar(
  'kill-first race commits the fail-safe control',
  $$select concat(execution_enabled,':',kill_switch)
    from public.agent_framework_controls
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'f:t'
);
SQL

psql_stdin <<'SQL'
select aria_agent_framework_test.assert_scalar(
  'step receipts have no free-text content columns',
  $$select count(*)::text from information_schema.columns
     where table_schema='public' and table_name='agent_framework_step_receipts'
       and column_name in ('prompt','candidate','body','payload','request','response')$$,
  '0'
);
update public.agent_framework_controls
set execution_enabled = false, kill_switch = true, version = version + 1
where workspace_id = '11111111-1111-4111-8111-111111111111';
select aria_agent_framework_test.assert_sqlstate(
  'registered framework image identity cannot be rewritten',
  $$update public.agent_framework_instances
      set image_digest='registry.internal/deerflow@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    where id='71000000-0000-4000-8000-000000000001'$$,
  array['42501']
);
SQL

psql_stdin <<'SQL'
begin;
select aria_agent_framework_test.set_claims(null,'service_role');
set local role service_role;
select aria_agent_framework_test.assert_scalar(
  'kill switch blocks a new idempotency key',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',repeat('4',64),'73000000-0000-4000-8000-000000000003','run-killed',repeat('5',64)
  )->>'status'$$,
  'framework_disabled'
);
select aria_agent_framework_test.assert_scalar(
  'kill switch blocks replay of an already active run',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111','a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
    'campaign-a',repeat('4',64),'73000000-0000-4000-8000-000000000003','run-kill-active',repeat('5',64)
  )->>'status'$$,
  'framework_disabled'
);
reset role;
select aria_agent_framework_test.assert_scalar(
  'kill switch blocks a step on an already active lease',
  $$select public.record_agent_framework_step_receipt(
      (select id from public.agent_framework_runs where idempotency_key='run-kill-active'),
      (select lease_id from public.agent_framework_runs where idempotency_key='run-kill-active'),
      0,'plan','killed-step',repeat('9',64),repeat('a',64)
    )->>'status'$$,
  'framework_disabled'
);
rollback;
SQL

psql_stdin < supabase/migrations/0029_agent_framework_authority.sql >/dev/null
psql_stdin < supabase/migrations/0030_agent_framework_provisioning_authority.sql >/dev/null
psql_stdin <<'SQL'
select aria_agent_framework_test.assert_scalar(
  'migration reapply keeps execution disabled and kill active',
  $$select concat(execution_enabled,':',kill_switch) from public.agent_framework_controls
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  'f:t'
);
select aria_agent_framework_test.assert_scalar(
  'legacy Flowise binding remains null after migration replay',
  $$select coalesce(flowise_chatflow_id,'null') from public.agent_specs
    where id='61000000-0000-4000-8000-000000000001'$$,
  'null'
);
SQL

echo "RESULT agent-framework-authority-db: passed"
