#!/usr/bin/env bash
# Disposable-Postgres proof for 0050/0051 requisition_parse authority.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-requisition-parse-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -n "${lock_wait_log_dir:-}" ]; then
    rm -rf "$lock_wait_log_dir"
  fi
  if [ -n "${race_log_dir:-}" ]; then
    rm -rf "$race_log_dir"
  fi
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null
db_container="$(docker compose -p "$project" ps -q db)"
if [ -z "$db_container" ]; then
  echo "requisition-parse-db: database container was not found" >&2
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

# Concurrency proofs need several sessions to reach PostgreSQL within a tight,
# measured lease window. Reuse the already-running pinned database container
# instead of paying for three additional client-container startups.
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

create schema rp_test;
create table rp_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create table rp_test.concurrent_outcomes (
  race_name text not null,
  participant text not null,
  outcome text not null,
  primary key (race_name, participant)
);

create table rp_test.race_context (
  race_name text primary key,
  job_id uuid not null,
  lease_id uuid not null,
  requisition_id uuid not null,
  input_sha256 text not null,
  claim_token uuid not null,
  fence_version integer not null,
  egress_attempt_id uuid,
  provider text,
  model text,
  original_lease_deadline timestamptz
);

create function rp_test.expect(
  p_case_name text, p_passed boolean, p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, rp_test
as $$
begin
  insert into rp_test.results(case_name, passed, detail) values (p_case_name, p_passed, p_detail);
end;
$$;

create function rp_test.expect_scalar(
  p_case_name text, p_statement text, p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, rp_test
as $$
declare actual text;
begin
  execute p_statement into actual;
  perform rp_test.expect(
    p_case_name, actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function rp_test.expect_sqlstate(
  p_case_name text, p_statement text, p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, rp_test
as $$
declare caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform rp_test.expect(p_case_name, caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text));
    return;
  end;
  perform rp_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function rp_test.set_service_claims(subject uuid)
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

grant usage on schema rp_test to service_role, authenticated;
grant execute on all functions in schema rp_test to service_role, authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'rp-admin@example.test', '', now(), '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111', 'Requisition parse WS', 'rp.example.test'),
  ('52222222-2222-4222-8222-222222222222', 'Other tenant', 'rp-other.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001', 'rp-admin@example.test', 'RP Admin',
   '51111111-1111-4111-8111-111111111111', 'admin');

update public.sourcing_loop_controls
   set kill_switch = false, intake_enabled = true, updated_by = 'c1000000-0000-4000-8000-000000000001'
 where workspace_id = '51111111-1111-4111-8111-111111111111';

-- Seed one requisition + its content-bound input directly (bypassing the
-- 0049 HMAC ingress path, which is proven separately in need-ingress-db.sh).
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('61111111-1111-4111-8111-111111111111', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-0001', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('61111111-1111-4111-8111-111111111111', '51111111-1111-4111-8111-111111111111',
   'We need a Senior Data Engineer, full-time and remote. Must have Python and SQL.', 'text/plain',
   encode(sha256(convert_to('We need a Senior Data Engineer, full-time and remote. Must have Python and SQL.', 'UTF8')), 'hex'));

select encode(sha256(convert_to('We need a Senior Data Engineer, full-time and remote. Must have Python and SQL.', 'UTF8')), 'hex') as input_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table claimed as
select * from public.claim_due_aria_jobs('worker-a', 120, array['requisition_parse'], 10);
reset role;

select rp_test.expect_scalar('no-job-yet-claim-is-empty', $$select count(*)::text from claimed$$, '0');

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:61111111-1111-4111-8111-111111111111',
  jsonb_build_object('requisition_id', '61111111-1111-4111-8111-111111111111')
);
create temporary table claimed2 as
select * from public.claim_due_aria_jobs('worker-a', 120, array['requisition_parse'], 10);
reset role;

select rp_test.expect_scalar('job-claimed-leased', $$select status from claimed2$$, 'leased');

select id::text as job_id, lease_id::text as lease_id from claimed2 \gset

-- ---------------------------------------------------------------------------
-- Expand/contract compatibility: the already-running 0050 image must keep
-- its unchanged authorizer and finalizer while the fenced v2 path rolls out.
-- The legacy authorizer must not create a v2 execution claim that the old
-- handler cannot understand.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('63333333-3333-4333-8333-333333333333', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-expand-compatibility', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('63333333-3333-4333-8333-333333333333', '51111111-1111-4111-8111-111111111111',
   'We need a Platform Engineer, full-time and remote. Must have Go and Kubernetes.', 'text/plain',
   encode(sha256(convert_to('We need a Platform Engineer, full-time and remote. Must have Go and Kubernetes.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need a Platform Engineer, full-time and remote. Must have Go and Kubernetes.', 'UTF8')), 'hex') as legacy_input_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:63333333-3333-4333-8333-333333333333',
  jsonb_build_object('requisition_id', '63333333-3333-4333-8333-333333333333')
);
create temporary table legacy_claimed as
select * from public.claim_due_aria_jobs('worker-legacy-expand', 120, array['requisition_parse'], 10);
reset role;
select id::text as legacy_job_id, lease_id::text as legacy_lease_id
  from legacy_claimed
 where payload->>'requisition_id' = '63333333-3333-4333-8333-333333333333' \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table legacy_auth as
select public.authorize_requisition_parse_job(
  :'legacy_job_id'::uuid, :'legacy_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '63333333-3333-4333-8333-333333333333'::uuid
) result;
reset role;
select rp_test.expect_scalar('expand-legacy-authorizer-remains-authorized',
  $$select result->>'status' from legacy_auth$$, 'authorized');
select rp_test.expect_scalar('expand-legacy-authorizer-does-not-mint-v2-capabilities',
  $$select concat_ws(':', (result ? 'claim_token')::text, (result ? 'fence_version')::text)
      from legacy_auth$$, 'false:false');
select rp_test.expect_scalar('expand-legacy-authorizer-creates-no-execution-claim',
  $$select count(*)::text from public.requisition_parse_execution_claims
      where job_id = (
        select id from public.aria_jobs
         where kind = 'requisition_parse'
           and payload->>'requisition_id' = '63333333-3333-4333-8333-333333333333'
      )$$, '0');

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table legacy_finalize as
select public.finalize_requisition_parse(
  :'legacy_job_id'::uuid, :'legacy_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '63333333-3333-4333-8333-333333333333'::uuid,
  :'legacy_input_hash',
  jsonb_build_object('title', 'Platform Engineer', 'seniority', 'Senior',
    'employmentType', 'Full-time', 'locationType', 'Remote',
    'requiredSkills', jsonb_build_array('Go', 'Kubernetes')),
  '[]'::jsonb, 'anthropic', 'legacy-compatible-model'
) result;
reset role;
select rp_test.expect_scalar('expand-legacy-finalizer-remains-compatible',
  $$select result->>'status' from legacy_finalize$$, 'completed');
select rp_test.expect_scalar('expand-legacy-finalizer-completes-without-v2-claim',
  $$select concat_ws(':', job.status, count(claim.job_id)::text)
      from public.aria_jobs job
      left join public.requisition_parse_execution_claims claim on claim.job_id = job.id
     where job.kind = 'requisition_parse'
       and job.payload->>'requisition_id' = '63333333-3333-4333-8333-333333333333'
     group by job.status$$, 'succeeded:0');

-- ---------------------------------------------------------------------------
-- authorize_requisition_parse_job_v2: pre-egress denial matrix
-- ---------------------------------------------------------------------------
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_ok as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
create temporary table auth_wrong_workspace as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, :'lease_id'::uuid, '52222222-2222-4222-8222-222222222222'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
create temporary table auth_wrong_payload as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '62222222-2222-4222-8222-222222222222'::uuid
) result;
create temporary table auth_wrong_lease as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, '00000000-0000-4000-8000-000000000000'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
reset role;

select rp_test.expect_scalar('authorize-live-lease-authorized', $$select result->>'status' from auth_ok$$, 'authorized');
select rp_test.expect_scalar('authorize-returns-exact-content-hash-after-authority',
  $$select concat_ws(':', result->>'need_sha256', result->>'content') from auth_ok$$,
  :'input_hash' || ':We need a Senior Data Engineer, full-time and remote. Must have Python and SQL.');
select rp_test.expect_scalar('authorize-denies-cross-workspace', $$select result->>'status' from auth_wrong_workspace$$, 'wrong_workspace');
select rp_test.expect_scalar('authorize-denies-payload-mismatch', $$select result->>'status' from auth_wrong_payload$$, 'payload_mismatch');
select rp_test.expect_scalar('authorize-denies-lease-mismatch', $$select result->>'status' from auth_wrong_lease$$, 'lease_mismatch');
select result->>'claim_token' as claim_token,
       result->>'fence_version' as claim_fence
  from auth_ok \gset

update public.sourcing_loop_controls set intake_enabled = false
 where workspace_id = '51111111-1111-4111-8111-111111111111';
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_intake_disabled as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
reset role;
select rp_test.expect_scalar('authorize-denies-disabled-intake', $$select result->>'status' from auth_intake_disabled$$, 'intake_disabled');
update public.sourcing_loop_controls
   set intake_enabled = true, updated_by = 'c1000000-0000-4000-8000-000000000001'
 where workspace_id = '51111111-1111-4111-8111-111111111111';

-- Expired lease: push the real lease into the past directly (postgres
-- session bypasses RLS), then confirm both authorize AND finalize deny it,
-- and that the model was never a factor (authorize is read-only: no writes
-- occurred from any denied call above).
update public.aria_jobs set lease_expires_at = now() - interval '1 second' where id = :'job_id'::uuid;
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_expired as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
create temporary table finalize_expired as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer,
  '00000000-0000-4000-8000-000000000001'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('authorize-denies-expired-lease', $$select result->>'status' from auth_expired$$, 'lease_expired');
select rp_test.expect_scalar('finalize-denies-expired-lease', $$select result->>'status' from finalize_expired$$, 'lease_expired');
select rp_test.expect_scalar('expired-lease-denial-wrote-nothing',
  $$select status from public.requisitions where id = '61111111-1111-4111-8111-111111111111'$$, 'received');
update public.aria_jobs set lease_expires_at = now() + interval '100 seconds' where id = :'job_id'::uuid;

