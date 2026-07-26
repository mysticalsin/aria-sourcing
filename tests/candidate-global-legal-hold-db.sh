#!/usr/bin/env bash
set -Eeuo pipefail

# Candidate-global legal-hold authority contract for migration 0066.
#
# This disposable PostgreSQL 17 harness performs no provider calls and reads no
# credentials. It proves that a legal hold is scoped to one workspace and one
# candidate identity, never to only the campaign that happened to place it.
# The contract covers:
#   * a hold in campaign A blocking an erasure requested in campaign B;
#   * multiple holds, exact release replay, expiry, and no temporary unblocking;
#   * blocked-request replay, one scrub, and idempotent completed replay;
#   * pending and completed provider obligations under a late hold;
#   * candidate-global retention of expired autonomous-web evidence, staged
#     provider payloads, and candidate-list membership;
#   * tenant isolation and owner-only row authority;
#   * deterministic hold-first and erasure-first advisory-lock ordering; and
#   * idempotent forward apply plus unconditional rollback refusal.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidate-global-hold-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
tmp_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  exec 9>&- 2>/dev/null || true
  for background_pid in \
    "${holder_pid:-}" "${first_pid:-}" "${second_pid:-}"; do
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
    --env PGPASSWORD="$bootstrap_password" \
    --env "PGAPPNAME=${PGAPPNAME:-candidate-global-legal-hold}" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

wait_for_advisory() {
  local application_name="$1"
  local process_id="$2"
  local log_path="$3"
  local deadline=$((SECONDS + 30))
  local wait_event=""

  while true; do
    wait_event="$(psql_stdin -Atqc "
      select coalesce(wait_event_type,'') || ':' || coalesce(wait_event,'')
        from pg_stat_activity
       where application_name = '${application_name}'
    ")"
    if [[ "$wait_event" == "Lock:advisory" ]]; then
      return 0
    fi
    if ! kill -0 "$process_id" >/dev/null 2>&1; then
      cat "$log_path" >&2
      echo "candidate-global-legal-hold-db: ${application_name} exited before waiting on the candidate authority lock" >&2
      return 1
    fi
    if (( SECONDS >= deadline )); then
      cat "$log_path" >&2
      echo "candidate-global-legal-hold-db: timed out waiting for ${application_name} advisory lock" >&2
      return 1
    fi
  done
}

wait_for_workspace_lock() {
  local application_name="$1"
  local process_id="$2"
  local log_path="$3"
  local deadline=$((SECONDS + 30))
  local wait_event=""

  while true; do
    wait_event="$(psql_stdin -Atqc "
      select coalesce(wait_event_type,'') || ':' || coalesce(wait_event,'')
        from pg_stat_activity
       where application_name = '${application_name}'
    ")"
    if [[ "$wait_event" == Lock:* && "$wait_event" != "Lock:advisory" ]]; then
      return 0
    fi
    if ! kill -0 "$process_id" >/dev/null 2>&1; then
      cat "$log_path" >&2
      echo "candidate-global-legal-hold-db: ${application_name} exited before waiting on workspace authority" >&2
      return 1
    fi
    if (( SECONDS >= deadline )); then
      cat "$log_path" >&2
      echo "candidate-global-legal-hold-db: timed out waiting for ${application_name} workspace lock" >&2
      return 1
    fi
  done
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

# Apply only the accepted foundation. Migration 0066 is applied explicitly so
# the missing-authority RED result and forward retry are both observable.
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if [[ "$base" > "0065_zzzzzzzz.sql" ]]; then
    break
  fi
  psql_stdin -q < "$migration"
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

migration="supabase/migrations/0066_candidate_global_legal_hold_authority.sql"
rollback="supabase/rollbacks/0066_candidate_global_legal_hold_authority.sql"

if [[ ! -f "$migration" ]]; then
  # Prove the inherited defect before reporting the expected RED. Under 0065,
  # a campaign-A hold is invisible to a campaign-B request for the same
  # workspace candidate identity, and the request scrubs both campaign copies.
  legacy_status="$(psql_stdin -Atq <<'SQL'
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '66a00000-0000-4000-8000-000000000099',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','legacy-hold-admin@example.test','',now(),
  '{}','{}',now(),now()
);
insert into public.workspaces(id,name,allowed_domain) values (
  '66999999-9999-4999-8999-999999999999',
  'Legacy cross-campaign hold probe','legacy-hold.example.test'
);
insert into public.profiles(id,email,full_name,workspace_id,role) values (
  '66a00000-0000-4000-8000-000000000099',
  'legacy-hold-admin@example.test','Legacy Hold Admin',
  '66999999-9999-4999-8999-999999999999','admin'
);
insert into public.workspace_state(workspace_id,state) values (
  '66999999-9999-4999-8999-999999999999',
  '{"candidates":[
    {"id":"linkedin-99999999999999999999999999999999","campaignId":"campaign-a","name":"Legacy Candidate","email":"legacy@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/legacy-hold","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}},
    {"id":"linkedin-99999999999999999999999999999999","campaignId":"campaign-b","name":"Legacy Candidate","email":"legacy@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/legacy-hold","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}}
  ],"activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],"ledger":[],"suppression":[],"campaigns":[],"chats":[],"ingestedMessageIds":[],"chatboxSubmissions":[]}'
);
set role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"66a00000-0000-4000-8000-000000000099","role":"service_role"}',
  false
) \gset
select set_config(
  'request.jwt.claim.sub','66a00000-0000-4000-8000-000000000099',false
) \gset
select set_config('request.jwt.claim.role','service_role',false) \gset
select public.place_candidate_legal_hold(
  '66999999-9999-4999-8999-999999999999',
  '66a00000-0000-4000-8000-000000000099',
  'campaign-a','linkedin-99999999999999999999999999999999',
  'LITIGATION','case:0066-legacy-probe',now() + interval '1 day'
) \gset
select public.request_candidate_erasure(
  '66999999-9999-4999-8999-999999999999',
  '66a00000-0000-4000-8000-000000000099',
  'campaign-b','linkedin-99999999999999999999999999999999',
  '66f00000-0000-4000-8000-000000000099'
) ->> 'status';
SQL
)"
  if [[ "$legacy_status" == "blocked_legal_hold" ]]; then
    echo "candidate-global-legal-hold-db: 0065 unexpectedly already provides candidate-global hold authority" >&2
    exit 1
  fi
  echo "candidate-global-legal-hold-db RED: 0065 returned ${legacy_status} for campaign-B erasure while the campaign-A hold remained active; ${migration} is absent" >&2
  exit 1
fi

if [[ ! -f "$rollback" ]]; then
  echo "candidate-global-legal-hold-db: found ${migration} but no matching guarded rollback" >&2
  exit 1
fi

psql_stdin -q < "$migration"
# Forward migration retry must be a no-op, not a duplicate-function or index
# failure. This is the deploy retry path after an ambiguous runner response.
psql_stdin -q < "$migration"

# 0066 closes a destructive legal bypass and is intentionally irreversible.
# Prove refusal even before any 0066 authority row exists; a data-dependent
# rollback guard would leave an unsafe downgrade path on an empty tenant.
empty_rollback_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'request',md5(pg_get_functiondef(
      'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'::regprocedure
    )),
    'place',md5(pg_get_functiondef(
      'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure
    )),
    'lock_helper',md5(pg_get_functiondef(
      'public.candidate_legal_hold_lock_key(uuid,text)'::regprocedure
    ))
  )::text
")"
if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/empty-rollback.log" 2>&1; then
  echo "candidate-global-legal-hold-db: empty 0066 rollback unexpectedly succeeded" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:' "$tmp_dir/empty-rollback.log"
empty_rollback_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'request',md5(pg_get_functiondef(
      'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'::regprocedure
    )),
    'place',md5(pg_get_functiondef(
      'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure
    )),
    'lock_helper',md5(pg_get_functiondef(
      'public.candidate_legal_hold_lock_key(uuid,text)'::regprocedure
    ))
  )::text
