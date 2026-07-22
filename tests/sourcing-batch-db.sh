#!/usr/bin/env bash
# Disposable-Postgres proof for 0054 deterministic sourcing-batch authority.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-sourcing-batch-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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

create schema sb_test;
create table sb_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table sb_test.context (
  key text primary key,
  value jsonb not null
);

create function sb_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, sb_test
as $$
begin
  insert into sb_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function sb_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, sb_test
as $$
declare caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform sb_test.expect(
      p_case_name,
      caught = any(p_expected),
      format('sqlstate=%s expected=%s', caught, p_expected::text)
    );
    return;
  end;
  perform sb_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function sb_test.set_claims(p_role text, p_subject uuid default null)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_subject, 'role', p_role)::text,
    false
  );
  perform set_config('request.jwt.claim.sub', coalesce(p_subject::text, ''), false);
  perform set_config('request.jwt.claim.role', p_role, false);
end;
$$;

create function sb_test.query_fixture(p_batch_ordinal integer default 0)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  query_value text := 'language:go type:user';
  provider_page integer := p_batch_ordinal + 1;
  query_identity text;
begin
  query_identity := 'github-deterministic-v2' || E'\n'
    || query_value || E'\npage:' || provider_page::text;
  return jsonb_build_object(
    'policyVersion', 'github-deterministic-v2',
    'value', query_value,
    'page', provider_page,
    'sha256', encode(sha256(convert_to(query_identity, 'UTF8')), 'hex')
  );
end;
$$;

create function sb_test.candidate_fixture(
  p_external_id text,
  p_login text,
  p_display_name text,
  p_raw_response_sha256 text,
  p_search_result_ordinal integer default 0
) returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  campaign_id constant text := '90000000-0000-4000-8000-000000000001';
  workspace_id constant text := '51111111-1111-4111-8111-111111111111';
  github_url text := 'https://github.com/' || p_login;
  normalized_payload text;
  normalized_sha text;
  candidate_id text;
begin
  normalized_payload := '{"externalId":' || to_json(p_external_id)::text
    || ',"login":' || to_json(p_login)::text
    || ',"displayName":' || to_json(p_display_name)::text
    || ',"company":"Observed Company"'
    || ',"location":"Toronto"'
    || ',"bio":"Builds reliable systems"'
    || ',"githubUrl":' || to_json(github_url)::text
    || ',"publicRepoCount":12'
    || ',"followerCount":34'
    || ',"accountCreatedAt":"2020-01-02T03:04:05.000Z"'
    || ',"matchedLanguage":"go"'
    || ',"searchResultOrdinal":' || p_search_result_ordinal::text
    || ',"searchResponseSha256":"' || repeat('a', 64) || '"}';
  normalized_sha := encode(sha256(convert_to(normalized_payload, 'UTF8')), 'hex');
  candidate_id := 'github-' || substr(encode(sha256(convert_to(
    workspace_id || E'\n' || campaign_id || E'\ngithub\n' || p_external_id,
    'UTF8'
  )), 'hex'), 1, 32);
  return jsonb_build_object(
    'id', candidate_id,
    'campaignId', campaign_id,
    'name', p_display_name,
    'email', '',
    'phone', '',
    'avatarInitials', left(p_display_name, 1),
    'currentTitle', '',
    'currentCompany', 'Observed Company',
    'location', 'Toronto',
    'timezone', '',
    'linkedinUrl', '',
    'githubUrl', github_url,
    'sourceUrl', github_url,
    'sourceExternalId', p_external_id,
    'externalIds', jsonb_build_object('GitHub', p_external_id),
    'sourcePlatform', 'GitHub',
    'sourceQuery', 'language:go type:user',
    'matchScore', 0,
    'matchBreakdown', '[]'::jsonb,
    'techStack', '[]'::jsonb,
    'experience', '[]'::jsonb,
    'education', '[]'::jsonb,
    'languages', '[]'::jsonb,
    'yearsExperience', null,
    'companyStageExperience', '[]'::jsonb,
    'industryExperience', '[]'::jsonb,
    'recentActivity', '',
    'stage', 'Sourced',
    'lastContactedAt', null,
    'outreachHistory', '[]'::jsonb,
    'replyHistory', '[]'::jsonb,
    'booking', null,
    'complianceFlags', '{
      "doNotContact":false,
      "suppressed":false,
      "unsubscribed":false,
      "gdprExportRequested":false,
      "anonymized":false,
      "suppressedUntil":null
    }'::jsonb,
    'createdAt', '2026-07-21T12:00:00.000Z',
    'provenance', 'live',
    'sourceEvidence', jsonb_build_object(
      'provider', 'github',
      'externalId', p_external_id,
      'login', p_login,
      'displayName', p_display_name,
      'company', 'Observed Company',
      'location', 'Toronto',
      'bio', 'Builds reliable systems',
      'githubUrl', github_url,
      'publicRepoCount', 12,
      'followerCount', 34,
      'accountCreatedAt', '2020-01-02T03:04:05.000Z',
      'matchedLanguage', 'go',
      'searchResultOrdinal', p_search_result_ordinal,
      'searchResponseSha256', repeat('a', 64),
      'rawResponseSha256', p_raw_response_sha256,
      'normalizedPayloadSha256', normalized_sha
    )
  );
end;
$$;

create function sb_test.candidates_fixture()
returns jsonb language sql immutable as $$
  select jsonb_build_array(sb_test.candidate_fixture(
    '42', 'real-user', 'Real User', repeat('b', 64)
  ));
$$;

create function sb_test.page_two_candidates_fixture()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    sb_test.candidate_fixture('43', 'page-two-a', 'Page Two A', repeat('c', 64), 0),
    sb_test.candidate_fixture('44', 'page-two-b', 'Page Two B', repeat('d', 64), 1),
    sb_test.candidate_fixture('45', 'page-two-c', 'Page Two C', repeat('e', 64), 2)
  );
$$;

create function sb_test.source_receipts_fixture(
  p_batch_ordinal integer default 0,
  p_profile_response_sha256s jsonb default '[
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  ]'::jsonb,
  p_provider_mode text default 'anonymous'
) returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, sb_test
as $$
declare
  query jsonb := sb_test.query_fixture(p_batch_ordinal);
  receipts jsonb;
  profile_sha text;
  receipt_ordinal integer := 1;
begin
  receipts := jsonb_build_array(jsonb_build_object(
    'provider', 'github', 'providerMode', p_provider_mode, 'providerPage', query -> 'page',
    'ordinal', 0, 'endpointTemplate', '/search/users',
    'canonicalQuerySha256', query ->> 'sha256',
    'outcome', 'success', 'statusCode', 200, 'responseBytes', 100,
    'responseSha256', repeat('a', 64)
  ));
  for profile_sha in select value from jsonb_array_elements_text(p_profile_response_sha256s)
  loop
    receipts := receipts || jsonb_build_array(jsonb_build_object(
      'provider', 'github', 'providerMode', p_provider_mode, 'providerPage', query -> 'page',
      'ordinal', receipt_ordinal, 'endpointTemplate', '/users/{login}',
      'canonicalQuerySha256', query ->> 'sha256',
      'outcome', 'success', 'statusCode', 200, 'responseBytes', 200,
      'responseSha256', profile_sha
    ));
    receipt_ordinal := receipt_ordinal + 1;
  end loop;
  return receipts;
end;
$$;

create function sb_test.seed_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_status text default 'leased',
  p_expires_at timestamptz default (clock_timestamp() + interval '10 minutes'),
  p_batch_ordinal integer default 0,
  p_workspace_id uuid default '51111111-1111-4111-8111-111111111111'
) returns void
language plpgsql
set search_path = pg_catalog, public, sb_test
as $$
declare
  campaign_hash text;
  payload_value jsonb;
begin
  select campaign_sha256 into campaign_hash
    from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  payload_value := jsonb_build_object(
    'campaign_id', '90000000-0000-4000-8000-000000000001',
    'campaign_sha256', campaign_hash,
    'batch_ordinal', p_batch_ordinal
  );
  insert into public.aria_jobs(
    id, workspace_id, kind, idempotency_key, payload, payload_sha256,
    status, attempt_count, max_attempts, next_run_at, lease_id,
    lease_expires_at, claimed_by
  ) values (
    p_job_id, p_workspace_id, 'sourcing_batch',
    'sb-test:' || p_job_id::text, payload_value,
    encode(sha256(convert_to(payload_value::text, 'UTF8')), 'hex'),
    p_status, case when p_status = 'leased' then 1 else 0 end, 4,
    clock_timestamp(), case when p_status = 'leased' then p_lease_id else null end,
    case when p_status = 'leased' then p_expires_at else null end,
    case when p_status = 'leased' then 'sb-test-worker' else null end
  );
end;
$$;

create function sb_test.set_document_campaign_status(p_status text)
returns void
language plpgsql
set search_path = pg_catalog, public, sb_test
as $$
begin
  update public.workspace_state state
     set state = jsonb_set(
       state.state,
       '{campaigns}',
       (
         select jsonb_agg(
           case when campaign.value ->> 'id' = '90000000-0000-4000-8000-000000000001'
             then jsonb_set(campaign.value, '{status}', to_jsonb(p_status), true)
             else campaign.value end
           order by campaign.ordinality
         )
         from jsonb_array_elements(state.state -> 'campaigns')
           with ordinality campaign(value, ordinality)
       ),
       true
     )
   where state.workspace_id = '51111111-1111-4111-8111-111111111111';
end;
$$;

create function sb_test.run_queued_batch(
  p_job_id uuid,
  p_lease_id uuid,
  p_batch_ordinal integer,
  p_candidates jsonb,
  p_profile_response_sha256s jsonb,
  p_document_status_before_commit text default null
) returns jsonb
language plpgsql
set search_path = pg_catalog, public, sb_test
as $$
declare
  campaign_hash text;
  auth_result jsonb;
  begin_result jsonb;
  result_sha text;
begin
  update public.aria_jobs
     set status = 'leased', lease_id = p_lease_id,
         lease_expires_at = clock_timestamp() + interval '10 minutes',
         attempt_count = attempt_count + 1, claimed_by = 'sb-bounded-worker'
   where id = p_job_id and status = 'queued';
  select campaign_sha256 into campaign_hash
    from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  auth_result := public.authorize_sourcing_batch(
    p_job_id, p_lease_id,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, p_batch_ordinal
  );
  if auth_result ->> 'status' <> 'authorized' then
    return auth_result;
  end if;
  begin_result := public.begin_sourcing_batch_egress(
    p_job_id, p_lease_id,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, p_batch_ordinal,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture(p_batch_ordinal) ->> 'sha256'
  );
  if begin_result ->> 'status' <> 'begun' then
    return begin_result;
  end if;
  if p_document_status_before_commit is not null then
    perform sb_test.set_document_campaign_status(p_document_status_before_commit);
  end if;
  result_sha := public.sourcing_batch_result_sha256(
    '51111111-1111-4111-8111-111111111111', p_job_id,
    '90000000-0000-4000-8000-000000000001', campaign_hash, p_batch_ordinal,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begin_result ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(p_batch_ordinal), p_candidates
  );
  return public.commit_sourcing_batch(
    p_job_id, p_lease_id,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, p_batch_ordinal,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begin_result ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(p_batch_ordinal), p_candidates,
    sb_test.source_receipts_fixture(p_batch_ordinal, p_profile_response_sha256s),
    result_sha
  );
