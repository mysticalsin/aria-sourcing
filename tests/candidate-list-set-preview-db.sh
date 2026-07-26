#!/usr/bin/env bash
set -Eeuo pipefail

# RED-first contract for candidate-list set-preview authority in migration 0067.
#
# The suite is intentionally provider-free. It reads no provider credentials,
# performs no provider or model calls, and uses only disposable PostgreSQL 17
# databases. Before 0067 exists it must stop on one exact authority boundary.
# Once 0067 exists, the same file exercises the complete catalog, behavior,
# bounded-traversal, concurrency, retry, and rollback contract.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidate-list-preview-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
tmp_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  for background_pid in \
    "${mutation_pid:-}" "${first_writer_pid:-}" "${second_writer_pid:-}" \
    "${rollback_pid:-}" "${add_holder_pid:-}"; do
    if [[ -n "$background_pid" ]]; then
      kill "$background_pid" >/dev/null 2>&1 || true
      wait "$background_pid" >/dev/null 2>&1 || true
    fi
  done
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="${ARIA_DB_TEST_PASSWORD:-$bootstrap_password}" \
    --env "PGAPPNAME=${PGAPPNAME:-candidate-list-set-preview}" \
    --env "PGOPTIONS=${PGOPTIONS:-}" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" \
    -d postgres "$@"
}

psql_database() {
  local database="$1"
  shift
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="${ARIA_DB_TEST_PASSWORD:-$bootstrap_password}" \
    --env "PGAPPNAME=${PGAPPNAME:-candidate-list-set-preview-probe}" \
    --env "PGOPTIONS=${PGOPTIONS:-}" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" \
    -d "$database" "$@"
}

schema_fingerprint() {
  local database="${1:-postgres}"
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint pg_dump \
    "$client_image" \
    -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d "$database" \
    --schema=public --schema-only --no-owner \
    | sed -E '/^\\(un)?restrict[[:space:]]/d' \
    | shasum -a 256 | awk '{print $1}'
}

data_fingerprint() {
  local database="${1:-postgres}"
  psql_database "$database" -Atq <<'SQL'
select encode(extensions.digest(convert_to(jsonb_build_object(
  'lists',coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',list_record.id,
      'workspace_id',list_record.workspace_id,
      'name',list_record.name,
      'created_by',list_record.created_by,
      'created_at',list_record.created_at,
      'membership_revision',to_jsonb(list_record)->'membership_revision'
    )) order by workspace_id,id)
      from public.candidate_lists list_record
  ),'[]'::jsonb),
  'members',coalesce((
    select jsonb_agg(to_jsonb(member_record)
      order by workspace_id,list_id,campaign_id,candidate_id)
      from public.candidate_list_members member_record
  ),'[]'::jsonb),
  'attestations',coalesce((
    select jsonb_agg(to_jsonb(attestation_record) order by id)
      from public.candidate_contact_attestations attestation_record
  ),'[]'::jsonb),
  'receipts',coalesce((
    select jsonb_agg(to_jsonb(receipt_record) order by id)
      from public.candidate_list_operation_receipts receipt_record
  ),'[]'::jsonb),
  'holds',coalesce((
    select jsonb_agg(to_jsonb(hold_record) order by id)
      from public.candidate_legal_holds hold_record
  ),'[]'::jsonb),
  'erasures',coalesce((
    select jsonb_agg(to_jsonb(erasure_record) order by id)
      from public.candidate_erasure_requests erasure_record
  ),'[]'::jsonb),
  'erasure_receipts',coalesce((
    select jsonb_agg(to_jsonb(erasure_receipt_record) order by request_id,store_name)
      from public.candidate_erasure_receipts erasure_receipt_record
  ),'[]'::jsonb)
)::text,'UTF8'),'sha256'),'hex');
SQL
}

legacy_data_fingerprint() {
  local database="${1:-postgres}"
  psql_database "$database" -Atq <<'SQL'
select encode(extensions.digest(convert_to(jsonb_build_object(
  'lists',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',list_record.id,
      'workspace_id',list_record.workspace_id,
      'name',list_record.name,
      'created_by',list_record.created_by,
      'created_at',list_record.created_at
    ) order by workspace_id,id)
      from public.candidate_lists list_record
  ),'[]'::jsonb),
  'members',coalesce((
    select jsonb_agg(to_jsonb(member_record)
      order by workspace_id,list_id,campaign_id,candidate_id)
      from public.candidate_list_members member_record
  ),'[]'::jsonb),
  'attestations',coalesce((
    select jsonb_agg(to_jsonb(attestation_record) order by id)
      from public.candidate_contact_attestations attestation_record
  ),'[]'::jsonb),
  'receipts',coalesce((
    select jsonb_agg(to_jsonb(receipt_record) order by id)
      from public.candidate_list_operation_receipts receipt_record
  ),'[]'::jsonb),
  'holds',coalesce((
    select jsonb_agg(to_jsonb(hold_record) order by id)
      from public.candidate_legal_holds hold_record
  ),'[]'::jsonb),
  'erasures',coalesce((
    select jsonb_agg(to_jsonb(erasure_record) order by id)
      from public.candidate_erasure_requests erasure_record
  ),'[]'::jsonb),
  'erasure_receipts',coalesce((
    select jsonb_agg(to_jsonb(erasure_receipt_record) order by request_id,store_name)
      from public.candidate_erasure_receipts erasure_receipt_record
  ),'[]'::jsonb)
)::text,'UTF8'),'sha256'),'hex');
SQL
}

