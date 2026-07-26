#!/usr/bin/env bash
# Disposable-Postgres proof for 0058 ordinary sourcing result durability.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-sourcing-results-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
race_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  exec 9>&- 2>/dev/null || true
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$race_dir"
}
trap cleanup EXIT HUP INT TERM

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

receipt_store_allowlist() {
  psql_stdin -Atqc "
    select string_agg(matches.value[1], '|' order by matches.ordinality)
      from pg_constraint constraint_record
      cross join lateral regexp_matches(
        pg_get_constraintdef(constraint_record.oid, true),
        '''([^'']+)''',
        'g'
      ) with ordinality as matches(value, ordinality)
     where constraint_record.conrelid = 'public.candidate_erasure_receipts'::regclass
       and constraint_record.conname = 'candidate_erasure_receipts_store_name_check'
  "
}

receipt_allowlist_pre0058='workspace_state|messages_outbound|messages_inbound|agent_conversations|outreach_ledger|outreach_approvals|suppression_list|whatsapp_contacts|whatsapp_conversation_windows|whatsapp_delivery_events|outbound_content_cache|apollo_enrichment|agent_runs|agent_events|agent_framework_results|sourcing_candidate_evidence'
receipt_allowlist_0058="$receipt_allowlist_pre0058|ordinary_sourcing_results"
receipt_allowlist_0059="$receipt_allowlist_0058|agent_memories|candidate_payload_provenance"

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if (( 10#${base%%_*} > 59 )); then
    break
  fi
  psql_stdin --single-transaction -q < "$migration"
done

# A production ledger at 0066 or later is an unconditional compatibility
# boundary: the 0059 rollback must refuse before changing its receipt contract.
psql_stdin -q <<'SQL'
create table public.aria_schema_migrations(
  filename text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
insert into public.aria_schema_migrations(filename,sha256)
values ('0066_candidate_global_legal_hold_authority.sql',repeat('6',64));
SQL
ledger_guard_before="$(receipt_store_allowlist)"
set +e
ledger_guard_output="$(psql_stdin -qAt 2>&1 < supabase/rollbacks/0059_candidate_payload_provenance.sql)"
ledger_guard_status=$?
set -e
if [[ "$ledger_guard_status" -eq 0 \
   || "$ledger_guard_output" != *"refusing 0059 rollback while candidate-global legal-hold authority 0066 or later remains applied"* ]]; then
  echo "0059 rollback did not refuse the ledgered 0066 boundary" >&2
  echo "$ledger_guard_output" >&2
  exit 1
fi
if [[ "$(receipt_store_allowlist)" != "$ledger_guard_before" ]]; then
  echo "0059 ledger-boundary refusal changed the receipt allowlist" >&2
  exit 1
fi
psql_stdin -q -c 'drop table public.aria_schema_migrations'

# A rollback may not skip the applied 0059 dependency. Prove the guard first,
# then roll back and reapply in exact reverse/forward migration order before
# issuing any result evidence.
set +e
out_of_order_rollback="$(psql_stdin -qAt 2>&1 < supabase/rollbacks/0058_ordinary_sourcing_result_durability.sql)"
out_of_order_status=$?
set -e
if [[ "$out_of_order_status" -eq 0 || "$out_of_order_rollback" != *"refusing 0058 rollback while later migration 0059 remains applied"* ]]; then
  echo "0058 rollback did not reject an applied 0059 dependency" >&2
  echo "$out_of_order_rollback" >&2
  exit 1
fi
psql_stdin -q < supabase/rollbacks/0059_candidate_payload_provenance.sql
if [[ "$(receipt_store_allowlist)" != "$receipt_allowlist_0058" ]]; then
  echo "0059 rollback did not restore the exact 0058 receipt allowlist" >&2
  exit 1
fi
psql_stdin -q < supabase/rollbacks/0058_ordinary_sourcing_result_durability.sql
psql_stdin -q < supabase/rollbacks/0058_ordinary_sourcing_result_durability.sql
if [[ "$(receipt_store_allowlist)" != "$receipt_allowlist_pre0058" ]]; then
  echo "0058 rollback did not restore the exact pre-0058 receipt allowlist" >&2
  exit 1
fi
psql_stdin -q < supabase/migrations/0058_ordinary_sourcing_result_durability.sql
if [[ "$(receipt_store_allowlist)" != "$receipt_allowlist_0058" ]]; then
  echo "0058 reapply did not restore its exact receipt allowlist" >&2
  exit 1
fi
psql_stdin -q < supabase/migrations/0059_candidate_payload_provenance.sql
if [[ "$(receipt_store_allowlist)" != "$receipt_allowlist_0059" ]]; then
  echo "0059 reapply did not restore its exact receipt allowlist" >&2
  exit 1
fi

# Install successors through 0063 before behavioral proof. Migration 0064
# expands the erasure receipt allowlist, so it follows the legacy 0058 replay
# assertion instead of being temporarily narrowed by that replay.
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if (( 10#${base%%_*} <= 59 )); then
    continue
  fi
  if (( 10#${base%%_*} > 63 )); then
    break
  fi
  psql_stdin --single-transaction -q < "$migration"
done

psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema sourcing_result_test;
create table sourcing_result_test.context (
  key text primary key,
  value jsonb not null
);

create function sourcing_result_test.set_claims(p_role text, p_subject uuid default null)
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

create function sourcing_result_test.role_basis()
returns jsonb
language sql
immutable
as $$
  select '{
    "title":"Platform Engineer",
    "seniority":"Senior",
    "employmentType":"Permanent",
    "locationType":"Remote",
    "region":"Canada",
    "timezone":"America/Toronto",
    "skills":["Go","PostgreSQL"]
  }'::jsonb;
$$;

create function sourcing_result_test.candidate(p_campaign_id text, p_candidate_id text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_candidate_id,
    'campaignId', p_campaign_id,
    'name', 'Verified Candidate',
    'currentTitle', 'Platform Engineer',
    'currentCompany', 'Observed Company',
    'location', 'Toronto',
    'linkedinUrl', '',
    'githubUrl', 'https://github.com/verified-candidate',
    'sourceUrl', 'https://github.com/verified-candidate',
    'sourcePlatform', 'GitHub',
    'sourceQuery', 'language:Go type:user',
    'matchScore', 80,
    'matchBreakdown', '[]'::jsonb,
    'techStack', jsonb_build_array('Go', 'PostgreSQL'),
    'recentActivity', 'Observed public repository activity.',
    'createdAt', '2026-07-21T12:00:00.000Z'
  );
$$;

create function sourcing_result_test.payload(
  p_campaign_id text,
  p_campaign_fingerprint text,
  p_idempotency_key uuid,
  p_run_id uuid,
  p_request_id text,
  p_candidates jsonb default '[]'::jsonb
) returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'ok', true,
    'mode', 'deterministic',
    'campaignId', p_campaign_id,
    'campaignFingerprint', p_campaign_fingerprint,
    'candidates', p_candidates,
    'totalFound', jsonb_array_length(p_candidates),
    'requestId', p_request_id,
    'idempotencyKey', p_idempotency_key,
    'sourcingRunId', p_run_id,
    'appliedLessonIds', '[]'::jsonb
  );
$$;

grant usage on schema sourcing_result_test to authenticated, service_role;
grant execute on all functions in schema sourcing_result_test to authenticated, service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member-a@example.test','',now(),'{}','{}',now(),now()),
  ('c2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id, name) values
  ('71111111-1111-4111-8111-111111111111', 'Sourcing Results A'),
  ('72222222-2222-4222-8222-222222222222', 'Sourcing Results B');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001','admin-a@example.test','Admin A','71111111-1111-4111-8111-111111111111','admin'),
  ('c1000000-0000-4000-8000-000000000002','member-a@example.test','Member A','71111111-1111-4111-8111-111111111111','member'),
  ('c2000000-0000-4000-8000-000000000001','admin-b@example.test','Admin B','72222222-2222-4222-8222-222222222222','admin');
insert into public.workspace_state(workspace_id, state) values
  ('71111111-1111-4111-8111-111111111111', '{"candidates":[]}'::jsonb),
  ('72222222-2222-4222-8222-222222222222', '{"candidates":[]}'::jsonb);

select sourcing_result_test.set_claims(
  'service_role', 'c1000000-0000-4000-8000-000000000001'
);

do $ordinary_result_behavior$
<<ordinary_result_behavior>>
declare
  workspace_id constant uuid := '71111111-1111-4111-8111-111111111111';
  actor_id constant uuid := 'c1000000-0000-4000-8000-000000000001';
  other_actor_id constant uuid := 'c1000000-0000-4000-8000-000000000002';
  campaign_id constant text := 'ordinary-campaign';
  campaign_document constant text := 'ordinary-campaign-v1';
  campaign_sha text := encode(digest(convert_to(campaign_document, 'UTF8'), 'sha256'), 'hex');
  first_key constant uuid := '81000000-0000-4000-8000-000000000001';
  second_key constant uuid := '81000000-0000-4000-8000-000000000002';
  fresh_key constant uuid := '81000000-0000-4000-8000-000000000003';
  begun jsonb;
  replay jsonb;
  completed jsonb;
  acknowledged jsonb;
  run_id uuid;
  result_sha text;
begin
  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('1',64), 'deterministic', null, null, first_key, 'ordinary-request',
    1, campaign_sha
  );
  if begun->>'status' <> 'claimed' then
    raise exception 'ordinary run was not claimed: %', begun;
  end if;
  run_id := (begun->>'run_id')::uuid;

  replay := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('1',64), 'deterministic', null, null, second_key, 'ordinary-reload',
    1, campaign_sha
  );
  if replay->>'status' <> 'in_progress'
     or (replay->>'run_id')::uuid <> run_id
     or (select count(*) from public.sourcing_runs run
          where run.workspace_id = ordinary_result_behavior.workspace_id
            and run.actor_id = ordinary_result_behavior.actor_id
            and run.campaign_hmac = public.sourcing_authority_hmac(
              ordinary_result_behavior.workspace_id,
              'campaign:' || ordinary_result_behavior.campaign_id
            )) <> 1 then
    raise exception 'different-id in-progress replay duplicated authority: %', replay;
  end if;
  replay := public.resume_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, repeat('f',64), 1
  );
  if replay->>'status' <> 'pending_conflict' then
    raise exception 'campaign mismatch did not fail closed: %', replay;
  end if;
  replay := public.resume_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, campaign_sha, 2
  );
  if replay->>'status' <> 'in_progress' then
    raise exception 'new count hid the in-progress authority: %', replay;
  end if;

  completed := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":0,"skippedCount":0}]',
    sourcing_result_test.payload(
      campaign_id, campaign_document, first_key, run_id, 'ordinary-request'
    )
  );
  if completed->>'status' <> 'result_ready'
     or completed->>'result_sha256' !~ '^[0-9a-f]{64}$'
     or completed#>>'{result_payload,idempotencyKey}' <> first_key::text then
    raise exception 'result was not staged atomically: %', completed;
  end if;
  result_sha := completed->>'result_sha256';

  replay := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('1',64), 'deterministic', null, null, second_key, 'ordinary-reload',
    1, campaign_sha
  );
  if replay->>'status' <> 'result_ready'
     or replay->>'result_sha256' <> result_sha
     or (replay->>'requested_count')::integer <> 1
     or (replay->>'run_id')::uuid <> run_id then
    raise exception 'new-id reload did not recover staged result: %', replay;
  end if;
  replay := public.resume_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, campaign_sha, 2
  );
  if replay->>'status' <> 'result_ready'
     or (replay->>'requested_count')::integer <> 1
     or replay->>'result_sha256' <> result_sha then
    raise exception 'new count hid the staged result: %', replay;
  end if;
  replay := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":0,"skippedCount":0}]',
    sourcing_result_test.payload(
      campaign_id, campaign_document, first_key, run_id, 'ordinary-request'
    )
  );
  if replay->>'status' <> 'result_ready' or replay->>'result_sha256' <> result_sha then
    raise exception 'completion replay changed the staged result: %', replay;
  end if;

  if public.ack_ordinary_sourcing_result(
    workspace_id, other_actor_id, run_id, result_sha
  )->>'status' <> 'not_found' then
    raise exception 'cross-actor acknowledgement was admitted';
  end if;
  if public.ack_ordinary_sourcing_result(
    '72222222-2222-4222-8222-222222222222',
    'c2000000-0000-4000-8000-000000000001', run_id, result_sha
  )->>'status' <> 'not_found' then
    raise exception 'cross-workspace acknowledgement was admitted';
  end if;
  if public.ack_ordinary_sourcing_result(
    workspace_id, actor_id, run_id, repeat('0',64)
  )->>'status' <> 'not_found' then
    raise exception 'forged result hash was admitted';
  end if;
  if public.ack_ordinary_sourcing_result(
    workspace_id, actor_id, run_id, result_sha
  )->>'status' <> 'persistence_unverified' then
    raise exception 'zero-hit result acknowledged without its durable receipt marker';
  end if;
  update public.workspace_state
     set state = jsonb_set(
       state, '{activities}', jsonb_build_array(jsonb_build_object(
         'id', 'sourcing-run:' || run_id::text || ':' || result_sha
       )), true
     )
   where workspace_state.workspace_id = ordinary_result_behavior.workspace_id;

  acknowledged := public.ack_ordinary_sourcing_result(
    workspace_id, actor_id, run_id, result_sha
  );
  if acknowledged->>'status' <> 'completed'
     or exists (select 1 from public.sourcing_run_results
                 where sourcing_run_results.run_id = ordinary_result_behavior.run_id
                   and result_payload is not null) then
    raise exception 'acknowledgement did not scrub payload: %', acknowledged;
  end if;
  replay := public.ack_ordinary_sourcing_result(
    workspace_id, actor_id, run_id, result_sha
  );
  if replay <> acknowledged then
    raise exception 'lost acknowledgement response was not replay-safe: % <> %', replay, acknowledged;
  end if;

  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('1',64), 'deterministic', null, null, fresh_key, 'ordinary-fresh',
    1, campaign_sha
  );
  if begun->>'status' <> 'claimed' or (begun->>'run_id')::uuid = run_id then
    raise exception 'consumed run blocked a fresh sequential batch: %', begun;
  end if;
  perform public.fail_ordinary_sourcing_run(
    workspace_id, actor_id, (begun->>'run_id')::uuid, 'TEST_CLOSE'
  );
