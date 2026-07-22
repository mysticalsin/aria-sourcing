#!/usr/bin/env bash
# Disposable-Postgres proof for 0049 need ingress authority.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-need-ingress-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
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
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin --single-transaction -q < "$migration"
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema need_ingress_test;
create table need_ingress_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function need_ingress_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, need_ingress_test
as $$
begin
  insert into need_ingress_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function need_ingress_test.expect_scalar(
  p_case_name text,
  p_statement text,
  p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, need_ingress_test
as $$
declare
  actual text;
begin
  execute p_statement into actual;
  perform need_ingress_test.expect(
    p_case_name,
    actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function need_ingress_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, need_ingress_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform need_ingress_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform need_ingress_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function need_ingress_test.set_service_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'service_role')::text,
    false
  );
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function need_ingress_test.set_authenticated_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'authenticated')::text,
    false
  );
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;

grant usage on schema need_ingress_test to service_role, authenticated;
grant execute on all functions in schema need_ingress_test to service_role, authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'need-admin@example.test', '', now(),
  '{}', '{}', now(), now()
);
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c3000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'need-member@example.test', '', now(),
  '{}', '{}', now(), now()
);

insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111', 'Need ingress', 'need.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001', 'need-admin@example.test', 'Need Admin',
   '51111111-1111-4111-8111-111111111111', 'admin');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c3000000-0000-4000-8000-000000000003', 'need-member@example.test', 'Need Member',
   '51111111-1111-4111-8111-111111111111', 'member');

set role authenticated;
select need_ingress_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table credential_create_result as
select public.create_need_ingress_credential(
  'Workday production',
  repeat('a', 64),
  now() + interval '30 days',
  '81000000-0000-4000-8000-000000000001',
  '51111111-1111-4111-8111-111111111111'
) result;
create temporary table credential_create_replay_result as
select public.create_need_ingress_credential(
  'Workday production',
  repeat('a', 64),
  ((select result->>'expires_at' from credential_create_result))::timestamptz,
  '81000000-0000-4000-8000-000000000001',
  '51111111-1111-4111-8111-111111111111'
) result;
create temporary table credential_create_conflict_result as
select public.create_need_ingress_credential(
  'Changed label',
  repeat('a', 64),
  ((select result->>'expires_at' from credential_create_result))::timestamptz,
  '81000000-0000-4000-8000-000000000001',
  '51111111-1111-4111-8111-111111111111'
) result;
create temporary table credential_create_workspace_conflict_result as
select public.create_need_ingress_credential(
  'Wrong workspace',
  repeat('f', 64),
  now() + interval '30 days',
  '81000000-0000-4000-8000-000000000007',
  '52222222-2222-4222-8222-222222222222'
) result;
create temporary table credential_revoke_workspace_conflict_result as
select public.revoke_need_ingress_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  '81000000-0000-4000-8000-000000000008',
  '52222222-2222-4222-8222-222222222222'
) result;
reset role;
grant select on credential_create_result to service_role;

