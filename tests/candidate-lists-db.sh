#!/usr/bin/env bash
set -Eeuo pipefail

# Phase 1 RED-first vertical slice for normalized candidate lists.
#
# Until supabase/migrations/0064_*.sql exists, this test intentionally fails
# with a message naming the missing public.candidate_lists table -- that is
# the required first failure for this slice (not a Docker, fixture, or path
# failure). Once 0064 lands, this test proves: normalized tenant-bound
# candidate_lists / candidate_list_members / append-only operation receipt and
# provenance-attestation tables;
# private ACLs and forced RLS; a viewer read path that performs no mutation;
# a member-create RPC that derives actor and workspace from the authenticated
# session rather than caller-supplied parameters; exact idempotency replay
# and conflict; provenance-bound add failure cases (missing, ambiguous, and
# foreign-tenant evidence); concurrent-add uniqueness; stable pagination under
# tied added_at timestamps; forward/reapply; empty rollback/reapply; and
# refusal of a non-empty rollback. Set operations, full eligibility, shared
# quota, CSV export, API, UI, and bulk performance are out of scope here.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidate-lists-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
tmp_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
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

# ---------------------------------------------------------------------------
# Apply every existing migration. The glob never matches a 0064 file until one
# is added, so today this applies the complete 0001-0063 history and then
# must observe public.candidate_lists missing -- the required RED signal.
# ---------------------------------------------------------------------------
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if [[ "$base" == 0064_* ]]; then
    break
  fi
  psql_stdin -q < "$migration"
done

migration="$(ls supabase/migrations/0064_*.sql 2>/dev/null | head -n1 || true)"
rollback="$(ls supabase/rollbacks/0064_*.sql 2>/dev/null | head -n1 || true)"

if [[ -z "$migration" ]]; then
  missing_table="$(psql_stdin -Atq -c "select (to_regclass('public.candidate_lists') is null)::text")"
  if [[ "$missing_table" != "true" ]]; then
    echo "candidate-lists-db: public.candidate_lists already exists but no supabase/migrations/0064_*.sql file was found -- add the migration file" >&2
    exit 1
  fi
  echo "candidate-lists-db RED: supabase/migrations/0064_*.sql is absent and public.candidate_lists does not exist. This is the expected first failure for the Phase 1 candidate lists vertical slice." >&2
  exit 1
fi
if [[ -z "$rollback" ]]; then
  echo "candidate-lists-db: found $migration but no matching supabase/rollbacks/0064_*.sql" >&2
  exit 1
fi

# Forward apply must succeed while the schema is empty.
psql_stdin --single-transaction -q < "$migration"

# Empty rollback must succeed and remove the new authority cleanly.
psql_stdin -q < "$rollback"
empty_rollback_gone="$(psql_stdin -Atq -c "select (to_regclass('public.candidate_lists') is null)::text")"
if [[ "$empty_rollback_gone" != "true" ]]; then
  echo "candidate-lists-db: empty rollback did not remove public.candidate_lists" >&2
  exit 1
fi

# Forward reapply after an empty rollback, then a second reapply while already
# applied, must both be safe (deploy reconciliation can retry either state).
psql_stdin --single-transaction -q < "$migration"
psql_stdin --single-transaction -q < "$migration"
reapplied_present="$(psql_stdin -Atq -c "select (to_regclass('public.candidate_lists') is null)::text")"
if [[ "$reapplied_present" != "false" ]]; then
  echo "candidate-lists-db: forward reapply did not preserve public.candidate_lists" >&2
  exit 1
fi

psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema candidate_lists_test;

create table candidate_lists_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create table candidate_lists_test.outputs (
  case_name text primary key,
  output jsonb not null
);