-- ---------------------------------------------------------------------------
-- finalize_requisition_parse: the one atomic write, ready path
-- ---------------------------------------------------------------------------
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table egress_ready as
select public.begin_requisition_parse_egress(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer, :'input_hash', 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('begin-ready-egress-started',
  $$select result->>'status' from egress_ready$$, 'egress_started');
select result->>'egress_attempt_id' as egress_attempt_id from egress_ready \gset

-- Every execution capability and every provider-binding field is fenced.
-- A mismatch must be read-only and must never complete the job.
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table finalize_wrong_token as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid, :'claim_fence'::integer,
  :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
create temporary table finalize_wrong_fence as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, (:'claim_fence'::integer + 1),
  :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
create temporary table finalize_wrong_attempt as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer,
  '00000000-0000-4000-8000-000000000003'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
create temporary table finalize_wrong_provider as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer,
  :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'openai', 'claude-test'
) result;
create temporary table finalize_wrong_model as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer,
  :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-other'
) result;
create temporary table finalize_wrong_input as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer,
  :'egress_attempt_id'::uuid, repeat('0', 64),
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('finalize-denies-wrong-claim-token', $$select result->>'status' from finalize_wrong_token$$, 'claim_lost');
select rp_test.expect_scalar('finalize-denies-wrong-fence', $$select result->>'status' from finalize_wrong_fence$$, 'claim_lost');
select rp_test.expect_scalar('finalize-denies-wrong-egress-attempt', $$select result->>'status' from finalize_wrong_attempt$$, 'claim_lost');
select rp_test.expect_scalar('finalize-denies-wrong-provider', $$select result->>'status' from finalize_wrong_provider$$, 'claim_lost');
select rp_test.expect_scalar('finalize-denies-wrong-model', $$select result->>'status' from finalize_wrong_model$$, 'claim_lost');
select rp_test.expect_scalar('finalize-denies-wrong-input-binding', $$select result->>'status' from finalize_wrong_input$$, 'claim_lost');
select rp_test.expect_scalar('finalize-fencing-denials-write-nothing',
  $$select status from public.requisitions where id = '61111111-1111-4111-8111-111111111111'$$, 'received');

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table finalized_ready as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer, :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;

select rp_test.expect_scalar('finalize-ready-completed',
  $$select concat_ws(':', result->>'status', result->>'ready') from finalized_ready$$, 'completed:true');
-- psql's :'var' interpolation does not reach inside a nested dollar-quoted
-- EXECUTE string, so this one comparison (it needs the bash-side captured
-- input_hash) runs as a plain top-level query instead of through
-- expect_scalar.
select status as req_status, parse_provider as req_provider, parse_model as req_model,
       (parse_input_sha256 = :'input_hash')::text as hash_matches,
       (parse_result_sha256 is not null)::text as result_hash_present
  from public.requisitions where id = '61111111-1111-4111-8111-111111111111' \gset
select rp_test.expect(
  'finalize-ready-wrote-evidence',
  :'req_status' = 'ready' and :'req_provider' = 'anthropic' and :'req_model' = 'claude-test'
    and :'hash_matches' = 'true' and :'result_hash_present' = 'true',
  concat_ws(':', :'req_status', :'req_provider', :'req_model', :'hash_matches', :'result_hash_present')
);
select concat_ws(':', status, (lease_id is null)::text, (lease_expires_at is null)::text) as job_state
  from public.aria_jobs where id = :'job_id'::uuid \gset
select rp_test.expect('finalize-ready-completed-the-job', :'job_state' = 'succeeded:true:true', :'job_state');
select rp_test.expect_scalar('finalize-ready-enqueued-exactly-one-campaign-create',
  $$select concat_ws(':', count(*)::text, string_agg(distinct idempotency_key, ','))
      from public.aria_jobs where kind = 'campaign_create'
       and payload = jsonb_build_object('requisition_id', '61111111-1111-4111-8111-111111111111')$$,
  '1:campaign_create:61111111-1111-4111-8111-111111111111');
select rp_test.expect_scalar('finalize-ready-emitted-one-loop-event',
  $$select count(*)::text from public.loop_events
     where event_type = 'requisition.parsed' and subject_id = '61111111-1111-4111-8111-111111111111'$$, '1');

-- ---------------------------------------------------------------------------
-- Lost-response replay exactness: the exact completed job, completed lease,
-- input, provider, model, and result return the stored receipt. Any drift is
-- a conflict. A different job for the already-parsed requisition is also a
-- conflict and is never silently completed.
-- ---------------------------------------------------------------------------
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table authorized_succeeded_replay as
select public.authorize_requisition_parse_job_v2(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
create temporary table finalized_replay as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer, :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
create temporary table finalized_drift as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer, :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Changed title', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
create temporary table finalized_warning_drift as
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid,
  :'claim_token'::uuid, :'claim_fence'::integer, :'egress_attempt_id'::uuid, :'input_hash',
  jsonb_build_object('title', 'Senior Data Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('Python', 'SQL')),
  jsonb_build_array(jsonb_build_object('field', 'title', 'severity', 'warning', 'message', 'drift')),
  'anthropic', 'claude-test'
) result;
reset role;

select rp_test.expect_scalar('authorize-succeeded-exact-replay-no-op',
  $$select concat_ws(':', result->>'status', result->>'ready', (result ? 'content')::text)
      from authorized_succeeded_replay$$,
  'no_op_replay:true:false');
select rp_test.expect_scalar('replay-job-no-op', $$select result->>'status' from finalized_replay$$, 'no_op_replay');
select rp_test.expect_scalar('replay-drift-conflicts', $$select result->>'status' from finalized_drift$$, 'replay_conflict');
select rp_test.expect_scalar('replay-warning-drift-conflicts', $$select result->>'status' from finalized_warning_drift$$, 'replay_conflict');
select rp_test.expect_scalar('replay-never-double-enqueues-campaign-create',
  $$select count(*)::text from public.aria_jobs where kind = 'campaign_create'
     and payload = jsonb_build_object('requisition_id', '61111111-1111-4111-8111-111111111111')$$, '1');

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:conflict:61111111-1111-4111-8111-111111111111',
  jsonb_build_object('requisition_id', '61111111-1111-4111-8111-111111111111')
);
create temporary table claimed3 as
select * from public.claim_due_aria_jobs('worker-b', 120, array['requisition_parse'], 10);
reset role;
select id::text as replay_job_id, lease_id::text as replay_lease_id from claimed3 \gset

-- A second job for the same workspace/requisition/input must be stopped at
-- authorization, before raw input or provider-egress capability is returned.
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_distinct as
select public.authorize_requisition_parse_job_v2(
  :'replay_job_id'::uuid, :'replay_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '61111111-1111-4111-8111-111111111111'::uuid
) result;
reset role;
select rp_test.expect_scalar('distinct-job-for-parsed-requisition-conflicts-before-egress',
  $$select concat_ws(':', result->>'status', (result ? 'content')::text,
       (result ? 'claim_token')::text) from auth_distinct$$,
  'duplicate_input_claim:false:false');
select status as replay_job_status from public.aria_jobs where id = :'replay_job_id'::uuid \gset
select rp_test.expect('distinct-conflict-job-remains-leased-read-only',
  :'replay_job_status' = 'leased', :'replay_job_status');

-- ---------------------------------------------------------------------------
-- Not-ready path: readiness is computed server-side from the job analysis,
-- never trusted from a caller flag; a thin analysis enqueues nothing.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('65555555-5555-4555-8555-555555555555', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-not-ready', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('65555555-5555-4555-8555-555555555555', '51111111-1111-4111-8111-111111111111',
   'We need someone eventually, details unclear.', 'text/plain',
   encode(sha256(convert_to('We need someone eventually, details unclear.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need someone eventually, details unclear.', 'UTF8')), 'hex') as thin_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:65555555-5555-4555-8555-555555555555',
  jsonb_build_object('requisition_id', '65555555-5555-4555-8555-555555555555')
);
create temporary table claimed4 as
select * from public.claim_due_aria_jobs('worker-c', 120, array['requisition_parse'], 10);
reset role;
select id::text as thin_job_id, lease_id::text as thin_lease_id from claimed4 \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_thin as
select public.authorize_requisition_parse_job_v2(
  :'thin_job_id'::uuid, :'thin_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '65555555-5555-4555-8555-555555555555'::uuid
) result;
reset role;
select result->>'claim_token' as thin_claim_token,
       result->>'fence_version' as thin_claim_fence
  from auth_thin \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table begin_thin as
