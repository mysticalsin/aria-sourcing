#!/usr/bin/env bash
# Disposable-Postgres proof for 0057 raw requisition retention authority.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-requisition-retention-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
race_log_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$race_log_dir"
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

# Prove the guarded rollback is executable before any irreversible scrub, then
# reapply 0057 for the behavioral suite.
psql_stdin -q < supabase/rollbacks/0057_requisition_input_retention.sql
psql_stdin -q < supabase/migrations/0057_requisition_input_retention.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema retention_test;
create table retention_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table retention_test.context (
  key text primary key,
  value jsonb not null
);

create function retention_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, retention_test
as $$
begin
  insert into retention_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function retention_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, retention_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform retention_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform retention_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function retention_test.set_claims(subject uuid, claim_role text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', claim_role)::text,
    false
  );
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', claim_role, false);
end;
$$;

grant usage on schema retention_test to authenticated, service_role;
grant execute on all functions in schema retention_test to authenticated, service_role;
grant select, insert, update on all tables in schema retention_test
  to authenticated, service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'revoked-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-a2@example.test', '', now(), '{}', '{}', now(), now()),
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin-b@example.test', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111', 'Retention A', 'a.example.test'),
  ('52222222-2222-4222-8222-222222222222', 'Retention B', 'b.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001', 'admin-a@example.test', 'Admin A',
   '51111111-1111-4111-8111-111111111111', 'admin'),
  ('a1000000-0000-4000-8000-000000000002', 'member-a@example.test', 'Member A',
   '51111111-1111-4111-8111-111111111111', 'member'),
  ('a1000000-0000-4000-8000-000000000003', 'revoked-a@example.test', 'Revoked A',
   '51111111-1111-4111-8111-111111111111', 'admin'),
  ('a1000000-0000-4000-8000-000000000004', 'admin-a2@example.test', 'Admin A2',
   '51111111-1111-4111-8111-111111111111', 'admin'),
  ('b1000000-0000-4000-8000-000000000001', 'admin-b@example.test', 'Admin B',
   '52222222-2222-4222-8222-222222222222', 'admin');

select retention_test.expect(
  'default-retention-is-30-days',
  (select raw_requisition_retention_days = 30
     from public.sourcing_loop_controls
    where workspace_id = '51111111-1111-4111-8111-111111111111')
);

set role authenticated;
select retention_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');
insert into retention_test.context(key, value)
select 'configured', public.configure_requisition_input_retention(
  '51111111-1111-4111-8111-111111111111', 7
);
insert into retention_test.context(key, value)
select 'invalid-low', public.configure_requisition_input_retention(
  '51111111-1111-4111-8111-111111111111', 6
);
insert into retention_test.context(key, value)
select 'invalid-high', public.configure_requisition_input_retention(
  '51111111-1111-4111-8111-111111111111', 366
);
reset role;

select retention_test.expect(
  'admin-configures-bounded-retention',
  (select value = jsonb_build_object(
    'status', 'configured',
    'workspace_id', '51111111-1111-4111-8111-111111111111'::uuid,
    'retention_days', 7
  ) from retention_test.context where key = 'configured')
);
select retention_test.expect(
  'out-of-range-retention-rejected',
  (select value->>'status' = 'invalid_request' from retention_test.context where key = 'invalid-low')
  and (select value->>'status' = 'invalid_request' from retention_test.context where key = 'invalid-high')
);
select retention_test.expect(
  'configuration-event-is-content-free',
  exists (
    select 1 from public.loop_events event
     where event.workspace_id = '51111111-1111-4111-8111-111111111111'
       and event.event_type = 'requisition.input_retention_configured'
       and event.payload = jsonb_build_object(
         'actor_id', 'a1000000-0000-4000-8000-000000000001',
         'retention_days', 7
       )
  )
);

select retention_test.expect_sqlstate(
  'cross-tenant-admin-denied',
  $statement$do $body$
    begin
      set local role authenticated;
      perform retention_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');
      perform public.configure_requisition_input_retention(
        '52222222-2222-4222-8222-222222222222', 30
      );
    end;
  $body$;$statement$,
  array['42501']
);
select retention_test.expect_sqlstate(
  'same-tenant-member-denied',
  $statement$do $body$
    begin
      set local role authenticated;
      perform retention_test.set_claims('a1000000-0000-4000-8000-000000000002', 'authenticated');
      perform public.configure_requisition_input_retention(
        '51111111-1111-4111-8111-111111111111', 30
      );
    end;
  $body$;$statement$,
  array['42501']
);

update public.profiles set role = 'member'
 where id = 'a1000000-0000-4000-8000-000000000003';