end;
$ordinary_result_behavior$;

do $forged_and_expiry$
<<forged_and_expiry>>
declare
  workspace_id constant uuid := '71111111-1111-4111-8111-111111111111';
  actor_id constant uuid := 'c1000000-0000-4000-8000-000000000001';
  campaign_document text;
  campaign_sha text;
  begun jsonb;
  outcome jsonb;
  payload jsonb;
  run_id uuid;
begin
  campaign_document := 'forged-campaign-v1';
  campaign_sha := encode(digest(convert_to(campaign_document, 'UTF8'), 'sha256'), 'hex');
  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, 'forged-campaign', sourcing_result_test.role_basis(),
    repeat('2',64), 'deterministic', null, null,
    '82000000-0000-4000-8000-000000000001', 'forged-request', 1, campaign_sha
  );
  run_id := (begun->>'run_id')::uuid;
  payload := sourcing_result_test.payload(
    'forged-campaign', campaign_document,
    '82000000-0000-4000-8000-000000000001', run_id, 'forged-request'
  ) || jsonb_build_object('untrustedSecret', 'must-not-stage');
  outcome := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":0,"skippedCount":0}]',
    payload
  );
  if outcome->>'status' <> 'result_invalid' then
    raise exception 'forged result shape was admitted: %', outcome;
  end if;
  payload := sourcing_result_test.payload(
    'forged-campaign', campaign_document,
    '82000000-0000-4000-8000-000000000001', run_id, 'forged-request',
    jsonb_build_array(
      sourcing_result_test.candidate('forged-campaign', 'oversize-candidate')
      || jsonb_build_object('recentActivity', repeat('x', 600000))
    )
  );
  outcome := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":1,"skippedCount":0}]',
    payload
  );
  if outcome->>'status' <> 'result_invalid'
     or (select status from public.sourcing_runs where id = run_id) <> 'in_progress' then
    raise exception 'oversize result mutated completion authority: %', outcome;
  end if;
  perform public.fail_ordinary_sourcing_run(workspace_id, actor_id, run_id, 'TEST_CLOSE');

  campaign_document := 'expiry-campaign-v1';
  campaign_sha := encode(digest(convert_to(campaign_document, 'UTF8'), 'sha256'), 'hex');
  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, 'expiry-campaign', sourcing_result_test.role_basis(),
    repeat('3',64), 'deterministic', null, null,
    '82000000-0000-4000-8000-000000000002', 'expiry-request', 1, campaign_sha
  );
  run_id := (begun->>'run_id')::uuid;
  outcome := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":0,"skippedCount":0}]',
    sourcing_result_test.payload(
      'expiry-campaign', campaign_document,
      '82000000-0000-4000-8000-000000000002', run_id, 'expiry-request'
    )
  );
  if outcome->>'status' <> 'result_ready' then raise exception 'expiry fixture failed'; end if;
  update public.sourcing_run_results set expires_at = now() - interval '1 second'
   where sourcing_run_results.run_id = forged_and_expiry.run_id;
  outcome := public.cleanup_ordinary_sourcing_results(workspace_id, 10);
  if outcome <> jsonb_build_object('status','cleaned','processed',1,'payloads_scrubbed',1)
     or not exists (
       select 1 from public.sourcing_run_results
        where sourcing_run_results.run_id = forged_and_expiry.run_id
          and status = 'expired' and result_payload is null
     ) then
    raise exception 'TTL cleanup was not bounded and truthful: %', outcome;
  end if;