select public.begin_requisition_parse_egress(
  :'thin_job_id'::uuid, :'thin_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '65555555-5555-4555-8555-555555555555'::uuid,
  :'thin_claim_token'::uuid, :'thin_claim_fence'::integer, :'thin_hash',
  'anthropic', 'claude-test'
) result;
reset role;
select result->>'egress_attempt_id' as thin_attempt_id from begin_thin \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table finalized_thin as
select public.finalize_requisition_parse(
  :'thin_job_id'::uuid, :'thin_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '65555555-5555-4555-8555-555555555555'::uuid,
  :'thin_claim_token'::uuid, :'thin_claim_fence'::integer, :'thin_attempt_id'::uuid, :'thin_hash',
  jsonb_build_object('title', 'Engineer'), '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;

select rp_test.expect_scalar('not-ready-completed-with-ready-false',
  $$select concat_ws(':', result->>'status', result->>'ready') from finalized_thin$$, 'completed:false');
select rp_test.expect_scalar('not-ready-status-is-needs-clarification',
  $$select status from public.requisitions where id = '65555555-5555-4555-8555-555555555555'$$, 'needs_clarification');
select rp_test.expect_scalar('not-ready-enqueues-nothing',
  $$select count(*)::text from public.aria_jobs where kind = 'campaign_create'
     and payload = jsonb_build_object('requisition_id', '65555555-5555-4555-8555-555555555555')$$, '0');

-- ---------------------------------------------------------------------------
-- Control race rollback: intake gets disabled between authorize and
-- finalize (TOCTOU); finalize must deny and roll back — no partial write.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('64444444-4444-4444-8444-444444444444', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-race', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('64444444-4444-4444-8444-444444444444', '51111111-1111-4111-8111-111111111111',
   'We need a Staff Backend Engineer, full-time, onsite. Go and Kubernetes required.', 'text/plain',
   encode(sha256(convert_to('We need a Staff Backend Engineer, full-time, onsite. Go and Kubernetes required.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need a Staff Backend Engineer, full-time, onsite. Go and Kubernetes required.', 'UTF8')), 'hex') as race_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:64444444-4444-4444-8444-444444444444',
  jsonb_build_object('requisition_id', '64444444-4444-4444-8444-444444444444')
);
create temporary table claimed5 as
select * from public.claim_due_aria_jobs('worker-d', 120, array['requisition_parse'], 10);
reset role;
select id::text as race_job_id, lease_id::text as race_lease_id from claimed5 \gset

-- Win the execution claim while intake is still enabled, so the race below
-- exercises finalize's intake_disabled check, not a missing claim.
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_race as
select public.authorize_requisition_parse_job_v2(
  :'race_job_id'::uuid, :'race_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '64444444-4444-4444-8444-444444444444'::uuid
) result;
reset role;
select result->>'claim_token' as race_claim_token,
       result->>'fence_version' as race_claim_fence
  from auth_race \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table begin_race as
select public.begin_requisition_parse_egress(
  :'race_job_id'::uuid, :'race_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '64444444-4444-4444-8444-444444444444'::uuid,
  :'race_claim_token'::uuid, :'race_claim_fence'::integer, :'race_hash',
  'anthropic', 'claude-test'
) result;
reset role;
select result->>'egress_attempt_id' as race_attempt_id from begin_race \gset

update public.sourcing_loop_controls set intake_enabled = false
 where workspace_id = '51111111-1111-4111-8111-111111111111';

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table finalized_race as
select public.finalize_requisition_parse(
  :'race_job_id'::uuid, :'race_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '64444444-4444-4444-8444-444444444444'::uuid,
  :'race_claim_token'::uuid, :'race_claim_fence'::integer, :'race_attempt_id'::uuid, :'race_hash',
  jsonb_build_object('title', 'Staff Backend Engineer', 'seniority', 'Staff', 'employmentType', 'Full-time',
    'locationType', 'Onsite', 'requiredSkills', jsonb_build_array('Go', 'Kubernetes')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;

select rp_test.expect_scalar('control-race-finalize-denies', $$select result->>'status' from finalized_race$$, 'intake_disabled');
select rp_test.expect_scalar('control-race-requisition-untouched',
  $$select status from public.requisitions where id = '64444444-4444-4444-8444-444444444444'$$, 'received');
select status as race_job_status_1 from public.aria_jobs where id = :'race_job_id'::uuid \gset
select rp_test.expect('control-race-job-still-leased', :'race_job_status_1' = 'leased', :'race_job_status_1');
select rp_test.expect_scalar('control-race-no-campaign-create-enqueued',
  $$select count(*)::text from public.aria_jobs where kind = 'campaign_create'
     and payload = jsonb_build_object('requisition_id', '64444444-4444-4444-8444-444444444444')$$, '0');

-- Re-enable intake before all subsequent lease/recovery proofs. Leaving this
-- disabled would make later authorization failures ambiguous with the race.
update public.sourcing_loop_controls
   set intake_enabled = true,
       updated_by = 'c1000000-0000-4000-8000-000000000001'
 where workspace_id = '51111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
-- Execution claim: a duplicate concurrent authorize call for the exact same
-- live job lease is denied (no raw input/content returned), and never
-- duplicates the claim row.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('67777777-7777-4777-8777-777777777777', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-claim', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('67777777-7777-4777-8777-777777777777', '51111111-1111-4111-8111-111111111111',
   'We need a Product Manager, full-time, hybrid. Roadmap and Analytics required.', 'text/plain',
   encode(sha256(convert_to('We need a Product Manager, full-time, hybrid. Roadmap and Analytics required.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need a Product Manager, full-time, hybrid. Roadmap and Analytics required.', 'UTF8')), 'hex') as claim_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:67777777-7777-4777-8777-777777777777',
  jsonb_build_object('requisition_id', '67777777-7777-4777-8777-777777777777')
);
create temporary table claimed6 as
select * from public.claim_due_aria_jobs('worker-e', 120, array['requisition_parse'], 10);
reset role;
select id::text as claim_job_id, lease_id::text as claim_lease_id from claimed6 \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_claim_first as
select public.authorize_requisition_parse_job_v2(
  :'claim_job_id'::uuid, :'claim_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '67777777-7777-4777-8777-777777777777'::uuid
) result;
create temporary table auth_claim_duplicate as
select public.authorize_requisition_parse_job_v2(
  :'claim_job_id'::uuid, :'claim_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '67777777-7777-4777-8777-777777777777'::uuid
) result;
reset role;

select rp_test.expect_scalar('claim-first-authorize-wins', $$select result->>'status' from auth_claim_first$$, 'authorized');
select rp_test.expect_scalar('claim-duplicate-same-lease-denied', $$select result->>'status' from auth_claim_duplicate$$, 'already_claimed');
select rp_test.expect_scalar('claim-duplicate-denial-returns-no-content',
  $$select (result ? 'content')::text from auth_claim_duplicate$$, 'false');
select count(*)::text as claim_row_count from public.requisition_parse_execution_claims
 where job_id = :'claim_job_id'::uuid \gset
select rp_test.expect('claim-table-holds-exactly-one-row-per-job', :'claim_row_count' = '1', :'claim_row_count');
select result->>'claim_token' as original_claim_token,
       result->>'fence_version' as original_claim_fence
  from auth_claim_first \gset

-- ---------------------------------------------------------------------------
-- Pre-egress crash recovery: expiry is authoritative at heartbeat/complete/
-- fail, then the actual reaper requeues a still-'claimed' execution. A new
-- lease can re-authorize with a higher fence and finish without duplicating
-- the claim row.
-- ---------------------------------------------------------------------------
update public.aria_jobs
   set lease_expires_at = clock_timestamp() - interval '1 second'
 where id = :'claim_job_id'::uuid;

select rp_test.expect_sqlstate('expired-lease-heartbeat-requires-service-role',
  $statement$do $body$ begin set local role authenticated; perform public.heartbeat_aria_job(gen_random_uuid(), gen_random_uuid(), 60); end; $body$;$statement$,
  array['42501']
);

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table expired_heartbeat as
select public.heartbeat_aria_job(:'claim_job_id'::uuid, :'claim_lease_id'::uuid, 60) result;
create temporary table expired_complete as
select public.complete_aria_job(:'claim_job_id'::uuid, :'claim_lease_id'::uuid, null, '[]'::jsonb, '[]'::jsonb) result;
create temporary table expired_fail as
select public.fail_aria_job(:'claim_job_id'::uuid, :'claim_lease_id'::uuid, 'test', true) result;
reset role;

select rp_test.expect_scalar('expired-lease-heartbeat-denied', $$select result::text from expired_heartbeat$$, 'false');
select rp_test.expect_scalar('expired-lease-complete-denied', $$select result::text from expired_complete$$, 'false');
select rp_test.expect_scalar('expired-lease-fail-denied', $$select result from expired_fail$$, 'not_found');
select status as claim_job_before_reap from public.aria_jobs where id = :'claim_job_id'::uuid \gset
select rp_test.expect('expired-lease-job-still-technically-leased-until-reaped',
  :'claim_job_before_reap' = 'leased', :'claim_job_before_reap');

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.reap_expired_aria_job_leases(500);
reset role;
select status as claim_job_after_reap from public.aria_jobs where id = :'claim_job_id'::uuid \gset
select rp_test.expect('reaper-reclaims-the-truly-expired-lease',
  :'claim_job_after_reap' = 'queued', :'claim_job_after_reap');
select state as pre_egress_claim_state
  from public.requisition_parse_execution_claims
 where job_id = :'claim_job_id'::uuid \gset
select rp_test.expect('pre-egress-reaper-preserves-recoverable-claim-state',
  :'pre_egress_claim_state' = 'claimed', :'pre_egress_claim_state');

-- The reaper applies jitter before retry. Make only this already-proven job
-- due immediately, then acquire the new real lease through queue authority.
update public.aria_jobs set next_run_at = clock_timestamp() where id = :'claim_job_id'::uuid;
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table claimed7 as
select * from public.claim_due_aria_jobs('worker-f', 120, array['requisition_parse'], 10);
reset role;
select id::text as claim_job_id_2, lease_id::text as claim_lease_id_2 from claimed7 \gset

select rp_test.expect('crash-recovery-same-job-released',
  :'claim_job_id_2' = :'claim_job_id', :'claim_job_id_2');

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_claim_recovered as
select public.authorize_requisition_parse_job_v2(
  :'claim_job_id_2'::uuid, :'claim_lease_id_2'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '67777777-7777-4777-8777-777777777777'::uuid
) result;
reset role;
select rp_test.expect_scalar('crash-recovery-new-lease-claims', $$select result->>'status' from auth_claim_recovered$$, 'authorized');
select result->>'claim_token' as recovered_claim_token,
       result->>'fence_version' as recovered_claim_fence
  from auth_claim_recovered \gset
select count(*)::text as claim_row_count_2 from public.requisition_parse_execution_claims
 where job_id = :'claim_job_id_2'::uuid \gset
select rp_test.expect('crash-recovery-claim-overwritten-not-duplicated', :'claim_row_count_2' = '1', :'claim_row_count_2');
select (select lease_id::text from public.requisition_parse_execution_claims
         where job_id = :'claim_job_id_2'::uuid) as stored_claim_lease \gset
select rp_test.expect('crash-recovery-claim-bound-to-new-lease', :'stored_claim_lease' = :'claim_lease_id_2', :'stored_claim_lease');
select rp_test.expect('crash-recovery-rotates-claim-token',
  :'recovered_claim_token' <> :'original_claim_token', :'recovered_claim_token');
select rp_test.expect('crash-recovery-increments-fence',
  :'recovered_claim_fence'::integer = :'original_claim_fence'::integer + 1,
  concat_ws(':', :'original_claim_fence', :'recovered_claim_fence'));

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table begin_after_recovery as
select public.begin_requisition_parse_egress(
  :'claim_job_id_2'::uuid, :'claim_lease_id_2'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '67777777-7777-4777-8777-777777777777'::uuid,
  :'recovered_claim_token'::uuid, :'recovered_claim_fence'::integer,
  :'claim_hash', 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('crash-recovery-new-lease-begins-egress',
  $$select result->>'status' from begin_after_recovery$$, 'egress_started');
select result->>'egress_attempt_id' as recovered_attempt_id from begin_after_recovery \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table finalized_after_recovery as
select public.finalize_requisition_parse(
  :'claim_job_id_2'::uuid, :'claim_lease_id_2'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '67777777-7777-4777-8777-777777777777'::uuid,
  :'recovered_claim_token'::uuid, :'recovered_claim_fence'::integer,
  :'recovered_attempt_id'::uuid, :'claim_hash',
  jsonb_build_object('title', 'Product Manager', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Hybrid', 'requiredSkills', jsonb_build_array('Roadmap', 'Analytics')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('crash-recovery-finalize-with-new-lease-completes',
  $$select result->>'status' from finalized_after_recovery$$, 'completed');

-- ---------------------------------------------------------------------------
-- An expired egress_started execution is never automatically retried. The
-- reaper makes both the job and claim terminal because the provider outcome
-- is unknown.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('68888888-8888-4888-8888-888888888888', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-egress-expiry', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('68888888-8888-4888-8888-888888888888', '51111111-1111-4111-8111-111111111111',
   'We need a QA Lead, full-time, remote. Automation and Selenium required.', 'text/plain',
   encode(sha256(convert_to('We need a QA Lead, full-time, remote. Automation and Selenium required.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need a QA Lead, full-time, remote. Automation and Selenium required.', 'UTF8')), 'hex') as claim_lost_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:68888888-8888-4888-8888-888888888888',
  jsonb_build_object('requisition_id', '68888888-8888-4888-8888-888888888888')
);
create temporary table claimed8 as
select * from public.claim_due_aria_jobs('worker-g', 120, array['requisition_parse'], 10);
reset role;
select id::text as claim_lost_job_id, lease_id::text as claim_lost_lease_id from claimed8 \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_egress_expiry as
select public.authorize_requisition_parse_job_v2(
  :'claim_lost_job_id'::uuid, :'claim_lost_lease_id'::uuid, '51111111-1111-4111-8111-111111111111'::uuid,
  '68888888-8888-4888-8888-888888888888'::uuid
) result;
reset role;
select result->>'claim_token' as expiry_claim_token,
       result->>'fence_version' as expiry_claim_fence
  from auth_egress_expiry \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table begin_egress_expiry as
select public.begin_requisition_parse_egress(
  :'claim_lost_job_id'::uuid, :'claim_lost_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '68888888-8888-4888-8888-888888888888'::uuid,
  :'expiry_claim_token'::uuid, :'expiry_claim_fence'::integer,
  :'claim_lost_hash', 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('egress-expiry-begin-succeeds',
  $$select result->>'status' from begin_egress_expiry$$, 'egress_started');

update public.aria_jobs
   set lease_expires_at = clock_timestamp() - interval '1 second'
 where id = :'claim_lost_job_id'::uuid;
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.reap_expired_aria_job_leases(500);
reset role;
select j.status as expiry_job_status, c.state as expiry_claim_state
  from public.aria_jobs j
  join public.requisition_parse_execution_claims c on c.job_id = j.id
 where j.id = :'claim_lost_job_id'::uuid \gset
select rp_test.expect('egress-expiry-job-is-dead',
  :'expiry_job_status' = 'dead', :'expiry_job_status');
select rp_test.expect('egress-expiry-claim-is-ambiguous',
  :'expiry_claim_state' = 'ambiguous', :'expiry_claim_state');
select rp_test.expect_scalar('egress-expiry-requisition-wrote-nothing',
  $$select status from public.requisitions where id = '68888888-8888-4888-8888-888888888888'$$, 'received');
select count(*)::text as expiry_queued_count
  from public.aria_jobs
 where id = :'claim_lost_job_id'::uuid and status = 'queued' \gset
select rp_test.expect('egress-expiry-never-requeues',
  :'expiry_queued_count' = '0', :'expiry_queued_count');

-- ---------------------------------------------------------------------------
-- Execution claim enforcement in finalize: a leased job with no execution
-- claim (authorize/begin were never called for this exact lease) is denied
-- and writes nothing, even though every other finalize precondition holds.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('69999999-9999-4999-8999-999999999999', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-claim-lost', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('69999999-9999-4999-8999-999999999999', '51111111-1111-4111-8111-111111111111',
   'We need a Security Engineer, full-time, remote. IAM and SIEM required.', 'text/plain',
   encode(sha256(convert_to('We need a Security Engineer, full-time, remote. IAM and SIEM required.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need a Security Engineer, full-time, remote. IAM and SIEM required.', 'UTF8')), 'hex') as missing_claim_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:69999999-9999-4999-8999-999999999999',
  jsonb_build_object('requisition_id', '69999999-9999-4999-8999-999999999999')
);
create temporary table claimed9 as
select * from public.claim_due_aria_jobs('worker-h', 120, array['requisition_parse'], 10);
reset role;
select id::text as missing_claim_job_id, lease_id::text as missing_claim_lease_id from claimed9 \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table finalized_claim_lost as
select public.finalize_requisition_parse(
  :'missing_claim_job_id'::uuid, :'missing_claim_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '69999999-9999-4999-8999-999999999999'::uuid,
  '00000000-0000-4000-8000-000000000010'::uuid, 1,
  '00000000-0000-4000-8000-000000000011'::uuid, :'missing_claim_hash',
  jsonb_build_object('title', 'Security Engineer', 'seniority', 'Senior', 'employmentType', 'Full-time',
    'locationType', 'Remote', 'requiredSkills', jsonb_build_array('IAM', 'SIEM')),
  '[]'::jsonb, 'anthropic', 'claude-test'
) result;
reset role;
select rp_test.expect_scalar('finalize-denies-missing-execution-claim',
  $$select result->>'status' from finalized_claim_lost$$, 'claim_lost');
select rp_test.expect_scalar('finalize-claim-lost-wrote-nothing',
  $$select status from public.requisitions where id = '69999999-9999-4999-8999-999999999999'$$, 'received');
select status as missing_claim_job_status from public.aria_jobs where id = :'missing_claim_job_id'::uuid \gset
select rp_test.expect('finalize-claim-lost-job-still-leased',
  :'missing_claim_job_status' = 'leased', :'missing_claim_job_status');

-- ---------------------------------------------------------------------------
-- Post-egress failure authority: every execution capability is checked, then
-- the exact holder atomically marks the claim ambiguous and the job dead.
-- This state is terminal and is never eligible for an automatic retry.
-- ---------------------------------------------------------------------------
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('6ccccccc-cccc-4ccc-8ccc-cccccccccccc', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-test-source-explicit-egress-fail', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('6ccccccc-cccc-4ccc-8ccc-cccccccccccc', '51111111-1111-4111-8111-111111111111',
   'We need an SRE, full-time, hybrid. Kubernetes and Observability required.', 'text/plain',
   encode(sha256(convert_to('We need an SRE, full-time, hybrid. Kubernetes and Observability required.', 'UTF8')), 'hex'));
select encode(sha256(convert_to('We need an SRE, full-time, hybrid. Kubernetes and Observability required.', 'UTF8')), 'hex') as fail_egress_hash \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'requisition_parse',
  'requisition_parse:6ccccccc-cccc-4ccc-8ccc-cccccccccccc',
  jsonb_build_object('requisition_id', '6ccccccc-cccc-4ccc-8ccc-cccccccccccc')
);
create temporary table claimed10 as
select * from public.claim_due_aria_jobs('worker-i', 120, array['requisition_parse'], 10);
reset role;
select id::text as fail_egress_job_id, lease_id::text as fail_egress_lease_id from claimed10 \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_fail_egress as
select public.authorize_requisition_parse_job_v2(
  :'fail_egress_job_id'::uuid, :'fail_egress_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '6ccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
) result;
reset role;
select result->>'claim_token' as fail_egress_claim_token,
       result->>'fence_version' as fail_egress_claim_fence
  from auth_fail_egress \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table begin_fail_egress as
select public.begin_requisition_parse_egress(
  :'fail_egress_job_id'::uuid, :'fail_egress_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '6ccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  :'fail_egress_claim_token'::uuid, :'fail_egress_claim_fence'::integer,
  :'fail_egress_hash', 'anthropic', 'claude-test'
) result;
reset role;
select result->>'egress_attempt_id' as fail_egress_attempt_id from begin_fail_egress \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table fail_egress_wrong_token as
select public.fail_requisition_parse_egress(
  :'fail_egress_job_id'::uuid, :'fail_egress_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '6ccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  '00000000-0000-4000-8000-000000000020'::uuid, :'fail_egress_claim_fence'::integer,
  :'fail_egress_attempt_id'::uuid, 'anthropic', 'claude-test', 'wrong token'
) result;
create temporary table fail_egress_wrong_fence as
select public.fail_requisition_parse_egress(
  :'fail_egress_job_id'::uuid, :'fail_egress_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '6ccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  :'fail_egress_claim_token'::uuid, (:'fail_egress_claim_fence'::integer + 1),
  :'fail_egress_attempt_id'::uuid, 'anthropic', 'claude-test', 'wrong fence'
) result;
create temporary table fail_egress_wrong_attempt as
select public.fail_requisition_parse_egress(
  :'fail_egress_job_id'::uuid, :'fail_egress_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '6ccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  :'fail_egress_claim_token'::uuid, :'fail_egress_claim_fence'::integer,
  '00000000-0000-4000-8000-000000000021'::uuid,
  'anthropic', 'claude-test', 'wrong attempt'
) result;
reset role;
select rp_test.expect_scalar('fail-egress-denies-wrong-token',
  $$select result->>'status' from fail_egress_wrong_token$$, 'claim_lost');
select rp_test.expect_scalar('fail-egress-denies-wrong-fence',
  $$select result->>'status' from fail_egress_wrong_fence$$, 'claim_lost');
select rp_test.expect_scalar('fail-egress-denies-wrong-attempt',
  $$select result->>'status' from fail_egress_wrong_attempt$$, 'claim_lost');
select status as fail_egress_before_exact_job_state,
       (select state from public.requisition_parse_execution_claims
         where job_id = :'fail_egress_job_id'::uuid) as fail_egress_before_exact_claim_state
  from public.aria_jobs where id = :'fail_egress_job_id'::uuid \gset
select rp_test.expect('fail-egress-mismatch-denials-are-read-only',
  :'fail_egress_before_exact_job_state' = 'leased'
    and :'fail_egress_before_exact_claim_state' = 'egress_started',
  concat_ws(':', :'fail_egress_before_exact_job_state', :'fail_egress_before_exact_claim_state'));

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table fail_egress_exact as
select public.fail_requisition_parse_egress(
  :'fail_egress_job_id'::uuid, :'fail_egress_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '6ccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  :'fail_egress_claim_token'::uuid, :'fail_egress_claim_fence'::integer,
  :'fail_egress_attempt_id'::uuid,
  'anthropic', 'claude-test', 'provider response outcome unknown'
) result;
reset role;
select rp_test.expect_scalar('fail-egress-exact-holder-marks-ambiguous',
  $$select result->>'status' from fail_egress_exact$$, 'marked_ambiguous');
select concat_ws(':', j.status, c.state, (j.lease_id is null)::text,
       (j.lease_expires_at is null)::text) as fail_egress_terminal_state
  from public.aria_jobs j
  join public.requisition_parse_execution_claims c on c.job_id = j.id
 where j.id = :'fail_egress_job_id'::uuid \gset
select rp_test.expect('fail-egress-transition-is-atomic',
  :'fail_egress_terminal_state' = 'dead:ambiguous:true:true', :'fail_egress_terminal_state');
select count(*)::text as fail_egress_dead_events
  from public.loop_events
 where job_id = :'fail_egress_job_id'::uuid
   and event_type = 'job.dead'
   and payload->>'reason' = 'egress_ambiguous' \gset
select rp_test.expect('fail-egress-emits-one-terminal-event',
  :'fail_egress_dead_events' = '1', :'fail_egress_dead_events');
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.reap_expired_aria_job_leases(500);
reset role;
select status as fail_egress_after_reaper
  from public.aria_jobs where id = :'fail_egress_job_id'::uuid \gset
select rp_test.expect('fail-egress-terminal-job-never-requeues',
  :'fail_egress_after_reaper' = 'dead', :'fail_egress_after_reaper');

-- Generic queue authorities cannot bypass requisition_parse fencing.
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table generic_parse_complete as
select public.complete_aria_job(
  :'missing_claim_job_id'::uuid, :'missing_claim_lease_id'::uuid,
  repeat('a', 64), '[]'::jsonb, '[]'::jsonb
) result;
create temporary table generic_post_egress_fail as
select public.fail_aria_job(
  :'race_job_id'::uuid,
  :'race_lease_id'::uuid,
  'must not requeue after egress', true
) result;
reset role;
select rp_test.expect_scalar('generic-complete-cannot-bypass-parse-finalizer',
  $$select result::text from generic_parse_complete$$, 'false');
select rp_test.expect_scalar('generic-fail-cannot-requeue-post-egress-parse',
  $$select result from generic_post_egress_fail$$, 'not_found');
select concat_ws(':', j.status, c.state) as generic_fence_state
  from public.aria_jobs j
  join public.requisition_parse_execution_claims c on c.job_id = j.id
 where j.id = :'race_job_id'::uuid \gset
select rp_test.expect('generic-post-egress-fences-leave-job-and-claim-live',
  :'generic_fence_state' = 'leased:egress_started', :'generic_fence_state');

-- A newer live lease that discovers a prior egress claim is quarantined
-- atomically; it is never left leased for generic retry handling.
update public.aria_jobs
   set lease_id = '8ddddddd-dddd-4ddd-8ddd-dddddddddddd',
       lease_expires_at = clock_timestamp() + interval '120 seconds',
       claimed_by = 'stale-egress-quarantine'
 where id = :'race_job_id'::uuid;
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table stale_egress_authorize as
select public.authorize_requisition_parse_job_v2(
  :'race_job_id'::uuid, '8ddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  '64444444-4444-4444-8444-444444444444'::uuid
) result;
reset role;
select rp_test.expect_scalar('authorize-quarantines-stale-egress-claim',
  $$select concat_ws(':', result->>'status', (result ? 'content')::text,
       (result ? 'claim_token')::text) from stale_egress_authorize$$,
  'quarantined_ambiguous:false:false');
select concat_ws(':', j.status, c.state, (j.lease_id is null)::text,
       (j.lease_expires_at is null)::text) as stale_egress_quarantine_state
  from public.aria_jobs j
  join public.requisition_parse_execution_claims c on c.job_id = j.id
 where j.id = :'race_job_id'::uuid \gset
select rp_test.expect('authorize-stale-egress-quarantine-is-atomic',
  :'stale_egress_quarantine_state' = 'dead:ambiguous:true:true',
  :'stale_egress_quarantine_state');
select count(*)::text as stale_egress_quarantine_events
  from public.loop_events
 where job_id = :'race_job_id'::uuid
   and event_type = 'job.dead'
   and payload->>'reason' = 'prior_egress_claim_quarantined' \gset
select rp_test.expect('authorize-stale-egress-emits-one-quarantine-event',
  :'stale_egress_quarantine_events' = '1', :'stale_egress_quarantine_events');

-- Defensive reaper behavior covers every non-claimed execution state, not
-- only egress_started. Recreate stale leased rows around one completed and
-- one already-ambiguous claim, then verify neither can return to queued.
update public.aria_jobs
   set status = 'leased',
       lease_id = '8eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
       lease_expires_at = clock_timestamp() - interval '1 second',
       claimed_by = 'completed-claim-reaper-proof'
 where id = :'job_id'::uuid;
update public.aria_jobs
   set status = 'leased',
       lease_id = '8fffffff-ffff-4fff-8fff-ffffffffffff',
       lease_expires_at = clock_timestamp() - interval '1 second',
       claimed_by = 'ambiguous-claim-reaper-proof'
 where id = :'race_job_id'::uuid;
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.reap_expired_aria_job_leases(500)::text as nonclaimed_reaped \gset
reset role;
select rp_test.expect('reaper-quarantines-both-nonclaimed-fixtures',
  :'nonclaimed_reaped' = '2', :'nonclaimed_reaped');
select concat_ws(':',
       (select j.status || '/' || c.state
          from public.aria_jobs j
          join public.requisition_parse_execution_claims c on c.job_id = j.id
         where j.id = :'job_id'::uuid),
       (select j.status || '/' || c.state
          from public.aria_jobs j
          join public.requisition_parse_execution_claims c on c.job_id = j.id
         where j.id = :'race_job_id'::uuid)
     ) as nonclaimed_reaper_states \gset
select rp_test.expect('reaper-never-requeues-completed-or-ambiguous-claims',
  :'nonclaimed_reaper_states' = 'dead/completed:dead/ambiguous',
  :'nonclaimed_reaper_states');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'c1000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  false
);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
set role authenticated;
create temporary table admin_ambiguous_requeue as
select public.requeue_dead_aria_job(:'fail_egress_job_id'::uuid) result;
reset role;
select rp_test.expect_scalar('admin-requeue-cannot-retry-ambiguous-parse',
  $$select result::text from admin_ambiguous_requeue$$, 'false');
select status as ambiguous_after_admin_requeue
  from public.aria_jobs where id = :'fail_egress_job_id'::uuid \gset
select rp_test.expect('admin-requeue-leaves-ambiguous-parse-dead',
  :'ambiguous_after_admin_requeue' = 'dead', :'ambiguous_after_admin_requeue');

-- ---------------------------------------------------------------------------
-- The old requisition-id-only mutation is closed: no role can call it.
-- ---------------------------------------------------------------------------
select rp_test.expect_sqlstate('record-requisition-parse-bypass-is-closed',
  $statement$do $body$
    begin
      set local role service_role;
      perform rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
      perform public.record_requisition_parse(
        '61111111-1111-4111-8111-111111111111', '{}'::jsonb, '[]'::jsonb, 1.0, true
      );
    end;
  $body$;$statement$,
  array['42501']
);

select rp_test.expect_sqlstate('authenticated-cannot-invoke-authorize',
  $statement$do $body$
    begin
      set local role authenticated;
      perform public.authorize_requisition_parse_job_v2(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    end;
  $body$;$statement$,
  array['42501']
);
select rp_test.expect_sqlstate('authenticated-cannot-invoke-begin-egress',
  $statement$do $body$
    begin
      set local role authenticated;
      perform public.begin_requisition_parse_egress(
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), 1, repeat('a', 64), 'anthropic', 'x'
      );
    end;
  $body$;$statement$,
  array['42501']
);
select rp_test.expect_sqlstate('authenticated-cannot-invoke-finalize',
  $statement$do $body$
    begin
      set local role authenticated;
      perform public.finalize_requisition_parse(
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), 1, gen_random_uuid(), repeat('a', 64),
        '{}'::jsonb, '[]'::jsonb, 'anthropic', 'x'
      );
    end;
  $body$;$statement$,
  array['42501']
);
select rp_test.expect_sqlstate('authenticated-cannot-invoke-fail-egress',
  $statement$do $body$
    begin
      set local role authenticated;
      perform public.fail_requisition_parse_egress(
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), 1, gen_random_uuid(), 'anthropic', 'x', 'denied'
      );
    end;
  $body$;$statement$,
  array['42501']
);

select rp_test.expect_scalar('expand-release-retains-legacy-finalizer-signature',
  $$select (to_regprocedure(
       'public.finalize_requisition_parse(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text)'
     ) is not null)::text$$,
  'true');
select rp_test.expect_scalar('expand-release-retains-legacy-authorizer-signature',
  $$select (to_regprocedure(
       'public.authorize_requisition_parse_job(uuid,uuid,uuid,uuid)'
     ) is not null)::text$$,
  'true');
select rp_test.expect_scalar('execution-claims-force-rls',
  $$select concat_ws(':', relrowsecurity::text, relforcerowsecurity::text)
      from pg_class where oid = 'public.requisition_parse_execution_claims'::regclass$$,
  'true:true');
select rp_test.expect_scalar('execution-claims-have-no-direct-service-role-privileges',
  $$select concat_ws(':',
       has_table_privilege('service_role', 'public.requisition_parse_execution_claims', 'SELECT')::text,
       has_table_privilege('service_role', 'public.requisition_parse_execution_claims', 'INSERT')::text,
       has_table_privilege('service_role', 'public.requisition_parse_execution_claims', 'UPDATE')::text,
       has_table_privilege('service_role', 'public.requisition_parse_execution_claims', 'DELETE')::text
     )$$,
  'false:false:false:false');
select rp_test.expect_scalar('execution-claims-have-no-direct-authenticated-privileges',
  $$select concat_ws(':',
       has_table_privilege('authenticated', 'public.requisition_parse_execution_claims', 'SELECT')::text,
       has_table_privilege('authenticated', 'public.requisition_parse_execution_claims', 'INSERT')::text,
       has_table_privilege('authenticated', 'public.requisition_parse_execution_claims', 'UPDATE')::text,
       has_table_privilege('authenticated', 'public.requisition_parse_execution_claims', 'DELETE')::text
     )$$,
  'false:false:false:false');
select rp_test.expect_sqlstate('service-role-cannot-directly-read-execution-claims',
  $statement$do $body$
    begin
      set local role service_role;
      perform 1 from public.requisition_parse_execution_claims limit 1;
    end;
  $body$;$statement$,
  array['42501']
);
select rp_test.expect_sqlstate('service-role-cannot-directly-mutate-execution-claims',
  $statement$do $body$
    begin
      set local role service_role;
      update public.requisition_parse_execution_claims set fence_version = fence_version + 1;
    end;
  $body$;$statement$,
  array['42501']
);
select rp_test.expect_scalar('service-role-has-expand-and-fenced-authority-execute-paths',
  $$select concat_ws(':',
       has_function_privilege('service_role', 'public.authorize_requisition_parse_job(uuid,uuid,uuid,uuid)', 'EXECUTE')::text,
       has_function_privilege('service_role', 'public.finalize_requisition_parse(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text)', 'EXECUTE')::text,
       has_function_privilege('service_role', 'public.authorize_requisition_parse_job_v2(uuid,uuid,uuid,uuid)', 'EXECUTE')::text,
       has_function_privilege('service_role', 'public.begin_requisition_parse_egress(uuid,uuid,uuid,uuid,uuid,integer,text,text,text)', 'EXECUTE')::text,
       has_function_privilege('service_role', 'public.finalize_requisition_parse(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,jsonb,jsonb,text,text)', 'EXECUTE')::text,
       has_function_privilege('service_role', 'public.fail_requisition_parse_egress(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,text)', 'EXECUTE')::text
     )$$,
  'true:true:true:true:true:true');
select rp_test.expect_scalar('legacy-raw-input-helper-is-not-service-callable',
  $$select has_function_privilege(
       'service_role', 'public.get_requisition_input(uuid,uuid)', 'EXECUTE'
     )::text$$,
  'false');

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed from rp_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from rp_test.results where not passed;
    raise exception 'requisition-parse DB test failed: %', details;
  end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Real same-lease concurrency proofs. Two independent PostgreSQL sessions are
# released from a held job-row lock together. Exactly one authorization may
# return raw content, and exactly one begin may mint an egress attempt.
# ---------------------------------------------------------------------------
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-concurrent-authorize', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51111111-1111-4111-8111-111111111111',
   'We need a Platform Engineer, full-time, remote. Terraform and Go required.', 'text/plain',
   encode(sha256(convert_to('We need a Platform Engineer, full-time, remote. Terraform and Go required.', 'UTF8')), 'hex'));
insert into public.aria_jobs (
  id, workspace_id, kind, idempotency_key, payload, payload_sha256,
  status, lease_id, lease_expires_at, claimed_by
) values (
  '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '51111111-1111-4111-8111-111111111111',
  'requisition_parse', 'rp-concurrent-authorize-job',
  jsonb_build_object('requisition_id', '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  encode(sha256(convert_to(
    jsonb_build_object('requisition_id', '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::text,
    'UTF8'
  )), 'hex'),
  'leased', '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  clock_timestamp() + interval '120 seconds', 'rp-concurrent-authorize'
);
SQL