select need_ingress_test.expect_scalar(
  'admin-creates-tenant-bound-credential',
  $$select concat_ws(':', result->>'status', result->>'replay', result->>'workspace_id')
      from credential_create_result$$,
  'created:false:51111111-1111-4111-8111-111111111111'
);
select need_ingress_test.expect_scalar(
  'credential-create-output-excludes-key-digest',
  $$select (result ? 'key_sha256')::text from credential_create_result$$,
  'false'
);
select need_ingress_test.expect_scalar(
  'credential-create-exact-replay-is-idempotent',
  $$select concat_ws(':', result->>'status', result->>'replay',
       (result->>'credential_id' = (select original.result->>'credential_id'
          from credential_create_result original))::text)
      from credential_create_replay_result$$,
  'created:true:true'
);
select need_ingress_test.expect_scalar(
  'credential-create-changed-replay-conflicts',
  $$select result->>'status' from credential_create_conflict_result$$,
  'idempotency_conflict'
);
select need_ingress_test.expect_scalar(
  'credential-mutations-reject-an-outdated-expected-workspace',
  $$select concat_ws(':',
       (select result->>'status' from credential_create_workspace_conflict_result),
       (select result->>'status' from credential_revoke_workspace_conflict_result),
       (select count(*) from public.need_ingress_credentials)::text,
       (select count(*) from public.need_ingress_credential_receipts)::text,
       (select status from public.need_ingress_credentials
         where id = ((select result->>'credential_id' from credential_create_result))::uuid))$$,
  'workspace_conflict:workspace_conflict:1:1:active'
);
select need_ingress_test.expect_scalar(
  'credential-create-has-one-immutable-receipt',
  $$select concat_ws(':', count(*)::text,
       bool_and(receipt_sha256 = encode(sha256(convert_to(concat_ws(E'\n',
         'aria.need-ingress-credential-receipt.v1', id::text, workspace_id::text,
         credential_id::text, request_id::text, event_type, actor_id::text,
         label, ((extract(epoch from expires_at) * 1000000)::bigint)::text,
         key_sha256, request_sha256
       ), 'UTF8')), 'hex'))::text)
      from public.need_ingress_credential_receipts$$,
  '1:true'
);
select need_ingress_test.expect_sqlstate(
  'non-admin-cannot-create-credential',
  $statement$do $body$
    begin
      set local role authenticated;
      perform need_ingress_test.set_authenticated_claims('c3000000-0000-4000-8000-000000000003');
      perform public.create_need_ingress_credential(
        'Unauthorized key', repeat('e', 64), now() + interval '30 days',
        '81000000-0000-4000-8000-000000000009',
        '51111111-1111-4111-8111-111111111111'
      );
    end;
  $body$;$statement$,
  array['42501']
);

set role service_role;
select need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table disabled_result as
select public.ingest_requisition_with_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  repeat('a', 64),
  'need:workday:disabled:0001',
  'We need a Senior Data Engineer with Python and SQL.',
  'text/plain'
) result;
reset role;

select need_ingress_test.expect_scalar(
  'fail-closed-controls',
  $$select result->>'status' from disabled_result$$,
  'intake_disabled'
);
select need_ingress_test.expect_scalar(
  'disabled-ingress-writes-nothing',
  $$select concat_ws(':',
       (select count(*) from public.requisitions)::text,
       (select count(*) from public.requisition_inputs)::text,
       (select count(*) from public.aria_jobs)::text)$$,
  '0:0:0'
);

update public.sourcing_loop_controls
   set kill_switch = false,
       intake_enabled = true,
       updated_by = 'c1000000-0000-4000-8000-000000000001'
 where workspace_id = '51111111-1111-4111-8111-111111111111';

set role service_role;
select need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table fresh_result as
select public.ingest_requisition_with_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  repeat('a', 64),
  'need:workday:20270115:000001',
  'We need a Senior Data Engineer, full-time and remote in Canada. Must have Python, SQL, and Airflow.',
  'text/plain'
) result;
create temporary table replay_result as
select public.ingest_requisition_with_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  repeat('a', 64),
  'need:workday:20270115:000001',
  'We need a Senior Data Engineer, full-time and remote in Canada. Must have Python, SQL, and Airflow.',
  'text/plain'
) result;
create temporary table drift_result as
select public.ingest_requisition_with_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  repeat('a', 64),
  'need:workday:20270115:000001',
  'We need a different Staff Engineer role with Go and PostgreSQL.',
  'text/plain'
) result;
create temporary table invalid_json_result as
select public.ingest_requisition_with_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  repeat('a', 64),
  'need:workday:invalid-json:0001',
  'this claims to be JSON but is not a JSON object',
  'application/json'
) result;
reset role;