end;
$forged_and_expiry$;

do $persistence_and_erasure$
<<persistence_and_erasure>>
declare
  workspace_id constant uuid := '71111111-1111-4111-8111-111111111111';
  actor_id constant uuid := 'c1000000-0000-4000-8000-000000000001';
  campaign_id constant text := 'erasure-campaign';
  campaign_document constant text := 'erasure-campaign-v1';
  candidate_id constant text := 'verified-candidate';
  campaign_sha text := encode(digest(convert_to(campaign_document, 'UTF8'), 'sha256'), 'hex');
  candidate jsonb := sourcing_result_test.candidate(campaign_id, candidate_id);
  staged_alias jsonb := sourcing_result_test.candidate(campaign_id, 'staged-candidate-alias');
  begun jsonb;
  outcome jsonb;
  hold_id uuid;
  run_id uuid;
  result_sha text;
begin
  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('4',64), 'deterministic', null, null,
    '83000000-0000-4000-8000-000000000001', 'erasure-request', 1, campaign_sha
  );
  run_id := (begun->>'run_id')::uuid;
  outcome := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":1,"skippedCount":0}]',
    sourcing_result_test.payload(
      campaign_id, campaign_document,
      '83000000-0000-4000-8000-000000000001', run_id, 'erasure-request',
      jsonb_build_array(staged_alias)
    )
  );
  if outcome->>'status' <> 'result_ready' then
    raise exception 'candidate result did not stage: %', outcome;
  end if;
  result_sha := outcome->>'result_sha256';
  if public.ack_ordinary_sourcing_result(
    workspace_id, actor_id, run_id, result_sha
  )->>'status' <> 'persistence_unverified' then
    raise exception 'acknowledgement trusted a missing exact receipt marker';
  end if;

  update public.workspace_state
     set state = jsonb_set(
       jsonb_set(state, '{candidates}', jsonb_build_array(candidate), true),
       '{activities}', coalesce(state->'activities', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object(
           'id', 'sourcing-run:' || run_id::text || ':' || result_sha
         )),
       true
     )
   where workspace_state.workspace_id = persistence_and_erasure.workspace_id;
  outcome := public.ack_ordinary_sourcing_result(
    workspace_id, actor_id, run_id, result_sha
  );
  if outcome->>'status' <> 'completed' then
    raise exception 'all-duplicate result did not acknowledge its exact durable marker: %', outcome;
  end if;

  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('4',64), 'deterministic', null, null,
    '83000000-0000-4000-8000-000000000004', 'erasure-stage', 1, campaign_sha
  );
  run_id := (begun->>'run_id')::uuid;
  outcome := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":1,"skippedCount":0}]',
    sourcing_result_test.payload(
      campaign_id, campaign_document,
      '83000000-0000-4000-8000-000000000004', run_id, 'erasure-stage',
      jsonb_build_array(staged_alias)
    )
  );
  if outcome->>'status' <> 'result_ready' then
    raise exception 'candidate erasure staging fixture failed: %', outcome;
  end if;
  outcome := public.place_candidate_legal_hold(
    workspace_id, actor_id, campaign_id, candidate_id,
    'LITIGATION', 'case-ordinary-result', null
  );
  if outcome->>'status' <> 'active' then
    raise exception 'candidate legal hold fixture failed: %', outcome;
  end if;
  hold_id := (outcome->>'hold_id')::uuid;
  outcome := public.request_candidate_erasure(
    workspace_id, actor_id, campaign_id, candidate_id,
    '83000000-0000-4000-8000-000000000002'
  );
  if outcome->>'status' <> 'blocked_legal_hold'
     or not exists (
       select 1 from public.sourcing_run_results
        where sourcing_run_results.run_id = persistence_and_erasure.run_id
          and status = 'ready' and result_payload is not null
     )
     or exists (
       select 1 from public.candidate_erasure_receipts receipt
        where receipt.workspace_id = persistence_and_erasure.workspace_id
          and receipt.store_name = 'ordinary_sourcing_results'
     ) then
    raise exception 'legal hold did not preserve the staged result: %', outcome;
  end if;
  outcome := public.release_candidate_legal_hold(
    workspace_id, actor_id, hold_id, 'case-ordinary-result-release'
  );
  if outcome->>'status' <> 'released' then
    raise exception 'candidate legal hold release failed: %', outcome;
  end if;
  outcome := public.request_candidate_erasure(
    workspace_id, actor_id, campaign_id, candidate_id,
    '83000000-0000-4000-8000-000000000002'
  );
  if outcome->>'status' not in ('pending_provider','manual_required','completed') then
    raise exception 'candidate erasure fixture failed: %', outcome;
  end if;
  if not exists (
    select 1 from public.sourcing_run_results
     where sourcing_run_results.run_id = persistence_and_erasure.run_id
       and status = 'expired' and result_payload is null
  ) or not exists (
    select 1 from public.candidate_erasure_receipts receipt
     where receipt.workspace_id = persistence_and_erasure.workspace_id
       and receipt.store_name = 'ordinary_sourcing_results'
       and receipt.scrubbed_rows = 1
  ) then
    raise exception 'candidate erasure did not scrub the staged result';
  end if;

  begun := public.begin_ordinary_sourcing_run(
    workspace_id, actor_id, campaign_id, sourcing_result_test.role_basis(),
    repeat('4',64), 'deterministic', null, null,
    '83000000-0000-4000-8000-000000000003', 'erasure-reimport', 1, campaign_sha
  );
  run_id := (begun->>'run_id')::uuid;
  outcome := public.complete_ordinary_sourcing_run(
    workspace_id, actor_id, run_id,
    '[{"platform":"GitHub","query":"language:Go type:user","ok":true,"candidateCount":1,"skippedCount":0}]',
    sourcing_result_test.payload(
      campaign_id, campaign_document,
      '83000000-0000-4000-8000-000000000003', run_id, 'erasure-reimport',
      jsonb_build_array(staged_alias)
    )
  );
  if outcome->>'status' <> 'result_invalid' then
    raise exception 'erased candidate was reimportable through staged results: %', outcome;
  end if;
  perform public.fail_ordinary_sourcing_run(workspace_id, actor_id, run_id, 'TEST_CLOSE');