race_log_dir="$(mktemp -d)"

psql_concurrent -q >"$race_log_dir/authorize-holder.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-authorize-holder';
begin;
select id from public.aria_jobs
 where id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 for update;
select pg_advisory_lock(480049);
do $holder$
declare
  blocked integer;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    select count(*) into blocked
      from pg_stat_activity
     where application_name in ('rp-authorize-a', 'rp-authorize-b')
       and wait_event_type = 'Lock';
    exit when blocked = 2;
    if clock_timestamp() >= deadline then
      raise exception 'timed out waiting for concurrent authorize callers';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$holder$;
commit;
SQL
authorize_holder_pid=$!

authorize_holder_ready=0
for _ in $(seq 1 50); do
  authorize_holder_ready="$(psql_concurrent -Atc "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = 480049 and granted")"
  if [ "$authorize_holder_ready" = "1" ]; then
    break
  fi
  sleep 0.1
done
if [ "$authorize_holder_ready" != "1" ]; then
  echo "requisition-parse-db: authorize race holder did not become ready" >&2
  exit 1
fi

for participant in a b; do
  psql_concurrent -q >"$race_log_dir/authorize-${participant}.log" 2>&1 <<SQL &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-authorize-${participant}';
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.authorize_requisition_parse_job_v2(
  '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '51111111-1111-4111-8111-111111111111',
  '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
) as response \gset
reset role;
insert into rp_test.concurrent_outcomes(race_name, participant, outcome)
values (
  'authorize-same-lease', '${participant}',
  concat_ws(':', :'response'::jsonb->>'status', (:'response'::jsonb ? 'content')::text)
);
SQL
  if [ "$participant" = "a" ]; then
    authorize_a_pid=$!
  else
    authorize_b_pid=$!
  fi