")"
if [[ "$empty_rollback_after" != "$empty_rollback_before" ]]; then
  echo "candidate-global-legal-hold-db: refused empty rollback partially mutated 0066 authority" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
create schema candidate_global_hold_test;
create table candidate_global_hold_test.results(
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table candidate_global_hold_test.outputs(
  case_name text primary key,
  result jsonb not null
);
create table candidate_global_hold_test.context(
  key text primary key,
  value text not null
);

create function candidate_global_hold_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, candidate_global_hold_test
as $$
begin
  insert into candidate_global_hold_test.results(case_name,passed,detail)
  values (p_case_name,coalesce(p_passed,false),p_detail);
end;
$$;

create function candidate_global_hold_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, candidate_global_hold_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform candidate_global_hold_test.expect(
      p_case_name,
      caught = any(p_expected),
      format('caught SQLSTATE %s, expected %s',caught,p_expected)
    );
    return;
  end;
  perform candidate_global_hold_test.expect(
    p_case_name,false,'statement unexpectedly succeeded'
  );
end;
$$;

create function candidate_global_hold_test.set_service_claims(p_subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',p_subject,'role','service_role')::text,
    false
  );
  perform set_config('request.jwt.claim.sub',p_subject::text,false);
  perform set_config('request.jwt.claim.role','service_role',false);
end;
$$;

grant usage on schema candidate_global_hold_test to service_role;
grant select,insert,update on all tables in schema candidate_global_hold_test to service_role;
grant execute on all functions in schema candidate_global_hold_test to service_role;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('66a00000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','global-hold-admin@example.test','',now(),'{}','{}',now(),now()),
  ('66a00000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','global-hold-other@example.test','',now(),'{}','{}',now(),now()),
  ('66a00000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','global-hold-member@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name,allowed_domain) values
  ('66111111-1111-4111-8111-111111111111','Global hold tenant','global-hold.example.test'),
  ('66222222-2222-4222-8222-222222222222','Other hold tenant','other-global-hold.example.test');
insert into public.profiles(id,email,full_name,workspace_id,role) values
  ('66a00000-0000-4000-8000-000000000001','global-hold-admin@example.test','Global Hold Admin','66111111-1111-4111-8111-111111111111','admin'),
  ('66a00000-0000-4000-8000-000000000002','global-hold-other@example.test','Other Global Hold Admin','66222222-2222-4222-8222-222222222222','admin'),
  ('66a00000-0000-4000-8000-000000000003','global-hold-member@example.test','Global Hold Member','66111111-1111-4111-8111-111111111111','member');

insert into public.workspace_state(workspace_id,state) values
  ('66111111-1111-4111-8111-111111111111','{
    "candidates":[
      {"id":"linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","campaignId":"legal-campaign-a","name":"Global Candidate","email":"global-candidate@example.test","phone":"+14155550166","linkedinUrl":"https://www.linkedin.com/in/global-candidate","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}},
      {"id":"linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","campaignId":"93000000-0000-4000-8000-000000000066","name":"Global Candidate","email":"global-candidate@example.test","phone":"+14155550166","linkedinUrl":"https://www.linkedin.com/in/global-candidate","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}},
      {"id":"linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","campaignId":"legal-campaign-a","name":"Hold First","email":"hold-first@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/hold-first","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}},
      {"id":"linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","campaignId":"93000000-0000-4000-8000-000000000066","name":"Hold First","email":"hold-first@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/hold-first","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}},
      {"id":"linkedin-cccccccccccccccccccccccccccccccc","campaignId":"legal-campaign-a","name":"Erase First","email":"erase-first@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/erase-first","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}},
      {"id":"linkedin-cccccccccccccccccccccccccccccccc","campaignId":"93000000-0000-4000-8000-000000000066","name":"Erase First","email":"erase-first@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/erase-first","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}}
    ],
    "activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }'),
  ('66222222-2222-4222-8222-222222222222','{
    "candidates":[
      {"id":"linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","campaignId":"93000000-0000-4000-8000-000000000066","name":"Other Tenant Candidate","email":"other-tenant@example.test","phone":"","linkedinUrl":"https://www.linkedin.com/in/other-tenant-candidate","githubUrl":"","sourceUrl":"","sourceExternalId":"","sourceAuthorityId":"","sourcePlatform":"Manual","createdAt":"2026-07-26T00:00:00Z","complianceFlags":{"anonymized":false,"gdprExportRequested":false}}
    ],"activities":[],"outreach":[],"replies":[],"bookings":[],"wins":[],
    "ledger":[],"suppression":[],"campaigns":[],"chats":[],
    "ingestedMessageIds":[],"chatboxSubmissions":[]
  }');

-- The 0065 request trigger deletes list authority whenever a request is not
-- blocked. A campaign-A hold must therefore protect campaign-B membership
-- before any candidate-global request trigger is allowed to run cleanup.
insert into public.candidate_lists(id,workspace_id,name,created_by) values (
  '96000000-0000-4000-8000-000000000066',
  '66111111-1111-4111-8111-111111111111','0066 held candidate list',
  '66a00000-0000-4000-8000-000000000001'
);
do $seed_candidate_list$
declare
  attestation_id bigint;
  attestation_recorded_at timestamptz := clock_timestamp();
begin
  insert into public.candidate_contact_attestations(
    workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
    evidence_sha256,recorded_by,recorded_at
  ) values (
    '66111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','manual_provenance',
    'operator_verified',repeat('0',64),
    '66a00000-0000-4000-8000-000000000001',attestation_recorded_at
  ) returning id into attestation_id;
  insert into public.candidate_list_members(
    workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
    evidence_attestation_id,evidence_sha256,evidence_recorded_at,
    added_by
  ) values (
    '66111111-1111-4111-8111-111111111111',
    '96000000-0000-4000-8000-000000000066',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','manual_attestation',
    attestation_id,repeat('0',64),attestation_recorded_at,
    '66a00000-0000-4000-8000-000000000001'
  );
end
$seed_candidate_list$;

insert into public.messages_outbound(
  id,workspace_id,candidate_id,channel,to_address,type,subject,body,status,
  dedupe_hash,provider_message_id
) values
  ('66b00000-0000-4000-8000-000000000001','66111111-1111-4111-8111-111111111111','linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','Email','global-candidate@example.test','candidate_reply','Subject','Email body','sent',repeat('1',64),'gmail-message-0066'),
  ('66b00000-0000-4000-8000-000000000002','66111111-1111-4111-8111-111111111111','linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LinkedIn','https://www.linkedin.com/in/global-candidate','candidate_reply','Subject','LinkedIn body','sent',repeat('2',64),'linkedin-message-0066');

-- Seed one internally consistent autonomous-web authority chain. Its evidence
-- belongs to campaign B and is already expired; a hold in campaign A must
-- nevertheless preserve it because both rows name the same candidate identity.
insert into public.requisitions(
  id,workspace_id,source_kind,source_ref,status,campaign_id,
  parsed_job_analysis,parse_input_sha256,parse_result_sha256
) values (
  '94000000-0000-4000-8000-000000000066',
  '66111111-1111-4111-8111-111111111111','api','0066-retention',
  'campaign_created','93000000-0000-4000-8000-000000000066',
  '{"title":"sales director","requiredSkills":["enterprise sales"]}',
  repeat('3',64),repeat('4',64)
);
insert into public.sourcing_campaigns(
  id,workspace_id,requisition_id,activation_actor_id,status,role_basis,
  parse_input_sha256,parse_result_sha256,campaign_sha256
) values (
  '93000000-0000-4000-8000-000000000066',
  '66111111-1111-4111-8111-111111111111',
  '94000000-0000-4000-8000-000000000066',
  '66a00000-0000-4000-8000-000000000001','sourcing',
  '{"title":"sales director","skills":["enterprise sales"]}',
  repeat('3',64),repeat('4',64),repeat('5',64)
);
insert into public.api_keys(
  id,workspace_id,name,provider,secret,last4,status,last_tested_at,
  created_by,verification_method,verification_http_status
) values (
  '95000000-0000-4000-8000-000000000066',
  '66111111-1111-4111-8111-111111111111','0066 Tavily fixture','Tavily',
  'disposable-test-only-never-read','test','valid',clock_timestamp(),
  '66a00000-0000-4000-8000-000000000001','tavily_key_info_v1',200
);
do $seed_autonomous_web$
declare
  role_basis constant jsonb := '{"title":"sales director","skills":["enterprise sales"]}'::jsonb;
  canonical_query jsonb;
  request_payload jsonb;
  job_payload jsonb;
  authorized_at_value timestamptz := clock_timestamp();
  begun_at_value timestamptz := clock_timestamp();
begin
  canonical_query := public.autonomous_web_sourcing_expected_query(role_basis,0);
  request_payload := public.autonomous_web_sourcing_request(canonical_query);
  job_payload := jsonb_build_object(
    'campaign_id','93000000-0000-4000-8000-000000000066',
    'campaign_sha256',repeat('5',64),'batch_ordinal',0
  );
  insert into public.aria_jobs(
    id,workspace_id,kind,idempotency_key,payload,payload_sha256,status,
    attempt_count,max_attempts,next_run_at,lease_id,lease_expires_at,claimed_by
  ) values (
    '71000000-0000-4000-8000-000000000066',
    '66111111-1111-4111-8111-111111111111','sourcing_batch',
    '0066-retention-job',job_payload,
    encode(sha256(convert_to(job_payload::text,'UTF8')),'hex'),
    'leased',1,4,clock_timestamp(),
    '81000000-0000-4000-8000-000000000066',
    clock_timestamp() + interval '10 minutes','0066-test-worker'
  );
  insert into public.autonomous_web_sourcing_claims(
    job_id,lease_id,workspace_id,requisition_id,campaign_id,
    campaign_sha256,batch_ordinal,claim_token,fence_version,provider,
    credential_id,credential_version,credential_verified_at,
    query_policy_version,canonical_query,canonical_query_sha256,
    request_sha256,role_basis_sha256,authorized_at,expires_at
  ) values (
    '71000000-0000-4000-8000-000000000066',
    '81000000-0000-4000-8000-000000000066',
    '66111111-1111-4111-8111-111111111111',
    '94000000-0000-4000-8000-000000000066',
    '93000000-0000-4000-8000-000000000066',repeat('5',64),0,
    '76000000-0000-4000-8000-000000000066',1,'tavily',
    '95000000-0000-4000-8000-000000000066',repeat('6',64),
    clock_timestamp(),'tavily-linkedin-deterministic-v1',canonical_query,
    canonical_query ->> 'sha256',
    public.autonomous_web_sourcing_request_sha256(request_payload),repeat('7',64),
    authorized_at_value,authorized_at_value + interval '2 minutes'
  );
  insert into public.autonomous_web_sourcing_attempts(
    id,job_id,lease_id,workspace_id,requisition_id,campaign_id,
    claim_token,fence_version,provider,credential_id,credential_version,
    query_policy_version,canonical_query_sha256,request_sha256,
    begun_at,egress_expires_at
  ) values (
    '72000000-0000-4000-8000-000000000066',
    '71000000-0000-4000-8000-000000000066',
    '81000000-0000-4000-8000-000000000066',
    '66111111-1111-4111-8111-111111111111',
    '94000000-0000-4000-8000-000000000066',
    '93000000-0000-4000-8000-000000000066',
    '76000000-0000-4000-8000-000000000066',1,'tavily',
    '95000000-0000-4000-8000-000000000066',repeat('6',64),
    'tavily-linkedin-deterministic-v1',canonical_query ->> 'sha256',
    public.autonomous_web_sourcing_request_sha256(request_payload),
    begun_at_value,begun_at_value + interval '30 seconds'
  );

  -- Independent expired control: cleanup must still remove unheld PII while
  -- preserving the held chain. This prevents a globally disabled cleanup
  -- implementation from satisfying the preservation assertions.
  job_payload := job_payload || '{"batch_ordinal":1}'::jsonb;
  insert into public.aria_jobs(
    id,workspace_id,kind,idempotency_key,payload,payload_sha256,status,
    attempt_count,max_attempts,next_run_at,lease_id,lease_expires_at,claimed_by
  ) values (
    '71000000-0000-4000-8000-000000000067',
    '66111111-1111-4111-8111-111111111111','sourcing_batch',
    '0066-retention-control-job',job_payload,
    encode(sha256(convert_to(job_payload::text,'UTF8')),'hex'),
    'leased',1,4,clock_timestamp(),
    '81000000-0000-4000-8000-000000000067',
    clock_timestamp() + interval '10 minutes','0066-test-worker'
  );
  insert into public.autonomous_web_sourcing_claims(
    job_id,lease_id,workspace_id,requisition_id,campaign_id,
    campaign_sha256,batch_ordinal,claim_token,fence_version,provider,
    credential_id,credential_version,credential_verified_at,
    query_policy_version,canonical_query,canonical_query_sha256,
    request_sha256,role_basis_sha256,authorized_at,expires_at
  ) values (
    '71000000-0000-4000-8000-000000000067',
    '81000000-0000-4000-8000-000000000067',
    '66111111-1111-4111-8111-111111111111',
    '94000000-0000-4000-8000-000000000066',
    '93000000-0000-4000-8000-000000000066',repeat('5',64),1,
    '76000000-0000-4000-8000-000000000067',1,'tavily',
    '95000000-0000-4000-8000-000000000066',repeat('6',64),
    clock_timestamp(),'tavily-linkedin-deterministic-v1',canonical_query,
    canonical_query ->> 'sha256',
    public.autonomous_web_sourcing_request_sha256(request_payload),repeat('7',64),
    authorized_at_value,authorized_at_value + interval '2 minutes'
  );
  insert into public.autonomous_web_sourcing_attempts(
    id,job_id,lease_id,workspace_id,requisition_id,campaign_id,
    claim_token,fence_version,provider,credential_id,credential_version,
    query_policy_version,canonical_query_sha256,request_sha256,
    begun_at,egress_expires_at
  ) values (
    '72000000-0000-4000-8000-000000000067',
    '71000000-0000-4000-8000-000000000067',
    '81000000-0000-4000-8000-000000000067',
    '66111111-1111-4111-8111-111111111111',
    '94000000-0000-4000-8000-000000000066',
    '93000000-0000-4000-8000-000000000066',
    '76000000-0000-4000-8000-000000000067',1,'tavily',
    '95000000-0000-4000-8000-000000000066',repeat('6',64),
    'tavily-linkedin-deterministic-v1',canonical_query ->> 'sha256',
    public.autonomous_web_sourcing_request_sha256(request_payload),
    begun_at_value,begun_at_value + interval '30 seconds'
  );
end
$seed_autonomous_web$;
insert into public.autonomous_web_sourcing_results(
  egress_attempt_id,job_id,workspace_id,raw_response_sha256,
  raw_response_bytes,normalized_results_sha256,provider_receipt_sha256,
  result_sha256,result_count,recorded_at
) values (
  '72000000-0000-4000-8000-000000000066',
  '71000000-0000-4000-8000-000000000066',
  '66111111-1111-4111-8111-111111111111',repeat('a',64),512,
  repeat('b',64),repeat('c',64),repeat('d',64),1,
  clock_timestamp() - interval '1 day'
);
insert into public.autonomous_web_sourcing_staged_results(
  egress_attempt_id,workspace_id,normalized_results,provider_receipt,expires_at
) values (
  '72000000-0000-4000-8000-000000000066',
  '66111111-1111-4111-8111-111111111111',
  '[{"url":"https://www.linkedin.com/in/global-candidate","name":"Global Candidate"}]',
  '{"provider":"tavily","requestId":"0066-disposable-fixture"}',
  clock_timestamp() - interval '1 second'
);
insert into public.autonomous_web_candidate_evidence(
  workspace_id,campaign_id,candidate_id,egress_attempt_id,provider,
  provider_external_id,linkedin_url,canonical_query_sha256,
  raw_response_sha256,provider_result_sha256,normalized_payload_sha256,
  role_evidence,recorded_at,expires_at
) values (
  '66111111-1111-4111-8111-111111111111',
  '93000000-0000-4000-8000-000000000066',
  'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '72000000-0000-4000-8000-000000000066','tavily',repeat('8',64),
  'https://www.linkedin.com/in/global-candidate',repeat('9',64),
  repeat('a',64),repeat('b',64),repeat('c',64),
  '{"title":"sales director","evidence":"public profile"}',
  clock_timestamp() - interval '181 days',clock_timestamp() - interval '1 second'
);
insert into public.autonomous_web_sourcing_results(
  egress_attempt_id,job_id,workspace_id,raw_response_sha256,
  raw_response_bytes,normalized_results_sha256,provider_receipt_sha256,
  result_sha256,result_count,recorded_at
) values (
  '72000000-0000-4000-8000-000000000067',
  '71000000-0000-4000-8000-000000000067',
  '66111111-1111-4111-8111-111111111111',repeat('1',64),256,
  repeat('2',64),repeat('3',64),repeat('4',64),1,
  clock_timestamp() - interval '1 day'
);
insert into public.autonomous_web_sourcing_staged_results(
  egress_attempt_id,workspace_id,normalized_results,provider_receipt,expires_at
) values (
  '72000000-0000-4000-8000-000000000067',
  '66111111-1111-4111-8111-111111111111',
  '[{"url":"https://www.linkedin.com/in/unheld-control","name":"Unheld Control"}]',
  '{"provider":"tavily","requestId":"0066-unheld-control"}',
  clock_timestamp() - interval '1 second'
);
insert into public.autonomous_web_candidate_evidence(
  workspace_id,campaign_id,candidate_id,egress_attempt_id,provider,
  provider_external_id,linkedin_url,canonical_query_sha256,
  raw_response_sha256,provider_result_sha256,normalized_payload_sha256,
  role_evidence,recorded_at,expires_at
) values (
  '66111111-1111-4111-8111-111111111111',
  '93000000-0000-4000-8000-000000000066',
  'linkedin-dddddddddddddddddddddddddddddddd',
  '72000000-0000-4000-8000-000000000067','tavily',repeat('f',64),
  'https://www.linkedin.com/in/unheld-control',repeat('9',64),
  repeat('1',64),repeat('2',64),repeat('3',64),
  '{"title":"unheld control","evidence":"public profile"}',
  clock_timestamp() - interval '181 days',clock_timestamp() - interval '1 second'
);
SQL

psql_stdin -q <<'SQL'
select candidate_global_hold_test.expect(
  'given_candidate_hold_tables_when_untrusted_roles_are_inspected_then_no_direct_dml_or_select_authority_exists',
  not exists (
    select 1
      from unnest(array['anon','authenticated','service_role']) role_name,
           unnest(array[
             'candidate_legal_holds','candidate_erasure_requests',
             'candidate_erasure_suppression_tombstones',
             'candidate_erasure_receipts','candidate_erasure_obligations'
           ]) table_name,
           unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege_name
     where has_table_privilege(
       role_name,'public.' || table_name,privilege_name
     )
  )
);
select candidate_global_hold_test.expect(
  'given_public_hold_wrappers_when_acl_is_inspected_then_service_role_is_the_only_runtime_executor',
  has_function_privilege('service_role','public.request_candidate_erasure(uuid,uuid,text,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','public.release_candidate_legal_hold(uuid,uuid,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.list_candidate_erasure_requests(uuid,uuid,integer)','EXECUTE')
  and has_function_privilege('service_role','public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)','EXECUTE')
  and has_function_privilege('service_role','public.cleanup_autonomous_web_sourcing_retention(integer)','EXECUTE')
  and not exists (
    select 1
      from unnest(array['anon','authenticated','authenticator']) role_name,
           unnest(array[
             'public.request_candidate_erasure(uuid,uuid,text,text,uuid)',
             'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)',
             'public.release_candidate_legal_hold(uuid,uuid,uuid,text)',
             'public.list_candidate_erasure_requests(uuid,uuid,integer)',
             'public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)',
             'public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)',
             'public.cleanup_autonomous_web_sourcing_retention(integer)'
           ]) signature
     where has_function_privilege(role_name,signature,'EXECUTE')
  )
  and not exists (
    select 1
      from pg_proc routine
      cross join lateral aclexplode(
        coalesce(routine.proacl,acldefault('f',routine.proowner))
      ) privilege
     where routine.oid in (
       'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'::regprocedure,
       'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure,
       'public.release_candidate_legal_hold(uuid,uuid,uuid,text)'::regprocedure,
       'public.list_candidate_erasure_requests(uuid,uuid,integer)'::regprocedure,
       'public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)'::regprocedure,
       'public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)'::regprocedure,
       'public.cleanup_autonomous_web_sourcing_retention(integer)'::regprocedure
     )
       and privilege.grantee=0
       and privilege.privilege_type='EXECUTE'
  )
);
select candidate_global_hold_test.expect(
  'given_0066_predecessors_and_scope_reconciler_when_acl_is_inspected_then_they_are_owner_only',
  to_regprocedure('public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)') is not null
  and to_regprocedure('public.place_candidate_legal_hold_pre0066(uuid,uuid,text,text,text,text,timestamptz)') is not null
  and to_regprocedure('public.release_candidate_legal_hold_pre0066(uuid,uuid,uuid,text)') is not null
  and to_regprocedure('public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)') is not null
  and to_regprocedure('public.read_candidate_erasure_obligation_authority_pre0066(uuid,uuid,uuid)') is not null
  and to_regprocedure('public.reconcile_candidate_erasure_obligation_pre0066(uuid,uuid,uuid,integer,text,text,text,text)') is not null
  and to_regprocedure('public.reconcile_candidate_erasure_legal_hold_scope(uuid,text)') is not null
  and not has_function_privilege('service_role','public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.reconcile_candidate_erasure_legal_hold_scope(uuid,text)','EXECUTE')
  and not has_function_privilege('service_role','public.refresh_candidate_erasure_legal_hold_state(uuid)','EXECUTE')
);
select candidate_global_hold_test.expect(
  'given_candidate_global_hold_authority_when_lock_contracts_are_inspected_then_the_two_integer_aria_namespace_is_workspace_first_and_never_prelocks_erasure_identities',
  to_regprocedure('public.candidate_legal_hold_lock_key(uuid,text)') is not null
  and pg_get_function_result(
    'public.candidate_legal_hold_lock_key(uuid,text)'::regprocedure
  )='integer'
  and not has_function_privilege(
    'service_role','public.candidate_legal_hold_lock_key(uuid,text)','EXECUTE'
  )
  and (
    select position(
        'from public.workspace_state' in lower(pg_get_functiondef(routine.oid))
      ) > 0
      and position(
        'from public.workspace_state' in lower(pg_get_functiondef(routine.oid))
      ) < position('for update' in lower(pg_get_functiondef(routine.oid)))
      and position(
        'for update' in lower(pg_get_functiondef(routine.oid))
      ) < position(
        'candidate_legal_hold_lock_key' in lower(pg_get_functiondef(routine.oid))
      )
      and lower(pg_get_functiondef(routine.oid)) ~
        'pg_advisory_xact_lock[[:space:]]*\([[:space:]]*1095911745[[:space:]]*,[[:space:]]*(public\.)?candidate_legal_hold_lock_key'
      and position(
        'candidate_legal_hold_lock_key' in lower(pg_get_functiondef(routine.oid))
      ) < position(
        'request_candidate_erasure_pre0066' in lower(pg_get_functiondef(routine.oid))
      )
      and lower(pg_get_functiondef(routine.oid))
        not like '%candidate_erasure_identity_lock_key%'
      from pg_proc routine
     where routine.oid =
       'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'::regprocedure
  )
  and (
    select bool_and(
      position(
        'from public.workspace_state' in lower(pg_get_functiondef(routine.oid))
      ) > 0
      and position(
        'from public.workspace_state' in lower(pg_get_functiondef(routine.oid))
      ) < position('for share' in lower(pg_get_functiondef(routine.oid)))
      and position('for share' in lower(pg_get_functiondef(routine.oid)))
        < position(
          'candidate_legal_hold_lock_key' in lower(pg_get_functiondef(routine.oid))
        )
      and position(
        'candidate_legal_hold_lock_key'
          in lower(pg_get_functiondef(routine.oid))
      ) > 0
      and lower(pg_get_functiondef(routine.oid)) ~
        'pg_advisory_xact_lock[[:space:]]*\([[:space:]]*1095911745[[:space:]]*,[[:space:]]*(public\.)?candidate_legal_hold_lock_key'
      and lower(pg_get_functiondef(routine.oid))
        not like '%candidate_erasure_identity_lock_key%'
    )
      from pg_proc routine
     where routine.oid in (
       'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure,
       'public.release_candidate_legal_hold(uuid,uuid,uuid,text)'::regprocedure,
       'public.refresh_candidate_erasure_legal_hold_state(uuid)'::regprocedure,
       'public.read_candidate_erasure_obligation_authority(uuid,uuid,uuid)'::regprocedure,
       'public.reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)'::regprocedure,
       'public.reconcile_candidate_erasure_legal_hold_scope(uuid,text)'::regprocedure,
       'public.cleanup_autonomous_web_sourcing_retention(integer)'::regprocedure
     )
  )
);

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'hold-a',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LITIGATION',
    'case:global-hold-a',clock_timestamp() + interval '1 day'
  )
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'hold-a-replay',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LITIGATION',
    'case:global-hold-a',
    (select (result ->> 'expires_at')::timestamptz
       from candidate_global_hold_test.outputs where case_name='hold-a')
  )
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'hold-a-conflict',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','REGULATORY',
    'case:changed-global-hold-a',clock_timestamp() + interval '2 days'
  )
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'hold-b',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','REGULATORY',
    'case:global-hold-b',clock_timestamp() + interval '1 day'
  )
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'blocked-request',public.request_candidate_erasure(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66f00000-0000-4000-8000-000000000001'
  )
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'blocked-replay',public.request_candidate_erasure(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66f00000-0000-4000-8000-000000000001'
  )
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'idempotency-conflict',public.request_candidate_erasure(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66f00000-0000-4000-8000-000000000001'
  )
);
select public.cleanup_autonomous_web_sourcing_retention(500);

select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000002'
);
insert into candidate_global_hold_test.outputs(case_name,result) values
  ('other-tenant-request',public.request_candidate_erasure(
    '66222222-2222-4222-8222-222222222222',
    '66a00000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66f00000-0000-4000-8000-000000000002'
  ));
select candidate_global_hold_test.expect_sqlstate(
  'given_another_tenant_admin_when_workspace_a_hold_is_requested_then_42501_is_raised',
  $$select public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000002','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LITIGATION',
    'case:cross-tenant',clock_timestamp() + interval '1 day'
  )$$,
  array['42501']
);
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000003'
);
select candidate_global_hold_test.expect_sqlstate(
  'given_a_same_workspace_non_admin_when_a_hold_is_requested_then_42501_is_raised',
  $$select public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000003','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LITIGATION',
    'case:member-denied',clock_timestamp() + interval '1 day'
  )$$,
  array['42501']
);
reset role;