end;
$persistence_and_erasure$;

-- Keep the first race contender open for the shell-level concurrency proof.
insert into sourcing_result_test.context(key, value) values (
  'race', jsonb_build_object(
    'workspaceId', '71111111-1111-4111-8111-111111111111',
    'actorId', 'c1000000-0000-4000-8000-000000000001',
    'campaignId', 'race-campaign',
    'campaignDocument', 'race-campaign-v1',
    'campaignSha', encode(digest(convert_to('race-campaign-v1', 'UTF8'), 'sha256'), 'hex')
  )
);
SQL

# Prove two different idempotency keys serialize on one actor and campaign.
mkfifo "$race_dir/leader.pipe"
exec 9<>"$race_dir/leader.pipe"
docker run --rm -i \
  --network "$network" \
  --env PGPASSWORD="$bootstrap_password" \
  --env PGAPPNAME="aria-ordinary-result-leader" \
  --entrypoint psql "$client_image" \
  -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres \
  < "$race_dir/leader.pipe" > "$race_dir/leader.log" 2>&1 &
leader_pid=$!

printf '%s\n' \
  'begin;' \
  "select sourcing_result_test.set_claims('service_role','c1000000-0000-4000-8000-000000000001');" \
  "select public.begin_ordinary_sourcing_run('71111111-1111-4111-8111-111111111111','c1000000-0000-4000-8000-000000000001','race-campaign',sourcing_result_test.role_basis(),repeat('5',64),'deterministic',null,null,'84000000-0000-4000-8000-000000000001','race-leader',1,encode(digest(convert_to('race-campaign-v1','UTF8'),'sha256'),'hex'))->>'status';" \
  >&9

