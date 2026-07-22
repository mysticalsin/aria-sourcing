#!/usr/bin/env bash
# Disposable-Postgres proof for 0060 autonomous Tavily/LinkedIn authority.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-autonomous-web-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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

psql_query() {
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres -Atqc "$1"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin --single-transaction -q < "$migration"
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

# The newly deployed worker and database must agree on one exact four-handler
# identity before any sourcing work exists. A fresh exact-release heartbeat is
# enough for readiness only while every work/failure counter is empty.
psql_stdin -q <<'SQL'
select set_config('request.jwt.claim.role', 'service_role', false);
do $$
declare
  expected_identity constant text :=
    'aria.sourcing-loop-handlers.v1|autonomous_web_sourcing|campaign_create|requisition_parse|sourcing_batch';
  expected_hash text := encode(sha256(convert_to(expected_identity, 'UTF8')), 'hex');
  readiness jsonb;
begin
  if public.expected_sourcing_loop_handler_contract_sha256() <> expected_hash then
    raise exception '0060 four-handler contract mismatch';
  end if;
  if not public.record_sourcing_loop_heartbeat(
    'aw-readiness-worker', repeat('a', 40), expected_hash
  ) then
    raise exception '0060 exact-contract heartbeat was rejected';
  end if;
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  if not (
    (readiness ->> 'healthy')::boolean
    and readiness ->> 'heartbeat_status' = 'fresh'
    and (readiness ->> 'expected_handler_count')::integer = 4
    and (readiness ->> 'dead_sourcing_jobs')::integer = 0
    and (readiness ->> 'ambiguous_sourcing_attempts')::integer = 0
    and (readiness ->> 'overdue_begun_attempts')::integer = 0
  ) then
    raise exception '0060 pristine readiness mismatch: %', readiness;
  end if;

  if not public.record_sourcing_loop_heartbeat(
    'aw-readiness-mismatched-worker', repeat('a', 40), repeat('f', 64)
  ) then
    raise exception '0060 mismatched-contract heartbeat was not recorded';
  end if;
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  if (readiness ->> 'healthy')::boolean
     or readiness ->> 'heartbeat_status' <> 'contract_mismatch'
     or (readiness ->> 'active_workers')::integer <> 2 then
    raise exception '0060 mixed-fleet readiness did not fail closed: %', readiness;
  end if;
  delete from public.loop_worker_heartbeats
   where worker_id = 'aw-readiness-mismatched-worker';
end;
$$;
SQL

psql_stdin -q <<'SQL'
create schema aw_test;
create table aw_test.results(
  case_name text primary key,
  passed boolean not null,
  detail text
);
create table aw_test.context(key text primary key, value text not null);

create function aw_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void language plpgsql set search_path = pg_catalog, public, aw_test as $$
begin
  insert into aw_test.results(case_name, passed, detail)
  values (p_case_name, coalesce(p_passed, false), p_detail);
end;
$$;

create function aw_test.set_claims(p_role text, p_subject uuid default null)
returns void language plpgsql set search_path = pg_catalog as $$
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

create function aw_test.set_document_status(p_status text)
returns void language plpgsql set search_path = pg_catalog, public as $$
begin
  update public.workspace_state state
     set state = jsonb_set(
       state.state,
       '{campaigns}',
       (select jsonb_agg(
          case when item.value ->> 'id' = '93000000-0000-4000-8000-000000000001'
            then jsonb_set(item.value, '{status}', to_jsonb(p_status), true)
            else item.value end order by item.ordinality
        ) from jsonb_array_elements(state.state -> 'campaigns')
          with ordinality item(value, ordinality)),
       true
     )
   where workspace_id = '53111111-1111-4111-8111-111111111111';
end;
$$;

create function aw_test.seed_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_expires_at timestamptz default (clock_timestamp() + interval '10 minutes')
) returns void language plpgsql set search_path = pg_catalog, public as $$
declare
  campaign_hash text;
  payload_value jsonb;
begin
  select campaign_sha256 into campaign_hash from public.sourcing_campaigns
   where id = '93000000-0000-4000-8000-000000000001';
  payload_value := jsonb_build_object(
    'campaign_id', '93000000-0000-4000-8000-000000000001',
    'campaign_sha256', campaign_hash,
    'batch_ordinal', 0
  );
  insert into public.aria_jobs(
    id, workspace_id, kind, idempotency_key, payload, payload_sha256,
    status, attempt_count, max_attempts, next_run_at, lease_id,
    lease_expires_at, claimed_by
  ) values (
    p_job_id, '53111111-1111-4111-8111-111111111111', 'sourcing_batch',
    'aw-test:' || p_job_id::text, payload_value,
    encode(sha256(convert_to(payload_value::text, 'UTF8')), 'hex'),
    'leased', 1, 4, clock_timestamp(), p_lease_id, p_expires_at, 'aw-test-worker'
  );
end;
$$;

create function aw_test.authorize(p_job_id uuid, p_lease_id uuid)
returns jsonb language sql set search_path = pg_catalog, public as $$
  select public.authorize_autonomous_web_sourcing(
    p_job_id,
    p_lease_id,
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (select campaign_sha256 from public.sourcing_campaigns
      where id = '93000000-0000-4000-8000-000000000001'),
    0
  );
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('63000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'aw-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('63000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'aw-other@example.test', '', now(), '{}', '{}', now(), now());
insert into public.workspaces(id, name, allowed_domain) values
  ('53111111-1111-4111-8111-111111111111', 'Autonomous Web', 'aw.example.test'),
  ('53222222-2222-4222-8222-222222222222', 'Other Tenant', 'aw-other.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('63000000-0000-4000-8000-000000000001', 'aw-admin@example.test', 'AW Admin',
   '53111111-1111-4111-8111-111111111111', 'admin'),
  ('63000000-0000-4000-8000-000000000002', 'aw-other@example.test', 'Other Admin',
   '53222222-2222-4222-8222-222222222222', 'admin');
insert into public.workspace_state(workspace_id, state) values
  ('53111111-1111-4111-8111-111111111111', '{
    "campaigns":[{
      "id":"93000000-0000-4000-8000-000000000001",
      "title":"sales director","status":"Sourcing",
      "metrics":{"sourced":0},"activities":[]
    }],
    "candidates":[],"unrelated":"preserve-me"
  }'),
  ('53222222-2222-4222-8222-222222222222', '{"campaigns":[],"candidates":[]}');
insert into public.sourcing_learning_secrets(workspace_id, hmac_key) values
  ('53111111-1111-4111-8111-111111111111', decode(repeat('31', 32), 'hex')),
  ('53222222-2222-4222-8222-222222222222', decode(repeat('32', 32), 'hex'));
update public.sourcing_loop_controls
   set kill_switch = false, sourcing_enabled = true,
       max_sourcing_runs_per_day = 10,
       updated_by = '63000000-0000-4000-8000-000000000001'
 where workspace_id = '53111111-1111-4111-8111-111111111111';

insert into public.requisitions(
  id, workspace_id, source_kind, source_ref, status, campaign_id,
  parsed_job_analysis, parse_input_sha256, parse_result_sha256
) values (
  '94000000-0000-4000-8000-000000000001',
  '53111111-1111-4111-8111-111111111111', 'api', 'aw-req',
  'campaign_created', '93000000-0000-4000-8000-000000000001',
  '{"title":"sales director","requiredSkills":["enterprise sales","revenue operations"]}',
  repeat('c', 64), repeat('d', 64)
);
do $$
declare
  basis jsonb := '{"title":"sales director","skills":["enterprise sales","revenue operations"]}'::jsonb;
  campaign_hash text;
begin
  campaign_hash := encode(sha256(convert_to(jsonb_build_object(
    'campaign_id', '93000000-0000-4000-8000-000000000001',
    'workspace_id', '53111111-1111-4111-8111-111111111111',
    'requisition_id', '94000000-0000-4000-8000-000000000001',
    'activation_actor_id', '63000000-0000-4000-8000-000000000001',
    'role_basis', basis,
    'parse_input_sha256', repeat('c', 64),
    'parse_result_sha256', repeat('d', 64)
  )::text, 'UTF8')), 'hex');
  insert into public.sourcing_campaigns(
    id, workspace_id, requisition_id, activation_actor_id, status,
    role_basis, parse_input_sha256, parse_result_sha256, campaign_sha256
  ) values (
    '93000000-0000-4000-8000-000000000001',
    '53111111-1111-4111-8111-111111111111',
    '94000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000001', 'sourcing', basis,
    repeat('c', 64), repeat('d', 64), campaign_hash
  );
end;
$$;

-- Insert a live-shaped but stale verified credential as owner. The service
-- verifier can advance its evidence timestamp, never rewrite its identity.
insert into public.api_keys(
  id, workspace_id, name, provider, secret, last4, status, last_tested_at,
  created_by, verification_method, verification_http_status
) values (
  '95000000-0000-4000-8000-000000000001',
  '53111111-1111-4111-8111-111111111111', 'AW Tavily', 'Tavily',
  'test-only-secret-never-read', 'test', 'valid',
  clock_timestamp() - interval '25 hours',
  '63000000-0000-4000-8000-000000000001', 'tavily_key_info_v1', 200
);

select aw_test.set_claims('service_role');
select aw_test.expect(
  'web-policy-only-for-non-github-role',
  public.autonomous_web_sourcing_expected_query(
    '{"title":"sales director","skills":["enterprise sales","revenue operations"]}', 0
  ) ->> 'policyVersion' = 'tavily-linkedin-deterministic-v1'
  and public.autonomous_web_sourcing_expected_query(
    '{"title":"backend engineer","skills":["go"]}', 0
  ) is null
);
select aw_test.expect(
  'stable-linkedin-external-id',
  public.autonomous_web_linkedin_external_id(
    'https://www.linkedin.com/in/jane-seller'
  ) ~ '^[0-9a-f]{64}$'
  and public.autonomous_web_linkedin_external_id(
    'https://evil.test/linkedin.com/in/jane-seller'
  ) is null
);

select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001'
);
select aw_test.expect(
  'stale-credential-denied',
  aw_test.authorize(
    '71000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001'
  ) ->> 'status' = 'credential_unavailable'
);
update public.api_keys
   set last_tested_at = clock_timestamp(), status = 'valid',
       verification_method = 'tavily_key_info_v1', verification_http_status = 200
 where id = '95000000-0000-4000-8000-000000000001';

select aw_test.expect('activation-count-contract-accepts-bounded-retry-history',
  public.autonomous_web_activation_counts_are_valid(20, 20, 5, 15)
  and public.autonomous_web_activation_counts_are_valid(2, 2, 1, 1)
  and public.autonomous_web_activation_job_counts_are_valid(4, 4, 1, 3));
select aw_test.expect('activation-count-contract-rejects-overflow-and-inconsistency',
  not public.autonomous_web_activation_counts_are_valid(101, 5, 5, 96)
  and not public.autonomous_web_activation_counts_are_valid(21, 21, 5, 16)
  and not public.autonomous_web_activation_counts_are_valid(3, 2, 1, 1)
  and not public.autonomous_web_activation_counts_are_valid(2, 0, 1, 1)
  and not public.autonomous_web_activation_counts_are_valid(2, 3, 1, 1)
  and not public.autonomous_web_activation_counts_are_valid(2, 1, 1, 1)
  and not public.autonomous_web_activation_job_counts_are_valid(5, 5, 1, 4)
  and not public.autonomous_web_activation_job_counts_are_valid(1, 0, 0, 1)
  and not public.autonomous_web_activation_counts_are_valid(null, 1, 1, 0));

-- A Graphify lesson may select only one of the finite SQL-derived LinkedIn
-- queries for this exact role. A higher-ranked lesson outside that finite set
-- must remain inert even with a valid human promotion and artifact.
do $$
declare
  workspace_id constant uuid := '53111111-1111-4111-8111-111111111111';
  actor_id constant uuid := '63000000-0000-4000-8000-000000000001';
  artifact_id constant uuid := '96000000-0000-4000-8000-000000000001';
  valid_lesson_id constant uuid := '96100000-0000-4000-8000-000000000001';
  invalid_lesson_id constant uuid := '96100000-0000-4000-8000-000000000002';
  image_digest constant text := 'registry.example.test/graphify@sha256:' || repeat('7', 64);
  graphify_commit constant text := '94d3099540550d58dd121ec3e67cf93e80364079';
  role_basis constant jsonb := '{"title":"sales director","skills":["enterprise sales","revenue operations"]}'::jsonb;
  valid_query jsonb;
  invalid_query constant text := 'site:linkedin.com/in "chief executive" "board"';
  role_fingerprint text;
begin
  valid_query := public.autonomous_web_sourcing_expected_query(role_basis, 1);
  role_fingerprint := public.sourcing_authority_hmac(
    workspace_id,
    public.canonicalize_sourcing_role_basis(role_basis)::text
  );
  insert into public.sourcing_learning_controls(
    workspace_id, enabled, required_graphify_commit,
    required_graphify_image_digest, updated_by
  ) values (
    workspace_id, false, graphify_commit, image_digest, actor_id
  ) on conflict on constraint sourcing_learning_controls_pkey do update
    set enabled = false,
        required_graphify_commit = excluded.required_graphify_commit,
        required_graphify_image_digest = excluded.required_graphify_image_digest,
        updated_by = excluded.updated_by,
        updated_at = clock_timestamp();
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
    status, version, evidence_run_count, useful_feedback_count,
    graphify_artifact_sha256, graphify_cluster_ref, graphify_commit,
    graphify_export_id, graphified_at, graphified_by, promoted_at,
    promoted_by, expires_at
  ) values
    (
      valid_lesson_id, workspace_id, role_fingerprint, 'LinkedIn',
      public.sourcing_authority_hmac(
        workspace_id, 'query:LinkedIn:' || (valid_query ->> 'value')
      ),
      valid_query ->> 'value', 'promoted', 3, 8, 8, repeat('4', 64),
      'linkedin-sales-revenue-ops', graphify_commit, artifact_id,
      clock_timestamp(), actor_id, clock_timestamp(), actor_id,
      clock_timestamp() + interval '30 days'
    ),
    (
      invalid_lesson_id, workspace_id, role_fingerprint, 'LinkedIn',
      public.sourcing_authority_hmac(
        workspace_id, 'query:LinkedIn:' || invalid_query
      ),
      invalid_query, 'promoted', 9, 999, 999, repeat('4', 64),
      'linkedin-sales-outside-policy', graphify_commit, artifact_id,
      clock_timestamp(), actor_id, clock_timestamp(), actor_id,
      clock_timestamp() + interval '30 days'
    );
  insert into public.sourcing_lesson_reviews(
    id, workspace_id, lesson_id, reviewer_id, reviewer_kind, request_id,
    prior_status, new_status, reason_code, lesson_version
  ) values
    (
      '96200000-0000-4000-8000-000000000001', workspace_id,
      valid_lesson_id, actor_id, 'human', 'aw-valid-linkedin-promotion',
      'draft', 'promoted', 'reviewed_useful', 3
    ),
    (
      '96200000-0000-4000-8000-000000000002', workspace_id,
      invalid_lesson_id, actor_id, 'human', 'aw-invalid-linkedin-promotion',
      'draft', 'promoted', 'reviewed_useful', 9
    );