select candidate_global_hold_test.expect(
  'given_an_exact_hold_replay_and_changed_parameters_when_placement_is_retried_then_replay_is_stable_and_changed_evidence_conflicts',
  (select result ->> 'status'='active'
          and not (result ->> 'replayed')::boolean
     from candidate_global_hold_test.outputs where case_name='hold-a')
  and (select result ->> 'status'='active'
          and (result ->> 'replayed')::boolean
     from candidate_global_hold_test.outputs where case_name='hold-a-replay')
  and (select result ->> 'status'='conflict'
     from candidate_global_hold_test.outputs where case_name='hold-a-conflict')
  and (select primary_hold.result ->> 'hold_id'=replay.result ->> 'hold_id'
     from candidate_global_hold_test.outputs primary_hold
     join candidate_global_hold_test.outputs replay on replay.case_name='hold-a-replay'
    where primary_hold.case_name='hold-a')
);
select candidate_global_hold_test.expect(
  'given_a_campaign_a_hold_when_campaign_b_erasure_is_requested_then_the_candidate_global_request_is_blocked',
  (select result ->> 'status' = 'blocked_legal_hold'
     from candidate_global_hold_test.outputs where case_name='blocked-request')
  and (select result ->> 'status' = 'blocked_legal_hold'
          and (result ->> 'replayed')::boolean
         from candidate_global_hold_test.outputs where case_name='blocked-replay')
);
select candidate_global_hold_test.expect(
  'given_a_blocked_candidate_global_request_when_the_same_key_changes_campaign_then_idempotency_conflict_is_returned',
  (select result ->> 'status' = 'idempotency_conflict'
     from candidate_global_hold_test.outputs where case_name='idempotency-conflict')
);
select candidate_global_hold_test.expect(
  'given_two_active_cross_campaign_holds_when_the_request_is_blocked_then_no_local_scrub_or_receipt_or_tombstone_exists',
  (select count(*) = 2 from public.candidate_legal_holds
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='active')
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='blocked_legal_hold' and local_scrub_completed_at is null)
  and not exists (select 1 from public.candidate_erasure_receipts receipt
    join public.candidate_erasure_requests request on request.id=receipt.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  and not exists (select 1 from public.candidate_erasure_suppression_tombstones tombstone
    where tombstone.workspace_id='66111111-1111-4111-8111-111111111111')
);
select candidate_global_hold_test.expect(
  'given_a_candidate_global_block_when_workspace_state_is_inspected_then_both_campaign_copies_keep_pii',
  (select count(*) = 2
     from public.workspace_state workspace,
          jsonb_array_elements(workspace.state -> 'candidates') candidate(value)
    where workspace.workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate.value ->> 'id'='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and candidate.value ->> 'email'='global-candidate@example.test'
      and coalesce((candidate.value #>> '{complianceFlags,anonymized}')::boolean,false)=false)
);
select candidate_global_hold_test.expect(
  'given_a_campaign_a_hold_when_expired_campaign_b_web_pii_is_cleaned_then_candidate_global_retention_preserves_evidence_and_its_linked_staged_payload',
  exists (select 1 from public.autonomous_web_candidate_evidence evidence
    where evidence.workspace_id='66111111-1111-4111-8111-111111111111'
      and evidence.campaign_id='93000000-0000-4000-8000-000000000066'
      and evidence.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  and exists (select 1 from public.autonomous_web_sourcing_staged_results stage
    where stage.workspace_id='66111111-1111-4111-8111-111111111111'
      and stage.egress_attempt_id='72000000-0000-4000-8000-000000000066')
);
select candidate_global_hold_test.expect(
  'given_held_and_unheld_expired_web_pii_when_retention_runs_then_only_the_unheld_evidence_and_linked_stage_are_deleted',
  not exists (select 1 from public.autonomous_web_candidate_evidence evidence
    where evidence.workspace_id='66111111-1111-4111-8111-111111111111'
      and evidence.candidate_id='linkedin-dddddddddddddddddddddddddddddddd')
  and not exists (select 1 from public.autonomous_web_sourcing_staged_results stage
    where stage.workspace_id='66111111-1111-4111-8111-111111111111'
      and stage.egress_attempt_id='72000000-0000-4000-8000-000000000067')
);
select candidate_global_hold_test.expect(
  'given_a_campaign_a_hold_when_campaign_b_list_authority_is_inspected_then_membership_and_attestation_are_preserved',
  exists (select 1 from public.candidate_list_members member
    where member.workspace_id='66111111-1111-4111-8111-111111111111'
      and member.campaign_id='93000000-0000-4000-8000-000000000066'
      and member.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  and exists (select 1 from public.candidate_contact_attestations attestation
    where attestation.workspace_id='66111111-1111-4111-8111-111111111111'
      and attestation.campaign_id='93000000-0000-4000-8000-000000000066'
      and attestation.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
);
select candidate_global_hold_test.expect(
  'given_the_same_candidate_id_in_another_workspace_when_erasure_is_requested_then_workspace_a_holds_do_not_block_it',
  (select result ->> 'status' = 'completed'
     from candidate_global_hold_test.outputs where case_name='other-tenant-request')
  and (select state #>> '{candidates,0,complianceFlags,anonymized}' = 'true'
     from public.workspace_state where workspace_id='66222222-2222-4222-8222-222222222222')
);
SQL

psql_stdin -q <<'SQL'
set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'release-a',public.release_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  (select (result ->> 'hold_id')::uuid
     from candidate_global_hold_test.outputs where case_name='hold-a'),
  'case:global-release-a'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'release-a-replay',public.release_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  (select (result ->> 'hold_id')::uuid
     from candidate_global_hold_test.outputs where case_name='hold-a'),
  'case:global-release-a'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'release-a-conflict',public.release_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  (select (result ->> 'hold_id')::uuid
     from candidate_global_hold_test.outputs where case_name='hold-a'),
  'case:changed-release-a'
);
select public.cleanup_autonomous_web_sourcing_retention(500);
reset role;

select candidate_global_hold_test.expect(
  'given_two_active_holds_when_one_is_released_then_the_other_prevents_temporary_unblocking',
  (select result ->> 'status'='released' and not (result ->> 'replayed')::boolean
     from candidate_global_hold_test.outputs where case_name='release-a')
  and (select result ->> 'status'='released' and (result ->> 'replayed')::boolean
     from candidate_global_hold_test.outputs where case_name='release-a-replay')
  and (select result ->> 'status'='conflict'
     from candidate_global_hold_test.outputs where case_name='release-a-conflict')
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='blocked_legal_hold' and local_scrub_completed_at is null)
  and exists (select 1 from public.autonomous_web_candidate_evidence
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  and exists (select 1 from public.autonomous_web_sourcing_staged_results
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and egress_attempt_id='72000000-0000-4000-8000-000000000066')
);

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'release-b',public.release_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  (select (result ->> 'hold_id')::uuid
     from candidate_global_hold_test.outputs where case_name='hold-b'),
  'case:global-release-b'
);
reset role;

select candidate_global_hold_test.expect(
  'given_the_final_hold_is_released_before_local_scrub_then_the_request_waits_for_explicit_replay_without_scrubbing',
  exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='blocked_legal_hold' and local_scrub_completed_at is null)
  and not exists (select 1 from public.candidate_erasure_receipts receipt
    join public.candidate_erasure_requests request on request.id=receipt.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
);

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
select public.cleanup_autonomous_web_sourcing_retention(500);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'resumed-scrub',public.request_candidate_erasure(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66f00000-0000-4000-8000-000000000001'
  )
);
reset role;

insert into candidate_global_hold_test.context(key,value) values
  ('receipt-count',(select count(*)::text from public.candidate_erasure_receipts receipt
    join public.candidate_erasure_requests request on request.id=receipt.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  ('obligation-count',(select count(*)::text from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'completed-scrub-replay',public.request_candidate_erasure(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66f00000-0000-4000-8000-000000000001'
  )
);
reset role;

select candidate_global_hold_test.expect(
  'given_no_active_hold_when_the_blocked_request_is_replayed_then_both_campaign_copies_are_scrubbed_once',
  (select result ->> 'status'='manual_required'
     from candidate_global_hold_test.outputs where case_name='resumed-scrub')
  and (select count(*)=2
     from public.workspace_state workspace,
          jsonb_array_elements(workspace.state -> 'candidates') candidate(value)
    where workspace.workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate.value ->> 'id'='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and candidate.value ->> 'email'=''
      and (candidate.value #>> '{complianceFlags,anonymized}')::boolean)
  and not exists (select 1 from public.autonomous_web_candidate_evidence
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  and not exists (select 1 from public.autonomous_web_sourcing_staged_results
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and egress_attempt_id='72000000-0000-4000-8000-000000000066')
  and not exists (select 1 from public.candidate_list_members member
    where member.workspace_id='66111111-1111-4111-8111-111111111111'
      and member.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  and not exists (select 1 from public.candidate_contact_attestations attestation
    where attestation.workspace_id='66111111-1111-4111-8111-111111111111'
      and attestation.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
);
select candidate_global_hold_test.expect(
  'given_a_locally_scrubbed_request_when_the_response_is_retried_then_receipts_and_obligations_are_not_duplicated',
  (select (result ->> 'replayed')::boolean
     from candidate_global_hold_test.outputs where case_name='completed-scrub-replay')
  and (select count(*)::text from public.candidate_erasure_receipts receipt
    join public.candidate_erasure_requests request on request.id=receipt.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      = (select value from candidate_global_hold_test.context where key='receipt-count')
  and (select count(*)::text from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      = (select value from candidate_global_hold_test.context where key='obligation-count')
);
select candidate_global_hold_test.expect(
  'given_two_provider_backed_messages_when_local_scrub_completes_then_two_pending_obligations_exist',
  (select value='2' from candidate_global_hold_test.context where key='obligation-count')
  and (select count(*)=2 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.status='manual_required')
);

create table candidate_global_hold_test.obligation_ids(
  provider text primary key,
  id uuid not null
);
insert into candidate_global_hold_test.obligation_ids(provider,id)
select obligation.provider,obligation.id
  from public.candidate_erasure_obligations obligation
  join public.candidate_erasure_requests request on request.id=obligation.request_id
 where request.workspace_id='66111111-1111-4111-8111-111111111111'
   and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
grant select on candidate_global_hold_test.obligation_ids to service_role;
SQL

psql_stdin -q <<'SQL'
set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'email-completed',public.reconcile_candidate_erasure_obligation(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',obligation.id,
  0,'completed',null,repeat('d',64),
  'case:email-completed'
) from candidate_global_hold_test.obligation_ids obligation
where obligation.provider='email';
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'late-hold-a',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LITIGATION',
    'case:late-hold-a',clock_timestamp() + interval '1 day'
  )
);
reset role;

select candidate_global_hold_test.expect(
  'given_a_completed_local_scrub_with_pending_provider_work_when_campaign_a_places_a_late_hold_then_campaign_b_authority_is_immediately_blocked',
  (select result ->> 'status'='active'
     from candidate_global_hold_test.outputs where case_name='late-hold-a')
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='blocked_legal_hold')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='linkedin'
      and obligation.status='blocked_legal_hold')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='email' and obligation.status='completed')
);

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'late-hold-b',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000066',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','REGULATORY',
    'case:late-hold-b',clock_timestamp() + interval '1 day'
  )
);
reset role;

insert into candidate_global_hold_test.context(key,value)
select 'late-pending-before',md5(to_jsonb(obligation)::text)
  from public.candidate_erasure_obligations obligation
  join public.candidate_erasure_requests request on request.id=obligation.request_id
 where request.workspace_id='66111111-1111-4111-8111-111111111111'
   and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
   and obligation.provider='linkedin';

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'pending-read-blocked',public.read_candidate_erasure_obligation_authority(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',obligation.id
) from candidate_global_hold_test.obligation_ids obligation
where obligation.provider='linkedin';
insert into candidate_global_hold_test.outputs(case_name,result)
select 'pending-completion-blocked',public.reconcile_candidate_erasure_obligation(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',obligation.id,
  0,'completed',null,repeat('e',64),
  'case:linkedin-blocked'
) from candidate_global_hold_test.obligation_ids obligation
where obligation.provider='linkedin';
insert into candidate_global_hold_test.outputs(case_name,result)
select 'completed-read',public.read_candidate_erasure_obligation_authority(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',obligation.id
) from candidate_global_hold_test.obligation_ids obligation
where obligation.provider='email';
insert into candidate_global_hold_test.outputs(case_name,result)
select 'completed-replay-under-hold',public.reconcile_candidate_erasure_obligation(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',obligation.id,
  1,'completed',null,repeat('d',64),
  'case:email-completed'
) from candidate_global_hold_test.obligation_ids obligation
where obligation.provider='email';
reset role;

insert into candidate_global_hold_test.context(key,value)
select 'late-pending-after',md5(to_jsonb(obligation)::text)
  from public.candidate_erasure_obligations obligation
  join public.candidate_erasure_requests request on request.id=obligation.request_id
 where request.workspace_id='66111111-1111-4111-8111-111111111111'
   and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
   and obligation.provider='linkedin';

select candidate_global_hold_test.expect(
  'given_a_late_cross_campaign_hold_when_pending_provider_authority_is_read_or_completed_then_both_operations_are_blocked_without_mutating_authority',
  (select result ->> 'status'='blocked_legal_hold'
     from candidate_global_hold_test.outputs where case_name='pending-read-blocked')
  and (select result ->> 'status'='blocked_legal_hold'
     from candidate_global_hold_test.outputs where case_name='pending-completion-blocked')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='linkedin' and obligation.status='blocked_legal_hold'
      and obligation.attempt_count=0)
  and (select value from candidate_global_hold_test.context
        where key='late-pending-before')
      = (select value from candidate_global_hold_test.context
          where key='late-pending-after')
);
select candidate_global_hold_test.expect(
  'given_a_completed_provider_obligation_when_a_late_hold_is_placed_then_completion_stays_final_and_exact_replay_stays_idempotent',
  (select result ->> 'status'='completed'
     from candidate_global_hold_test.outputs where case_name='completed-read')
  and (select (result ->> 'replayed')::boolean
     from candidate_global_hold_test.outputs where case_name='completed-replay-under-hold')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='email' and obligation.status='completed'
      and obligation.attempt_count=1)
);
SQL

psql_stdin -q <<'SQL'
update public.candidate_legal_holds
   set placed_at=clock_timestamp() - interval '2 days',
       expires_at=clock_timestamp() - interval '1 day'
 where id=(select (result ->> 'hold_id')::uuid
   from candidate_global_hold_test.outputs where case_name='late-hold-a');
set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'queue-after-first-expiry',public.list_candidate_erasure_requests(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',100
  )
);
reset role;
select candidate_global_hold_test.expect(
  'given_two_late_holds_when_one_expires_then_expiry_is_truthful_and_the_other_hold_prevents_temporary_unblocking',
  exists (select 1 from public.candidate_legal_holds
    where id=(select (result ->> 'hold_id')::uuid
      from candidate_global_hold_test.outputs where case_name='late-hold-a')
      and status='expired' and released_by is null and released_at is null
      and release_case_reference is null)
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='blocked_legal_hold')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='linkedin' and obligation.status='blocked_legal_hold')
);

update public.candidate_legal_holds
   set placed_at=clock_timestamp() - interval '2 days',
       expires_at=clock_timestamp() - interval '1 day'
 where id=(select (result ->> 'hold_id')::uuid
   from candidate_global_hold_test.outputs where case_name='late-hold-b');
set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'queue-after-expiry',public.list_candidate_erasure_requests(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001',100
  )
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'release-expired',public.release_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  (select (result ->> 'hold_id')::uuid
     from candidate_global_hold_test.outputs where case_name='late-hold-b'),
  'case:late-release-b'
);
reset role;