select retention_test.expect_sqlstate(
  'revoked-admin-denied-from-current-profile-state',
  $statement$do $body$
    begin
      set local role authenticated;
      perform retention_test.set_claims('a1000000-0000-4000-8000-000000000003', 'authenticated');
      perform public.configure_requisition_input_retention(
        '51111111-1111-4111-8111-111111111111', 30
      );
    end;
  $body$;$statement$,
  array['42501']
);

select retention_test.expect_sqlstate(
  'authenticated-cannot-update-control-directly',
  $statement$do $body$
    begin
      set local role authenticated;
      update public.sourcing_loop_controls
         set raw_requisition_retention_days = 365
       where workspace_id = '51111111-1111-4111-8111-111111111111';
    end;
  $body$;$statement$,
  array['42501']
);

update public.sourcing_loop_controls
   set kill_switch = false,
       intake_enabled = true,
       updated_by = 'a1000000-0000-4000-8000-000000000001'
 where workspace_id = '51111111-1111-4111-8111-111111111111';

-- Retention is a separate control plane. Editing it must not transfer the
-- automation activation authority recorded by set_sourcing_loop_controls.
set role authenticated;
select retention_test.set_claims('a1000000-0000-4000-8000-000000000004', 'authenticated');
insert into retention_test.context(key, value)
select 'configured-by-second-admin', public.configure_requisition_input_retention(
  '51111111-1111-4111-8111-111111111111', 7
);
reset role;
select retention_test.expect(
  'retention-editor-does-not-replace-sourcing-activation-actor',
  (select updated_by = 'a1000000-0000-4000-8000-000000000001'
     from public.sourcing_loop_controls
    where workspace_id = '51111111-1111-4111-8111-111111111111')
  and (select value->>'status' = 'configured'
         from retention_test.context where key = 'configured-by-second-admin')
);

set role authenticated;
select retention_test.set_claims('a1000000-0000-4000-8000-000000000001', 'authenticated');
insert into retention_test.context(key, value)
select 'credential', public.create_need_ingress_credential(
  'Retention test ingress',
  repeat('a', 64),
  clock_timestamp() + interval '30 days',
  '81000000-0000-4000-8000-000000000057',
  '51111111-1111-4111-8111-111111111111'
);
reset role;

create function retention_test.seed_input(
  p_workspace_id uuid,
  p_requisition_id uuid,
  p_job_id uuid,
  p_external_source_ref text,
  p_content text,
  p_received_at timestamptz,
  p_parse_completed_at timestamptz default null
) returns void
language plpgsql
set search_path = pg_catalog, public, retention_test
as $$
declare
  credential_id uuid := (
    select (value->>'credential_id')::uuid
      from retention_test.context where key = 'credential'
  );
  derived_source_ref text;
  input_hash text;
  job_payload jsonb;
begin
  derived_source_ref := 'credential:' || credential_id::text || ':' || encode(
    sha256(convert_to(p_external_source_ref, 'UTF8')), 'hex'
  );
  input_hash := encode(sha256(convert_to('text/plain' || E'\n' || p_content, 'UTF8')), 'hex');
  job_payload := jsonb_build_object('requisition_id', p_requisition_id::text);

  insert into public.requisitions(
    id, workspace_id, source_kind, source_ref, status, created_at, updated_at
  ) values (
    p_requisition_id, p_workspace_id, 'api', derived_source_ref, 'ready',
    p_received_at, p_received_at
  );
  insert into public.requisition_inputs(
    requisition_id, workspace_id, content, content_type, need_sha256, received_at
  ) values (
    p_requisition_id, p_workspace_id, p_content, 'text/plain', input_hash, p_received_at
  );
  insert into public.aria_jobs(
    id, workspace_id, kind, idempotency_key, payload, payload_sha256,
    status, result_sha256, created_at, updated_at
  ) values (
    p_job_id, p_workspace_id, 'requisition_parse',
    'requisition_parse:' || p_requisition_id::text,
    job_payload,
    encode(sha256(convert_to(job_payload::text, 'UTF8')), 'hex'),
    'succeeded', repeat('e', 64), p_received_at, p_received_at
  );
  if p_parse_completed_at is not null then
    insert into public.requisition_parse_receipts(
      job_id, lease_id, workspace_id, requisition_id, input_sha256,
      result_sha256, provider, model, ready, completed_at
    ) values (
      p_job_id, gen_random_uuid(), p_workspace_id, p_requisition_id,
      input_hash, repeat('e', 64), 'openai', 'gpt-test', true,
      p_parse_completed_at
    );
  end if;
end;
$$;