end;
$$;

-- Tenant and lease inputs are exact and cannot be caller-selected.
select aw_test.expect(
  'tenant-isolation',
  public.authorize_autonomous_web_sourcing(
    '71000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    '53222222-2222-4222-8222-222222222222',
    '93000000-0000-4000-8000-000000000001',
    (select campaign_sha256 from public.sourcing_campaigns
      where id = '93000000-0000-4000-8000-000000000001'), 0
  ) ->> 'status' = 'job_lease_invalid'
);

do $$
declare
  auth_result jsonb;
  begin_result jsonb;
begin
  -- Credential version changes after authorization fail closed.
  perform aw_test.seed_job(
    '71000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002'
  );
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002'
  );
  update public.api_keys set last_tested_at = last_tested_at + interval '1 second'
   where id = '95000000-0000-4000-8000-000000000001';
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000002',
    '81000000-0000-4000-8000-000000000002',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('credential-version-race-denied',
    auth_result ->> 'status' = 'authorized'
      and begin_result ->> 'status' = 'credential_changed', begin_result::text);

  -- Explicit revocation after authorization also fails closed.
  perform aw_test.seed_job(
    '71000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000003'
  );
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000003'
  );
  update public.api_keys
     set status = 'invalid', last_tested_at = last_tested_at + interval '1 second'
   where id = '95000000-0000-4000-8000-000000000001';
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000003',
    '81000000-0000-4000-8000-000000000003',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('credential-revocation-race-denied',
    begin_result ->> 'status' = 'credential_unavailable', begin_result::text);
  update public.api_keys
     set status = 'valid', last_tested_at = last_tested_at + interval '1 second',
         verification_method = 'tavily_key_info_v1', verification_http_status = 200
   where id = '95000000-0000-4000-8000-000000000001';

  -- Kill switch, actor demotion, and browser pause are each rechecked at begin.
  perform aw_test.seed_job(
    '71000000-0000-4000-8000-000000000004',
    '81000000-0000-4000-8000-000000000004'
  );
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000004',
    '81000000-0000-4000-8000-000000000004'
  );
  update public.sourcing_loop_controls
     set kill_switch = true, sourcing_enabled = false
   where workspace_id = '53111111-1111-4111-8111-111111111111';
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000004',
    '81000000-0000-4000-8000-000000000004',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('kill-switch-race-denied',
    begin_result ->> 'status' = 'sourcing_disabled', begin_result::text);
  update public.sourcing_loop_controls
     set kill_switch = false, sourcing_enabled = true
   where workspace_id = '53111111-1111-4111-8111-111111111111';

  perform aw_test.seed_job(
    '71000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000005'
  );
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000005'
  );
  update public.profiles set role = 'member'
   where id = '63000000-0000-4000-8000-000000000001';
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000005',
    '81000000-0000-4000-8000-000000000005',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('admin-demotion-race-denied',
    begin_result ->> 'status' = 'sourcing_disabled', begin_result::text);
  update public.profiles set role = 'admin'
   where id = '63000000-0000-4000-8000-000000000001';

  perform aw_test.seed_job(
    '71000000-0000-4000-8000-000000000006',
    '81000000-0000-4000-8000-000000000006'
  );
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000006',
    '81000000-0000-4000-8000-000000000006'
  );
  perform aw_test.set_document_status('Paused');
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000006',
    '81000000-0000-4000-8000-000000000006',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('browser-pause-race-denied',
    begin_result ->> 'status' = 'sourcing_disabled', begin_result::text);
  perform aw_test.set_document_status('Sourcing');
end;
$$;

-- Earlier mutable-authority race probes use the default policy. Enable the
-- prepared lesson only for the complete authorize-to-receipt proof below.
update public.sourcing_learning_controls
   set enabled = true, updated_at = clock_timestamp()
 where workspace_id = '53111111-1111-4111-8111-111111111111';

-- Prepare one happy attempt and one true concurrent begin race.
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000010',
  '81000000-0000-4000-8000-000000000010'
);
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000011',
  '81000000-0000-4000-8000-000000000011'
);
do $$
declare
  happy_auth jsonb;
  happy_begin jsonb;
  happy_confirm jsonb;
  happy_confirm_retry jsonb;
  begun_replay jsonb;
  concurrent_auth jsonb;
  learned_claim public.autonomous_web_sourcing_claims%rowtype;
  expected_learned_query jsonb;