end;
$$;

create function sb_test.resume_campaign()
returns void
language plpgsql
set search_path = pg_catalog, public, sb_test
as $$
begin
  update public.sourcing_campaigns
     set status = 'sourcing', sourcing_stop_reason = null,
         sourcing_completed_at = null, updated_at = clock_timestamp()
   where workspace_id = '51111111-1111-4111-8111-111111111111'
     and id = '90000000-0000-4000-8000-000000000001';
  perform sb_test.set_document_campaign_status('Sourcing');
end;
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('60000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sb-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('60000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'sb-other@example.test', '', now(), '{}', '{}', now(), now());

insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111', 'Sourcing Batch', 'sb.example.test'),
  ('52222222-2222-4222-8222-222222222222', 'Other Tenant', 'sb-other.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('60000000-0000-4000-8000-000000000001', 'sb-admin@example.test', 'SB Admin',
   '51111111-1111-4111-8111-111111111111', 'admin'),
  ('60000000-0000-4000-8000-000000000002', 'sb-other@example.test', 'Other Admin',
   '52222222-2222-4222-8222-222222222222', 'admin');
insert into public.workspace_state(workspace_id, state) values
  ('51111111-1111-4111-8111-111111111111', '{
    "campaigns":[{
      "id":"90000000-0000-4000-8000-000000000001",
      "title":"backend engineer",
      "department":"",
      "urgency":"Standard",
      "status":"Sourcing",
      "hiringManager":"",
      "hiringManagerEmail":"",
      "createdAt":"2026-07-21T12:00:00.000Z",
      "targetStartDate":"",
      "jobAnalysis":{
        "title":"backend engineer","department":"","seniority":"Unspecified",
        "employmentType":"Unspecified","locationType":"Unspecified","regions":[],
        "timezone":"","salaryMin":null,"salaryMax":null,"currency":"","equity":false,
        "requiredSkills":["go"],"niceToHaveSkills":[],"minYearsExperience":null,
        "maxYearsExperience":null,"education":"","industryExperience":[],
        "companyStageTarget":[],"teamSize":"","reportingTo":"","urgency":"Standard",
        "validationWarnings":[]
      },
      "sourcingStrategy":{
        "primaryPlatforms":["GitHub"],"secondaryPlatforms":[],"githubQueries":[],
        "linkedinBoolean":"","stackOverflowTags":[],"geoTargets":[],
        "excludedCompanies":[],"targetCompanyStages":[]
      },
      "scoringWeights":{"skills":0,"experience":0,"companyStage":0,"industry":0,"location":0,"activity":0},
      "metrics":{"sourced":0,"contacted":0,"replied":0,"interested":0,"booked":0,
        "interviewed":0,"offer":0,"hired":0,"notInterested":0,"replyRate":0,
        "avgMatchScore":0,"timeToFirstInterviewHours":null,"emailsSentToday":0,
        "linkedinSentToday":0},
      "skillUpdates":[],"activities":[]
    }],
    "candidates":[],"unrelated":"before"
  }'),
  ('52222222-2222-4222-8222-222222222222', '{"candidates":[]}');
insert into public.sourcing_learning_secrets(workspace_id, hmac_key) values
  ('51111111-1111-4111-8111-111111111111', decode(repeat('11', 32), 'hex')),
  ('52222222-2222-4222-8222-222222222222', decode(repeat('22', 32), 'hex'));
update public.sourcing_loop_controls
   set kill_switch = false, sourcing_enabled = true,
       max_sourcing_runs_per_day = 10,
       updated_by = '60000000-0000-4000-8000-000000000001'
 where workspace_id = '51111111-1111-4111-8111-111111111111';

insert into public.requisitions(
  id, workspace_id, source_kind, source_ref, status, campaign_id,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256
) values (
  '91000000-0000-4000-8000-000000000001',
  '51111111-1111-4111-8111-111111111111', 'api', 'sb-req',
  'campaign_created', '90000000-0000-4000-8000-000000000001',
  '{"title":"backend engineer","requiredSkills":["go"]}',
  repeat('c', 64), repeat('d', 64)
);
do $$
declare
  basis jsonb := '{"title":"backend engineer","skills":["go"]}'::jsonb;
  campaign_hash text;
begin
  campaign_hash := encode(sha256(convert_to(jsonb_build_object(
    'campaign_id', '90000000-0000-4000-8000-000000000001',
    'workspace_id', '51111111-1111-4111-8111-111111111111',
    'requisition_id', '91000000-0000-4000-8000-000000000001',
    'activation_actor_id', '60000000-0000-4000-8000-000000000001',
    'role_basis', basis,
    'parse_input_sha256', repeat('c', 64),
    'parse_result_sha256', repeat('d', 64)
  )::text, 'UTF8')), 'hex');
  insert into public.sourcing_campaigns(
    id, workspace_id, requisition_id, activation_actor_id, status,
    role_basis, parse_input_sha256, parse_result_sha256, campaign_sha256
  ) values (
    '90000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '91000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001', 'sourcing', basis,
    repeat('c', 64), repeat('d', 64), campaign_hash
  );
end;
$$;

select sb_test.set_claims('service_role');

-- Browser lifecycle state is authoritative for autonomous egress. The main
-- job below exercises Paused and Filled before quota creation, then a pause
-- racing between its successful authorization and final begin boundary.
select sb_test.seed_job(
  '70000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001'
);

do $$
declare
  campaign_hash text;
  paused_auth_result jsonb;
  filled_auth_result jsonb;
  auth_result jsonb;
  repeated_auth_result jsonb;
  paused_begin jsonb;
  blocked_begin jsonb;
  begun jsonb;
  duplicate_begin jsonb;
  commit_result jsonb;
  replay_result jsonb;
  recovery_result jsonb;
  result_hash text;