deadline=$((SECONDS + 30))
while [[ "$(psql_stdin -Atqc "select coalesce((select state from pg_stat_activity where application_name='aria-ordinary-result-leader'),'missing')")" != "idle in transaction" ]]; do
  if ! kill -0 "$leader_pid" >/dev/null 2>&1; then
    cat "$race_dir/leader.log" >&2
    echo "leader exited before holding its claim" >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    cat "$race_dir/leader.log" >&2
    echo "timed out waiting for leader claim" >&2
    exit 1
  fi
done

psql_stdin -q > "$race_dir/contender.log" 2>&1 <<'SQL' &
set application_name = 'aria-ordinary-result-contender';
select sourcing_result_test.set_claims(
  'service_role', 'c1000000-0000-4000-8000-000000000001'
);
select public.begin_ordinary_sourcing_run(
  '71111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'race-campaign', sourcing_result_test.role_basis(), repeat('5',64),
  'deterministic', null, null,
  '84000000-0000-4000-8000-000000000002', 'race-contender', 1,
  encode(digest(convert_to('race-campaign-v1','UTF8'),'sha256'),'hex')
)->>'status';
SQL
contender_pid=$!

deadline=$((SECONDS + 30))
while kill -0 "$contender_pid" >/dev/null 2>&1; do
  wait_event="$(psql_stdin -Atqc "select coalesce(wait_event_type,'') || ':' || coalesce(wait_event,'') from pg_stat_activity where application_name='aria-ordinary-result-contender'")"
  if [[ "$wait_event" == "Lock:advisory" ]]; then break; fi
  if (( SECONDS >= deadline )); then
    cat "$race_dir/contender.log" >&2
    echo "contender did not serialize on the campaign claim" >&2
    exit 1
  fi