copy_auth_schema_to_database() {
  local database="$1"
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint pg_dump \
    "$client_image" \
    -h db -U postgres -d postgres --schema=auth --schema-only --no-owner \
    | ARIA_DB_TEST_ROLE=supabase_admin psql_database "$database" -q
  ARIA_DB_TEST_ROLE=supabase_admin psql_database "$database" -q \
    < docker/db/03-auth-owner.sql
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

expected_0066_sha256="f1db1fcdf0c10216f34799dc40c868c859ad06929d959641f44dc833f31240e4"
actual_0066_sha256="$(shasum -a 256 \
  supabase/migrations/0066_candidate_global_legal_hold_authority.sql \
  | awk '{print $1}')"
if [[ "$actual_0066_sha256" != "$expected_0066_sha256" ]]; then
  echo "candidate-list-set-preview-db: 0066 migration SHA-256 drifted (${actual_0066_sha256})" >&2
  exit 1
fi

last_migration=""
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  sequence="${base%%_*}"
  if (( 10#$sequence > 66 )); then
    break
  fi
  psql_stdin --single-transaction -q < "$migration"
  last_migration="$base"
done

if [[ "$last_migration" != "0066_candidate_global_legal_hold_authority.sql" ]]; then
  echo "candidate-list-set-preview-db: migration bootstrap stopped at ${last_migration:-none}, not exact 0066" >&2
  exit 1
fi

psql_stdin --single-transaction -q < tests/db/gotrue-lifecycle-fixture.sql

foundation_present="$(psql_stdin -Atq -c "select (
  to_regclass('public.candidate_lists') is not null
  and to_regclass('public.candidate_list_members') is not null
  and to_regprocedure('public.candidate_legal_hold_lock_key(uuid,text)') is not null
  and to_regprocedure(
    'public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)'
  ) is not null
  and to_regclass('public.candidate_legal_holds_active_candidate_idx') is not null
)::text")"
if [[ "$foundation_present" != "true" ]]; then
  echo "candidate-list-set-preview-db: accepted 0066 candidate-list foundation is missing" >&2
  exit 1
fi

# Seed one non-empty 0066 list before 0067 so the zero-revision baseline and
# rollback preservation checks cannot pass against an empty toy database.
psql_stdin --single-transaction -q <<'SQL'
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '67000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','preview-admin@example.test','',now(),
  '{}','{}',now(),now()
);
insert into public.workspaces(id,name,allowed_domain) values (
  '67111111-1111-4111-8111-111111111111',
  'Preview authority workspace','preview-authority.example.test'
);
insert into public.profiles(id,email,full_name,workspace_id,role) values (
  '67000000-0000-4000-8000-000000000001',
  'preview-admin@example.test','Preview Admin',
  '67111111-1111-4111-8111-111111111111','admin'
);
insert into public.workspace_state(workspace_id,state) values (
  '67111111-1111-4111-8111-111111111111',
  '{"candidates":[{"campaignId":"legacy-campaign","id":"legacy-candidate","name":"PRIVATE-WORKSPACE-SENTINEL","email":"private-sentinel@example.test","phone":"+14155550167"}],"activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],"ledger":[],"suppression":[],"campaigns":[],"chats":[],"ingestedMessageIds":[],"chatboxSubmissions":[]}'
);
insert into public.candidate_lists(id,workspace_id,name,created_by) values (
  '67222222-2222-4222-8222-222222222220',
  '67111111-1111-4111-8111-111111111111',
  'PRIVATE-LIST-NAME-SENTINEL',
  '67000000-0000-4000-8000-000000000001'
);
insert into public.candidate_contact_attestations(
  workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
  evidence_sha256,recorded_by,recorded_at
) values (
  '67111111-1111-4111-8111-111111111111',
  'legacy-campaign','legacy-candidate','manual_provenance',
  'operator_verified',repeat('a',64),
  '67000000-0000-4000-8000-000000000001',
  '2026-07-26 09:00:00+00'
);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_sha256,evidence_recorded_at,
  added_by,added_at,member_id
) select
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222220',
  'legacy-campaign','legacy-candidate','manual_attestation',
  attestation.id,attestation.evidence_sha256,attestation.recorded_at,
  '67000000-0000-4000-8000-000000000001',
  '2026-07-26 09:00:00+00',
  '67333333-3333-4333-8333-333333333330'
from public.candidate_contact_attestations attestation
where attestation.workspace_id = '67111111-1111-4111-8111-111111111111'
  and attestation.campaign_id = 'legacy-campaign'
  and attestation.candidate_id = 'legacy-candidate';
SQL

pre_0067_schema_fingerprint="$(schema_fingerprint)"
pre_0067_data_fingerprint="$(data_fingerprint)"
pre_0067_legacy_data_fingerprint="$(legacy_data_fingerprint)"

migration="supabase/migrations/0067_candidate_list_set_preview_authority.sql"
rollback="supabase/rollbacks/0067_candidate_list_set_preview_authority.sql"

authority_state="$(psql_stdin -Atq -c "select concat(
  case when exists (
    select 1 from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_lists'::regclass
       and attribute.attname = 'membership_revision'
       and not attribute.attisdropped
  ) then 'true' else 'false' end,
  '|',
  case when to_regprocedure(
    'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
  ) is not null then 'true' else 'false' end
)")"

if [[ ! -f "$migration" ]]; then
  if [[ "$authority_state" != "false|false" ]]; then
    echo "candidate-list-set-preview-db: 0067 file is absent but authority state is ${authority_state}" >&2
    exit 1
  fi
  echo "candidate-list-set-preview-db RED: public.candidate_lists.membership_revision and public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer) are absent after 0066" >&2
  exit 1
fi
if [[ ! -f "$rollback" ]]; then
  echo "candidate-list-set-preview-db: found exact 0067 migration but exact rollback is absent" >&2
  exit 1
fi
if [[ "$authority_state" != "false|false" ]]; then
  echo "candidate-list-set-preview-db: 0067 authority exists before its migration is applied (${authority_state})" >&2
  exit 1
fi

psql_stdin --single-transaction -q < "$migration"
post_0067_schema_fingerprint="$(schema_fingerprint)"
post_0067_data_fingerprint="$(data_fingerprint)"
psql_stdin --single-transaction -q < "$migration"
if [[ "$(schema_fingerprint)" != "$post_0067_schema_fingerprint" ]] \
   || [[ "$(data_fingerprint)" != "$post_0067_data_fingerprint" ]]; then
  echo "candidate-list-set-preview-db: forward retry changed schema or durable data" >&2
  exit 1
fi

# The remaining sections are the future-green contract. They are unreachable
# in the RED commit, but become mandatory without changing this test surface.

run_catalog_and_behavior_contract() {
psql_stdin --single-transaction -q <<'SQL'
\set ON_ERROR_STOP on

create schema candidate_list_preview_test;
create table candidate_list_preview_test.results(
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table candidate_list_preview_test.outputs(
  case_name text primary key,
  output jsonb not null
);

create role candidate_list_preview_acl_probe nologin noinherit;

create function candidate_list_preview_test.expect(
  p_case_name text,p_passed boolean,p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog,candidate_list_preview_test
as $$
begin
  insert into candidate_list_preview_test.results(case_name,passed,detail)
  values(p_case_name,coalesce(p_passed,false),p_detail);
end
$$;

create function candidate_list_preview_test.preview_as(
  p_actor uuid,
  p_database_role text,
  p_left_list_id uuid,
  p_left_revision bigint,
  p_right_list_id uuid,
  p_right_revision bigint,
  p_operation text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_limit integer
) returns jsonb
language plpgsql
set search_path = pg_catalog,public,candidate_list_preview_test
as $$
declare
  result jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',p_actor,'role',p_database_role)::text,
    true
  );
  perform set_config('request.jwt.claim.sub',coalesce(p_actor::text,''),true);
  perform set_config('request.jwt.claim.role',p_database_role,true);
  execute format('set local role %I',p_database_role);
  result := public.preview_candidate_list_set(
    p_left_list_id,p_left_revision,p_right_list_id,p_right_revision,
    p_operation,p_after_campaign_id,p_after_candidate_id,p_limit
  );
  execute 'reset role';
  return result;
exception when others then
  execute 'reset role';
  raise;
end
$$;

create function candidate_list_preview_test.expect_preview_sqlstate(
  p_case_name text,
  p_actor uuid,
  p_database_role text,
  p_left_list_id uuid,
  p_left_revision bigint,
  p_right_list_id uuid,
  p_right_revision bigint,
  p_operation text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_limit integer,
  p_expected text
) returns void
language plpgsql
set search_path = pg_catalog,public,candidate_list_preview_test
as $$
declare
  caught text;
begin
  begin
    perform candidate_list_preview_test.preview_as(
      p_actor,p_database_role,p_left_list_id,p_left_revision,
      p_right_list_id,p_right_revision,p_operation,
      p_after_campaign_id,p_after_candidate_id,p_limit
    );
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
  end;
  perform candidate_list_preview_test.expect(
    p_case_name,caught=p_expected,
    format('sqlstate=%s expected=%s',coalesce(caught,'<none>'),p_expected)
  );
end
$$;

-- Exact catalog contract, using typed catalogs for column, collation, and
-- transition-table metadata rather than definition-only regular expressions.
select candidate_list_preview_test.expect(
  'column_is_exact_nonnegative_bigint_default_zero',
  exists (
    select 1
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_attrdef default_value
        on default_value.adrelid=attribute.attrelid
       and default_value.adnum=attribute.attnum
     where attribute.attrelid='public.candidate_lists'::regclass
       and attribute.attname='membership_revision'
       and attribute.atttypid='pg_catalog.int8'::regtype
       and attribute.attnotnull
       and not attribute.attisdropped
       and pg_catalog.pg_get_expr(
         default_value.adbin,default_value.adrelid
       ) in ('0','0::bigint')
  ) and exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid='public.candidate_lists'::regclass
       and constraint_row.contype='c'
       and pg_catalog.pg_get_constraintdef(constraint_row.oid)
           like '%membership_revision >= 0%'
  )
);

select candidate_list_preview_test.expect(
  'column_comment_is_exact_0067_rollback_marker',
  pg_catalog.col_description(
    'public.candidate_lists'::regclass,
    (
      select attribute.attnum
        from pg_catalog.pg_attribute attribute
       where attribute.attrelid='public.candidate_lists'::regclass
         and attribute.attname='membership_revision'
         and not attribute.attisdropped
    )
  )='aria:candidate-list-set-preview-authority:0067'
);

select candidate_list_preview_test.expect(
  'membership_index_has_exact_key_order_and_c_collations',
  exists (
    select 1
      from pg_catalog.pg_index index_catalog
      join pg_catalog.pg_class index_relation
        on index_relation.oid=index_catalog.indexrelid
     where index_catalog.indrelid='public.candidate_list_members'::regclass
       and index_catalog.indnkeyatts >= 4
       and (index_catalog.indkey::smallint[])[0:3]=array[
         (
           select attnum from pg_catalog.pg_attribute
            where attrelid=index_catalog.indrelid and attname='workspace_id'
         ),
         (
           select attnum from pg_catalog.pg_attribute
            where attrelid=index_catalog.indrelid and attname='list_id'
         ),
         (
           select attnum from pg_catalog.pg_attribute
            where attrelid=index_catalog.indrelid and attname='campaign_id'
         ),
         (
           select attnum from pg_catalog.pg_attribute
            where attrelid=index_catalog.indrelid and attname='candidate_id'
         )
       ]::smallint[]
       and (index_catalog.indcollation::oid[])[2]='pg_catalog."C"'::regcollation
       and (index_catalog.indcollation::oid[])[3]='pg_catalog."C"'::regcollation
       and index_catalog.indisvalid and index_catalog.indisready
  )
);

select candidate_list_preview_test.expect(
  'insert_delete_and_truncate_triggers_have_exact_statement_metadata',
  (
    select count(*)=1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid='public.candidate_list_members'::regclass
       and not trigger_row.tgisinternal
       and trigger_row.tgfoid=
         'public.advance_candidate_list_membership_revisions()'::regprocedure
       and (trigger_row.tgtype & 1)=0
       and (trigger_row.tgtype & 2)=0
       and (trigger_row.tgtype & 4)=4
       and trigger_row.tgnewtable is not null
       and trigger_row.tgoldtable is null
  ) and (
    select count(*)=1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid='public.candidate_list_members'::regclass
       and not trigger_row.tgisinternal
       and trigger_row.tgfoid=
         'public.advance_candidate_list_membership_revisions()'::regprocedure
       and (trigger_row.tgtype & 1)=0
       and (trigger_row.tgtype & 2)=0
       and (trigger_row.tgtype & 8)=8
       and trigger_row.tgoldtable is not null
       and trigger_row.tgnewtable is null
  ) and (
    select count(*)=1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid='public.candidate_list_members'::regclass
       and not trigger_row.tgisinternal
       and trigger_row.tgfoid=
         'public.reject_candidate_list_member_truncate()'::regprocedure
       and (trigger_row.tgtype & 1)=0
       and (trigger_row.tgtype & 2)=2
       and (trigger_row.tgtype & 32)=32
  ) and (
    select count(*)=1
      from pg_catalog.pg_trigger trigger_row
     where trigger_row.tgrelid='public.candidate_lists'::regclass
       and not trigger_row.tgisinternal
       and trigger_row.tgfoid=
         'public.guard_candidate_list_membership_revision()'::regprocedure
       and (trigger_row.tgtype & 1)=1
       and (trigger_row.tgtype & 2)=2
       and (trigger_row.tgtype & 16)=16
  )
);

with expected(signature,language_name,volatility,security_definer,has_config) as (
  values
    ('public.advance_candidate_list_membership_revisions()',
     'plpgsql','v',true,true),
    ('public.reject_candidate_list_member_truncate()',
     'plpgsql','v',true,true),
    ('public.guard_candidate_list_membership_revision()',
     'plpgsql','v',true,true),
    ('public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)',
     'sql','s',false,false),
    ('public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)',
     'plpgsql','s',true,true)
), actual as (
  select expected.*,
         function_row.oid,
         pg_catalog.pg_get_userbyid(function_row.proowner) owner_name,
         language_row.lanname,
         function_row.provolatile,
         function_row.prosecdef,
         function_row.proconfig
    from expected
    left join pg_catalog.pg_proc function_row
      on function_row.oid=pg_catalog.to_regprocedure(expected.signature)
    left join pg_catalog.pg_language language_row
      on language_row.oid=function_row.prolang
)
select candidate_list_preview_test.expect(
  'functions_have_exact_owner_language_volatility_security_and_config',
  count(*)=5 and bool_and(
    oid is not null
    and owner_name='postgres'
    and lanname=language_name
    and provolatile=volatility
    and prosecdef=security_definer
    and (
      (has_config and proconfig=array['search_path=pg_catalog, public, pg_temp'])
      or (not has_config and proconfig is null)
    )
  )
) from actual;

with function_contract(signature,authenticated_execute) as (
  values
    ('public.advance_candidate_list_membership_revisions()',false),
    ('public.reject_candidate_list_member_truncate()',false),
    ('public.guard_candidate_list_membership_revision()',false),
    ('public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)',false),
    ('public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)',true)
), resolved as (
  select function_contract.*,
         pg_catalog.to_regprocedure(function_contract.signature) function_oid,
         function_row.proowner,
         function_row.proacl
    from function_contract
    left join pg_catalog.pg_proc function_row
      on function_row.oid=pg_catalog.to_regprocedure(function_contract.signature)
), role_contract(role_name) as (
  values
    ('anon'),('authenticated'),('service_role'),('authenticator'),
    ('candidate_list_preview_acl_probe')
), effective_acl as (
  select resolved.signature,role_contract.role_name,
         case when role_contract.role_name='authenticated'
              then resolved.authenticated_execute else false end expected_execute,
         pg_catalog.has_function_privilege(
           role_contract.role_name::name,resolved.function_oid,'EXECUTE'
         ) actual_execute
    from resolved
    cross join role_contract
)
select candidate_list_preview_test.expect(
  'all_0067_functions_have_exhaustive_owner_only_acl_except_authenticated_rpc',
  (
    select count(*)=1
      from pg_catalog.pg_proc function_row
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid=function_row.pronamespace
     where namespace_row.nspname='public'
       and function_row.proname='preview_candidate_list_set'
  )
  and (
    select count(*)=5
       and bool_and(
         function_oid is not null
         and pg_catalog.pg_get_userbyid(proowner)='postgres'
         and pg_catalog.has_function_privilege(
           'postgres',function_oid,'EXECUTE'
         )
         and not exists (
           select 1
             from pg_catalog.aclexplode(
               coalesce(
                 resolved.proacl,
                 pg_catalog.acldefault('f',resolved.proowner)
               )
             ) acl_entry
            where acl_entry.privilege_type='EXECUTE'
              and not (
                acl_entry.grantee=resolved.proowner
                or (
                  resolved.authenticated_execute
                  and acl_entry.grantee=(
                    select role_row.oid
                      from pg_catalog.pg_roles role_row
                     where role_row.rolname='authenticated'
                  )
                  and not acl_entry.is_grantable
                )
              )
         )
       )
      from resolved
  )
  and (
    select count(*)=25
       and bool_and(
         actual_execute is not distinct from expected_execute
       )
      from effective_acl
  )
);

select candidate_list_preview_test.expect(
  'planning_helper_has_exact_closed_return_table',
  (
    select function_row.proretset
       and function_row.prorettype='pg_catalog.record'::regtype
       and function_row.proallargtypes[8:13]=array[
         'pg_catalog.text'::regtype::oid,
         'pg_catalog.text'::regtype::oid,
         'pg_catalog.text'::regtype::oid,
         'pg_catalog.text'::regtype::oid,
         'pg_catalog.bool'::regtype::oid,
         'pg_catalog.bool'::regtype::oid
       ]
       and function_row.proargmodes[8:13]=array['t','t','t','t','t','t']::char[]
       and function_row.proargnames[8:13]=array[
         'campaign_id','candidate_id','relation','disposition','emit','is_lookahead'
       ]
      from pg_catalog.pg_proc function_row
     where function_row.oid=
       'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'::regprocedure
  )
);

select candidate_list_preview_test.expect(
  'list_tables_remain_forced_rls_with_zero_runtime_writes',
  (
    select count(*)=4
       and bool_and(
         table_relation.relrowsecurity
         and table_relation.relforcerowsecurity
       )
      from pg_catalog.pg_class table_relation
      join pg_catalog.pg_namespace namespace_row
        on namespace_row.oid=table_relation.relnamespace
     where namespace_row.nspname='public'
       and table_relation.relname in (
         'candidate_lists','candidate_list_members',
         'candidate_contact_attestations','candidate_list_operation_receipts'
       )
       and table_relation.relkind in ('r','p')
  )
  and not has_table_privilege('authenticated','public.candidate_lists','UPDATE')
  and not has_table_privilege('authenticated','public.candidate_list_members','INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role','public.candidate_list_members','INSERT,UPDATE,DELETE,TRUNCATE')
);

select candidate_list_preview_test.expect(
  'pre_0067_nonempty_list_starts_at_revision_zero',
  (
    select membership_revision=0
      from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222220'
  )
);
SQL
}

seed_preview_fixtures() {
psql_stdin --single-transaction -q <<'SQL'
\set ON_ERROR_STOP on

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,banned_until
) values
  ('67000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','preview-viewer@example.test','',now(),'{}','{}',now(),now(),null),
  ('67000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','preview-member@example.test','',now(),'{}','{}',now(),now(),null),
  ('67000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','preview-inactive@example.test','',now(),'{}','{}',now(),now(),now()+interval '1 day'),
  ('67000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','foreign-private-actor-sentinel@example.test','',now(),'{}','{}',now(),now(),null),
  ('67000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','preview-cascade@example.test','',now(),'{}','{}',now(),now(),null);

insert into public.workspaces(id,name,allowed_domain) values
  ('67111111-1111-4111-8111-111111111112','Foreign preview workspace','preview-foreign.example.test'),
  ('67111111-1111-4111-8111-111111111113','Cascade preview workspace','preview-cascade.example.test');

insert into public.profiles(id,email,full_name,workspace_id,role) values
  ('67000000-0000-4000-8000-000000000002','preview-viewer@example.test','Preview Viewer','67111111-1111-4111-8111-111111111111','viewer'),
  ('67000000-0000-4000-8000-000000000003','preview-member@example.test','Preview Member','67111111-1111-4111-8111-111111111111','member'),
  ('67000000-0000-4000-8000-000000000004','preview-inactive@example.test','Preview Inactive','67111111-1111-4111-8111-111111111111','admin'),
  ('67000000-0000-4000-8000-000000000005','foreign-private-actor-sentinel@example.test','FOREIGN-PRIVATE-ACTOR-SENTINEL','67111111-1111-4111-8111-111111111112','admin'),
  ('67000000-0000-4000-8000-000000000006','preview-cascade@example.test','Preview Cascade','67111111-1111-4111-8111-111111111113','admin');

insert into public.workspace_state(workspace_id,state) values
  ('67111111-1111-4111-8111-111111111112','{"candidates":[],"activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],"ledger":[],"suppression":[],"campaigns":[],"chats":[],"ingestedMessageIds":[],"chatboxSubmissions":[]}'),
  ('67111111-1111-4111-8111-111111111113','{"candidates":[],"activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],"ledger":[],"suppression":[],"campaigns":[],"chats":[],"ingestedMessageIds":[],"chatboxSubmissions":[]}');

insert into public.candidate_lists(id,workspace_id,name,created_by) values
  ('67222222-2222-4222-8222-222222222221','67111111-1111-4111-8111-111111111111','Left list','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222222','67111111-1111-4111-8111-111111111111','Right list','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222223','67111111-1111-4111-8111-111111111111','Empty list','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222224','67111111-1111-4111-8111-111111111111','C order list','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222225','67111111-1111-4111-8111-111111111111','Concurrent list','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222226','67111111-1111-4111-8111-111111111111','Erasure list one','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222227','67111111-1111-4111-8111-111111111111','Erasure list two','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222228','67111111-1111-4111-8111-111111111111','List cascade','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-222222222229','67111111-1111-4111-8111-111111111111','Disjoint large left','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-22222222222a','67111111-1111-4111-8111-111111111111','Disjoint large right','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-22222222222b','67111111-1111-4111-8111-111111111111','Identical large left','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-22222222222c','67111111-1111-4111-8111-111111111111','Identical large right','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-22222222222d','67111111-1111-4111-8111-111111111111','Union large left','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-22222222222e','67111111-1111-4111-8111-111111111111','Union large right','67000000-0000-4000-8000-000000000001'),
  ('67222222-2222-4222-8222-22222222222f','67111111-1111-4111-8111-111111111112','FOREIGN-PRIVATE-LIST-SENTINEL','67000000-0000-4000-8000-000000000005'),
  ('67222222-2222-4222-8222-222222222230','67111111-1111-4111-8111-111111111113','Workspace cascade list','67000000-0000-4000-8000-000000000006');

create table candidate_list_preview_test.fixture_members(
  list_id uuid not null,
  campaign_id text not null,
  candidate_id text not null,
  evidence_kind text not null default 'manual_attestation',
  primary key(list_id,campaign_id,candidate_id)
);

insert into candidate_list_preview_test.fixture_members(
  list_id,campaign_id,candidate_id,evidence_kind
) values
  ('67222222-2222-4222-8222-222222222221','A-campaign','Alpha','manual_attestation'),
  ('67222222-2222-4222-8222-222222222221','campaign-a','shared','manual_attestation'),
  ('67222222-2222-4222-8222-222222222221','campaign-b','same-id','manual_attestation'),
  ('67222222-2222-4222-8222-222222222221','campaign-z','left-only','github_provider'),
  ('67222222-2222-4222-8222-222222222222','campaign-a','shared','manual_attestation'),
  ('67222222-2222-4222-8222-222222222222','campaign-b','same-id','manual_attestation'),
  ('67222222-2222-4222-8222-222222222222','campaign-c','same-id','manual_attestation'),
  ('67222222-2222-4222-8222-222222222222','campaign-z','right-only','manual_attestation'),
  ('67222222-2222-4222-8222-222222222224','A','A','manual_attestation'),
  ('67222222-2222-4222-8222-222222222224','A','a','manual_attestation'),
  ('67222222-2222-4222-8222-222222222224','A','a-','manual_attestation'),
  ('67222222-2222-4222-8222-222222222224','A','a.','manual_attestation'),
  ('67222222-2222-4222-8222-222222222224','A','a:','manual_attestation'),
  ('67222222-2222-4222-8222-222222222224','A','a_','manual_attestation'),
  ('67222222-2222-4222-8222-222222222225','concurrent','baseline','manual_attestation'),
  ('67222222-2222-4222-8222-222222222228','cascade','candidate','manual_attestation'),
  ('67222222-2222-4222-8222-22222222222f','foreign-private-campaign-sentinel','FOREIGN-PRIVATE-MEMBER-SENTINEL','manual_attestation'),
  ('67222222-2222-4222-8222-222222222230','cascade','workspace-candidate','manual_attestation');

insert into public.candidate_contact_attestations(
  workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
  evidence_sha256,recorded_by,recorded_at,authority_version,
  lawful_basis_code,observed_at
)
select distinct
  list_record.workspace_id,fixture.campaign_id,fixture.candidate_id,
  'manual_provenance','operator_verified',
  case when fixture.candidate_id='Alpha' then repeat('f',64)
       else md5(fixture.campaign_id||':'||fixture.candidate_id)
          ||md5(fixture.campaign_id||':'||fixture.candidate_id) end,
  list_record.created_by,'2026-07-26 10:00:00+00',
  case when fixture.candidate_id='Alpha' then 'governed-v1' else 'legacy-v1' end,
  case when fixture.candidate_id='Alpha' then 'legitimate_interest' else null end,
  case when fixture.candidate_id='Alpha'
       then '2026-07-26 09:59:00+00'::timestamptz else null end
from candidate_list_preview_test.fixture_members fixture
join public.candidate_lists list_record on list_record.id=fixture.list_id
where fixture.evidence_kind='manual_attestation';

-- One statement spans many lists. Every touched list must advance exactly
-- once even though the transition relation contains multiple rows.
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_provider_attempt_id,evidence_sha256,
  evidence_recorded_at,added_by,added_at,member_id
)
select
  list_record.workspace_id,fixture.list_id,fixture.campaign_id,
  fixture.candidate_id,fixture.evidence_kind,
  case when fixture.evidence_kind='manual_attestation'
       then attestation.id else null end,
  case when fixture.evidence_kind='github_provider'
       then '67f00000-0000-4000-8000-000000000001'::uuid else null end,
  case when fixture.evidence_kind='github_provider' then repeat('e',64)
       else attestation.evidence_sha256 end,
  coalesce(attestation.recorded_at,'2026-07-26 10:00:00+00'::timestamptz),
  list_record.created_by,'2026-07-26 10:01:00+00',
  md5(fixture.list_id::text||fixture.campaign_id||fixture.candidate_id)::uuid