select need_ingress_test.expect_scalar(
  'fresh-accepted',
  $$select concat_ws(':', result->>'status', result->>'replay') from fresh_result$$,
  'accepted:false'
);
select need_ingress_test.expect_scalar(
  'exact-replay-same-authority',
  $$select concat_ws(':', replay.result->>'status', replay.result->>'replay',
       (replay.result->>'requisition_id' = fresh.result->>'requisition_id')::text,
       (replay.result->>'job_id' = fresh.result->>'job_id')::text)
      from replay_result replay, fresh_result fresh$$,
  'accepted:true:true:true'
);
select need_ingress_test.expect_scalar(
  'payload-drift-conflicts',
  $$select result->>'status' from drift_result$$,
  'idempotency_conflict'
);
select need_ingress_test.expect_scalar(
  'advertised-json-must-be-an-object',
  $$select result->>'status' from invalid_json_result$$,
  'invalid_request'
);
select need_ingress_test.expect_scalar(
  'one-requisition-input-job',
  $$select concat_ws(':',
       (select count(*) from public.requisitions)::text,
       (select count(*) from public.requisition_inputs)::text,
       (select count(*) from public.aria_jobs)::text)$$,
  '1:1:1'
);
select need_ingress_test.expect_scalar(
  'parse-job-carries-id-only',
  $$select concat_ws(':', kind, status, (payload = jsonb_build_object(
       'requisition_id', (select id::text from public.requisitions limit 1)))::text)
      from public.aria_jobs$$,
  'requisition_parse:queued:true'
);
select need_ingress_test.expect_scalar(
  'input-is-content-bound',
  $$select concat_ws(':', content_type,
       (need_sha256 = encode(sha256(convert_to(content_type || E'\n' || content, 'UTF8')), 'hex'))::text)
      from public.requisition_inputs$$,
  'text/plain:true'
);

-- Migration 0051 retired the raw-input helper. Content may now cross the
-- service boundary only after the queue has issued a live lease and the fenced
-- parser authorizer has atomically claimed that exact job/input identity.
set role service_role;
select need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table claimed_input_job as
select * from public.claim_due_aria_jobs(
  'need-ingress-worker', 120, array['requisition_parse'], 1
);
create temporary table authorized_input as
select public.authorize_requisition_parse_job_v2(
  (select id from claimed_input_job),
  (select lease_id from claimed_input_job),
  '51111111-1111-4111-8111-111111111111',
  ((select result->>'requisition_id' from fresh_result))::uuid
) result;
reset role;
select need_ingress_test.expect_scalar(
  'ingressed-job-is-leased-before-content-release',
  $$select concat_ws(':', status, kind) from claimed_input_job$$,
  'leased:requisition_parse'
);
select need_ingress_test.expect_scalar(
  'fenced-authorization-releases-exact-ingressed-content',
  $$select concat_ws(':',
       result->>'status',
       result->>'workspace_id',
       result->>'content_type',
       (result->>'need_sha256' = (
          select need_sha256 from public.requisition_inputs
           where requisition_id = ((select result->>'requisition_id' from fresh_result))::uuid
       ))::text,
       result->>'content')
      from authorized_input$$,
  'authorized:51111111-1111-4111-8111-111111111111:text/plain:true:We need a Senior Data Engineer, full-time and remote in Canada. Must have Python, SQL, and Airflow.'
);

-- Cross-workspace denial: the same requisition id, named under a DIFFERENT
-- workspace, must never resolve — a stray or spoofed workspace_id can't be
-- used to read another tenant's need content.
insert into public.workspaces(id, name, allowed_domain) values
  ('52222222-2222-4222-8222-222222222222', 'Need ingress (other tenant)', 'need-other.example.test');
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'other-need-admin@example.test', '', now(),
  '{}', '{}', now(), now()
);
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c2000000-0000-4000-8000-000000000002', 'other-need-admin@example.test', 'Other Need Admin',
   '52222222-2222-4222-8222-222222222222', 'admin');