begin
  select campaign_sha256 into campaign_hash from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  perform sb_test.set_document_campaign_status('Paused');
  paused_auth_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  perform sb_test.expect('paused-document-denied-before-authorization',
    paused_auth_result ->> 'status' = 'campaign_not_sourcing'
      and not exists (
        select 1 from public.sourcing_batch_claims
         where job_id = '70000000-0000-4000-8000-000000000001'
      )
      and not exists (
        select 1 from public.sourcing_provider_quota_ledger
         where job_id = '70000000-0000-4000-8000-000000000001'
      ), paused_auth_result::text);
  perform sb_test.set_document_campaign_status('Filled');
  filled_auth_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  perform sb_test.expect('filled-document-denied-before-authorization',
    filled_auth_result ->> 'status' = 'campaign_not_sourcing'
      and not exists (
        select 1 from public.sourcing_batch_claims
         where job_id = '70000000-0000-4000-8000-000000000001'
      ), filled_auth_result::text);
  perform sb_test.set_document_campaign_status('Sourcing');
  auth_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  repeated_auth_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  perform sb_test.expect('authorize-exact-lease',
    auth_result ->> 'status' = 'authorized'
      and auth_result -> 'canonical_query' = sb_test.query_fixture()
      and auth_result -> 'applied_lesson' = 'null'::jsonb,
    auth_result::text);
  perform sb_test.expect(
    'authorize-idempotent-token-fence',
    repeated_auth_result ->> 'claim_token' = auth_result ->> 'claim_token'
      and repeated_auth_result ->> 'fence_version' = auth_result ->> 'fence_version'
  );
  perform sb_test.expect(
    'quota-reserved-once',
    (select count(*) from public.sourcing_provider_quota_ledger
      where job_id = '70000000-0000-4000-8000-000000000001') = 3
  );
  perform sb_test.set_document_campaign_status('Paused');
  paused_begin := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture() ->> 'sha256'
  );
  perform sb_test.expect('pause-after-authorization-denied-before-egress',
    paused_begin ->> 'status' = 'campaign_not_sourcing'
      and not exists (
        select 1 from public.sourcing_batch_egress_attempts
         where job_id = '70000000-0000-4000-8000-000000000001'
      ), paused_begin::text);
  perform sb_test.set_document_campaign_status('Sourcing');
  perform sb_test.expect(
    'query-policy-rotates-language-before-page',
    public.sourcing_batch_expected_query(
      '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
      0
    ) ->> 'value' = 'language:go type:user'
      and public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        0
      ) ->> 'page' = '1'
      and public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        1
      ) ->> 'value' = 'language:typescript type:user'
      and public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        1
      ) ->> 'page' = '1'
      and public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        2
      ) ->> 'value' = 'language:go type:user'
      and public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        2
      ) ->> 'page' = '2'
      and public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        0
      ) ->> 'sha256' <> public.sourcing_batch_expected_query(
        '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb,
        2
      ) ->> 'sha256'
  );
  update public.sourcing_loop_controls
     set kill_switch = true,
         sourcing_enabled = false
   where workspace_id = '51111111-1111-4111-8111-111111111111';
  blocked_begin := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture() ->> 'sha256'
  );
  perform sb_test.expect(
    'begin-rechecks-kill-switch-before-egress',
    blocked_begin ->> 'status' = 'sourcing_disabled'
      and not exists (
        select 1 from public.sourcing_batch_egress_attempts
         where job_id = '70000000-0000-4000-8000-000000000001'
      ),
    blocked_begin::text
  );
  update public.sourcing_loop_controls
     set kill_switch = false,
         sourcing_enabled = true
   where workspace_id = '51111111-1111-4111-8111-111111111111';
  begun := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture() ->> 'sha256'
  );
  duplicate_begin := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture() ->> 'sha256'
  );
  perform sb_test.expect('begin-exact-attempt', begun ->> 'status' = 'begun');
  perform sb_test.expect('duplicate-worker-no-second-egress', duplicate_begin ->> 'status' = 'already_begun');
  perform sb_test.expect(
    'wrong-provider-page-rejected',
    not public.validate_sourcing_batch_source_receipts(
      jsonb_set(sb_test.source_receipts_fixture(), '{0,providerPage}', '2'::jsonb),
      sb_test.query_fixture() ->> 'sha256',
      1,
      true
    )
  );

  perform sb_test.expect(
    'node-result-hash-parity',
    public.sourcing_batch_result_sha256(
      '51111111-1111-4111-8111-111111111111',
      '70000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', repeat('a', 64), 0,
      '61000000-0000-4000-8000-000000000001', 1,
      '62000000-0000-4000-8000-000000000001',
      sb_test.query_fixture(), sb_test.candidates_fixture()
    ) = '07d9a664d73248007982185be7a9feadd3d0e65ed634c51d0a9c0cb01897ba91'
  );
  perform sb_test.expect(
    'partial-candidate-contract-rejected',
    not public.validate_sourcing_batch_candidates(
      '51111111-1111-4111-8111-111111111111',
      '90000000-0000-4000-8000-000000000001',
      sb_test.query_fixture(),
      jsonb_build_array((sb_test.candidates_fixture() -> 0) - 'currentTitle'),
      sb_test.source_receipts_fixture()
    )
  );
  perform sb_test.expect(
    'invented-candidate-score-rejected',
    not public.validate_sourcing_batch_candidates(
      '51111111-1111-4111-8111-111111111111',
      '90000000-0000-4000-8000-000000000001',
      sb_test.query_fixture(),
      jsonb_set(sb_test.candidates_fixture(), '{0,matchScore}', '87'::jsonb),
      sb_test.source_receipts_fixture()
    )
  );

  -- A concurrent, unrelated workspace write occurs after authorization and
  -- egress begin. Commit must merge against the latest document, never ask
  -- the worker to re-egress.
  update public.workspace_state
     set state = jsonb_set(state, '{unrelated}', '"preserved-after-egress"', true)
   where workspace_id = '51111111-1111-4111-8111-111111111111';
  result_hash := public.sourcing_batch_result_sha256(
    '51111111-1111-4111-8111-111111111111',
    '70000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begun ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(), sb_test.candidates_fixture()
  );
  commit_result := public.commit_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begun ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(), sb_test.candidates_fixture(),
    sb_test.source_receipts_fixture(), result_hash
  );
  perform sb_test.expect('commit-after-unrelated-write', commit_result ->> 'status' = 'completed', commit_result::text);
  perform sb_test.expect(
    'unrelated-write-preserved',
    (select state ->> 'unrelated' from public.workspace_state
      where workspace_id = '51111111-1111-4111-8111-111111111111') = 'preserved-after-egress'
  );
  perform sb_test.expect('relational-candidate-committed', (
    select count(*) from public.candidates
     where workspace_id = '51111111-1111-4111-8111-111111111111'
       and campaign_id = '90000000-0000-4000-8000-000000000001'
  ) = 1);
  perform sb_test.expect('source-evidence-committed', (
    select count(*) from public.sourcing_candidate_evidence
     where job_id = '70000000-0000-4000-8000-000000000001'
  ) = 1);
  perform sb_test.expect('provider-receipts-committed', (
    select count(*) from public.sourcing_batch_source_receipts
     where job_id = '70000000-0000-4000-8000-000000000001'
  ) = 2);
  perform sb_test.expect('workspace-candidate-is-app-compatible', (
    select candidate.value ?& array[
      'id','campaignId','name','email','avatarInitials','currentTitle','currentCompany',
      'location','timezone','linkedinUrl','githubUrl','sourcePlatform','sourceQuery',
      'matchScore','matchBreakdown','techStack','yearsExperience','companyStageExperience',
      'industryExperience','recentActivity','stage','lastContactedAt','outreachHistory',
      'replyHistory','booking','complianceFlags','createdAt'
    ]
      and candidate.value ->> 'campaignId' = campaign.value ->> 'id'
      and jsonb_typeof(candidate.value -> 'matchBreakdown') = 'array'
      and jsonb_typeof(candidate.value -> 'complianceFlags') = 'object'
      and candidate.value -> 'matchScore' = '0'::jsonb
    from public.workspace_state state
    cross join lateral jsonb_array_elements(state.state -> 'candidates') candidate(value)
    cross join lateral jsonb_array_elements(state.state -> 'campaigns') campaign(value)
    where state.workspace_id = '51111111-1111-4111-8111-111111111111'
      and candidate.value ->> 'id' = 'github-6b1e14ad3c2edf998c26371f51cc7c14'
      and campaign.value ->> 'id' = '90000000-0000-4000-8000-000000000001'
  ));
  replay_result := public.commit_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begun ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(), sb_test.candidates_fixture(),
    sb_test.source_receipts_fixture(), result_hash
  );
  perform sb_test.expect('commit-no-op-replay', replay_result ->> 'status' = 'no_op_replay');
  recovery_result := public.fail_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begun ->> 'egress_attempt_id')::uuid,
    'commit_transport_unknown', false, true,
    sb_test.source_receipts_fixture(), result_hash, 1, 1
  );
  perform sb_test.expect('uncertain-commit-recovers-exact-receipt', recovery_result ->> 'status' = 'completed');
end;
$$;

-- Cross-tenant and expired-lease calls remain read-only.
do $$
declare campaign_hash text; outcome jsonb;
begin
  select campaign_sha256 into campaign_hash from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  outcome := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '52222222-2222-4222-8222-222222222222',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  perform sb_test.expect('cross-tenant-rejected', outcome ->> 'status' = 'wrong_workspace');
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002',
    'leased', clock_timestamp() - interval '1 second'
  );
  outcome := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  perform sb_test.expect('expired-lease-rejected', outcome ->> 'status' = 'lease_expired');
end;
$$;

-- Readiness: missing, wrong contract, exact contract, then overdue work.
do $$
declare readiness jsonb; expected_contract text;
begin
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-missing-heartbeat',
    readiness ->> 'heartbeat_status' = 'missing' and not (readiness ->> 'healthy')::boolean);
  expected_contract := public.expected_sourcing_loop_handler_contract_sha256();
  perform public.record_sourcing_loop_heartbeat('sb-old-worker', repeat('b', 40), expected_contract);
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-rejects-other-release-heartbeat',
    readiness ->> 'heartbeat_status' = 'missing' and not (readiness ->> 'healthy')::boolean);
  perform public.record_sourcing_loop_heartbeat('sb-worker', repeat('a', 40), repeat('f', 64));
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-unknown-handler-contract', readiness ->> 'heartbeat_status' = 'contract_mismatch');
  perform public.record_sourcing_loop_heartbeat('sb-worker', repeat('a', 40), expected_contract);
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-green-exact-contract',
    (readiness ->> 'healthy')::boolean
      and (readiness ->> 'expected_handler_count')::integer = 4
      and (readiness ->> 'oldest_runnable_job_age_seconds')::integer = 0,
    readiness::text);
  update public.loop_worker_heartbeats
     set last_seen_at = clock_timestamp() - interval '91 seconds'
   where worker_id = 'sb-worker';
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-rejects-stale-exact-release-heartbeat',
    readiness ->> 'heartbeat_status' = 'stale'
      and not (readiness ->> 'healthy')::boolean,
    readiness::text);
  perform public.record_sourcing_loop_heartbeat('sb-worker', repeat('a', 40), expected_contract);
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000003', 'queued', null
  );
  update public.aria_jobs set next_run_at = clock_timestamp() - interval '3 minutes'
   where id = '70000000-0000-4000-8000-000000000003';
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-overdue-job-red',
    (readiness ->> 'overdue_runnable_jobs')::integer = 1
      and (readiness ->> 'oldest_runnable_job_age_seconds')::integer >= 180
      and not (readiness ->> 'healthy')::boolean);
  delete from public.aria_jobs where id = '70000000-0000-4000-8000-000000000003';
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000005',
    '80000000-0000-4000-8000-000000000005', 'dead', null
  );
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('readiness-dead-job-red',
    (readiness ->> 'dead_sourcing_jobs')::integer = 1
      and not (readiness ->> 'healthy')::boolean,
    readiness::text);
  delete from public.aria_jobs where id = '70000000-0000-4000-8000-000000000005';
end;
$$;

-- A begun attempt cannot use generic completion. Because GitHub discovery is
-- read-only, lease expiry is safely requeued under a new fence while attempts
-- remain instead of permanently poisoning operational readiness.
select sb_test.seed_job(
  '70000000-0000-4000-8000-000000000004',
  '80000000-0000-4000-8000-000000000004'
);
do $$
declare campaign_hash text; auth_result jsonb; begun jsonb; readiness jsonb;
begin
  select campaign_sha256 into campaign_hash from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  auth_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000004',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0
  );
  begun := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000004',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 0,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture() ->> 'sha256'
  );
  insert into sb_test.context(key, value) values ('ambiguous', jsonb_build_object(
    'auth', auth_result, 'begin', begun
  ));
end;
$$;
select sb_test.expect_sqlstate(
  'generic-completion-blocked-after-begin',
  $$select public.complete_aria_job(
    '70000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000004', repeat('e', 64), '[]', '[]'
  )$$,
  array['42501']
);
update public.aria_jobs
   set lease_expires_at = clock_timestamp() - interval '1 second'
 where id = '70000000-0000-4000-8000-000000000004';
select public.reap_expired_aria_job_leases(10);
select sb_test.expect('reaper-retries-begun-read-only-egress',
  (select status = 'queued' and lease_id is null and lease_expires_at is null
     from public.aria_jobs
    where id = '70000000-0000-4000-8000-000000000004')
  and (select status = 'retryable_failed' from public.sourcing_batch_egress_attempts
       where job_id = '70000000-0000-4000-8000-000000000004')
  and (select state = 'retryable_failed' and egress_attempt_id is null
       from public.sourcing_batch_claims
       where job_id = '70000000-0000-4000-8000-000000000004'));
select sb_test.expect('readiness-does-not-wedge-after-retryable-read-only-egress',
  (public.get_sourcing_loop_readiness(repeat('a', 40)) ->> 'ambiguous_sourcing_attempts')::integer = 0
  and (public.get_sourcing_loop_readiness(repeat('a', 40)) ->> 'healthy')::boolean);

-- The first successful page above must have created exactly one ordinal-1
-- continuation. Page 2 contributes three more unique observed candidates,
-- its exact replay creates no duplicate candidate or job, then an empty page
-- 3 truthfully exhausts this provider and advances the document to Outreach
-- without scheduling or sending contact.
do $$
declare
  campaign_hash text;
  page_two_job_id uuid;
  page_two_lease constant uuid := '80000000-0000-4000-8000-000000000010';
  page_two_auth jsonb;
  page_two_begin jsonb;
  page_two_result_sha text;
  page_two_commit jsonb;
  page_two_replay jsonb;
  page_three_job_id uuid;
  page_three_lease constant uuid := '80000000-0000-4000-8000-000000000011';
  page_three_auth jsonb;
  page_three_begin jsonb;
  page_three_result_sha text;
  page_three_commit jsonb;
