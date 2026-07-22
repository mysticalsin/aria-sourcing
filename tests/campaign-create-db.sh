#!/usr/bin/env bash
# Disposable-Postgres proof for 0052 campaign_create authority (Plan 05).
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-campaign-create-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -n "${race_log_dir:-}" ]; then
    rm -rf "$race_log_dir"
  fi
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null
db_container="$(docker compose -p "$project" ps -q db)"
if [ -z "$db_container" ]; then
  echo "campaign-create-db: database container was not found" >&2
  exit 1
fi

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

psql_concurrent() {
  docker exec -i \
    --env PGPASSWORD="$bootstrap_password" \
    "$db_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin --single-transaction -q < "$migration"
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema cc_test;
create table cc_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table cc_test.race_context (
  race_name text primary key,
  job_id uuid not null,
  lease_id uuid not null,
  requisition_id uuid not null
);
create table cc_test.concurrent_outcomes (
  race_name text not null,
  participant text not null,
  outcome text not null,
  primary key (race_name, participant)
);

create function cc_test.expect(
  p_case_name text, p_passed boolean, p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, cc_test
as $$
begin
  insert into cc_test.results(case_name, passed, detail) values (p_case_name, p_passed, p_detail);
end;
$$;

create function cc_test.expect_scalar(
  p_case_name text, p_statement text, p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, cc_test
as $$
declare actual text;
begin
  execute p_statement into actual;
  perform cc_test.expect(
    p_case_name, actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function cc_test.expect_sqlstate(
  p_case_name text, p_statement text, p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, cc_test
as $$
declare caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform cc_test.expect(p_case_name, caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text));
    return;
  end;
  perform cc_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function cc_test.set_service_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function cc_test.seed_parse_receipt(p_requisition_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public, cc_test
as $$
declare
  requisition_row public.requisitions%rowtype;
  parse_job_id uuid := gen_random_uuid();
  parse_lease_id uuid := gen_random_uuid();
  parse_payload jsonb;
begin
  select * into requisition_row
    from public.requisitions
   where id = p_requisition_id;
  if not found then
    raise exception 'missing requisition fixture %', p_requisition_id;
  end if;

  parse_payload := jsonb_build_object('requisition_id', p_requisition_id::text);
  insert into public.aria_jobs (
    id, workspace_id, kind, idempotency_key, payload, payload_sha256,
    status, result_sha256
  ) values (
    parse_job_id,
    requisition_row.workspace_id,
    'requisition_parse',
    'cc-parse:' || p_requisition_id::text,
    parse_payload,
    encode(sha256(convert_to(parse_payload::text, 'UTF8')), 'hex'),
    'succeeded',
    requisition_row.parse_result_sha256
  );

  insert into public.requisition_parse_receipts (
    job_id, lease_id, workspace_id, requisition_id,
    input_sha256, result_sha256, provider, model, ready
  ) values (
    parse_job_id, parse_lease_id, requisition_row.workspace_id, requisition_row.id,
    requisition_row.parse_input_sha256, requisition_row.parse_result_sha256,
    'cc-test-provider', 'cc-test-model', true
  );
end;
$$;

grant usage on schema cc_test to service_role, authenticated;
grant execute on all functions in schema cc_test to service_role, authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cc-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('c2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cc-member@example.test', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, allowed_domain) values
  ('53333333-3333-4333-8333-333333333333', 'Campaign create WS', 'cc.example.test'),
  ('54444444-4444-4444-8444-444444444444', 'Other tenant', 'cc-other.example.test');
insert into public.workspace_state(workspace_id, state) values
  ('53333333-3333-4333-8333-333333333333', '{"version":17,"campaigns":[],"candidates":[],"unrelated":"preserve-me"}'),
  ('54444444-4444-4444-8444-444444444444', '{"version":17,"campaigns":[],"candidates":[]}');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c2000000-0000-4000-8000-000000000001', 'cc-admin@example.test', 'CC Admin',
   '53333333-3333-4333-8333-333333333333', 'admin'),
  ('c2000000-0000-4000-8000-000000000002', 'cc-member@example.test', 'CC Member',
   '53333333-3333-4333-8333-333333333333', 'member');

update public.sourcing_loop_controls
   set kill_switch = false, sourcing_enabled = true, max_sourcing_runs_per_day = 5,
       updated_by = 'c2000000-0000-4000-8000-000000000001'
 where workspace_id = '53333333-3333-4333-8333-333333333333';

-- ---------------------------------------------------------------------------
-- REQ1: the happy-path requisition. `regions` is plural and carries two
-- values (never a singular `region`); employmentType is the literal parser
-- placeholder "Unspecified", locationType is blank after trim, and timezone
-- is null -- all three are absence markers that must never reach the
-- campaign's role basis. seniority is genuinely grounded and must survive.
-- ---------------------------------------------------------------------------
insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256, campaign_id
) values (
  '56111111-1111-4111-8111-111111111111', '53333333-3333-4333-8333-333333333333',
  'api', 'cc-test-req-1', 'ready',
  '{"title":"Senior Data Engineer","seniority":"Senior","employmentType":"Unspecified","locationType":"  ","regions":["Canada","USA"],"timezone":null,"requiredSkills":["Python","SQL"]}'::jsonb,
  encode(sha256('cc-req-1-input'::bytea), 'hex'),
  encode(sha256(convert_to(jsonb_build_object(
    'job_analysis', '{"title":"Senior Data Engineer","seniority":"Senior","employmentType":"Unspecified","locationType":"  ","regions":["Canada","USA"],"timezone":null,"requiredSkills":["Python","SQL"]}'::jsonb,
    'warnings', '[]'::jsonb
  )::text, 'UTF8')), 'hex'),
  null
);
select cc_test.seed_parse_receipt('56111111-1111-4111-8111-111111111111');

set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56111111-1111-4111-8111-111111111111',
  jsonb_build_object('requisition_id', '56111111-1111-4111-8111-111111111111')
);
-- A dummy non-campaign_create job exercises the wrong_kind branch below.
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'email_sync',
  'email_sync:cc-dummy-0001',
  '{}'::jsonb
);
create temporary table claimed1 as
select * from public.claim_due_aria_jobs('worker-cc-1', 120, array['campaign_create'], 10);
reset role;
create temporary table dummy_kind_job as
select * from public.aria_jobs
 where workspace_id = '53333333-3333-4333-8333-333333333333' and kind = 'email_sync';
select id::text as job1_id, lease_id::text as job1_lease from claimed1 \gset
select id::text as dummy_kind_job_id from dummy_kind_job \gset

-- ---------------------------------------------------------------------------
-- Non-service denial: RLS/execute is fail-closed for any non-service caller.
-- ---------------------------------------------------------------------------
select cc_test.expect_sqlstate('non-service-role-denied',
  format($stmt$do $body$ begin
    set local role authenticated;
    perform public.finalize_campaign_create_job('%1$s'::uuid, '%2$s'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid);
  end; $body$;$stmt$, :'job1_id', :'job1_lease'),
  array['42501']
);

-- invalid_request: a null argument never reaches ownership checks.
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table finalize_null_arg as
select public.finalize_campaign_create_job(null, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('finalize-denies-null-argument', $$select result->>'status' from finalize_null_arg$$, 'invalid_request');

-- Wrong tenant / kind / payload / lease / expired lease: all read-only.
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table wrong_kind as
select public.finalize_campaign_create_job(:'dummy_kind_job_id'::uuid, gen_random_uuid(), '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
create temporary table wrong_workspace as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '54444444-4444-4444-8444-444444444444'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
create temporary table wrong_payload as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56999999-9999-4999-8999-999999999999'::uuid) result;
create temporary table wrong_lease as
select public.finalize_campaign_create_job(:'job1_id'::uuid, gen_random_uuid(), '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('finalize-denies-wrong-kind', $$select result->>'status' from wrong_kind$$, 'wrong_kind');
select cc_test.expect_scalar('finalize-denies-wrong-workspace', $$select result->>'status' from wrong_workspace$$, 'wrong_workspace');
select cc_test.expect_scalar('finalize-denies-payload-mismatch', $$select result->>'status' from wrong_payload$$, 'payload_mismatch');
select cc_test.expect_scalar('finalize-denies-lease-mismatch', $$select result->>'status' from wrong_lease$$, 'lease_mismatch');

update public.aria_jobs
   set payload = payload || '{"extra":"not-authorized"}'::jsonb,
       payload_sha256 = encode(sha256(convert_to(
         (payload || '{"extra":"not-authorized"}'::jsonb)::text,
         'UTF8'
       )), 'hex')
 where id = :'job1_id'::uuid;
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table extra_payload as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid,
  '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('finalize-denies-extra-payload-keys',
  $$select result->>'status' from extra_payload$$, 'payload_mismatch');

update public.aria_jobs
   set payload = jsonb_build_object('requisition_id', '56111111-1111-4111-8111-111111111111'),
       payload_sha256 = repeat('0', 64)
 where id = :'job1_id'::uuid;
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table corrupt_payload_hash as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid,
  '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('finalize-denies-corrupt-payload-hash',
  $$select result->>'status' from corrupt_payload_hash$$, 'payload_mismatch');
update public.aria_jobs
   set payload_sha256 = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')
 where id = :'job1_id'::uuid;

update public.aria_jobs set lease_expires_at = now() - interval '1 second' where id = :'job1_id'::uuid;
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table expired_lease as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('finalize-denies-expired-lease', $$select result->>'status' from expired_lease$$, 'lease_expired');
update public.aria_jobs set lease_expires_at = now() + interval '120 seconds' where id = :'job1_id'::uuid;

select cc_test.expect_scalar('denial-matrix-wrote-no-campaign',
  $$select count(*)::text from public.sourcing_campaigns$$, '0');
select cc_test.expect_scalar('denial-matrix-requisition-still-ready',
  $$select status from public.requisitions where id = '56111111-1111-4111-8111-111111111111'$$, 'ready');
select cc_test.expect('denial-matrix-job-still-leased',
  (select status = 'leased' from public.aria_jobs where id = :'job1_id'::uuid));

-- ---------------------------------------------------------------------------
-- Controls/admin fail-closed matrix: each denies with sourcing_disabled or
-- activation_actor_invalid, writes nothing, and leaves the job leased.
-- ---------------------------------------------------------------------------
update public.sourcing_loop_controls
   set kill_switch = true,
       intake_enabled = false,
       sourcing_enabled = false,
       enrichment_enabled = false,
       sequences_enabled = false,
       swarm_enabled = false
 where workspace_id = '53333333-3333-4333-8333-333333333333';
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_kill_switch as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('kill-switch-denies', $$select result->>'status' from denied_kill_switch$$, 'sourcing_disabled');
update public.sourcing_loop_controls
   set kill_switch = false, sourcing_enabled = true
 where workspace_id = '53333333-3333-4333-8333-333333333333';

update public.sourcing_loop_controls set sourcing_enabled = false where workspace_id = '53333333-3333-4333-8333-333333333333';
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_sourcing_disabled as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('sourcing-disabled-denies', $$select result->>'status' from denied_sourcing_disabled$$, 'sourcing_disabled');
update public.sourcing_loop_controls set sourcing_enabled = true where workspace_id = '53333333-3333-4333-8333-333333333333';

update public.sourcing_loop_controls set max_sourcing_runs_per_day = 0 where workspace_id = '53333333-3333-4333-8333-333333333333';
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_zero_quota as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('zero-quota-denies', $$select result->>'status' from denied_zero_quota$$, 'sourcing_disabled');
update public.sourcing_loop_controls set max_sourcing_runs_per_day = 5 where workspace_id = '53333333-3333-4333-8333-333333333333';

update public.sourcing_loop_controls
   set sourcing_enabled = false, updated_by = null
 where workspace_id = '53333333-3333-4333-8333-333333333333';
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_missing_actor as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('missing-actor-denies', $$select result->>'status' from denied_missing_actor$$, 'sourcing_disabled');

update public.sourcing_loop_controls
   set sourcing_enabled = true,
       updated_by = 'c2000000-0000-4000-8000-000000000002'
 where workspace_id = '53333333-3333-4333-8333-333333333333';
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_demoted_actor as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('non-admin-activation-actor-denies', $$select result->>'status' from denied_demoted_actor$$, 'activation_actor_invalid');

update public.sourcing_loop_controls
   set updated_by = 'c2000000-0000-4000-8000-000000000001'
 where workspace_id = '53333333-3333-4333-8333-333333333333';

select cc_test.expect_scalar('controls-matrix-wrote-no-campaign',
  $$select count(*)::text from public.sourcing_campaigns$$, '0');
select cc_test.expect('controls-matrix-job-still-leased',
  (select status = 'leased' from public.aria_jobs where id = :'job1_id'::uuid));

-- ---------------------------------------------------------------------------
-- REQ2: not-ready requisition (never reached 'ready').
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('56222222-2222-4222-8222-222222222222', '53333333-3333-4333-8333-333333333333', 'api', 'cc-test-req-2', 'received');
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56222222-2222-4222-8222-222222222222',
  jsonb_build_object('requisition_id', '56222222-2222-4222-8222-222222222222')
);
create temporary table claimed2 as
select * from public.claim_due_aria_jobs('worker-cc-2', 120, array['campaign_create'], 10);
reset role;
select id::text as job2_id, lease_id::text as job2_lease from claimed2 \gset

set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_not_ready as
select public.finalize_campaign_create_job(:'job2_id'::uuid, :'job2_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56222222-2222-4222-8222-222222222222'::uuid) result;
reset role;
select cc_test.expect_scalar('not-ready-requisition-denies', $$select result->>'status' from denied_not_ready$$, 'requisition_not_ready');

-- ---------------------------------------------------------------------------
-- REQ3: ready requisition with no matching ready parse receipt.
-- ---------------------------------------------------------------------------
insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256, campaign_id
) values (
  '56333333-3333-4333-8333-333333333333', '53333333-3333-4333-8333-333333333333',
  'api', 'cc-test-req-3', 'ready',
  '{"title":"Product Manager","requiredSkills":["Roadmap"]}'::jsonb,
  encode(sha256('cc-req-3-input'::bytea), 'hex'),
  encode(sha256('cc-req-3-result'::bytea), 'hex'),
  null
);
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56333333-3333-4333-8333-333333333333',
  jsonb_build_object('requisition_id', '56333333-3333-4333-8333-333333333333')
);
create temporary table claimed3 as
select * from public.claim_due_aria_jobs('worker-cc-3', 120, array['campaign_create'], 10);
reset role;
select id::text as job3_id, lease_id::text as job3_lease from claimed3 \gset