done

printf '%s\n' 'commit;' '\q' >&9
exec 9>&-
wait "$leader_pid"
wait "$contender_pid"

grep -q 'claimed' "$race_dir/leader.log"
grep -q 'in_progress' "$race_dir/contender.log"

race_run_count="$(psql_stdin -Atqc "select count(*) from public.sourcing_runs where workspace_id='71111111-1111-4111-8111-111111111111' and campaign_hmac=public.sourcing_authority_hmac('71111111-1111-4111-8111-111111111111','campaign:race-campaign')")"
if [[ "$race_run_count" != "1" ]]; then
  echo "concurrent different-id claims created $race_run_count sourcing runs" >&2
  exit 1
fi

# Forced RLS and function grants must keep both browser and service principals
# out of direct table DML while preserving the service RPC path.
set +e
acl_output="$(psql_stdin -qAt 2>&1 <<'SQL'
select sourcing_result_test.set_claims(
  'authenticated', 'c1000000-0000-4000-8000-000000000001'
);
set role authenticated;
select count(*) from public.sourcing_run_results;
SQL
)"
acl_status=$?
set -e
if [[ "$acl_status" -eq 0 || "$acl_output" != *"permission denied for table sourcing_run_results"* ]]; then
  echo "authenticated direct table access was not denied" >&2
  echo "$acl_output" >&2
  exit 1