select retention_test.seed_input(
  '51111111-1111-4111-8111-111111111111',
  '61000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'need:retention:locked:0001',
  'Senior data engineer with Python, SQL, Airflow, and Canadian remote availability.',
  clock_timestamp() - interval '10 days',
  clock_timestamp() - interval '8 days'
);
select retention_test.seed_input(
  '51111111-1111-4111-8111-111111111111',
  '61000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000002',
  'need:retention:eligible:0002',
  'Senior platform engineer with Go, Kubernetes, PostgreSQL, and incident response.',
  clock_timestamp() - interval '10 days',
  clock_timestamp() - interval '8 days'
);
select retention_test.seed_input(
  '51111111-1111-4111-8111-111111111111',
  '61000000-0000-4000-8000-000000000003',
  '71000000-0000-4000-8000-000000000003',
  'need:retention:fresh:0003',
  'Staff security engineer with cloud identity, detection engineering, and Python.',
  clock_timestamp() - interval '4 days',
  clock_timestamp() - interval '2 days'
);
select retention_test.seed_input(
  '51111111-1111-4111-8111-111111111111',
  '61000000-0000-4000-8000-000000000004',
  '71000000-0000-4000-8000-000000000004',
  'need:retention:unparsed:0004',
  'Principal product engineer with TypeScript, React, Node, and distributed systems.',
  clock_timestamp() - interval '20 days',
  null
);
select retention_test.seed_input(
  '52222222-2222-4222-8222-222222222222',
  '62000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'need:retention:other:0001',
  'Senior machine learning engineer with Python, PyTorch, and production inference.',
  clock_timestamp() - interval '40 days',
  clock_timestamp() - interval '35 days'
);

select retention_test.expect(
  'cleanup-receipt-schema-has-no-raw-content-column',
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'requisition_input_cleanup_receipts'
       and column_name in ('content', 'raw_content', 'need_content')
  )
);
SQL

# Hold one eligible input row in an open transaction. The cleanup RPC must
# return promptly and process the other row through FOR UPDATE SKIP LOCKED.
psql_stdin -q >"$race_log_dir/holder.log" 2>&1 <<'SQL' &
\set ON_ERROR_STOP on
set application_name = 'retention-lock-holder';
begin;
select 1 from public.requisition_inputs
 where requisition_id = '61000000-0000-4000-8000-000000000001'
 for update;
select pg_sleep(6);
commit;
SQL
holder_pid=$!

holder_ready=0
for _ in $(seq 1 80); do
  active="$(psql_stdin -Atc "select count(*) from pg_stat_activity where application_name = 'retention-lock-holder' and wait_event = 'PgSleep'")"
  if [ "$active" = "1" ]; then
    holder_ready=1
    break
  fi
  sleep 0.1
done
if [ "$holder_ready" != "1" ]; then
  echo "requisition-input-retention-db: lock holder did not become ready" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
set role service_role;
select retention_test.set_claims('a1000000-0000-4000-8000-000000000001', 'service_role');
insert into retention_test.context(key, value)
select 'first-cleanup', public.cleanup_requisition_input_authority(
  '51111111-1111-4111-8111-111111111111', 1
);
reset role;

select retention_test.expect(
  'cleanup-is-bounded-and-skips-locked-input',
  (select value = jsonb_build_object(
    'status', 'cleaned',
    'processed', 1,
    'raw_inputs_scrubbed', 1,
    'receipts_written', 1
  ) from retention_test.context where key = 'first-cleanup')
  and (select content is not null from public.requisition_inputs
        where requisition_id = '61000000-0000-4000-8000-000000000001')
  and (select content is null from public.requisition_inputs
        where requisition_id = '61000000-0000-4000-8000-000000000002')
);
select retention_test.expect(
  'fresh-unparsed-and-other-tenant-content-remain',
  (select count(*) = 3 from public.requisition_inputs
    where requisition_id in (
      '61000000-0000-4000-8000-000000000003',
      '61000000-0000-4000-8000-000000000004',
      '62000000-0000-4000-8000-000000000001'
    ) and content is not null)
);
SQL

wait "$holder_pid"

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
set role service_role;
select retention_test.set_claims('a1000000-0000-4000-8000-000000000001', 'service_role');
insert into retention_test.context(key, value)
select 'second-cleanup', public.cleanup_requisition_input_authority(
  '51111111-1111-4111-8111-111111111111', 1
);
insert into retention_test.context(key, value)
select 'same-replay', public.ingest_requisition_with_credential(
  ((select value->>'credential_id' from retention_test.context where key = 'credential'))::uuid,
  repeat('a', 64),
  'need:retention:locked:0001',
  'Senior data engineer with Python, SQL, Airflow, and Canadian remote availability.',
  'text/plain'
);
insert into retention_test.context(key, value)
select 'changed-replay', public.ingest_requisition_with_credential(
  ((select value->>'credential_id' from retention_test.context where key = 'credential'))::uuid,
  repeat('a', 64),
  'need:retention:locked:0001',
  'Changed requirement for a finance director with SAP and treasury expertise.',
  'text/plain'
);
reset role;