create function candidate_lists_test.expect(
  p_case_name text, p_passed boolean, p_detail text default null
) returns void language plpgsql set search_path = pg_catalog, candidate_lists_test as $$
begin
  insert into candidate_lists_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function candidate_lists_test.expect_scalar(
  p_case_name text, p_statement text, p_expected text
) returns void language plpgsql set search_path = pg_catalog, public, candidate_lists_test as $$
declare actual text;
begin
  execute p_statement into actual;
  perform candidate_lists_test.expect(
    p_case_name, actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function candidate_lists_test.expect_sqlstate(
  p_case_name text, p_statement text, p_expected_codes text[]
) returns void language plpgsql set search_path = pg_catalog, public, candidate_lists_test as $$
declare caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform candidate_lists_test.expect(
      p_case_name, caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform candidate_lists_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function candidate_lists_test.expect_authenticated_sqlstate(
  p_case_name text, p_statement text, p_expected_codes text[]
) returns void language plpgsql set search_path = pg_catalog, public, candidate_lists_test as $$
declare caught text;
begin
  begin
    execute 'set local role authenticated';
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    execute 'reset role';
    perform candidate_lists_test.expect(
      p_case_name, caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  execute 'reset role';
  perform candidate_lists_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function candidate_lists_test.set_service_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function candidate_lists_test.set_authenticated_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;

grant usage on schema candidate_lists_test to anon, authenticated, service_role;
grant select, insert on candidate_lists_test.results to anon, authenticated, service_role;
grant select, insert on candidate_lists_test.outputs to authenticated, service_role;
grant execute on all functions in schema candidate_lists_test to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixture: two tenants, an admin and a second member in tenant A, an admin in
-- tenant B, candidates in both tenants (one with mismatched provenance, one
-- with no matching candidate row at all).
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lists-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('c2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lists-member-a@example.test','',now(),'{}','{}',now(),now()),
  ('c3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lists-admin-b@example.test','',now(),'{}','{}',now(),now())
on conflict (id) do nothing;

insert into public.workspaces(id, name, allowed_domain) values
  ('91111111-1111-4111-8111-111111111111','Lists Tenant A','lists-a.example.test'),
  ('92222222-2222-4222-8222-222222222222','Lists Tenant B','lists-b.example.test')
on conflict (id) do nothing;

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001','lists-admin-a@example.test','Lists Member A','91111111-1111-4111-8111-111111111111','member'),
  ('c2000000-0000-4000-8000-000000000002','lists-member-a@example.test','Lists Viewer A','91111111-1111-4111-8111-111111111111','viewer'),
  ('c3000000-0000-4000-8000-000000000003','lists-admin-b@example.test','Lists Admin B','92222222-2222-4222-8222-222222222222','admin')
on conflict (workspace_id, id) do nothing;

insert into public.candidates(
  workspace_id, campaign_id, id, email, name, provenance, payload
) values
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-provider','provider-ok@example.test','Provider OK','provider','{}'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-manual','manual-ok@example.test','Manual OK','manual','{}'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-ambiguous','ambiguous@example.test','Ambiguous','live','{}'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-tie-1','tie-1@example.test','Tie One','manual','{}'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-tie-2','tie-2@example.test','Tie Two','manual','{}'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-tie-3','tie-3@example.test','Tie Three','manual','{}'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-concurrent','concurrent@example.test','Concurrent','manual','{}'),
  ('92222222-2222-4222-8222-222222222222','lists-campaign','cand-foreign','foreign@example.test','Foreign Only','manual','{}');

insert into public.candidate_contact_attestations(
  workspace_id, campaign_id, candidate_id, attestation_kind, value_code,
  evidence_sha256, recorded_by, recorded_at
) values
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-manual','manual_provenance','operator_verified',repeat('1',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:00+00'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-ambiguous','manual_provenance','operator_verified',repeat('2',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:00+00'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-ambiguous','manual_provenance','operator_verified',repeat('3',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:01+00'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-concurrent','manual_provenance','operator_verified',repeat('4',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:00+00'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-tie-1','manual_provenance','operator_verified',repeat('5',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:00+00'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-tie-2','manual_provenance','operator_verified',repeat('6',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:00+00'),
  ('91111111-1111-4111-8111-111111111111','lists-campaign','cand-tie-3','manual_provenance','operator_verified',repeat('7',64),'c1000000-0000-4000-8000-000000000001','2026-07-20 09:00:00+00'),
  ('92222222-2222-4222-8222-222222222222','lists-campaign','cand-foreign','manual_provenance','operator_verified',repeat('8',64),'c3000000-0000-4000-8000-000000000003','2026-07-20 09:00:00+00');

select candidate_lists_test.expect(
  'given_phase_one_schema_when_inspected_then_all_four_normalized_authority_tables_exist',
  to_regclass('public.candidate_lists') is not null
  and to_regclass('public.candidate_list_members') is not null
  and to_regclass('public.candidate_list_operation_receipts') is not null
  and to_regclass('public.candidate_contact_attestations') is not null
);

select candidate_lists_test.expect(
  'given_phase_one_authority_tables_when_inspected_then_rls_is_enabled_and_forced_on_every_table',
  not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'candidate_lists','candidate_list_members',
         'candidate_list_operation_receipts','candidate_contact_attestations'
       )
       and (not c.relrowsecurity or not c.relforcerowsecurity)
  )
);

