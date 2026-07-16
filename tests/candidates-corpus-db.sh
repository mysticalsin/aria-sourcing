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
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin -q < "$migration"
done

# Re-apply the new migration to prove the DDL is replay-safe in the same style
# as the existing disposable database gates.
psql_stdin -q < supabase/migrations/0035_candidate_corpus_mirror.sql

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

select candidates_corpus_test.expect_sqlstate(
  'RLS',
  $$set local role authenticated; select count(*) from public.candidates$$,
  array['42501']
);

update public.workspace_state
   set state = '{"settings":{"legacy":true}}'::jsonb
 where workspace_id='41111111-1111-4111-8111-111111111111';

select candidates_corpus_test.expect_scalar(
  'malformed',
  $$select concat_ws(':', count(*)::text, max(current_title))
      from public.candidates
     where workspace_id='41111111-1111-4111-8111-111111111111'$$,
  '1:Principal Engineer'
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

echo "candidates-corpus-db: insert-sync populate remove-one idempotent unchanged-skip erase(manual_required+completed) re-materialization-blocked RLS malformed: 9 scenarios, 10 assertions, 0 failed"
