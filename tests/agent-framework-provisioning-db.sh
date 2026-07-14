#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-agent-framework-provisioning-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
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
  ('a3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('b3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces (id, name, allowed_domain) values
  ('11111111-1111-4111-8111-111111111111','Workspace A','a.example.test'),
  ('22222222-2222-4222-8222-222222222222','Workspace B','b.example.test');
insert into public.workspace_state (workspace_id, state) values
  ('11111111-1111-4111-8111-111111111111','{"candidates":[]}'::jsonb),
  ('22222222-2222-4222-8222-222222222222','{"candidates":[]}'::jsonb);
insert into public.profiles (id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','owner-a@example.test','Owner A','11111111-1111-4111-8111-111111111111','member'),
  ('a3000000-0000-4000-8000-000000000003','admin-a@example.test','Admin A','11111111-1111-4111-8111-111111111111','admin'),
  ('b3000000-0000-4000-8000-000000000003','admin-b@example.test','Admin B','22222222-2222-4222-8222-222222222222','admin');

create schema aria_framework_provisioning_test;
revoke all on schema aria_framework_provisioning_test from public;
grant usage on schema aria_framework_provisioning_test to authenticated, service_role;

create function aria_framework_provisioning_test.set_claims(subject uuid, jwt_role text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', jwt_role)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
  perform set_config('request.jwt.claim.role', jwt_role, true);
end;
$$;

create function aria_framework_provisioning_test.assert_scalar(
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

create function aria_framework_provisioning_test.assert_sqlstate(
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

create function aria_framework_provisioning_test.configure_a(
  change_id uuid,
  expected_version bigint,
  configuration_sha256 text default repeat('6', 64)
) returns jsonb language sql set search_path = pg_catalog, public as $$
  select public.configure_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    change_id,
    expected_version,
    configuration_sha256,
    '71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '72000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace'
  );
$$;

create function aria_framework_provisioning_test.activate_a(
  change_id uuid,
  expected_version bigint
) returns jsonb language sql set search_path = pg_catalog, public as $$
  select public.activate_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    change_id,
    expected_version,
    repeat('6', 64),
    '71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002'
  );
$$;

revoke all on all functions in schema aria_framework_provisioning_test from public;
grant execute on all functions in schema aria_framework_provisioning_test to authenticated, service_role;
SQL

# Configuration is same-workspace admin-only, exact, fail-closed, CAS-protected,
# and replay-safe.
psql_stdin <<'SQL'
begin;
select aria_framework_provisioning_test.set_claims(null, 'service_role');
set local role service_role;
select aria_framework_provisioning_test.assert_scalar(
  'an admin from another workspace cannot configure framework authority',
  $$select public.configure_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'b3000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000001',1,repeat('6',64),
    '71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '72000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace'
  )->>'status'$$,
  'not_authorized'
);
select aria_framework_provisioning_test.assert_scalar(
  'a mutable image reference is rejected before any authority mutation',
  $$select public.configure_agent_framework_authority(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000002',1,repeat('6',64),
    '71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow:latest',
    '72000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace'
  )->>'status'$$,
  'invalid_request'
);
select aria_framework_provisioning_test.assert_scalar(
  'exact canonical framework authority is configured',
  $$select aria_framework_provisioning_test.configure_a(
    '81000000-0000-4000-8000-000000000010',1
  )->>'status'$$,
  'configured'
);
select aria_framework_provisioning_test.assert_scalar(
  'configuration replay returns the original receipt',
  $$select aria_framework_provisioning_test.configure_a(
    '81000000-0000-4000-8000-000000000010',1
  )->>'status'$$,
  'replay'
);
select aria_framework_provisioning_test.assert_scalar(
  'a reused change UUID with different material conflicts',
  $$select aria_framework_provisioning_test.configure_a(
    '81000000-0000-4000-8000-000000000010',1,repeat('7',64)
  )->>'status'$$,
  'idempotency_conflict'
);
select aria_framework_provisioning_test.assert_scalar(
  'stale configuration CAS cannot mutate the control',
  $$select aria_framework_provisioning_test.configure_a(
    '81000000-0000-4000-8000-000000000011',1
  )->>'status'$$,
  'version_conflict'
);
reset role;
select aria_framework_provisioning_test.assert_scalar(
  'configuration leaves execution disabled with the kill switch engaged',
  $$select concat(
    version,':',execution_enabled,':',kill_switch,':',configuration_sha256,':',
    required_deerflow_instance_id,':',required_flowise_instance_id
  ) from public.agent_framework_controls
  where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '2:f:t:' || repeat('6',64) || ':71000000-0000-4000-8000-000000000001:72000000-0000-4000-8000-000000000002'
);
select aria_framework_provisioning_test.assert_scalar(
  'exactly one current immutable identity exists per framework',
  $$select string_agg(framework || ':' || status,',' order by framework)
    from public.agent_framework_instances
    where workspace_id='11111111-1111-4111-8111-111111111111'
      and status <> 'revoked'$$,
  'deerflow:registered,flowise:registered'
);
select aria_framework_provisioning_test.assert_scalar(
  'only the successful configuration emitted a receipt',
  $$select count(*)::text from public.agent_framework_configuration_receipts$$,
  '1'
);
commit;
SQL

# Activation requires the exact configured IDs plus fresh readiness from both
# real framework identities.
psql_stdin <<'SQL'
begin;
select aria_framework_provisioning_test.set_claims(null, 'service_role');
set local role service_role;
select aria_framework_provisioning_test.assert_scalar(
  'activation fails before DeerFlow and Flowise are both ready',
  $$select aria_framework_provisioning_test.activate_a(
    '82000000-0000-4000-8000-000000000001',2
  )->>'status'$$,
  'framework_unavailable'
);
select aria_framework_provisioning_test.assert_scalar(
  'DeerFlow readiness binds the configured immutable identity',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','71000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'dedicated-worker',repeat('6',64),repeat('1',64),true
  )->>'status'$$,
  'recorded'
);
select aria_framework_provisioning_test.assert_scalar(
  'Flowise readiness binds the configured immutable identity',
  $$select public.record_agent_framework_readiness(
    '11111111-1111-4111-8111-111111111111','72000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace',repeat('6',64),repeat('2',64),true
  )->>'status'$$,
  'recorded'
);
select aria_framework_provisioning_test.assert_scalar(
  'fresh exact framework identities activate execution',
  $$select aria_framework_provisioning_test.activate_a(
    '82000000-0000-4000-8000-000000000002',2
  )->>'status'$$,
  'activated'
);
select aria_framework_provisioning_test.assert_scalar(
  'activation replay is stable',
  $$select aria_framework_provisioning_test.activate_a(
    '82000000-0000-4000-8000-000000000002',2
  )->>'status'$$,
  'replay'
);
select aria_framework_provisioning_test.assert_scalar(
  'stale activation CAS cannot mutate an active control',
  $$select aria_framework_provisioning_test.activate_a(
    '82000000-0000-4000-8000-000000000003',2
  )->>'status'$$,
  'version_conflict'
);
reset role;
select aria_framework_provisioning_test.assert_scalar(
  'activation advances exactly one version and opens the kill-gated control',
  $$select concat(version,':',execution_enabled,':',kill_switch)
    from public.agent_framework_controls
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '3:t:f'
);
commit;
SQL

# A valid kill request always fails safe, even when the caller's expected
# version is stale. The drift is explicit in the append-only receipt.
psql_stdin <<'SQL'
begin;
select aria_framework_provisioning_test.set_claims(null, 'service_role');
set local role service_role;
select aria_framework_provisioning_test.assert_scalar(
  'a stale-version kill still engages the fail-safe control',
  $$select concat(result->>'status',':',result->>'version_drift')
    from (select public.engage_agent_framework_kill_switch(
      '11111111-1111-4111-8111-111111111111',
      'a3000000-0000-4000-8000-000000000003',
      '83000000-0000-4000-8000-000000000001',1
    ) as result) as killed$$,
  'killed:true'
);
select aria_framework_provisioning_test.assert_scalar(
  'the exact kill replay cannot advance the version twice',
  $$select public.engage_agent_framework_kill_switch(
    '11111111-1111-4111-8111-111111111111',
    'a3000000-0000-4000-8000-000000000003',
    '83000000-0000-4000-8000-000000000001',1
  )->>'status'$$,
  'replay'
);
reset role;
select aria_framework_provisioning_test.assert_scalar(
  'kill atomically disables execution and advances one version',
  $$select concat(version,':',execution_enabled,':',kill_switch)
    from public.agent_framework_controls
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '4:f:t'
);
select aria_framework_provisioning_test.assert_sqlstate(
  'configuration receipts reject mutation',
  $$update public.agent_framework_configuration_receipts
    set expected_control_version=99
    where change_id='81000000-0000-4000-8000-000000000010'$$,
  array['42501']
);
select aria_framework_provisioning_test.assert_sqlstate(
  'configuration receipts reject deletion',
  $$delete from public.agent_framework_configuration_receipts
    where change_id='81000000-0000-4000-8000-000000000010'$$,
  array['42501']
);
commit;
SQL

# Rotation is an audited control-plane operation: an active configuration is
# first linearized behind the control lock, atomically killed, old immutable
# identities are retired, and new canonical IDs are installed disabled.
psql_stdin <<'SQL'
begin;
select aria_framework_provisioning_test.set_claims(null, 'service_role');
set local role service_role;
select aria_framework_provisioning_test.assert_scalar(
  'workspace B initial framework configuration succeeds',
  $$select public.configure_agent_framework_authority(
    '22222222-2222-4222-8222-222222222222',
    'b3000000-0000-4000-8000-000000000003',
    '84000000-0000-4000-8000-000000000001',1,repeat('8',64),
    'b1000000-0000-4000-8000-000000000001',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'b2000000-0000-4000-8000-000000000002',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'licensed-enterprise-workspace'
  )->>'status'$$,
  'configured'
);
select public.record_agent_framework_readiness(
  '22222222-2222-4222-8222-222222222222','b1000000-0000-4000-8000-000000000001',
  'fabadae4168db81f0eaaf62f209050f978e2f691',
  'registry.internal/deerflow@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'dedicated-worker',repeat('8',64),repeat('1',64),true
);
select public.record_agent_framework_readiness(
  '22222222-2222-4222-8222-222222222222','b2000000-0000-4000-8000-000000000002',
  'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
  'registry.internal/flowise@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'licensed-enterprise-workspace',repeat('8',64),repeat('2',64),true
);
select aria_framework_provisioning_test.assert_scalar(
  'workspace B exact identities activate before rotation',
  $$select public.activate_agent_framework_authority(
    '22222222-2222-4222-8222-222222222222',
    'b3000000-0000-4000-8000-000000000003',
    '84000000-0000-4000-8000-000000000002',2,repeat('8',64),
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002'
  )->>'status'$$,
  'activated'
);
select aria_framework_provisioning_test.assert_scalar(
  'active framework rotation atomically installs new immutable identities',
  $$select public.configure_agent_framework_authority(
    '22222222-2222-4222-8222-222222222222',
    'b3000000-0000-4000-8000-000000000003',
    '84000000-0000-4000-8000-000000000003',3,repeat('9',64),
    'b1000000-0000-4000-8000-000000000011',
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'b2000000-0000-4000-8000-000000000012',
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'instance-per-workspace'
  )->>'status'$$,
  'configured'
);
reset role;
select aria_framework_provisioning_test.assert_scalar(
  'rotation leaves the new exact control disabled and kill-engaged',
  $$select concat(
      version,':',execution_enabled,':',kill_switch,':',configuration_sha256,':',
      required_deerflow_instance_id,':',required_flowise_instance_id
    ) from public.agent_framework_controls
    where workspace_id='22222222-2222-4222-8222-222222222222'$$,
  '4:f:t:' || repeat('9',64) || ':b1000000-0000-4000-8000-000000000011:b2000000-0000-4000-8000-000000000012'
);
select aria_framework_provisioning_test.assert_scalar(
  'rotation retires old identities and registers only the new pair',
  $$select string_agg(id::text || ':' || status,',' order by id)
    from public.agent_framework_instances
    where workspace_id='22222222-2222-4222-8222-222222222222'$$,
  'b1000000-0000-4000-8000-000000000001:revoked,' ||
  'b1000000-0000-4000-8000-000000000011:registered,' ||
  'b2000000-0000-4000-8000-000000000002:revoked,' ||
  'b2000000-0000-4000-8000-000000000012:registered'
);
select aria_framework_provisioning_test.assert_scalar(
  'rotation receipt binds both retired and replacement instance IDs',
  $$select concat(
      prior_deerflow_instance_id,':',prior_flowise_instance_id,':',
      deerflow_instance_id,':',flowise_instance_id
    ) from public.agent_framework_configuration_receipts
    where change_id='84000000-0000-4000-8000-000000000003'$$,
  'b1000000-0000-4000-8000-000000000001:b2000000-0000-4000-8000-000000000002:' ||
  'b1000000-0000-4000-8000-000000000011:b2000000-0000-4000-8000-000000000012'
);
commit;
SQL

# The cleanup RPC deletes only expired ephemeral authorization payloads. It
# never deletes the immutable framework run or step receipt.
psql_stdin <<'SQL'
insert into public.agent_specs (id,workspace_id,owner_id,name,role_brief,status)
values (
  '61000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'a1000000-0000-4000-8000-000000000001',
  'Owner A Agent','{"title":"Platform engineer"}','active'
);

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

insert into public.agent_framework_runs (
  id,workspace_id,owner_id,actor_id,spec_id,campaign_id,campaign_fingerprint,
  workflow_version_id,deerflow_instance_id,flowise_instance_id,idempotency_key,
  capability_sha256,configuration_sha256,workflow_sha256,
  deerflow_source_commit,deerflow_image_digest,deerflow_readiness_sha256,deerflow_last_ready_at,
  flowise_source_commit,flowise_image_digest,flowise_isolation_mode,
  flowise_readiness_sha256,flowise_last_ready_at,status,lease_id,lease_expires_at,
  proposal_sha256,finished_at
) values
  (
    '91000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000001','campaign-expired',repeat('4',64),
    '73000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002','cleanup-expired',repeat('5',64),repeat('6',64),
    (select workflow_sha256 from public.agent_workflow_versions where id='73000000-0000-4000-8000-000000000003'),
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',repeat('1',64),now(),
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace',repeat('2',64),now(),'proposed',
    '92000000-0000-4000-8000-000000000001',now()+interval '5 minutes',repeat('9',64),now()
  ),
  (
    '91000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003',
    '61000000-0000-4000-8000-000000000001','campaign-future',repeat('4',64),
    '73000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002','cleanup-future',repeat('7',64),repeat('6',64),
    (select workflow_sha256 from public.agent_workflow_versions where id='73000000-0000-4000-8000-000000000003'),
    'fabadae4168db81f0eaaf62f209050f978e2f691',
    'registry.internal/deerflow@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',repeat('1',64),now(),
    'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
    'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'instance-per-workspace',repeat('2',64),now(),'proposed',
    '92000000-0000-4000-8000-000000000002',now()+interval '5 minutes',repeat('9',64),now()
  );

insert into public.agent_framework_step_receipts (
  workspace_id,run_id,ordinal,node_kind,idempotency_key,request_sha256,response_sha256
) values (
  '11111111-1111-4111-8111-111111111111','91000000-0000-4000-8000-000000000001',
  0,'plan','cleanup-audit-step',repeat('a',64),repeat('b',64)
);

insert into public.sourcing_runs (
  id,workspace_id,actor_id,idempotency_key,request_id,campaign_hmac,
  role_fingerprint,configuration_fingerprint,mode,status,completion_hmac,
  completed_at
) values
  ('93000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'a3000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000001',
   'cleanup-expired',repeat('1',64),repeat('2',64),repeat('3',64),'deterministic',
   'completed',repeat('4',64),now()),
  ('93000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'a3000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000002',
   'cleanup-future',repeat('1',64),repeat('2',64),repeat('3',64),'deterministic',
   'completed',repeat('4',64),now());

insert into public.agent_framework_sourcing_authorizations (
  framework_run_id,workspace_id,owner_id,actor_id,campaign_id,
  campaign_fingerprint,sourcing_count,attempt_count,source_query,
  capability_sha256,status,sourcing_run_id,result_sha256,result_payload,
  claimed_at,ready_at,expires_at
) values
  ('91000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',
   'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003',
   'campaign-expired',repeat('4',64),1,1,'language:TypeScript',repeat('5',64),
   'ready','93000000-0000-4000-8000-000000000001',repeat('6',64),
   '{"candidates":[{"id":"staged-candidate-pii"}],"totalFound":1}',
   now()-interval '1 hour',now()-interval '1 hour',now()-interval '1 second'),
  ('91000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',
   'a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003',
   'campaign-future',repeat('4',64),1,1,'language:TypeScript',repeat('7',64),
   'ready','93000000-0000-4000-8000-000000000002',repeat('8',64),
   '{"candidates":[{"id":"future-candidate"}],"totalFound":1}',
   now(),now(),now()+interval '1 day');
SQL

psql_stdin <<'SQL'
begin;
select aria_framework_provisioning_test.set_claims(null, 'service_role');
set local role service_role;
select aria_framework_provisioning_test.assert_scalar(
  'cleanup cannot cross workspace boundaries',
  $$select concat(result->>'status',':',result->>'deleted')
    from (select public.cleanup_agent_framework_authority(
      '22222222-2222-4222-8222-222222222222',10
    ) as result) as cleaned$$,
  'cleaned:0'
);
select aria_framework_provisioning_test.assert_scalar(
  'bounded cleanup removes the expired staged payload',
  $$select concat(result->>'status',':',result->>'deleted')
    from (select public.cleanup_agent_framework_authority(
      '11111111-1111-4111-8111-111111111111',1
    ) as result) as cleaned$$,
  'cleaned:1'
);
reset role;
select aria_framework_provisioning_test.assert_scalar(
  'only the unexpired replay payload remains',
  $$select concat(count(*),':',(array_agg(framework_run_id order by framework_run_id))[1],':',min(result_payload->'candidates'->0->>'id'))
    from public.agent_framework_sourcing_authorizations
    where workspace_id='11111111-1111-4111-8111-111111111111'$$,
  '1:91000000-0000-4000-8000-000000000002:future-candidate'
);
select aria_framework_provisioning_test.assert_scalar(
  'cleanup preserves immutable framework run audit records',
  $$select count(*)::text from public.agent_framework_runs
    where id in (
      '91000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000002'
    )$$,
  '2'
);
select aria_framework_provisioning_test.assert_scalar(
  'cleanup preserves immutable step receipts',
  $$select count(*)::text from public.agent_framework_step_receipts
    where run_id='91000000-0000-4000-8000-000000000001'$$,
  '1'
);
commit;
SQL

# Runtime effect authority is bound to the exact control instance IDs, even
# when another instance presents the same pinned commit and image digest.
psql_stdin <<'SQL'
begin;
update public.agent_framework_controls
set execution_enabled=true,
    kill_switch=false,
    required_deerflow_instance_id='71000000-0000-4000-8000-000000000001',
    required_flowise_instance_id='72000000-0000-4000-8000-000000000002'
where workspace_id='11111111-1111-4111-8111-111111111111';
select aria_framework_provisioning_test.assert_scalar(
  'an exact provisioned run has active effect authority',
  $$select public.agent_framework_run_authority_is_active(
    '91000000-0000-4000-8000-000000000001'
  )::text$$,
  'true'
);
insert into public.agent_framework_instances (
  id,workspace_id,framework,external_instance_ref,source_commit,image_digest,
  isolation_mode,status,created_by
) values (
  '72000000-0000-4000-8000-000000000099',
  '11111111-1111-4111-8111-111111111111','flowise','revoked-lookalike',
  'bb773ffa710bd22639c4ba2643413a0ea2b679d3',
  'registry.internal/flowise@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'instance-per-workspace','revoked','a3000000-0000-4000-8000-000000000003'
);
update public.agent_framework_controls
set required_flowise_instance_id='72000000-0000-4000-8000-000000000099'
where workspace_id='11111111-1111-4111-8111-111111111111';
select aria_framework_provisioning_test.assert_scalar(
  'a digest-identical but unprovisioned instance invalidates effect authority',
  $$select public.agent_framework_run_authority_is_active(
    '91000000-0000-4000-8000-000000000001'
  )::text$$,
  'false'
);
select aria_framework_provisioning_test.set_claims(null, 'service_role');
set local role service_role;
select aria_framework_provisioning_test.assert_sqlstate(
  'a claim cannot snapshot instance IDs other than the provisioned control IDs',
  $$select public.claim_agent_framework_run(
    '11111111-1111-4111-8111-111111111111',
    'a1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    'campaign-control-id-mismatch',repeat('4',64),
    '73000000-0000-4000-8000-000000000003',
    'control-id-mismatch-claim',repeat('5',64)
  )$$,
  array['42501']
);
rollback;
SQL

# No API role gets table DML; only service_role can execute the narrow RPCs.
psql_stdin <<'SQL'
do $privilege_assertions$
declare
  role_name text;
  table_name text;
  signature text;
begin
  foreach role_name in array array['anon','authenticated','authenticator','service_role'] loop
    foreach table_name in array array[
      'agent_framework_controls',
      'agent_framework_instances',
      'agent_framework_configuration_receipts'
    ] loop
      if has_table_privilege(role_name, 'public.' || table_name, 'SELECT')
         or has_table_privilege(role_name, 'public.' || table_name, 'INSERT')
         or has_table_privilege(role_name, 'public.' || table_name, 'UPDATE')
         or has_table_privilege(role_name, 'public.' || table_name, 'DELETE')
         or has_table_privilege(role_name, 'public.' || table_name, 'TRUNCATE')
         or has_table_privilege(role_name, 'public.' || table_name, 'REFERENCES')
         or has_table_privilege(role_name, 'public.' || table_name, 'TRIGGER') then
        raise exception 'API role % has direct privilege on %', role_name, table_name;
      end if;
    end loop;
  end loop;

  foreach signature in array array[
    'public.configure_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,text,text,uuid,text,text,text)',
    'public.activate_agent_framework_authority(uuid,uuid,uuid,bigint,text,uuid,uuid)',
    'public.engage_agent_framework_kill_switch(uuid,uuid,uuid,bigint)',
    'public.cleanup_agent_framework_authority(uuid,integer)',
    'public.inspect_agent_framework_control_authority(uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', signature, 'EXECUTE') then
      raise exception 'service_role lacks EXECUTE on %', signature;
    end if;
    if has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
       or has_function_privilege('authenticator', signature, 'EXECUTE') then
      raise exception 'browser role can execute %', signature;
    end if;
    if not (select prosecdef from pg_proc where oid=to_regprocedure(signature)) then
      raise exception 'authority RPC is not SECURITY DEFINER: %', signature;
    end if;
    if pg_get_functiondef(to_regprocedure(signature)) !~* 'auth\.role\(\).*service_role' then
      raise exception 'authority RPC lacks an in-body service_role assertion: %', signature;
    end if;
  end loop;
end
$privilege_assertions$;
SQL

# Reapplying the migration does not reset control state or duplicate receipts.
psql_stdin < supabase/migrations/0030_agent_framework_provisioning_authority.sql >/dev/null
psql_stdin <<'SQL'
select aria_framework_provisioning_test.assert_scalar(
  'migration replay preserves the fail-safe control and receipt ledger',
  $$select concat(control.version,':',control.execution_enabled,':',control.kill_switch,':',count(receipt.change_id))
    from public.agent_framework_controls control
    join public.agent_framework_configuration_receipts receipt
      on receipt.workspace_id=control.workspace_id
    where control.workspace_id='11111111-1111-4111-8111-111111111111'
    group by control.version,control.execution_enabled,control.kill_switch$$,
  '4:f:t:3'
);
SQL

echo "RESULT agent-framework-provisioning-db: passed"