begin
  select campaign_sha256 into campaign_hash
    from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  select id into page_two_job_id
    from public.aria_jobs
   where workspace_id = '51111111-1111-4111-8111-111111111111'
     and kind = 'sourcing_batch'
     and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
     and payload ->> 'batch_ordinal' = '1';
  perform sb_test.expect('first-page-enqueues-one-next-batch',
    page_two_job_id is not null and (
      select count(*) = 1 from public.aria_jobs
       where workspace_id = '51111111-1111-4111-8111-111111111111'
         and kind = 'sourcing_batch'
         and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
         and payload ->> 'batch_ordinal' = '1'
    ));
  update public.aria_jobs
     set status = 'leased', lease_id = page_two_lease,
         lease_expires_at = clock_timestamp() + interval '10 minutes',
         attempt_count = attempt_count + 1, claimed_by = 'sb-page-two'
   where id = page_two_job_id and status = 'queued';
  page_two_auth := public.authorize_sourcing_batch(
    page_two_job_id, page_two_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 1
  );
  page_two_begin := public.begin_sourcing_batch_egress(
    page_two_job_id, page_two_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 1,
    (page_two_auth ->> 'claim_token')::uuid,
    (page_two_auth ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture(1) ->> 'sha256'
  );
  page_two_result_sha := public.sourcing_batch_result_sha256(
    '51111111-1111-4111-8111-111111111111', page_two_job_id,
    '90000000-0000-4000-8000-000000000001', campaign_hash, 1,
    (page_two_auth ->> 'claim_token')::uuid,
    (page_two_auth ->> 'fence_version')::bigint,
    (page_two_begin ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(1), sb_test.page_two_candidates_fixture()
  );
  page_two_commit := public.commit_sourcing_batch(
    page_two_job_id, page_two_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 1,
    (page_two_auth ->> 'claim_token')::uuid,
    (page_two_auth ->> 'fence_version')::bigint,
    (page_two_begin ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(1), sb_test.page_two_candidates_fixture(),
    sb_test.source_receipts_fixture(1, jsonb_build_array(
      repeat('c', 64), repeat('d', 64), repeat('e', 64)
    )), page_two_result_sha
  );
  perform sb_test.expect('second-page-commits-three-observed-candidates',
    page_two_commit ->> 'status' = 'completed'
      and (page_two_commit ->> 'candidate_count')::integer = 3,
    page_two_commit::text);
  perform sb_test.expect('autonomous-continuation-persists-more-than-three-unique-candidates',
    (select count(*) = 4 from public.candidates
      where workspace_id = '51111111-1111-4111-8111-111111111111'
        and campaign_id = '90000000-0000-4000-8000-000000000001'));
  perform sb_test.expect('second-page-enqueues-exactly-one-third-page',
    (select count(*) = 1 from public.aria_jobs
      where workspace_id = '51111111-1111-4111-8111-111111111111'
        and kind = 'sourcing_batch'
        and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
        and payload ->> 'batch_ordinal' = '2'));
  page_two_replay := public.commit_sourcing_batch(
    page_two_job_id, page_two_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 1,
    (page_two_auth ->> 'claim_token')::uuid,
    (page_two_auth ->> 'fence_version')::bigint,
    (page_two_begin ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(1), sb_test.page_two_candidates_fixture(),
    sb_test.source_receipts_fixture(1, jsonb_build_array(
      repeat('c', 64), repeat('d', 64), repeat('e', 64)
    )), page_two_result_sha
  );
  perform sb_test.expect('later-page-replay-never-duplicates-candidates-or-jobs',
    page_two_replay ->> 'status' = 'no_op_replay'
      and (select count(*) = 4 from public.candidates
        where workspace_id = '51111111-1111-4111-8111-111111111111'
          and campaign_id = '90000000-0000-4000-8000-000000000001')
      and (select count(*) = 1 from public.aria_jobs
        where workspace_id = '51111111-1111-4111-8111-111111111111'
          and kind = 'sourcing_batch'
          and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
          and payload ->> 'batch_ordinal' = '2'));

  select id into page_three_job_id
    from public.aria_jobs
   where workspace_id = '51111111-1111-4111-8111-111111111111'
     and kind = 'sourcing_batch'
     and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
     and payload ->> 'batch_ordinal' = '2';
  update public.aria_jobs
     set status = 'leased', lease_id = page_three_lease,
         lease_expires_at = clock_timestamp() + interval '10 minutes',
         attempt_count = attempt_count + 1, claimed_by = 'sb-page-three'
   where id = page_three_job_id and status = 'queued';
  page_three_auth := public.authorize_sourcing_batch(
    page_three_job_id, page_three_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 2
  );
  page_three_begin := public.begin_sourcing_batch_egress(
    page_three_job_id, page_three_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 2,
    (page_three_auth ->> 'claim_token')::uuid,
    (page_three_auth ->> 'fence_version')::bigint,
    'anonymous', sb_test.query_fixture(2) ->> 'sha256'
  );
  page_three_result_sha := public.sourcing_batch_result_sha256(
    '51111111-1111-4111-8111-111111111111', page_three_job_id,
    '90000000-0000-4000-8000-000000000001', campaign_hash, 2,
    (page_three_auth ->> 'claim_token')::uuid,
    (page_three_auth ->> 'fence_version')::bigint,
    (page_three_begin ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(2), '[]'::jsonb
  );
  page_three_commit := public.commit_sourcing_batch(
    page_three_job_id, page_three_lease,
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 2,
    (page_three_auth ->> 'claim_token')::uuid,
    (page_three_auth ->> 'fence_version')::bigint,
    (page_three_begin ->> 'egress_attempt_id')::uuid,
    sb_test.query_fixture(2), '[]'::jsonb,
    sb_test.source_receipts_fixture(2, '[]'::jsonb), page_three_result_sha
  );
  perform sb_test.expect('empty-provider-page-completes-without-continuation',
    page_three_commit ->> 'status' = 'completed'
      and (page_three_commit ->> 'candidate_count')::integer = 0
      and not exists (
        select 1 from public.aria_jobs
         where workspace_id = '51111111-1111-4111-8111-111111111111'
           and kind = 'sourcing_batch'
           and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
           and payload ->> 'batch_ordinal' = '3'
      ), page_three_commit::text);
  perform sb_test.expect('provider-exhaustion-is-truthful-in-relational-and-document-campaigns',
    (select status = 'completed' and sourcing_stop_reason = 'provider_exhausted'
       and sourcing_completed_at is not null
       from public.sourcing_campaigns
      where id = '90000000-0000-4000-8000-000000000001')
    and (select projected.value ->> 'status' = 'Outreach'
          and projected.value -> 'metrics' -> 'sourced' = '4'::jsonb
          and exists (
            select 1 from jsonb_array_elements(projected.value -> 'activities') activity(value)
             where activity.value ->> 'outcome' = 'provider_exhausted'
               and activity.value ->> 'notes' = 'Observed 4 unique candidates.'
          )
         from public.workspace_state state
         cross join lateral jsonb_array_elements(state.state -> 'campaigns') projected(value)
        where state.workspace_id = '51111111-1111-4111-8111-111111111111'
          and projected.value ->> 'id' = '90000000-0000-4000-8000-000000000001'));
end;
$$;

-- A pause after a begun read-only egress preserves the observed evidence but
-- owns the campaign lifecycle: no continuation and no document status rewrite.
do $$
declare paused_commit jsonb;
begin
  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000033',
    '80000000-0000-4000-8000-000000000033',
    'queued', null, 3
  );
  paused_commit := sb_test.run_queued_batch(
    '70000000-0000-4000-8000-000000000033',
    '80000000-0000-4000-8000-000000000033',
    3,
    sb_test.candidates_fixture(),
    jsonb_build_array(repeat('b', 64)),
    'Paused'
  );
  perform sb_test.expect('pause-after-egress-persists-receipt-without-continuation',
    paused_commit ->> 'status' = 'completed'
      and (select count(*) = 4 from public.candidates
        where workspace_id = '51111111-1111-4111-8111-111111111111'
          and campaign_id = '90000000-0000-4000-8000-000000000001')
      and not exists (
        select 1 from public.aria_jobs
         where workspace_id = '51111111-1111-4111-8111-111111111111'
           and idempotency_key = 'sourcing_batch:90000000-0000-4000-8000-000000000001:000004'
      ), paused_commit::text);
  perform sb_test.expect('pause-after-egress-preserves-document-and-syncs-relational-state',
    (select status = 'paused' and sourcing_stop_reason is null
          and sourcing_completed_at is null
       from public.sourcing_campaigns
      where id = '90000000-0000-4000-8000-000000000001')
      and (select projected.value ->> 'status' = 'Paused'
            and projected.value -> 'metrics' -> 'sourced' = '4'::jsonb
         from public.workspace_state state
         cross join lateral jsonb_array_elements(state.state -> 'campaigns') projected(value)
        where state.workspace_id = '51111111-1111-4111-8111-111111111111'
          and projected.value ->> 'id' = '90000000-0000-4000-8000-000000000001'));
end;
$$;

-- Exercise both remaining finite stop boundaries. A final allowed batch below
-- target must stop at the ordinal bound. After an explicit test-only resume,
-- ordinal 3 may enqueue exactly one ordinal 4, whose ninth unique candidate
-- stops on the target with target precedence over the simultaneous bound.
do $$
declare
  bound_result jsonb;
  target_page_result jsonb;
  target_result jsonb;
  target_last_job_id uuid;
begin
  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000020',
    '80000000-0000-4000-8000-000000000020',
    'queued', null, 4
  );
  bound_result := sb_test.run_queued_batch(
    '70000000-0000-4000-8000-000000000020',
    '80000000-0000-4000-8000-000000000020',
    4,
    jsonb_build_array(sb_test.candidate_fixture(
      '46', 'bound-user', 'Bound User', repeat('f', 64)
    )),
    jsonb_build_array(repeat('f', 64))
  );
  perform sb_test.expect('last-ordinal-stops-below-target-without-next-job',
    bound_result ->> 'status' = 'completed'
      and (select status = 'completed' and sourcing_stop_reason = 'batch_bound_reached'
        from public.sourcing_campaigns
       where id = '90000000-0000-4000-8000-000000000001')
      and not exists (
        select 1 from public.aria_jobs
         where workspace_id = '51111111-1111-4111-8111-111111111111'
           and kind = 'sourcing_batch'
           and payload ->> 'campaign_id' = '90000000-0000-4000-8000-000000000001'
           and payload ->> 'batch_ordinal' = '5'
      ), bound_result::text);
  perform sb_test.expect('batch-bound-stop-is-truthful-in-document-campaign',
    (select projected.value ->> 'status' = 'Outreach'
          and projected.value -> 'metrics' -> 'sourced' = '5'::jsonb
          and exists (
            select 1 from jsonb_array_elements(projected.value -> 'activities') activity(value)
             where activity.value ->> 'outcome' = 'batch_bound_reached'
               and activity.value ->> 'notes' = 'Observed 5 unique candidates.'
          )
       from public.workspace_state state
       cross join lateral jsonb_array_elements(state.state -> 'campaigns') projected(value)
      where state.workspace_id = '51111111-1111-4111-8111-111111111111'
        and projected.value ->> 'id' = '90000000-0000-4000-8000-000000000001'));

  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000021',
    '80000000-0000-4000-8000-000000000021',
    'queued', null, 3
  );
  target_page_result := sb_test.run_queued_batch(
    '70000000-0000-4000-8000-000000000021',
    '80000000-0000-4000-8000-000000000021',
    3,
    jsonb_build_array(
      sb_test.candidate_fixture('47', 'target-a', 'Target A', repeat('1', 64), 0),
      sb_test.candidate_fixture('48', 'target-b', 'Target B', repeat('2', 64), 1),
      sb_test.candidate_fixture('49', 'target-c', 'Target C', repeat('3', 64), 2)
    ),
    jsonb_build_array(repeat('1', 64), repeat('2', 64), repeat('3', 64))
  );
  select id into target_last_job_id
    from public.aria_jobs
   where workspace_id = '51111111-1111-4111-8111-111111111111'
     and idempotency_key = 'sourcing_batch:90000000-0000-4000-8000-000000000001:000004';
  perform sb_test.expect('below-target-penultimate-batch-enqueues-one-last-batch',
    target_page_result ->> 'status' = 'completed'
      and target_last_job_id is not null
      and (select count(*) = 8 from public.candidates
        where workspace_id = '51111111-1111-4111-8111-111111111111'
          and campaign_id = '90000000-0000-4000-8000-000000000001'),
    target_page_result::text);
  target_result := sb_test.run_queued_batch(
    target_last_job_id,
    '80000000-0000-4000-8000-000000000022',
    4,
    jsonb_build_array(sb_test.candidate_fixture(
      '50', 'target-final', 'Target Final', repeat('4', 64)
    )),
    jsonb_build_array(repeat('4', 64))
  );
  perform sb_test.expect('candidate-target-stops-without-another-job',
    target_result ->> 'status' = 'completed'
      and (select status = 'completed' and sourcing_stop_reason = 'target_reached'
            and sourcing_completed_at is not null
        from public.sourcing_campaigns
       where id = '90000000-0000-4000-8000-000000000001')
      and not exists (
        select 1 from public.aria_jobs
         where workspace_id = '51111111-1111-4111-8111-111111111111'
           and idempotency_key = 'sourcing_batch:90000000-0000-4000-8000-000000000001:000005'
      ), target_result::text);
  perform sb_test.expect('target-stop-is-truthful-and-never-starts-contact',
    (select projected.value ->> 'status' = 'Outreach'
          and projected.value -> 'metrics' -> 'sourced' = '9'::jsonb
          and exists (
            select 1 from jsonb_array_elements(projected.value -> 'activities') activity(value)
             where activity.value ->> 'outcome' = 'target_reached'
               and activity.value ->> 'notes' = 'Observed 9 unique candidates.'
          )
       from public.workspace_state state
       cross join lateral jsonb_array_elements(state.state -> 'campaigns') projected(value)
      where state.workspace_id = '51111111-1111-4111-8111-111111111111'
        and projected.value ->> 'id' = '90000000-0000-4000-8000-000000000001')
      and not exists (
        select 1 from public.messages_outbound outbound
         where outbound.workspace_id = '51111111-1111-4111-8111-111111111111'
      ));
end;
$$;

-- A role supported by the autonomous web provider is routed away from the
-- GitHub lane before quota, egress, candidate, or outbound state. The routing
-- decision is replay-stable and leaves the leased job available to the web
-- authorizer that the worker invokes first.
do $$
declare
  basis jsonb := '{"title":"security engineer","skills":["kubernetes"]}'::jsonb;
  campaign_hash text;
  payload_value jsonb;
  projected_campaign jsonb;
  first_result jsonb;
  replay_result jsonb;
  readiness jsonb;
begin
  insert into public.requisitions(
    id, workspace_id, source_kind, source_ref, status, campaign_id,
    parsed_job_analysis, parse_input_sha256, parse_result_sha256
  ) values (
    '91000000-0000-4000-8000-000000000002',
    '51111111-1111-4111-8111-111111111111', 'api', 'sb-unsupported-req',
    'campaign_created', '90000000-0000-4000-8000-000000000002',
    '{"title":"security engineer","requiredSkills":["kubernetes"]}',
    repeat('5', 64), repeat('6', 64)
  );
  campaign_hash := encode(sha256(convert_to(jsonb_build_object(
    'campaign_id', '90000000-0000-4000-8000-000000000002',
    'workspace_id', '51111111-1111-4111-8111-111111111111',
    'requisition_id', '91000000-0000-4000-8000-000000000002',
    'activation_actor_id', '60000000-0000-4000-8000-000000000001',
    'role_basis', basis,
    'parse_input_sha256', repeat('5', 64),
    'parse_result_sha256', repeat('6', 64)
  )::text, 'UTF8')), 'hex');
  insert into public.sourcing_campaigns(
    id, workspace_id, requisition_id, activation_actor_id, status,
    role_basis, parse_input_sha256, parse_result_sha256, campaign_sha256
  ) values (
    '90000000-0000-4000-8000-000000000002',
    '51111111-1111-4111-8111-111111111111',
    '91000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000001', 'sourcing', basis,
    repeat('5', 64), repeat('6', 64), campaign_hash
  );

  select item.value into projected_campaign
    from public.workspace_state state
    cross join lateral jsonb_array_elements(state.state -> 'campaigns') item(value)
   where state.workspace_id = '51111111-1111-4111-8111-111111111111'
     and item.value ->> 'id' = '90000000-0000-4000-8000-000000000001';
  projected_campaign := projected_campaign || jsonb_build_object(
    'id', '90000000-0000-4000-8000-000000000002',
    'title', 'security engineer',
    'status', 'Sourcing',
    'activities', '[]'::jsonb,
    'metrics', jsonb_set(projected_campaign -> 'metrics', '{sourced}', '0'::jsonb, true)
  );
  projected_campaign := jsonb_set(
    jsonb_set(projected_campaign, '{jobAnalysis,title}', '"security engineer"'::jsonb, true),
    '{jobAnalysis,requiredSkills}', '["kubernetes"]'::jsonb, true
  );
  update public.workspace_state
     set state = jsonb_set(
       state,
       '{campaigns}',
       (state -> 'campaigns') || jsonb_build_array(projected_campaign),
       true
     )
   where workspace_id = '51111111-1111-4111-8111-111111111111';

  payload_value := jsonb_build_object(
    'campaign_id', '90000000-0000-4000-8000-000000000002',
    'campaign_sha256', campaign_hash,
    'batch_ordinal', 0
  );
  insert into public.aria_jobs(
    id, workspace_id, kind, idempotency_key, payload, payload_sha256,
    status, attempt_count, max_attempts, next_run_at, lease_id,
    lease_expires_at, claimed_by
  ) values (
    '70000000-0000-4000-8000-000000000030',
    '51111111-1111-4111-8111-111111111111', 'sourcing_batch',
    'sb-unsupported-role', payload_value,
    encode(sha256(convert_to(payload_value::text, 'UTF8')), 'hex'),
    'leased', 1, 4, clock_timestamp(),
    '80000000-0000-4000-8000-000000000030',
    clock_timestamp() + interval '10 minutes', 'sb-test-worker'
  );

  first_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000030',
    '80000000-0000-4000-8000-000000000030',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000002', campaign_hash, 0
  );
  replay_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000030',
    '80000000-0000-4000-8000-000000000030',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000002', campaign_hash, 0
  );
  perform sb_test.expect('unsupported-github-role-routes-to-web-before-egress',
    first_result = jsonb_build_object('status', 'provider_lane_conflict')
      and replay_result = first_result
      and (select status = 'leased' and attempt_count = 1
                  and last_error is null and result_sha256 is null
                  and lease_id = '80000000-0000-4000-8000-000000000030'
        from public.aria_jobs where id = '70000000-0000-4000-8000-000000000030')
      and (select status = 'sourcing' and sourcing_pause_reason is null
        from public.sourcing_campaigns where id = '90000000-0000-4000-8000-000000000002'),
    jsonb_build_object('first', first_result, 'replay', replay_result)::text);
  perform sb_test.expect('provider-routing-preserves-sourcing-projection',
    (select item.value ->> 'status' = 'Sourcing'
          and jsonb_array_length(item.value -> 'activities') = 0
       from public.workspace_state state
       cross join lateral jsonb_array_elements(state.state -> 'campaigns') item(value)
      where state.workspace_id = '51111111-1111-4111-8111-111111111111'
        and item.value ->> 'id' = '90000000-0000-4000-8000-000000000002'));
  perform sb_test.expect('provider-routing-has-zero-provider-or-send-state',
    not exists (select 1 from public.sourcing_batch_claims
      where job_id = '70000000-0000-4000-8000-000000000030')
    and not exists (select 1 from public.sourcing_provider_quota_ledger
      where job_id = '70000000-0000-4000-8000-000000000030')
    and not exists (select 1 from public.sourcing_batch_egress_attempts
      where job_id = '70000000-0000-4000-8000-000000000030')
    and not exists (select 1 from public.sourcing_candidate_evidence
      where job_id = '70000000-0000-4000-8000-000000000030')
    and not exists (select 1 from public.messages_outbound
      where workspace_id = '51111111-1111-4111-8111-111111111111'
        and campaign_id = '90000000-0000-4000-8000-000000000002'));
  perform public.record_sourcing_loop_heartbeat(
    'sb-worker', repeat('a', 40), public.expected_sourcing_loop_handler_contract_sha256()
  );
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform sb_test.expect('provider-routing-does-not-poison-readiness',
    (readiness ->> 'dead_sourcing_jobs')::integer = 0
      and (readiness ->> 'healthy')::boolean,
    readiness::text);