set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_receipt_mismatch as
select public.finalize_campaign_create_job(:'job3_id'::uuid, :'job3_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56333333-3333-4333-8333-333333333333'::uuid) result;
reset role;
select cc_test.expect_scalar('missing-parse-receipt-denies', $$select result->>'status' from denied_receipt_mismatch$$, 'parse_receipt_mismatch');

-- ---------------------------------------------------------------------------
-- REQ4: ready requisition whose grounded analysis has no usable title.
-- ---------------------------------------------------------------------------
insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256, campaign_id
) values (
  '56444444-4444-4444-8444-444444444444', '53333333-3333-4333-8333-333333333333',
  'api', 'cc-test-req-4', 'ready',
  '{"seniority":"Senior","requiredSkills":["Python"]}'::jsonb,
  encode(sha256('cc-req-4-input'::bytea), 'hex'),
  encode(sha256(convert_to(jsonb_build_object(
    'job_analysis', '{"seniority":"Senior","requiredSkills":["Python"]}'::jsonb,
    'warnings', '[]'::jsonb
  )::text, 'UTF8')), 'hex'),
  null
);
select cc_test.seed_parse_receipt('56444444-4444-4444-8444-444444444444');
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56444444-4444-4444-8444-444444444444',
  jsonb_build_object('requisition_id', '56444444-4444-4444-8444-444444444444')
);
create temporary table claimed4 as
select * from public.claim_due_aria_jobs('worker-cc-4', 120, array['campaign_create'], 10);
reset role;
select id::text as job4_id, lease_id::text as job4_lease from claimed4 \gset