do $active_limit_fixture$
begin
  perform set_config('aria.need_ingress_credential_mutation_authorized', '0056', true);
  insert into public.need_ingress_credentials (
    id, workspace_id, key_sha256, label, expires_at, created_by
  )
  select
    gen_random_uuid(),
    '52222222-2222-4222-8222-222222222222'::uuid,
    encode(sha256(convert_to('active-limit-' || value::text, 'UTF8')), 'hex'),
    'Active limit ' || value::text,
    now() + interval '30 days',
    'c2000000-0000-4000-8000-000000000002'::uuid
  from generate_series(1, 100) value;
end;
$active_limit_fixture$;

set role service_role;
select need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table cross_workspace_input as
select public.authorize_requisition_parse_job_v2(
  (select id from claimed_input_job),
  (select lease_id from claimed_input_job),
  '52222222-2222-4222-8222-222222222222',
  ((select result->>'requisition_id' from fresh_result))::uuid
) result;
reset role;
select need_ingress_test.expect_scalar(
  'cross-workspace-read-is-denied',
  $$select concat_ws(':', result->>'status', (result ? 'content')::text)
      from cross_workspace_input$$,
  'wrong_workspace:false'
);

set role authenticated;
select need_ingress_test.set_authenticated_claims('c2000000-0000-4000-8000-000000000002');
create temporary table credential_active_limit_result as
select public.create_need_ingress_credential(
  'Hundred and first',
  repeat('9', 64),
  now() + interval '30 days',
  '82000000-0000-4000-8000-000000000002',
  '52222222-2222-4222-8222-222222222222'
) result;
create temporary table cross_tenant_revoke_result as
select public.revoke_need_ingress_credential(
  ((select result->>'credential_id' from credential_create_result))::uuid,
  '82000000-0000-4000-8000-000000000001',
  '52222222-2222-4222-8222-222222222222'
) result;
reset role;
select need_ingress_test.expect_scalar(
  'workspace-cannot-create-a-hundred-and-first-nonexpired-active-credential',
  $$select concat_ws(':',
       (select result->>'status' from credential_active_limit_result),
       (select count(*) from public.need_ingress_credentials
         where workspace_id = '52222222-2222-4222-8222-222222222222'
           and status = 'active'
           and revoked_at is null
           and expires_at > clock_timestamp())::text,
       (select count(*) from public.need_ingress_credential_receipts
         where request_id = '82000000-0000-4000-8000-000000000002')::text)$$,
  'active_limit_reached:100:0'
);
select need_ingress_test.expect_scalar(
  'other-tenant-admin-cannot-revoke-credential',
  $$select result->>'status' from cross_tenant_revoke_result$$,
  'not_found'
);
select need_ingress_test.expect_scalar(
  'credential-remains-bound-to-original-tenant',
  $$select concat_ws(':', workspace_id::text, status)
      from public.need_ingress_credentials
     where id = ((select result->>'credential_id' from credential_create_result))::uuid$$,
  '51111111-1111-4111-8111-111111111111:active'
);

set role authenticated;
select need_ingress_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table revocable_credential_result as
select public.create_need_ingress_credential(
  'Revocation test',
  repeat('b', 64),
  now() + interval '30 days',
  '81000000-0000-4000-8000-000000000002',
  '51111111-1111-4111-8111-111111111111'
) result;
create temporary table revoke_result as
select public.revoke_need_ingress_credential(
  ((select result->>'credential_id' from revocable_credential_result))::uuid,
  '81000000-0000-4000-8000-000000000003',
  '51111111-1111-4111-8111-111111111111'
) result;
create temporary table revoke_replay_result as
select public.revoke_need_ingress_credential(
  ((select result->>'credential_id' from revocable_credential_result))::uuid,
  '81000000-0000-4000-8000-000000000003',
  '51111111-1111-4111-8111-111111111111'
) result;
reset role;
grant select on revocable_credential_result to service_role;