fi

set +e
rpc_output="$(psql_stdin -qAt 2>&1 <<'SQL'
select sourcing_result_test.set_claims(
  'authenticated', 'c1000000-0000-4000-8000-000000000001'
);
set role authenticated;
select public.resume_ordinary_sourcing_run(
  '71111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'race-campaign', repeat('0',64), 1
);
SQL
)"
rpc_status=$?
set -e
if [[ "$rpc_status" -eq 0 || "$rpc_output" != *"permission denied for function resume_ordinary_sourcing_run"* ]]; then
  echo "authenticated ordinary-result RPC access was not denied" >&2
  echo "$rpc_output" >&2
  exit 1
fi

# A ledger reconciliation retry must be safe and preserve all staged receipts.
before_reapply="$(psql_stdin -Atqc 'select count(*) from public.sourcing_run_results')"
before_receipt_constraint="$(psql_stdin -Atqc "
  select pg_get_constraintdef(oid, true)
    from pg_constraint
   where conrelid = 'public.candidate_erasure_receipts'::regclass
     and conname = 'candidate_erasure_receipts_store_name_check'
")"
if [[ -z "$before_receipt_constraint" \
   || "$before_receipt_constraint" != *"ordinary_sourcing_results"* \
   || "$before_receipt_constraint" != *"agent_memories"* \
   || "$before_receipt_constraint" != *"candidate_payload_provenance"* ]]; then
  echo "0059 receipt allowlist was not present before 0058 replay" >&2
  exit 1