begin
  happy_auth := aw_test.authorize(
    '71000000-0000-4000-8000-000000000010',
    '81000000-0000-4000-8000-000000000010'
  );
  perform aw_test.expect('locator-only-authority',
    happy_auth ->> 'status' = 'authorized'
      and happy_auth - array['status','locator'] = '{}'::jsonb
      and happy_auth -> 'locator' ?& array[
        'jobId','leaseId','workspaceId','campaignId','claimToken','fenceVersion'
      ]
      and not (happy_auth -> 'locator' ?| array['provider','credentialId','query','request']),
    happy_auth::text);
  select * into learned_claim
    from public.autonomous_web_sourcing_claims
   where job_id = '71000000-0000-4000-8000-000000000010';
  expected_learned_query := public.autonomous_web_sourcing_expected_query(
    '{"title":"sales director","skills":["enterprise sales","revenue operations"]}'::jsonb,
    1
  );
  perform aw_test.expect('promoted-exact-role-graphify-lesson-bound-before-egress',
    learned_claim.canonical_query = expected_learned_query
      and public.autonomous_web_sourcing_query_is_allowed(
        '{"title":"sales director","skills":["enterprise sales","revenue operations"]}'::jsonb,
        learned_claim.canonical_query
      )
      and learned_claim.applied_lesson ->> 'lesson_id'
        = '96100000-0000-4000-8000-000000000001'
      and learned_claim.applied_lesson ->> 'lesson_version' = '3'
      and learned_claim.applied_lesson ->> 'promotion_review_id'
        = '96200000-0000-4000-8000-000000000001'
      and learned_claim.applied_lesson ->> 'graphify_export_id'
        = '96000000-0000-4000-8000-000000000001'
      and learned_claim.applied_lesson ->> 'query_value'
        = expected_learned_query ->> 'value'
      and learned_claim.applied_lesson ->> 'query_sha256'
        = expected_learned_query ->> 'sha256'
      and learned_claim.applied_lesson ->> 'snapshot_sha256'
        = public.sourcing_batch_lesson_snapshot_sha256(learned_claim.applied_lesson),
    learned_claim.canonical_query::text || ' / '
      || coalesce(learned_claim.applied_lesson::text, 'null'));
  update public.sourcing_lessons
     set status = 'suspended', version = 4,
         suspended_at = clock_timestamp(), updated_at = clock_timestamp()
   where id = '96100000-0000-4000-8000-000000000001'
     and workspace_id = '53111111-1111-4111-8111-111111111111';
  happy_begin := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000010',
    '81000000-0000-4000-8000-000000000010',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (happy_auth #>> '{locator,claimToken}')::uuid,
    (happy_auth #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('begin-exact-request',
    happy_begin ->> 'status' = 'begun'
      and happy_begin ->> 'provider' = 'tavily'
      and happy_begin #>> '{request,query}' = (expected_learned_query ->> 'value')
      and happy_begin #>> '{request,search_depth}' = 'basic'
      and (happy_begin #>> '{request,max_results}')::integer = 5
      and happy_begin #> '{request,include_domains}' = '["linkedin.com"]'::jsonb,
    happy_begin::text);
  begun_replay := aw_test.authorize(
    '71000000-0000-4000-8000-000000000010',
    '81000000-0000-4000-8000-000000000010'
  );
  perform aw_test.expect('authorize-after-begin-never-reissues-egress',
    begun_replay ->> 'status' = 'attempt_already_started'
      and begun_replay ->> 'egressAttemptId' = happy_begin ->> 'egressAttemptId',
    begun_replay::text);
  happy_confirm := public.confirm_autonomous_web_sourcing_egress(
    (happy_begin ->> 'egressAttemptId')::uuid,
    '71000000-0000-4000-8000-000000000010',
    '81000000-0000-4000-8000-000000000010',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (happy_auth #>> '{locator,claimToken}')::uuid,
    (happy_auth #>> '{locator,fenceVersion}')::bigint,
    (happy_begin ->> 'credentialId')::uuid,
    happy_begin ->> 'credentialVersion',
    happy_begin ->> 'queryPolicyVersion',
    happy_begin ->> 'canonicalQuerySha256',
    happy_begin ->> 'requestSha256'
  );
  happy_confirm_retry := public.confirm_autonomous_web_sourcing_egress(
    (happy_begin ->> 'egressAttemptId')::uuid,
    '71000000-0000-4000-8000-000000000010',
    '81000000-0000-4000-8000-000000000010',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (happy_auth #>> '{locator,claimToken}')::uuid,
    (happy_auth #>> '{locator,fenceVersion}')::bigint,
    (happy_begin ->> 'credentialId')::uuid,
    happy_begin ->> 'credentialVersion',
    happy_begin ->> 'queryPolicyVersion',
    happy_begin ->> 'canonicalQuerySha256',
    happy_begin ->> 'requestSha256'
  );
  perform aw_test.expect('confirm-immediate-and-idempotent',
    happy_confirm ->> 'status' = 'confirmed'
      and happy_confirm_retry ->> 'status' = 'already_confirmed'
      and (select count(*) from public.autonomous_web_sourcing_confirmations
        where egress_attempt_id = (happy_begin ->> 'egressAttemptId')::uuid) = 1,
    happy_confirm::text || ' / ' || happy_confirm_retry::text);
  insert into aw_test.context values
    ('happy_auth', happy_auth::text), ('happy_begin', happy_begin::text);

  concurrent_auth := aw_test.authorize(
    '71000000-0000-4000-8000-000000000011',
    '81000000-0000-4000-8000-000000000011'
  );
  insert into aw_test.context values ('concurrent_auth', concurrent_auth::text);
end;
$$;
SQL

# A confirmed autonomous request that remains unsettled past the five-minute
# SLO must make combined readiness red. Backdate only inside a rolled-back test
# transaction so immutable production evidence is never rewritten persistently.
psql_stdin -q <<'SQL'
begin;
alter table public.autonomous_web_sourcing_attempts
  disable trigger autonomous_web_sourcing_attempts_immutable;
update public.autonomous_web_sourcing_attempts
   set begun_at = begun_at - interval '6 minutes',
       egress_expires_at = egress_expires_at - interval '6 minutes'
 where job_id = '71000000-0000-4000-8000-000000000010';
alter table public.autonomous_web_sourcing_attempts
  enable trigger autonomous_web_sourcing_attempts_immutable;
select aw_test.set_claims('service_role');
do $$
declare readiness jsonb;
begin
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  if (readiness ->> 'healthy')::boolean
     or (readiness ->> 'overdue_begun_attempts')::integer < 1 then
    raise exception '0060 overdue autonomous attempt was hidden: %', readiness;
  end if;
end;
$$;
rollback;
SQL

concurrent_auth="$(psql_query "select value from aw_test.context where key='concurrent_auth'")"
claim_token="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.locator.claimToken)' "$concurrent_auth")"
fence_version="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(String(value.locator.fenceVersion))' "$concurrent_auth")"

begin_sql="select set_config('request.jwt.claim.role','service_role',false); select public.begin_autonomous_web_sourcing_egress('71000000-0000-4000-8000-000000000011','81000000-0000-4000-8000-000000000011','53111111-1111-4111-8111-111111111111','93000000-0000-4000-8000-000000000001','$claim_token',$fence_version)->>'status';"
psql_query "$begin_sql" > "$tmp_dir/begin-one.log" &
pid_one=$!
psql_query "$begin_sql" > "$tmp_dir/begin-two.log" &
pid_two=$!
wait "$pid_one"
wait "$pid_two"
status_one="$(tail -n 1 "$tmp_dir/begin-one.log")"
status_two="$(tail -n 1 "$tmp_dir/begin-two.log")"
if [[ "$status_one $status_two" != "begun begun" ]]; then
  echo "concurrent begin statuses: $status_one / $status_two" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
select aw_test.set_claims('service_role');
select aw_test.expect(
  'concurrent-begin-one-attempt',
  (select count(*) from public.autonomous_web_sourcing_attempts
    where job_id = '71000000-0000-4000-8000-000000000011') = 1
  and (select count(*) from public.autonomous_web_sourcing_quota_ledger ledger
    join public.autonomous_web_sourcing_attempts attempt
      on attempt.id = ledger.egress_attempt_id
    where attempt.job_id = '71000000-0000-4000-8000-000000000011') = 2
);

-- A classified read-only provider failure receives one bounded retry under a
-- new queue lease, token, fence, attempt, and quota reservation. The original
-- authority remains immutable, cannot be reused, and the final receipt binds
-- only the successful fence.
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000019',
  '81000000-0000-4000-8000-000000000019'
);
do $$
<<retry_case>>
declare
  job_id constant uuid := '71000000-0000-4000-8000-000000000019';
  first_lease constant uuid := '81000000-0000-4000-8000-000000000019';
  second_lease uuid;
  first_auth jsonb;
  second_auth jsonb;
  first_begin jsonb;
  second_begin jsonb;
  first_confirm jsonb;
  second_confirm jsonb;
  reverse_lane_result jsonb;
  post_claim_lane_result jsonb;
  retry_result jsonb;
  stale_begin jsonb;
  stale_confirm jsonb;
  record_result jsonb;
  commit_result jsonb;
  replay_result jsonb;
  first_claim public.autonomous_web_sourcing_claims%rowtype;
  second_claim public.autonomous_web_sourcing_claims%rowtype;
  second_attempt public.autonomous_web_sourcing_attempts%rowtype;
  provider_receipt jsonb;
  readiness_before jsonb;
  readiness_after jsonb;
begin
  perform public.record_sourcing_loop_heartbeat(
    'aw-readiness-worker', repeat('a', 40),
    public.expected_sourcing_loop_handler_contract_sha256()
  );
  readiness_before := public.get_sourcing_loop_readiness(repeat('a', 40));
  reverse_lane_result := public.authorize_sourcing_batch(
    job_id, first_lease, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (select campaign_sha256 from public.sourcing_campaigns
      where id = '93000000-0000-4000-8000-000000000001'),
    0, 'anonymous'
  );
  first_auth := aw_test.authorize(job_id, first_lease);
  post_claim_lane_result := public.authorize_sourcing_batch(
    job_id, first_lease, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (select campaign_sha256 from public.sourcing_campaigns
      where id = '93000000-0000-4000-8000-000000000001'),
    0, 'anonymous'
  );
  first_begin := public.begin_autonomous_web_sourcing_egress(
    job_id, first_lease, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (first_auth #>> '{locator,claimToken}')::uuid,
    (first_auth #>> '{locator,fenceVersion}')::bigint
  );
  first_confirm := public.confirm_autonomous_web_sourcing_egress(
    (first_begin ->> 'egressAttemptId')::uuid, job_id, first_lease,
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (first_auth #>> '{locator,claimToken}')::uuid,
    (first_auth #>> '{locator,fenceVersion}')::bigint,
    (first_begin ->> 'credentialId')::uuid,
    first_begin ->> 'credentialVersion', first_begin ->> 'queryPolicyVersion',
    first_begin ->> 'canonicalQuerySha256', first_begin ->> 'requestSha256'
  );
  retry_result := public.fail_autonomous_web_sourcing(
    job_id, first_lease, '53111111-1111-4111-8111-111111111111',
    (first_auth #>> '{locator,claimToken}')::uuid,
    (first_auth #>> '{locator,fenceVersion}')::bigint,
    (first_begin ->> 'egressAttemptId')::uuid,
    'search_rate_limited', true, false
  );
  select * into first_claim
    from public.autonomous_web_sourcing_claims claim
   where claim.job_id = retry_case.job_id and claim.fence_version = 1;
  perform aw_test.expect('retryable-provider-failure-is-scheduled-and-append-only',
    first_auth ->> 'status' = 'authorized'
      and reverse_lane_result ->> 'status' = 'provider_lane_conflict'
      and post_claim_lane_result ->> 'status' = 'provider_lane_conflict'
      and first_begin ->> 'status' = 'begun'
      and first_confirm ->> 'status' = 'confirmed'
      and retry_result ->> 'status' = 'retry_scheduled'
      and (select status from public.aria_jobs where id = retry_case.job_id) = 'queued'
      and (select lease_id is null from public.aria_jobs where id = retry_case.job_id)
      and (select next_run_at - updated_at >= interval '2 minutes'
                    and next_run_at - updated_at < interval '2 minutes 30 seconds'
             from public.aria_jobs where id = retry_case.job_id)
      and exists (
        select 1 from public.autonomous_web_sourcing_failures failure
         where failure.egress_attempt_id = (first_begin ->> 'egressAttemptId')::uuid
           and failure.disposition = 'retry_scheduled'
           and failure.retryable and not failure.ambiguous
      )
      and (select count(*) from public.autonomous_web_sourcing_claims claim
            where claim.job_id = retry_case.job_id) = 1
      and (select count(*) from public.autonomous_web_sourcing_attempts attempt
            where attempt.job_id = retry_case.job_id) = 1,
    retry_result::text);

  update public.aria_jobs set next_run_at = clock_timestamp() - interval '1 second'
   where id = retry_case.job_id;
  perform public.claim_due_sourcing_batch_jobs('aw-retry-worker', 600, 1);
  select lease_id into second_lease from public.aria_jobs where id = retry_case.job_id;
  second_auth := aw_test.authorize(job_id, second_lease);
  select * into second_claim
    from public.autonomous_web_sourcing_claims claim
   where claim.job_id = retry_case.job_id
   order by claim.fence_version desc limit 1;
  stale_begin := public.begin_autonomous_web_sourcing_egress(
    job_id, second_lease, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    first_claim.claim_token, first_claim.fence_version
  );
  stale_confirm := public.confirm_autonomous_web_sourcing_egress(
    (first_begin ->> 'egressAttemptId')::uuid, job_id, first_lease,
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    first_claim.claim_token, first_claim.fence_version,
    (first_begin ->> 'credentialId')::uuid,
    first_begin ->> 'credentialVersion', first_begin ->> 'queryPolicyVersion',
    first_begin ->> 'canonicalQuerySha256', first_begin ->> 'requestSha256'
  );
  second_begin := public.begin_autonomous_web_sourcing_egress(
    job_id, second_lease, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (second_auth #>> '{locator,claimToken}')::uuid,
    (second_auth #>> '{locator,fenceVersion}')::bigint
  );
  select * into second_attempt from public.autonomous_web_sourcing_attempts
   where id = (second_begin ->> 'egressAttemptId')::uuid;
  second_confirm := public.confirm_autonomous_web_sourcing_egress(
    second_attempt.id, job_id, second_lease, second_attempt.workspace_id,
    second_attempt.campaign_id, second_attempt.claim_token,
    second_attempt.fence_version, second_attempt.credential_id,
    second_attempt.credential_version, second_attempt.query_policy_version,
    second_attempt.canonical_query_sha256, second_attempt.request_sha256
  );
  provider_receipt := jsonb_build_object(
    'provider', 'tavily', 'providerRequestId', 'tavily_retry_success',
    'responseTimeMs', 120, 'resultCount', 0,
    'querySha256', second_attempt.canonical_query_sha256,
    'requestSha256', second_attempt.request_sha256,
    'rawResponseSha256', repeat('9', 64), 'rawResponseBytes', 128
  );
  record_result := public.record_autonomous_web_sourcing_result(
    second_attempt.id, job_id, second_lease, second_attempt.workspace_id,
    second_attempt.claim_token, second_attempt.fence_version, 'tavily',
    second_attempt.credential_id, second_attempt.credential_version,
    second_attempt.query_policy_version, second_attempt.canonical_query_sha256,
    second_attempt.request_sha256, repeat('9', 64), 128,
    provider_receipt, '[]'::jsonb
  );
  commit_result := public.commit_autonomous_web_sourcing(
    job_id, second_lease, second_attempt.workspace_id, second_attempt.campaign_id,
    second_attempt.claim_token, second_attempt.fence_version, second_attempt.id,
    record_result ->> 'resultSha256'
  );
  replay_result := aw_test.authorize(job_id, second_lease);
  perform public.record_sourcing_loop_heartbeat(
    'aw-readiness-worker', repeat('a', 40),
    public.expected_sourcing_loop_handler_contract_sha256()
  );
  readiness_after := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform aw_test.expect('retry-uses-new-exact-fence-and-sticky-provider-authority',
    second_auth ->> 'status' = 'authorized'
      and second_claim.fence_version = first_claim.fence_version + 1
      and second_claim.claim_token <> first_claim.claim_token
      and second_claim.provider = first_claim.provider
      and second_claim.canonical_query = first_claim.canonical_query
      and second_claim.canonical_query_sha256 = first_claim.canonical_query_sha256
      and second_claim.request_sha256 = first_claim.request_sha256
      and second_claim.role_basis_sha256 = first_claim.role_basis_sha256
      and second_claim.applied_lesson is not distinct from first_claim.applied_lesson
      and stale_begin ->> 'status' = 'claim_invalid'
      and stale_confirm ->> 'status' = 'attempt_binding_invalid'
      and second_begin ->> 'status' = 'begun'
      and second_confirm ->> 'status' = 'confirmed'
      and (select count(*) from public.autonomous_web_sourcing_claims claim
            where claim.job_id = retry_case.job_id) = 2
      and (select count(*) from public.autonomous_web_sourcing_attempts attempt
            where attempt.job_id = retry_case.job_id) = 2
      and (select count(*) from public.autonomous_web_sourcing_quota_ledger ledger
            join public.autonomous_web_sourcing_attempts attempt
              on attempt.id = ledger.egress_attempt_id
           where attempt.job_id = retry_case.job_id) = 4
      and not exists (select 1 from public.sourcing_batch_claims claim
                       where claim.job_id = retry_case.job_id),
    second_auth::text || ' / ' || stale_begin::text || ' / '
      || stale_confirm::text || ' / ' || second_begin::text);
  perform aw_test.expect('retry-final-success-is-exactly-once-and-readiness-clean',
    record_result ->> 'status' = 'recorded'
      and commit_result ->> 'status' = 'completed'
      and replay_result ->> 'status' = 'no_op_replay'
      and (select status from public.aria_jobs where id = retry_case.job_id) = 'succeeded'
      and exists (
        select 1 from public.autonomous_web_sourcing_receipts receipt
         where receipt.job_id = retry_case.job_id
           and receipt.claim_token = second_claim.claim_token
           and receipt.fence_version = second_claim.fence_version
           and receipt.egress_attempt_id = second_attempt.id
      )
      and (readiness_after ->> 'dead_sourcing_jobs')::integer
        = (readiness_before ->> 'dead_sourcing_jobs')::integer
      and (readiness_after ->> 'ambiguous_sourcing_attempts')::integer
        = (readiness_before ->> 'ambiguous_sourcing_attempts')::integer,
    commit_result::text || ' / ' || readiness_after::text);

  perform aw_test.set_document_status('Sourcing');
  update public.sourcing_campaigns
     set status = 'sourcing', sourcing_stop_reason = null,
         sourcing_completed_at = null, updated_at = clock_timestamp()
   where id = '93000000-0000-4000-8000-000000000001';
end;
$$;

-- Prove activation per job in a rolled-back slice: the completed retry chain
-- is valid, but a different job with a scheduled retry and no latest-fence
-- receipt cannot borrow that completed job's campaign-level counts.
begin;
select set_config('aria.autonomous_web_retention_cleanup', 'on', true);
select set_config('aria.autonomous_web_payload_cleanup', 'on', true);
delete from public.autonomous_web_sourcing_staged_results stage
 where exists (
   select 1 from public.autonomous_web_sourcing_attempts attempt
    where attempt.id = stage.egress_attempt_id
      and attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_candidate_evidence evidence
 where evidence.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_reconciliations row_to_delete
 where row_to_delete.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_receipts row_to_delete
 where row_to_delete.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_failures row_to_delete
 where row_to_delete.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_results row_to_delete
 where row_to_delete.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_confirmations row_to_delete
 where row_to_delete.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_quota_ledger row_to_delete
 where row_to_delete.egress_attempt_id in (
   select attempt.id from public.autonomous_web_sourcing_attempts attempt
    where attempt.job_id <> '71000000-0000-4000-8000-000000000019'
 );
delete from public.autonomous_web_sourcing_attempts attempt
 where attempt.job_id <> '71000000-0000-4000-8000-000000000019';
do $$
declare
  pending_job constant uuid := '71000000-0000-4000-8000-000000000022';
  pending_lease constant uuid := '81000000-0000-4000-8000-000000000022';
  proof_before jsonb;
  proof_after jsonb;
  auth_result jsonb;
  begin_result jsonb;
  confirm_result jsonb;
  fail_result jsonb;
begin
  proof_before := public.get_autonomous_web_sourcing_activation_proof(
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001'
  );
  if proof_before ->> 'status' <> 'completed' then
    raise exception 'completed retry chain activation proof was rejected: %', proof_before;
  end if;

  perform aw_test.seed_job(pending_job, pending_lease);
  auth_result := aw_test.authorize(pending_job, pending_lease);
  begin_result := public.begin_autonomous_web_sourcing_egress(
    pending_job, pending_lease, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    (begin_result ->> 'egressAttemptId')::uuid, pending_job, pending_lease,
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'credentialId')::uuid,
    begin_result ->> 'credentialVersion', begin_result ->> 'queryPolicyVersion',
    begin_result ->> 'canonicalQuerySha256', begin_result ->> 'requestSha256'
  );
  fail_result := public.fail_autonomous_web_sourcing(
    pending_job, pending_lease, '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    'search_rate_limited', true, false
  );
  proof_after := public.get_autonomous_web_sourcing_activation_proof(
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001'
  );
  if confirm_result ->> 'status' <> 'confirmed'
     or fail_result ->> 'status' <> 'retry_scheduled'
     or proof_after ->> 'status' <> 'proof_invalid' then
    raise exception 'pending retry borrowed another job receipt: % / % / %',
      confirm_result, fail_result, proof_after;
  end if;
end;
$$;
rollback;

-- Retry flags are server-classified, and a retryable provider failure becomes
-- terminal once the queue attempt budget is exhausted.
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000020',
  '81000000-0000-4000-8000-000000000020'
);
update public.aria_jobs set max_attempts = attempt_count
 where id = '71000000-0000-4000-8000-000000000020';
do $$
<<budget_case>>
declare
  job_id constant uuid := '71000000-0000-4000-8000-000000000020';
  lease_id constant uuid := '81000000-0000-4000-8000-000000000020';
  auth_result jsonb;
  begin_result jsonb;
  confirm_result jsonb;
  invalid_retry_flag jsonb;
  missing_retry_flag jsonb;
  invalid_ambiguous_flag jsonb;
  exhausted_result jsonb;
begin
  auth_result := aw_test.authorize(job_id, lease_id);
  begin_result := public.begin_autonomous_web_sourcing_egress(
    job_id, lease_id, '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    (begin_result ->> 'egressAttemptId')::uuid, job_id, lease_id,
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'credentialId')::uuid,
    begin_result ->> 'credentialVersion', begin_result ->> 'queryPolicyVersion',
    begin_result ->> 'canonicalQuerySha256', begin_result ->> 'requestSha256'
  );
  invalid_retry_flag := public.fail_autonomous_web_sourcing(
    job_id, lease_id, '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    'credential_resolution_failed', true, false
  );
  missing_retry_flag := public.fail_autonomous_web_sourcing(
    job_id, lease_id, '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    'search_rate_limited', false, false
  );
  invalid_ambiguous_flag := public.fail_autonomous_web_sourcing(
    job_id, lease_id, '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    'provider_response_lost', false, true
  );
  exhausted_result := public.fail_autonomous_web_sourcing(
    job_id, lease_id, '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    'search_rate_limited', true, false
  );
  perform aw_test.expect('retry-classification-and-attempt-budget-fail-closed',
    confirm_result ->> 'status' = 'confirmed'
      and invalid_retry_flag ->> 'status' = 'invalid_request'
      and missing_retry_flag ->> 'status' = 'invalid_request'
      and invalid_ambiguous_flag ->> 'status' = 'invalid_request'
      and exhausted_result ->> 'status' = 'dead'
      and (select status from public.aria_jobs where id = budget_case.job_id) = 'dead'
      and exists (
        select 1 from public.autonomous_web_sourcing_failures failure
         where failure.egress_attempt_id = (begin_result ->> 'egressAttemptId')::uuid
           and failure.error_code = 'search_rate_limited'
           and failure.retryable and not failure.ambiguous
           and failure.disposition = 'dead'
      )
      and (select count(*) from public.autonomous_web_sourcing_attempts attempt
            where attempt.job_id = budget_case.job_id) = 1,
    invalid_retry_flag::text || ' / ' || missing_retry_flag::text || ' / '
      || invalid_ambiguous_flag::text || ' / ' || exhausted_result::text);
  begin
    update public.aria_jobs set status = 'queued' where id = budget_case.job_id;
    perform aw_test.expect('exhausted-web-retry-cannot-be-generically-requeued', false);
  exception when sqlstate '42501' then
    perform aw_test.expect('exhausted-web-retry-cannot-be-generically-requeued', true);
  end;
end;
$$;

select aw_test.set_document_status('Sourcing');
update public.sourcing_campaigns
   set status = 'sourcing', sourcing_stop_reason = null,
       sourcing_completed_at = null, updated_at = clock_timestamp()
 where id = '93000000-0000-4000-8000-000000000001';

-- A lost begin response is safely replayable only before the separate egress
-- confirmation exists. The replay returns byte-for-byte equivalent bound
-- authority, reserves no second quota unit, and becomes reconciliation-only
-- immediately after confirmation.
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000017',
  '81000000-0000-4000-8000-000000000017'
);
do $$
declare
  auth_result jsonb;
  first_begin jsonb;
  replayed_begin jsonb;
  confirm_result jsonb;
  post_confirm_begin jsonb;
  failure_result jsonb;
begin
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000017',
    '81000000-0000-4000-8000-000000000017'
  );
  first_begin := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000017',
    '81000000-0000-4000-8000-000000000017',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  replayed_begin := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000017',
    '81000000-0000-4000-8000-000000000017',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    (first_begin ->> 'egressAttemptId')::uuid,
    '71000000-0000-4000-8000-000000000017',
    '81000000-0000-4000-8000-000000000017',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (first_begin ->> 'credentialId')::uuid,
    first_begin ->> 'credentialVersion',
    first_begin ->> 'queryPolicyVersion',
    first_begin ->> 'canonicalQuerySha256',
    first_begin ->> 'requestSha256'
  );
  post_confirm_begin := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000017',
    '81000000-0000-4000-8000-000000000017',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  failure_result := public.fail_autonomous_web_sourcing(
    '71000000-0000-4000-8000-000000000017',
    '81000000-0000-4000-8000-000000000017',
    '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (first_begin ->> 'egressAttemptId')::uuid,
    'pre_egress_test_settlement', false, false
  );
  perform aw_test.expect('lost-begin-response-reissues-exact-live-authority',
    first_begin ->> 'status' = 'begun'
      and replayed_begin = first_begin
      and confirm_result ->> 'status' = 'confirmed'
      and post_confirm_begin ->> 'status' = 'already_begun'
      and post_confirm_begin ->> 'egressAttemptId' = first_begin ->> 'egressAttemptId'
      and failure_result ->> 'status' = 'dead'
      and (select count(*) from public.autonomous_web_sourcing_attempts
        where job_id = '71000000-0000-4000-8000-000000000017') = 1
      and (select count(*) from public.autonomous_web_sourcing_quota_ledger ledger
        join public.autonomous_web_sourcing_attempts attempt
          on attempt.id = ledger.egress_attempt_id
        where attempt.job_id = '71000000-0000-4000-8000-000000000017') = 2,
    first_begin::text || ' / ' || replayed_begin::text || ' / '
      || post_confirm_begin::text);
end;
$$;

-- The second fence immediately before provider fetch rechecks all mutable
-- execution authority. This attempt is then expired to prove that the generic
-- queue reaper cannot authorize a second egress after a begun attempt.
do $$
declare
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  confirm_result jsonb;
  reconcile_result jsonb;
begin
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where job_id = '71000000-0000-4000-8000-000000000011';

  update public.sourcing_campaigns
     set role_basis = '{"title":"revenue director","skills":["enterprise sales"]}'::jsonb
   where id = attempt_row.campaign_id;
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.campaign_id,
    attempt_row.claim_token, attempt_row.fence_version,
    attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256
  );
  perform aw_test.expect('pre-egress-confirm-query-change-denied',
    confirm_result ->> 'status' = 'query_invalid', confirm_result::text);
  update public.sourcing_campaigns
     set role_basis = '{"title":"sales director","skills":["enterprise sales","revenue operations"]}'::jsonb
   where id = attempt_row.campaign_id;

  perform aw_test.set_document_status('Paused');
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.campaign_id,
    attempt_row.claim_token, attempt_row.fence_version,
    attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256
  );
  perform aw_test.expect('pre-egress-confirm-pause-denied',
    confirm_result ->> 'status' = 'sourcing_disabled', confirm_result::text);
  perform aw_test.set_document_status('Sourcing');

  update public.api_keys
     set status = 'invalid', last_tested_at = last_tested_at + interval '1 second'
   where id = attempt_row.credential_id;
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.campaign_id,
    attempt_row.claim_token, attempt_row.fence_version,
    attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256
  );
  perform aw_test.expect('pre-egress-confirm-revocation-denied',
    confirm_result ->> 'status' = 'credential_unavailable', confirm_result::text);
  update public.api_keys
     set status = 'valid', last_tested_at = last_tested_at + interval '1 second',
         verification_method = 'tavily_key_info_v1', verification_http_status = 200
   where id = attempt_row.credential_id;

  update public.aria_jobs
     set lease_expires_at = clock_timestamp() - interval '1 second'
   where id = attempt_row.job_id;
  perform public.reap_expired_aria_job_leases(10);
  reconcile_result := public.reconcile_autonomous_web_sourcing(
    attempt_row.job_id, attempt_row.workspace_id, attempt_row.id, null
  );
  perform aw_test.expect('expired-begun-attempt-is-terminal-ambiguous',
    (select status from public.aria_jobs where id = attempt_row.job_id) = 'dead'
      and exists (
        select 1 from public.autonomous_web_sourcing_failures failure
         where failure.egress_attempt_id = attempt_row.id
           and failure.error_code = 'lease_expired_after_web_begin'
           and failure.ambiguous and not failure.retryable
      )
      and reconcile_result ->> 'status' = 'no_durable_response',
    reconcile_result::text);
end;
$$;

-- A provider fetch confirmation is a one-way boundary. If its response is
-- lost and no provider result is recorded, retrying confirmation never grants
-- another fetch and lease expiry settles the exact attempt as ambiguous.
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000014',
  '81000000-0000-4000-8000-000000000014'
);
do $$
declare
  auth_result jsonb;
  begin_result jsonb;
  confirm_result jsonb;
  confirm_retry jsonb;
  reconcile_result jsonb;
begin
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000014',
    '81000000-0000-4000-8000-000000000014'
  );
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000014',
    '81000000-0000-4000-8000-000000000014',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    (begin_result ->> 'egressAttemptId')::uuid,
    '71000000-0000-4000-8000-000000000014',
    '81000000-0000-4000-8000-000000000014',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'credentialId')::uuid,
    begin_result ->> 'credentialVersion', begin_result ->> 'queryPolicyVersion',
    begin_result ->> 'canonicalQuerySha256', begin_result ->> 'requestSha256'
  );
  confirm_retry := public.confirm_autonomous_web_sourcing_egress(
    (begin_result ->> 'egressAttemptId')::uuid,
    '71000000-0000-4000-8000-000000000014',
    '81000000-0000-4000-8000-000000000014',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'credentialId')::uuid,
    begin_result ->> 'credentialVersion', begin_result ->> 'queryPolicyVersion',
    begin_result ->> 'canonicalQuerySha256', begin_result ->> 'requestSha256'
  );
  update public.aria_jobs
     set lease_expires_at = clock_timestamp() - interval '1 second'
   where id = '71000000-0000-4000-8000-000000000014';
  perform public.reap_expired_aria_job_leases(10);
  reconcile_result := public.reconcile_autonomous_web_sourcing(
    '71000000-0000-4000-8000-000000000014',
    '53111111-1111-4111-8111-111111111111',
    (begin_result ->> 'egressAttemptId')::uuid, null
  );
  perform aw_test.expect('confirmed-crash-never-authorizes-second-fetch',
    confirm_result ->> 'status' = 'confirmed'
      and confirm_retry ->> 'status' = 'already_confirmed'
      and reconcile_result ->> 'status' = 'no_durable_response'
      and (select status from public.aria_jobs
        where id = '71000000-0000-4000-8000-000000000014') = 'dead'
      and (select count(*) from public.autonomous_web_sourcing_attempts
        where job_id = '71000000-0000-4000-8000-000000000014') = 1,
    confirm_result::text || ' / ' || confirm_retry::text
      || ' / ' || reconcile_result::text);