from candidate_list_preview_test.fixture_members fixture
join public.candidate_lists list_record on list_record.id=fixture.list_id
left join public.candidate_contact_attestations attestation
  on attestation.workspace_id=list_record.workspace_id
 and attestation.campaign_id=fixture.campaign_id
 and attestation.candidate_id=fixture.candidate_id;

-- Large provider-shaped identity fixtures need no contact payload or provider
-- call. They exist only to prove bounded indexed traversal.
with generated(list_id,campaign_id,candidate_id) as (
  select '67222222-2222-4222-8222-222222222229'::uuid,
         'disjoint','left-'||lpad(series::text,5,'0')
    from generate_series(0,9999) series
  union all
  select '67222222-2222-4222-8222-22222222222a'::uuid,
         'disjoint','right-'||lpad(series::text,5,'0')
    from generate_series(0,9999) series
  union all
  select list_id,'identical','shared-'||lpad(series::text,5,'0')
    from unnest(array[
      '67222222-2222-4222-8222-22222222222b'::uuid,
      '67222222-2222-4222-8222-22222222222c'::uuid
    ]) list_id
    cross join generate_series(0,9999) series
  union all
  select '67222222-2222-4222-8222-22222222222d'::uuid,
         'union','item-'||lpad((series*2)::text,5,'0')
    from generate_series(0,9999) series
  union all
  select '67222222-2222-4222-8222-22222222222e'::uuid,
         'union','item-'||lpad((series*2+1)::text,5,'0')
    from generate_series(0,9999) series
)
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_provider_attempt_id,evidence_sha256,
  evidence_recorded_at,added_by,added_at,member_id
)
select
  '67111111-1111-4111-8111-111111111111',generated.list_id,
  generated.campaign_id,generated.candidate_id,'github_provider',
  null,md5('attempt:'||generated.list_id::text||generated.candidate_id)::uuid,
  md5(generated.campaign_id||generated.candidate_id)
    ||md5(generated.candidate_id||generated.campaign_id),
  '2026-07-26 10:02:00+00','67000000-0000-4000-8000-000000000001',
  '2026-07-26 10:02:00+00',
  md5('member:'||generated.list_id::text||generated.candidate_id)::uuid
from generated;

analyze public.candidate_list_members;

select candidate_list_preview_test.expect(
  'one_multirow_statement_advances_every_touched_list_once',
  (
    select bool_and(membership_revision=1)
      from public.candidate_lists
     where id in (
       '67222222-2222-4222-8222-222222222221',
       '67222222-2222-4222-8222-222222222222',
       '67222222-2222-4222-8222-222222222224',
       '67222222-2222-4222-8222-222222222225',
       '67222222-2222-4222-8222-222222222228',
       '67222222-2222-4222-8222-222222222229',
       '67222222-2222-4222-8222-22222222222a',
       '67222222-2222-4222-8222-22222222222b',
       '67222222-2222-4222-8222-22222222222c',
       '67222222-2222-4222-8222-22222222222d',
       '67222222-2222-4222-8222-22222222222e',
       '67222222-2222-4222-8222-22222222222f',
       '67222222-2222-4222-8222-222222222230'
     )
  )
);
SQL
}

run_preview_semantics_contract() {
psql_stdin --single-transaction -q <<'SQL'
\set ON_ERROR_STOP on

-- A second successful statement advances once; conflict-only and zero-row
-- statements do not advance.
insert into public.candidate_contact_attestations(
  workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
  evidence_sha256,recorded_by,recorded_at
) values (
  '67111111-1111-4111-8111-111111111111','campaign-y','second-statement',
  'manual_provenance','operator_verified',repeat('d',64),
  '67000000-0000-4000-8000-000000000001','2026-07-26 10:03:00+00'
);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_sha256,evidence_recorded_at,
  added_by,added_at,member_id
) select
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222221',
  'campaign-y','second-statement','manual_attestation',
  id,evidence_sha256,recorded_at,
  '67000000-0000-4000-8000-000000000001',
  '2026-07-26 10:03:00+00','67333333-3333-4333-8333-333333333331'
from public.candidate_contact_attestations
where workspace_id='67111111-1111-4111-8111-111111111111'
  and campaign_id='campaign-y' and candidate_id='second-statement';

select candidate_list_preview_test.expect(
  'two_insert_statements_advance_twice',
  (
    select membership_revision=2 from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222221'
  )
);

insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_sha256,evidence_recorded_at,
  added_by,added_at,member_id
)
select workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
       evidence_attestation_id,evidence_sha256,evidence_recorded_at,
       added_by,added_at,gen_random_uuid()
  from public.candidate_list_members
 where list_id='67222222-2222-4222-8222-222222222221'
   and campaign_id='campaign-y' and candidate_id='second-statement'
on conflict(workspace_id,list_id,campaign_id,candidate_id) do nothing;
delete from public.candidate_list_members
 where list_id='67222222-2222-4222-8222-222222222221'
   and campaign_id='missing' and candidate_id='missing';

select candidate_list_preview_test.expect(
  'conflict_only_insert_and_zero_delete_advance_zero',
  (
    select membership_revision=2 from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222221'
  )
);

insert into candidate_list_preview_test.outputs(case_name,output)
select role_name,candidate_list_preview_test.preview_as(
  actor_id,'authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,100
)
from (values
  ('viewer','67000000-0000-4000-8000-000000000002'::uuid),
  ('member','67000000-0000-4000-8000-000000000003'::uuid),
  ('admin','67000000-0000-4000-8000-000000000001'::uuid)
) actor(role_name,actor_id);

select candidate_list_preview_test.expect(
  'viewer_member_and_admin_receive_byte_identical_success',
  (
    select count(distinct output::text)=1 and bool_and(output->>'status'='ok')
      from candidate_list_preview_test.outputs
     where case_name in ('viewer','member','admin')
  )
);

select candidate_list_preview_test.expect_preview_sqlstate(
  'anonymous_is_denied',
  '67000000-0000-4000-8000-000000000002','anon',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,10,'42501'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'service_role_is_denied',
  '67000000-0000-4000-8000-000000000001','service_role',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,10,'42501'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'authenticator_is_denied',
  '67000000-0000-4000-8000-000000000001','authenticator',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,10,'42501'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'inactive_authenticated_identity_is_denied',
  '67000000-0000-4000-8000-000000000004','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,10,'42501'
);

-- Authentication and active-principal checks must run before any semantic
-- input validation, so malformed arguments cannot become an authority oracle.
select candidate_list_preview_test.expect_preview_sqlstate(
  'anonymous_denial_precedes_invalid_input',
  '67000000-0000-4000-8000-000000000002','anon',
  null,-1,null,-1,
  ' INVALID ',null,'bad cursor',null,'42501'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'service_role_denial_precedes_invalid_input',
  '67000000-0000-4000-8000-000000000001','service_role',
  null,-1,null,-1,
  ' INVALID ',null,'bad cursor',null,'42501'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'authenticator_denial_precedes_invalid_input',
  '67000000-0000-4000-8000-000000000001','authenticator',
  null,-1,null,-1,
  ' INVALID ',null,'bad cursor',null,'42501'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'inactive_identity_denial_precedes_invalid_input',
  '67000000-0000-4000-8000-000000000004','authenticated',
  null,-1,null,-1,
  ' INVALID ',null,'bad cursor',null,'42501'
);

-- For an authenticated active principal, semantic validation must still run
-- before either list is resolved. Otherwise malformed input becomes an
-- authority oracle for missing or foreign list IDs.
select candidate_list_preview_test.expect_preview_sqlstate(
  'invalid_operation_precedes_missing_list_resolution',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-000000000000',null,
  '67222222-2222-4222-8222-222222222222',null,
  ' INVALID ',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'invalid_cursor_precedes_foreign_list_resolution',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-22222222222f',0,
  'union','bad cursor','shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'half_null_revision_precedes_missing_list_resolution',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-000000000000',0,
  '67222222-2222-4222-8222-000000000001',null,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'invalid_limit_precedes_foreign_list_resolution',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-22222222222f',0,
  '67222222-2222-4222-8222-22222222222f',0,
  'union',null,null,101,'22023'
);

insert into candidate_list_preview_test.outputs(case_name,output) values
  ('missing_left',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-000000000000',null,
    '67222222-2222-4222-8222-222222222222',null,
    'union',null,null,10
  )),
  ('foreign_left',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-22222222222f',null,
    '67222222-2222-4222-8222-222222222222',null,
    'union',null,null,10
  )),
  ('missing_right',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',null,
    '67222222-2222-4222-8222-000000000000',null,
    'union',null,null,10
  )),
  ('foreign_right',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',null,
    '67222222-2222-4222-8222-22222222222f',null,
    'union',null,null,10
  )),
  ('missing_both',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-000000000000',null,
    '67222222-2222-4222-8222-000000000001',null,
    'union',null,null,10
  )),
  ('foreign_both',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-22222222222f',null,
    '67222222-2222-4222-8222-22222222222f',null,
    'union',null,null,10
  )),
  ('missing_left_foreign_right',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-000000000000',null,
    '67222222-2222-4222-8222-22222222222f',null,
    'union',null,null,10
  )),
  ('foreign_left_missing_right',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-22222222222f',null,
    '67222222-2222-4222-8222-000000000001',null,
    'union',null,null,10
  )),
  ('foreign_actor_primary_lists',candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000005','authenticated',
    '67222222-2222-4222-8222-222222222221',null,
    '67222222-2222-4222-8222-222222222222',null,
    'union',null,null,10
  ));

select candidate_list_preview_test.expect(
  'missing_and_foreign_authority_is_exact_non_disclosing_envelope',
  (
    select count(*)=9
       and count(distinct output::text)=1
       and min(output::text)='{"status": "list_not_found"}'
      from candidate_list_preview_test.outputs
     where case_name in (
       'missing_left','foreign_left','missing_right','foreign_right',
       'missing_both','foreign_both','missing_left_foreign_right',
       'foreign_left_missing_right','foreign_actor_primary_lists'
     )
  )
);