set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_invalid_basis as
select public.finalize_campaign_create_job(:'job4_id'::uuid, :'job4_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56444444-4444-4444-8444-444444444444'::uuid) result;
reset role;
select cc_test.expect_scalar('ungrounded-title-denies', $$select result->>'status' from denied_invalid_basis$$, 'invalid_role_basis');

-- REQ4B: legacy JSON types must be rejected, never coerced through ->> into
-- invented strings such as title "123" or seniority '{"level":"senior"}'.
insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256, campaign_id
) values (
  '56444444-4444-4444-8444-444444444445', '53333333-3333-4333-8333-333333333333',
  'api', 'cc-test-req-4b', 'ready',
  '{"title":123,"seniority":{"level":"senior"},"requiredSkills":["SQL"]}'::jsonb,
  encode(sha256('cc-req-4b-input'::bytea), 'hex'),
  encode(sha256(convert_to(jsonb_build_object(
    'job_analysis', '{"title":123,"seniority":{"level":"senior"},"requiredSkills":["SQL"]}'::jsonb,
    'warnings', '[]'::jsonb
  )::text, 'UTF8')), 'hex'),
  null
);
select cc_test.seed_parse_receipt('56444444-4444-4444-8444-444444444445');
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56444444-4444-4444-8444-444444444445',
  jsonb_build_object('requisition_id', '56444444-4444-4444-8444-444444444445')
);
create temporary table claimed4b as
select * from public.claim_due_aria_jobs('worker-cc-4b', 120, array['campaign_create'], 10);
reset role;
select id::text as job4b_id, lease_id::text as job4b_lease from claimed4b \gset
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table denied_legacy_json_types as
select public.finalize_campaign_create_job(:'job4b_id'::uuid, :'job4b_lease'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid,
  '56444444-4444-4444-8444-444444444445'::uuid) result;