done

authorize_race_failed=0
for process_name in authorize-holder authorize-a authorize-b; do
  case "$process_name" in
    authorize-holder) process_pid="$authorize_holder_pid" ;;
    authorize-a) process_pid="$authorize_a_pid" ;;
    authorize-b) process_pid="$authorize_b_pid" ;;
  esac
  if ! wait "$process_pid"; then
    echo "requisition-parse-db: ${process_name} session failed" >&2
    sed -n '1,160p' "$race_log_dir/${process_name}.log" >&2
    authorize_race_failed=1
  fi
done
if [ "$authorize_race_failed" -ne 0 ]; then
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
select rp_test.expect_scalar('concurrent-authorize-has-one-content-bearing-winner',
  $$select count(*)::text from rp_test.concurrent_outcomes
     where race_name = 'authorize-same-lease' and outcome = 'authorized:true'$$,
  '1');
select rp_test.expect_scalar('concurrent-authorize-has-one-content-free-loser',
  $$select count(*)::text from rp_test.concurrent_outcomes
     where race_name = 'authorize-same-lease' and outcome = 'already_claimed:false'$$,
  '1');
select rp_test.expect_scalar('concurrent-authorize-created-one-claim',
  $$select count(*)::text from public.requisition_parse_execution_claims
     where job_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '1');