select candidate_lists_test.expect(
  'given_runtime_database_roles_when_table_privileges_are_checked_then_no_direct_phase_one_table_access_exists',
  not exists (
    select 1
      from (values ('anon'),('authenticated'),('service_role'),('authenticator')) runtime(role_name)
      cross join (values
        ('candidate_lists'),('candidate_list_members'),
        ('candidate_list_operation_receipts'),('candidate_contact_attestations')
      ) authority(table_name)
     where has_table_privilege(runtime.role_name, 'public.' || authority.table_name, 'SELECT')
        or has_table_privilege(runtime.role_name, 'public.' || authority.table_name, 'INSERT')
        or has_table_privilege(runtime.role_name, 'public.' || authority.table_name, 'UPDATE')
        or has_table_privilege(runtime.role_name, 'public.' || authority.table_name, 'DELETE')
  )
);

select candidate_lists_test.expect(
  'given_tenant_bearing_member_and_evidence_tables_when_foreign_keys_are_inspected_then_workspace_is_part_of_each_candidate_or_list_reference',
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.candidate_list_members'::regclass
       and contype = 'f'
       and confrelid = 'public.candidate_lists'::regclass
       and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, list_id)%'
  )
  and exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.candidate_list_members'::regclass
       and contype = 'f'
       and confrelid = 'public.candidates'::regclass
       and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, campaign_id, candidate_id)%'
  )
  and exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.candidate_contact_attestations'::regclass
       and contype = 'f'
       and confrelid = 'public.candidates'::regclass
       and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, campaign_id, candidate_id)%'
  )
  and exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.candidate_list_operation_receipts'::regclass
       and contype = 'f'
       and confrelid = 'public.candidate_lists'::regclass
       and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, list_id)%'
  )
  and exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.candidate_list_members'::regclass
       and contype in ('p','u')
       and pg_get_constraintdef(oid)
         like '%(workspace_id, list_id, campaign_id, candidate_id)%'
  )
);

-- ---------------------------------------------------------------------------
-- Contract check: the RPCs derive actor/workspace from the authenticated
-- session. No overload accepts a caller-supplied workspace or actor id.
-- ---------------------------------------------------------------------------
select candidate_lists_test.expect(
  'given_rpc_signatures_when_inspected_then_no_caller_supplied_actor_or_workspace_overload_exists',
  to_regprocedure('public.create_candidate_list(text,uuid)') is not null
  and to_regprocedure('public.create_candidate_list(uuid,text,uuid)') is null
  and to_regprocedure('public.add_candidate_list_member(uuid,text,text,uuid)') is not null
  and to_regprocedure('public.add_candidate_list_member(uuid,uuid,text,text,uuid)') is null
  and to_regprocedure('public.add_candidate_list_member(uuid,text,text,uuid,uuid)') is null
  and to_regprocedure('public.list_candidate_list_members(uuid,timestamptz,bigint,int)') is not null
);

-- ---------------------------------------------------------------------------
-- create_candidate_list: authenticated-only, workspace derived from caller.
-- ---------------------------------------------------------------------------
select candidate_lists_test.expect_sqlstate(
  'given_anonymous_caller_when_create_list_then_denied',
  $$select public.create_candidate_list('Anon list','90000000-0000-4000-8000-000000000001')$$,
  array['42501']
);

begin;
set local role service_role;
select candidate_lists_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select candidate_lists_test.expect_sqlstate(
  'given_service_role_caller_when_create_list_then_denied',
  $$select public.create_candidate_list('Service list','90000000-0000-4000-8000-000000000002')$$,
  array['42501']
);
commit;

begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
insert into candidate_lists_test.outputs(case_name, output)
select 'create-a', public.create_candidate_list(
  'Tenant A Sourcing List', '90000000-0000-4000-8000-000000000010'
);
insert into candidate_lists_test.outputs(case_name, output)
select 'create-a-replay', public.create_candidate_list(
  'Tenant A Sourcing List', '90000000-0000-4000-8000-000000000010'
);
insert into candidate_lists_test.outputs(case_name, output)
select 'create-a-conflict', public.create_candidate_list(
  'Changed list name', '90000000-0000-4000-8000-000000000010'
);
commit;

select candidate_lists_test.expect(
  'given_authenticated_member_when_create_list_then_list_is_created_and_workspace_bound',
  (select output->>'status' = 'created' from candidate_lists_test.outputs where case_name = 'create-a')
  and (select count(*) = 1 from public.candidate_lists
        where id = (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a')
          and workspace_id = '91111111-1111-4111-8111-111111111111'
          and created_by = 'c1000000-0000-4000-8000-000000000001')
);
select candidate_lists_test.expect(
  'given_same_create_request_and_idempotency_key_when_replayed_then_exact_stored_result_and_one_list_are_returned',
  (select a.output = b.output
     from candidate_lists_test.outputs a
     cross join candidate_lists_test.outputs b
    where a.case_name = 'create-a' and b.case_name = 'create-a-replay')
  and (select count(*) = 1 from public.candidate_lists
        where workspace_id = '91111111-1111-4111-8111-111111111111'
          and name = 'Tenant A Sourcing List')
  and (select count(*) = 1 from public.candidate_list_operation_receipts
        where workspace_id = '91111111-1111-4111-8111-111111111111'
          and idempotency_key = '90000000-0000-4000-8000-000000000010'
          and operation_kind = 'create_list')
);
select candidate_lists_test.expect(
  'given_same_create_idempotency_key_with_different_name_when_reused_then_typed_conflict_and_no_second_list',
  (select output = '{"status":"idempotency_conflict"}'::jsonb
     from candidate_lists_test.outputs where case_name = 'create-a-conflict')
  and (select count(*) = 1 from public.candidate_lists
        where workspace_id = '91111111-1111-4111-8111-111111111111')
);

begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c3000000-0000-4000-8000-000000000003');
insert into candidate_lists_test.outputs(case_name, output)
select 'create-b', public.create_candidate_list(
  'Tenant B Sourcing List', '90000000-0000-4000-8000-000000000020'
);
commit;

select candidate_lists_test.expect(
  'given_second_tenant_admin_when_create_list_then_bound_to_that_tenant_not_tenant_a',
  (select count(*) = 1 from public.candidate_lists
    where id = (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-b')
      and workspace_id = '92222222-2222-4222-8222-222222222222')
);

-- ---------------------------------------------------------------------------
-- Private ACLs / forced RLS: no raw insert path, tenant-scoped select only,
-- service_role has no direct read of the authority tables.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
select candidate_lists_test.expect_sqlstate(
  'given_authenticated_caller_when_inserting_a_list_directly_then_denied',
  $statement$insert into public.candidate_lists(workspace_id, name, created_by)
              values ('91111111-1111-4111-8111-111111111111','Forged list','c1000000-0000-4000-8000-000000000001')$statement$,
  array['42501']
);
commit;

begin;
set local role service_role;
select candidate_lists_test.set_service_claims(null);
select candidate_lists_test.expect_sqlstate(
  'given_service_role_when_selecting_candidate_lists_directly_then_denied',
  $$select count(*) from public.candidate_lists$$,
  array['42501']
);
select candidate_lists_test.expect_sqlstate(
  'given_service_role_when_selecting_candidate_list_members_directly_then_denied',
  $$select count(*) from public.candidate_list_members$$,
  array['42501']
);
commit;

select candidate_lists_test.expect_authenticated_sqlstate(
  'given_authenticated_caller_with_no_workspace_row_when_selecting_lists_then_denied',
  $$select count(*) from public.candidate_lists$$,
  array['42501']
);

-- ---------------------------------------------------------------------------
-- add_candidate_list_member: provenance resolves only from server-owned
-- evidence. Browser candidate payload/provenance fields are never arguments.
-- Missing and foreign resources remain non-disclosing; deterministic business
-- failures are receipted so retries return the exact same result.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');

insert into candidate_lists_test.outputs(case_name, output)
select scenario.case_name, public.add_candidate_list_member(
  scenario.list_id, scenario.campaign_id, scenario.candidate_id, scenario.key
)
from (values
  ('add-provenance-missing',
    (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
    'lists-campaign','cand-provider','a0000000-0000-4000-8000-000000000001'::uuid),
  ('add-provenance-ambiguous',
    (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
    'lists-campaign','cand-ambiguous','a0000000-0000-4000-8000-000000000002'::uuid),
  ('add-missing-candidate',
    (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
    'lists-campaign','cand-does-not-exist','a0000000-0000-4000-8000-000000000003'::uuid),
  ('add-foreign-candidate',
    (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
    'lists-campaign','cand-foreign','a0000000-0000-4000-8000-000000000004'::uuid),
  ('add-foreign-list',
    (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-b'),
    'lists-campaign','cand-manual','a0000000-0000-4000-8000-000000000005'::uuid),
  ('add-missing-list','9999999a-0000-4000-8000-000000000000'::uuid,
    'lists-campaign','cand-manual','a0000000-0000-4000-8000-000000000006'::uuid)
) scenario(case_name,list_id,campaign_id,candidate_id,key);

insert into candidate_lists_test.outputs(case_name, output)
select 'add-ok', public.add_candidate_list_member(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  'lists-campaign', 'cand-manual', 'a0000000-0000-4000-8000-000000000007'
);

insert into candidate_lists_test.outputs(case_name, output)
select 'add-replay-exact', public.add_candidate_list_member(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  'lists-campaign', 'cand-manual', 'a0000000-0000-4000-8000-000000000007'
);

insert into candidate_lists_test.outputs(case_name, output)
select 'add-replay-conflict', public.add_candidate_list_member(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  'lists-campaign', 'cand-concurrent', 'a0000000-0000-4000-8000-000000000007'
);

insert into candidate_lists_test.outputs(case_name, output)
select 'add-already-member', public.add_candidate_list_member(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  'lists-campaign', 'cand-manual', 'a0000000-0000-4000-8000-000000000008'
);
commit;

select candidate_lists_test.expect(
  'given_candidate_payload_claims_provenance_without_server_owned_evidence_when_adding_then_provenance_missing',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_lists_test.outputs where case_name = 'add-provenance-missing')
);
select candidate_lists_test.expect(
  'given_multiple_unsuperseded_server_provenance_attestations_when_adding_then_provenance_ambiguous',
  (select output = '{"status":"provenance_ambiguous"}'::jsonb
     from candidate_lists_test.outputs where case_name = 'add-provenance-ambiguous')
);
select candidate_lists_test.expect(
  'given_missing_and_foreign_tenant_candidates_when_adding_then_identical_non_disclosing_response',
  (select output = '{"status":"candidate_not_found"}'::jsonb from candidate_lists_test.outputs where case_name = 'add-missing-candidate')
  and (select output = '{"status":"candidate_not_found"}'::jsonb from candidate_lists_test.outputs where case_name = 'add-foreign-candidate')
);
select candidate_lists_test.expect(
  'given_a_list_belonging_to_another_tenant_when_adding_then_same_not_found_response_as_a_missing_list',
  (select output = '{"status":"list_not_found"}'::jsonb from candidate_lists_test.outputs where case_name = 'add-foreign-list')
  and (select output = '{"status":"list_not_found"}'::jsonb from candidate_lists_test.outputs where case_name = 'add-missing-list')
);
select candidate_lists_test.expect(
  'given_rejected_add_attempts_when_checked_then_no_member_exists_but_each_deterministic_result_has_one_replay_receipt',
  not exists (
    select 1 from public.candidate_list_members
     where candidate_id in ('cand-provider','cand-ambiguous','cand-foreign','cand-does-not-exist')
  )
  and (select count(*) = 6 from public.candidate_list_operation_receipts
        where idempotency_key between
          'a0000000-0000-4000-8000-000000000001'::uuid and
          'a0000000-0000-4000-8000-000000000006'::uuid
          and operation_kind = 'add_member')
);
select candidate_lists_test.expect(
  'given_valid_server_owned_manual_provenance_when_add_succeeds_then_member_binds_the_exact_evidence_snapshot',
  (select output->>'status' = 'added' from candidate_lists_test.outputs where case_name = 'add-ok')
  and (select count(*) = 1 from public.candidate_list_members
        where list_id = (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a')
          and campaign_id = 'lists-campaign' and candidate_id = 'cand-manual'
          and evidence_kind = 'manual_attestation'
          and evidence_sha256 = repeat('1',64))
  and (select count(*) = 1 from public.candidate_list_operation_receipts
        where idempotency_key = 'a0000000-0000-4000-8000-000000000007'
          and operation_kind = 'add_member')
);
select candidate_lists_test.expect(
  'given_the_exact_same_add_replayed_with_the_same_idempotency_key_then_exact_stored_result_is_returned',
  (select a.output = b.output
        from candidate_lists_test.outputs a cross join candidate_lists_test.outputs b
       where a.case_name = 'add-ok' and b.case_name = 'add-replay-exact')
  and (select count(*) = 1 from public.candidate_list_operation_receipts
        where idempotency_key = 'a0000000-0000-4000-8000-000000000007')
);
select candidate_lists_test.expect(
  'given_the_same_idempotency_key_reused_with_different_add_inputs_then_idempotency_conflict',
  (select output = '{"status":"idempotency_conflict"}'::jsonb from candidate_lists_test.outputs where case_name = 'add-replay-conflict')
  and not exists (
    select 1 from public.candidate_list_members
     where list_id = (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a')
       and campaign_id = 'lists-campaign' and candidate_id = 'cand-concurrent'
  )
);
select candidate_lists_test.expect(
  'given_the_same_member_re_added_with_a_fresh_idempotency_key_then_already_member_not_a_duplicate_row',
  (select output = '{"status":"already_member"}'::jsonb from candidate_lists_test.outputs where case_name = 'add-already-member')
  and (select count(*) = 1 from public.candidate_list_members
        where list_id = (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a')
          and campaign_id = 'lists-campaign' and candidate_id = 'cand-manual')
);

-- ---------------------------------------------------------------------------
-- Concurrent add uniqueness: two distinct sessions race to add the same
-- candidate with two different idempotency keys. Exactly one member row must
-- survive regardless of which request wins the race.
-- ---------------------------------------------------------------------------
SQL

concurrent_list_id="$(psql_stdin -Atq -c "select (output->>'list_id') from candidate_lists_test.outputs where case_name = 'create-a'")"

concurrent_add() {
  local key="$1"
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres -q <<SQL
begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
insert into candidate_lists_test.outputs(case_name, output)
select '${key}', public.add_candidate_list_member(
  '${concurrent_list_id}', 'lists-campaign', 'cand-concurrent', '${key}'
);
commit;
SQL
}

concurrent_add "b0000000-0000-4000-8000-000000000001" &
race_pid_1=$!
concurrent_add "b0000000-0000-4000-8000-000000000002" &
race_pid_2=$!
wait "$race_pid_1"
wait "$race_pid_2"

psql_stdin -q <<'SQL'
select candidate_lists_test.expect(
  'given_two_concurrent_adds_for_the_same_candidate_when_raced_then_exactly_one_member_row_survives',
  (select count(*) = 1 from public.candidate_list_members
    where campaign_id = 'lists-campaign' and candidate_id = 'cand-concurrent')
);
select candidate_lists_test.expect(
  'given_two_concurrent_adds_for_the_same_candidate_when_raced_then_exactly_one_added_receipt_exists',
  (select count(*) = 1 from public.candidate_list_operation_receipts
     where idempotency_key in (
       'b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002'
     )
     and operation_kind = 'add_member'
     and result->>'status' = 'added')
);
select candidate_lists_test.expect(
  'given_two_concurrent_adds_for_the_same_candidate_when_raced_then_both_calls_returned_a_defined_outcome',
  (select bool_and(output->>'status' in ('added','already_member'))
     from candidate_lists_test.outputs
    where case_name in ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002'))
);

-- ---------------------------------------------------------------------------
-- Append-only receipts and attestations: no update or delete path exists,
-- including for the migration owner.
-- ---------------------------------------------------------------------------
select candidate_lists_test.expect_sqlstate(
  'given_any_caller_when_updating_a_member_receipt_then_denied',
  $$update public.candidate_list_operation_receipts set result = result where true$$,
  array['42501','55000']
);
select candidate_lists_test.expect_sqlstate(
  'given_any_caller_when_deleting_a_member_receipt_then_denied',
  $$delete from public.candidate_list_operation_receipts where true$$,
  array['42501','55000']
);
select candidate_lists_test.expect_sqlstate(
  'given_any_caller_when_updating_a_candidate_contact_attestation_then_denied',
  $$update public.candidate_contact_attestations set value_code = value_code where true$$,
  array['42501','55000']
);
select candidate_lists_test.expect_sqlstate(
  'given_any_caller_when_deleting_a_candidate_contact_attestation_then_denied',
  $$delete from public.candidate_contact_attestations where true$$,
  array['42501','55000']
);

-- ---------------------------------------------------------------------------
-- Viewer read path: read-only, no mutation, foreign/missing lists disclose
-- nothing (empty result, not an error).
-- ---------------------------------------------------------------------------
select public.list_candidate_list_members(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  null, null, 50
) is not null as viewer_probe \gset

create temporary table pre_read_counts as
select
  (select count(*) from public.candidate_list_members) as member_count,
  (select count(*) from public.candidate_list_operation_receipts) as receipt_count;

begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c2000000-0000-4000-8000-000000000002');
select candidate_lists_test.expect_sqlstate(
  'given_authenticated_viewer_when_creating_a_list_then_source_mutation_is_denied',
  $$select public.create_candidate_list('Viewer list','90000000-0000-4000-8000-000000000030')$$,
  array['42501']
);
select candidate_lists_test.expect_sqlstate(
  'given_authenticated_viewer_when_adding_a_list_member_then_source_mutation_is_denied',
  format(
    'select public.add_candidate_list_member(%L,%L,%L,%L)',
    (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
    'lists-campaign', 'cand-concurrent', 'a0000000-0000-4000-8000-000000000020'
  ),
  array['42501']
);
create temporary table viewer_own_tenant_rows as
select * from public.list_candidate_list_members(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  null, null, 50
);
create temporary table viewer_foreign_tenant_rows as
select * from public.list_candidate_list_members(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-b'),
  null, null, 50
);
create temporary table viewer_missing_list_rows as
select * from public.list_candidate_list_members(
  '9999999a-0000-4000-8000-000000000000', null, null, 50
);
commit;
grant select on viewer_own_tenant_rows, viewer_foreign_tenant_rows, viewer_missing_list_rows to postgres;

select candidate_lists_test.expect(
  'given_same_tenant_authenticated_member_when_listing_members_then_sees_the_added_candidate',
  (select count(*) >= 1 from viewer_own_tenant_rows where candidate_id = 'cand-provider')
);
select candidate_lists_test.expect(
  'given_a_foreign_tenant_or_missing_list_id_when_listing_members_then_both_return_zero_rows_not_an_error',
  (select count(*) = 0 from viewer_foreign_tenant_rows)
  and (select count(*) = 0 from viewer_missing_list_rows)
);
select candidate_lists_test.expect(
  'given_the_viewer_read_path_was_exercised_when_checked_then_member_and_receipt_counts_are_unchanged',
  (select member_count from pre_read_counts) = (select count(*) from public.candidate_list_members)
  and (select receipt_count from pre_read_counts) = (select count(*) from public.candidate_list_operation_receipts)
);

-- ---------------------------------------------------------------------------
-- Stable keyset pagination under tied added_at timestamps.
-- ---------------------------------------------------------------------------
set local role postgres;
reset role;

do $$
declare
  tie_list uuid;
  tie_time timestamptz := '2026-07-20 12:00:00+00';
begin
  select (output->>'list_id')::uuid into tie_list
    from candidate_lists_test.outputs where case_name = 'create-a';

  insert into public.candidate_list_members(
    list_id, workspace_id, campaign_id, candidate_id,
    evidence_kind, evidence_sha256, evidence_recorded_at, added_by, added_at
  ) values
    (tie_list, '91111111-1111-4111-8111-111111111111', 'lists-campaign', 'cand-tie-1', 'manual_attestation', repeat('5',64), '2026-07-20 09:00:00+00', 'c1000000-0000-4000-8000-000000000001', tie_time),
    (tie_list, '91111111-1111-4111-8111-111111111111', 'lists-campaign', 'cand-tie-2', 'manual_attestation', repeat('6',64), '2026-07-20 09:00:00+00', 'c1000000-0000-4000-8000-000000000001', tie_time),
    (tie_list, '91111111-1111-4111-8111-111111111111', 'lists-campaign', 'cand-tie-3', 'manual_attestation', repeat('7',64), '2026-07-20 09:00:00+00', 'c1000000-0000-4000-8000-000000000001', tie_time);
end;
$$;

begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');

create temporary table tied_page_1 as
select * from public.list_candidate_list_members(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  '2026-07-20 12:00:00+00'::timestamptz, null, 1
);
commit;
grant select on tied_page_1 to postgres;

begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table tied_page_2 as
select * from public.list_candidate_list_members(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  '2026-07-20 12:00:00+00'::timestamptz,
  (select member_seq from tied_page_1 order by member_seq desc limit 1),
  1
);
commit;
grant select on tied_page_2 to postgres;

begin;
set local role authenticated;
select candidate_lists_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table tied_page_3 as
select * from public.list_candidate_list_members(
  (select (output->>'list_id')::uuid from candidate_lists_test.outputs where case_name = 'create-a'),
  '2026-07-20 12:00:00+00'::timestamptz,
  (select member_seq from tied_page_2 order by member_seq desc limit 1),
  1
);
commit;
grant select on tied_page_3 to postgres;

select candidate_lists_test.expect(
  'given_three_members_share_the_identical_added_at_timestamp_when_paginated_one_row_at_a_time_then_each_page_returns_exactly_one_distinct_tied_candidate_with_no_repeat_or_gap',
  (select count(*) from tied_page_1 where candidate_id like 'cand-tie-%') = 1
  and (select count(*) from tied_page_2 where candidate_id like 'cand-tie-%') = 1
  and (select count(*) from tied_page_3 where candidate_id like 'cand-tie-%') = 1
  and (
    select count(distinct candidate_id) from (
      select candidate_id from tied_page_1 where candidate_id like 'cand-tie-%'
      union all select candidate_id from tied_page_2 where candidate_id like 'cand-tie-%'
      union all select candidate_id from tied_page_3 where candidate_id like 'cand-tie-%'
    ) all_pages
  ) = 3
);

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed from candidate_lists_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from candidate_lists_test.results where not passed;
    raise exception 'candidate lists database test failed: %', details;
  end if;
end;
$$;
SQL

# ---------------------------------------------------------------------------
# Non-empty rollback must refuse and preserve the durable list/member/receipt
# authority created above -- no forward-only migration downgrades live data.
# ---------------------------------------------------------------------------
if psql_stdin --set VERBOSITY=verbose < "$rollback" > "$tmp_dir/rollback.log" 2>&1; then
  echo "candidate-lists-db: rollback unexpectedly removed non-empty candidate list authority" >&2
  cat "$tmp_dir/rollback.log" >&2
  exit 1
fi
grep -Eiq '55000|contains rows|refus' "$tmp_dir/rollback.log"
post_refusal_present="$(psql_stdin -Atq -c "select (to_regclass('public.candidate_lists') is null)::text")"
if [[ "$post_refusal_present" != "false" ]]; then
  echo "candidate-lists-db: refused rollback still altered the forward schema" >&2
  exit 1
fi

assertions="$(psql_stdin -Atc "select count(*) from candidate_lists_test.results")"
echo "candidate-lists-db: normalized lists, ACLs/RLS, member RPC, idempotency, provenance, concurrency, keyset pagination, forward/rollback: ${assertions} assertions, 0 failed"