select candidate_global_hold_test.expect(
  'given_the_final_late_hold_expires_when_the_queue_refreshes_then_expiry_is_persisted_and_only_pending_work_resumes',
  exists (select 1 from public.candidate_legal_holds
    where id=(select (result ->> 'hold_id')::uuid
      from candidate_global_hold_test.outputs where case_name='late-hold-b')
      and status='expired' and released_by is null and released_at is null
      and release_case_reference is null)
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='manual_required')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='linkedin' and obligation.status='manual_required')
  and exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.provider='email' and obligation.status='completed')
  and (select result ->> 'status'='conflict'
     from candidate_global_hold_test.outputs where case_name='release-expired')
);

set role service_role;
select candidate_global_hold_test.set_service_claims(
  '66a00000-0000-4000-8000-000000000001'
);
insert into candidate_global_hold_test.outputs(case_name,result)
select 'linkedin-completed',public.reconcile_candidate_erasure_obligation(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',obligation.id,
  0,'completed',null,repeat('e',64),
  'case:linkedin-completed'
) from candidate_global_hold_test.obligation_ids obligation
where obligation.provider='linkedin';
insert into candidate_global_hold_test.outputs(case_name,result) values (
  'post-completion-hold',public.place_candidate_legal_hold(
    '66111111-1111-4111-8111-111111111111',
    '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
    'linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','LITIGATION',
    'case:post-completion-hold',clock_timestamp() + interval '1 day'
  )
);
reset role;
select candidate_global_hold_test.expect(
  'given_all_provider_obligations_are_completed_when_another_hold_arrives_then_completed_authority_is_not_reopened',
  (select result ->> 'status'='completed'
     from candidate_global_hold_test.outputs where case_name='linkedin-completed')
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and status='completed')
  and not exists (select 1 from public.candidate_erasure_obligations obligation
    join public.candidate_erasure_requests request on request.id=obligation.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and obligation.status<>'completed')
);
SQL