end;
$$;

do $$
declare
  happy_auth jsonb := (select value::jsonb from aw_test.context where key = 'happy_auth');
  happy_begin jsonb := (select value::jsonb from aw_test.context where key = 'happy_begin');
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  normalized_results jsonb := jsonb_build_array(jsonb_build_object(
    'url', 'https://www.linkedin.com/in/jane-seller',
    'title', 'Jane Seller - Sales Director | LinkedIn',
    'content', 'Enterprise sales leader building international teams.',
    'score', 0.91
  ));
  provider_receipt jsonb;
  record_result jsonb;
  record_replay jsonb;
  invalid_result jsonb;
  late_record_result jsonb;
  reconcile_result jsonb;
  recovery_auth jsonb;
  commit_result jsonb;
  replay_result jsonb;
  cross_tenant_failure jsonb;
  candidate_payload jsonb;
begin
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where id = (happy_begin ->> 'egressAttemptId')::uuid;
  provider_receipt := jsonb_build_object(
    'provider', 'tavily',
    'providerRequestId', 'tavily_req_123',
    'responseTimeMs', 123,
    'resultCount', 1,
    'querySha256', attempt_row.canonical_query_sha256,
    'requestSha256', attempt_row.request_sha256,
    'rawResponseSha256', repeat('a', 64),
    'rawResponseBytes', 512
  );

  -- The runtime starts a provider request before must_start_by, but the
  -- database remains the final authority for accepting its durable result.
  -- Rewind only this immutable confirmation inside a rolled-back subtransaction
  -- to prove a result cannot be registered after the fixed 15-second fetch and
  -- bounded five-second record allowance have elapsed.
  begin
    execute 'alter table public.autonomous_web_sourcing_confirmations disable trigger autonomous_web_sourcing_confirmations_immutable';
    update public.autonomous_web_sourcing_confirmations confirmation
       set confirmed_at = shifted.confirmed_at,
           must_start_by = shifted.confirmed_at + interval '10 seconds'
      from (select clock_timestamp() - interval '40 seconds' as confirmed_at) shifted
     where confirmation.egress_attempt_id = attempt_row.id;
    execute 'alter table public.autonomous_web_sourcing_confirmations enable trigger autonomous_web_sourcing_confirmations_immutable';
    late_record_result := public.record_autonomous_web_sourcing_result(
      attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
      attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
      'tavily', attempt_row.credential_id, attempt_row.credential_version,
      attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
      attempt_row.request_sha256, repeat('a', 64), 512,
      provider_receipt, normalized_results
    );
    raise exception 'rollback confirmation-window probe' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    null;
  end;
  perform aw_test.expect('late-provider-result-denied-by-database',
    late_record_result ->> 'status' = 'egress_not_confirmed',
    late_record_result::text);

  invalid_result := public.record_autonomous_web_sourcing_result(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
    'github', attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256, repeat('a', 64), 512,
    provider_receipt, normalized_results
  );
  perform aw_test.expect('forged-provider-denied',
    invalid_result ->> 'status' = 'invalid_request', invalid_result::text);
  invalid_result := public.record_autonomous_web_sourcing_result(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
    'tavily', '95000000-0000-4000-8000-000000000099', attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256, repeat('a', 64), 512,
    provider_receipt, normalized_results
  );
  perform aw_test.expect('forged-credential-denied',
    invalid_result ->> 'status' = 'attempt_binding_invalid', invalid_result::text);
  invalid_result := public.record_autonomous_web_sourcing_result(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
    'tavily', attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, repeat('f', 64),
    attempt_row.request_sha256, repeat('a', 64), 512,
    provider_receipt, normalized_results
  );
  perform aw_test.expect('forged-query-denied',
    invalid_result ->> 'status' = 'attempt_binding_invalid', invalid_result::text);

  begin
    perform public.record_autonomous_web_sourcing_result(
      attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
      attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
      'tavily', attempt_row.credential_id, attempt_row.credential_version,
      attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
      attempt_row.request_sha256, repeat('a', 64), 512,
      provider_receipt,
      jsonb_build_array(jsonb_build_object(
        'url', 'https://www.linkedin.com/in/not-grounded',
        'title', 'Unrelated Person | LinkedIn',
        'content', 'A profile with no matching evidence.',
        'score', 0.4
      ))
    );
    perform aw_test.expect('ungrounded-role-evidence-denied', false, 'unexpected success');
  exception when sqlstate '23514' then
    perform aw_test.expect('ungrounded-role-evidence-denied', true);
  end;
  begin
    perform public.record_autonomous_web_sourcing_result(
      attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
      attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
      'tavily', attempt_row.credential_id, attempt_row.credential_version,
      attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
      attempt_row.request_sha256, repeat('a', 64), 512,
      provider_receipt,
      jsonb_build_array(jsonb_build_object(
        'url', 'https://www.linkedin.com/in/single-term-only',
        'title', 'Unrelated Person | LinkedIn',
        'content', 'Enterprise sales leadership and commercial operations.',
        'score', 0.4
      ))
    );
    perform aw_test.expect('single-role-term-false-positive-denied', false, 'unexpected success');
  exception when sqlstate '23514' then
    perform aw_test.expect('single-role-term-false-positive-denied', true);
  end;
  perform aw_test.expect('invalid-result-is-atomic',
    not exists (select 1 from public.autonomous_web_sourcing_results
      where egress_attempt_id = attempt_row.id)
    and not exists (select 1 from public.autonomous_web_sourcing_staged_results
      where egress_attempt_id = attempt_row.id));

  record_result := public.record_autonomous_web_sourcing_result(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
    'tavily', attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256, repeat('a', 64), 512,
    provider_receipt, normalized_results
  );
  record_replay := public.record_autonomous_web_sourcing_result(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
    'tavily', attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256, repeat('a', 64), 512,
    provider_receipt, normalized_results
  );
  perform aw_test.expect('real-result-recorded-before-commit',
    record_result ->> 'status' = 'recorded'
      and (record_result ->> 'candidateCount')::integer = 1
      and record_replay ->> 'status' = 'recorded'
      and (record_replay ->> 'candidateCount')::integer = 1
      and record_replay ->> 'resultSha256' = record_result ->> 'resultSha256'
      and exists (select 1 from public.autonomous_web_sourcing_staged_results
        where egress_attempt_id = attempt_row.id)
      and not exists (select 1 from public.candidates
        where workspace_id = attempt_row.workspace_id
          and campaign_id = attempt_row.campaign_id::text), record_result::text);
  update public.aria_jobs
     set lease_expires_at = clock_timestamp() - interval '1 second'
   where id = attempt_row.job_id;
  perform public.reap_expired_aria_job_leases(10);
  perform aw_test.expect('durable-result-reaper-preserves-exact-commit',
    (select status from public.aria_jobs where id = attempt_row.job_id) = 'leased'
      and (select lease_id from public.aria_jobs where id = attempt_row.job_id)
        = attempt_row.lease_id
      and not exists (
        select 1 from public.autonomous_web_sourcing_failures failure
         where failure.egress_attempt_id = attempt_row.id
      ));
  reconcile_result := public.reconcile_autonomous_web_sourcing(
    attempt_row.job_id, attempt_row.workspace_id, attempt_row.id,
    record_result ->> 'resultSha256'
  );
  perform aw_test.expect('lost-commit-response-reconciles-result',
    reconcile_result ->> 'status' = 'result_ready'
      and (reconcile_result ->> 'candidateCount')::integer = 1,
    reconcile_result::text);
  recovery_auth := aw_test.authorize(attempt_row.job_id, attempt_row.lease_id);
  perform aw_test.expect('post-record-recovery-returns-bound-locator',
    recovery_auth ->> 'status' = 'attempt_already_started'
      and recovery_auth ->> 'egressAttemptId' = attempt_row.id::text
      and recovery_auth #>> '{locator,claimToken}' = attempt_row.claim_token::text
      and (recovery_auth #>> '{locator,fenceVersion}')::bigint = attempt_row.fence_version,
    recovery_auth::text);
  commit_result := public.commit_autonomous_web_sourcing(
    (recovery_auth #>> '{locator,jobId}')::uuid,
    (recovery_auth #>> '{locator,leaseId}')::uuid,
    (recovery_auth #>> '{locator,workspaceId}')::uuid,
    (recovery_auth #>> '{locator,campaignId}')::uuid,
    (recovery_auth #>> '{locator,claimToken}')::uuid,
    (recovery_auth #>> '{locator,fenceVersion}')::bigint,
    attempt_row.id, record_result ->> 'resultSha256'
  );
  replay_result := public.commit_autonomous_web_sourcing(
    attempt_row.job_id, attempt_row.lease_id, attempt_row.workspace_id,
    attempt_row.campaign_id, attempt_row.claim_token, attempt_row.fence_version,
    attempt_row.id, record_result ->> 'resultSha256'
  );
  cross_tenant_failure := public.fail_autonomous_web_sourcing(
    attempt_row.job_id, attempt_row.lease_id,
    '53222222-2222-4222-8222-222222222222',
    attempt_row.claim_token, attempt_row.fence_version, attempt_row.id,
    'cross_tenant_probe', false, false
  );
  perform aw_test.expect('atomic-commit-and-exact-replay',
    commit_result ->> 'status' = 'completed'
      and replay_result ->> 'status' = 'no_op_replay'
      and (replay_result ->> 'candidateCount')::integer = 1
      and (select status from public.aria_jobs where id = attempt_row.job_id) = 'succeeded'
      and exists (
        select 1
          from public.autonomous_web_sourcing_receipts receipt
          join public.autonomous_web_sourcing_claims claim
            on claim.job_id = receipt.job_id
         where receipt.job_id = attempt_row.job_id
           and receipt.canonical_query_sha256 = claim.canonical_query_sha256
           and receipt.canonical_query = claim.canonical_query
           and receipt.applied_lesson = claim.applied_lesson
           and receipt.applied_lesson ->> 'lesson_id'
             = '96100000-0000-4000-8000-000000000001'
           and receipt.applied_lesson ->> 'snapshot_sha256'
             = public.sourcing_batch_lesson_snapshot_sha256(receipt.applied_lesson)
      )
      and exists (select 1 from public.candidates
        where workspace_id = attempt_row.workspace_id
          and campaign_id = attempt_row.campaign_id::text
          and linkedin_url = 'https://www.linkedin.com/in/jane-seller')
      and exists (select 1 from public.autonomous_web_candidate_evidence
        where egress_attempt_id = attempt_row.id
          and role_evidence ->> 'roleTitle' = 'sales director'
          and role_evidence -> 'matchedRequiredSkills' = '["enterprise sales"]'::jsonb)
      and not exists (select 1 from public.autonomous_web_sourcing_staged_results
        where egress_attempt_id = attempt_row.id)
      and (select state ->> 'unrelated' from public.workspace_state
        where workspace_id = attempt_row.workspace_id) = 'preserve-me',
    commit_result::text || ' / ' || replay_result::text);
  perform aw_test.expect('completed-failure-replay-is-tenant-bound',
    cross_tenant_failure ->> 'status' = 'attempt_binding_invalid',
    cross_tenant_failure::text);
  select candidate.value into candidate_payload
    from public.workspace_state state
    cross join lateral jsonb_array_elements(state.state -> 'candidates') candidate(value)
   where state.workspace_id = attempt_row.workspace_id
     and candidate.value ->> 'campaignId' = attempt_row.campaign_id::text
     and candidate.value ->> 'linkedinUrl' = 'https://www.linkedin.com/in/jane-seller';
  perform aw_test.expect('candidate-payload-matches-current-ui-contract',
    candidate_payload ->> 'provenance' = 'live'
      and candidate_payload -> 'complianceFlags' = '{
        "doNotContact":false,
        "suppressed":false,
        "unsubscribed":false,
        "gdprExportRequested":false,
        "anonymized":false,
        "suppressedUntil":null
      }'::jsonb
      and candidate_payload ?& array[
        'lawfulBasis','lawfulBasisRecordedAt','lawfulBasisRecordedBy','lawfulBasisSource'
      ]
      and candidate_payload -> 'lawfulBasis' = 'null'::jsonb
      and candidate_payload -> 'lawfulBasisRecordedAt' = 'null'::jsonb
      and candidate_payload -> 'lawfulBasisRecordedBy' = 'null'::jsonb
      and candidate_payload -> 'lawfulBasisSource' = 'null'::jsonb
      and candidate_payload #>> '{sourceEvidence,provider}' = 'tavily'
      and candidate_payload #>> '{sourceEvidence,providerResultTitle}'
        = 'Jane Seller - Sales Director | LinkedIn',
    candidate_payload::text);
  insert into aw_test.context(key, value)
  values ('candidate_payload', candidate_payload::text)
  on conflict (key) do update set value = excluded.value;
  reconcile_result := public.reconcile_autonomous_web_sourcing(
    attempt_row.job_id, attempt_row.workspace_id, attempt_row.id,
    record_result ->> 'resultSha256'
  );
  perform aw_test.expect('lost-success-response-reconciles-receipt',
    reconcile_result ->> 'status' = 'completed'
      and (reconcile_result ->> 'candidateCount')::integer = 1,
    reconcile_result::text);
end;
$$;
SQL

# True commit-vs-erasure race. Erasure takes workspace_state first and holds it
# long enough for commit to enter. Before 0060's workspace-first repair this
# deterministically deadlocked after provider result durability; now erasure
# completes and commit settles the scrubbed staged result without a lock cycle.
psql_stdin -q <<'SQL'
select aw_test.set_claims('service_role');
select aw_test.set_document_status('Sourcing');
update public.sourcing_campaigns
   set status = 'sourcing', sourcing_stop_reason = null,
       sourcing_completed_at = null, updated_at = clock_timestamp()
 where id = '93000000-0000-4000-8000-000000000001';
update public.sourcing_loop_controls
   set max_sourcing_runs_per_day = 20
 where workspace_id = '53111111-1111-4111-8111-111111111111';
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000018',
  '81000000-0000-4000-8000-000000000018'
);
do $$
declare
  auth_result jsonb;
  begin_result jsonb;
  confirm_result jsonb;
  record_result jsonb;
  attempt_row public.autonomous_web_sourcing_attempts%rowtype;
  normalized_results jsonb := jsonb_build_array(jsonb_build_object(
    'url', 'https://www.linkedin.com/in/commit-erasure-race',
    'title', 'Commit Erasure Race - Sales Director | LinkedIn',
    'content', 'Enterprise sales leader building international teams.',
    'score', 0.92
  ));
  provider_receipt jsonb;
  seeded_candidate jsonb;
begin
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000018',
    '81000000-0000-4000-8000-000000000018'
  );
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000018',
    '81000000-0000-4000-8000-000000000018',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  select * into attempt_row from public.autonomous_web_sourcing_attempts
   where id = (begin_result ->> 'egressAttemptId')::uuid;
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.campaign_id,
    attempt_row.claim_token, attempt_row.fence_version,
    attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256
  );
  provider_receipt := jsonb_build_object(
    'provider', 'tavily',
    'providerRequestId', 'tavily_commit_erasure_race',
    'responseTimeMs', 125,
    'resultCount', 1,
    'querySha256', attempt_row.canonical_query_sha256,
    'requestSha256', attempt_row.request_sha256,
    'rawResponseSha256', repeat('c', 64),
    'rawResponseBytes', 512
  );
  record_result := public.record_autonomous_web_sourcing_result(
    attempt_row.id, attempt_row.job_id, attempt_row.lease_id,
    attempt_row.workspace_id, attempt_row.claim_token, attempt_row.fence_version,
    'tavily', attempt_row.credential_id, attempt_row.credential_version,
    attempt_row.query_policy_version, attempt_row.canonical_query_sha256,
    attempt_row.request_sha256, repeat('c', 64), 512,
    provider_receipt, normalized_results
  );
  seeded_candidate := public.autonomous_web_sourcing_candidates(
    attempt_row.workspace_id, attempt_row.campaign_id, attempt_row.id,
    (select role_basis from public.sourcing_campaigns
      where id = attempt_row.campaign_id),
    (select canonical_query || jsonb_build_object('batchOrdinal', batch_ordinal)
       from public.autonomous_web_sourcing_claims where job_id = attempt_row.job_id),
    repeat('c', 64), normalized_results, attempt_row.begun_at
  ) -> 0;
  update public.workspace_state
     set state = jsonb_set(
       state, '{candidates}',
       coalesce(state -> 'candidates', '[]'::jsonb) || jsonb_build_array(seeded_candidate),
       true
     )
   where workspace_id = attempt_row.workspace_id;
  insert into aw_test.context(key, value) values
    ('race_auth', auth_result::text),
    ('race_begin', begin_result::text),
    ('race_record', record_result::text),
    ('race_candidate_id', seeded_candidate ->> 'id')
  on conflict (key) do update set value = excluded.value;
  perform aw_test.expect('commit-erasure-race-staged',
    confirm_result ->> 'status' = 'confirmed'
      and record_result ->> 'status' = 'recorded'
      and exists (select 1 from public.autonomous_web_sourcing_staged_results
        where egress_attempt_id = attempt_row.id),
    confirm_result::text || ' / ' || record_result::text);
end;
$$;
SQL

(
  psql_stdin -q <<'SQL'
begin;
set local deadlock_timeout = '100ms';
select aw_test.set_claims('service_role');
select 1 from public.workspace_state
 where workspace_id = '53111111-1111-4111-8111-111111111111'
 for update;
select pg_sleep(1);
select public.request_candidate_erasure(
  '53111111-1111-4111-8111-111111111111',
  '63000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  (select value from aw_test.context where key = 'race_candidate_id'),
  '96000000-0000-4000-8000-000000000018'
);
commit;
SQL
) > "$tmp_dir/commit-erasure-b.log" 2>&1 &
erasure_pid=$!

sleep 0.2
(
  psql_stdin -q <<'SQL'
begin;
set local deadlock_timeout = '100ms';
select aw_test.set_claims('service_role');
do $$
declare
  auth_result jsonb := (select value::jsonb from aw_test.context where key = 'race_auth');
  begin_result jsonb := (select value::jsonb from aw_test.context where key = 'race_begin');
  record_result jsonb := (select value::jsonb from aw_test.context where key = 'race_record');
  commit_result jsonb;
  failure_result jsonb;
begin
  commit_result := public.commit_autonomous_web_sourcing(
    (auth_result #>> '{locator,jobId}')::uuid,
    (auth_result #>> '{locator,leaseId}')::uuid,
    (auth_result #>> '{locator,workspaceId}')::uuid,
    (auth_result #>> '{locator,campaignId}')::uuid,
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    record_result ->> 'resultSha256'
  );
  if commit_result ->> 'status' = 'result_binding_invalid' then
    failure_result := public.fail_autonomous_web_sourcing(
      (auth_result #>> '{locator,jobId}')::uuid,
      (auth_result #>> '{locator,leaseId}')::uuid,
      (auth_result #>> '{locator,workspaceId}')::uuid,
      (auth_result #>> '{locator,claimToken}')::uuid,
      (auth_result #>> '{locator,fenceVersion}')::bigint,
      (begin_result ->> 'egressAttemptId')::uuid,
      'result_binding_invalid', false, false
    );
  end if;
  if commit_result ->> 'status' <> 'result_binding_invalid'
     or failure_result ->> 'status' <> 'dead' then
    raise exception 'unexpected commit/erasure settlement: % / %',
      commit_result, failure_result;
  end if;
end;
$$;
commit;
SQL
) > "$tmp_dir/commit-erasure-a.log" 2>&1 &
commit_pid=$!

set +e
wait "$commit_pid"
commit_status=$?
wait "$erasure_pid"
erasure_status=$?
set -e
if [[ "$commit_status" -ne 0 || "$erasure_status" -ne 0 ]] \
   || rg -q "deadlock detected" "$tmp_dir/commit-erasure-a.log" "$tmp_dir/commit-erasure-b.log"; then
  cat "$tmp_dir/commit-erasure-a.log" "$tmp_dir/commit-erasure-b.log" >&2
  echo "commit-vs-erasure concurrency failed ($commit_status/$erasure_status)" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
select aw_test.expect('commit-vs-erasure-is-deadlock-free-and-settled',
  (select status from public.aria_jobs
    where id = '71000000-0000-4000-8000-000000000018') = 'dead'
  and exists (
    select 1 from public.autonomous_web_sourcing_failures failure
     where failure.job_id = '71000000-0000-4000-8000-000000000018'
       and failure.error_code = 'result_binding_invalid'
       and not failure.retryable and not failure.ambiguous
  )
  and not exists (
    select 1 from public.autonomous_web_sourcing_staged_results stage
     join public.autonomous_web_sourcing_attempts attempt
       on attempt.id = stage.egress_attempt_id
    where attempt.job_id = '71000000-0000-4000-8000-000000000018'
  ));
SQL

psql_stdin -q <<'SQL'
select aw_test.set_claims('service_role');

-- A separate begun attempt proves ambiguous outcomes are terminal and never
-- return a second egress request.
select aw_test.set_document_status('Sourcing');
update public.sourcing_campaigns
   set status = 'sourcing', sourcing_stop_reason = null, sourcing_completed_at = null
 where id = '93000000-0000-4000-8000-000000000001';
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000012',
  '81000000-0000-4000-8000-000000000012'
);
do $$
declare
  auth_result jsonb;
  begin_result jsonb;
  confirm_result jsonb;
  fail_result jsonb;
  reconcile_result jsonb;
begin
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000012'
  );
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000012',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  confirm_result := public.confirm_autonomous_web_sourcing_egress(
    (begin_result ->> 'egressAttemptId')::uuid,
    '71000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000012',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'credentialId')::uuid,
    begin_result ->> 'credentialVersion', begin_result ->> 'queryPolicyVersion',
    begin_result ->> 'canonicalQuerySha256', begin_result ->> 'requestSha256'
  );
  fail_result := public.fail_autonomous_web_sourcing(
    '71000000-0000-4000-8000-000000000012',
    '81000000-0000-4000-8000-000000000012',
    '53111111-1111-4111-8111-111111111111',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint,
    (begin_result ->> 'egressAttemptId')::uuid,
    'search_transport_unknown', false, true
  );
  reconcile_result := public.reconcile_autonomous_web_sourcing(
    '71000000-0000-4000-8000-000000000012',
    '53111111-1111-4111-8111-111111111111',
    (begin_result ->> 'egressAttemptId')::uuid, null
  );
  perform aw_test.expect('ambiguous-outcome-terminal',
    confirm_result ->> 'status' = 'confirmed'
      and fail_result ->> 'status' = 'ambiguous'
      and reconcile_result ->> 'status' = 'no_durable_response'
      and (select status from public.aria_jobs
        where id = '71000000-0000-4000-8000-000000000012') = 'dead'
      and (select last_error from public.aria_jobs
        where id = '71000000-0000-4000-8000-000000000012')
        = 'autonomous web sourcing failed: search_transport_unknown'
      and (select count(*) from public.autonomous_web_sourcing_attempts
        where job_id = '71000000-0000-4000-8000-000000000012') = 1,
    fail_result::text || ' / ' || reconcile_result::text);
end;
$$;

-- Provider/workspace quota is reserved only on begun attempts.
select aw_test.seed_job(
  '71000000-0000-4000-8000-000000000013',
  '81000000-0000-4000-8000-000000000013'
);
update public.sourcing_loop_controls
   set max_sourcing_runs_per_day = (
     select coalesce(sum(reserved_units), 0)::integer
       from public.autonomous_web_sourcing_quota_ledger
      where workspace_id = '53111111-1111-4111-8111-111111111111'
        and scope_kind = 'workspace_day'
        and window_start = date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC'
   )
 where workspace_id = '53111111-1111-4111-8111-111111111111';
do $$
declare auth_result jsonb; begin_result jsonb;
begin
  auth_result := aw_test.authorize(
    '71000000-0000-4000-8000-000000000013',
    '81000000-0000-4000-8000-000000000013'
  );
  begin_result := public.begin_autonomous_web_sourcing_egress(
    '71000000-0000-4000-8000-000000000013',
    '81000000-0000-4000-8000-000000000013',
    '53111111-1111-4111-8111-111111111111',
    '93000000-0000-4000-8000-000000000001',
    (auth_result #>> '{locator,claimToken}')::uuid,
    (auth_result #>> '{locator,fenceVersion}')::bigint
  );
  perform aw_test.expect('workspace-provider-quota-enforced',
    begin_result ->> 'status' = 'quota_exhausted', begin_result::text);
end;
$$;

-- Expired candidate evidence is retained while an exact active legal hold is
-- in force, then becomes eligible immediately after release or hold expiry.
-- Restore the original evidence at the end so the erasure trigger below still
-- proves its independent cleanup path.
do $$
declare
  candidate_key text;
  evidence_row public.autonomous_web_candidate_evidence%rowtype;
  hold_result jsonb;
  release_result jsonb;
begin
  select id into candidate_key from public.candidates
   where workspace_id = '53111111-1111-4111-8111-111111111111'
     and campaign_id = '93000000-0000-4000-8000-000000000001'
   limit 1;
  select * into evidence_row from public.autonomous_web_candidate_evidence evidence
   where evidence.workspace_id = '53111111-1111-4111-8111-111111111111'
     and evidence.campaign_id = '93000000-0000-4000-8000-000000000001'
     and evidence.candidate_id = candidate_key;

  hold_result := public.place_candidate_legal_hold(
    evidence_row.workspace_id,
    '63000000-0000-4000-8000-000000000001',
    evidence_row.campaign_id::text,
    evidence_row.candidate_id,
    'RETENTION_HOLD', 'case:web-retention-active',
    clock_timestamp() + interval '1 day'
  );
  perform set_config('aria.autonomous_web_retention_cleanup', 'on', true);
  delete from public.autonomous_web_candidate_evidence evidence
   where evidence.workspace_id = evidence_row.workspace_id
     and evidence.campaign_id = evidence_row.campaign_id
     and evidence.candidate_id = evidence_row.candidate_id;
  insert into public.autonomous_web_candidate_evidence(
    workspace_id, campaign_id, candidate_id, egress_attempt_id, provider,
    provider_external_id, linkedin_url, canonical_query_sha256,
    raw_response_sha256, provider_result_sha256, normalized_payload_sha256,
    role_evidence, recorded_at, expires_at
  ) values (
    evidence_row.workspace_id, evidence_row.campaign_id, evidence_row.candidate_id,
    evidence_row.egress_attempt_id, evidence_row.provider,
    evidence_row.provider_external_id, evidence_row.linkedin_url,
    evidence_row.canonical_query_sha256, evidence_row.raw_response_sha256,
    evidence_row.provider_result_sha256, evidence_row.normalized_payload_sha256,
    evidence_row.role_evidence, evidence_row.recorded_at,
    clock_timestamp() - interval '1 second'
  );

  perform public.cleanup_autonomous_web_sourcing_retention(500);
  perform aw_test.expect('active-legal-hold-preserves-expired-web-evidence',
    hold_result ->> 'status' = 'active'
      and exists (
        select 1 from public.autonomous_web_candidate_evidence evidence
         where evidence.workspace_id = evidence_row.workspace_id
           and evidence.campaign_id = evidence_row.campaign_id
           and evidence.candidate_id = evidence_row.candidate_id
      ), hold_result::text);

  release_result := public.release_candidate_legal_hold(
    evidence_row.workspace_id,
    '63000000-0000-4000-8000-000000000001',
    (hold_result ->> 'hold_id')::uuid,
    'case:web-retention-release'
  );
  perform public.cleanup_autonomous_web_sourcing_retention(500);
  perform aw_test.expect('released-legal-hold-allows-expired-web-evidence-cleanup',
    release_result ->> 'status' = 'released'
      and not exists (
        select 1 from public.autonomous_web_candidate_evidence evidence
         where evidence.workspace_id = evidence_row.workspace_id
           and evidence.campaign_id = evidence_row.campaign_id
           and evidence.candidate_id = evidence_row.candidate_id
      ), release_result::text);

  insert into public.autonomous_web_candidate_evidence(
    workspace_id, campaign_id, candidate_id, egress_attempt_id, provider,
    provider_external_id, linkedin_url, canonical_query_sha256,
    raw_response_sha256, provider_result_sha256, normalized_payload_sha256,
    role_evidence, recorded_at, expires_at
  ) values (
    evidence_row.workspace_id, evidence_row.campaign_id, evidence_row.candidate_id,
    evidence_row.egress_attempt_id, evidence_row.provider,
    evidence_row.provider_external_id, evidence_row.linkedin_url,
    evidence_row.canonical_query_sha256, evidence_row.raw_response_sha256,
    evidence_row.provider_result_sha256, evidence_row.normalized_payload_sha256,
    evidence_row.role_evidence, evidence_row.recorded_at,
    clock_timestamp() - interval '1 second'
  );
  insert into public.candidate_legal_holds(
    workspace_id, campaign_id, candidate_id, reason_code, case_reference,
    status, placed_by, placed_at, expires_at
  ) values (
    evidence_row.workspace_id, evidence_row.campaign_id::text,
    evidence_row.candidate_id, 'RETENTION_EXPIRED', 'case:web-retention-expired',
    'active', '63000000-0000-4000-8000-000000000001',
    clock_timestamp() - interval '2 days',
    clock_timestamp() - interval '1 day'
  );
  perform public.cleanup_autonomous_web_sourcing_retention(500);
  perform aw_test.expect('expired-legal-hold-allows-expired-web-evidence-cleanup',
    not exists (
      select 1 from public.autonomous_web_candidate_evidence evidence
       where evidence.workspace_id = evidence_row.workspace_id
         and evidence.campaign_id = evidence_row.campaign_id
         and evidence.candidate_id = evidence_row.candidate_id
    ));

  insert into public.autonomous_web_candidate_evidence(
    workspace_id, campaign_id, candidate_id, egress_attempt_id, provider,
    provider_external_id, linkedin_url, canonical_query_sha256,
    raw_response_sha256, provider_result_sha256, normalized_payload_sha256,
    role_evidence, recorded_at, expires_at
  ) values (
    evidence_row.workspace_id, evidence_row.campaign_id, evidence_row.candidate_id,
    evidence_row.egress_attempt_id, evidence_row.provider,
    evidence_row.provider_external_id, evidence_row.linkedin_url,
    evidence_row.canonical_query_sha256, evidence_row.raw_response_sha256,
    evidence_row.provider_result_sha256, evidence_row.normalized_payload_sha256,
    evidence_row.role_evidence, evidence_row.recorded_at, evidence_row.expires_at
  );
end;
$$;

-- Erasure creates suppression tombstones, removes candidate evidence, and
-- blocks re-import of the same public LinkedIn identity.
do $$
declare candidate_key text; erase_result jsonb;
begin
  select id into candidate_key from public.candidates
   where workspace_id = '53111111-1111-4111-8111-111111111111'
     and campaign_id = '93000000-0000-4000-8000-000000000001'
   limit 1;
  erase_result := public.request_candidate_erasure(
    '53111111-1111-4111-8111-111111111111',
    '63000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001', candidate_key,
    '96000000-0000-4000-8000-000000000001'
  );
  perform aw_test.expect('candidate-erasure-cleans-web-evidence',
    erase_result ->> 'status' in ('pending_provider','manual_required','completed')
      and not exists (select 1 from public.autonomous_web_candidate_evidence
        where workspace_id = '53111111-1111-4111-8111-111111111111'
          and candidate_id = candidate_key)
      and public.candidate_erasure_tombstone_exists(
        '53111111-1111-4111-8111-111111111111',
        'linkedin', 'https://www.linkedin.com/in/jane-seller'
      ), erase_result::text);
end;
$$;

-- ACL/RLS and immutable rows.
select aw_test.expect('table-acl-denies-api-roles',
  not has_table_privilege('service_role', 'public.autonomous_web_sourcing_claims', 'SELECT')
  and not has_table_privilege('authenticated', 'public.autonomous_web_sourcing_attempts', 'SELECT')
  and not has_table_privilege('anon', 'public.autonomous_web_candidate_evidence', 'INSERT'));
select aw_test.expect('rpc-acl-service-only',
  has_function_privilege('service_role',
    'public.authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role',
    'public.authorize_sourcing_batch_0054(uuid,uuid,uuid,uuid,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('service_role',
    'public.autonomous_web_activation_counts_are_valid(integer,integer,integer,integer)', 'EXECUTE')
  and not has_function_privilege('service_role',
    'public.autonomous_web_activation_job_counts_are_valid(integer,integer,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.authorize_autonomous_web_sourcing(uuid,uuid,uuid,uuid,text,integer)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.confirm_autonomous_web_sourcing_egress(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.authorize_autonomous_web_sourcing(uuid,uuid,uuid,uuid,text,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.confirm_autonomous_web_sourcing_egress(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.commit_autonomous_web_sourcing(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text)', 'EXECUTE'));
do $$
begin
  begin
    update public.autonomous_web_sourcing_attempts set provider = 'tavily';
    perform aw_test.expect('immutable-attempts', false, 'unexpected update');
  exception when sqlstate '42501' then
    perform aw_test.expect('immutable-attempts', true);
  end;
end;
$$;
select aw_test.expect('rls-forced-on-all-web-tables', not exists (
  select 1
    from unnest(array[
      'autonomous_web_sourcing_claims','autonomous_web_sourcing_attempts',
      'autonomous_web_sourcing_confirmations',
      'autonomous_web_sourcing_results','autonomous_web_sourcing_staged_results',
      'autonomous_web_candidate_evidence','autonomous_web_sourcing_receipts',
      'autonomous_web_sourcing_failures','autonomous_web_sourcing_reconciliations',
      'autonomous_web_sourcing_quota_ledger'
    ]) expected(name)
    left join pg_class relation
      on relation.oid = to_regclass('public.' || expected.name)
   where not relation.relrowsecurity or not relation.relforcerowsecurity
));

select aw_test.expect('retention-rpc-bounded',
  public.cleanup_autonomous_web_sourcing_retention(500) ->> 'status' = 'completed');

do $$
declare
  readiness jsonb;
  autonomous_failure_jobs integer;
  autonomous_ambiguous_attempts integer;
begin
  select count(distinct failure.job_id)::integer,
         count(*) filter (where failure.ambiguous)::integer
    into autonomous_failure_jobs, autonomous_ambiguous_attempts
    from public.autonomous_web_sourcing_failures failure
   where failure.disposition in ('dead', 'ambiguous');
  readiness := public.get_sourcing_loop_readiness(repeat('a', 40));
  perform aw_test.expect(
    'readiness-includes-autonomous-failures',
    autonomous_failure_jobs > 0
      and (readiness ->> 'dead_sourcing_jobs')::integer >= autonomous_failure_jobs
      and not (readiness ->> 'healthy')::boolean,
    readiness::text
  );
  perform aw_test.expect(
    'readiness-includes-autonomous-ambiguity',
    autonomous_ambiguous_attempts > 0
      and (readiness ->> 'ambiguous_sourcing_attempts')::integer
        >= autonomous_ambiguous_attempts,
    readiness::text
  );
end;
$$;

do $$
declare failures text;
begin
  select string_agg(case_name || coalesce(': ' || detail, ''), E'\n' order by case_name)
    into failures from aw_test.results where not passed;
  if failures is not null then
    raise exception E'autonomous web sourcing assertions failed:\n%', failures;
  end if;
end;
$$;
select count(*) as assertions from aw_test.results;
SQL

candidate_payload="$(psql_query "select value from aw_test.context where key='candidate_payload'")"
node --import tsx - "$candidate_payload" <<'NODE'
const candidatePayload = JSON.parse(process.argv[2]);
const imported = await import("./src/lib/candidate-payload.ts");
const candidateFromPayload = imported.candidateFromPayload ?? imported.default?.candidateFromPayload;
if (typeof candidateFromPayload !== "function") {
  throw new Error("candidateFromPayload export is unavailable");
}
const candidate = candidateFromPayload(candidatePayload);
if (!candidate) throw new Error("persisted autonomous candidate was rejected by candidateFromPayload");
if (candidate.provenance !== "live") throw new Error("candidate provenance was lost during sanitization");
if (candidate.complianceFlags.anonymized !== false) {
  throw new Error("candidate anonymized flag was lost during sanitization");
}
if (candidate.complianceFlags.suppressedUntil !== null) {
  throw new Error("candidate suppression horizon was lost during sanitization");
}
if (candidate.id !== candidatePayload.id || candidate.campaignId !== candidatePayload.campaignId) {
  throw new Error("candidate identity was lost during sanitization");
}
if (candidate.linkedinUrl !== candidatePayload.linkedinUrl || candidate.sourceUrl !== candidatePayload.sourceUrl) {
  throw new Error("candidate source identity was lost during sanitization");
}
NODE

# Rollback refuses live evidence, succeeds only with explicit same-transaction
# acknowledgement, and the forward migration reapplies cleanly.
if psql_stdin -q < supabase/rollbacks/0060_autonomous_web_sourcing_authority.sql \
    > "$tmp_dir/rollback-refusal.log" 2>&1; then
  echo "0060 rollback unexpectedly destroyed live rows" >&2
  exit 1
fi
if ! rg -q "0060 rollback refused" "$tmp_dir/rollback-refusal.log"; then
  cat "$tmp_dir/rollback-refusal.log" >&2
  echo "0060 rollback did not fail at its evidence guard" >&2
  exit 1
fi
if [[ "$(psql_query "select public.expected_sourcing_loop_handler_contract_sha256()")" != "88ed71725132fec6e7981c52d200513810f668d358811fdbcc213339b26cb6f3" ]]; then
  echo "0060 refused rollback mutated the live four-handler contract" >&2
  exit 1
fi

{
  printf '%s\n' "begin;" "set local aria.allow_0060_rollback = 'on';"
  sed '/^set local /d' supabase/rollbacks/0060_autonomous_web_sourcing_authority.sql
  printf '%s\n' "commit;"
} | psql_stdin -q

if [[ "$(psql_query "select to_regclass('public.autonomous_web_sourcing_claims') is null")" != "t" ]]; then
  echo "0060 guarded rollback left authority tables behind" >&2
  exit 1
fi
psql_stdin -q <<'SQL'
select set_config('request.jwt.claim.role', 'service_role', false);
do $$
declare readiness jsonb;
begin
  if to_regprocedure(
       'public.authorize_sourcing_batch_0054(uuid,uuid,uuid,uuid,text,integer,text)'
     ) is not null
     or to_regprocedure(
       'public.authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,text)'
     ) is null
     or not has_function_privilege(
       'service_role',
       'public.authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,text)',
       'EXECUTE'
     ) then
    raise exception '0060 rollback did not restore the 0054 authorizer boundary';
  end if;
  if public.expected_sourcing_loop_handler_contract_sha256()
       <> '41b9fc68fdf487c768fca4b83246c9c47dbce7acb9ca783d17f088144f8a108b' then
    raise exception '0060 rollback did not restore the 0054 handler contract';
  end if;
  readiness := public.get_sourcing_loop_readiness('invalid');
  if (readiness ->> 'expected_handler_count')::integer <> 3
     or readiness ->> 'heartbeat_status' <> 'release_invalid' then
    raise exception '0060 rollback did not restore 0054 readiness: %', readiness;
  end if;
end;
$$;
SQL
psql_stdin --single-transaction -q < supabase/migrations/0060_autonomous_web_sourcing_authority.sql
if [[ "$(psql_query "select to_regprocedure('public.authorize_autonomous_web_sourcing(uuid,uuid,uuid,uuid,text,integer)') is not null and to_regprocedure('public.autonomous_web_sourcing_query_is_allowed(jsonb,jsonb)') is not null and to_regprocedure('public.authorize_sourcing_batch_0054(uuid,uuid,uuid,uuid,text,integer,text)') is not null and has_function_privilege('service_role', 'public.authorize_sourcing_batch(uuid,uuid,uuid,uuid,text,integer,text)', 'EXECUTE') and not has_function_privilege('service_role', 'public.authorize_sourcing_batch_0054(uuid,uuid,uuid,uuid,text,integer,text)', 'EXECUTE')")" != "t" ]]; then
  echo "0060 did not reapply after guarded rollback" >&2
  exit 1
fi
psql_stdin -q <<'SQL'
select set_config('request.jwt.claim.role', 'service_role', false);
do $$
declare readiness jsonb;
begin
  if public.expected_sourcing_loop_handler_contract_sha256()
       <> '88ed71725132fec6e7981c52d200513810f668d358811fdbcc213339b26cb6f3' then
    raise exception '0060 reapply did not restore the four-handler contract';
  end if;
  readiness := public.get_sourcing_loop_readiness('invalid');
  if (readiness ->> 'expected_handler_count')::integer <> 4
     or readiness ->> 'heartbeat_status' <> 'release_invalid' then
    raise exception '0060 reapply did not restore combined readiness: %', readiness;
  end if;
end;
$$;
SQL

echo "autonomous-web-sourcing-db: authority, evidence, readiness, replay, concurrency, erasure, ACL, rollback: PASS"