reset role;
select cc_test.expect_scalar('legacy-json-types-deny-instead-of-coerce',
  $$select result->>'status' from denied_legacy_json_types$$, 'invalid_role_basis');

-- ---------------------------------------------------------------------------
-- Atomic success, REQ1: exactly one campaign, requisition transition, job
-- success, loop event, receipt and sourcing_batch job -- all together, and
-- the stored role basis proves the grounding matrix above.
-- ---------------------------------------------------------------------------
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table finalized_ready as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('finalize-ready-completed', $$select result->>'status' from finalized_ready$$, 'completed');
select result->>'campaign_id' as campaign1_id, result->>'campaign_sha256' as campaign1_hash,
       result->>'sourcing_job_id' as sourcing_job1_id
  from finalized_ready \gset

-- expect_scalar/expect_sqlstate's p_statement is EXECUTE'd inside plpgsql,
-- and psql's `:'var'` interpolation never reaches inside a `$$...$$`
-- argument (it is substituted client-side, before the string even reaches
-- the server, and dollar-quoting hides it from that substitution just like
-- single-quoting would). Every assertion below that needs a runtime-
-- captured id therefore uses `:'var'::uuid` in a plain top-level SELECT
-- (where psql interpolation is proven to work) feeding cc_test.expect
-- directly, never inside a dollar-quoted EXECUTE string.
select cc_test.expect('campaign-role-basis-omits-region',
  (select not (role_basis ? 'region') from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-role-basis-omits-unspecified-employment-type',
  (select not (role_basis ? 'employmentType') from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-role-basis-omits-blank-location-type',
  (select not (role_basis ? 'locationType') from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-role-basis-omits-null-timezone',
  (select not (role_basis ? 'timezone') from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-role-basis-keeps-grounded-seniority',
  (select role_basis->>'seniority' = 'senior' from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-role-basis-maps-required-skills',
  (select role_basis->'skills' = '["python", "sql"]'::jsonb from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-role-basis-keeps-required-title',
  (select role_basis->>'title' = 'senior data engineer' from public.sourcing_campaigns where id = :'campaign1_id'::uuid));
select cc_test.expect('campaign-document-preserves-concurrent-state',
  (select state ->> 'unrelated' = 'preserve-me'
     from public.workspace_state where workspace_id = '53333333-3333-4333-8333-333333333333'));
select cc_test.expect('campaign-document-is-single-relational-identity',
  (select jsonb_array_length(state -> 'campaigns') = 1
      and state -> 'campaigns' -> 0 ->> 'id' = :'campaign1_id'
     from public.workspace_state where workspace_id = '53333333-3333-4333-8333-333333333333'));
select cc_test.expect('campaign-document-has-app-contract',
  (select (state -> 'campaigns' -> 0) ?& array[
      'id','title','department','urgency','status','hiringManager','hiringManagerEmail',
      'createdAt','targetStartDate','jobAnalysis','sourcingStrategy','scoringWeights',
      'metrics','skillUpdates','activities'
    ]
    and jsonb_typeof(state -> 'campaigns' -> 0 -> 'jobAnalysis') = 'object'
    and jsonb_typeof(state -> 'campaigns' -> 0 -> 'sourcingStrategy') = 'object'
    and jsonb_typeof(state -> 'campaigns' -> 0 -> 'metrics') = 'object'
    and jsonb_typeof(state -> 'campaigns' -> 0 -> 'skillUpdates') = 'array'
    and jsonb_typeof(state -> 'campaigns' -> 0 -> 'activities') = 'array'
   from public.workspace_state where workspace_id = '53333333-3333-4333-8333-333333333333'));
select cc_test.expect('campaign-document-keeps-grounded-and-neutral-values',
  (select state -> 'campaigns' -> 0 ->> 'title' = 'Senior Data Engineer'
      and state -> 'campaigns' -> 0 ->> 'hiringManager' = ''
      and state -> 'campaigns' -> 0 ->> 'hiringManagerEmail' = ''
      and state -> 'campaigns' -> 0 ->> 'targetStartDate' = ''
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' -> 'requiredSkills' = '["Python","SQL"]'::jsonb
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' ->> 'seniority' = 'Senior'
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' ->> 'employmentType' = 'Unspecified'
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' -> 'equity' = 'false'::jsonb
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' -> 'equityKnown' = 'false'::jsonb
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' ->> 'urgency' = 'Standard'
      and state -> 'campaigns' -> 0 -> 'jobAnalysis' -> 'urgencyKnown' = 'false'::jsonb
      and state -> 'campaigns' -> 0 -> 'scoringWeights' =
        '{"skills":0,"experience":0,"companyStage":0,"industry":0,"location":0,"activity":0}'::jsonb
   from public.workspace_state where workspace_id = '53333333-3333-4333-8333-333333333333'));
select cc_test.expect('finalize-ready-requisition-transitioned',
  (select status = 'campaign_created' and campaign_id = :'campaign1_id'
     from public.requisitions where id = '56111111-1111-4111-8111-111111111111'));
select cc_test.expect('finalize-ready-job-succeeded',
  (select status = 'succeeded' and result_sha256 = :'campaign1_hash' and lease_id is null
     from public.aria_jobs where id = :'job1_id'::uuid));
select cc_test.expect('finalize-ready-emitted-exactly-one-event',
  (select count(*) = 1 from public.loop_events
    where event_type = 'campaign.created' and subject_id = :'campaign1_id'));
select cc_test.expect('finalize-ready-wrote-exactly-one-receipt',
  (select count(*) = 1 from public.campaign_create_receipts where job_id = :'job1_id'::uuid));
select cc_test.expect('finalize-ready-enqueued-exactly-one-sourcing-batch',
  (select count(*) = 1 from public.aria_jobs where id = :'sourcing_job1_id'::uuid and kind = 'sourcing_batch'));

-- ---------------------------------------------------------------------------
-- Exact replay proves the receipt, job result hash, campaign, requisition,
-- actor and sourcing job bindings all still hold; a wrong lease conflicts.
-- ---------------------------------------------------------------------------
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table replay_exact as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
create temporary table replay_wrong_lease as
select public.finalize_campaign_create_job(:'job1_id'::uuid, gen_random_uuid(), '53333333-3333-4333-8333-333333333333'::uuid, '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('replay-exact-no-op', $$select result->>'status' from replay_exact$$, 'no_op_replay');
select cc_test.expect_scalar('replay-exact-returns-same-campaign',
  $$select result->>'campaign_id' from replay_exact$$, :'campaign1_id');
select cc_test.expect_scalar('replay-exact-returns-same-job',
  $$select result->>'job_id' from replay_exact$$, :'job1_id');
select cc_test.expect_scalar('replay-exact-returns-same-sourcing-job',
  $$select result->>'sourcing_job_id' from replay_exact$$, :'sourcing_job1_id');
select cc_test.expect_scalar('replay-wrong-lease-conflicts', $$select result->>'status' from replay_wrong_lease$$, 'replay_conflict');
select cc_test.expect_scalar('replay-never-duplicates-campaign',
  $$select count(*)::text from public.sourcing_campaigns where requisition_id = '56111111-1111-4111-8111-111111111111'$$, '1');
select cc_test.expect('replay-never-duplicates-receipt',
  (select count(*) = 1 from public.campaign_create_receipts where job_id = :'job1_id'::uuid));
select cc_test.expect('replay-never-duplicates-sourcing-batch',
  (select count(*) = 1 from public.aria_jobs where kind = 'sourcing_batch' and payload->>'campaign_id' = :'campaign1_id'));

-- Exact replay must re-prove every mutable row named by the immutable
-- receipt. Each corruption below is made internally consistent enough to
-- defeat a shallow ID/kind check, then restored before the next case.
create temporary table replay_binding_state as
select r.parse_result_sha256,
       c.role_basis,
       sj.payload as sourcing_payload,
       sj.payload_sha256 as sourcing_payload_sha256
  from public.requisitions r
  join public.sourcing_campaigns c on c.id = :'campaign1_id'::uuid
  join public.aria_jobs sj on sj.id = :'sourcing_job1_id'::uuid
 where r.id = '56111111-1111-4111-8111-111111111111';

update public.requisitions
   set parse_result_sha256 = repeat('0', 64)
 where id = '56111111-1111-4111-8111-111111111111';
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table replay_tampered_requisition as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid,
  '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('replay-tampered-requisition-conflicts',
  $$select result->>'status' from replay_tampered_requisition$$, 'replay_conflict');
update public.requisitions r
   set parse_result_sha256 = state.parse_result_sha256
  from replay_binding_state state
 where r.id = '56111111-1111-4111-8111-111111111111';

update public.sourcing_campaigns
   set role_basis = jsonb_set(role_basis, '{title}', '"tampered"'::jsonb)
 where id = :'campaign1_id'::uuid;
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table replay_tampered_campaign as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid,
  '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('replay-tampered-campaign-conflicts',
  $$select result->>'status' from replay_tampered_campaign$$, 'replay_conflict');
update public.sourcing_campaigns c
   set role_basis = state.role_basis
  from replay_binding_state state
 where c.id = :'campaign1_id'::uuid;

update public.aria_jobs
   set payload = jsonb_set(payload, '{batch_ordinal}', '1'::jsonb),
       payload_sha256 = encode(sha256(convert_to(
         jsonb_set(payload, '{batch_ordinal}', '1'::jsonb)::text,
         'UTF8'
       )), 'hex')
 where id = :'sourcing_job1_id'::uuid;
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table replay_tampered_sourcing_job as
select public.finalize_campaign_create_job(:'job1_id'::uuid, :'job1_lease'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid,
  '56111111-1111-4111-8111-111111111111'::uuid) result;
reset role;
select cc_test.expect_scalar('replay-tampered-sourcing-job-conflicts',
  $$select result->>'status' from replay_tampered_sourcing_job$$, 'replay_conflict');
update public.aria_jobs sj
   set payload = state.sourcing_payload,
       payload_sha256 = state.sourcing_payload_sha256
  from replay_binding_state state
 where sj.id = :'sourcing_job1_id'::uuid;

-- ---------------------------------------------------------------------------
-- Privilege matrix: RLS forced, no direct grants, functions service-only,
-- and the superseded legacy mutation can no longer be called.
-- ---------------------------------------------------------------------------
do $cc_privileges$
declare
  role_name text;
  forced boolean;
  actual boolean;
begin
  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    select has_function_privilege(role_name, 'public.finalize_campaign_create_job(uuid,uuid,uuid,uuid)', 'EXECUTE')
      into actual;
    if actual is distinct from (role_name = 'service_role') then
      raise exception 'unexpected execute privilege for % on finalize_campaign_create_job', role_name;
    end if;
    if has_function_privilege(role_name, 'public.record_requisition_campaign(uuid,text)', 'EXECUTE') then
      raise exception 'legacy record_requisition_campaign is still callable by %', role_name;
    end if;
    if has_function_privilege(role_name, 'public.validate_campaign_create_receipt_jobs()', 'EXECUTE')
       or has_function_privilege(role_name, 'public.reject_campaign_create_receipt_mutation()', 'EXECUTE') then
      raise exception 'campaign-create trigger helper is directly callable by %', role_name;
    end if;
  end loop;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_table_privilege(role_name, 'public.sourcing_campaigns', 'SELECT')
       or has_table_privilege(role_name, 'public.sourcing_campaigns', 'INSERT')
       or has_table_privilege(role_name, 'public.sourcing_campaigns', 'UPDATE')
       or has_table_privilege(role_name, 'public.sourcing_campaigns', 'DELETE')
       or has_table_privilege(role_name, 'public.campaign_create_receipts', 'SELECT')
       or has_table_privilege(role_name, 'public.campaign_create_receipts', 'INSERT')
       or has_table_privilege(role_name, 'public.campaign_create_receipts', 'UPDATE')
       or has_table_privilege(role_name, 'public.campaign_create_receipts', 'DELETE') then
      raise exception 'direct table privilege exposed to % on campaign-create authority', role_name;
    end if;
  end loop;

  select relforcerowsecurity into forced from pg_class where oid = 'public.sourcing_campaigns'::regclass;
  if not forced then raise exception 'RLS is not forced on sourcing_campaigns'; end if;
  select relforcerowsecurity into forced from pg_class where oid = 'public.campaign_create_receipts'::regclass;
  if not forced then raise exception 'RLS is not forced on campaign_create_receipts'; end if;
end
$cc_privileges$;
select cc_test.expect('privilege-matrix-passed', true);

select cc_test.expect_sqlstate('receipt-mutation-is-append-only',
  format($stmt$update public.campaign_create_receipts set lease_id = gen_random_uuid() where job_id = %L$stmt$, :'job1_id'),
  array['42501']
);

-- ---------------------------------------------------------------------------
-- REQ5: two-session duplicate execution of the exact same claimed lease
-- must yield exactly one campaign/event/receipt/sourcing_batch job -- one
-- session completes, the other resolves as an exact no-op replay.
-- ---------------------------------------------------------------------------
insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256, campaign_id
) values (
  '56555555-5555-4555-8555-555555555555', '53333333-3333-4333-8333-333333333333',
  'api', 'cc-test-req-5', 'ready',
  '{"title":"Staff Backend Engineer","seniority":"Staff","requiredSkills":["Go","Kubernetes"]}'::jsonb,
  encode(sha256('cc-req-5-input'::bytea), 'hex'),
  encode(sha256(convert_to(jsonb_build_object(
    'job_analysis', '{"title":"Staff Backend Engineer","seniority":"Staff","requiredSkills":["Go","Kubernetes"]}'::jsonb,
    'warnings', '[]'::jsonb
  )::text, 'UTF8')), 'hex'),
  null
);
select cc_test.seed_parse_receipt('56555555-5555-4555-8555-555555555555');
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56555555-5555-4555-8555-555555555555',
  jsonb_build_object('requisition_id', '56555555-5555-4555-8555-555555555555')
);
create temporary table claimed5 as
select * from public.claim_due_aria_jobs('worker-cc-5', 120, array['campaign_create'], 10);
reset role;
insert into cc_test.race_context (race_name, job_id, lease_id, requisition_id)
select 'duplicate-execution', id, lease_id, '56555555-5555-4555-8555-555555555555'::uuid from claimed5;
SQL

race_log_dir="$(mktemp -d)"

psql_concurrent -q >"$race_log_dir/holder.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'cc-duplicate-holder';
select job_id::text as job_id, lease_id::text as lease_id, requisition_id::text as requisition_id
  from cc_test.race_context where race_name = 'duplicate-execution' \gset
begin;
select id from public.aria_jobs where id = :'job_id'::uuid for update;
select pg_advisory_lock(480150);
do $holder$
declare
  blocked integer;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    select count(*) into blocked
      from pg_stat_activity
     where application_name = 'cc-duplicate-second'
       and wait_event_type = 'Lock';
    exit when blocked = 1;
    if clock_timestamp() >= deadline then
      raise exception 'timed out waiting for second session to block';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$holder$;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
set role service_role;
select public.finalize_campaign_create_job(:'job_id'::uuid, :'lease_id'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid, :'requisition_id'::uuid) as response \gset
reset role;
insert into cc_test.concurrent_outcomes(race_name, participant, outcome)
values ('duplicate-execution', 'holder', :'response'::jsonb->>'status');
commit;
SQL
holder_pid=$!

ready=0
for _ in $(seq 1 50); do
  ready="$(psql_concurrent -Atc "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = 480150 and granted")"
  if [ "$ready" = "1" ]; then
    break
  fi
  sleep 0.1
done
if [ "$ready" != "1" ]; then
  echo "campaign-create-db: duplicate-execution holder did not become ready" >&2
  exit 1
fi

psql_concurrent -q >"$race_log_dir/second.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'cc-duplicate-second';
select job_id::text as job_id, lease_id::text as lease_id, requisition_id::text as requisition_id
  from cc_test.race_context where race_name = 'duplicate-execution' \gset
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
set role service_role;
select public.finalize_campaign_create_job(:'job_id'::uuid, :'lease_id'::uuid,
  '53333333-3333-4333-8333-333333333333'::uuid, :'requisition_id'::uuid) as response \gset
reset role;
insert into cc_test.concurrent_outcomes(race_name, participant, outcome)
values ('duplicate-execution', 'second', :'response'::jsonb->>'status');
SQL
second_pid=$!

duplicate_failed=0
for name in holder second; do
  case "$name" in
    holder) pid="$holder_pid" ;;
    second) pid="$second_pid" ;;
  esac
  if ! wait "$pid"; then
    echo "campaign-create-db: ${name} session failed" >&2
    sed -n '1,200p' "$race_log_dir/${name}.log" >&2
    duplicate_failed=1
  fi
done
if [ "$duplicate_failed" -ne 0 ]; then
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

select cc_test.expect_scalar('duplicate-execution-one-side-completed',
  $$select count(*)::text from cc_test.concurrent_outcomes
     where race_name = 'duplicate-execution' and outcome = 'completed'$$, '1');
select cc_test.expect_scalar('duplicate-execution-other-side-no-op-replay',
  $$select count(*)::text from cc_test.concurrent_outcomes
     where race_name = 'duplicate-execution' and outcome = 'no_op_replay'$$, '1');
select cc_test.expect_scalar('duplicate-execution-exactly-one-campaign',
  $$select count(*)::text from public.sourcing_campaigns where requisition_id = '56555555-5555-4555-8555-555555555555'$$, '1');
select cc_test.expect_scalar('duplicate-execution-exactly-one-receipt',
  $$select count(*)::text from public.campaign_create_receipts cr
      join public.sourcing_campaigns c on c.id = cr.campaign_id
     where c.requisition_id = '56555555-5555-4555-8555-555555555555'$$, '1');
select cc_test.expect_scalar('duplicate-execution-exactly-one-sourcing-batch',
  $$select count(*)::text from public.aria_jobs sj
      join public.campaign_create_receipts cr on cr.sourcing_job_id = sj.id
      join public.sourcing_campaigns c on c.id = cr.campaign_id
     where c.requisition_id = '56555555-5555-4555-8555-555555555555' and sj.kind = 'sourcing_batch'$$, '1');

-- ---------------------------------------------------------------------------
-- REQ6: rollback on forced downstream enqueue conflict. enqueue_aria_job is
-- temporarily stubbed to force a conflict; the whole transaction -- campaign
-- insert included -- must roll back rather than leave an orphaned campaign.
-- ---------------------------------------------------------------------------
insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256, campaign_id
) values (
  '56666666-6666-4666-8666-666666666666', '53333333-3333-4333-8333-333333333333',
  'api', 'cc-test-req-6', 'ready',
  '{"title":"QA Lead","seniority":"Senior","requiredSkills":["Automation","Selenium"]}'::jsonb,
  encode(sha256('cc-req-6-input'::bytea), 'hex'),
  encode(sha256(convert_to(jsonb_build_object(
    'job_analysis', '{"title":"QA Lead","seniority":"Senior","requiredSkills":["Automation","Selenium"]}'::jsonb,
    'warnings', '[]'::jsonb
  )::text, 'UTF8')), 'hex'),
  null
);
select cc_test.seed_parse_receipt('56666666-6666-4666-8666-666666666666');
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '53333333-3333-4333-8333-333333333333', 'campaign_create',
  'campaign_create:56666666-6666-4666-8666-666666666666',
  jsonb_build_object('requisition_id', '56666666-6666-4666-8666-666666666666')
);
create temporary table claimed6 as
select * from public.claim_due_aria_jobs('worker-cc-6', 120, array['campaign_create'], 10);
reset role;
select id::text as job6_id, lease_id::text as job6_lease from claimed6 \gset

