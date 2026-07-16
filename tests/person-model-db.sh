#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-person-model-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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
  case "$(basename "$migration")" in
    0037_*) continue ;;
  esac
  psql_stdin -q < "$migration"
done

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'd1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'person-backfill-admin@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
) on conflict (id) do nothing;

insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111','Person Backfill','person-backfill.example.test')
on conflict (id) do nothing;

insert into public.profiles(id, email, full_name, workspace_id, role) values (
  'd1000000-0000-4000-8000-000000000001',
  'person-backfill-admin@example.test',
  'Person Backfill Admin',
  '51111111-1111-4111-8111-111111111111',
  'admin'
) on conflict (workspace_id, id) do nothing;

insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
values ('51111111-1111-4111-8111-111111111111', gen_random_bytes(32))
on conflict (workspace_id) do nothing;

insert into public.workspace_state(workspace_id, state) values (
  '51111111-1111-4111-8111-111111111111',
  '{
    "candidates":[
      {
        "id":"pm-backfill",
        "campaignId":"campaign-backfill",
        "name":"Pat Backfill",
        "linkedinUrl":"https://linkedin.com/in/pat-backfill",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Backfill Co",
        "matchScore":70,
        "stage":"Sourced",
        "createdAt":"2026-07-16T09:00:00Z"
      }
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'
);
SQL

psql_stdin -q < supabase/migrations/0037_person_identity_model.sql

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

create function candidates_corpus_test.expect_service_sqlstate(
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
    execute 'set local role service_role';
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

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('d2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','person-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('d3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','person-admin-b@example.test','',now(),'{}','{}',now(),now())
on conflict (id) do nothing;

insert into public.workspaces(id, name, allowed_domain) values
  ('52222222-2222-4222-8222-222222222222','Person Model A','person-a.example.test'),
  ('53333333-3333-4333-8333-333333333333','Person Model B','person-b.example.test'),
  ('54444444-4444-4444-8444-444444444444','Person Retry','person-retry.example.test'),
  ('55555555-5555-4555-8555-555555555555','Person Erasure','person-erasure.example.test'),
  ('56666666-6666-4666-8666-666666666666','Person Bulk GC','person-bulk.example.test'),
  ('57777777-7777-4777-8777-777777777777','Person FK','person-fk.example.test')
on conflict (id) do nothing;

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('d2000000-0000-4000-8000-000000000002','person-admin-a@example.test','Person Admin A','52222222-2222-4222-8222-222222222222','admin'),
  ('d3000000-0000-4000-8000-000000000003','person-admin-b@example.test','Person Admin B','55555555-5555-4555-8555-555555555555','admin')
on conflict (workspace_id, id) do nothing;

insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
select workspace_id, gen_random_bytes(32)
from (values
  ('52222222-2222-4222-8222-222222222222'::uuid),
  ('53333333-3333-4333-8333-333333333333'::uuid),
  ('55555555-5555-4555-8555-555555555555'::uuid),
  ('56666666-6666-4666-8666-666666666666'::uuid),
  ('57777777-7777-4777-8777-777777777777'::uuid)
) seed(workspace_id)
on conflict (workspace_id) do nothing;

insert into public.candidates(
  workspace_id, campaign_id, id, email, linkedin_url, github_url, name, payload
) values
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-same-1',null,'https://linkedin.com/in/shared-human',null,'Same One','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-two','pm-same-2',null,'https://linkedin.com/in/shared-human',null,'Same Two','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-case-1',null,' HTTPS://LINKEDIN.COM/IN/CASE-MERGE ',null,'Case One','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-two','pm-case-2',null,'https://linkedin.com/in/case-merge',null,'Case Two','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-three','pm-case-variant',null,'linkedin.com/in/case-merge',null,'Case Variant','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-email-1','shared@example.test','https://linkedin.com/in/email-one',null,'Email One','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-two','pm-email-2','shared@example.test','https://linkedin.com/in/email-two',null,'Email Two','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-no-key',null,null,null,'No Key','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-company-1',null,'https://linkedin.com/company/acme',null,'Company One','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-two','pm-company-2',null,'https://linkedin.com/company/acme',null,'Company Two','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-github-only',null,null,'https://github.com/shared','Github Only','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-relink',null,'https://linkedin.com/in/relink-one',null,'Relink','{}'),
  ('52222222-2222-4222-8222-222222222222','campaign-one','pm-early',null,'https://linkedin.com/in/early-return',null,'Early','{}'),
  ('53333333-3333-4333-8333-333333333333','campaign-one','pm-tenant',null,'https://linkedin.com/in/shared-human',null,'Tenant','{}');

select candidates_corpus_test.expect_scalar(
  'person-01-same-linkedin-one-person',
  $$select count(distinct person_id)::text
      from public.candidates
     where workspace_id='52222222-2222-4222-8222-222222222222'
       and id in ('pm-same-1','pm-same-2')$$,
  '1'
);

select candidates_corpus_test.expect_scalar(
  'person-02-case-whitespace-merge',
  $$select (a.person_id = b.person_id)::text
      from public.candidates a
      join public.candidates b on b.workspace_id=a.workspace_id
     where a.id='pm-case-1' and b.id='pm-case-2'
       and a.workspace_id='52222222-2222-4222-8222-222222222222'$$,
  'true'
);

select candidates_corpus_test.expect_scalar(
  'person-02-url-form-variant-distinct',
  $$select (a.person_id is distinct from b.person_id)::text
      from public.candidates a
      join public.candidates b on b.workspace_id=a.workspace_id
     where a.id='pm-case-1' and b.id='pm-case-variant'
       and a.workspace_id='52222222-2222-4222-8222-222222222222'$$,
  'true'
);

select candidates_corpus_test.expect_scalar(
  'person-03-email-shared-no-false-merge',
  $$select count(distinct person_id)::text || ':' || count(distinct email)::text
      from public.candidates
     where workspace_id='52222222-2222-4222-8222-222222222222'
       and id in ('pm-email-1','pm-email-2')$$,
  '2:1'
);

select candidates_corpus_test.expect_scalar(
  'person-04-no-key-null',
  $$select (person_id is null)::text
      from public.candidates
     where workspace_id='52222222-2222-4222-8222-222222222222'
       and id='pm-no-key'$$,
  'true'
);

select candidates_corpus_test.expect_scalar(
  'person-05-company-page-excluded',
  $$select count(*)::text || ':' || count(person_id)::text
      from public.candidates
     where workspace_id='52222222-2222-4222-8222-222222222222'
       and id in ('pm-company-1','pm-company-2')$$,
  '2:0'
);

select candidates_corpus_test.expect_scalar(
  'person-06-github-excluded',
  $$select (person_id is null)::text
      from public.candidates
     where workspace_id='52222222-2222-4222-8222-222222222222'
       and id='pm-github-only'$$,
  'true'
);

create temporary table relink_before as
select person_id
  from public.candidates
 where workspace_id='52222222-2222-4222-8222-222222222222'
   and id='pm-relink';

update public.candidates
   set linkedin_url='https://linkedin.com/in/relink-two'
 where workspace_id='52222222-2222-4222-8222-222222222222'
   and id='pm-relink';

select candidates_corpus_test.expect_scalar(
  'person-07-update-relink',
  $$select (before.person_id is distinct from candidate.person_id)::text || ':' ||
           (select count(*)::text from public.candidate_identities
             where workspace_id='52222222-2222-4222-8222-222222222222'
               and value_normalized='https://linkedin.com/in/relink-one')
      from public.candidates candidate
      cross join relink_before before
     where candidate.workspace_id='52222222-2222-4222-8222-222222222222'
       and candidate.id='pm-relink'$$,
  'true:0'
);

insert into public.candidates(
  workspace_id, campaign_id, id, linkedin_url, name, payload
) values (
  '54444444-4444-4444-8444-444444444444',
  'campaign-one',
  'pm-retry',
  'https://linkedin.com/in/retry-later',
  'Retry Later',
  '{}'
);

-- A fresh workspace has no tombstones and no secret; a valid profile linkedin must LINK IMMEDIATELY
-- (the tombstone-skip is guarded so the HMAC helper is never called when no tombstones exist).
select candidates_corpus_test.expect_scalar(
  'person-08-fresh-workspace-links-without-secret',
  $$select (person_id is not null)::text
      from public.candidates
     where workspace_id='54444444-4444-4444-8444-444444444444'
       and id='pm-retry'$$,
  'true'
);

-- Unchanged-retry: force an unlinked state (as if a prior best-effort attempt missed), then re-touch
-- the SAME linkedin — the early-return only skips when already linked, so an unlinked row RE-LINKS.
update public.candidates set person_id = null
 where workspace_id='54444444-4444-4444-8444-444444444444' and id='pm-retry';
update public.candidates set linkedin_url = linkedin_url
 where workspace_id='54444444-4444-4444-8444-444444444444' and id='pm-retry';

select candidates_corpus_test.expect_scalar(
  'person-08-unchanged-unlinked-retries',
  $$select (person_id is not null)::text
      from public.candidates
     where workspace_id='54444444-4444-4444-8444-444444444444'
       and id='pm-retry'$$,
  'true'
);

create temporary table early_before as
select person_id,
       (select count(*) from public.persons
         where workspace_id='52222222-2222-4222-8222-222222222222') as person_count,
       (select count(*) from public.candidate_identities
         where workspace_id='52222222-2222-4222-8222-222222222222') as identity_count
  from public.candidates
 where workspace_id='52222222-2222-4222-8222-222222222222'
   and id='pm-early';

update public.candidates
   set linkedin_url = linkedin_url
 where workspace_id='52222222-2222-4222-8222-222222222222'
   and id='pm-early';

select candidates_corpus_test.expect_scalar(
  'person-09-linked-unchanged-early-return',
  $$select (before.person_id = candidate.person_id)::text || ':' ||
           (before.person_count = (select count(*) from public.persons
             where workspace_id='52222222-2222-4222-8222-222222222222'))::text || ':' ||
           (before.identity_count = (select count(*) from public.candidate_identities
             where workspace_id='52222222-2222-4222-8222-222222222222'))::text
      from public.candidates candidate
      cross join early_before before
     where candidate.workspace_id='52222222-2222-4222-8222-222222222222'
       and candidate.id='pm-early'$$,
  'true:true:true'
);

select candidates_corpus_test.expect_scalar(
  'person-10-tenant-isolation',
  $$select (a.person_id is distinct from b.person_id)::text
      from public.candidates a
      join public.candidates b on b.id='pm-tenant'
     where a.workspace_id='52222222-2222-4222-8222-222222222222'
       and a.id='pm-same-1'
       and b.workspace_id='53333333-3333-4333-8333-333333333333'$$,
  'true'
);

insert into public.workspace_state(workspace_id, state) values (
  '55555555-5555-4555-8555-555555555555',
  '{
    "candidates":[
      {
        "id":"pm-erase-x",
        "campaignId":"campaign-erase",
        "name":"Erase X",
        "linkedinUrl":"https://linkedin.com/in/erase-shared",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Erase Co",
        "stage":"Sourced",
        "createdAt":"2026-07-16T09:00:00Z"
      },
      {
        "id":"pm-erase-y",
        "campaignId":"campaign-erase",
        "name":"Erase Y",
        "linkedinUrl":"https://linkedin.com/in/erase-y-own",
        "sourcePlatform":"Manual",
        "currentTitle":"Engineer",
        "currentCompany":"Erase Co",
        "stage":"Sourced",
        "createdAt":"2026-07-16T09:01:00Z"
      }
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'
);

set role service_role;
select candidates_corpus_test.set_service_claims('d3000000-0000-4000-8000-000000000003');
create temporary table person_erasure_x_result as
select public.request_candidate_erasure(
  '55555555-5555-4555-8555-555555555555',
  'd3000000-0000-4000-8000-000000000003',
  'campaign-erase',
  'pm-erase-x',
  '65555555-5555-4555-8555-555555555551'
) result;
reset role;

-- NOTE: 0033 STRUCTURALLY BLOCKS erasing a candidate whose linkedin is shared by a surviving
-- candidate (proven by person-11b below). So no tombstone-insert purge is needed/implemented in 0037;
-- pm-erase-x/y use DISTINCT linkedins, testing the achievable path: a valid erasure deletes erase-x's
-- candidacy → the statement-level delete-GC removes its now-orphaned identity + person; the unrelated
-- pm-erase-y + its person are untouched.
select candidates_corpus_test.expect(
  'person-11-erasure-deletegc-cleanup',
  (select result->>'status' in ('completed','manual_required') from person_erasure_x_result)
  and (select count(*) = 0
         from public.candidates
        where workspace_id='55555555-5555-4555-8555-555555555555'
          and id='pm-erase-x')
  and (select count(*) = 0
         from public.candidate_identities
        where workspace_id='55555555-5555-4555-8555-555555555555'
          and value_normalized='https://linkedin.com/in/erase-shared')
  and (select person_id is not null
         from public.candidates
        where workspace_id='55555555-5555-4555-8555-555555555555'
          and id='pm-erase-y')
  and (select count(*) = 1
         from public.candidate_identities
        where workspace_id='55555555-5555-4555-8555-555555555555'
          and value_normalized='https://linkedin.com/in/erase-y-own'),
  null
);

-- person-12: 0037's linkage tombstone-SKIP in isolation. (0033 blocks a tombstoned identifier from
-- re-entering workspace_state, so the reachable-via-blob reentry never happens; this directly inserts
-- a candidacy carrying the tombstoned 'erase-shared' value — as the table owner, bypassing 0033 — to
-- prove the 0037 linkage trigger SKIPS a tombstoned key: person_id stays null and no identity forms.)
insert into public.candidates (workspace_id, campaign_id, id, linkedin_url, name, payload)
values ('55555555-5555-4555-8555-555555555555','campaign-erase','pm-tombstone-reentry',
        'https://linkedin.com/in/erase-shared','Tombstone Reentry','{}'::jsonb);

select candidates_corpus_test.expect_scalar(
  'person-12-tombstone-skip-defense',
  $$select ((select person_id is null from public.candidates
              where workspace_id='55555555-5555-4555-8555-555555555555' and id='pm-tombstone-reentry')
            and (select count(*)=0 from public.candidate_identities
                  where workspace_id='55555555-5555-4555-8555-555555555555'
                    and value_normalized='https://linkedin.com/in/erase-shared'))::text$$,
  'true'
);

set role service_role;
select candidates_corpus_test.set_service_claims('d3000000-0000-4000-8000-000000000003');
create temporary table person_erasure_y_result as
select public.request_candidate_erasure(
  '55555555-5555-4555-8555-555555555555',
  'd3000000-0000-4000-8000-000000000003',
  'campaign-erase',
  'pm-erase-y',
  '65555555-5555-4555-8555-555555555552'
) result;
reset role;

select candidates_corpus_test.expect(
  'person-11-erasure-final-person-gone',
  (select result->>'status' in ('completed','manual_required') from person_erasure_y_result)
  and (select count(*) = 0
         from public.candidates
        where workspace_id='55555555-5555-4555-8555-555555555555'
          and id='pm-erase-y')
  and (select count(*) = 0
         from public.persons
        where workspace_id='55555555-5555-4555-8555-555555555555'),
  null
);

-- person-11b: PROVE the premise that makes a tombstone-insert purge unnecessary — 0033 rejects
-- erasing a candidate whose linkedin a SURVIVING candidate still carries (the scrubbed-state write
-- reintroduces the just-tombstoned identifier → reject_candidate_erasure_reimport raises 23514).
update public.workspace_state
   set state = '{"candidates":[
     {"id":"pm-block-x","campaignId":"campaign-shared-block","name":"Block X",
      "linkedinUrl":"https://linkedin.com/in/block-shared","sourcePlatform":"Manual",
      "currentTitle":"Eng","currentCompany":"Block Co","stage":"Sourced","createdAt":"2026-07-16T08:00:00Z"},
     {"id":"pm-block-y","campaignId":"campaign-shared-block","name":"Block Y",
      "linkedinUrl":"https://linkedin.com/in/block-shared","sourcePlatform":"Manual",
      "currentTitle":"Eng","currentCompany":"Block Co","stage":"Sourced","createdAt":"2026-07-16T08:01:00Z"}
   ],"activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
   "ledger":[],"suppression":[],"campaigns":[],"chats":[],
   "ingestedMessageIds":[],"chatboxSubmissions":[]}'::jsonb
 where workspace_id='55555555-5555-4555-8555-555555555555';

select candidates_corpus_test.set_service_claims('d3000000-0000-4000-8000-000000000003');
select candidates_corpus_test.expect_service_sqlstate(
  'person-11b-shared-linkedin-erasure-blocked-by-0033',
  $$select public.request_candidate_erasure(
      '55555555-5555-4555-8555-555555555555',
      'd3000000-0000-4000-8000-000000000003',
      'campaign-shared-block',
      'pm-block-x',
      '65555555-5555-4555-8555-555555555553')$$,
  array['23514']
);

insert into public.candidates(
  workspace_id, campaign_id, id, linkedin_url, name, payload
) values
  ('56666666-6666-4666-8666-666666666666','campaign-one','pm-bulk-keep','https://linkedin.com/in/bulk-keep','Bulk Keep','{}'),
  ('56666666-6666-4666-8666-666666666666','campaign-one','pm-bulk-gone-1','https://linkedin.com/in/bulk-gone-1','Bulk Gone 1','{}'),
  ('56666666-6666-4666-8666-666666666666','campaign-one','pm-bulk-gone-2','https://linkedin.com/in/bulk-gone-2','Bulk Gone 2','{}');

delete from public.candidates
 where workspace_id='56666666-6666-4666-8666-666666666666'
   and id in ('pm-bulk-gone-1','pm-bulk-gone-2');

select candidates_corpus_test.expect_scalar(
  'person-13-bulk-delete-gc',
  $$select (select count(*) from public.candidates
             where workspace_id='56666666-6666-4666-8666-666666666666')::text || ':' ||
           (select count(*) from public.persons
             where workspace_id='56666666-6666-4666-8666-666666666666')::text || ':' ||
           (select string_agg(value_normalized, ',' order by value_normalized)
              from public.candidate_identities
             where workspace_id='56666666-6666-4666-8666-666666666666')$$,
  '1:1:https://linkedin.com/in/bulk-keep'
);

insert into public.candidates(
  workspace_id, campaign_id, id, linkedin_url, name, payload
) values (
  '57777777-7777-4777-8777-777777777777',
  'campaign-one',
  'pm-fk-null',
  'https://linkedin.com/in/fk-null',
  'FK Null',
  '{}'
);

delete from public.persons
 where workspace_id='57777777-7777-4777-8777-777777777777';

select candidates_corpus_test.expect_scalar(
  'person-14-fk-set-null',
  $$select (person_id is null)::text
      from public.candidates
     where workspace_id='57777777-7777-4777-8777-777777777777'
       and id='pm-fk-null'$$,
  'true'
);

select candidates_corpus_test.expect_scalar(
  'person-15-one-shot-backfill',
  $$select (candidate.person_id is not null)::text || ':' || identity.value_normalized
      from public.candidates candidate
      join public.candidate_identities identity
        on identity.workspace_id = candidate.workspace_id
       and identity.person_id = candidate.person_id
     where candidate.workspace_id='51111111-1111-4111-8111-111111111111'
       and candidate.id='pm-backfill'$$,
  'true:https://linkedin.com/in/pat-backfill'
);

select candidates_corpus_test.expect_authenticated_sqlstate(
  'person-16-rls-persons',
  $$select count(*) from public.persons$$,
  array['42501']
);

select candidates_corpus_test.expect_authenticated_sqlstate(
  'person-16-helper-authenticated-denied',
  $$select * from public.backfill_candidate_person_identities()$$,
  array['42501']
);

select candidates_corpus_test.expect_service_sqlstate(
  'person-16-helper-service-denied',
  $$select * from public.backfill_candidate_person_identities()$$,
  array['42501']
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
    raise exception 'person model DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from candidates_corpus_test.results")"
echo "person-model-db: 0037 person model plus corpus regression: ${assertions} assertions, 0 failed"