select candidate_list_preview_test.expect(
  'non_disclosing_envelopes_leak_no_foreign_actor_list_or_member_sentinel',
  not exists (
    select 1
      from candidate_list_preview_test.outputs
     where case_name in (
       'missing_left','foreign_left','missing_right','foreign_right',
       'missing_both','foreign_both','missing_left_foreign_right',
       'foreign_left_missing_right','foreign_actor_primary_lists'
     )
       and (
         output::text like '%FOREIGN-PRIVATE-%'
         or output::text like '%foreign-private-%'
         or output::text like '%67000000-0000-4000-8000-000000000005%'
         or output::text like '%67222222-2222-4222-8222-22222222222f%'
       )
  )
);

-- Exact syntax validation after authentication.
select candidate_list_preview_test.expect_preview_sqlstate(
  'null_left_list_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  null,null,'67222222-2222-4222-8222-222222222222',null,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'null_right_list_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,null,null,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'null_operation_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  null,null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'empty_operation_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  '',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'unknown_operation_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'merge',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'padded_operation_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  ' Union ',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'overlong_operation_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  repeat('u',17),null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'null_limit_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,null,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'zero_limit_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,0,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'negative_limit_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,-1,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'limit_above_100_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,101,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'only_left_revision_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',null,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'only_right_revision_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',1,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'negative_left_revision_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',-1,
  '67222222-2222-4222-8222-222222222222',1,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'negative_right_revision_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',-1,
  'union',null,null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'only_campaign_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','campaign-a',null,10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'only_candidate_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union',null,'shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'cursor_without_revisions_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',null,
  '67222222-2222-4222-8222-222222222222',null,
  'union','campaign-a','shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'empty_campaign_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','','shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'empty_candidate_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','campaign-a','',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'padded_campaign_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union',' campaign-a','shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'padded_candidate_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','campaign-a','shared ',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'malformed_campaign_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','bad cursor','shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'malformed_candidate_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','campaign-a','bad/cursor',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'overlong_campaign_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union',repeat('x',121),'shared',10,'22023'
);
select candidate_list_preview_test.expect_preview_sqlstate(
  'overlong_candidate_cursor_is_22023',
  '67000000-0000-4000-8000-000000000002','authenticated',
  '67222222-2222-4222-8222-222222222221',2,
  '67222222-2222-4222-8222-222222222222',1,
  'union','campaign-a',repeat('x',121),10,'22023'
);

do $behavior$
declare
  union_result jsonb;
  intersection_result jsonb;
  difference_result jsonb;
  exclusion_result jsonb;
  same_union jsonb;
  same_intersection jsonb;
  same_difference jsonb;
  same_exclusion jsonb;
  empty_result jsonb;
begin
  union_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222222',1,
    'union',null,null,100
  );
  intersection_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222222',1,
    'intersection',null,null,100
  );
  difference_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222222',1,
    'difference',null,null,100
  );
  exclusion_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222222',1,
    'exclusion',null,null,100
  );

  perform candidate_list_preview_test.expect(
    'all_operations_have_exact_closed_envelope_and_item_key_sets',
    not exists (
      select 1
        from (values
          ('union'::text,union_result),
          ('intersection'::text,intersection_result),
          ('difference'::text,difference_result),
          ('exclusion'::text,exclusion_result)
        ) preview(expected_operation,output)
       where output->>'status' is distinct from 'ok'
          or output->>'operation' is distinct from expected_operation
          or output->>'restart_required' is distinct from 'false'
          or jsonb_typeof(output->'left_revision') is distinct from 'string'
          or jsonb_typeof(output->'right_revision') is distinct from 'string'
          or (
            select array_agg(key order by key)
              from jsonb_object_keys(output) key
          ) is distinct from array[
            'has_more','items','left_revision','next_cursor','operation',
            'restart_required','right_revision','status'
          ]
          or exists (
            select 1 from jsonb_array_elements(output->'items') item
             where (
               select array_agg(key order by key)
                 from jsonb_object_keys(item) key
             ) is distinct from array[
               'campaign_id','candidate_id','disposition','relation'
             ]
          )
    )
  );

  perform candidate_list_preview_test.expect(
    'union_has_exact_ordered_identities_relations_and_dispositions',
    union_result->'items'='[
      {"campaign_id":"A-campaign","candidate_id":"Alpha","relation":"left","disposition":"included"},
      {"campaign_id":"campaign-a","candidate_id":"shared","relation":"both","disposition":"included"},
      {"campaign_id":"campaign-b","candidate_id":"same-id","relation":"both","disposition":"included"},
      {"campaign_id":"campaign-c","candidate_id":"same-id","relation":"right","disposition":"included"},
      {"campaign_id":"campaign-y","candidate_id":"second-statement","relation":"left","disposition":"included"},
      {"campaign_id":"campaign-z","candidate_id":"left-only","relation":"left","disposition":"included"},
      {"campaign_id":"campaign-z","candidate_id":"right-only","relation":"right","disposition":"included"}
    ]'::jsonb
  );
  perform candidate_list_preview_test.expect(
    'intersection_has_exact_ordered_identities_relations_and_dispositions',
    intersection_result->'items'='[
      {"campaign_id":"campaign-a","candidate_id":"shared","relation":"both","disposition":"included"},
      {"campaign_id":"campaign-b","candidate_id":"same-id","relation":"both","disposition":"included"}
    ]'::jsonb
  );
  perform candidate_list_preview_test.expect(
    'difference_has_exact_ordered_identities_relations_and_dispositions',
    difference_result->'items'='[
      {"campaign_id":"A-campaign","candidate_id":"Alpha","relation":"left","disposition":"included"},
      {"campaign_id":"campaign-y","candidate_id":"second-statement","relation":"left","disposition":"included"},
      {"campaign_id":"campaign-z","candidate_id":"left-only","relation":"left","disposition":"included"}
    ]'::jsonb
  );
  perform candidate_list_preview_test.expect(
    'exclusion_has_exact_ordered_identities_relations_and_dispositions',
    exclusion_result->'items'='[
      {"campaign_id":"A-campaign","candidate_id":"Alpha","relation":"left","disposition":"retained"},
      {"campaign_id":"campaign-a","candidate_id":"shared","relation":"both","disposition":"would_exclude"},
      {"campaign_id":"campaign-b","candidate_id":"same-id","relation":"both","disposition":"would_exclude"},
      {"campaign_id":"campaign-y","candidate_id":"second-statement","relation":"left","disposition":"retained"},
      {"campaign_id":"campaign-z","candidate_id":"left-only","relation":"left","disposition":"retained"}
    ]'::jsonb
  );
  perform candidate_list_preview_test.expect(
    'same_candidate_id_in_different_campaigns_remains_two_identities',
    (
      select count(*)=2 from jsonb_array_elements(union_result->'items') item
       where item->>'candidate_id'='same-id'
         and item->>'campaign_id' in ('campaign-b','campaign-c')
    )
  );

  same_union := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222221',2,
    'union',null,null,100
  );
  same_intersection := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222221',2,
    'intersection',null,null,100
  );
  same_difference := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222221',2,
    'difference',null,null,100
  );
  same_exclusion := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222221',2,
    'exclusion',null,null,100
  );
  perform candidate_list_preview_test.expect(
    'same_list_semantics_are_exact',
    same_union->'items'=same_intersection->'items'
    and jsonb_array_length(same_difference->'items')=0
    and not exists (
      select 1 from jsonb_array_elements(same_exclusion->'items') item
       where item->>'relation'<>'both'
          or item->>'disposition'<>'would_exclude'
    )
  );

  empty_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222223',null,
    '67222222-2222-4222-8222-222222222223',null,
    'union',null,null,100
  );
  perform candidate_list_preview_test.expect(
    'empty_lists_bind_revisions_with_terminal_empty_page',
    empty_result->>'status'='ok'
    and empty_result->>'left_revision'='0'
    and empty_result->>'right_revision'='0'
    and empty_result->'items'='[]'::jsonb
    and empty_result->>'has_more'='false'
    and empty_result->'next_cursor'='null'::jsonb
  );

  perform candidate_list_preview_test.expect(
    'all_operation_outputs_contain_no_sensitive_or_foreign_sentinel',
    not exists (
      select 1
        from (values
          (union_result),(intersection_result),(difference_result),
          (exclusion_result)
        ) preview(output)
       where output::text like '%PRIVATE-%'
          or output::text like '%private-sentinel%'
          or output::text like '%legitimate_interest%'
          or output::text like '%'||repeat('f',64)||'%'
          or output::text like '%'||repeat('e',64)||'%'
          or output::text like '%67f00000-0000-4000-8000-000000000001%'
          or output::text like '%67000000-0000-4000-8000-000000000001%'
          or output::text like '%67000000-0000-4000-8000-000000000005%'
          or output::text like '%67222222-2222-4222-8222-22222222222f%'
          or output::text like '%FOREIGN-PRIVATE-%'
          or output::text like '%foreign-private-%'
          or output::text like '%member_id%'
          or output::text like '%added_by%'
          or output::text like '%email%'
          or output::text like '%phone%'
          or output::text like '%provider%'
          or output::text like '%evidence%'
    )
  );
end
$behavior$;

-- C-order and traversal cursor correctness use exact ordered JSON.
do $pagination$
declare
  result jsonb;
  cursor_campaign text := null;
  cursor_candidate text := null;
  left_revision bigint := null;
  right_revision bigint := null;
  collected jsonb := '[]'::jsonb;
  iteration integer := 0;
  expected jsonb;
begin
  loop
    iteration := iteration+1;
    if iteration>20 then
      raise exception 'bounded C-order traversal exceeded hard iteration cap';
    end if;
    result := candidate_list_preview_test.preview_as(
      '67000000-0000-4000-8000-000000000002','authenticated',
      '67222222-2222-4222-8222-222222222224',left_revision,
      '67222222-2222-4222-8222-222222222223',right_revision,
      'union',cursor_campaign,cursor_candidate,1
    );
    left_revision := (result->>'left_revision')::bigint;
    right_revision := (result->>'right_revision')::bigint;
    collected := collected||(result->'items');
    exit when not (result->>'has_more')::boolean;
    if result->'next_cursor'='null'::jsonb then
      raise exception 'nonterminal traversal returned null cursor';
    end if;
    if cursor_campaign is not null and
       (result#>>'{next_cursor,campaign_id}',result#>>'{next_cursor,candidate_id}')
       <= (cursor_campaign,cursor_candidate) then
      raise exception 'traversal cursor did not strictly advance';
    end if;
    cursor_campaign := result#>>'{next_cursor,campaign_id}';
    cursor_candidate := result#>>'{next_cursor,candidate_id}';
  end loop;

  select jsonb_agg(jsonb_build_object(
    'campaign_id',member.campaign_id,
    'candidate_id',member.candidate_id,
    'relation','left',
    'disposition','included'
  ) order by member.campaign_id collate "C",member.candidate_id collate "C")
    into expected
    from public.candidate_list_members member
   where member.workspace_id='67111111-1111-4111-8111-111111111111'
     and member.list_id='67222222-2222-4222-8222-222222222224';

  perform candidate_list_preview_test.expect(
    'limit_one_c_order_traversal_has_no_duplicate_or_omission',
    collected=expected and iteration=6
  );
end
$pagination$;
SQL
}