# ---------------------------------------------------------------------------
# Deterministic concurrency: hold-first order.
# A neutral transaction owns only the dedicated legal-hold candidate lock.
# Queue the hold first: it must take the workspace lock before waiting on the
# dedicated advisory namespace. The erasure, queued second, must wait on that
# workspace row rather than prelocking the old erasure identity namespace.
# Releasing the neutral owner makes the erasure observe the committed hold.
# ---------------------------------------------------------------------------
mkfifo "$tmp_dir/hold-first-holder.sql"
PGAPPNAME="aria-0066-hold-first-holder" psql_stdin \
  < "$tmp_dir/hold-first-holder.sql" > "$tmp_dir/hold-first-holder.log" 2>&1 &
holder_pid=$!
exec 9>"$tmp_dir/hold-first-holder.sql"
printf '%s\n' \
  'begin;' \
  "select pg_advisory_xact_lock(1095911745,public.candidate_legal_hold_lock_key('66111111-1111-4111-8111-111111111111','linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));" \
  >&9

deadline=$((SECONDS + 30))
while [[ "$(psql_stdin -Atqc "select coalesce((select state from pg_stat_activity where application_name='aria-0066-hold-first-holder'),'missing')")" != "idle in transaction" ]]; do
  if ! kill -0 "$holder_pid" >/dev/null 2>&1 || (( SECONDS >= deadline )); then
    cat "$tmp_dir/hold-first-holder.log" >&2
    echo "candidate-global-legal-hold-db: hold-first authority holder did not become ready" >&2
    exit 1
  fi