select retention_test.expect(
  'second-cleanup-scrubs-previously-locked-input',
  (select value->>'status' = 'cleaned'
      and (value->>'processed')::integer = 1
      and (value->>'raw_inputs_scrubbed')::integer = 1
      and (value->>'receipts_written')::integer = 1
     from retention_test.context where key = 'second-cleanup')
  and (select content is null and content_scrubbed_at is not null
       from public.requisition_inputs
       where requisition_id = '61000000-0000-4000-8000-000000000001')
);
select retention_test.expect(
  'hash-and-content-type-survive-scrub',
  (select content is null
      and content_type = 'text/plain'
      and need_sha256 = encode(sha256(convert_to(
        'text/plain' || E'\n' ||
        'Senior data engineer with Python, SQL, Airflow, and Canadian remote availability.',
        'UTF8'
      )), 'hex')
     from public.requisition_inputs
     where requisition_id = '61000000-0000-4000-8000-000000000001')
);
select retention_test.expect(
  'cleanup-receipt-is-exact-and-content-free',
  (select count(*) = 2 from public.requisition_input_cleanup_receipts
    where workspace_id = '51111111-1111-4111-8111-111111111111')
  and not exists (
    select 1 from public.requisition_input_cleanup_receipts receipt
     where receipt.input_sha256 !~ '^[0-9a-f]{64}$'
        or receipt.receipt_sha256 !~ '^[0-9a-f]{64}$'
        or receipt.retention_days <> 7
  )
);
select retention_test.expect(
  'same-content-replays-after-scrub-by-hash',
  (select concat_ws(':', value->>'status', value->>'replay', value->>'requisition_id')
     from retention_test.context where key = 'same-replay')
    = 'accepted:true:61000000-0000-4000-8000-000000000001'
);
select retention_test.expect(
  'changed-content-conflicts-after-scrub',
  (select value->>'status' = 'idempotency_conflict'
     from retention_test.context where key = 'changed-replay')
);

select retention_test.expect_sqlstate(
  'cleanup-receipts-are-append-only',
  $$update public.requisition_input_cleanup_receipts
       set retention_days = 30
     where requisition_id = '61000000-0000-4000-8000-000000000001'$$,
  array['42501']
);
select retention_test.expect_sqlstate(
  'scrubbed-content-cannot-be-restored-directly',
  $$update public.requisition_inputs
       set content = 'Attempted raw content restoration that must remain impossible.'
     where requisition_id = '61000000-0000-4000-8000-000000000001'$$,
  array['42501']
);
select retention_test.expect_sqlstate(
  'service-role-cannot-read-cleanup-receipts-directly',
  $statement$do $body$
    begin
      set local role service_role;
      perform count(*) from public.requisition_input_cleanup_receipts;
    end;
  $body$;$statement$,
  array['42501']
);
select retention_test.expect(
  'rpc-acl-is-purpose-bound',
  has_function_privilege(
    'authenticated',
    'public.configure_requisition_input_retention(uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.configure_requisition_input_retention(uuid,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.cleanup_requisition_input_authority(uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.cleanup_requisition_input_authority(uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.ingest_requisition_and_enqueue(uuid,text,text,text)',
    'EXECUTE'
  )
);
select retention_test.expect(
  'receipt-table-forces-rls',
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.requisition_input_cleanup_receipts'::regclass)
);

do $$
declare failed integer;
begin
  select count(*) into failed from retention_test.results where not passed;
  if failed > 0 then
    raise exception 'requisition-input-retention-db failed: %', (
      select jsonb_agg(jsonb_build_object('case', case_name, 'detail', detail))
        from retention_test.results where not passed
    );
  end if;
end;
$$;

select count(*) as assertions from retention_test.results;
SQL

# Once cleanup evidence exists, rollback must fail closed.
set +e
rollback_output="$(psql_stdin -q < supabase/rollbacks/0057_requisition_input_retention.sql 2>&1)"
rollback_status=$?
set -e
if [ "$rollback_status" -eq 0 ] ||
   [[ "$rollback_output" != *"refusing 0057 rollback because raw requisition cleanup evidence exists"* ]]; then
  echo "requisition-input-retention-db: rollback guard failed" >&2
  exit 1
fi

echo "requisition-input-retention-db: retention, admin authority, replay, receipts, SKIP LOCKED, ACL: PASS"