run_bounded_traversal_and_explain_contract() {
psql_stdin --single-transaction -q <<'SQL'
\set ON_ERROR_STOP on

create function candidate_list_preview_test.explain_window(
  p_left uuid,p_right uuid,p_operation text,p_limit integer
) returns jsonb
language plpgsql
set search_path = pg_catalog,public,candidate_list_preview_test
as $$
declare
  plan_json jsonb;
begin
  execute format(
    'explain (analyze,buffers,format json)
       select *
         from public.candidate_list_set_preview_window(
           %L::uuid,%L::uuid,%L::uuid,%L::text,
           null::text,null::text,%s::integer
         )',
    '67111111-1111-4111-8111-111111111111',
    p_left,p_right,p_operation,p_limit
  ) into plan_json;
  return plan_json;
end
$$;

create function candidate_list_preview_test.plan_node_work(p_node jsonb)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select (
    coalesce((p_node->>'Actual Rows')::numeric,0)
    +coalesce((p_node->>'Rows Removed by Filter')::numeric,0)
    +coalesce((p_node->>'Rows Removed by Index Recheck')::numeric,0)
  )*coalesce((p_node->>'Actual Loops')::numeric,1);
$$;

create function candidate_list_preview_test.plan_is_bounded(
  p_plan jsonb,
  p_left_list uuid,
  p_right_list uuid,
  p_operation text,
  p_member_row_budget numeric,
  p_member_scan_row_cap numeric
) returns boolean
language sql
stable
set search_path = pg_catalog,candidate_list_preview_test
as $$
  with recursive nodes(node,ancestors) as (
    select p_plan->0->'Plan',array[]::jsonb[]
    union all
    select child.value,array_append(nodes.ancestors,nodes.node)
      from nodes
      cross join lateral jsonb_array_elements(
        coalesce(nodes.node->'Plans','[]'::jsonb)
      ) child(value)
  ), member_roots as (
    select node,ancestors
      from nodes
     where node->>'Relation Name'='candidate_list_members'
  ), member_work_nodes as (
    select node,ancestors from member_roots
    union all
    select candidate.node,candidate.ancestors
      from nodes candidate
     where candidate.node->>'Node Type'='Bitmap Index Scan'
       and exists (
         select 1
           from unnest(candidate.ancestors) ancestor(node)
          where ancestor.node->>'Node Type'='Bitmap Heap Scan'
            and ancestor.node->>'Relation Name'='candidate_list_members'
       )
  ), exact_right_probes as (
    select node,ancestors
      from member_roots
     where node->>'Node Type' in ('Index Scan','Index Only Scan')
       and strpos(coalesce(node->>'Index Cond',''),p_right_list::text)>0
       and strpos(coalesce(node->>'Index Cond',''),'workspace_id')>0
       and strpos(coalesce(node->>'Index Cond',''),'list_id')>0
       and strpos(coalesce(node->>'Index Cond',''),'campaign_id')>0
       and strpos(coalesce(node->>'Index Cond',''),'candidate_id')>0
  ), bounded_member_roots as (
    select member.node,member.ancestors
      from member_roots member
     where exists (
       select 1
         from unnest(member.ancestors) ancestor(node)
        where ancestor.node->>'Node Type'='Limit'
          and coalesce((ancestor.node->>'Plan Rows')::numeric,0)
              <=case when p_operation='union' then 202 else 101 end
          and candidate_list_preview_test.plan_node_work(ancestor.node)
              <=case when p_operation='union' then 202 else 101 end
     )
  ), member_expensive_nodes as (
    select candidate.node,candidate.ancestors
      from nodes candidate
     where (
       candidate.node->>'Node Type' in ('Sort','Hash','Hash Join')
       or (
         candidate.node->>'Node Type'='Aggregate'
         and candidate.node->>'Strategy'='Hashed'
       )
     )
       and exists (
         select 1
           from member_roots member
           cross join lateral unnest(member.ancestors) ancestor(node)
          where ancestor.node=candidate.node
       )
  )
  select
    (select count(*) from member_roots)=2
    and (select count(*) from bounded_member_roots)=2
    and not exists(
      select 1 from member_roots
       where node->>'Node Type' not in (
         'Index Scan','Index Only Scan','Bitmap Heap Scan'
       )
    )
    and coalesce((
      select sum(candidate_list_preview_test.plan_node_work(node))
        from member_work_nodes
    ),0)<=p_member_row_budget
    and not exists(
      select 1 from member_roots
       where candidate_list_preview_test.plan_node_work(node)
             >p_member_scan_row_cap
          or coalesce((node->>'Actual Loops')::numeric,1)>100
    )
    and not exists(
      select 1 from member_expensive_nodes expensive
       where not exists (
         select 1
           from unnest(expensive.ancestors) ancestor(node)
          where ancestor.node->>'Node Type'='Limit'
            and coalesce((ancestor.node->>'Plan Rows')::numeric,0)
                <=case when p_operation='union' then 202 else 101 end
            and candidate_list_preview_test.plan_node_work(ancestor.node)
                <=case when p_operation='union' then 202 else 101 end
       )
    )
    and case
      when p_operation='union' then
        (select count(*) from exact_right_probes)=0
        and (
          select count(*)=1 from member_roots
           where coalesce((node->>'Actual Loops')::numeric,1)=1
             and candidate_list_preview_test.plan_node_work(node)=101
             and strpos(coalesce(node->>'Index Cond',''),p_left_list::text)>0
             and strpos(coalesce(node->>'Index Cond',''),'workspace_id')>0
             and strpos(coalesce(node->>'Index Cond',''),'list_id')>0
        )
        and (
          select count(*)=1 from member_roots
           where coalesce((node->>'Actual Loops')::numeric,1)=1
             and candidate_list_preview_test.plan_node_work(node)=101
             and strpos(coalesce(node->>'Index Cond',''),p_right_list::text)>0
             and strpos(coalesce(node->>'Index Cond',''),'workspace_id')>0
             and strpos(coalesce(node->>'Index Cond',''),'list_id')>0
        )
      else
        (
          select count(*)=1 from member_roots
           where coalesce((node->>'Actual Loops')::numeric,1)=1
             and candidate_list_preview_test.plan_node_work(node)=101
             and strpos(coalesce(node->>'Index Cond',''),p_left_list::text)>0
             and strpos(coalesce(node->>'Index Cond',''),'workspace_id')>0
             and strpos(coalesce(node->>'Index Cond',''),'list_id')>0
        )
        and (
          select count(*)=1 from exact_right_probes
           where coalesce((node->>'Actual Loops')::numeric,0)=100
             and candidate_list_preview_test.plan_node_work(node)<=100
             and coalesce((node->>'Rows Removed by Filter')::numeric,0)=0
             and coalesce((node->>'Rows Removed by Index Recheck')::numeric,0)=0
        )
    end;
$$;

do $bounded$
declare
  first_result jsonb;
  second_result jsonb;
  terminal_result jsonb;
  difference_result jsonb;
  union_result jsonb;
  operation text;
  plan_json jsonb;
begin
  perform candidate_list_preview_test.expect(
    'left_driver_helper_has_100_consumed_plus_unclassified_lookahead',
    (
      select count(*)=101
         and count(*) filter(where not is_lookahead)=100
         and count(*) filter(
           where is_lookahead and not emit
             and relation is null and disposition is null
         )=1
         and bool_and(
           case when not is_lookahead
             then relation is not null and disposition is not null
             else true end
         )
        from public.candidate_list_set_preview_window(
          '67111111-1111-4111-8111-111111111111',
          '67222222-2222-4222-8222-222222222229',
          '67222222-2222-4222-8222-22222222222a',
          'intersection',null,null,100
        )
    )
  );

  first_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222229',1,
    '67222222-2222-4222-8222-22222222222a',1,
    'intersection',null,null,100
  );
  second_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222229',1,
    '67222222-2222-4222-8222-22222222222a',1,
    'intersection',
    first_result#>>'{next_cursor,campaign_id}',
    first_result#>>'{next_cursor,candidate_id}',100
  );
  terminal_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222229',1,
    '67222222-2222-4222-8222-22222222222a',1,
    'intersection','disjoint','left-09998',100
  );

  perform candidate_list_preview_test.expect(
    'disjoint_intersection_has_empty_nonterminal_advancing_windows',
    first_result->'items'='[]'::jsonb
    and first_result->>'has_more'='true'
    and first_result#>>'{next_cursor,candidate_id}'='left-00099'
    and second_result->'items'='[]'::jsonb
    and second_result->>'has_more'='true'
    and second_result#>>'{next_cursor,candidate_id}'='left-00199'
    and (
      second_result#>>'{next_cursor,campaign_id}',
      second_result#>>'{next_cursor,candidate_id}'
    )>(
      first_result#>>'{next_cursor,campaign_id}',
      first_result#>>'{next_cursor,candidate_id}'
    )
  );
  perform candidate_list_preview_test.expect(
    'terminal_sparse_window_is_empty_without_cursor',
    terminal_result->'items'='[]'::jsonb
    and terminal_result->>'has_more'='false'
    and terminal_result->'next_cursor'='null'::jsonb
  );

  difference_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-22222222222b',1,
    '67222222-2222-4222-8222-22222222222c',1,
    'difference',null,null,100
  );
  perform candidate_list_preview_test.expect(
    'identical_difference_is_bounded_empty_nonterminal_window',
    difference_result->'items'='[]'::jsonb
    and difference_result->>'has_more'='true'
    and difference_result#>>'{next_cursor,candidate_id}'='shared-00099'
  );

  union_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-22222222222d',1,
    '67222222-2222-4222-8222-22222222222e',1,
    'union',null,null,100
  );
  perform candidate_list_preview_test.expect(
    'interleaved_union_consumes_only_first_100_and_preserves_lookahead',
    jsonb_array_length(union_result->'items')=100
    and union_result->>'has_more'='true'
    and union_result#>>'{next_cursor,candidate_id}'='item-00099'
    and not exists (
      select 1 from jsonb_array_elements(union_result->'items') item
       where item->>'candidate_id'='item-00100'
    )
  );

  foreach operation in array array[
    'intersection','difference','exclusion'
  ] loop
    plan_json := candidate_list_preview_test.explain_window(
      (case operation
        when 'intersection' then '67222222-2222-4222-8222-222222222229'
        else '67222222-2222-4222-8222-22222222222b'
      end)::uuid,
      (case operation
        when 'intersection' then '67222222-2222-4222-8222-22222222222a'
        else '67222222-2222-4222-8222-22222222222c'
      end)::uuid,
      operation,100
    );
    perform candidate_list_preview_test.expect(
      'bounded_index_plan_'||operation,
      candidate_list_preview_test.plan_is_bounded(
        plan_json,
        (case operation
          when 'intersection' then '67222222-2222-4222-8222-222222222229'
          else '67222222-2222-4222-8222-22222222222b'
        end)::uuid,
        (case operation
          when 'intersection' then '67222222-2222-4222-8222-22222222222a'
          else '67222222-2222-4222-8222-22222222222c'
        end)::uuid,
        operation,201,101
      ),
      plan_json::text
    );
  end loop;

  plan_json := candidate_list_preview_test.explain_window(
    '67222222-2222-4222-8222-22222222222d',
    '67222222-2222-4222-8222-22222222222e',
    'union',100
  );
  perform candidate_list_preview_test.expect(
    'bounded_index_plan_union',
    candidate_list_preview_test.plan_is_bounded(
      plan_json,
      '67222222-2222-4222-8222-22222222222d',
      '67222222-2222-4222-8222-22222222222e',
      'union',202,101
    ),
    plan_json::text
  );
end
$bounded$;
SQL
}

run_revision_and_conflict_contract() {
psql_stdin --single-transaction -q <<'SQL'
\set ON_ERROR_STOP on

create function candidate_list_preview_test.expect_sqlstate(
  p_case_name text,p_statement text,p_expected text
) returns void
language plpgsql
set search_path = pg_catalog,public,candidate_list_preview_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
  end;
  perform candidate_list_preview_test.expect(
    p_case_name,caught=p_expected,
    format('sqlstate=%s expected=%s',coalesce(caught,'<none>'),p_expected)
  );
end
$$;

create function candidate_list_preview_test.expect_role_sqlstate(
  p_case_name text,p_role text,p_statement text,p_expected text
) returns void
language plpgsql
set search_path = pg_catalog,public,candidate_list_preview_test
as $$
declare
  caught text;
begin
  begin
    execute format('set local role %I',p_role);
    execute p_statement;
    execute 'reset role';
  exception when others then
    get stacked diagnostics caught=returned_sqlstate;
    execute 'reset role';
  end;
  perform candidate_list_preview_test.expect(
    p_case_name,caught=p_expected,
    format('sqlstate=%s expected=%s',coalesce(caught,'<none>'),p_expected)
  );
end
$$;

-- One mixed conflict/new statement consumes a non-empty transition table and
-- advances exactly once.
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_provider_attempt_id,evidence_sha256,
  evidence_recorded_at,added_by,added_at,member_id
) values
  (
    '67111111-1111-4111-8111-111111111111',
    '67222222-2222-4222-8222-222222222225',
    'concurrent','baseline','github_provider',null,
    '67f00000-0000-4000-8000-000000000010',repeat('1',64),
    '2026-07-26 11:00:00+00',
    '67000000-0000-4000-8000-000000000001',
    '2026-07-26 11:00:00+00',
    '67333333-3333-4333-8333-333333333340'
  ),
  (
    '67111111-1111-4111-8111-111111111111',
    '67222222-2222-4222-8222-222222222225',
    'concurrent','mixed-new','github_provider',null,
    '67f00000-0000-4000-8000-000000000011',repeat('2',64),
    '2026-07-26 11:00:00+00',
    '67000000-0000-4000-8000-000000000001',
    '2026-07-26 11:00:00+00',
    '67333333-3333-4333-8333-333333333341'
  )
on conflict(workspace_id,list_id,campaign_id,candidate_id) do nothing;

select candidate_list_preview_test.expect(
  'mixed_conflict_and_new_insert_advances_once',
  (
    select membership_revision=2 from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  )
);

-- Two successful statements inside this one transaction advance twice.
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,added_at,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222225',
  'concurrent','tx-one','github_provider',
  '67f00000-0000-4000-8000-000000000012',repeat('3',64),
  '2026-07-26 11:01:00+00','67000000-0000-4000-8000-000000000001',
  '2026-07-26 11:01:00+00','67333333-3333-4333-8333-333333333342'
);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,added_at,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222225',
  'concurrent','tx-two','github_provider',
  '67f00000-0000-4000-8000-000000000013',repeat('4',64),
  '2026-07-26 11:02:00+00','67000000-0000-4000-8000-000000000001',
  '2026-07-26 11:02:00+00','67333333-3333-4333-8333-333333333343'
);
select candidate_list_preview_test.expect(
  'two_statements_in_one_transaction_advance_twice',
  (
    select membership_revision=4 from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  )
);

select candidate_list_preview_test.expect_sqlstate(
  'member_update_remains_immutable',
  $statement$
    update public.candidate_list_members
       set evidence_sha256=repeat('9',64)
     where list_id='67222222-2222-4222-8222-222222222225'
       and campaign_id='concurrent' and candidate_id='baseline'
  $statement$,
  '55000'
);
select candidate_list_preview_test.expect_sqlstate(
  'owner_direct_revision_change_is_rejected',
  $statement$
    update public.candidate_lists
       set membership_revision=membership_revision+1
     where id='67222222-2222-4222-8222-222222222225'
  $statement$,
  '55000'
);
select candidate_list_preview_test.expect_role_sqlstate(
  'runtime_role_cannot_write_revision',
  'authenticated',
  $statement$
    update public.candidate_lists
       set membership_revision=5
     where id='67222222-2222-4222-8222-222222222225'
  $statement$,
  '42501'
);
select candidate_list_preview_test.expect_sqlstate(
  'truncate_is_refused',
  'truncate table public.candidate_list_members',
  '55000'
);
select candidate_list_preview_test.expect(
  'failed_update_truncate_and_direct_revision_leave_generation_unchanged',
  (
    select membership_revision=4 from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  )
);

-- Seed bigint max only by temporarily disabling the owner-only revision guard;
-- then prove the ordinary member path fails atomically rather than wrapping.
select format(
  'alter table public.candidate_lists disable trigger %I',trigger_row.tgname
)
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid='public.candidate_lists'::regclass
  and trigger_row.tgfoid=
    'public.guard_candidate_list_membership_revision()'::regprocedure
\gexec
update public.candidate_lists
   set membership_revision=9223372036854775807
 where id='67222222-2222-4222-8222-222222222225';
select format(
  'alter table public.candidate_lists enable trigger %I',trigger_row.tgname
)
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid='public.candidate_lists'::regclass
  and trigger_row.tgfoid=
    'public.guard_candidate_list_membership_revision()'::regprocedure
\gexec