done

PGAPPNAME="aria-0066-hold-first-action" psql_stdin -q \
  > "$tmp_dir/hold-first-action.log" 2>&1 <<'SQL' &
set role service_role;
select set_config('request.jwt.claims','{"sub":"66a00000-0000-4000-8000-000000000001","role":"service_role"}',false);
select set_config('request.jwt.claim.sub','66a00000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','service_role',false);
select public.place_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
  'linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','LITIGATION',
  'case:concurrent-hold-first',clock_timestamp() + interval '1 day'
);
SQL
first_pid=$!
wait_for_advisory "aria-0066-hold-first-action" "$first_pid" "$tmp_dir/hold-first-action.log"

PGAPPNAME="aria-0066-hold-first-erasure" psql_stdin -q \
  > "$tmp_dir/hold-first-erasure.log" 2>&1 <<'SQL' &
set role service_role;
select set_config('request.jwt.claims','{"sub":"66a00000-0000-4000-8000-000000000001","role":"service_role"}',false);
select set_config('request.jwt.claim.sub','66a00000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','service_role',false);
select public.request_candidate_erasure(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000066',
  'linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '66f00000-0000-4000-8000-000000000003'
);
SQL
second_pid=$!
wait_for_workspace_lock "aria-0066-hold-first-erasure" "$second_pid" "$tmp_dir/hold-first-erasure.log"