insert into rp_test.race_context(
  race_name, job_id, lease_id, requisition_id, input_sha256,
  claim_token, fence_version, original_lease_deadline
)
select 'begin-same-lease', j.id, j.lease_id, r.requisition_id, r.need_sha256,
       c.claim_token, c.fence_version, j.lease_expires_at
  from public.aria_jobs j
  join public.requisition_parse_execution_claims c on c.job_id = j.id
  join public.requisition_inputs r
    on r.workspace_id = j.workspace_id
   and r.requisition_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 where j.id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SQL

psql_concurrent -q >"$race_log_dir/begin-holder.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-begin-holder';
begin;
select id from public.aria_jobs
 where id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 for update;
select pg_advisory_lock(480050);
do $holder$
declare
  blocked integer;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    select count(*) into blocked
      from pg_stat_activity
     where application_name in ('rp-begin-a', 'rp-begin-b')
       and wait_event_type = 'Lock';
    exit when blocked = 2;
    if clock_timestamp() >= deadline then
      raise exception 'timed out waiting for concurrent begin callers';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$holder$;
commit;
SQL
begin_holder_pid=$!

begin_holder_ready=0
for _ in $(seq 1 50); do
  begin_holder_ready="$(psql_concurrent -Atc "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = 480050 and granted")"
  if [ "$begin_holder_ready" = "1" ]; then
    break
  fi
  sleep 0.1
done
if [ "$begin_holder_ready" != "1" ]; then
  echo "requisition-parse-db: begin race holder did not become ready" >&2
  exit 1
fi

for participant in a b; do
  psql_concurrent -q >"$race_log_dir/begin-${participant}.log" 2>&1 <<SQL &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-begin-${participant}';
select job_id::text as job_id, lease_id::text as lease_id,
       requisition_id::text as requisition_id, input_sha256,
       claim_token::text as claim_token, fence_version::text as fence_version
  from rp_test.race_context where race_name = 'begin-same-lease' \gset
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.begin_requisition_parse_egress(
  :'job_id'::uuid, :'lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  :'requisition_id'::uuid, :'claim_token'::uuid,
  :'fence_version'::integer, :'input_sha256', 'anthropic', 'claude-race'
) as response \gset
reset role;
insert into rp_test.concurrent_outcomes(race_name, participant, outcome)
values ('begin-same-lease', '${participant}', :'response'::jsonb->>'status');
SQL
  if [ "$participant" = "a" ]; then
    begin_a_pid=$!
  else
    begin_b_pid=$!
  fi
done

begin_race_failed=0
for process_name in begin-holder begin-a begin-b; do
  case "$process_name" in
    begin-holder) process_pid="$begin_holder_pid" ;;
    begin-a) process_pid="$begin_a_pid" ;;
    begin-b) process_pid="$begin_b_pid" ;;
  esac
  if ! wait "$process_pid"; then
    echo "requisition-parse-db: ${process_name} session failed" >&2
    sed -n '1,160p' "$race_log_dir/${process_name}.log" >&2
    begin_race_failed=1
  fi
done
if [ "$begin_race_failed" -ne 0 ]; then
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
select rp_test.expect_scalar('concurrent-begin-mints-one-egress-attempt',
  $$select count(*)::text from rp_test.concurrent_outcomes
     where race_name = 'begin-same-lease' and outcome = 'egress_started'$$,
  '1');
select rp_test.expect_scalar('concurrent-begin-denies-one-duplicate',
  $$select count(*)::text from rp_test.concurrent_outcomes
     where race_name = 'begin-same-lease' and outcome = 'claim_lost'$$,
  '1');
select rp_test.expect_scalar('concurrent-begin-persists-one-bound-attempt',
  $$select concat_ws(':', state, (egress_attempt_id is not null)::text,
       provider, model)
      from public.requisition_parse_execution_claims
     where job_id = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'egress_started:true:anthropic:claude-race');
SQL

# ---------------------------------------------------------------------------
# Reaper-vs-begin safe race. Begin acquires the job row while its lease is
# live, extends it, and deliberately keeps the transaction open past the old
# deadline. The concurrent reaper sees an expired pre-update snapshot but
# must skip the locked row; it can neither requeue nor dead-letter the job.
# ---------------------------------------------------------------------------
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
insert into public.requisitions (id, workspace_id, source_kind, source_ref, status) values
  ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '51111111-1111-4111-8111-111111111111', 'api',
   'rp-begin-reaper-race', 'received');