select candidate_list_preview_test.expect_sqlstate(
  'bigint_revision_overflow_fails_atomically',
  $statement$
    insert into public.candidate_list_members(
      workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
      evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
      added_by,member_id
    ) values (
      '67111111-1111-4111-8111-111111111111',
      '67222222-2222-4222-8222-222222222225',
      'concurrent','overflow','github_provider',
      '67f00000-0000-4000-8000-000000000014',repeat('5',64),
      '2026-07-26 11:03:00+00',
      '67000000-0000-4000-8000-000000000001',
      '67333333-3333-4333-8333-333333333344'
    )
  $statement$,
  '22003'
);
select candidate_list_preview_test.expect(
  'overflow_did_not_insert_member_or_change_max_revision',
  not exists (
    select 1 from public.candidate_list_members
     where list_id='67222222-2222-4222-8222-222222222225'
       and candidate_id='overflow'
  ) and (
    select membership_revision=9223372036854775807
      from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  )
);

select format(
  'alter table public.candidate_lists disable trigger %I',trigger_row.tgname
)
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid='public.candidate_lists'::regclass
  and trigger_row.tgfoid=
    'public.guard_candidate_list_membership_revision()'::regprocedure
\gexec
update public.candidate_lists
   set membership_revision=4
 where id='67222222-2222-4222-8222-222222222225';
select format(
  'alter table public.candidate_lists enable trigger %I',trigger_row.tgname
)
from pg_catalog.pg_trigger trigger_row
where trigger_row.tgrelid='public.candidate_lists'::regclass
  and trigger_row.tgfoid=
    'public.guard_candidate_list_membership_revision()'::regprocedure
\gexec

do $foreign_list_precedence$
declare
  foreign_result jsonb;
begin
  foreign_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',0,
    '67222222-2222-4222-8222-22222222222f',0,
    'union',null,null,1
  );
  perform candidate_list_preview_test.expect(
    'both_lists_resolve_before_revision_comparison',
    foreign_result='{"status":"list_not_found"}'::jsonb
  );
end
$foreign_list_precedence$;
SQL

  # Page one, the member mutation, and the stale page call are deliberately
  # separate autocommit connections. This proves the revision conflict is
  # caused by a committed intervening mutation rather than same-transaction
  # command visibility.
  psql_stdin -q <<'SQL'
insert into candidate_list_preview_test.outputs(case_name,output)
values (
  'before_committed_add',
  candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',2,
    '67222222-2222-4222-8222-222222222222',1,
    'union',null,null,1
  )
);
SQL
  psql_stdin -q <<'SQL'
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222222',
  'campaign-new','committed-add','github_provider',
  '67f00000-0000-4000-8000-000000000015',repeat('6',64),
  '2026-07-26 11:04:00+00','67000000-0000-4000-8000-000000000001',
  '67333333-3333-4333-8333-333333333345'
);
SQL
  psql_stdin --single-transaction -q <<'SQL'
do $conflict$
declare
  prior jsonb;
  conflict_result jsonb;
begin
  select output into prior from candidate_list_preview_test.outputs
   where case_name='before_committed_add';
  conflict_result := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222221',
    (prior->>'left_revision')::bigint,
    '67222222-2222-4222-8222-222222222222',
    (prior->>'right_revision')::bigint,
    'union',
    prior#>>'{next_cursor,campaign_id}',
    prior#>>'{next_cursor,candidate_id}',1
  );
  perform candidate_list_preview_test.expect(
    'committed_add_makes_old_page_revision_conflict_exact',
    (
      select array_agg(key order by key)=array[
        'has_more','items','left_revision','next_cursor','operation',
        'restart_required','right_revision','status'
      ] from jsonb_object_keys(conflict_result) key
    )
    and conflict_result->>'status'='revision_conflict'
    and conflict_result->>'operation'='union'
    and conflict_result->>'left_revision'='2'
    and conflict_result->>'right_revision'='2'
    and conflict_result->'items'='[]'::jsonb
    and conflict_result->>'has_more'='false'
    and conflict_result->'next_cursor'='null'::jsonb
    and conflict_result->>'restart_required'='true'
  );
end
$conflict$;
SQL

# A transaction rollback must remove both the member and its nested revision.
before_revision="$(psql_stdin -Atq -c "
  select membership_revision from public.candidate_lists
   where id='67222222-2222-4222-8222-222222222225'
")"
psql_stdin -q <<'SQL'
begin;
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222225',
  'concurrent','rolled-back','github_provider',
  '67f00000-0000-4000-8000-000000000016',repeat('7',64),
  '2026-07-26 11:05:00+00','67000000-0000-4000-8000-000000000001',
  '67333333-3333-4333-8333-333333333346'
);
rollback;
SQL
after_revision="$(psql_stdin -Atq -c "
  select membership_revision from public.candidate_lists
   where id='67222222-2222-4222-8222-222222222225'
")"
rolled_back_present="$(psql_stdin -Atq -c "
  select exists(
    select 1 from public.candidate_list_members
     where list_id='67222222-2222-4222-8222-222222222225'
       and candidate_id='rolled-back'
  )::text
")"
if [[ "$before_revision" != "$after_revision" || "$rolled_back_present" != "false" ]]; then
  echo "candidate-list-set-preview-db: rolled-back member changed revision or survived" >&2
  exit 1
fi
}

wait_for_activity() {
  local application_name="$1"
  local expected_pattern="$2"
  local deadline=$((SECONDS + 15))
  local state
  while true; do
    state="$(psql_stdin -Atq -c "
      select coalesce(state,'')||'|'||coalesce(wait_event_type,'')||':'||
             coalesce(wait_event,'')
        from pg_catalog.pg_stat_activity
       where application_name='$application_name'
       order by backend_start desc
       limit 1
    ")"
    if [[ "$state" == $expected_pattern ]]; then
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "candidate-list-set-preview-db: $application_name did not reach $expected_pattern (state=$state)" >&2
      return 1
    fi
    sleep 0.1
  done
}

start_advisory_barrier() {
  barrier_application_name="$1"
  barrier_key="$2"
  barrier_log="$tmp_dir/$3.log"
  barrier_fifo="$tmp_dir/$3.sql"
  rm -f "$barrier_fifo"
  mkfifo "$barrier_fifo"
  PGAPPNAME="$barrier_application_name" psql_stdin -q \
    > "$barrier_log" 2>&1 < "$barrier_fifo" &
  add_holder_pid=$!
  exec 9>"$barrier_fifo"
  printf '\\set ON_ERROR_STOP on\nselect pg_advisory_lock(%s);\n' \
    "$barrier_key" >&9
  wait_for_activity "$barrier_application_name" "idle|Client:ClientRead"
}

release_advisory_barrier() {
  printf 'select 1/(pg_advisory_unlock(%s)::integer);\n\\q\n' \
    "$barrier_key" >&9
  exec 9>&-
  if ! wait "$add_holder_pid"; then
    cat "$barrier_log" >&2
    echo "candidate-list-set-preview-db: advisory barrier failed" >&2
    exit 1
  fi
  add_holder_pid=""
}

run_concurrency_and_cascade_contract() {
  local before_revision
  local after_revision

  before_revision="$(psql_stdin -Atq -c "
    select membership_revision from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  ")"

  start_advisory_barrier \
    "preview-concurrent-commit-barrier" 6700670101 \
    "concurrent-commit-barrier"
  PGAPPNAME=preview-concurrent-first \
    PGOPTIONS="-c lock_timeout=5000 -c statement_timeout=15000" \
    psql_stdin -q \
    > "$tmp_dir/concurrent-first.log" 2>&1 <<'SQL' &
begin;
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222225',
  'concurrent','commit-one','github_provider',
  '67f00000-0000-4000-8000-000000000020',repeat('8',64),
  '2026-07-26 11:10:00+00','67000000-0000-4000-8000-000000000001',
  '67333333-3333-4333-8333-333333333350'
);
select pg_advisory_lock(6700670101);
select pg_advisory_unlock(6700670101);
commit;
SQL
  first_writer_pid=$!
  wait_for_activity "preview-concurrent-first" "*|Lock:advisory"

  PGAPPNAME=preview-concurrent-second \
    PGOPTIONS="-c lock_timeout=5000 -c statement_timeout=15000" \
    psql_stdin -q \
    > "$tmp_dir/concurrent-second.log" 2>&1 <<'SQL' &
begin;
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222225',
  'concurrent','commit-two','github_provider',
  '67f00000-0000-4000-8000-000000000021',repeat('9',64),
  '2026-07-26 11:10:00+00','67000000-0000-4000-8000-000000000001',
  '67333333-3333-4333-8333-333333333351'
);
commit;
SQL
  second_writer_pid=$!
  wait_for_activity "preview-concurrent-second" "*|Lock:*"
  release_advisory_barrier
  if ! wait "$first_writer_pid"; then
    cat "$tmp_dir/concurrent-first.log" >&2
    echo "candidate-list-set-preview-db: first concurrent insert failed" >&2
    exit 1
  fi
  first_writer_pid=""
  if ! wait "$second_writer_pid"; then
    cat "$tmp_dir/concurrent-second.log" >&2
    echo "candidate-list-set-preview-db: second concurrent insert failed" >&2
    exit 1
  fi
  second_writer_pid=""

  after_revision="$(psql_stdin -Atq -c "
    select membership_revision from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  ")"
  if (( after_revision - before_revision != 2 )); then
    echo "candidate-list-set-preview-db: two concurrent commits lost a revision increment" >&2
    exit 1
  fi

  # Two statements touch the same lists in opposite input order. Sorted list
  # locking must let both commit without deadlock and increment each list twice.
  start_advisory_barrier \
    "preview-opposite-start-barrier" 6700670102 \
    "opposite-start-barrier"
  PGAPPNAME=preview-opposite-first \
    PGOPTIONS="-c lock_timeout=5000 -c statement_timeout=15000" \
    psql_stdin -q \
    > "$tmp_dir/opposite-first.log" 2>&1 <<'SQL' &
begin;
select pg_advisory_xact_lock_shared(6700670102);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222226','order','first-a','github_provider','67f00000-0000-4000-8000-000000000022',repeat('a',64),'2026-07-26 11:11:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333352'),
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222227','order','first-b','github_provider','67f00000-0000-4000-8000-000000000023',repeat('b',64),'2026-07-26 11:11:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333353');
commit;
SQL
  first_writer_pid=$!
  PGAPPNAME=preview-opposite-second \
    PGOPTIONS="-c lock_timeout=5000 -c statement_timeout=15000" \
    psql_stdin -q \
    > "$tmp_dir/opposite-second.log" 2>&1 <<'SQL' &
begin;
select pg_advisory_xact_lock_shared(6700670102);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222227','order','second-b','github_provider','67f00000-0000-4000-8000-000000000024',repeat('c',64),'2026-07-26 11:11:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333354'),
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222226','order','second-a','github_provider','67f00000-0000-4000-8000-000000000025',repeat('d',64),'2026-07-26 11:11:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333355');
commit;
SQL
  second_writer_pid=$!
  wait_for_activity "preview-opposite-first" "*|Lock:advisory"
  wait_for_activity "preview-opposite-second" "*|Lock:advisory"
  release_advisory_barrier
  if ! wait "$first_writer_pid"; then
    cat "$tmp_dir/opposite-first.log" >&2
    echo "candidate-list-set-preview-db: first opposite-order statement failed" >&2
    exit 1
  fi
  first_writer_pid=""
  if ! wait "$second_writer_pid"; then
    cat "$tmp_dir/opposite-second.log" >&2
    echo "candidate-list-set-preview-db: second opposite-order statement failed" >&2
    exit 1
  fi
  second_writer_pid=""

  opposite_revisions="$(psql_stdin -Atq -c "
    select string_agg(id::text||':'||membership_revision,',' order by id)
      from public.candidate_lists
     where id in (
       '67222222-2222-4222-8222-222222222226',
       '67222222-2222-4222-8222-222222222227'
     )
  ")"
  if [[ "$opposite_revisions" != \
    "67222222-2222-4222-8222-222222222226:2,67222222-2222-4222-8222-222222222227:2" ]]; then
    echo "candidate-list-set-preview-db: opposite-order statements did not advance both lists twice" >&2
    exit 1
  fi

  psql_stdin --single-transaction -q <<'SQL'
delete from public.candidate_list_members
 where list_id in (
   '67222222-2222-4222-8222-222222222226',
   '67222222-2222-4222-8222-222222222227'
 )
 and campaign_id='order';
select candidate_list_preview_test.expect(
  'one_multi_list_delete_advances_each_surviving_list_once',
  (
    select bool_and(membership_revision=3)
      from public.candidate_lists
     where id in (
       '67222222-2222-4222-8222-222222222226',
       '67222222-2222-4222-8222-222222222227'
     )
  )
);
SQL

  # Hold a mutation open after its member insert and nested revision update.
  # The preview must return the committed old generation without waiting.
  before_revision="$(psql_stdin -Atq -c "
    select membership_revision from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  ")"
  start_advisory_barrier \
    "preview-uncommitted-commit-barrier" 6700670103 \
    "uncommitted-commit-barrier"
  PGAPPNAME=preview-uncommitted-mutation \
    PGOPTIONS="-c lock_timeout=5000 -c statement_timeout=15000" \
    psql_stdin -q \
    > "$tmp_dir/uncommitted-mutation.log" 2>&1 <<'SQL' &
begin;
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values (
  '67111111-1111-4111-8111-111111111111',
  '67222222-2222-4222-8222-222222222225',
  'concurrent','uncommitted','github_provider',
  '67f00000-0000-4000-8000-000000000026',repeat('e',64),
  '2026-07-26 11:12:00+00','67000000-0000-4000-8000-000000000001',
  '67333333-3333-4333-8333-333333333356'
);
select pg_advisory_lock(6700670103);
select pg_advisory_unlock(6700670103);
commit;
SQL
  mutation_pid=$!
  wait_for_activity "preview-uncommitted-mutation" "*|Lock:advisory"

  PGOPTIONS="-c statement_timeout=3000" psql_stdin --single-transaction -q <<SQL
do \$coherent\$
declare
  output jsonb;