end;
$$;

-- Autonomous learning can only attach an exact human-promoted Graphify
-- lesson to a query the server had already derived. Every accepted field is
-- snapshotted before egress and survives later lesson mutation and replay.
-- Isolate these selector cases from the earlier global per-minute reservations
-- in this disposable database. The append-only guard is restored immediately
-- and is independently exercised by the mutation tests below.
alter table public.sourcing_provider_quota_ledger
  disable trigger sourcing_provider_quota_ledger_append_only;
update public.sourcing_provider_quota_ledger
   set window_start = window_start - interval '1 day'
 where scope_kind = 'global_search_minute'
   and window_start = date_trunc('minute', clock_timestamp());
alter table public.sourcing_provider_quota_ledger
  enable trigger sourcing_provider_quota_ledger_append_only;

do $$
<<lesson_consumption_test>>
declare
  workspace_id constant uuid := '51111111-1111-4111-8111-111111111111';
  other_workspace_id constant uuid := '52222222-2222-4222-8222-222222222222';
  campaign_id constant uuid := '90000000-0000-4000-8000-000000000001';
  actor_id constant uuid := '60000000-0000-4000-8000-000000000001';
  other_actor_id constant uuid := '60000000-0000-4000-8000-000000000002';
  lesson_id constant uuid := '66000000-0000-4000-8000-000000000001';
  artifact_id constant uuid := '67000000-0000-4000-8000-000000000001';
  image_digest constant text := 'registry.example.test/graphify@sha256:' || repeat('7', 64);
  graphify_commit constant text := '94d3099540550d58dd121ec3e67cf93e80364079';
  role_basis constant jsonb := '{"title":"backend engineer","skills":["go"]}'::jsonb;
  query jsonb := sb_test.query_fixture();
  role_fingerprint text;
  query_hmac text;
  campaign_hash text;
  expired_result jsonb;
  suspended_result jsonb;
  review_mismatch_result jsonb;
  authorized_result jsonb;
  repeated_result jsonb;
  begun_result jsonb;
  commit_result jsonb;
  replay_result jsonb;
  claimed_snapshot jsonb;
  result_hash text;