insert into public.requisition_inputs (requisition_id, workspace_id, content, content_type, need_sha256) values
  ('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '51111111-1111-4111-8111-111111111111',
   'We need a Cloud Engineer, full-time, remote. AWS and Terraform required.', 'text/plain',
   encode(sha256(convert_to('We need a Cloud Engineer, full-time, remote. AWS and Terraform required.', 'UTF8')), 'hex'));
insert into public.aria_jobs (
  id, workspace_id, kind, idempotency_key, payload, payload_sha256,
  status, lease_id, lease_expires_at, claimed_by
) values (
  '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '51111111-1111-4111-8111-111111111111',
  'requisition_parse', 'rp-begin-reaper-race-job',
  jsonb_build_object('requisition_id', '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  encode(sha256(convert_to(
    jsonb_build_object('requisition_id', '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')::text,
    'UTF8'
  )), 'hex'),
  'leased', '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  clock_timestamp() + interval '5 seconds', 'rp-begin-reaper-race'
);
set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table auth_begin_reaper as
select public.authorize_requisition_parse_job_v2(
  '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '51111111-1111-4111-8111-111111111111',
  '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
) result;
reset role;
insert into rp_test.race_context(
  race_name, job_id, lease_id, requisition_id, input_sha256,
  claim_token, fence_version, original_lease_deadline
)
select 'begin-vs-reaper', j.id, j.lease_id, r.requisition_id, r.need_sha256,
       (a.result->>'claim_token')::uuid,
       (a.result->>'fence_version')::integer,
       j.lease_expires_at
  from public.aria_jobs j
  cross join auth_begin_reaper a
  join public.requisition_inputs r
    on r.workspace_id = j.workspace_id
   and r.requisition_id = '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 where j.id = '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
SQL

psql_concurrent -q >"$race_log_dir/begin-reaper-begin.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-begin-reaper-begin';
select job_id::text as job_id, lease_id::text as lease_id,
       requisition_id::text as requisition_id, input_sha256,
       claim_token::text as claim_token, fence_version::text as fence_version
  from rp_test.race_context where race_name = 'begin-vs-reaper' \gset
begin;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.begin_requisition_parse_egress(
  :'job_id'::uuid, :'lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  :'requisition_id'::uuid, :'claim_token'::uuid,
  :'fence_version'::integer, :'input_sha256', 'anthropic', 'claude-reaper-race'
) as response \gset
reset role;
select pg_advisory_lock(480051);
select pg_sleep(7);
commit;
insert into rp_test.concurrent_outcomes(race_name, participant, outcome)
values ('begin-vs-reaper', 'begin', :'response'::jsonb->>'status');
SQL
begin_reaper_begin_pid=$!

begin_reaper_ready=0
for _ in $(seq 1 50); do
  begin_reaper_ready="$(psql_concurrent -Atc "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = 480051 and granted")"
  if [ "$begin_reaper_ready" = "1" ]; then
    break
  fi
  sleep 0.1
done
if [ "$begin_reaper_ready" != "1" ]; then
  echo "requisition-parse-db: begin-vs-reaper holder did not become ready" >&2
  exit 1
fi

psql_concurrent -q >"$race_log_dir/begin-reaper-reaper.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-begin-reaper-reaper';
select original_lease_deadline
  from rp_test.race_context where race_name = 'begin-vs-reaper' \gset
select pg_sleep(
  greatest(0.0, extract(epoch from (
    :'original_lease_deadline'::timestamptz - clock_timestamp()
  ))) + 0.25
);
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.reap_expired_aria_job_leases(500)::text as response \gset
reset role;
insert into rp_test.concurrent_outcomes(race_name, participant, outcome)
values ('begin-vs-reaper', 'reaper', :'response');
SQL
begin_reaper_reaper_pid=$!

begin_reaper_failed=0
for process_name in begin-reaper-reaper begin-reaper-begin; do
  case "$process_name" in
    begin-reaper-reaper) process_pid="$begin_reaper_reaper_pid" ;;
    begin-reaper-begin) process_pid="$begin_reaper_begin_pid" ;;
  esac
  if ! wait "$process_pid"; then
    echo "requisition-parse-db: ${process_name} session failed" >&2
    sed -n '1,160p' "$race_log_dir/${process_name}.log" >&2
    begin_reaper_failed=1
  fi
done
if [ "$begin_reaper_failed" -ne 0 ]; then
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
select rp_test.expect_scalar('reaper-race-begin-wins-and-starts-egress',
  $$select outcome from rp_test.concurrent_outcomes
     where race_name = 'begin-vs-reaper' and participant = 'begin'$$,
  'egress_started');
select rp_test.expect_scalar('reaper-race-skips-the-locked-job',
  $$select outcome from rp_test.concurrent_outcomes
     where race_name = 'begin-vs-reaper' and participant = 'reaper'$$,
  '0');
select rp_test.expect_scalar('reaper-race-keeps-extended-egress-live',
  $$select concat_ws(':', j.status, c.state,
       (j.lease_expires_at > rc.original_lease_deadline)::text,
       (j.lease_expires_at > clock_timestamp())::text)
      from public.aria_jobs j
      join public.requisition_parse_execution_claims c on c.job_id = j.id
      join rp_test.race_context rc on rc.job_id = j.id
     where rc.race_name = 'begin-vs-reaper'$$,
  'leased:egress_started:true:true');
SQL

# ---------------------------------------------------------------------------
# Ingress-replay vs finalizer lock-order proof. The holder manually owns the
# requisition row, releases a real finalizer that must wait there, and only
# then executes the ingress replay that locks the job. With the required
# requisition->job order, replay completes and releases the finalizer. The old
# job->requisition order would form a deterministic deadlock in this schedule.
# ---------------------------------------------------------------------------
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
-- The raw ingestion function is a revoked postgres-owned primitive after
-- migration 0056. This owner-level harness exercises its lock ordering while
-- preserving the service-role claims required by the function body.
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table ingress_finalize_seed as
select public.ingest_requisition_and_enqueue(
  '51111111-1111-4111-8111-111111111111',
  'rp-ingress-finalize-race',
  'We need a Database Engineer, full-time, remote. PostgreSQL and SQL required.',
  'text/plain'
) result;
create temporary table ingress_finalize_claimed as
select * from public.claim_due_aria_jobs(
  'worker-ingress-finalize', 120, array['requisition_parse'], 10
);
reset role;
select result->>'requisition_id' as ingress_finalize_req_id,
       result->>'job_id' as ingress_finalize_job_id
  from ingress_finalize_seed \gset
select id::text as ingress_finalize_claimed_job_id,
       lease_id::text as ingress_finalize_lease_id
  from ingress_finalize_claimed
 where id = :'ingress_finalize_job_id'::uuid \gset
select rp_test.expect('ingress-finalize-race-claimed-seeded-job',
  :'ingress_finalize_claimed_job_id' = :'ingress_finalize_job_id',
  concat_ws(':', :'ingress_finalize_claimed_job_id', :'ingress_finalize_job_id'));

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table ingress_finalize_auth as
select public.authorize_requisition_parse_job_v2(
  :'ingress_finalize_job_id'::uuid, :'ingress_finalize_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  :'ingress_finalize_req_id'::uuid
) result;
reset role;
select result->>'claim_token' as ingress_finalize_claim_token,
       result->>'fence_version' as ingress_finalize_fence,
       result->>'need_sha256' as ingress_finalize_hash
  from ingress_finalize_auth \gset

set role service_role;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table ingress_finalize_begin as
select public.begin_requisition_parse_egress(
  :'ingress_finalize_job_id'::uuid, :'ingress_finalize_lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  :'ingress_finalize_req_id'::uuid,
  :'ingress_finalize_claim_token'::uuid, :'ingress_finalize_fence'::integer,
  :'ingress_finalize_hash', 'anthropic', 'claude-lock-order'
) result;
reset role;
insert into rp_test.race_context(
  race_name, job_id, lease_id, requisition_id, input_sha256,
  claim_token, fence_version, egress_attempt_id, provider, model,
  original_lease_deadline
)
select 'ingress-vs-finalize',
       :'ingress_finalize_job_id'::uuid,
       :'ingress_finalize_lease_id'::uuid,
       :'ingress_finalize_req_id'::uuid,
       :'ingress_finalize_hash',
       :'ingress_finalize_claim_token'::uuid,
       :'ingress_finalize_fence'::integer,
       (result->>'egress_attempt_id')::uuid,
       'anthropic', 'claude-lock-order', null
  from ingress_finalize_begin;
SQL

psql_concurrent -q >"$race_log_dir/ingress-finalize-holder.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-ingress-finalize-holder';
select requisition_id::text as requisition_id
  from rp_test.race_context where race_name = 'ingress-vs-finalize' \gset
begin;
select id from public.requisitions where id = :'requisition_id'::uuid for update;
select pg_advisory_lock(480052);
do $holder$
declare
  blocked integer;
  deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    select count(*) into blocked
      from pg_stat_activity
     where application_name = 'rp-ingress-finalize-finalizer'
       and wait_event_type = 'Lock';
    exit when blocked = 1;
    if clock_timestamp() >= deadline then
      raise exception 'timed out waiting for finalizer to block on requisition';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$holder$;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.ingest_requisition_and_enqueue(
  '51111111-1111-4111-8111-111111111111',
  'rp-ingress-finalize-race',
  'We need a Database Engineer, full-time, remote. PostgreSQL and SQL required.',
  'text/plain'
) as response \gset
reset role;
insert into rp_test.concurrent_outcomes(race_name, participant, outcome)
values (
  'ingress-vs-finalize', 'ingress',
  concat_ws(':', :'response'::jsonb->>'status', :'response'::jsonb->>'replay')
);
commit;
SQL
ingress_finalize_holder_pid=$!

ingress_finalize_ready=0
for _ in $(seq 1 50); do
  ingress_finalize_ready="$(psql_concurrent -Atc "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = 480052 and granted")"
  if [ "$ingress_finalize_ready" = "1" ]; then
    break
  fi
  sleep 0.1
done
if [ "$ingress_finalize_ready" != "1" ]; then
  echo "requisition-parse-db: ingress-finalize holder did not become ready" >&2
  exit 1
fi