begin
  output := candidate_list_preview_test.preview_as(
    '67000000-0000-4000-8000-000000000002','authenticated',
    '67222222-2222-4222-8222-222222222225',$before_revision,
    '67222222-2222-4222-8222-222222222223',0,
    'union',null,null,100
  );
  perform candidate_list_preview_test.expect(
    'preview_during_uncommitted_mutation_observes_old_generation',
    output->>'status'='ok'
    and output->>'left_revision'='$before_revision'
    and not exists(
      select 1 from jsonb_array_elements(output->'items') item
       where item->>'candidate_id'='uncommitted'
    )
  );
end
\$coherent\$;
SQL
  release_advisory_barrier
  if ! wait "$mutation_pid"; then
    cat "$tmp_dir/uncommitted-mutation.log" >&2
    echo "candidate-list-set-preview-db: held mutation did not commit successfully" >&2
    exit 1
  fi
  mutation_pid=""
  after_revision="$(psql_stdin -Atq -c "
    select membership_revision from public.candidate_lists
     where id='67222222-2222-4222-8222-222222222225'
  ")"
  if (( after_revision - before_revision != 1 )) || \
     [[ "$(psql_stdin -Atq -c "
       select exists(
         select 1 from public.candidate_list_members
          where list_id='67222222-2222-4222-8222-222222222225'
            and campaign_id='concurrent'
            and candidate_id='uncommitted'
       )::text
     ")" != "true" ]]; then
    echo "candidate-list-set-preview-db: held mutation did not commit exactly once" >&2
    exit 1
  fi

  # Repeated previews are observational only.
  preview_fingerprint_before="$(data_fingerprint)"
  for _ in 1 2 3 4 5; do
    psql_stdin -Atq -c "
      select candidate_list_preview_test.preview_as(
        '67000000-0000-4000-8000-000000000002','authenticated',
        '67222222-2222-4222-8222-222222222221',
        (select membership_revision from public.candidate_lists
          where id='67222222-2222-4222-8222-222222222221'),
        '67222222-2222-4222-8222-222222222222',
        (select membership_revision from public.candidate_lists
          where id='67222222-2222-4222-8222-222222222222'),
        'union',null,null,100
      )
    " >/dev/null
  done
  if [[ "$(data_fingerprint)" != "$preview_fingerprint_before" ]]; then
    echo "candidate-list-set-preview-db: repeated previews changed durable authority" >&2
    exit 1
  fi

  # Cascades must succeed after the parent list/workspace disappears.
  psql_stdin --single-transaction -q <<'SQL'
delete from public.candidate_lists
 where id='67222222-2222-4222-8222-222222222228';
delete from public.workspaces
 where id='67111111-1111-4111-8111-111111111113';
select candidate_list_preview_test.expect(
  'list_and_workspace_cascades_succeed_after_parent_disappearance',
  not exists(
    select 1 from public.candidate_lists
     where id in (
       '67222222-2222-4222-8222-222222222228',
       '67222222-2222-4222-8222-222222222230'
     )
  )
  and not exists(
    select 1 from public.candidate_list_members
     where list_id in (
       '67222222-2222-4222-8222-222222222228',
       '67222222-2222-4222-8222-222222222230'
     )
  )
);
SQL
}

run_erasure_and_hold_contract() {
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

update public.workspace_state
   set state=jsonb_set(
     state,'{candidates}',
     state->'candidates'||'[
       {"campaignId":"erase-a","id":"erase-global","name":"Erase Global A","email":"erase-global@example.test"},
       {"campaignId":"erase-b","id":"erase-global","name":"Erase Global B","email":"erase-global@example.test"},
       {"campaignId":"hold-a","id":"hold-global","name":"Hold Global A","email":"hold-global@example.test"},
       {"campaignId":"hold-b","id":"hold-global","name":"Hold Global B","email":"hold-global@example.test"}
     ]'::jsonb
   )
 where workspace_id='67111111-1111-4111-8111-111111111111';

insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_provider_attempt_id,evidence_sha256,evidence_recorded_at,
  added_by,member_id
) values
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222226','erase-a','erase-global','github_provider','67f00000-0000-4000-8000-000000000030',repeat('1',64),'2026-07-26 11:20:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333360'),
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222227','erase-b','erase-global','github_provider','67f00000-0000-4000-8000-000000000031',repeat('2',64),'2026-07-26 11:20:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333361'),
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222226','hold-a','hold-global','github_provider','67f00000-0000-4000-8000-000000000032',repeat('3',64),'2026-07-26 11:20:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333362'),
  ('67111111-1111-4111-8111-111111111111','67222222-2222-4222-8222-222222222227','hold-b','hold-global','github_provider','67f00000-0000-4000-8000-000000000033',repeat('4',64),'2026-07-26 11:20:00+00','67000000-0000-4000-8000-000000000001','67333333-3333-4333-8333-333333333363');

create temporary table erasure_revision_before as
select id,membership_revision
  from public.candidate_lists
 where id in (
   '67222222-2222-4222-8222-222222222226',
   '67222222-2222-4222-8222-222222222227'
 );

begin;
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"67000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select set_config(
  'request.jwt.claim.sub','67000000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','service_role',true);
select public.request_candidate_erasure(
  '67111111-1111-4111-8111-111111111111',
  '67000000-0000-4000-8000-000000000001',
  'erase-a','erase-global',
  '67444444-4444-4444-8444-444444444440'
) as erasure_result \gset
reset role;
insert into candidate_list_preview_test.outputs(case_name,output)
values('global_erasure',:'erasure_result'::jsonb);
commit;

select candidate_list_preview_test.expect(
  'candidate_global_erasure_advances_each_surviving_list_once',
  (
    select output->>'status'='completed'
      from candidate_list_preview_test.outputs
     where case_name='global_erasure'
  )
  and not exists(
    select 1 from public.candidate_list_members
     where candidate_id='erase-global'
  )
  and not exists(
    select 1
      from public.candidate_lists list_record
      join erasure_revision_before before_state using(id)
     where list_record.membership_revision<>before_state.membership_revision+1
  )
  and exists(
    select 1 from public.candidate_erasure_requests request
     where request.request_key='67444444-4444-4444-8444-444444444440'
       and request.status='completed'
  )
);

create temporary table hold_revision_before as
select id,membership_revision
  from public.candidate_lists
 where id in (
   '67222222-2222-4222-8222-222222222226',
   '67222222-2222-4222-8222-222222222227'
 );

begin;
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"67000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select set_config(
  'request.jwt.claim.sub','67000000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','service_role',true);
select public.place_candidate_legal_hold(
  '67111111-1111-4111-8111-111111111111',
  '67000000-0000-4000-8000-000000000001',
  'hold-a','hold-global','LITIGATION','case:0067-hold',
  clock_timestamp()+interval '1 day'
) as hold_result \gset
select public.request_candidate_erasure(
  '67111111-1111-4111-8111-111111111111',
  '67000000-0000-4000-8000-000000000001',
  'hold-b','hold-global',
  '67444444-4444-4444-8444-444444444441'
) as blocked_result \gset
reset role;
insert into candidate_list_preview_test.outputs(case_name,output) values
  ('placed_hold',:'hold_result'::jsonb),
  ('blocked_erasure',:'blocked_result'::jsonb);
commit;

select candidate_list_preview_test.expect(
  'blocked_legal_hold_changes_no_member_or_revision',
  (
    select output->>'status'='blocked_legal_hold'
      from candidate_list_preview_test.outputs
     where case_name='blocked_erasure'
  )
  and (
    select count(*)=2 from public.candidate_list_members
     where candidate_id='hold-global'
  )
  and not exists(
    select 1
      from public.candidate_lists list_record
      join hold_revision_before before_state using(id)
     where list_record.membership_revision<>before_state.membership_revision
  )
);

begin;
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"67000000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select set_config(
  'request.jwt.claim.sub','67000000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','service_role',true);
select public.release_candidate_legal_hold(
  '67111111-1111-4111-8111-111111111111',
  '67000000-0000-4000-8000-000000000001',
  (:'hold_result'::jsonb->>'hold_id')::uuid,
  'case:0067-release'
) as release_result \gset
select public.request_candidate_erasure(
  '67111111-1111-4111-8111-111111111111',
  '67000000-0000-4000-8000-000000000001',
  'hold-b','hold-global',
  '67444444-4444-4444-8444-444444444441'
) as replay_result \gset
reset role;
insert into candidate_list_preview_test.outputs(case_name,output) values
  ('released_hold',:'release_result'::jsonb),
  ('replayed_erasure',:'replay_result'::jsonb);
commit;

select candidate_list_preview_test.expect(
  'released_hold_replay_completes_and_advances_each_list_once',
  (
    select output->>'status'='completed'
      from candidate_list_preview_test.outputs
     where case_name='replayed_erasure'
  )
  and not exists(
    select 1 from public.candidate_list_members
     where candidate_id='hold-global'
  )
  and not exists(
    select 1
      from public.candidate_lists list_record
      join hold_revision_before before_state using(id)
     where list_record.membership_revision<>before_state.membership_revision+1
  )
  and exists(
    select 1 from public.candidate_legal_holds hold
     where hold.id=(:'hold_result'::jsonb->>'hold_id')::uuid
       and hold.status='released'
  )
);
SQL
}

clone_database() {
  local destination="$1"
  local source_database="$2"
  psql_database template1 -q \
    -c "create database ${destination} template ${source_database}"
}

full_public_fingerprint() {
  local database="$1"
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint pg_dump \
    "$client_image" \
    -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d "$database" \
    --schema=public --no-owner \
    | sed -E '/^\\(un)?restrict[[:space:]]/d' \
    | shasum -a 256 | awk '{print $1}'
}

expect_0067_refusal_without_change() {
  local database="$1"
  local sql_file="$2"
  local case_name="$3"
  local before
  local after
  local log_file="$tmp_dir/${case_name}.log"

  before="$(full_public_fingerprint "$database")"
  if psql_database "$database" --single-transaction \
    --set VERBOSITY=verbose < "$sql_file" > "$log_file" 2>&1; then
    echo "candidate-list-set-preview-db: ${case_name} unexpectedly succeeded" >&2
    exit 1
  fi
  if ! grep -Eq 'ERROR:[[:space:]]+55000:' "$log_file"; then
    echo "candidate-list-set-preview-db: ${case_name} did not refuse with SQLSTATE 55000" >&2
    sed -n '1,80p' "$log_file" >&2
    exit 1
  fi
  after="$(full_public_fingerprint "$database")"
  if [[ "$after" != "$before" ]]; then
    echo "candidate-list-set-preview-db: ${case_name} changed public state before refusing" >&2
    exit 1
  fi
}

run_deployment_preflight_source_contract() {
  local deploy_source="docker/bootstrap/run.fly.sh"
  local preflight_block
  local migration_phase
  local preflight_call_line
  local migration_plan_line

  if [[ ! -f "$deploy_source" ]]; then
    echo "candidate-list-set-preview-db: deployment preflight source is absent" >&2
    exit 1
  fi

  preflight_block="$(awk '
    /^preflight_candidate_list_set_preview_0067\(\)/ { capture=1 }
    capture { print }
    capture && /^}/ { exit }
  ' "$deploy_source")"
  migration_phase="$(awk '
    /^run_migrations_phase\(\)/ { capture=1 }
    capture { print }
    capture && /^}/ { exit }
  ' "$deploy_source")"

  if [[ -z "$preflight_block" \
     || "$preflight_block" != *"begin transaction read only"* \
     || "$preflight_block" != *"public.aria_schema_migrations"* \
     || "$preflight_block" != *"0064_candidate_lists_authority.sql"* \
     || "$preflight_block" != *"0067_candidate_list_set_preview_authority.sql"* \
     || "$preflight_block" != *"public.candidate_list_members"* \
     || "$preflight_block" != *"count(*)"* \
     || ! "$preflight_block" =~ [Cc][Oo][Nn][Cc][Uu][Rr][Rr][Ee][Nn][Tt] ]]; then
    echo "candidate-list-set-preview-db: 0067 deploy preflight lacks the read-only live-table/index-build refusal contract" >&2
    exit 1
  fi

  preflight_call_line="$(printf '%s\n' "$migration_phase" \
    | grep -n 'preflight_candidate_list_set_preview_0067' \
    | tail -n 1 | cut -d: -f1 || true)"
  migration_plan_line="$(printf '%s\n' "$migration_phase" \
    | grep -n 'build_migration_plan' | head -n 1 | cut -d: -f1 || true)"
  if [[ -z "$preflight_call_line" || -z "$migration_plan_line" \
     || "$preflight_call_line" -ge "$migration_plan_line" ]]; then
    echo "candidate-list-set-preview-db: 0067 deploy preflight must run before the migration plan is built" >&2
    exit 1
  fi
}