begin
  role_fingerprint := public.sourcing_authority_hmac(
    workspace_id,
    public.canonicalize_sourcing_role_basis(role_basis)::text
  );
  query_hmac := public.sourcing_authority_hmac(
    workspace_id,
    'query:GitHub:' || (query ->> 'value')
  );
  select campaign_sha256 into campaign_hash
    from public.sourcing_campaigns where id = campaign_id;

  insert into public.sourcing_learning_controls(
    workspace_id, enabled, required_graphify_image_digest, updated_by
  ) values (
    workspace_id, true, image_digest, actor_id
  ) on conflict on constraint sourcing_learning_controls_pkey do update
    set enabled = true,
        required_graphify_image_digest = excluded.required_graphify_image_digest,
        updated_by = excluded.updated_by,
        updated_at = clock_timestamp();
  update public.sourcing_loop_controls
     set max_sourcing_runs_per_day = 100
   where sourcing_loop_controls.workspace_id = lesson_consumption_test.workspace_id;

  insert into public.sourcing_graphify_exports(
    id, workspace_id, actor_id, export_payload, status, input_sha256,
    graph_sha256, graph_text, manifest, image_digest, graphify_commit,
    completed_at, expires_at
  ) values (
    artifact_id, workspace_id, actor_id, '{}'::jsonb, 'completed',
    repeat('3', 64), repeat('4', 64), '{}', '{"attachments":[]}'::jsonb,
    image_digest, graphify_commit, clock_timestamp(),
    clock_timestamp() + interval '30 days'
  );
  insert into public.sourcing_lessons(
    id, workspace_id, role_fingerprint, platform, query_hmac, query_text,
    status, version, graphify_artifact_sha256, graphify_cluster_ref,
    graphify_commit, graphify_export_id, graphified_at, graphified_by,
    promoted_at, promoted_by, expires_at
  ) values (
    lesson_id, workspace_id, role_fingerprint, 'GitHub', query_hmac,
    query ->> 'value', 'promoted', 3, repeat('4', 64), 'github-go-1',
    graphify_commit, artifact_id, clock_timestamp(), actor_id,
    clock_timestamp(), actor_id, clock_timestamp() - interval '1 day'
  );
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000001', workspace_id, lesson_id,
    actor_id, 'human', 'sb-expired-promotion', 'draft', 'promoted',
    'reviewed_useful', 3
  );

  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000040',
    '80000000-0000-4000-8000-000000000040'
  );
  expired_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000040',
    '80000000-0000-4000-8000-000000000040', workspace_id,
    campaign_id, campaign_hash, 0
  );
  perform sb_test.expect('expired-lesson-ignored',
    expired_result ->> 'status' = 'authorized'
      and expired_result -> 'canonical_query' = query
      and expired_result -> 'applied_lesson' = 'null'::jsonb,
    expired_result::text);

  update public.sourcing_lessons
     set status = 'suspended', version = 4,
         expires_at = clock_timestamp() + interval '30 days',
         suspended_at = clock_timestamp(), updated_at = clock_timestamp()
   where sourcing_lessons.id = lesson_consumption_test.lesson_id
     and sourcing_lessons.workspace_id = lesson_consumption_test.workspace_id;
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000002', workspace_id, lesson_id,
    actor_id, 'human', 'sb-suspended-review', 'promoted', 'suspended',
    'quality_hold', 4
  );
  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000041',
    '80000000-0000-4000-8000-000000000041'
  );
  suspended_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000041',
    '80000000-0000-4000-8000-000000000041', workspace_id,
    campaign_id, campaign_hash, 0
  );
  perform sb_test.expect('suspended-lesson-ignored',
    suspended_result ->> 'status' = 'authorized'
      and suspended_result -> 'applied_lesson' = 'null'::jsonb,
    suspended_result::text);

  update public.sourcing_lessons
     set status = 'promoted', version = 5, promoted_by = actor_id,
         promoted_at = clock_timestamp(), updated_at = clock_timestamp()
   where sourcing_lessons.id = lesson_consumption_test.lesson_id
     and sourcing_lessons.workspace_id = lesson_consumption_test.workspace_id;
  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000042',
    '80000000-0000-4000-8000-000000000042'
  );
  review_mismatch_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000042',
    '80000000-0000-4000-8000-000000000042', workspace_id,
    campaign_id, campaign_hash, 0
  );
  perform sb_test.expect('promotion-review-version-mismatch-ignored',
    review_mismatch_result ->> 'status' = 'authorized'
      and review_mismatch_result -> 'applied_lesson' = 'null'::jsonb,
    review_mismatch_result::text);

  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000003', workspace_id, lesson_id,
    actor_id, 'human', 'sb-current-promotion', 'suspended', 'promoted',
    'reviewed_useful', 5
  );

  -- These fully formed lessons must never cross their workspace or role HMAC.
  insert into public.sourcing_graphify_exports(
    id, workspace_id, actor_id, export_payload, status, input_sha256,
    graph_sha256, graph_text, manifest, image_digest, graphify_commit,
    completed_at, expires_at
  ) values (
    '67000000-0000-4000-8000-000000000002', other_workspace_id,
    other_actor_id, '{}'::jsonb, 'completed', repeat('8', 64),
    repeat('9', 64), '{}', '{"attachments":[]}'::jsonb, image_digest,
    graphify_commit, clock_timestamp(), clock_timestamp() + interval '30 days'
  );
  insert into public.sourcing_learning_controls(
    workspace_id, enabled, required_graphify_image_digest, updated_by
  ) values (
    other_workspace_id, true, image_digest, other_actor_id
  ) on conflict on constraint sourcing_learning_controls_pkey do update
    set enabled = true,
        required_graphify_image_digest = excluded.required_graphify_image_digest,
        updated_by = excluded.updated_by;
  insert into public.sourcing_lessons(
    id, workspace_id, role_fingerprint, platform, query_hmac, query_text,
    status, version, graphify_artifact_sha256, graphify_cluster_ref,
    graphify_commit, graphify_export_id, graphified_at, graphified_by,
    promoted_at, promoted_by, expires_at
  ) values (
    '66000000-0000-4000-8000-000000000002', other_workspace_id,
    public.sourcing_authority_hmac(
      other_workspace_id,
      public.canonicalize_sourcing_role_basis(role_basis)::text
    ), 'GitHub', public.sourcing_authority_hmac(
      other_workspace_id,
      'query:GitHub:' || (query ->> 'value')
    ), query ->> 'value', 'promoted', 2, repeat('9', 64),
    'github-go-other', graphify_commit,
    '67000000-0000-4000-8000-000000000002', clock_timestamp(),
    other_actor_id, clock_timestamp(), other_actor_id,
    clock_timestamp() + interval '30 days'
  );
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000004', other_workspace_id,
    '66000000-0000-4000-8000-000000000002', other_actor_id, 'human',
    'sb-other-workspace-promotion', 'draft', 'promoted', 'reviewed_useful', 2
  );
  insert into public.sourcing_lessons(
    id, workspace_id, role_fingerprint, platform, query_hmac, query_text,
    status, version, graphify_artifact_sha256, graphify_cluster_ref,
    graphify_commit, graphify_export_id, graphified_at, graphified_by,
    promoted_at, promoted_by, expires_at
  ) values (
    '66000000-0000-4000-8000-000000000003', workspace_id,
    public.sourcing_authority_hmac(
      workspace_id,
      public.canonicalize_sourcing_role_basis(
        '{"title":"backend engineer","skills":["rust"]}'::jsonb
      )::text
    ), 'GitHub', query_hmac, query ->> 'value', 'promoted', 2,
    repeat('4', 64), 'github-go-wrong-role', graphify_commit, artifact_id,
    clock_timestamp(), actor_id, clock_timestamp(), actor_id,
    clock_timestamp() + interval '30 days'
  );
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000005', workspace_id,
    '66000000-0000-4000-8000-000000000003', actor_id, 'human',
    'sb-wrong-role-promotion', 'draft', 'promoted', 'reviewed_useful', 2
  );

  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000043',
    '80000000-0000-4000-8000-000000000043'
  );
  authorized_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000043',
    '80000000-0000-4000-8000-000000000043', workspace_id,
    campaign_id, campaign_hash, 0
  );
  claimed_snapshot := authorized_result -> 'applied_lesson';
  perform sb_test.expect('promoted-exact-role-lesson-selected',
    authorized_result ->> 'status' = 'authorized'
      and authorized_result -> 'canonical_query' = query
      and claimed_snapshot ->> 'lesson_id' = lesson_id::text
      and claimed_snapshot ->> 'lesson_version' = '5'
      and claimed_snapshot ->> 'workspace_id' = workspace_id::text
      and claimed_snapshot ->> 'role_fingerprint' = role_fingerprint
      and claimed_snapshot ->> 'graphify_export_id' = artifact_id::text
      and claimed_snapshot ->> 'graphify_artifact_sha256' = repeat('4', 64)
      and claimed_snapshot ->> 'query_hmac' = query_hmac
      and claimed_snapshot ->> 'query_value' = query ->> 'value'
      and claimed_snapshot ->> 'query_sha256' = query ->> 'sha256'
      and claimed_snapshot ->> 'snapshot_sha256'
        = public.sourcing_batch_lesson_snapshot_sha256(claimed_snapshot),
    authorized_result::text);

  update public.sourcing_lessons
     set status = 'suspended', version = 6,
         query_text = 'language:rust type:user',
         query_hmac = public.sourcing_authority_hmac(
           lesson_consumption_test.workspace_id,
           'query:GitHub:language:rust type:user'
         ),
         suspended_at = clock_timestamp(), updated_at = clock_timestamp()
   where sourcing_lessons.id = lesson_consumption_test.lesson_id
     and sourcing_lessons.workspace_id = lesson_consumption_test.workspace_id;
  repeated_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000043',
    '80000000-0000-4000-8000-000000000043', workspace_id,
    campaign_id, campaign_hash, 0
  );
  perform sb_test.expect('post-claim-lesson-mutation-cannot-change-snapshot',
    repeated_result -> 'applied_lesson' = claimed_snapshot
      and repeated_result -> 'canonical_query' = query,
    repeated_result::text);

  begun_result := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000043',
    '80000000-0000-4000-8000-000000000043', workspace_id,
    campaign_id, campaign_hash, 0,
    (authorized_result ->> 'claim_token')::uuid,
    (authorized_result ->> 'fence_version')::bigint,
    'anonymous', query ->> 'sha256'
  );
  result_hash := public.sourcing_batch_result_sha256(
    workspace_id, '70000000-0000-4000-8000-000000000043', campaign_id,
    campaign_hash, 0, (authorized_result ->> 'claim_token')::uuid,
    (authorized_result ->> 'fence_version')::bigint,
    (begun_result ->> 'egress_attempt_id')::uuid, query, '[]'::jsonb
  );
  commit_result := public.commit_sourcing_batch(
    '70000000-0000-4000-8000-000000000043',
    '80000000-0000-4000-8000-000000000043', workspace_id,
    campaign_id, campaign_hash, 0,
    (authorized_result ->> 'claim_token')::uuid,
    (authorized_result ->> 'fence_version')::bigint,
    (begun_result ->> 'egress_attempt_id')::uuid,
    query, '[]'::jsonb, sb_test.source_receipts_fixture(0, '[]'::jsonb),
    result_hash
  );
  perform sb_test.expect('completion-evidence-persists-applied-lesson',
    commit_result ->> 'status' = 'completed'
      and exists (
        select 1 from public.sourcing_batch_receipts receipt
         where receipt.job_id = '70000000-0000-4000-8000-000000000043'
           and receipt.canonical_query = query
           and receipt.applied_lesson = claimed_snapshot
      ), commit_result::text);

  replay_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000043',
    '80000000-0000-4000-8000-000000000043', workspace_id,
    campaign_id, campaign_hash, 0
  );
  perform sb_test.expect('completed-replay-returns-immutable-lesson-snapshot',
    replay_result ->> 'status' = 'no_op_replay'
      and replay_result -> 'canonical_query' = query
      and replay_result -> 'applied_lesson' = claimed_snapshot,
    replay_result::text);