psql_concurrent -q >"$race_log_dir/ingress-finalize-finalizer.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '20s';
set application_name = 'rp-ingress-finalize-finalizer';
select job_id::text as job_id, lease_id::text as lease_id,
       requisition_id::text as requisition_id, input_sha256,
       claim_token::text as claim_token, fence_version::text as fence_version,
       egress_attempt_id::text as egress_attempt_id, provider, model
  from rp_test.race_context where race_name = 'ingress-vs-finalize' \gset
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.finalize_requisition_parse(
  :'job_id'::uuid, :'lease_id'::uuid,
  '51111111-1111-4111-8111-111111111111'::uuid,
  :'requisition_id'::uuid, :'claim_token'::uuid,
  :'fence_version'::integer, :'egress_attempt_id'::uuid, :'input_sha256',
  jsonb_build_object(
    'title', 'Database Engineer',
    'seniority', 'Senior',
    'employmentType', 'Full-time',
    'locationType', 'Remote',
    'requiredSkills', jsonb_build_array('PostgreSQL', 'SQL')
  ),
  '[]'::jsonb, :'provider', :'model'
) as response \gset
reset role;
insert into rp_test.concurrent_outcomes(race_name, participant, outcome)
values ('ingress-vs-finalize', 'finalizer', :'response'::jsonb->>'status');
SQL
ingress_finalize_finalizer_pid=$!

ingress_finalize_failed=0
for process_name in ingress-finalize-holder ingress-finalize-finalizer; do
  case "$process_name" in
    ingress-finalize-holder) process_pid="$ingress_finalize_holder_pid" ;;
    ingress-finalize-finalizer) process_pid="$ingress_finalize_finalizer_pid" ;;
  esac
  if ! wait "$process_pid"; then
    echo "requisition-parse-db: ${process_name} session failed" >&2
    sed -n '1,200p' "$race_log_dir/${process_name}.log" >&2
    ingress_finalize_failed=1
  fi
done
if [ "$ingress_finalize_failed" -ne 0 ]; then
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
select rp_test.expect_scalar('ingress-finalize-race-replay-completes-without-deadlock',
  $$select outcome from rp_test.concurrent_outcomes
     where race_name = 'ingress-vs-finalize' and participant = 'ingress'$$,
  'accepted:true');
select rp_test.expect_scalar('ingress-finalize-race-finalizer-completes-after-replay',
  $$select outcome from rp_test.concurrent_outcomes
     where race_name = 'ingress-vs-finalize' and participant = 'finalizer'$$,
  'completed');
select rp_test.expect_scalar('ingress-finalize-race-ends-in-one-succeeded-job',
  $$select concat_ws(':', j.status, c.state,
       (select count(*)::text from public.requisition_parse_receipts r where r.job_id = j.id))
      from public.aria_jobs j
      join public.requisition_parse_execution_claims c on c.job_id = j.id
      join rp_test.race_context rc on rc.job_id = j.id
     where rc.race_name = 'ingress-vs-finalize'$$,
  'succeeded:completed:1');
SQL

# ---------------------------------------------------------------------------
# Lock-wait expiry race: each statement starts while its lease is live, then
# blocks behind a concurrent row lock until after lease_expires_at. The
# authority functions must evaluate expiry only after acquiring that lock.
# Three independent callers are required so heartbeat, complete, and fail all
# wait concurrently rather than merely observing a lease that was already
# expired when their statements began.
# ---------------------------------------------------------------------------
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

select clock_timestamp() + interval '15 seconds' as lock_wait_lease_expires_at \gset

insert into public.aria_jobs (
  id, workspace_id, kind, idempotency_key, payload, payload_sha256,
  status, lease_id, lease_expires_at, claimed_by
) values
  (
    '65555555-5555-4555-8555-555555555551',
    '51111111-1111-4111-8111-111111111111',
    'requisition_parse', 'lock-wait-heartbeat:0001', '{}'::jsonb,
    encode(sha256(convert_to('{}'::jsonb::text, 'UTF8')), 'hex'),
    'leased', '75555555-5555-4555-8555-555555555551',
    :'lock_wait_lease_expires_at'::timestamptz, 'lock-wait-test'
  ),
  (
    '65555555-5555-4555-8555-555555555552',
    '51111111-1111-4111-8111-111111111111',
    'requisition_parse', 'lock-wait-complete:0001', '{}'::jsonb,
    encode(sha256(convert_to('{}'::jsonb::text, 'UTF8')), 'hex'),
    'leased', '75555555-5555-4555-8555-555555555552',
    :'lock_wait_lease_expires_at'::timestamptz, 'lock-wait-test'
  ),
  (
    '65555555-5555-4555-8555-555555555553',
    '51111111-1111-4111-8111-111111111111',
    'requisition_parse', 'lock-wait-fail:0001', '{}'::jsonb,
    encode(sha256(convert_to('{}'::jsonb::text, 'UTF8')), 'hex'),
    'leased', '75555555-5555-4555-8555-555555555553',
    :'lock_wait_lease_expires_at'::timestamptz, 'lock-wait-test'
  );
SQL

# The holder takes every row lock before publishing an advisory-lock signal.
# It then waits until all three callers are visibly blocked, verifies that
# every call began before the shared lease deadline, and holds the rows until
# just after that deadline. Statement timeouts bound every failure mode.
lock_wait_log_dir="$(mktemp -d)"

psql_concurrent -q >"$lock_wait_log_dir/holder.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '25s';
set application_name = 'rp-lock-holder';
begin;
select id
  from public.aria_jobs
 where id in (
   '65555555-5555-4555-8555-555555555551',
   '65555555-5555-4555-8555-555555555552',
   '65555555-5555-4555-8555-555555555553'
 )
 order by id
 for update;
select pg_advisory_lock(480048);
do $lock_holder$
declare
  blocked_callers integer;
  late_callers integer;
  lease_deadline timestamptz;
  wait_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  loop
    perform pg_stat_clear_snapshot();
    select count(*) into blocked_callers
      from pg_stat_activity
     where application_name in (
       'rp-heartbeat-waiter', 'rp-complete-waiter', 'rp-fail-waiter'
     )
       and wait_event_type = 'Lock';
    exit when blocked_callers = 3;
    if clock_timestamp() >= wait_deadline then
      raise exception 'timed out waiting for all lease-expiry callers to block';
    end if;
    perform pg_sleep(0.05);
  end loop;

  select min(lease_expires_at) into lease_deadline
    from public.aria_jobs
   where id in (
     '65555555-5555-4555-8555-555555555551',
     '65555555-5555-4555-8555-555555555552',
     '65555555-5555-4555-8555-555555555553'
   );
  select count(*) into late_callers
    from pg_stat_activity
   where application_name in (
     'rp-heartbeat-waiter', 'rp-complete-waiter', 'rp-fail-waiter'
   )
     and query_start >= lease_deadline;
  if late_callers <> 0 then
    raise exception 'a lease-expiry caller began after the lease deadline';
  end if;

  perform pg_sleep(
    greatest(0.0, extract(epoch from (lease_deadline - clock_timestamp()))) + 0.25
  );
end;
$lock_holder$;
commit;
SQL
lock_holder_pid=$!

holder_ready=0
for _ in $(seq 1 25); do
  holder_ready="$(psql_concurrent -Atc "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = 480048 and granted")"
  if [ "$holder_ready" = "1" ]; then
    break
  fi
  sleep 0.1
done
if [ "$holder_ready" != "1" ]; then
  echo "requisition-parse-db: lock holder did not become ready" >&2
  exit 1
fi

psql_concurrent -q >"$lock_wait_log_dir/heartbeat.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '25s';
set application_name = 'rp-heartbeat-waiter';
begin;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.heartbeat_aria_job(
  '65555555-5555-4555-8555-555555555551',
  '75555555-5555-4555-8555-555555555551',
  60
)::text as lock_wait_outcome \gset
reset role;
select rp_test.expect(
  'lock-wait-expired-lease-heartbeat-denied',
  :'lock_wait_outcome' = 'false',
  :'lock_wait_outcome'
);
commit;
SQL
heartbeat_waiter_pid=$!

psql_concurrent -q >"$lock_wait_log_dir/complete.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '25s';
set application_name = 'rp-complete-waiter';
begin;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.complete_aria_job(
  '65555555-5555-4555-8555-555555555552',
  '75555555-5555-4555-8555-555555555552',
  null, '[]'::jsonb, '[]'::jsonb
)::text as lock_wait_outcome \gset
reset role;
select rp_test.expect(
  'lock-wait-expired-lease-complete-denied',
  :'lock_wait_outcome' = 'false',
  :'lock_wait_outcome'
);
commit;
SQL
complete_waiter_pid=$!

psql_concurrent -q >"$lock_wait_log_dir/fail.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set statement_timeout = '25s';
set application_name = 'rp-fail-waiter';
begin;
select rp_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
set role service_role;
select public.fail_aria_job(
  '65555555-5555-4555-8555-555555555553',
  '75555555-5555-4555-8555-555555555553',
  'lock wait expiry test', true
) as lock_wait_outcome \gset
reset role;
select rp_test.expect(
  'lock-wait-expired-lease-fail-denied',
  :'lock_wait_outcome' = 'not_found',
  :'lock_wait_outcome'
);
commit;
SQL
fail_waiter_pid=$!

lock_wait_failed=0
for process_name in holder heartbeat complete fail; do
  case "$process_name" in
    holder) process_pid="$lock_holder_pid" ;;
    heartbeat) process_pid="$heartbeat_waiter_pid" ;;
    complete) process_pid="$complete_waiter_pid" ;;
    fail) process_pid="$fail_waiter_pid" ;;
  esac
  if ! wait "$process_pid"; then
    echo "requisition-parse-db: ${process_name} lock-wait session failed" >&2
    sed -n '1,160p' "$lock_wait_log_dir/${process_name}.log" >&2
    lock_wait_failed=1
  fi
done
if [ "$lock_wait_failed" -ne 0 ]; then
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

select rp_test.expect_scalar(
  'lock-wait-expired-leases-left-unmodified',
  $$select count(*)::text
      from public.aria_jobs
     where id in (
       '65555555-5555-4555-8555-555555555551',
       '65555555-5555-4555-8555-555555555552',
       '65555555-5555-4555-8555-555555555553'
     )
       and status = 'leased'
       and lease_id is not null
       and lease_expires_at <= clock_timestamp()$$,
  '3'
);

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed from rp_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from rp_test.results where not passed;
    raise exception 'requisition-parse DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from rp_test.results")"
echo "requisition-parse-db: pre-egress authority, atomic parse+enqueue, replay exactness, control race rollback, lease expiry and lock-wait expiry: ${assertions} assertions, 0 failed"