run_migration_resilience_contract() {
  local suffix="${GITHUB_RUN_ID:-$$}_${GITHUB_RUN_ATTEMPT:-0}"
  local baseline_template="aria0067base_${suffix}"
  local accepted_template="aria0067accepted_${suffix}"
  local probe_database
  local before_legacy_data
  local after_legacy_data

  psql_stdin --single-transaction -q <<'SQL'
create schema candidate_list_preview_independent;
create table candidate_list_preview_independent.candidate_list_members(
  workspace_id uuid not null,
  list_id uuid not null,
  campaign_id text not null,
  candidate_id text not null
);
create index candidate_list_members_set_preview_idx
  on candidate_list_preview_independent.candidate_list_members(
    workspace_id,list_id,campaign_id,candidate_id
  );
create function candidate_list_preview_independent.preview_candidate_list_set(text)
returns text language sql immutable as $$ select $1 $$;
SQL

  before_legacy_data="$(legacy_data_fingerprint)"
  if [[ "$before_legacy_data" != "$pre_0067_legacy_data_fingerprint" ]]; then
    echo "candidate-list-set-preview-db: 0067 apply changed pre-0067 durable data" >&2
    exit 1
  fi

  psql_stdin --single-transaction -q < "$rollback"
  if [[ "$(schema_fingerprint)" != "$pre_0067_schema_fingerprint" \
     || "$(legacy_data_fingerprint)" != "$pre_0067_legacy_data_fingerprint" ]]; then
    echo "candidate-list-set-preview-db: ledgerless rollback did not restore exact pre-0067 fingerprints" >&2
    exit 1
  fi
  psql_stdin --single-transaction -q < "$rollback"
  if [[ "$(schema_fingerprint)" != "$pre_0067_schema_fingerprint" \
     || "$(legacy_data_fingerprint)" != "$pre_0067_legacy_data_fingerprint" ]]; then
    echo "candidate-list-set-preview-db: clean ledgerless rollback was not idempotent" >&2
    exit 1
  fi
  clone_database "$baseline_template" postgres

  psql_stdin --single-transaction -q < "$migration"
  if [[ "$(schema_fingerprint)" != "$post_0067_schema_fingerprint" \
     || "$(legacy_data_fingerprint)" != "$pre_0067_legacy_data_fingerprint" \
     || "$(psql_stdin -Atq -c "select not exists(
       select 1 from public.candidate_lists where membership_revision<>0
     )::text")" != "true" ]]; then
    echo "candidate-list-set-preview-db: rollback reapply did not restore exact 0067 authority" >&2
    exit 1
  fi
  if [[ "$(psql_stdin -Atq -c "select (
    to_regclass('candidate_list_preview_independent.candidate_list_members') is not null
    and to_regclass('candidate_list_preview_independent.candidate_list_members_set_preview_idx') is not null
    and to_regprocedure('candidate_list_preview_independent.preview_candidate_list_set(text)') is not null
  )::text")" != "true" ]]; then
    echo "candidate-list-set-preview-db: rollback or reapply removed similar-named independent objects" >&2
    exit 1
  fi
  clone_database "$accepted_template" postgres

  psql_database template1 -q -c 'create role aria_0067_acl_probe nologin'

  probe_database="aria0067_poison_column_${suffix}"
  clone_database "$probe_database" "$baseline_template"
  psql_database "$probe_database" -q <<'SQL'
alter table public.candidate_lists
  add column membership_revision text;
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-column"

  probe_database="aria0067_poison_index_${suffix}"
  clone_database "$probe_database" "$baseline_template"
  psql_database "$probe_database" -q <<'SQL'
create index candidate_list_members_set_preview_idx
  on public.candidate_list_members(
    workspace_id,list_id,
    candidate_id collate pg_catalog."C",
    campaign_id collate pg_catalog."C"
  );
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-index"

  probe_database="aria0067_poison_constraint_${suffix}"
  clone_database "$probe_database" "$baseline_template"
  psql_database "$probe_database" -q <<'SQL'
alter table public.candidate_lists
  add column membership_revision bigint not null default 0;
comment on column public.candidate_lists.membership_revision is
  'aria:candidate-list-set-preview-authority:0067';
alter table public.candidate_lists
  add constraint candidate_lists_membership_revision_nonnegative
  check (membership_revision >= -1);
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-constraint"

  probe_database="aria0067_poison_trigger_${suffix}"
  clone_database "$probe_database" "$baseline_template"
  psql_database "$probe_database" -q <<'SQL'
create trigger candidate_list_members_advance_revision_after_insert
after insert on public.candidate_list_members
referencing new table as inserted_rows
for each statement execute function public.cleanup_erased_candidate_lists();
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-trigger"

  probe_database="aria0067_poison_function_${suffix}"
  clone_database "$probe_database" "$baseline_template"
  psql_database "$probe_database" -q <<'SQL'
create function public.preview_candidate_list_set(
  uuid,bigint,uuid,bigint,text,text,text,integer
) returns jsonb
language sql immutable security invoker
as $$ select '{"status":"poison"}'::jsonb $$;
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-function"

  probe_database="aria0067_poison_overload_${suffix}"
  clone_database "$probe_database" "$accepted_template"
  psql_database "$probe_database" -q <<'SQL'
create function public.preview_candidate_list_set(
  uuid,bigint,uuid,bigint,text,text,text,integer,uuid
) returns jsonb
language sql stable security invoker
as $$ select '{"status":"poison-overload"}'::jsonb $$;
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-extra-overload"

  probe_database="aria0067_poison_acl_${suffix}"
  clone_database "$probe_database" "$accepted_template"
  psql_database "$probe_database" -q <<'SQL'
grant execute on function public.preview_candidate_list_set(
  uuid,bigint,uuid,bigint,text,text,text,integer
) to aria_0067_acl_probe;
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-custom-role-acl"

  probe_database="aria0067_poison_disabled_${suffix}"
  clone_database "$probe_database" "$accepted_template"
  psql_database "$probe_database" -q <<'SQL'
alter table public.candidate_list_members disable trigger
  candidate_list_members_advance_revision_after_delete;
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$migration" "poison-disabled-trigger"

  for ledger_sequence in 0067 0068; do
    probe_database="aria0067_ledger_${ledger_sequence}_${suffix}"
    clone_database "$probe_database" "$accepted_template"
    psql_database "$probe_database" -q -v ledger_sequence="$ledger_sequence" <<'SQL'
create table public.aria_schema_migrations(
  filename text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
insert into public.aria_schema_migrations(filename,sha256)
values (
  case :'ledger_sequence'
    when '0067' then '0067_candidate_list_set_preview_authority.sql'
    else '0068_synthetic_later_authority.sql'
  end,
  repeat('a',64)
);
SQL
    expect_0067_refusal_without_change \
      "$probe_database" "$rollback" "ledger-${ledger_sequence}-rollback"
  done

  probe_database="aria0067_marker_0068_${suffix}"
  clone_database "$probe_database" "$accepted_template"
  psql_database "$probe_database" -q <<'SQL'
comment on column public.candidate_lists.membership_revision is
  'aria:candidate-list-set-preview-authority:0068';
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$rollback" "marker-0068-rollback"

  probe_database="aria0067_markerless_partial_${suffix}"
  clone_database "$probe_database" "$baseline_template"
  psql_database "$probe_database" -q <<'SQL'
create index candidate_list_members_set_preview_idx
  on public.candidate_list_members(
    workspace_id,list_id,
    campaign_id collate pg_catalog."C",
    candidate_id collate pg_catalog."C"
  );
SQL
  expect_0067_refusal_without_change \
    "$probe_database" "$rollback" "markerless-partial-rollback"

  after_legacy_data="$(legacy_data_fingerprint)"
  if [[ "$after_legacy_data" != "$pre_0067_legacy_data_fingerprint" ]]; then
    echo "candidate-list-set-preview-db: resilience probes changed the primary database" >&2
    exit 1
  fi
}

run_real_add_rollback_lock_contract() {
  local before_timeout
  local after_timeout
  local after_writer_legacy_data
  local holder_ready="false"
  local waited_relation=""

  psql_stdin --single-transaction -q <<'SQL'
insert into public.candidate_lists(id,workspace_id,name,created_by) values (
  '67222222-2222-4222-8222-222222222240',
  '67111111-1111-4111-8111-111111111111',
  'Rollback lock-order list',
  '67000000-0000-4000-8000-000000000001'
);
SQL
  before_timeout="$(full_public_fingerprint postgres)"

  PGAPPNAME=aria-0067-real-add-holder psql_stdin -q \
    > "$tmp_dir/real-add-holder.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"67000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config(
  'request.jwt.claim.sub','67000000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','authenticated',true);
select public.add_candidate_list_member(
  '67222222-2222-4222-8222-222222222240',
  'legacy-campaign','legacy-candidate',
  '67999999-9999-4999-8999-999999999901'
);
select pg_sleep(12);
commit;
SQL
  add_holder_pid=$!

  for _ in $(seq 1 50); do
    if [[ "$(psql_stdin -Atq -c "select exists(
      select 1 from pg_catalog.pg_stat_activity
       where application_name='aria-0067-real-add-holder'
         and wait_event_type='Timeout' and wait_event='PgSleep'
    )::text")" == "true" ]]; then
      holder_ready="true"
      break
    fi
    sleep 0.1
  done
  if [[ "$holder_ready" != "true" ]]; then
    echo "candidate-list-set-preview-db: real add did not reach its paused post-write state" >&2
    exit 1
  fi

  (
    PGAPPNAME=aria-0067-rollback-timeout \
    PGOPTIONS='-c statement_timeout=1500ms' \
      psql_stdin --single-transaction --set VERBOSITY=verbose < "$rollback"
  ) > "$tmp_dir/rollback-timeout.log" 2>&1 &
  rollback_pid=$!

  for _ in $(seq 1 50); do
    waited_relation="$(psql_stdin -Atq -c "
      select coalesce((
        select relation_row.relname
          from pg_catalog.pg_locks waiting_lock
          join pg_catalog.pg_class relation_row
            on relation_row.oid=waiting_lock.relation
         where waiting_lock.pid=(
           select activity.pid
             from pg_catalog.pg_stat_activity activity
            where activity.application_name='aria-0067-rollback-timeout'
            limit 1
         )
           and waiting_lock.locktype='relation'
           and not waiting_lock.granted
         order by relation_row.relname
         limit 1
      ),'')
    ")"
    if [[ -n "$waited_relation" ]]; then
      break
    fi
    sleep 0.1
  done
  if [[ "$waited_relation" != "candidate_list_operation_receipts" ]]; then
    echo "candidate-list-set-preview-db: rollback first waited on ${waited_relation:-no relation}, not operation receipts" >&2
    exit 1
  fi
  if wait "$rollback_pid"; then
    echo "candidate-list-set-preview-db: rollback passed through a paused real add" >&2
    exit 1
  fi
  rollback_pid=""
  if ! grep -Eq 'ERROR:[[:space:]]+57014:|canceling statement due to statement timeout' \
    "$tmp_dir/rollback-timeout.log"; then
    echo "candidate-list-set-preview-db: blocked rollback did not end at its timeout" >&2
    exit 1
  fi
  after_timeout="$(full_public_fingerprint postgres)"
  if [[ "$after_timeout" != "$before_timeout" ]]; then
    echo "candidate-list-set-preview-db: timed-out rollback or uncommitted add leaked partial state" >&2
    exit 1
  fi

  wait "$add_holder_pid"
  add_holder_pid=""
  if ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"added"' \
    "$tmp_dir/real-add-holder.log"; then
    echo "candidate-list-set-preview-db: paused real add did not commit an added result" >&2
    sed -n '1,80p' "$tmp_dir/real-add-holder.log" >&2
    exit 1
  fi
  if [[ "$(psql_stdin -Atq -c "select (
    exists(select 1 from public.candidate_list_members
      where list_id='67222222-2222-4222-8222-222222222240'
        and campaign_id='legacy-campaign' and candidate_id='legacy-candidate')
    and exists(select 1 from public.candidate_list_operation_receipts
      where idempotency_key='67999999-9999-4999-8999-999999999901')
    and (select membership_revision=1 from public.candidate_lists
      where id='67222222-2222-4222-8222-222222222240')
  )::text")" != "true" ]]; then
    echo "candidate-list-set-preview-db: committed real add lacks member, receipt, or one revision" >&2
    exit 1
  fi

  after_writer_legacy_data="$(legacy_data_fingerprint)"
  psql_stdin --single-transaction -q < "$rollback"
  if [[ "$(schema_fingerprint)" != "$pre_0067_schema_fingerprint" \
     || "$(legacy_data_fingerprint)" != "$after_writer_legacy_data" ]]; then
    echo "candidate-list-set-preview-db: post-writer rollback did not preserve 0064-0066 data" >&2
    exit 1
  fi
  psql_stdin --single-transaction -q < "$migration"
  if [[ "$(schema_fingerprint)" != "$post_0067_schema_fingerprint" \
     || "$(legacy_data_fingerprint)" != "$after_writer_legacy_data" \
     || "$(psql_stdin -Atq -c "select not exists(
       select 1 from public.candidate_lists where membership_revision<>0
     )::text")" != "true" ]]; then
    echo "candidate-list-set-preview-db: post-writer reapply did not restore exact 0067 schema" >&2
    exit 1
  fi
}

record_migration_resilience_assertions() {
  psql_stdin --single-transaction -q <<'SQL'
select candidate_list_preview_test.expect(
  'ledgerless_rollback_restores_exact_0066_schema_and_data',true
);
select candidate_list_preview_test.expect(
  'ledgerless_clean_rollback_is_idempotent_and_reapply_is_exact',true
);
select candidate_list_preview_test.expect(
  'rollback_and_reapply_preserve_similar_named_independent_objects',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_poisoned_partial_column_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_poisoned_partial_index_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_poisoned_partial_constraint_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_poisoned_partial_trigger_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_poisoned_partial_function_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_poisoned_extra_overload_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_arbitrary_custom_role_acl_atomically',true
);
select candidate_list_preview_test.expect(
  'forward_refuses_disabled_revision_trigger_atomically',true
);
select candidate_list_preview_test.expect(
  'rollback_refuses_0067_and_later_ledgers_atomically',true
);
select candidate_list_preview_test.expect(
  'rollback_refuses_synthetic_0068_column_marker_atomically',true
);
select candidate_list_preview_test.expect(
  'rollback_refuses_markerless_partial_artifact_atomically',true
);
select candidate_list_preview_test.expect(
  'rollback_waits_receipts_first_and_timeout_changes_nothing',true
);
select candidate_list_preview_test.expect(
  'rollback_succeeds_after_real_add_and_preserves_committed_state',true
);
select candidate_list_preview_test.expect(
  'deployment_preflight_blocks_unmeasured_live_index_builds',true
);
SQL
}

run_deployment_preflight_source_contract
run_migration_resilience_contract
run_real_add_rollback_lock_contract
run_catalog_and_behavior_contract
record_migration_resilience_assertions
seed_preview_fixtures
run_preview_semantics_contract
run_bounded_traversal_and_explain_contract
run_revision_and_conflict_contract
run_concurrency_and_cascade_contract
run_erasure_and_hold_contract

failed_count="$(psql_stdin -Atq -c "
  select count(*) from candidate_list_preview_test.results where not passed
")"
assertion_count="$(psql_stdin -Atq -c "
  select count(*) from candidate_list_preview_test.results
")"
if [[ "$failed_count" != "0" ]]; then
  psql_stdin -P pager=off -c "
    select case_name,detail
      from candidate_list_preview_test.results
     where not passed
     order by case_name
  " >&2
  echo "candidate-list-set-preview-db: ${failed_count}/${assertion_count} assertions failed" >&2
  exit 1
fi
echo "candidate-list-set-preview-db: ${assertion_count} assertions, 0 failed"