end;
$$;

-- Graphify may reorder the finite, same-page language variants derived from
-- the role. It cannot introduce a query outside that allowlist, and the next
-- batch cannot repeat the variant already claimed for this campaign release.
do $$
<<adaptive_graphify_query_test>>
declare
  workspace_id constant uuid := '51111111-1111-4111-8111-111111111111';
  campaign_id constant uuid := '90000000-0000-4000-8000-000000000001';
  actor_id constant uuid := '60000000-0000-4000-8000-000000000001';
  artifact_id constant uuid := '67000000-0000-4000-8000-000000000001';
  role_basis jsonb := public.canonicalize_sourcing_role_basis(
    '{"title":"backend engineer","skills":["go","typescript"]}'::jsonb
  );
  default_query jsonb;
  learned_query jsonb;
  forbidden_query jsonb;
  role_fingerprint text;
  campaign_hash text;
  first_result jsonb;
  second_result jsonb;
begin
  default_query := public.sourcing_batch_expected_query(role_basis, 0);
  learned_query := public.sourcing_batch_expected_query(role_basis, 1);
  forbidden_query := jsonb_build_object(
    'policyVersion', 'github-deterministic-v2',
    'value', 'language:rust type:user',
    'page', 1,
    'sha256', encode(sha256(convert_to(
      'github-deterministic-v2' || E'\n' ||
      'language:rust type:user' || E'\npage:1',
      'UTF8'
    )), 'hex')
  );
  role_fingerprint := public.sourcing_authority_hmac(
    workspace_id,
    role_basis::text
  );
  campaign_hash := encode(sha256(convert_to(jsonb_build_object(
    'campaign_id', campaign_id::text,
    'workspace_id', workspace_id::text,
    'requisition_id', '91000000-0000-4000-8000-000000000001',
    'activation_actor_id', actor_id::text,
    'role_basis', role_basis,
    'parse_input_sha256', repeat('c', 64),
    'parse_result_sha256', repeat('d', 64)
  )::text, 'UTF8')), 'hex');
  update public.sourcing_campaigns campaign
     set role_basis = adaptive_graphify_query_test.role_basis,
         campaign_sha256 = adaptive_graphify_query_test.campaign_hash,
         status = 'sourcing', sourcing_pause_reason = null,
         sourcing_stop_reason = null, sourcing_completed_at = null,
         updated_at = clock_timestamp()
   where campaign.workspace_id = adaptive_graphify_query_test.workspace_id
     and campaign.id = adaptive_graphify_query_test.campaign_id;
  perform sb_test.set_document_campaign_status('Sourcing');

  insert into public.sourcing_lessons(
    id, workspace_id, role_fingerprint, platform, query_hmac, query_text,
    status, version, useful_feedback_count, evidence_run_count,
    graphify_artifact_sha256, graphify_cluster_ref, graphify_commit,
    graphify_export_id, graphified_at, graphified_by, promoted_at,
    promoted_by, expires_at
  ) values (
    '66000000-0000-4000-8000-000000000004', workspace_id,
    role_fingerprint, 'GitHub', public.sourcing_authority_hmac(
      workspace_id,
      'query:GitHub:' || (learned_query ->> 'value')
    ), learned_query ->> 'value', 'promoted', 1, 10, 10,
    repeat('4', 64), 'github-typescript-adaptive',
    '94d3099540550d58dd121ec3e67cf93e80364079', artifact_id,
    clock_timestamp(), actor_id, clock_timestamp(), actor_id,
    clock_timestamp() + interval '30 days'
  );
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000006', workspace_id,
    '66000000-0000-4000-8000-000000000004', actor_id, 'human',
    'sb-adaptive-typescript', 'draft', 'promoted', 'reviewed_useful', 1
  );

  -- Higher feedback cannot make an out-of-role query eligible.
  insert into public.sourcing_lessons(
    id, workspace_id, role_fingerprint, platform, query_hmac, query_text,
    status, version, useful_feedback_count, evidence_run_count,
    graphify_artifact_sha256, graphify_cluster_ref, graphify_commit,
    graphify_export_id, graphified_at, graphified_by, promoted_at,
    promoted_by, expires_at
  ) values (
    '66000000-0000-4000-8000-000000000005', workspace_id,
    role_fingerprint, 'GitHub', public.sourcing_authority_hmac(
      workspace_id,
      'query:GitHub:' || (forbidden_query ->> 'value')
    ), forbidden_query ->> 'value', 'promoted', 1, 100, 100,
    repeat('4', 64), 'github-rust-forbidden',
    '94d3099540550d58dd121ec3e67cf93e80364079', artifact_id,
    clock_timestamp(), actor_id, clock_timestamp(), actor_id,
    clock_timestamp() + interval '30 days'
  );
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values (
    '68000000-0000-4000-8000-000000000007', workspace_id,
    '66000000-0000-4000-8000-000000000005', actor_id, 'human',
    'sb-forbidden-rust', 'draft', 'promoted', 'reviewed_useful', 1
  );

  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000044',
    '80000000-0000-4000-8000-000000000044',
    'leased', clock_timestamp() + interval '10 minutes', 0
  );
  first_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000044',
    '80000000-0000-4000-8000-000000000044', workspace_id,
    campaign_id, campaign_hash, 0
  );
  perform sb_test.expect('graphify-reorders-allowed-query',
    first_result ->> 'status' = 'authorized'
      and first_result -> 'canonical_query' = learned_query
      and first_result -> 'canonical_query' <> default_query
      and first_result -> 'applied_lesson' ->> 'lesson_id'
        = '66000000-0000-4000-8000-000000000004'
      and public.sourcing_batch_query_is_allowed(
        role_basis, 0, first_result -> 'canonical_query'
      ), first_result::text);
  perform sb_test.expect('graphify-cannot-expand-query-authority',
    not public.sourcing_batch_query_is_allowed(role_basis, 0, forbidden_query));

  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000045',
    '80000000-0000-4000-8000-000000000045',
    'leased', clock_timestamp() + interval '10 minutes', 1
  );
  second_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000045',
    '80000000-0000-4000-8000-000000000045', workspace_id,
    campaign_id, campaign_hash, 1
  );
  perform sb_test.expect('adaptive-order-does-not-repeat-query',
    second_result ->> 'status' = 'authorized'
      and second_result -> 'canonical_query' = default_query
      and second_result -> 'applied_lesson' = 'null'::jsonb,
    second_result::text);
end;
$$;

-- Explicit authenticated mode is bound at every authority boundary and in
-- durable evidence. The credential itself never enters these SQL contracts.
do $$
declare
  campaign_hash text;
  auth_result jsonb;
  begin_result jsonb;
  commit_result jsonb;
  rejected_result jsonb;
  result_hash text;
  source_receipts jsonb;
  workspace_daily_units integer;