create or replace function public.enqueue_aria_job(
  p_workspace_id uuid, p_kind text, p_idempotency_key text, p_payload jsonb,
  p_run_at timestamptz default now(), p_priority integer default 100
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  return jsonb_build_object('status', 'idempotency_conflict');
end;
$$;

select cc_test.expect_sqlstate('forced-enqueue-conflict-rolls-back',
  format($stmt$select public.finalize_campaign_create_job(%L::uuid, %L::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56666666-6666-4666-8666-666666666666'::uuid)$stmt$,
    :'job6_id', :'job6_lease'),
  array['22023']
);

-- Restore the real enqueue_aria_job exactly as shipped by 0038.
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
alter function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) owner to postgres;
revoke all on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  to service_role;

select cc_test.expect_scalar('forced-enqueue-conflict-requisition-still-ready',
  $$select status from public.requisitions where id = '56666666-6666-4666-8666-666666666666'$$, 'ready');
select cc_test.expect_scalar('forced-enqueue-conflict-no-orphan-campaign',
  $$select count(*)::text from public.sourcing_campaigns where requisition_id = '56666666-6666-4666-8666-666666666666'$$, '0');
select cc_test.expect('forced-enqueue-conflict-job-still-leased',
  (select status = 'leased' from public.aria_jobs where id = :'job6_id'::uuid));

-- enqueue_aria_job is now genuinely restored: prove one real sourcing_batch
-- job enqueues cleanly for REQ6 to close out this scenario.
set role service_role;
select cc_test.set_service_claims('c2000000-0000-4000-8000-000000000001');
create temporary table finalized_req6 as
select public.finalize_campaign_create_job(:'job6_id'::uuid, :'job6_lease'::uuid, '53333333-3333-4333-8333-333333333333'::uuid, '56666666-6666-4666-8666-666666666666'::uuid) result;
reset role;
select cc_test.expect_scalar('restored-enqueue-completes-cleanly', $$select result->>'status' from finalized_req6$$, 'completed');

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed from cc_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from cc_test.results where not passed;
    raise exception 'campaign-create DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from cc_test.results")"
echo "campaign-create-db: denial matrix, controls/admin fail-closed, grounded role basis, atomic success, exact replay, replay conflict, concurrency, rollback-on-conflict: ${assertions} assertions, 0 failed"
