#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidates-corpus-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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
  psql_stdin -q < "$migration"
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema candidates_corpus_test;

create table candidates_corpus_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function candidates_corpus_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, candidates_corpus_test
as $$
begin
  insert into candidates_corpus_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function candidates_corpus_test.expect_scalar(
  p_case_name text,
  p_statement text,
  p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, candidates_corpus_test
as $$
declare
  actual text;
begin
  execute p_statement into actual;
  perform candidates_corpus_test.expect(
    p_case_name,
    actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function candidates_corpus_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, candidates_corpus_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform candidates_corpus_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform candidates_corpus_test.expect(
    p_case_name,
    false,
    'statement unexpectedly succeeded'
  );
end;
$$;

create function candidates_corpus_test.expect_authenticated_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, candidates_corpus_test
as $$
declare
  caught text;
begin
  begin
    execute 'set local role authenticated';
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    execute 'reset role';
    perform candidates_corpus_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  execute 'reset role';
  perform candidates_corpus_test.expect(
    p_case_name,
    false,
    'statement unexpectedly succeeded'
  );
end;
$$;

create function candidates_corpus_test.set_service_claims(subject uuid)
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

create function candidates_corpus_test.set_authenticated_claims(subject uuid)
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

grant usage on schema candidates_corpus_test to service_role;
grant execute on all functions in schema candidates_corpus_test to service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','corpus-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('b2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','corpus-admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id, name, allowed_domain) values
  ('41111111-1111-4111-8111-111111111111','Candidates Corpus A','corpus-a.example.test'),
  ('42222222-2222-4222-8222-222222222222','Candidates Corpus B','corpus-b.example.test');

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('b1000000-0000-4000-8000-000000000001','corpus-admin-a@example.test','Corpus Admin A','41111111-1111-4111-8111-111111111111','admin'),
  ('b2000000-0000-4000-8000-000000000002','corpus-admin-b@example.test','Corpus Admin B','42222222-2222-4222-8222-222222222222','admin');

insert into public.workspaces(id, name, allowed_domain) values
  ('43333333-3333-4333-8333-333333333333','Candidates Corpus Backfill','corpus-backfill.example.test');

insert into public.workspace_state(workspace_id, state) values (
  '43333333-3333-4333-8333-333333333333',
  '{
    "candidates":[
      {
        "id":"cand-backfill",
        "campaignId":"campaign-backfill",
        "name":"Blake Backfill",
        "email":"blake@example.test",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Backfill Co",
        "matchScore":64,
        "stage":"Sourced",
        "createdAt":"2026-07-16T09:00:00Z"
      }
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'
);

delete from public.candidates
 where workspace_id='43333333-3333-4333-8333-333333333333';

select * from public.backfill_candidates_corpus();

select candidates_corpus_test.expect_scalar(
  'backfill-simulation',
  $$select string_agg(id, ',' order by id)
      from public.candidates
     where workspace_id='43333333-3333-4333-8333-333333333333'$$,
  'cand-backfill'
);

create temporary table backfill_row_set as
select workspace_id, campaign_id, id, payload
  from public.candidates
 where workspace_id='43333333-3333-4333-8333-333333333333';

select * from public.backfill_candidates_corpus();

select candidates_corpus_test.expect_scalar(
  'backfill-row-set-idempotent',
  $$select count(*)::text
      from (
        (select workspace_id, campaign_id, id, payload
           from public.candidates
          where workspace_id='43333333-3333-4333-8333-333333333333'
         except
         select workspace_id, campaign_id, id, payload from backfill_row_set)
        union all
        (select workspace_id, campaign_id, id, payload from backfill_row_set
         except
         select workspace_id, campaign_id, id, payload
           from public.candidates
          where workspace_id='43333333-3333-4333-8333-333333333333')
      ) diff$$,
  '0'
);

select candidates_corpus_test.expect_authenticated_sqlstate(
  'helper-acl-authenticated-denied',
  $$select public.mirror_workspace_candidates('41111111-1111-4111-8111-111111111111', '{}'::jsonb)$$,
  array['42501']
);

insert into public.workspace_state(workspace_id, state) values (
  '41111111-1111-4111-8111-111111111111',
  '{
    "candidates":[
      {
        "id":"cand-a",
        "campaignId":"campaign-main",
        "name":"Ada Manual",
        "email":"ada@example.test",
        "phone":"+14155550111",
        "linkedinUrl":"https://linkedin.test/in/ada",
        "githubUrl":"https://github.test/ada",
        "sourceUrl":"https://github.test/ada",
        "sourceExternalId":"ada-provider",
        "sourceAuthorityId":"ada-authority",
        "sourcePlatform":"GitHub",
        "currentTitle":"Staff Engineer",
        "currentCompany":"Example A",
        "location":"Montreal",
        "matchScore":92,
        "stage":"Qualified",
        "yearsExperience":11,
        "provenance":"provider",
        "createdAt":"2026-07-16T10:00:00Z",
        "lastContactedAt":"2026-07-16T11:00:00Z",
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      },
      {
        "id":"cand-b",
        "campaignId":"campaign-main",
        "name":"Ben Live",
        "email":"ben@example.test",
        "phone":"",
        "linkedinUrl":"",
        "githubUrl":"",
        "sourceUrl":"",
        "sourceExternalId":"",
        "sourceAuthorityId":"",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Example B",
        "location":"Toronto",
        "matchScore":77,
        "stage":"Sourced",
        "yearsExperience":6,
        "provenance":"manual",
        "createdAt":"2026-07-16T10:05:00Z",
        "lastContactedAt":null,
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      }
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'
);

select candidates_corpus_test.expect_scalar(
  'insert-sync',
  $$select count(*)::text from public.candidates where workspace_id='41111111-1111-4111-8111-111111111111'$$,
  '2'
);

select candidates_corpus_test.expect_scalar(
  'populate',
  $$select concat_ws(':', email, current_title, match_score::text, years_experience::text, source_platform, payload->>'name')
      from public.candidates
     where workspace_id='41111111-1111-4111-8111-111111111111'
       and campaign_id='campaign-main'
       and id='cand-a'$$,
  'ada@example.test:Staff Engineer:92:11:GitHub:Ada Manual'
);

update public.workspace_state
   set state = jsonb_set(
     state,
     '{candidates}',
     (
       select jsonb_agg(candidate.value order by candidate.ordinality)
         from jsonb_array_elements(state->'candidates') with ordinality candidate(value, ordinality)
        where candidate.value->>'id' <> 'cand-b'
     ),
     false
   )
 where workspace_id='41111111-1111-4111-8111-111111111111';

select candidates_corpus_test.expect_scalar(
  'remove-one',
  $$select string_agg(id, ',' order by id) from public.candidates where workspace_id='41111111-1111-4111-8111-111111111111'$$,
  'cand-a'
);

update public.workspace_state
   set state = jsonb_set(state, '{candidates}', state->'candidates', false)
 where workspace_id='41111111-1111-4111-8111-111111111111';

select candidates_corpus_test.expect_scalar(
  'idempotent',
  $$select count(*)::text || ':' || count(distinct (campaign_id, id))::text
      from public.candidates
     where workspace_id='41111111-1111-4111-8111-111111111111'$$,
  '1:1'
);

update public.workspace_state
   set state = jsonb_set(
     state,
     '{candidates}',
     (state->'candidates') || '[
       {
        "id":"cand-b",
        "campaignId":"campaign-main",
        "name":"Ben Live",
        "email":"ben@example.test",
        "phone":"",
        "linkedinUrl":"",
        "githubUrl":"",
        "sourceUrl":"",
        "sourceExternalId":"",
        "sourceAuthorityId":"",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Example B",
        "location":"Toronto",
        "matchScore":77,
        "stage":"Sourced",
        "yearsExperience":6,
        "provenance":"manual",
        "createdAt":"2026-07-16T10:05:00Z",
        "lastContactedAt":null,
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
       }
     ]'::jsonb,
     false
   )
 where workspace_id='41111111-1111-4111-8111-111111111111';

create temporary table unchanged_probe as
select mirrored_at
  from public.candidates
 where workspace_id='41111111-1111-4111-8111-111111111111'
   and campaign_id='campaign-main'
   and id='cand-b';

update public.workspace_state
   set state = jsonb_set(state, '{settings}', '{"theme":"dark"}'::jsonb, true)
 where workspace_id='41111111-1111-4111-8111-111111111111';

select candidates_corpus_test.expect_scalar(
  'unchanged-skip',
  $$select (candidate.mirrored_at = probe.mirrored_at)::text
      from public.candidates candidate
      cross join unchanged_probe probe
     where candidate.workspace_id='41111111-1111-4111-8111-111111111111'
       and candidate.campaign_id='campaign-main'
       and candidate.id='cand-b'$$,
  'true'
);

set role service_role;
select candidates_corpus_test.set_service_claims('b1000000-0000-4000-8000-000000000001');
create temporary table manual_erasure_result as
select public.request_candidate_erasure(
  '41111111-1111-4111-8111-111111111111',
  'b1000000-0000-4000-8000-000000000001',
  'campaign-main',
  'cand-a',
  '61111111-1111-4111-8111-111111111111'
) result;
reset role;

select candidates_corpus_test.expect_scalar(
  'erase-manual_required',
  $$select (select result->>'status' from manual_erasure_result) || ':' ||
           (select count(*)::text from public.candidates
             where workspace_id='41111111-1111-4111-8111-111111111111'
               and campaign_id='campaign-main'
               and id='cand-a')$$,
  'manual_required:0'
);

update public.workspace_state
   set state = jsonb_set(
     state,
     '{candidates}',
     (
       select jsonb_agg(
         case when candidate.value->>'id' = 'cand-b'
           then jsonb_set(candidate.value, '{currentTitle}', '"Principal Engineer"'::jsonb, false)
           else candidate.value
         end
         order by candidate.ordinality
       )
       from jsonb_array_elements(state->'candidates') with ordinality candidate(value, ordinality)
     ),
     false
   )
 where workspace_id='41111111-1111-4111-8111-111111111111';

select candidates_corpus_test.expect_scalar(
  're-materialization-blocked',
  $$select (select count(*) from public.candidates
             where workspace_id='41111111-1111-4111-8111-111111111111'
               and campaign_id='campaign-main'
               and id='cand-a')::text || ':' ||
           (select current_title from public.candidates
             where workspace_id='41111111-1111-4111-8111-111111111111'
               and campaign_id='campaign-main'
               and id='cand-b')$$,
  '0:Principal Engineer'
);

update public.workspace_state
   set state = jsonb_set(
     state,
     '{candidates}',
     (state->'candidates') || '[
       {
        "id":"cand-pct",
        "campaignId":"campaign-main",
        "name":"Percent % Literal",
        "email":"percent@example.test",
        "sourcePlatform":"GitHub",
        "currentTitle":"Architect",
        "currentCompany":"Example Percent",
        "location":"Ottawa",
        "matchScore":88,
        "stage":"Qualified",
        "yearsExperience":9,
        "createdAt":"2026-07-16T12:00:00Z",
        "lastContactedAt":null
       },
       {
        "id":"cand-high",
        "campaignId":"campaign-main",
        "name":"High Match",
        "email":"high@example.test",
        "sourcePlatform":"Manual",
        "currentTitle":"Director",
        "currentCompany":"Example High",
        "location":"Vancouver",
        "matchScore":99,
        "stage":"Sourced",
        "yearsExperience":12,
        "createdAt":"2026-07-16T08:00:00Z",
        "lastContactedAt":null
       }
     ]'::jsonb,
     false
   )
 where workspace_id='41111111-1111-4111-8111-111111111111';

insert into public.workspace_state(workspace_id, state) values (
  '42222222-2222-4222-8222-222222222222',
  '{
    "candidates":[
      {
        "id":"cand-c",
        "campaignId":"campaign-completed",
        "name":"Cora Complete",
        "email":"",
        "phone":"",
        "linkedinUrl":"",
        "githubUrl":"",
        "sourceUrl":"",
        "sourceExternalId":"",
        "sourceAuthorityId":"",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Example C",
        "location":"Quebec",
        "matchScore":80,
        "stage":"Sourced",
        "yearsExperience":null,
        "provenance":"manual",
        "createdAt":"2026-07-16T10:10:00Z",
        "lastContactedAt":null,
        "complianceFlags":{"anonymized":false,"gdprExportRequested":false}
      }
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'
);

set role service_role;
select candidates_corpus_test.set_service_claims('b2000000-0000-4000-8000-000000000002');
create temporary table completed_erasure_result as
select public.request_candidate_erasure(
  '42222222-2222-4222-8222-222222222222',
  'b2000000-0000-4000-8000-000000000002',
  'campaign-completed',
  'cand-c',
  '62222222-2222-4222-8222-222222222222'
) result;
reset role;

select candidates_corpus_test.expect_scalar(
  'erase-completed',
  $$select (select result->>'status' from completed_erasure_result) || ':' ||
           (select count(*)::text from public.candidates
             where workspace_id='42222222-2222-4222-8222-222222222222'
               and campaign_id='campaign-completed'
               and id='cand-c')$$,
  'completed:0'
);

update public.workspace_state
   set state = jsonb_set(
     state,
     '{candidates}',
     (state->'candidates') || '[
       {
        "id":"cand-b-only",
        "campaignId":"campaign-b-only",
        "name":"Tenant B Only",
        "email":"tenant-b@example.test",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Tenant B",
        "location":"Quebec",
        "matchScore":70,
        "stage":"Sourced",
        "yearsExperience":null,
        "createdAt":"2026-07-16T13:00:00Z",
        "lastContactedAt":null
       }
     ]'::jsonb,
     false
   )
 where workspace_id='42222222-2222-4222-8222-222222222222';

select candidates_corpus_test.set_authenticated_claims('b1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table rpc_tenant_a_b_rows as
select * from public.list_workspace_candidates(p_campaign_id => 'campaign-b-only');
reset role;

select candidates_corpus_test.expect_scalar(
  'rpc-tenant-isolation',
  $$select count(*)::text from rpc_tenant_a_b_rows where payload is not null$$,
  '0'
);

select set_config('request.jwt.claims', '{}'::text, false);
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', '', false);
set role authenticated;
create temporary table rpc_null_uid_rows as
select * from public.list_workspace_candidates();
reset role;

select candidates_corpus_test.expect_scalar(
  'rpc-null-uid',
  $$select count(*)::text from rpc_null_uid_rows$$,
  '0'
);

select candidates_corpus_test.set_authenticated_claims('b1000000-0000-4000-8000-000000000001');
set role authenticated;
create temporary table rpc_source_rows as
select * from public.list_workspace_candidates(p_source => 'GitHub');
create temporary table rpc_match_rows as
select * from public.list_workspace_candidates(p_sort => 'match', p_limit => 3);
create temporary table rpc_recent_rows as
select * from public.list_workspace_candidates(p_sort => 'recent', p_limit => 3);
create temporary table rpc_page_rows as
select * from public.list_workspace_candidates(p_limit => 1, p_offset => 1);
create temporary table rpc_literal_percent_rows as
select * from public.list_workspace_candidates(p_search => '%');
reset role;

select candidates_corpus_test.expect_scalar(
  'rpc-source-filter',
  $$select string_agg(payload->>'id', ',' order by payload->>'id')
      from rpc_source_rows
     where payload is not null$$,
  'cand-pct'
);

select candidates_corpus_test.expect_scalar(
  'rpc-sort-match',
  $$select payload->>'id'
      from rpc_match_rows
     where payload is not null
     limit 1$$,
  'cand-high'
);

select candidates_corpus_test.expect_scalar(
  'rpc-sort-recent',
  $$select payload->>'id'
      from rpc_recent_rows
     where payload is not null
     limit 1$$,
  'cand-pct'
);

select candidates_corpus_test.expect_scalar(
  'rpc-limit-offset-total',
  $$select count(*)::text || ':' || max(total)::text
      from rpc_page_rows
     where payload is not null$$,
  '1:3'
);

select candidates_corpus_test.expect_scalar(
  'rpc-escaped-wildcard-search',
  $$select string_agg(payload->>'id', ',' order by payload->>'id')
      from rpc_literal_percent_rows
     where payload is not null$$,
  'cand-pct'
);

select candidates_corpus_test.expect_authenticated_sqlstate(
  'RLS',
  $$select count(*) from public.candidates$$,
  array['42501']
);

update public.workspace_state
   set state = '{"settings":{"legacy":true}}'::jsonb
 where workspace_id='41111111-1111-4111-8111-111111111111';

select candidates_corpus_test.expect_scalar(
  'malformed',
  $$select concat_ws(':', count(*)::text, string_agg(id, ',' order by id))
      from public.candidates
     where workspace_id='41111111-1111-4111-8111-111111111111'$$,
  '3:cand-b,cand-high,cand-pct'
);

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed
    from candidates_corpus_test.results
   where not passed;

  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details
      from candidates_corpus_test.results
     where not passed;
    raise exception 'candidates corpus DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from candidates_corpus_test.results")"
echo "candidates-corpus-db: post-0036 mirror, backfill, RPC, RLS, malformed: ${assertions} assertions, 0 failed"