begin
  perform sb_test.resume_campaign();
  select campaign_sha256 into campaign_hash
    from public.sourcing_campaigns
   where id = '90000000-0000-4000-8000-000000000001';
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000046',
    '80000000-0000-4000-8000-000000000046',
    'leased', clock_timestamp() + interval '10 minutes', 4
  );
  rejected_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000046',
    '80000000-0000-4000-8000-000000000046',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 4, null::text
  );
  perform sb_test.expect('null-provider-mode-fails-closed',
    rejected_result ->> 'status' = 'invalid_request');
  auth_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000046',
    '80000000-0000-4000-8000-000000000046',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 4, 'authenticated'
  );
  begin_result := public.begin_sourcing_batch_egress(
    '70000000-0000-4000-8000-000000000046',
    '80000000-0000-4000-8000-000000000046',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 4,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    'authenticated', auth_result -> 'canonical_query' ->> 'sha256'
  );
  source_receipts := jsonb_build_array(jsonb_build_object(
    'provider', 'github',
    'providerMode', 'authenticated',
    'providerPage', auth_result -> 'canonical_query' -> 'page',
    'ordinal', 0,
    'endpointTemplate', '/search/users',
    'canonicalQuerySha256', auth_result -> 'canonical_query' ->> 'sha256',
    'outcome', 'success',
    'statusCode', 200,
    'responseBytes', 100,
    'responseSha256', repeat('a', 64)
  ));
  result_hash := public.sourcing_batch_result_sha256(
    '51111111-1111-4111-8111-111111111111',
    '70000000-0000-4000-8000-000000000046',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 4,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begin_result ->> 'egress_attempt_id')::uuid,
    auth_result -> 'canonical_query', '[]'::jsonb, 'authenticated'
  );
  commit_result := public.commit_sourcing_batch(
    '70000000-0000-4000-8000-000000000046',
    '80000000-0000-4000-8000-000000000046',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 4,
    (auth_result ->> 'claim_token')::uuid,
    (auth_result ->> 'fence_version')::bigint,
    (begin_result ->> 'egress_attempt_id')::uuid,
    auth_result -> 'canonical_query', '[]'::jsonb, source_receipts, result_hash
  );
  perform sb_test.expect('authenticated-authority-bound',
    auth_result ->> 'status' = 'authorized'
      and auth_result ->> 'provider_mode' = 'authenticated'
      and begin_result ->> 'status' = 'begun'
      and begin_result ->> 'provider_mode' = 'authenticated'
      and commit_result ->> 'status' = 'completed',
    jsonb_build_object('authorize', auth_result, 'begin', begin_result, 'commit', commit_result)::text);
  perform sb_test.expect('authenticated-durable-evidence-bound',
    coalesce((select provider_mode = 'authenticated'
       from public.sourcing_batch_receipts
      where job_id = '70000000-0000-4000-8000-000000000046'), false)
      and coalesce((select bool_and(receipt ->> 'providerMode' = 'authenticated')
             from public.sourcing_batch_source_receipts
            where job_id = '70000000-0000-4000-8000-000000000046'), false)
      and coalesce((select bool_and(provider_mode = 'authenticated') and count(*) = 3
             from public.sourcing_provider_quota_ledger
            where job_id = '70000000-0000-4000-8000-000000000046'), false),
    jsonb_build_object(
      'commit', commit_result,
      'completion_receipts', (select count(*) from public.sourcing_batch_receipts
        where job_id = '70000000-0000-4000-8000-000000000046'),
      'source_receipts', (select count(*) from public.sourcing_batch_source_receipts
        where job_id = '70000000-0000-4000-8000-000000000046'),
      'quota_rows', (select count(*) from public.sourcing_provider_quota_ledger
        where job_id = '70000000-0000-4000-8000-000000000046')
    )::text);

  select coalesce(sum(reserved_units), 0)::integer into workspace_daily_units
    from public.sourcing_provider_quota_ledger
   where workspace_id = '51111111-1111-4111-8111-111111111111'
     and provider = 'github' and scope_kind = 'workspace_batch_day'
     and window_start = date_trunc('day', clock_timestamp());
  update public.sourcing_loop_controls
     set max_sourcing_runs_per_day = workspace_daily_units
   where workspace_id = '51111111-1111-4111-8111-111111111111';
  perform sb_test.resume_campaign();
  perform sb_test.seed_job(
    '70000000-0000-4000-8000-000000000047',
    '80000000-0000-4000-8000-000000000047',
    'leased', clock_timestamp() + interval '10 minutes', 4
  );
  rejected_result := public.authorize_sourcing_batch(
    '70000000-0000-4000-8000-000000000047',
    '80000000-0000-4000-8000-000000000047',
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001', campaign_hash, 4, 'anonymous'
  );
  perform sb_test.expect('workspace-daily-quota-shared-across-provider-modes',
    rejected_result ->> 'status' = 'quota_exceeded', rejected_result::text);
  update public.sourcing_loop_controls
     set max_sourcing_runs_per_day = 100
   where workspace_id = '51111111-1111-4111-8111-111111111111';
end;
$$;

-- Claims are hard-capped and interleave due work across tenants before taking
-- a second job from either tenant.
do $$
declare
  claimed_count integer;
  claimed_workspaces integer;
  invalid_count integer;
begin
  update public.aria_jobs
     set next_run_at = clock_timestamp() + interval '1 hour'
   where kind = 'sourcing_batch' and status = 'queued';
  perform sb_test.seed_job('70000000-0000-4000-8000-000000000051', null, 'queued', null, 0,
    '51111111-1111-4111-8111-111111111111');
  perform sb_test.seed_job('70000000-0000-4000-8000-000000000052', null, 'queued', null, 0,
    '51111111-1111-4111-8111-111111111111');
  perform sb_test.seed_job('70000000-0000-4000-8000-000000000053', null, 'queued', null, 0,
    '52222222-2222-4222-8222-222222222222');
  perform sb_test.seed_job('70000000-0000-4000-8000-000000000054', null, 'queued', null, 0,
    '52222222-2222-4222-8222-222222222222');
  update public.aria_jobs
     set next_run_at = now() - interval '1 second'
   where id in (
    '70000000-0000-4000-8000-000000000051',
    '70000000-0000-4000-8000-000000000052',
    '70000000-0000-4000-8000-000000000053',
    '70000000-0000-4000-8000-000000000054'
   );
  select count(*) into invalid_count
    from public.claim_due_sourcing_batch_jobs('sb-fair-worker', 60, 4);
  select count(*), count(distinct workspace_id)
    into claimed_count, claimed_workspaces
    from public.claim_due_sourcing_batch_jobs('sb-fair-worker', 60, 2);
  perform sb_test.expect('sourcing-claim-hard-cap-rejects-oversize', invalid_count = 0);
  perform sb_test.expect('sourcing-claim-fair-first-pass',
    claimed_count = 2 and claimed_workspaces = 2,
    format('count=%s workspaces=%s', claimed_count, claimed_workspaces));
  perform sb_test.expect('sourcing-claim-leaves-one-per-tenant',
    (select count(*) = 2 and count(distinct workspace_id) = 2
       from public.aria_jobs
      where id in (
        '70000000-0000-4000-8000-000000000051',
        '70000000-0000-4000-8000-000000000052',
        '70000000-0000-4000-8000-000000000053',
        '70000000-0000-4000-8000-000000000054'
      ) and status = 'queued'));
  delete from public.aria_jobs where id in (
    '70000000-0000-4000-8000-000000000051',
    '70000000-0000-4000-8000-000000000052',
    '70000000-0000-4000-8000-000000000053',
    '70000000-0000-4000-8000-000000000054'
  );
end;
$$;

-- The erasure authority deletes the normalized evidence and its tombstone
-- prevents a later direct evidence reimport.
do $$
declare erasure jsonb;
begin
  erasure := public.request_candidate_erasure(
    '51111111-1111-4111-8111-111111111111',
    '60000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'github-6b1e14ad3c2edf998c26371f51cc7c14',
    '65000000-0000-4000-8000-000000000001'
  );
  perform sb_test.expect('erasure-request-accepted', erasure ->> 'status' in ('completed', 'manual_required'), erasure::text);
  perform sb_test.expect('erasure-cleans-source-evidence',
    (select count(*) from public.sourcing_candidate_evidence
      where candidate_id = 'github-6b1e14ad3c2edf998c26371f51cc7c14') = 0);
  perform sb_test.expect('erasure-receipt-recorded', exists(
    select 1 from public.candidate_erasure_receipts
     where request_id = (erasure ->> 'request_id')::uuid
       and store_name = 'sourcing_candidate_evidence'
  ));
end;
$$;
select sb_test.expect_sqlstate(
  'erasure-tombstone-blocks-evidence-reimport',
  $$insert into public.sourcing_candidate_evidence(
    workspace_id, campaign_id, candidate_id, job_id, egress_attempt_id,
    provider, provider_external_id, github_url, raw_response_sha256,
    normalized_payload_sha256, evidence
  ) select
    '51111111-1111-4111-8111-111111111111',
    '90000000-0000-4000-8000-000000000001',
    'github-6b1e14ad3c2edf998c26371f51cc7c14',
    '70000000-0000-4000-8000-000000000001',
    egress_attempt_id, 'github', '42', 'https://github.com/real-user',
    repeat('b',64), repeat('8',64), '{}'::jsonb
  from public.sourcing_batch_receipts
  where job_id = '70000000-0000-4000-8000-000000000001'$$,
  array['23514']
);

-- ACL/RLS and append-only proof.
select sb_test.expect('tables-force-rls', not exists (
  select 1 from pg_class relation
   where relation.oid in (
     'public.sourcing_batch_claims'::regclass,
     'public.sourcing_batch_egress_attempts'::regclass,
     'public.sourcing_batch_source_receipts'::regclass,
     'public.sourcing_candidate_evidence'::regclass,
     'public.sourcing_batch_receipts'::regclass,
     'public.sourcing_provider_quota_ledger'::regclass
   ) and (not relation.relrowsecurity or not relation.relforcerowsecurity)
));
select sb_test.expect('service-role-no-direct-table-read', not exists (
  select 1 from (values
    ('public.sourcing_batch_claims'),
    ('public.sourcing_batch_egress_attempts'),
    ('public.sourcing_batch_source_receipts'),
    ('public.sourcing_candidate_evidence'),
    ('public.sourcing_batch_receipts'),
    ('public.sourcing_provider_quota_ledger')
  ) table_name(name)
  where has_table_privilege('service_role', table_name.name, 'SELECT')
));
select sb_test.expect('service-role-execute-only',
  has_function_privilege('service_role',
    'public.get_sourcing_loop_readiness(text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.get_sourcing_loop_readiness(text)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.get_sourcing_loop_readiness(text)', 'EXECUTE'));
select sb_test.expect('fair-sourcing-claim-service-only',
  has_function_privilege('service_role',
    'public.claim_due_sourcing_batch_jobs(text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.claim_due_sourcing_batch_jobs(text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.claim_due_sourcing_batch_jobs(text,integer,integer)', 'EXECUTE'));
select sb_test.expect_sqlstate(
  'completion-receipts-append-only',
  $$update public.sourcing_batch_receipts set candidate_count = 0
    where job_id = '70000000-0000-4000-8000-000000000001'$$,
  array['42501']
);

do $$
declare failed integer;
begin
  select count(*) into failed from sb_test.results where not passed;
  if failed > 0 then
    raise exception 'sourcing-batch-db failed: %', (
      select jsonb_agg(jsonb_build_object('case', case_name, 'detail', detail))
      from sb_test.results where not passed
    );
  end if;
end;
$$;

select count(*) as assertions from sb_test.results;
SQL

echo "sourcing-batch-db: authority, fencing, merge, evidence, erasure, readiness, ACL: PASS"