fi
psql_stdin --single-transaction -q < supabase/migrations/0058_ordinary_sourcing_result_durability.sql
after_reapply="$(psql_stdin -Atqc 'select count(*) from public.sourcing_run_results')"
if [[ "$before_reapply" != "$after_reapply" ]]; then
  echo "0058 reapply changed durable result row count" >&2
  exit 1
fi
after_receipt_constraint="$(psql_stdin -Atqc "
  select pg_get_constraintdef(oid, true)
    from pg_constraint
   where conrelid = 'public.candidate_erasure_receipts'::regclass
     and conname = 'candidate_erasure_receipts_store_name_check'
")"
if [[ "$after_receipt_constraint" != "$before_receipt_constraint" ]]; then
  echo "0058 replay changed the exact 0059 receipt allowlist" >&2
  exit 1
fi

set +e
rollback_output="$(psql_stdin -qAt 2>&1 < supabase/rollbacks/0058_ordinary_sourcing_result_durability.sql)"
rollback_status=$?
set -e
if [[ "$rollback_status" -eq 0 || "$rollback_output" != *"refusing 0058 rollback because ordinary sourcing result evidence exists"* ]]; then
  echo "0058 rollback did not refuse issued result evidence" >&2
  echo "$rollback_output" >&2
  exit 1
fi
after_refusal="$(psql_stdin -Atqc 'select count(*) from public.sourcing_run_results')"
if [[ "$after_refusal" != "$after_reapply" ]]; then
  echo "0058 rollback refusal changed durable result evidence" >&2
  exit 1
fi

# Apply the remaining authority migrations only after the complete historical
# 0058/0059 rollback and replay surface is frozen.
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if (( 10#${base%%_*} <= 63 )); then
    continue
  fi
  psql_stdin --single-transaction -q < "$migration"
done

echo "RESULT sourcing-result-durability-db: behavior=pass concurrency=pass acl=pass rollback=guarded reapply=pass rows=$after_reapply"