printf '%s\n' 'commit;' '\q' >&9
exec 9>&-
wait "$holder_pid"
holder_pid=""
wait "$first_pid"
first_pid=""
wait "$second_pid"
second_pid=""

psql_stdin -q <<'SQL'
select candidate_global_hold_test.expect(
  'given_hold_then_erasure_wait_on_one_candidate_lock_when_the_lock_is_released_then_hold_first_blocks_without_deadlock_or_scrub',
  exists (select 1 from public.candidate_legal_holds
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      and campaign_id='legal-campaign-a' and status='active')
  and exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      and status='blocked_legal_hold' and local_scrub_completed_at is null)
  and not exists (select 1 from public.candidate_erasure_receipts receipt
    join public.candidate_erasure_requests request on request.id=receipt.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
);
SQL

# Erasure-first order uses the same dedicated lock in reverse. The request
# takes the workspace row FOR UPDATE before waiting on the legal-hold advisory
# lock. The hold then waits on workspace authority, so no inverse identity-lock
# order is introduced before the predecessor takes its full sorted identity set.
mkfifo "$tmp_dir/erase-first-holder.sql"
PGAPPNAME="aria-0066-erase-first-holder" psql_stdin \
  < "$tmp_dir/erase-first-holder.sql" > "$tmp_dir/erase-first-holder.log" 2>&1 &