select need_ingress_test.expect_scalar(
  'credential-revocation-is-durable-and-idempotent',
  $$select concat_ws(':', revoked.result->>'status', revoked.result->>'replay',
       replay.result->>'status', replay.result->>'replay')
      from revoke_result revoked, revoke_replay_result replay$$,
  'revoked:false:revoked:true'
);
select need_ingress_test.expect_scalar(
  'credential-revocation-appends-one-receipt',
  $$select concat_ws(':', status, count(receipt.id)::text)
      from public.need_ingress_credentials credential
      join public.need_ingress_credential_receipts receipt
        on receipt.credential_id = credential.id
       and receipt.event_type = 'revoked'
     where credential.id = ((select result->>'credential_id' from revocable_credential_result))::uuid
     group by credential.status$$,
  'revoked:1'
);

do $expired_fixture$
begin
  perform set_config('aria.need_ingress_credential_mutation_authorized', '0056', true);
  insert into public.need_ingress_credentials (
    id, workspace_id, key_sha256, label, status, expires_at, created_by, created_at
  ) values (
    '81111111-1111-4111-8111-111111111113',
    '51111111-1111-4111-8111-111111111111',
    repeat('c', 64),
    'Expired fixture',
    'active',
    now() - interval '1 day',
    'c1000000-0000-4000-8000-000000000001',
    now() - interval '31 days'
  );
end;
$expired_fixture$;

set role service_role;
select need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table active_resolution_result as
select public.resolve_need_ingress_credential(repeat('a', 64)) result;
create temporary table revoked_resolution_result as
select public.resolve_need_ingress_credential(repeat('b', 64)) result;
create temporary table expired_resolution_result as
select public.resolve_need_ingress_credential(repeat('c', 64)) result;
create temporary table unknown_resolution_result as
select public.resolve_need_ingress_credential(repeat('d', 64)) result;
create temporary table revoked_ingress_result as
select public.ingest_requisition_with_credential(
  ((select result->>'credential_id' from revocable_credential_result))::uuid,
  repeat('b', 64),
  'need:revoked:00000001',
  'A revoked key must never create this requisition or its parse job.',
  'text/plain'
) result;
create temporary table expired_ingress_result as
select public.ingest_requisition_with_credential(
  '81111111-1111-4111-8111-111111111113',
  repeat('c', 64),
  'need:expired:00000001',
  'An expired key must never create this requisition or its parse job.',
  'text/plain'
) result;
create temporary table unknown_ingress_result as
select public.ingest_requisition_with_credential(
  '81111111-1111-4111-8111-111111111114',
  repeat('d', 64),
  'need:unknown:00000001',
  'An unknown key must never create this requisition or its parse job.',
  'text/plain'
) result;
reset role;

select need_ingress_test.expect_scalar(
  'resolver-returns-only-active-credential-and-tenant',
  $$select concat_ws(':', result->>'status', result->>'workspace_id',
       (result ? 'credential_id')::text, (result ? 'key_sha256')::text)
      from active_resolution_result$$,
  'active:51111111-1111-4111-8111-111111111111:true:false'
);
select need_ingress_test.expect_scalar(
  'revoked-expired-unknown-resolve-identically',
  $$select concat_ws(':', revoked.result->>'status', expired.result->>'status', unknown.result->>'status')
      from revoked_resolution_result revoked,
           expired_resolution_result expired,
           unknown_resolution_result unknown$$,
  'not_found:not_found:not_found'
);
select need_ingress_test.expect_scalar(
  'revoked-expired-unknown-atomic-ingress-fails-closed',
  $$select concat_ws(':', revoked.result->>'status', expired.result->>'status', unknown.result->>'status')
      from revoked_ingress_result revoked,
           expired_ingress_result expired,
           unknown_ingress_result unknown$$,
  'credential_inactive:credential_inactive:credential_inactive'
);
select need_ingress_test.expect_scalar(
  'inactive-credentials-produce-zero-ingress',
  $$select concat_ws(':',
       (select count(*) from public.requisitions)::text,
       (select count(*) from public.requisition_inputs)::text,
       (select count(*) from public.aria_jobs)::text,
       (select count(*) from public.requisitions
         where workspace_id = '52222222-2222-4222-8222-222222222222')::text)$$,
  '1:1:1:0'
);

select need_ingress_test.expect_sqlstate(
  'retired-raw-input-helper-is-not-service-callable',
  $statement$do $body$
    begin
      set local role service_role;
      perform need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
      perform public.get_requisition_input(
        '51111111-1111-4111-8111-111111111111',
        ((select result->>'requisition_id' from fresh_result))::uuid
      );
    end;
  $body$;$statement$,
  array['42501']
);

select need_ingress_test.expect_sqlstate(
  'authenticated-cannot-invoke-ingress',
  $statement$do $body$
    begin
      set local role authenticated;
      perform public.ingest_requisition_and_enqueue(
        '51111111-1111-4111-8111-111111111111', 'need:denied:00000001',
        'A sufficiently long need that must not be stored by a user.', 'text/plain'
      );
    end;
  $body$;$statement$,
  array['42501']
);
select need_ingress_test.expect_sqlstate(
  'service-role-cannot-bypass-credential-authority',
  $statement$do $body$
    begin
      set local role service_role;
      perform need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
      perform public.ingest_requisition_and_enqueue(
        '52222222-2222-4222-8222-222222222222', 'need:bypass:00000001',
        'A direct service call must not choose another tenant workspace.', 'text/plain'
      );
    end;
  $body$;$statement$,
  array['42501']
);
select need_ingress_test.expect_sqlstate(
  'service-role-has-no-direct-table-read',
  $statement$do $body$
    begin
      set local role service_role;
      perform count(*) from public.requisition_inputs;
    end;
  $body$;$statement$,
  array['42501']
);
select need_ingress_test.expect_sqlstate(
  'service-role-has-no-direct-credential-table-read',
  $statement$do $body$
    begin
      set local role service_role;
      perform count(*) from public.need_ingress_credentials;
    end;
  $body$;$statement$,
  array['42501']
);
select need_ingress_test.expect_sqlstate(
  'credential-receipts-are-immutable',
  $statement$update public.need_ingress_credential_receipts
                set label = 'mutated evidence'
              where event_type = 'created'$statement$,
  array['42501']
);

create function need_ingress_test.reject_parse_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.kind = 'requisition_parse' then
    raise exception 'injected queue failure' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reject_parse_insert
  before insert on public.aria_jobs
  for each row execute function need_ingress_test.reject_parse_insert();

select need_ingress_test.expect_sqlstate(
  'queue-failure-propagates',
  $statement$do $body$
    begin
      set local role service_role;
      perform need_ingress_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
      perform public.ingest_requisition_with_credential(
        ((select result->>'credential_id' from credential_create_result))::uuid,
        repeat('a', 64),
        'need:workday:atomic-failure:0001',
        'We need a Senior Platform Engineer with Go and Kubernetes.',
        'text/plain'
      );
    end;
  $body$;$statement$,
  array['P0001']
);
drop trigger reject_parse_insert on public.aria_jobs;
select need_ingress_test.expect_scalar(
  'queue-failure-rolls-back-requisition-and-input',
  $$select concat_ws(':',
       (select count(*) from public.requisitions where source_ref =
          'credential:' || ((select result->>'credential_id' from credential_create_result)) || ':' ||
          encode(sha256(convert_to('need:workday:atomic-failure:0001', 'UTF8')), 'hex'))::text,
       (select count(*) from public.requisition_inputs where requisition_id in (
          select id from public.requisitions where source_ref =
            'credential:' || ((select result->>'credential_id' from credential_create_result)) || ':' ||
            encode(sha256(convert_to('need:workday:atomic-failure:0001', 'UTF8')), 'hex')))::text)$$,
  '0:0'
);

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed from need_ingress_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from need_ingress_test.results where not passed;
    raise exception 'need ingress DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from need_ingress_test.results")"
echo "need-ingress-db: ingress controls, idempotency, atomic enqueue, fenced content release, rollback, ACL: ${assertions} assertions, 0 failed"