holder_pid=$!
exec 9>"$tmp_dir/erase-first-holder.sql"
printf '%s\n' \
  'begin;' \
  "select pg_advisory_xact_lock(1095911745,public.candidate_legal_hold_lock_key('66111111-1111-4111-8111-111111111111','linkedin-cccccccccccccccccccccccccccccccc'));" \
  >&9

deadline=$((SECONDS + 30))
while [[ "$(psql_stdin -Atqc "select coalesce((select state from pg_stat_activity where application_name='aria-0066-erase-first-holder'),'missing')")" != "idle in transaction" ]]; do
  if ! kill -0 "$holder_pid" >/dev/null 2>&1 || (( SECONDS >= deadline )); then
    cat "$tmp_dir/erase-first-holder.log" >&2
    echo "candidate-global-legal-hold-db: erase-first authority holder did not become ready" >&2
    exit 1
  fi
done

PGAPPNAME="aria-0066-erase-first-action" psql_stdin -q \
  > "$tmp_dir/erase-first-action.log" 2>&1 <<'SQL' &
set role service_role;
select set_config('request.jwt.claims','{"sub":"66a00000-0000-4000-8000-000000000001","role":"service_role"}',false);
select set_config('request.jwt.claim.sub','66a00000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','service_role',false);
select public.request_candidate_erasure(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000066',
  'linkedin-cccccccccccccccccccccccccccccccc',
  '66f00000-0000-4000-8000-000000000004'
);
SQL
first_pid=$!
wait_for_advisory "aria-0066-erase-first-action" "$first_pid" "$tmp_dir/erase-first-action.log"

PGAPPNAME="aria-0066-erase-first-hold" psql_stdin -q \
  > "$tmp_dir/erase-first-hold.log" 2>&1 <<'SQL' &
set role service_role;
select set_config('request.jwt.claims','{"sub":"66a00000-0000-4000-8000-000000000001","role":"service_role"}',false);
select set_config('request.jwt.claim.sub','66a00000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','service_role',false);
select public.place_candidate_legal_hold(
  '66111111-1111-4111-8111-111111111111',
  '66a00000-0000-4000-8000-000000000001','legal-campaign-a',
  'linkedin-cccccccccccccccccccccccccccccccc','LITIGATION',
  'case:concurrent-erase-first',clock_timestamp() + interval '1 day'
);
SQL
second_pid=$!
wait_for_workspace_lock "aria-0066-erase-first-hold" "$second_pid" "$tmp_dir/erase-first-hold.log"

printf '%s\n' 'commit;' '\q' >&9
exec 9>&-
wait "$holder_pid"
holder_pid=""
wait "$first_pid"
first_pid=""
wait "$second_pid"
second_pid=""

psql_stdin -q <<'SQL'
select candidate_global_hold_test.expect(
  'given_erasure_then_hold_wait_on_one_candidate_lock_when_the_lock_is_released_then_erasure_first_completes_once_and_late_hold_cannot_reopen_it',
  exists (select 1 from public.candidate_erasure_requests
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-cccccccccccccccccccccccccccccccc'
      and status='completed' and local_scrub_completed_at is not null)
  and exists (select 1 from public.candidate_legal_holds
    where workspace_id='66111111-1111-4111-8111-111111111111'
      and candidate_id='linkedin-cccccccccccccccccccccccccccccccc'
      and status='active')
  and (select count(*)=1 from public.candidate_erasure_receipts receipt
    join public.candidate_erasure_requests request on request.id=receipt.request_id
    where request.workspace_id='66111111-1111-4111-8111-111111111111'
      and request.candidate_id='linkedin-cccccccccccccccccccccccccccccccc'
      and receipt.store_name='workspace_state')
);
SQL

before_rollback="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'request',md5(pg_get_functiondef(
      'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'::regprocedure
    )),
    'place',md5(pg_get_functiondef(
      'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure
    )),
    'release',md5(pg_get_functiondef(
      'public.release_candidate_legal_hold(uuid,uuid,uuid,text)'::regprocedure
    )),
    'holds',(select count(*) from public.candidate_legal_holds),
    'requests',(select count(*) from public.candidate_erasure_requests),
    'obligations',(select count(*) from public.candidate_erasure_obligations)
  )::text
")"

if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/nonempty-rollback.log" 2>&1; then
  echo "candidate-global-legal-hold-db: non-empty 0066 rollback unexpectedly succeeded" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:' "$tmp_dir/nonempty-rollback.log"

after_rollback="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'request',md5(pg_get_functiondef(
      'public.request_candidate_erasure(uuid,uuid,text,text,uuid)'::regprocedure
    )),
    'place',md5(pg_get_functiondef(
      'public.place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure
    )),
    'release',md5(pg_get_functiondef(
      'public.release_candidate_legal_hold(uuid,uuid,uuid,text)'::regprocedure
    )),
    'holds',(select count(*) from public.candidate_legal_holds),
    'requests',(select count(*) from public.candidate_erasure_requests),
    'obligations',(select count(*) from public.candidate_erasure_obligations)
  )::text
")"
if [[ "$after_rollback" != "$before_rollback" ]]; then
  echo "candidate-global-legal-hold-db: refused rollback partially mutated candidate-global authority" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
select candidate_global_hold_test.expect(
  'given_nonempty_candidate_global_authority_when_rollback_is_attempted_then_55000_refuses_before_any_object_or_row_changes',
  true
);
do $assertions$
declare
  failed integer;
  details text;
begin
  select count(*) into failed
    from candidate_global_hold_test.results
   where not passed;
  if failed <> 0 then
    select string_agg(
      case_name || ' (' || coalesce(detail,'') || ')',
      '; ' order by case_name
    ) into details
      from candidate_global_hold_test.results
     where not passed;
    raise exception 'candidate-global legal-hold database test failed: %',details;
  end if;
end
$assertions$;
SQL

assertions="$(psql_stdin -Atq -c "
  select count(*) from candidate_global_hold_test.results
")"
echo "candidate-global-legal-hold-db: cross-campaign erasure, retention, obligations, tenant ACLs, replay, expiry, concurrency, rollback: ${assertions} assertions, 0 failed"
