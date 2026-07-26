#!/usr/bin/env bash
set -Eeuo pipefail

# Candidate-list evidence bridge contract.
#
# This is a disposable PostgreSQL 17 integration harness. It performs no
# provider network calls and reads no provider credentials. The fixture writes
# internally consistent completed GitHub and Tavily authority rows directly,
# then proves that candidate-list admission consumes only those durable rows.
# It covers:
#   * atomic preflight of legacy campaign ids before 0065 changes any object;
#   * empty rollback, retry, reapply, and preservation of compatible 0064 data;
#   * exact erasure-compatible campaign grammar;
#   * canonical workspace-state reachability without the best-effort mirror;
#   * completed GitHub and Tavily receipts, Tavily expiry, and ambiguity;
#   * governed manual verify/revoke/supersede/idempotency;
#   * private ACLs, forced RLS, append-only evidence and immutable snapshots;
#   * governed erasure of members, the full manual chain, and every
#     candidate-linkable add/attest receipt;
#   * deterministic add/attest versus erasure lock ordering; and
#   * non-empty rollback refusal without partial mutation.
#
# Set operations, eligibility scoring, quota, CSV export, API/UI, provider
# egress, and bulk performance remain outside this bounded database slice.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-candidate-list-evidence-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
tmp_dir="$(mktemp -d)"
export DB_HOST_PORT=0

cleanup() {
  exec 9>&- 2>/dev/null || true
  for background_pid in \
    "${holder_pid:-}" "${race_pid_1:-}" "${race_pid_2:-}"; do
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
    --env "PGAPPNAME=${PGAPPNAME:-candidate-list-evidence}" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "${ARIA_DB_TEST_ROLE:-postgres}" -d postgres "$@"
}

source tests/db/install-gotrue-test-authority.sh
aria_install_gotrue_test_authority

# Apply the verified historical foundation only through 0064. Migration 0065
# is applied explicitly below so its failed preflight can be inspected.
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base="$(basename "$migration")"
  if [[ "$base" > "0064_zzzzzzzz.sql" ]]; then
    break
  fi
  psql_stdin -q < "$migration"
done

psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

foundation_present="$(psql_stdin -Atq -c "select (
  to_regclass('public.candidate_lists') is not null
  and to_regprocedure('public.add_candidate_list_member(uuid,text,text,uuid)') is not null
)::text")"
if [[ "$foundation_present" != "true" ]]; then
  echo "candidate-list-evidence-db: the verified 0064 candidate-list foundation is missing" >&2
  exit 1
fi

migration="$(ls supabase/migrations/0065_*.sql 2>/dev/null | head -n1 || true)"
rollback="$(ls supabase/rollbacks/0065_*.sql 2>/dev/null | head -n1 || true)"
if [[ -z "$migration" ]]; then
  rpc_missing="$(psql_stdin -Atq -c "select (
    to_regprocedure(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'
    ) is null
  )::text")"
  if [[ "$rpc_missing" != "true" ]]; then
    echo "candidate-list-evidence-db: governed manual RPC exists without a 0065 migration" >&2
    exit 1
  fi
  echo "candidate-list-evidence-db RED: supabase/migrations/0065_*.sql and the governed manual provenance RPC are absent" >&2
  exit 1
fi
if [[ -z "$rollback" ]]; then
  echo "candidate-list-evidence-db: found $migration but no matching 0065 rollback" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# A legacy 0064 row whose campaign id cannot be targeted by governed erasure
# must abort 0065 before any schema, function, trigger, or row is changed.
# ---------------------------------------------------------------------------
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','evidence-preflight@example.test','',now(),
  '{}','{}',now(),now()
);
insert into public.workspaces(id,name,allowed_domain) values
  ('a1111111-1111-4111-8111-111111111111','Evidence preflight','evidence-preflight.example.test');
insert into public.profiles(id,email,full_name,workspace_id,role) values
  ('a1000000-0000-4000-8000-000000000001','evidence-preflight@example.test',
   'Evidence Preflight','a1111111-1111-4111-8111-111111111111','admin');
insert into public.candidates(
  workspace_id,campaign_id,id,name,provenance,payload
) values (
  'a1111111-1111-4111-8111-111111111111','invalid campaign id',
  'legacy-invalid','Legacy invalid','manual','{}'
);
insert into public.candidate_lists(
  id,workspace_id,name,created_by
) values (
  'a1222222-2222-4222-8222-222222222222',
  'a1111111-1111-4111-8111-111111111111',
  'Invalid legacy list','a1000000-0000-4000-8000-000000000001'
);
insert into public.candidate_contact_attestations(
  workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
  evidence_sha256,recorded_by,recorded_at
) values (
  'a1111111-1111-4111-8111-111111111111','invalid campaign id',
  'legacy-invalid','manual_provenance','operator_verified',repeat('a',64),
  'a1000000-0000-4000-8000-000000000001','2026-07-25 10:00:00+00'
);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_sha256,evidence_recorded_at,added_by
) select
  'a1111111-1111-4111-8111-111111111111',
  'a1222222-2222-4222-8222-222222222222',
  'invalid campaign id','legacy-invalid','manual_attestation',
  attestation.id,attestation.evidence_sha256,attestation.recorded_at,
  'a1000000-0000-4000-8000-000000000001'
from public.candidate_contact_attestations attestation
where attestation.workspace_id = 'a1111111-1111-4111-8111-111111111111';
SQL

run_behavior_tests() {
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create function candidate_list_evidence_test.canonical_observed_at(
  p_workspace_id uuid,
  p_campaign_id text,
  p_candidate_id text
) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select (candidate.value ->> 'lawfulBasisRecordedAt')::timestamptz
    from public.workspace_state workspace
    cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
      candidate(value)
   where workspace.workspace_id = p_workspace_id
     and candidate.value ->> 'campaignId' = p_campaign_id
     and candidate.value ->> 'id' = p_candidate_id
   limit 1;
$$;

grant execute on function
  candidate_list_evidence_test.canonical_observed_at(uuid,text,text)
  to anon, authenticated, service_role;

select candidate_list_evidence_test.expect(
  'given_no_candidate_list_mutation_has_run_when_invalid_paths_begin_then_workspaces_a_and_c_have_no_sourcing_hmac_secret',
  not exists (
    select 1 from public.sourcing_learning_secrets
     where workspace_id in (
       'c1111111-1111-4111-8111-111111111111',
       'c3333333-3333-4333-8333-333333333333'
     )
  )
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c3000000-0000-4000-8000-000000000001','authenticated'
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_an_erasure_incompatible_campaign_when_add_is_called_then_22023_is_raised_before_artifacts',
  $$select public.add_candidate_list_member(
      'e3333333-3333-4333-8333-333333333333',
      'invalid campaign id','manual-invalid-shape',
      '01000000-0000-4000-8000-000000000001'
    )$$,
  array['22023']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_an_erasure_incompatible_campaign_when_manual_attest_is_called_then_22023_is_raised_before_artifacts',
  format(
    'select public.attest_candidate_manual_provenance(%L,%L,%L,%L,%s,%L)',
    'invalid campaign id','manual-invalid-shape','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-invalid-shape'
    ),
    'null','02000000-0000-4000-8000-000000000001'
  ),
  array['22023']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_an_unknown_manual_decision_when_attest_is_called_then_22023_is_raised',
  format(
    'select public.attest_candidate_manual_provenance(%L,%L,%L,%L,%s,%L)',
    'manual-campaign','manual-invalid-shape','approve',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-invalid-shape'
    ),
    'null','02000000-0000-4000-8000-000000000002'
  ),
  array['22023']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_null_manual_decision_when_attest_is_called_then_22023_is_raised',
  format(
    'select public.attest_candidate_manual_provenance(%L,%L,null,%L,%s,%L)',
    'manual-campaign','manual-invalid-shape',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-invalid-shape'
    ),
    'null','02000000-0000-4000-8000-000000000003'
  ),
  array['22023']
);
commit;

select candidate_list_evidence_test.expect(
  'given_invalid_campaign_and_decision_requests_when_checked_then_no_secret_receipt_attestation_or_member_was_created',
  not exists (
    select 1 from public.sourcing_learning_secrets
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key in (
       '01000000-0000-4000-8000-000000000001',
       '02000000-0000-4000-8000-000000000001',
       '02000000-0000-4000-8000-000000000002',
       '02000000-0000-4000-8000-000000000003'
     )
  )
  and not exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c3000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values
  ('manual-missing-provenance',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-missing-provenance','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-missing-provenance'
    ),
    null,'02100000-0000-4000-8000-000000000001'
  )),
  ('manual-missing-platform',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-missing-platform','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-missing-platform'
    ),
    null,'02100000-0000-4000-8000-000000000002'
  )),
  ('manual-missing-basis',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-missing-basis','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-missing-basis'
    ),
    null,'02100000-0000-4000-8000-000000000003'
  )),
  ('manual-missing-basis-source',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-missing-basis-source','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c3333333-3333-4333-8333-333333333333',
      'manual-campaign','manual-missing-basis-source'
    ),
    null,'02100000-0000-4000-8000-000000000004'
  ));
commit;

select candidate_list_evidence_test.expect(
  'given_manual_canonical_provenance_is_omitted_when_attest_is_called_then_provenance_is_missing_without_artifacts',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-missing-provenance')
  and not exists (
    select 1 from public.candidate_contact_attestations
     where candidate_id = 'manual-missing-provenance'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '02100000-0000-4000-8000-000000000001'
  )
);
select candidate_list_evidence_test.expect(
  'given_manual_canonical_source_platform_is_omitted_when_attest_is_called_then_provenance_is_missing_without_artifacts',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-missing-platform')
  and not exists (
    select 1 from public.candidate_contact_attestations
     where candidate_id = 'manual-missing-platform'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '02100000-0000-4000-8000-000000000002'
  )
);
select candidate_list_evidence_test.expect(
  'given_manual_canonical_lawful_basis_is_omitted_when_attest_is_called_then_provenance_is_missing_without_artifacts',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-missing-basis')
  and not exists (
    select 1 from public.candidate_contact_attestations
     where candidate_id = 'manual-missing-basis'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '02100000-0000-4000-8000-000000000003'
  )
);
select candidate_list_evidence_test.expect(
  'given_manual_canonical_lawful_basis_source_is_omitted_when_attest_is_called_then_provenance_is_missing_without_artifacts',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-missing-basis-source')
  and not exists (
    select 1 from public.candidate_contact_attestations
     where candidate_id = 'manual-missing-basis-source'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '02100000-0000-4000-8000-000000000004'
  )
  and not exists (
    select 1 from public.sourcing_learning_secrets
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
);

-- Canonical reachability is checked before secret creation or receipt/HMAC
-- materialization. The provider evidence is valid, but its candidate is absent
-- from workspace_state and therefore governed erasure cannot reach it.
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'provider-missing-canonical',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'github-55555555555555555555555555555555',
  '03000000-0000-4000-8000-000000000001'
);
commit;

select candidate_list_evidence_test.expect(
  'given_completed_provider_evidence_without_a_canonical_candidate_when_add_is_called_then_not_found_creates_no_artifact',
  (select output = '{"status":"candidate_not_found"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'provider-missing-canonical')
  and not exists (
    select 1 from public.sourcing_learning_secrets
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '03000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.candidate_list_members
     where candidate_id = 'github-55555555555555555555555555555555'
  )
);

-- Create the short-lived Tavily row immediately before admission. Its first
-- snapshot must remain durable after the exact source expires, while a new
-- list admission must fail closed without a failure receipt.
insert into public.autonomous_web_candidate_evidence(
  workspace_id,campaign_id,candidate_id,egress_attempt_id,provider,
  provider_external_id,linkedin_url,canonical_query_sha256,
  raw_response_sha256,provider_result_sha256,normalized_payload_sha256,
  role_evidence,recorded_at,expires_at
) values (
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'linkedin-22222222222222222222222222222222',
  'f3100000-0000-4000-8000-000000000001','tavily',repeat('2',64),
  'https://www.linkedin.com/in/evidence-short',repeat('e',64),repeat('4',64),
  repeat('5',64),repeat('6',64),'{"source":"synthetic"}',
  clock_timestamp() - interval '1 minute',clock_timestamp() + interval '5 seconds'
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'tavily-short-live',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'linkedin-22222222222222222222222222222222',
  '03000000-0000-4000-8000-000000000008'
);
commit;

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values
  ('github-good',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'github-11111111111111111111111111111111',
    '03000000-0000-4000-8000-000000000002'
  )),
  ('github-no-receipt',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'github-33333333333333333333333333333333',
    '03000000-0000-4000-8000-000000000003'
  )),
  ('github-begun',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'github-44444444444444444444444444444444',
    '03000000-0000-4000-8000-000000000004'
  )),
  ('github-mismatch',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'github-77777777777777777777777777777777',
    '03000000-0000-4000-8000-000000000005'
  )),
  ('github-duplicate-canonical',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'github-66666666666666666666666666666666',
    '03000000-0000-4000-8000-000000000006'
  )),
  ('tavily-good',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'linkedin-11111111111111111111111111111111',
    '03000000-0000-4000-8000-000000000007'
  )),
  ('tavily-expired',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'linkedin-33333333333333333333333333333333',
    '03000000-0000-4000-8000-000000000009'
  )),
  ('tavily-no-receipt',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd1000000-0000-4000-8000-000000000001',
    'linkedin-44444444444444444444444444444444',
    '03000000-0000-4000-8000-000000000010'
  ));
commit;

select candidate_list_evidence_test.expect(
  'given_exact_completed_github_evidence_and_no_mirror_when_add_is_called_then_the_exact_durable_snapshot_is_added',
  (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'github-good')
  and not exists (
    select 1 from public.candidates
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'd1000000-0000-4000-8000-000000000001'
       and id = 'github-11111111111111111111111111111111'
  )
  and exists (
    select 1 from public.candidate_list_members member
     where member.list_id = 'e1111111-1111-4111-8111-111111111111'
       and member.candidate_id = 'github-11111111111111111111111111111111'
       and member.evidence_kind = 'github_provider'
       and member.evidence_attestation_id is null
       and member.evidence_provider_attempt_id =
         'f1100000-0000-4000-8000-000000000001'
       and member.evidence_sha256 = repeat('2',64)
       and member.evidence_expires_at is null
  )
);

select candidate_list_evidence_test.expect(
  'given_exact_completed_unexpired_tavily_evidence_and_no_mirror_when_add_is_called_then_expiry_is_snapshotted',
  (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'tavily-good')
  and not exists (
    select 1 from public.candidates
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'd1000000-0000-4000-8000-000000000001'
       and id = 'linkedin-11111111111111111111111111111111'
  )
  and exists (
    select 1
      from public.candidate_list_members member
      join public.autonomous_web_candidate_evidence evidence
        on evidence.workspace_id = member.workspace_id
       and evidence.campaign_id::text = member.campaign_id
       and evidence.candidate_id = member.candidate_id
     where member.list_id = 'e1111111-1111-4111-8111-111111111111'
       and member.candidate_id = 'linkedin-11111111111111111111111111111111'
       and member.evidence_kind = 'tavily_provider'
       and member.evidence_attestation_id is null
       and member.evidence_provider_attempt_id = evidence.egress_attempt_id
       and member.evidence_sha256 = evidence.normalized_payload_sha256
       and member.evidence_recorded_at = evidence.recorded_at
       and member.evidence_expires_at = evidence.expires_at
  )
);

select candidate_list_evidence_test.expect(
  'given_short_lived_tavily_evidence_when_admitted_before_expiry_then_the_exact_expiry_is_snapshotted',
  (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'tavily-short-live')
  and exists (
    select 1
      from public.candidate_list_members member
      join public.autonomous_web_candidate_evidence evidence
        on evidence.workspace_id = member.workspace_id
       and evidence.campaign_id::text = member.campaign_id
       and evidence.candidate_id = member.candidate_id
       and evidence.egress_attempt_id = member.evidence_provider_attempt_id
     where member.list_id = 'e1111111-1111-4111-8111-111111111111'
       and member.candidate_id = 'linkedin-22222222222222222222222222222222'
       and member.evidence_kind = 'tavily_provider'
       and member.evidence_expires_at = evidence.expires_at
  )
);

select candidate_list_evidence_test.expect(
  'given_incomplete_mismatched_expired_or_ambiguous_provider_authority_when_add_is_called_then_each_path_fails_closed_without_member_or_receipt',
  (select output->>'status' = 'provenance_missing'
     from candidate_list_evidence_test.outputs where case_name = 'github-no-receipt')
  and (select output->>'status' = 'provenance_missing'
     from candidate_list_evidence_test.outputs where case_name = 'github-begun')
  and (select output->>'status' = 'provenance_missing'
     from candidate_list_evidence_test.outputs where case_name = 'github-mismatch')
  and (select output->>'status' = 'provenance_ambiguous'
     from candidate_list_evidence_test.outputs where case_name = 'github-duplicate-canonical')
  and (select output->>'status' = 'provenance_expired'
     from candidate_list_evidence_test.outputs where case_name = 'tavily-expired')
  and (select output->>'status' = 'provenance_missing'
     from candidate_list_evidence_test.outputs where case_name = 'tavily-no-receipt')
  and not exists (
    select 1 from public.candidate_list_members
     where candidate_id in (
       'github-33333333333333333333333333333333',
       'github-44444444444444444444444444444444',
       'github-77777777777777777777777777777777',
       'github-66666666666666666666666666666666',
       'linkedin-33333333333333333333333333333333',
       'linkedin-44444444444444444444444444444444'
     )
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key between
       '03000000-0000-4000-8000-000000000003'
       and '03000000-0000-4000-8000-000000000006'
        or idempotency_key in (
          '03000000-0000-4000-8000-000000000009',
          '03000000-0000-4000-8000-000000000010'
        )
  )
);

select pg_sleep(5.1);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'tavily-after-expiry',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111112',
  'd1000000-0000-4000-8000-000000000001',
  'linkedin-22222222222222222222222222222222',
  '03000000-0000-4000-8000-000000000011'
);
commit;

select candidate_list_evidence_test.expect(
  'given_a_tavily_snapshot_exists_when_the_source_expires_then_the_old_snapshot_remains_but_new_admission_is_expired_without_a_receipt',
  (select output = '{"status":"provenance_expired"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'tavily-after-expiry')
  and exists (
    select 1 from public.candidate_list_members
     where list_id = 'e1111111-1111-4111-8111-111111111111'
       and candidate_id = 'linkedin-22222222222222222222222222222222'
  )
  and not exists (
    select 1 from public.candidate_list_members
     where list_id = 'e1111111-1111-4111-8111-111111111112'
       and candidate_id = 'linkedin-22222222222222222222222222222222'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '03000000-0000-4000-8000-000000000011'
  )
);

-- ---------------------------------------------------------------------------
-- Governed manual lifecycle. Public decisions are verify/revoke; stored
-- values remain operator_verified/operator_revoked. Every child names the
-- exact current predecessor, and idempotency replay returns the original
-- result byte-for-byte.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-root',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    null,'04000000-0000-4000-8000-000000000001'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-replay',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    null,'04000000-0000-4000-8000-000000000001'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-idempotency-conflict',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','revoke',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-consent-root'),
    '04000000-0000-4000-8000-000000000001'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-root-revoke',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','revoke',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    null,'04000000-0000-4000-8000-000000000002'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-same-time-child',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-consent-root'),
    '04000000-0000-4000-8000-000000000003'
  )
);
commit;

begin;
set local role authenticated;
set local time zone 'Pacific/Honolulu';
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-timezone-replay',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    null,'04000000-0000-4000-8000-000000000001'
  )
);
commit;

select candidate_list_evidence_test.expect(
  'given_an_exact_manual_request_is_replayed_after_the_session_time_zone_changes_then_the_original_result_is_returned_without_conflict_or_duplicate_receipt',
  (select original.output = replay.output
     from candidate_list_evidence_test.outputs original
     join candidate_list_evidence_test.outputs replay on true
    where original.case_name = 'manual-consent-root'
      and replay.case_name = 'manual-consent-timezone-replay')
  and (select count(*) = 1
         from public.candidate_list_operation_receipts
        where workspace_id = 'c1111111-1111-4111-8111-111111111111'
          and operation_kind = 'attest_manual'
          and idempotency_key = '04000000-0000-4000-8000-000000000001')
);

-- A child verification must use a canonical observation strictly newer than
-- the current governed leaf. Advance only this synthetic canonical candidate,
-- preserving array order and the exact JavaScript timestamp grammar.
update public.workspace_state workspace
   set state = jsonb_set(
     workspace.state,
     '{candidates}',
     (
       select jsonb_agg(
         case
           when candidate.value ->> 'campaignId' = 'manual-campaign'
            and candidate.value ->> 'id' = 'manual-consent'
           then candidate.value || jsonb_build_object(
             'lawfulBasisRecordedAt',
             to_char(
               (
                 (candidate.value ->> 'lawfulBasisRecordedAt')::timestamptz
                   + interval '1 second'
               ) at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )
           else candidate.value
         end
         order by candidate.ordinality
       )
         from jsonb_array_elements(workspace.state -> 'candidates')
           with ordinality candidate(value, ordinality)
     )
   )
 where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111';

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-child',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-consent-root'),
    '04100000-0000-4000-8000-000000000001'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-stale-fork',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-consent-root'),
    '04000000-0000-4000-8000-000000000004'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-add',
  public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'manual-campaign','manual-consent',
    '04000000-0000-4000-8000-000000000005'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-revoke',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','revoke',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-consent-child'),
    '04000000-0000-4000-8000-000000000006'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-after-revoke',
  public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111112',
    'manual-campaign','manual-consent',
    '04000000-0000-4000-8000-000000000007'
  )
);
commit;

-- Revocation is not terminal: an exact-current child may re-verify only after
-- the canonical observation advances again.
update public.workspace_state workspace
   set state = jsonb_set(
     workspace.state,
     '{candidates}',
     (
       select jsonb_agg(
         case
           when candidate.value ->> 'campaignId' = 'manual-campaign'
            and candidate.value ->> 'id' = 'manual-consent'
           then candidate.value || jsonb_build_object(
             'lawfulBasisRecordedAt',
             to_char(
               (
                 (candidate.value ->> 'lawfulBasisRecordedAt')::timestamptz
                   + interval '1 second'
               ) at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )
           else candidate.value
         end
         order by candidate.ordinality
       )
         from jsonb_array_elements(workspace.state -> 'candidates')
           with ordinality candidate(value, ordinality)
     )
   )
 where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111';

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-reverify-after-revoke',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-consent','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-consent'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-consent-revoke'),
    '04100000-0000-4000-8000-000000000002'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-consent-add-after-reverify',
  public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111112',
    'manual-campaign','manual-consent',
    '04100000-0000-4000-8000-000000000003'
  )
);
commit;

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000002','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'manual-li-member-root',
  public.attest_candidate_manual_provenance(
    'manual-campaign','manual-li','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-li'
    ),
    null,'04000000-0000-4000-8000-000000000008'
  )
);
commit;

select candidate_list_evidence_test.expect(
  'given_manual_verify_replay_supersede_and_revoke_when_lifecycle_is_read_then_the_chain_and_results_are_exact',
  (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-root')
  and (select original.output = replay.output
         from candidate_list_evidence_test.outputs original
         join candidate_list_evidence_test.outputs replay on true
        where original.case_name = 'manual-consent-root'
          and replay.case_name = 'manual-consent-replay')
  and (select output = '{"status":"idempotency_conflict"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-consent-idempotency-conflict')
  and (select output = '{"status":"predecessor_conflict"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-root-revoke')
  and (select output = '{"status":"predecessor_conflict"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-consent-same-time-child')
  and (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-child')
  and (select output = '{"status":"predecessor_conflict"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-stale-fork')
  and (select output->>'status' = 'revoked'
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-revoke')
  and (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-consent-reverify-after-revoke')
  and (select count(*) = 4
         from public.candidate_contact_attestations
        where workspace_id = 'c1111111-1111-4111-8111-111111111111'
          and campaign_id = 'manual-campaign'
          and candidate_id = 'manual-consent'
          and authority_version = 'governed-v1')
  and not exists (
    select 1
      from public.candidate_contact_attestations child
      join public.candidate_contact_attestations parent
        on parent.id = child.supersedes_id
     where child.workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and child.campaign_id = 'manual-campaign'
       and child.candidate_id = 'manual-consent'
       and (
         child.workspace_id <> parent.workspace_id
         or child.campaign_id <> parent.campaign_id
         or child.candidate_id <> parent.candidate_id
       )
  )
  and exists (
    select 1
      from public.candidate_contact_attestations root
      join public.candidate_contact_attestations child
        on child.supersedes_id = root.id
      join public.candidate_contact_attestations revoked
        on revoked.supersedes_id = child.id
      join public.candidate_contact_attestations reverified
        on reverified.supersedes_id = revoked.id
     where root.workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and root.campaign_id = 'manual-campaign'
       and root.candidate_id = 'manual-consent'
       and root.value_code = 'operator_verified'
       and child.value_code = 'operator_verified'
       and child.observed_at > root.observed_at
       and revoked.value_code = 'operator_revoked'
       and reverified.value_code = 'operator_verified'
       and reverified.observed_at > revoked.observed_at
  ),
  (
    select jsonb_build_object(
      'outputs',jsonb_object_agg(output_row.case_name,output_row.output),
      'rows',(
        select coalesce(
          jsonb_agg(to_jsonb(attestation) order by attestation.id),
          '[]'::jsonb
        )
          from public.candidate_contact_attestations attestation
         where attestation.workspace_id =
                 'c1111111-1111-4111-8111-111111111111'
           and attestation.campaign_id = 'manual-campaign'
           and attestation.candidate_id = 'manual-consent'
      )
    )::text
      from candidate_list_evidence_test.outputs output_row
     where output_row.case_name like 'manual-consent-%'
  )
);

select candidate_list_evidence_test.expect(
  'given_governed_manual_rows_when_lawful_basis_and_snapshot_are_read_then_consent_and_legitimate_interest_are_exact',
  exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-campaign'
       and candidate_id = 'manual-consent'
       and authority_version = 'governed-v1'
       and lawful_basis_code = 'consent'
       and observed_at = candidate_list_evidence_test.canonical_observed_at(
         workspace_id,campaign_id,candidate_id
       )
  )
  and exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-campaign'
       and candidate_id = 'manual-li'
       and authority_version = 'governed-v1'
       and lawful_basis_code = 'legitimate_interest'
       and recorded_by = 'c1000000-0000-4000-8000-000000000002'
  ),
  (
    select coalesce(
      jsonb_agg(to_jsonb(attestation) order by attestation.id),
      '[]'::jsonb
    )::text
      from public.candidate_contact_attestations attestation
     where attestation.workspace_id =
             'c1111111-1111-4111-8111-111111111111'
       and attestation.campaign_id = 'manual-campaign'
       and attestation.candidate_id in ('manual-consent','manual-li')
  )
);

-- Owner-level inserts cannot bypass the governed chain grammar enforced by
-- the lifecycle trigger. These are intentionally below the public RPC.
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_revocation_without_a_predecessor_when_owner_inserts_then_23514_rejects_the_root',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     ) values (
       'c1111111-1111-4111-8111-111111111111','manual-campaign',
       'manual-race-attest','manual_provenance','operator_revoked',repeat('1',64),
       'c1000000-0000-4000-8000-000000000001','governed-v1','consent',
       clock_timestamp(),null
     )$$,
  array['23514']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_child_points_to_legacy_when_owner_inserts_then_23514_rejects_the_predecessor',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     )
     select workspace_id,campaign_id,candidate_id,'manual_provenance',
       'operator_verified',repeat('2',64),recorded_by,'governed-v1','consent',
       clock_timestamp(),id
       from public.candidate_contact_attestations
      where workspace_id = 'b1111111-1111-4111-8111-111111111111'
        and campaign_id = 'legacy-campaign' and candidate_id = 'legacy-valid'
        and authority_version = 'legacy-v1'$$,
  array['23514']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_child_points_to_a_noncurrent_leaf_when_owner_inserts_then_23514_rejects_the_fork',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     ) values (
       'c1111111-1111-4111-8111-111111111111','manual-campaign',
       'manual-consent','manual_provenance','operator_verified',repeat('3',64),
       'c1000000-0000-4000-8000-000000000001','governed-v1','consent',
       clock_timestamp(),
       (select (output ->> 'attestation_id')::bigint
          from candidate_list_evidence_test.outputs
         where case_name = 'manual-consent-root')
     )$$,
  array['23514']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_reverification_is_not_newer_when_owner_inserts_then_23514_rejects_the_stale_observation',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     )
     select workspace_id,campaign_id,candidate_id,'manual_provenance',
       'operator_verified',repeat('4',64),recorded_by,'governed-v1',
       lawful_basis_code,observed_at,id
       from public.candidate_contact_attestations
      where workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and campaign_id = 'manual-campaign' and candidate_id = 'manual-li'
        and authority_version = 'governed-v1'$$,
  array['23514']
);

select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_revocation_changes_the_verified_lawful_basis_when_owner_inserts_then_23514_rejects_the_context_rewrite',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     )
     select workspace_id,campaign_id,candidate_id,'manual_provenance',
       'operator_revoked',repeat('6',64),recorded_by,'governed-v1','consent',
       observed_at,id
       from public.candidate_contact_attestations
      where id = (
        select (output ->> 'attestation_id')::bigint
          from candidate_list_evidence_test.outputs
         where case_name = 'manual-li-member-root'
      )$$,
  array['23514']
);

select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_revocation_changes_the_verified_observation_when_owner_inserts_then_23514_rejects_the_context_rewrite',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     )
     select workspace_id,campaign_id,candidate_id,'manual_provenance',
       'operator_revoked',repeat('7',64),recorded_by,'governed-v1',
       lawful_basis_code,observed_at + interval '1 second',id
       from public.candidate_contact_attestations
      where id = (
        select (output ->> 'attestation_id')::bigint
          from candidate_list_evidence_test.outputs
         where case_name = 'manual-li-member-root'
      )$$,
  array['23514']
);

select candidate_list_evidence_test.expect(
  'given_a_manual_member_is_revoked_then_reverified_when_existing_and_new_lists_are_checked_then_each_successful_admission_keeps_its_exact_leaf_snapshot',
  (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-add')
  and (select output = '{"status":"provenance_revoked"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'manual-consent-after-revoke')
  and (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-consent-add-after-reverify')
  and exists (
    select 1 from public.candidate_list_members
     where list_id = 'e1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-campaign'
       and candidate_id = 'manual-consent'
       and evidence_kind = 'manual_attestation'
       and evidence_attestation_id = (
         select (output ->> 'attestation_id')::bigint
           from candidate_list_evidence_test.outputs
          where case_name = 'manual-consent-child'
       )
       and evidence_provider_attempt_id is null
       and evidence_expires_at is null
  )
  and exists (
    select 1 from public.candidate_list_members
     where list_id = 'e1111111-1111-4111-8111-111111111112'
       and candidate_id = 'manual-consent'
       and evidence_attestation_id = (
         select (output ->> 'attestation_id')::bigint
           from candidate_list_evidence_test.outputs
          where case_name = 'manual-consent-reverify-after-revoke'
       )
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '04000000-0000-4000-8000-000000000007'
  ),
  jsonb_build_object(
    'add',(select output from candidate_list_evidence_test.outputs
            where case_name = 'manual-consent-add'),
    'revoke',(select output from candidate_list_evidence_test.outputs
               where case_name = 'manual-consent-revoke'),
    'afterRevoke',(select output from candidate_list_evidence_test.outputs
                    where case_name = 'manual-consent-after-revoke'),
    'reverify',(select output from candidate_list_evidence_test.outputs
                 where case_name = 'manual-consent-reverify-after-revoke'),
    'afterReverify',(select output from candidate_list_evidence_test.outputs
                      where case_name = 'manual-consent-add-after-reverify'),
    'members',(select coalesce(jsonb_agg(to_jsonb(member)),'[]'::jsonb)
                 from public.candidate_list_members member
                where member.candidate_id = 'manual-consent')
  )::text
);

-- A provider and a governed manual leaf for the same canonical candidate is
-- intentionally ambiguous. No source silently wins.
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'mixed-manual-root',
  public.attest_candidate_manual_provenance(
    'd1000000-0000-4000-8000-000000000001',
    'github-22222222222222222222222222222222','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'd1000000-0000-4000-8000-000000000001',
      'github-22222222222222222222222222222222'
    ),
    null,'04000000-0000-4000-8000-000000000009'
  )
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'mixed-add',
  public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111112',
    'd1000000-0000-4000-8000-000000000001',
    'github-22222222222222222222222222222222',
    '04000000-0000-4000-8000-000000000010'
  )
);
commit;

select candidate_list_evidence_test.expect(
  'given_provider_and_manual_authority_coexist_when_add_is_called_then_provenance_is_ambiguous_and_no_artifact_is_created',
  (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs where case_name = 'mixed-manual-root')
  and (select output = '{"status":"provenance_ambiguous"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'mixed-add')
  and not exists (
    select 1 from public.candidate_list_members
     where candidate_id = 'github-22222222222222222222222222222222'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '04000000-0000-4000-8000-000000000010'
  ),
  jsonb_build_object(
    'manual',(select output from candidate_list_evidence_test.outputs
               where case_name = 'mixed-manual-root'),
    'add',(select output from candidate_list_evidence_test.outputs
            where case_name = 'mixed-add'),
    'members',(select count(*) from public.candidate_list_members
                where candidate_id =
                  'github-22222222222222222222222222222222'),
    'receipts',(select count(*) from public.candidate_list_operation_receipts
                 where idempotency_key =
                   '04000000-0000-4000-8000-000000000010')
  )::text
);

-- Legacy 0064 attestations remain readable evidence snapshots for existing
-- members, but cannot authorize a fresh 0065 admission.
insert into public.candidate_lists(id,workspace_id,name,created_by) values (
  'b1222222-2222-4222-8222-222222222223',
  'b1111111-1111-4111-8111-111111111111',
  'Legacy fresh list','b1000000-0000-4000-8000-000000000001'
);
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'b1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values (
  'legacy-fresh-add',
  public.add_candidate_list_member(
    'b1222222-2222-4222-8222-222222222223',
    'legacy-campaign','legacy-valid',
    '04000000-0000-4000-8000-000000000011'
  )
);
commit;

select candidate_list_evidence_test.expect(
  'given_only_a_legacy_0064_attestation_when_fresh_admission_is_attempted_then_provenance_is_missing',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'legacy-fresh-add')
  and not exists (
    select 1 from public.candidate_list_members
     where list_id = 'b1222222-2222-4222-8222-222222222223'
       and candidate_id = 'legacy-valid'
  )
);

-- Viewer and non-authenticated roles cannot write governed manual evidence.
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000003','authenticated'
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_viewer_when_manual_attest_is_called_then_source_mutation_is_denied',
  format(
    'select public.attest_candidate_manual_provenance(%L,%L,%L,%L,%s,%L)',
    'manual-campaign','manual-li','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-li'
    ),
    'null','04000000-0000-4000-8000-000000000012'
  ),
  array['42501']
);
commit;

begin;
set local role service_role;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','service_role'
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_service_role_when_manual_attest_is_called_then_runtime_execution_is_denied',
  format(
    'select public.attest_candidate_manual_provenance(%L,%L,%L,%L,%s,%L)',
    'manual-campaign','manual-li','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-li'
    ),
    'null','04000000-0000-4000-8000-000000000013'
  ),
  array['42501']
);
commit;

-- Invalid canonical manual facts and mismatched observation time remain
-- non-authoritative and create no lifecycle row.
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values
  ('manual-invalid-canonical',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-invalid','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-invalid'
    ),
    null,'04000000-0000-4000-8000-000000000014'
  )),
  ('manual-mismatched-observed',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-li','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-campaign','manual-li'
    ) - interval '1 second',
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-li-member-root'),
    '04000000-0000-4000-8000-000000000015'
  )),
  ('manual-future-observed',public.attest_candidate_manual_provenance(
    'manual-campaign','manual-li','verify',
    clock_timestamp() + interval '6 minutes',
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-li-member-root'),
    '04000000-0000-4000-8000-000000000016'
  ));
commit;

select candidate_list_evidence_test.expect(
  'given_invalid_manual_canonical_or_observation_facts_when_attest_is_called_then_provenance_is_missing_without_rows_or_receipts',
  (select bool_and(output = '{"status":"provenance_missing"}'::jsonb)
     from candidate_list_evidence_test.outputs
    where case_name in (
      'manual-invalid-canonical','manual-mismatched-observed',
      'manual-future-observed'
    ))
  and not exists (
    select 1 from public.candidate_contact_attestations
     where candidate_id = 'manual-invalid'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key in (
       '04000000-0000-4000-8000-000000000014',
       '04000000-0000-4000-8000-000000000015',
       '04000000-0000-4000-8000-000000000016'
     )
  )
);

-- Canonical workspace state is the erasure-reachability root. Neither a table
-- owner nor a tenant caller may delete it, move it to another tenant identity,
-- remove an authority-bearing candidate, or duplicate that candidate.
select candidate_list_evidence_test.expect_sqlstate(
  'given_candidate_list_authority_when_owner_directly_deletes_workspace_state_then_23514_refuses_the_orphaning_delete',
  $$delete from public.workspace_state
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['23514']
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
with deleted as (
  delete from public.workspace_state
   where workspace_id = 'c1111111-1111-4111-8111-111111111111'
  returning workspace_id
)
select candidate_list_evidence_test.expect(
  'given_candidate_list_authority_when_authenticated_directly_deletes_workspace_state_then_rls_exposes_no_deletable_row_and_state_is_preserved',
  not exists (select 1 from deleted)
  and exists (
    select 1 from public.workspace_state
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
  )
);
commit;

insert into public.workspaces(id,name,allowed_domain) values (
  'c4444444-4444-4444-8444-444444444444',
  'Evidence Tenant Hop Target','evidence-hop-target.example.test'
);

select candidate_list_evidence_test.expect_sqlstate(
  'given_candidate_list_authority_when_owner_moves_workspace_state_to_another_tenant_then_55000_refuses_the_tenant_hop',
  $$update public.workspace_state
       set workspace_id = 'c4444444-4444-4444-8444-444444444444'
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['55000']
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_candidate_list_authority_when_authenticated_moves_workspace_state_to_another_tenant_then_guard_or_rls_refuses_the_tenant_hop',
  $$update public.workspace_state
       set workspace_id = 'c4444444-4444-4444-8444-444444444444'
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['55000','42501']
);
commit;

select candidate_list_evidence_test.expect_sqlstate(
  'given_candidate_list_authority_when_owner_removes_its_canonical_candidate_then_23514_preserves_erasure_reachability',
  $$update public.workspace_state workspace
       set state = jsonb_set(
         workspace.state,
         '{candidates}',
         (
           select coalesce(jsonb_agg(candidate.value order by candidate.ordinality),'[]'::jsonb)
             from jsonb_array_elements(workspace.state -> 'candidates')
               with ordinality candidate(value,ordinality)
            where candidate.value ->> 'campaignId' <> 'manual-campaign'
               or candidate.value ->> 'id' <> 'manual-consent'
         )
       )
     where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['23514']
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_candidate_list_authority_when_authenticated_duplicates_its_canonical_candidate_then_23514_preserves_unique_reachability',
  $$update public.workspace_state workspace
       set state = jsonb_set(
         workspace.state,
         '{candidates}',
         (workspace.state -> 'candidates') || jsonb_build_array(
           (
             select candidate.value
               from jsonb_array_elements(workspace.state -> 'candidates')
                 candidate(value)
              where candidate.value ->> 'campaignId' = 'manual-campaign'
                and candidate.value ->> 'id' = 'manual-consent'
              limit 1
           )
         )
       )
     where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['23514']
);
commit;

select candidate_list_evidence_test.expect(
  'given_rejected_workspace_state_mutations_when_authority_is_rechecked_then_state_and_evidence_remain_atomic_and_tenant_bound',
  (select count(*) = 1
     from public.workspace_state workspace
     cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
       candidate(value)
    where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
      and candidate.value ->> 'campaignId' = 'manual-campaign'
      and candidate.value ->> 'id' = 'manual-consent')
  and not exists (
    select 1 from public.workspace_state
     where workspace_id = 'c4444444-4444-4444-8444-444444444444'
  )
  and exists (
    select 1 from public.candidate_contact_attestations
     where id = (
       select (output ->> 'attestation_id')::bigint
         from candidate_list_evidence_test.outputs
        where case_name = 'manual-consent-root'
     )
  )
  and exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and idempotency_key = '04000000-0000-4000-8000-000000000001'
  )
);

delete from public.workspaces
 where id = 'c4444444-4444-4444-8444-444444444444';

-- A final AFTER guard must validate the row produced by every BEFORE trigger,
-- not merely the value submitted by the original UPDATE. This synthetic later-
-- named trigger attacks canonical reachability by removal and duplication.
create function candidate_list_evidence_test.mutate_canonical_before_final_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_candidates jsonb;
  v_target jsonb;
begin
  if new.workspace_id <> 'c1111111-1111-4111-8111-111111111111' then
    return new;
  end if;

  if current_setting(
       'candidate_list_evidence_test.workspace_attack',true
     ) = 'remove' then
    select coalesce(
      jsonb_agg(candidate.value order by candidate.ordinality),
      '[]'::jsonb
    )
      into v_candidates
      from jsonb_array_elements(new.state -> 'candidates')
        with ordinality candidate(value,ordinality)
     where candidate.value ->> 'campaignId' <> 'manual-campaign'
        or candidate.value ->> 'id' <> 'manual-consent';
    new.state := jsonb_set(new.state,'{candidates}',v_candidates);
  elsif current_setting(
          'candidate_list_evidence_test.workspace_attack',true
        ) = 'duplicate' then
    select candidate.value
      into v_target
      from jsonb_array_elements(new.state -> 'candidates') candidate(value)
     where candidate.value ->> 'campaignId' = 'manual-campaign'
       and candidate.value ->> 'id' = 'manual-consent'
     limit 1;
    new.state := jsonb_set(
      new.state,'{candidates}',
      (new.state -> 'candidates') || jsonb_build_array(v_target)
    );
  end if;

  return new;
end
$$;

create trigger zz_candidate_list_evidence_workspace_attack
before update of state on public.workspace_state
for each row execute function
  candidate_list_evidence_test.mutate_canonical_before_final_guard();

select set_config(
  'candidate_list_evidence_test.workspace_attack','remove',false
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_later_named_before_trigger_removes_an_authority_candidate_when_workspace_state_updates_then_the_final_after_guard_rejects_23514',
  $$update public.workspace_state
       set state = state || jsonb_build_object(
         'candidateListAuthorityProbe','remove'
       )
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['23514']
);

select set_config(
  'candidate_list_evidence_test.workspace_attack','duplicate',false
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_later_named_before_trigger_duplicates_an_authority_candidate_when_workspace_state_updates_then_the_final_after_guard_rejects_23514',
  $$update public.workspace_state
       set state = state || jsonb_build_object(
         'candidateListAuthorityProbe','duplicate'
       )
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'$$,
  array['23514']
);
select set_config(
  'candidate_list_evidence_test.workspace_attack','',false
);

select candidate_list_evidence_test.expect(
  'given_synthetic_before_trigger_attacks_are_rejected_when_state_is_rechecked_then_final_state_is_atomic_and_the_authority_guard_is_after_all_before_triggers',
  (select count(*) = 1
     from public.workspace_state workspace
     cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
       candidate(value)
    where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
      and candidate.value ->> 'campaignId' = 'manual-campaign'
      and candidate.value ->> 'id' = 'manual-consent')
  and not (select state ? 'candidateListAuthorityProbe'
     from public.workspace_state
    where workspace_id = 'c1111111-1111-4111-8111-111111111111')
  and exists (
    select 1 from pg_trigger
     where tgrelid = 'public.workspace_state'::regclass
       and tgname = 'zz_candidate_list_evidence_workspace_attack'
       and (tgtype::integer & 2) = 2
  )
  and exists (
    select 1 from pg_trigger
     where tgrelid = 'public.workspace_state'::regclass
       and tgname = 'workspace_state_candidate_list_authority_guard'
       and (tgtype::integer & 2) = 0
  )
);

drop trigger zz_candidate_list_evidence_workspace_attack
  on public.workspace_state;
drop function
  candidate_list_evidence_test.mutate_canonical_before_final_guard();

-- Verification is an evidence-raising action and cannot begin from a lawful-
-- basis observation older than 180 days. Revocation is risk-lowering: an
-- already-governed verification must still be revocable after it ages, while
-- preserving the predecessor's historical basis and observation instant.
do $aged_manual_candidates$
declare
  aged_time timestamptz := clock_timestamp() - interval '181 days';
  aged_text text;
begin
  aged_text := to_char(
    aged_time at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  update public.workspace_state workspace
     set state = jsonb_set(
       workspace.state,
       '{candidates}',
       (workspace.state -> 'candidates') || jsonb_build_array(
         jsonb_build_object(
           'id','manual-aged-new',
           'campaignId','manual-aged-campaign',
           'name','Manual Aged New',
           'provenance','manual',
           'sourcePlatform','Manual',
           'lawfulBasis','consent',
           'lawfulBasisRecordedAt',aged_text,
           'lawfulBasisSource','operator_selection'
         ),
         jsonb_build_object(
           'id','manual-aged-existing',
           'campaignId','manual-aged-campaign',
           'name','Manual Aged Existing',
           'provenance','manual',
           'sourcePlatform','Manual',
           'lawfulBasis','consent',
           'lawfulBasisRecordedAt',aged_text,
           'lawfulBasisSource','operator_selection'
         )
       )
     )
   where workspace.workspace_id =
         'c1111111-1111-4111-8111-111111111111';
end
$aged_manual_candidates$;

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-aged-new-verify',public.attest_candidate_manual_provenance(
  'manual-aged-campaign','manual-aged-new','verify',
  candidate_list_evidence_test.canonical_observed_at(
    'c1111111-1111-4111-8111-111111111111',
    'manual-aged-campaign','manual-aged-new'
  ),
  null,'05400000-0000-4000-8000-000000000001'
);
commit;

with inserted as (
  insert into public.candidate_contact_attestations(
    workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
    evidence_sha256,recorded_by,authority_version,lawful_basis_code,
    observed_at,supersedes_id
  ) values (
    'c1111111-1111-4111-8111-111111111111',
    'manual-aged-campaign','manual-aged-existing',
    'manual_provenance','operator_verified',repeat('a',64),
    'c1000000-0000-4000-8000-000000000001','governed-v1','consent',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-aged-campaign','manual-aged-existing'
    ),
    null
  )
  returning id
)
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-aged-existing-root',jsonb_build_object('attestation_id',id)
  from inserted;

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-aged-existing-revoke',
  public.attest_candidate_manual_provenance(
    'manual-aged-campaign','manual-aged-existing','revoke',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'manual-aged-campaign','manual-aged-existing'
    ),
    (select (output ->> 'attestation_id')::bigint
       from candidate_list_evidence_test.outputs
      where case_name = 'manual-aged-existing-root'),
    '05400000-0000-4000-8000-000000000002'
  );
commit;

select candidate_list_evidence_test.expect(
  'given_a_new_manual_observation_older_than_180_days_when_verify_is_requested_then_provenance_is_missing_without_authority_artifacts',
  (select output = '{"status":"provenance_missing"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-aged-new-verify')
  and not exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-aged-campaign'
       and candidate_id = 'manual-aged-new'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and idempotency_key = '05400000-0000-4000-8000-000000000001'
  )
);

select candidate_list_evidence_test.expect(
  'given_an_existing_verification_older_than_180_days_when_its_current_leaf_is_revoked_then_revocation_succeeds_and_preserves_historical_evidence',
  (select output ->> 'status' = 'revoked'
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-aged-existing-revoke')
  and exists (
    select 1
      from public.candidate_contact_attestations revoked
      join public.candidate_contact_attestations verified
        on verified.id = revoked.supersedes_id
     where revoked.id = (
       select (output ->> 'attestation_id')::bigint
         from candidate_list_evidence_test.outputs
        where case_name = 'manual-aged-existing-revoke'
     )
       and revoked.value_code = 'operator_revoked'
       and verified.value_code = 'operator_verified'
       and revoked.lawful_basis_code = verified.lawful_basis_code
       and revoked.observed_at = verified.observed_at
       and verified.observed_at < clock_timestamp() - interval '180 days'
  )
  and exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and idempotency_key = '05400000-0000-4000-8000-000000000002'
       and result ->> 'status' = 'revoked'
  )
);

-- Seed a legitimate manual authority chain in another workspace. A malicious
-- receipt trigger below will attempt to borrow Tenant A's erasure context to
-- delete these Tenant B rows; the cleanup authority must remain bound to the
-- exact request workspace and candidate.
do $unrelated_erasure_target$
declare
  basis_time timestamptz := clock_timestamp() - interval '1 minute';
begin
  update public.workspace_state workspace
     set state = jsonb_set(
       workspace.state,
       '{candidates}',
       jsonb_build_array(
         jsonb_build_object(
           'id','manual-unrelated-erasure-target',
           'campaignId','manual-foreign-campaign',
           'name','Manual Unrelated Erasure Target',
           'provenance','manual',
           'sourcePlatform','Manual',
           'lawfulBasis','consent',
           'lawfulBasisRecordedAt',to_char(
             basis_time at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ),
           'lawfulBasisSource','operator_selection'
         )
       )
     )
   where workspace.workspace_id =
         'c2222222-2222-4222-8222-222222222222';
end
$unrelated_erasure_target$;

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c2000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'unrelated-erasure-target-root',
  public.attest_candidate_manual_provenance(
    'manual-foreign-campaign','manual-unrelated-erasure-target','verify',
    candidate_list_evidence_test.canonical_observed_at(
      'c2222222-2222-4222-8222-222222222222',
      'manual-foreign-campaign','manual-unrelated-erasure-target'
    ),
    null,'05200000-0000-4000-8000-000000000001'
  );
commit;

-- ---------------------------------------------------------------------------
-- Governed erasure removes the complete lifecycle chain, every membership,
-- and all candidate-linkable add/attest receipts, while retaining only the
-- aggregate store receipts required by the erasure authority.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-root',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-erase','verify',
  candidate_list_evidence_test.canonical_observed_at(
    'c1111111-1111-4111-8111-111111111111','manual-campaign','manual-erase'
  ),
  null,'05000000-0000-4000-8000-000000000001'
);
commit;

update public.workspace_state workspace
   set state = jsonb_set(
     workspace.state,
     '{candidates}',
     (
       select jsonb_agg(
         case
           when candidate.value ->> 'campaignId' = 'manual-campaign'
            and candidate.value ->> 'id' = 'manual-erase'
           then candidate.value || jsonb_build_object(
             'lawfulBasisRecordedAt',
             to_char(
               (
                 (candidate.value ->> 'lawfulBasisRecordedAt')::timestamptz
                   + interval '1 second'
               ) at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )
           else candidate.value
         end
         order by candidate.ordinality
       )
         from jsonb_array_elements(workspace.state -> 'candidates')
           with ordinality candidate(value, ordinality)
     )
   )
 where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111';

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-child',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-erase','verify',
  candidate_list_evidence_test.canonical_observed_at(
    'c1111111-1111-4111-8111-111111111111','manual-campaign','manual-erase'
  ),
  (select (output ->> 'attestation_id')::bigint
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-root'),
  '05000000-0000-4000-8000-000000000002'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-add',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111111',
  'manual-campaign','manual-erase',
  '05000000-0000-4000-8000-000000000003'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-stale-predecessor',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-erase','verify',
  candidate_list_evidence_test.canonical_observed_at(
    'c1111111-1111-4111-8111-111111111111','manual-campaign','manual-erase'
  ),
  (select (output ->> 'attestation_id')::bigint
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-root'),
  '05000000-0000-4000-8000-000000000004'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-revoke',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-erase','revoke',
  candidate_list_evidence_test.canonical_observed_at(
    'c1111111-1111-4111-8111-111111111111','manual-campaign','manual-erase'
  ),
  (select (output ->> 'attestation_id')::bigint
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-child'),
  '05000000-0000-4000-8000-000000000005'
);
commit;

select candidate_list_evidence_test.expect_sqlstate(
  'given_a_governed_revoked_leaf_when_owner_inserts_another_revoke_then_23514_rejects_the_repeated_revocation',
  $$insert into public.candidate_contact_attestations(
       workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
       evidence_sha256,recorded_by,authority_version,lawful_basis_code,
       observed_at,supersedes_id
     )
     select workspace_id,campaign_id,candidate_id,'manual_provenance',
       'operator_revoked',repeat('5',64),recorded_by,'governed-v1',
       lawful_basis_code,observed_at,id
       from public.candidate_contact_attestations
      where id = (
        select (output ->> 'attestation_id')::bigint
          from candidate_list_evidence_test.outputs
         where case_name = 'manual-erase-revoke'
      )$$,
  array['23514']
);

select candidate_list_evidence_test.expect(
  'given_a_governed_candidate_before_erasure_when_lifecycle_artifacts_are_counted_then_the_full_fixture_is_present',
  (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-root')
  and (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-child')
  and (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-add')
  and (select output = '{"status":"predecessor_conflict"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-erase-stale-predecessor')
  and (select output->>'status' = 'revoked'
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-revoke')
  and (select count(*) = 3 from public.candidate_contact_attestations
        where workspace_id = 'c1111111-1111-4111-8111-111111111111'
          and campaign_id = 'manual-campaign' and candidate_id = 'manual-erase')
  and (select count(*) = 1 from public.candidate_list_members
        where workspace_id = 'c1111111-1111-4111-8111-111111111111'
          and campaign_id = 'manual-campaign' and candidate_id = 'manual-erase')
  and (select count(*) = 5 from public.candidate_list_operation_receipts
        where idempotency_key in (
          '05000000-0000-4000-8000-000000000001',
          '05000000-0000-4000-8000-000000000002',
          '05000000-0000-4000-8000-000000000003',
          '05000000-0000-4000-8000-000000000004',
          '05000000-0000-4000-8000-000000000005'
        ))
);

insert into candidate_list_evidence_test.outputs(case_name,output)
select
  'manual-erase-observed-snapshot',
  jsonb_build_object(
    'observed_at',
    candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111','manual-campaign','manual-erase'
    )
  );

create table candidate_list_evidence_test.erasure_receipt_scope_probe(
  target text primary key check (target in ('attestation','receipt')),
  outcome text not null
);

create function candidate_list_evidence_test.attempt_cross_scope_erasure_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, candidate_list_evidence_test
as $$
begin
  if new.store_name <> 'candidate_list_members'
     or not exists (
       select 1
         from public.candidate_erasure_requests request
        where request.id = new.request_id
          and request.request_key =
              '05100000-0000-4000-8000-000000000001'
     ) then
    return new;
  end if;

  begin
    delete from public.candidate_contact_attestations
     where id = (
       select (output ->> 'attestation_id')::bigint
         from candidate_list_evidence_test.outputs
        where case_name = 'unrelated-erasure-target-root'
     );
    insert into candidate_list_evidence_test.erasure_receipt_scope_probe(
      target,outcome
    ) values ('attestation','delete_succeeded');
  exception when sqlstate '55000' then
    insert into candidate_list_evidence_test.erasure_receipt_scope_probe(
      target,outcome
    ) values ('attestation','55000');
  end;

  begin
    delete from public.candidate_list_operation_receipts
     where workspace_id = 'c2222222-2222-4222-8222-222222222222'
       and idempotency_key = '05200000-0000-4000-8000-000000000001';
    insert into candidate_list_evidence_test.erasure_receipt_scope_probe(
      target,outcome
    ) values ('receipt','delete_succeeded');
  exception when sqlstate '55000' then
    insert into candidate_list_evidence_test.erasure_receipt_scope_probe(
      target,outcome
    ) values ('receipt','55000');
  end;

  return new;
end
$$;

create trigger candidate_list_evidence_test_erasure_receipt_scope_probe
after insert on public.candidate_erasure_receipts
for each row execute function
  candidate_list_evidence_test.attempt_cross_scope_erasure_delete();

begin;
set local role service_role;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','service_role'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-request',public.request_candidate_erasure(
  'c1111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'manual-campaign','manual-erase',
  '05100000-0000-4000-8000-000000000001'
);
commit;

select candidate_list_evidence_test.expect(
  'given_a_governed_manual_chain_when_erasure_completes_then_members_chain_and_all_candidate_linkable_receipts_are_scrubbed_with_exact_store_counts',
  (select output->>'status' = 'completed'
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-request')
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-campaign' and candidate_id = 'manual-erase'
  )
  and not exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-campaign' and candidate_id = 'manual-erase'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key in (
       '05000000-0000-4000-8000-000000000001',
       '05000000-0000-4000-8000-000000000002',
       '05000000-0000-4000-8000-000000000003',
       '05000000-0000-4000-8000-000000000004',
       '05000000-0000-4000-8000-000000000005'
     )
  )
  and (select count(*) = 3
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '05100000-0000-4000-8000-000000000001'
          and receipt.store_name in (
            'candidate_list_members','candidate_contact_attestations',
            'candidate_list_operation_receipts'
          ))
  and (select scrubbed_rows = 1
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '05100000-0000-4000-8000-000000000001'
          and receipt.store_name = 'candidate_list_members')
  and (select scrubbed_rows = 3
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '05100000-0000-4000-8000-000000000001'
          and receipt.store_name = 'candidate_contact_attestations')
  and (select scrubbed_rows = 5
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '05100000-0000-4000-8000-000000000001'
          and receipt.store_name = 'candidate_list_operation_receipts')
);

select candidate_list_evidence_test.expect(
  'given_an_erasure_receipt_trigger_when_it_attempts_cross_workspace_evidence_deletes_then_the_request_scope_denies_both_and_preserves_the_unrelated_chain',
  (select output ->> 'status' = 'verified'
     from candidate_list_evidence_test.outputs
    where case_name = 'unrelated-erasure-target-root')
  and (select count(*) = 2
         from candidate_list_evidence_test.erasure_receipt_scope_probe
        where outcome = '55000')
  and exists (
    select 1 from public.candidate_contact_attestations
     where id = (
       select (output ->> 'attestation_id')::bigint
         from candidate_list_evidence_test.outputs
        where case_name = 'unrelated-erasure-target-root'
     )
  )
  and exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c2222222-2222-4222-8222-222222222222'
       and idempotency_key = '05200000-0000-4000-8000-000000000001'
  )
);

drop trigger candidate_list_evidence_test_erasure_receipt_scope_probe
  on public.candidate_erasure_receipts;
drop function candidate_list_evidence_test.attempt_cross_scope_erasure_delete();

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-add-after',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111112',
  'manual-campaign','manual-erase',
  '05000000-0000-4000-8000-000000000006'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'manual-erase-attest-after',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-erase','verify',
  (select (output ->> 'observed_at')::timestamptz
     from candidate_list_evidence_test.outputs
    where case_name = 'manual-erase-observed-snapshot'),
  null,'05000000-0000-4000-8000-000000000007'
);
commit;

select candidate_list_evidence_test.expect(
  'given_a_candidate_has_been_erased_when_add_and_attest_are_retried_then_both_are_non_disclosing_and_create_no_candidate_linkable_receipt',
  (select output = '{"status":"candidate_not_found"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-add-after')
  and (select output = '{"status":"candidate_not_found"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'manual-erase-attest-after')
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key in (
       '05000000-0000-4000-8000-000000000006',
       '05000000-0000-4000-8000-000000000007'
     )
  )
);

-- PostgreSQL UUID storage normalizes case, while canonical workspace identity
-- is text. Prove that an uppercase canonical UUID campaign resolves the exact
-- completed GitHub authority and that erasure uses the same case-insensitive
-- boundary when scrubbing the provider row.
update public.workspace_state workspace
   set state = jsonb_set(
     workspace.state,
     '{candidates}',
     (workspace.state -> 'candidates') || jsonb_build_array(
       jsonb_build_object(
         'id','github-uppercase-campaign',
         'campaignId','D1000000-0000-4000-8000-000000000001',
         'name','GitHub Uppercase Campaign',
         'provenance','github',
         'sourcePlatform','GitHub'
       )
     )
   )
 where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111';

insert into public.sourcing_candidate_evidence(
  workspace_id,campaign_id,candidate_id,job_id,egress_attempt_id,provider,
  provider_external_id,github_url,raw_response_sha256,
  normalized_payload_sha256,evidence,observed_at
) values (
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'github-uppercase-campaign',
  'f1000000-0000-4000-8000-000000000001',
  'f1100000-0000-4000-8000-000000000001',
  'github','109','https://github.com/evidence-uppercase-campaign',
  repeat('5',64),repeat('6',64),'{"source":"synthetic"}',
  clock_timestamp() - interval '1 minute'
);

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'github-uppercase-add',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111112',
  'D1000000-0000-4000-8000-000000000001',
  'github-uppercase-campaign',
  '05500000-0000-4000-8000-000000000001'
);
commit;

select candidate_list_evidence_test.expect(
  'given_an_uppercase_canonical_uuid_campaign_with_completed_github_authority_when_added_then_provider_evidence_resolves_and_is_snapshotted',
  (select output ->> 'status' = 'added'
     from candidate_list_evidence_test.outputs
    where case_name = 'github-uppercase-add')
  and exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and list_id = 'e1111111-1111-4111-8111-111111111112'
       and campaign_id = 'D1000000-0000-4000-8000-000000000001'
       and candidate_id = 'github-uppercase-campaign'
       and evidence_kind = 'github_provider'
       and evidence_provider_attempt_id =
           'f1100000-0000-4000-8000-000000000001'
  )
);

begin;
set local role service_role;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','service_role'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'github-uppercase-erasure',public.request_candidate_erasure(
  'c1111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'D1000000-0000-4000-8000-000000000001',
  'github-uppercase-campaign',
  '05500000-0000-4000-8000-000000000002'
);
commit;

select candidate_list_evidence_test.expect(
  'given_uppercase_uuid_provider_authority_when_governed_erasure_runs_then_local_authority_is_scrubbed_canonical_state_is_tombstoned_and_github_obligation_is_truthful',
  (select output ->> 'status' = 'manual_required'
          and output -> 'obligations' @>
            '[{"provider":"github","status":"manual_required"}]'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'github-uppercase-erasure')
  and not exists (
    select 1 from public.sourcing_candidate_evidence
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'd1000000-0000-4000-8000-000000000001'
       and candidate_id = 'github-uppercase-campaign'
  )
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'D1000000-0000-4000-8000-000000000001'
       and candidate_id = 'github-uppercase-campaign'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and idempotency_key = '05500000-0000-4000-8000-000000000001'
  )
  and (select count(*) = 1
      from public.workspace_state workspace
      cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
        candidate(value)
     where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and candidate.value ->> 'campaignId' =
           'D1000000-0000-4000-8000-000000000001'
       and candidate.value ->> 'id' = 'github-uppercase-campaign'
       and candidate.value ->> 'name' = 'Anonymized Candidate'
       and candidate.value ->> 'stage' = 'Suppressed'
       and candidate.value -> 'complianceFlags' ->> 'anonymized' = 'true')
  and (select scrubbed_rows = 1
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request
           on request.id = receipt.request_id
        where request.request_key =
              '05500000-0000-4000-8000-000000000002'
          and receipt.store_name = 'sourcing_candidate_evidence'),
  jsonb_build_object(
    'output',(select output from candidate_list_evidence_test.outputs
      where case_name = 'github-uppercase-erasure'),
    'sourceRows',(select count(*) from public.sourcing_candidate_evidence
      where workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate_id = 'github-uppercase-campaign'),
    'memberRows',(select count(*) from public.candidate_list_members
      where workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate_id = 'github-uppercase-campaign'),
    'operationRows',(select count(*)
      from public.candidate_list_operation_receipts
      where idempotency_key = '05500000-0000-4000-8000-000000000001'),
    'canonicalRows',(select count(*)
      from public.workspace_state workspace
      cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
        candidate(value)
      where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate.value ->> 'id' = 'github-uppercase-campaign'),
    'erasureReceipts',(select coalesce(jsonb_object_agg(
      receipt.store_name,receipt.scrubbed_rows
    ),'{}'::jsonb)
      from public.candidate_erasure_receipts receipt
      join public.candidate_erasure_requests request
        on request.id = receipt.request_id
      where request.request_key =
            '05500000-0000-4000-8000-000000000002')
  )::text
);

-- Candidate erasure is identity-global inside a workspace, even when the same
-- candidate ID is present under multiple campaigns. Build two completed GitHub
-- authorities and two list snapshots first, then add governed manual evidence
-- and receipts under both campaign subjects. One request must remove the whole
-- identity without leaving a second-campaign authority island.
insert into public.requisitions(
  id,workspace_id,source_kind,source_ref,status,campaign_id,
  parsed_job_analysis,parse_input_sha256,parse_result_sha256
) values
  ('d3100000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111','api','global-erasure-req-one',
   'campaign_created','d3000000-0000-4000-8000-000000000001',
   '{"title":"Global erasure one","requiredSkills":["verification"]}',
   repeat('1',64),repeat('2',64)),
  ('d4100000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111','api','global-erasure-req-two',
   'campaign_created','d4000000-0000-4000-8000-000000000001',
   '{"title":"Global erasure two","requiredSkills":["verification"]}',
   repeat('3',64),repeat('4',64));

insert into public.sourcing_campaigns(
  id,workspace_id,requisition_id,activation_actor_id,status,role_basis,
  parse_input_sha256,parse_result_sha256,campaign_sha256
) values
  ('d3000000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111',
   'd3100000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001','sourcing',
   '{"title":"Global erasure one","skills":["verification"]}',
   repeat('1',64),repeat('2',64),repeat('a',64)),
  ('d4000000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111',
   'd4100000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001','sourcing',
   '{"title":"Global erasure two","skills":["verification"]}',
   repeat('3',64),repeat('4',64),repeat('a',64));

update public.workspace_state workspace
   set state = jsonb_set(
     jsonb_set(
       workspace.state,
       '{campaigns}',
       (workspace.state -> 'campaigns') || jsonb_build_array(
         jsonb_build_object(
           'id','d3000000-0000-4000-8000-000000000001',
           'title','Global erasure one','status','Sourcing'
         ),
         jsonb_build_object(
           'id','d4000000-0000-4000-8000-000000000001',
           'title','Global erasure two','status','Sourcing'
         )
       )
     ),
     '{candidates}',
     (workspace.state -> 'candidates') || jsonb_build_array(
       jsonb_build_object(
         'id','identity-global-erasure',
         'campaignId','d3000000-0000-4000-8000-000000000001',
         'name','Identity Global One','provenance','github',
         'sourcePlatform','GitHub'
       ),
       jsonb_build_object(
         'id','identity-global-erasure',
         'campaignId','d4000000-0000-4000-8000-000000000001',
         'name','Identity Global Two','provenance','github',
         'sourcePlatform','GitHub'
       )
     )
   )
 where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111';

select candidate_list_evidence_test.seed_github_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd3000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f4100000-0000-4000-8000-000000000001','completed',true,1
);
select candidate_list_evidence_test.seed_github_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd4000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'f5100000-0000-4000-8000-000000000001','completed',true,1
);

insert into public.sourcing_candidate_evidence(
  workspace_id,campaign_id,candidate_id,job_id,egress_attempt_id,provider,
  provider_external_id,github_url,raw_response_sha256,
  normalized_payload_sha256,evidence,observed_at
) values
  ('c1111111-1111-4111-8111-111111111111',
   'd3000000-0000-4000-8000-000000000001','identity-global-erasure',
   'f4000000-0000-4000-8000-000000000001',
   'f4100000-0000-4000-8000-000000000001','github','201',
   'https://github.com/evidence-global-one',repeat('7',64),repeat('8',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111',
   'd4000000-0000-4000-8000-000000000001','identity-global-erasure',
   'f5000000-0000-4000-8000-000000000001',
   'f5100000-0000-4000-8000-000000000001','github','202',
   'https://github.com/evidence-global-two',repeat('9',64),repeat('a',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute');

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values
  ('identity-global-add-one',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111111',
    'd3000000-0000-4000-8000-000000000001','identity-global-erasure',
    '05600000-0000-4000-8000-000000000001'
  )),
  ('identity-global-add-two',public.add_candidate_list_member(
    'e1111111-1111-4111-8111-111111111112',
    'd4000000-0000-4000-8000-000000000001','identity-global-erasure',
    '05600000-0000-4000-8000-000000000002'
  ));
commit;

do $identity_global_manual_basis$
declare
  basis_time timestamptz := clock_timestamp() - interval '1 minute';
  basis_text text;
begin
  basis_text := to_char(
    basis_time at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  update public.workspace_state workspace
     set state = jsonb_set(
       workspace.state,
       '{candidates}',
       (
         select jsonb_agg(
           case
             when candidate.value ->> 'id' = 'identity-global-erasure'
             then candidate.value || jsonb_build_object(
               'provenance','manual','sourcePlatform','Manual',
               'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
               'lawfulBasisSource','operator_selection'
             )
             else candidate.value
           end
           order by candidate.ordinality
         )
           from jsonb_array_elements(workspace.state -> 'candidates')
             with ordinality candidate(value,ordinality)
       )
     )
   where workspace.workspace_id =
         'c1111111-1111-4111-8111-111111111111';
end
$identity_global_manual_basis$;

begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
values
  ('identity-global-attest-one',public.attest_candidate_manual_provenance(
    'd3000000-0000-4000-8000-000000000001','identity-global-erasure',
    'verify',candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'd3000000-0000-4000-8000-000000000001','identity-global-erasure'
    ),null,'05600000-0000-4000-8000-000000000003'
  )),
  ('identity-global-attest-two',public.attest_candidate_manual_provenance(
    'd4000000-0000-4000-8000-000000000001','identity-global-erasure',
    'verify',candidate_list_evidence_test.canonical_observed_at(
      'c1111111-1111-4111-8111-111111111111',
      'd4000000-0000-4000-8000-000000000001','identity-global-erasure'
    ),null,'05600000-0000-4000-8000-000000000004'
  ));
commit;

select candidate_list_evidence_test.expect(
  'given_one_candidate_id_across_two_campaigns_before_erasure_then_both_canonical_authorities_members_manual_attestations_receipts_and_github_rows_exist',
  (select bool_and(output ->> 'status' = 'added')
     from candidate_list_evidence_test.outputs
    where case_name in ('identity-global-add-one','identity-global-add-two'))
  and (select bool_and(output ->> 'status' = 'verified')
     from candidate_list_evidence_test.outputs
    where case_name in (
      'identity-global-attest-one','identity-global-attest-two'
    ))
  and (select count(*) = 2
     from public.workspace_state workspace
     cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
       candidate(value)
    where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
      and candidate.value ->> 'id' = 'identity-global-erasure')
  and (select count(*) = 2 from public.candidate_list_members
    where workspace_id = 'c1111111-1111-4111-8111-111111111111'
      and candidate_id = 'identity-global-erasure')
  and (select count(*) = 2 from public.candidate_contact_attestations
    where workspace_id = 'c1111111-1111-4111-8111-111111111111'
      and candidate_id = 'identity-global-erasure')
  and (select count(*) = 4 from public.candidate_list_operation_receipts
    where idempotency_key in (
      '05600000-0000-4000-8000-000000000001',
      '05600000-0000-4000-8000-000000000002',
      '05600000-0000-4000-8000-000000000003',
      '05600000-0000-4000-8000-000000000004'
    ))
  and (select count(*) = 2 from public.sourcing_candidate_evidence
    where workspace_id = 'c1111111-1111-4111-8111-111111111111'
      and candidate_id = 'identity-global-erasure')
);

begin;
set local role service_role;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','service_role'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'identity-global-erasure',public.request_candidate_erasure(
  'c1111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001','identity-global-erasure',
  '05600000-0000-4000-8000-000000000005'
);
commit;

select candidate_list_evidence_test.expect(
  'given_one_candidate_id_across_two_campaigns_when_one_governed_erasure_completes_then_every_campaign_authority_is_removed_and_both_canonical_entries_are_tombstoned',
  (select output ->> 'status' = 'completed'
     from candidate_list_evidence_test.outputs
    where case_name = 'identity-global-erasure')
  and (select count(*) = 2
      from public.workspace_state workspace
      cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
        candidate(value)
     where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and candidate.value ->> 'id' = 'identity-global-erasure'
       and candidate.value ->> 'name' = 'Anonymized Candidate'
       and candidate.value ->> 'stage' = 'Suppressed'
       and candidate.value -> 'complianceFlags' ->> 'anonymized' = 'true')
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and candidate_id = 'identity-global-erasure'
  )
  and not exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and candidate_id = 'identity-global-erasure'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key in (
       '05600000-0000-4000-8000-000000000001',
       '05600000-0000-4000-8000-000000000002',
       '05600000-0000-4000-8000-000000000003',
       '05600000-0000-4000-8000-000000000004'
     )
  )
  and not exists (
    select 1 from public.sourcing_candidate_evidence
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and candidate_id = 'identity-global-erasure'
  )
  and (select scrubbed_rows = 2
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request
           on request.id = receipt.request_id
        where request.request_key =
              '05600000-0000-4000-8000-000000000005'
          and receipt.store_name = 'candidate_list_members')
  and (select scrubbed_rows = 2
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request
           on request.id = receipt.request_id
        where request.request_key =
              '05600000-0000-4000-8000-000000000005'
          and receipt.store_name = 'candidate_contact_attestations')
  and (select scrubbed_rows = 4
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request
           on request.id = receipt.request_id
        where request.request_key =
              '05600000-0000-4000-8000-000000000005'
          and receipt.store_name = 'candidate_list_operation_receipts')
  and (select scrubbed_rows = 2
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request
           on request.id = receipt.request_id
        where request.request_key =
              '05600000-0000-4000-8000-000000000005'
          and receipt.store_name = 'sourcing_candidate_evidence'),
  jsonb_build_object(
    'output',(select output from candidate_list_evidence_test.outputs
      where case_name = 'identity-global-erasure'),
    'canonicalRows',(select count(*)
      from public.workspace_state workspace
      cross join lateral jsonb_array_elements(workspace.state -> 'candidates')
        candidate(value)
      where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate.value ->> 'id' = 'identity-global-erasure'),
    'memberRows',(select count(*) from public.candidate_list_members
      where workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate_id = 'identity-global-erasure'),
    'attestationRows',(select count(*)
      from public.candidate_contact_attestations
      where workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate_id = 'identity-global-erasure'),
    'operationRows',(select count(*)
      from public.candidate_list_operation_receipts
      where idempotency_key in (
        '05600000-0000-4000-8000-000000000001',
        '05600000-0000-4000-8000-000000000002',
        '05600000-0000-4000-8000-000000000003',
        '05600000-0000-4000-8000-000000000004'
      )),
    'sourceRows',(select count(*) from public.sourcing_candidate_evidence
      where workspace_id = 'c1111111-1111-4111-8111-111111111111'
        and candidate_id = 'identity-global-erasure'),
    'erasureReceipts',(select coalesce(jsonb_object_agg(
      receipt.store_name,receipt.scrubbed_rows
    ),'{}'::jsonb)
      from public.candidate_erasure_receipts receipt
      join public.candidate_erasure_requests request
        on request.id = receipt.request_id
      where request.request_key =
            '05600000-0000-4000-8000-000000000005')
  )::text
);

-- Evidence records and copied membership facts are immutable even to the
-- migration owner. Erasure is the only governed delete path.
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_member_snapshot_when_its_evidence_hash_is_updated_then_55000_is_raised',
  $$update public.candidate_list_members
       set evidence_sha256 = repeat('0',64)
     where candidate_id = 'github-11111111111111111111111111111111'$$,
  array['55000']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_member_snapshot_when_non_evidence_identity_is_updated_then_55000_is_raised',
  $$update public.candidate_list_members
       set added_at = added_at + interval '1 second'
     where candidate_id = 'github-11111111111111111111111111111111'$$,
  array['55000']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_member_snapshot_when_owner_issues_a_noop_update_then_55000_still_rejects_the_update_surface',
  $$update public.candidate_list_members
       set added_at = added_at
     where candidate_id = 'github-11111111111111111111111111111111'$$,
  array['55000']
);

create sequence candidate_list_evidence_test.later_member_trigger_calls;
create function candidate_list_evidence_test.mutate_member_evidence_late()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform nextval(
    'candidate_list_evidence_test.later_member_trigger_calls'::regclass
  );
  new.evidence_sha256 := repeat('0',64);
  return new;
end
$$;
create trigger zz_candidate_list_evidence_member_mutator
before update on public.candidate_list_members
for each row execute function
  candidate_list_evidence_test.mutate_member_evidence_late();

select candidate_list_evidence_test.expect_sqlstate(
  'given_a_later_named_before_trigger_can_mutate_member_evidence_when_owner_issues_a_noop_update_then_the_first_immutable_guard_rejects_55000',
  $$update public.candidate_list_members
       set added_at = added_at
     where candidate_id = 'github-11111111111111111111111111111111'$$,
  array['55000']
);
select candidate_list_evidence_test.expect(
  'given_the_immutable_guard_rejects_before_the_later_member_trigger_when_artifacts_are_rechecked_then_the_mutator_never_ran_and_evidence_is_unchanged',
  (select not is_called
     from candidate_list_evidence_test.later_member_trigger_calls)
  and exists (
    select 1
      from public.candidate_list_members member
      join public.sourcing_candidate_evidence evidence
        on evidence.workspace_id = member.workspace_id
       and evidence.campaign_id::text = member.campaign_id
       and evidence.candidate_id = member.candidate_id
     where member.candidate_id =
           'github-11111111111111111111111111111111'
       and member.evidence_sha256 = evidence.normalized_payload_sha256
       and member.evidence_sha256 <> repeat('0',64)
  )
  and 'zz_candidate_list_evidence_member_mutator' >
      'candidate_list_members_evidence_immutable'
);

drop trigger zz_candidate_list_evidence_member_mutator
  on public.candidate_list_members;
drop function candidate_list_evidence_test.mutate_member_evidence_late();
drop sequence candidate_list_evidence_test.later_member_trigger_calls;

select candidate_list_evidence_test.expect_sqlstate(
  'given_an_operation_receipt_when_it_is_updated_then_55000_is_raised',
  $$update public.candidate_list_operation_receipts set result = result where true$$,
  array['55000']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_an_operation_receipt_when_it_is_deleted_then_55000_is_raised',
  $$delete from public.candidate_list_operation_receipts where true$$,
  array['55000']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_manual_attestation_when_it_is_updated_then_55000_is_raised',
  $$update public.candidate_contact_attestations
       set value_code = value_code where true$$,
  array['55000']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_a_manual_attestation_when_it_is_deleted_then_55000_is_raised',
  $$delete from public.candidate_contact_attestations where true$$,
  array['55000']
);

-- An unrelated nested trigger is not an erasure authority. Trigger depth alone
-- must never bypass append-only protection for attestations or receipts.
create table candidate_list_evidence_test.unrelated_delete_probe(
  target text primary key check (target in ('attestation','receipt'))
);

create function candidate_list_evidence_test.attempt_unrelated_evidence_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, candidate_list_evidence_test
as $$
begin
  if new.target = 'attestation' then
    delete from public.candidate_contact_attestations
     where id = (
       select (output ->> 'attestation_id')::bigint
         from candidate_list_evidence_test.outputs
        where case_name = 'manual-consent-root'
     );
  else
    delete from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and operation_kind = 'attest_manual'
       and idempotency_key = '04000000-0000-4000-8000-000000000001';
  end if;
  return new;
end
$$;

create trigger unrelated_delete_probe_trigger
after insert on candidate_list_evidence_test.unrelated_delete_probe
for each row execute function
  candidate_list_evidence_test.attempt_unrelated_evidence_delete();

select candidate_list_evidence_test.expect_sqlstate(
  'given_an_unrelated_nested_trigger_when_it_deletes_an_attestation_without_erasure_authority_then_55000_is_raised',
  $$insert into candidate_list_evidence_test.unrelated_delete_probe(target)
    values ('attestation')$$,
  array['55000']
);
select candidate_list_evidence_test.expect_sqlstate(
  'given_an_unrelated_nested_trigger_when_it_deletes_an_operation_receipt_without_erasure_authority_then_55000_is_raised',
  $$insert into candidate_list_evidence_test.unrelated_delete_probe(target)
    values ('receipt')$$,
  array['55000']
);
select candidate_list_evidence_test.expect(
  'given_unrelated_nested_deletes_are_rejected_when_authority_rows_are_rechecked_then_both_rows_remain_and_the_probe_transactions_left_no_artifact',
  coalesce(current_setting('aria.candidate_list_erasure_cleanup',true),'') <> 'on'
  and exists (
    select 1 from public.candidate_contact_attestations
     where id = (
       select (output ->> 'attestation_id')::bigint
         from candidate_list_evidence_test.outputs
        where case_name = 'manual-consent-root'
     )
  )
  and exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and operation_kind = 'attest_manual'
       and idempotency_key = '04000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from candidate_list_evidence_test.unrelated_delete_probe
  )
);

-- Workspace deletion is the second narrow nested-delete authority. Exercise
-- it with governed attestation, member, and operation receipts so the stricter
-- append-only guard does not break legitimate tenant teardown.
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c3000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'workspace-cascade-create',public.create_candidate_list(
  'Workspace cascade list','07300000-0000-4000-8000-000000000001'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'workspace-cascade-attest',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-invalid-shape','verify',
  candidate_list_evidence_test.canonical_observed_at(
    'c3333333-3333-4333-8333-333333333333',
    'manual-campaign','manual-invalid-shape'
  ),
  null,'07300000-0000-4000-8000-000000000002'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'workspace-cascade-add',public.add_candidate_list_member(
  (select (output ->> 'list_id')::uuid
     from candidate_list_evidence_test.outputs
    where case_name = 'workspace-cascade-create'),
  'manual-campaign','manual-invalid-shape',
  '07300000-0000-4000-8000-000000000003'
);
commit;

delete from public.workspaces
 where id = 'c3333333-3333-4333-8333-333333333333';
delete from auth.users
 where id = 'c3000000-0000-4000-8000-000000000001';

select candidate_list_evidence_test.expect(
  'given_a_workspace_has_governed_candidate_list_evidence_when_the_workspace_is_deleted_then_every_authority_row_cascades_without_weakening_append_only_guards',
  (select output->>'status' = 'created'
     from candidate_list_evidence_test.outputs where case_name = 'workspace-cascade-create')
  and (select output->>'status' = 'verified'
     from candidate_list_evidence_test.outputs where case_name = 'workspace-cascade-attest')
  and (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'workspace-cascade-add')
  and not exists (
    select 1 from public.workspaces
     where id = 'c3333333-3333-4333-8333-333333333333'
  )
  and not exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c3333333-3333-4333-8333-333333333333'
  )
);
SQL
}

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Tenant, canonical workspace-state, campaign, list, and provider authority
-- fixtures. All values are synthetic and remain inside disposable Postgres.
-- ---------------------------------------------------------------------------
create schema candidate_list_evidence_test;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('c1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','evidence-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','evidence-member-a@example.test','',now(),'{}','{}',now(),now()),
  ('c1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','evidence-viewer-a@example.test','',now(),'{}','{}',now(),now()),
  ('c2000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','evidence-admin-b@example.test','',now(),'{}','{}',now(),now()),
  ('c3000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','evidence-admin-c@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id,name,allowed_domain) values
  ('c1111111-1111-4111-8111-111111111111','Evidence Tenant A','evidence-a.example.test'),
  ('c2222222-2222-4222-8222-222222222222','Evidence Tenant B','evidence-b.example.test'),
  ('c3333333-3333-4333-8333-333333333333','Evidence Tenant C','evidence-c.example.test');

insert into public.profiles(id,email,full_name,workspace_id,role) values
  ('c1000000-0000-4000-8000-000000000001','evidence-admin-a@example.test',
   'Evidence Admin A','c1111111-1111-4111-8111-111111111111','admin'),
  ('c1000000-0000-4000-8000-000000000002','evidence-member-a@example.test',
   'Evidence Member A','c1111111-1111-4111-8111-111111111111','member'),
  ('c1000000-0000-4000-8000-000000000003','evidence-viewer-a@example.test',
   'Evidence Viewer A','c1111111-1111-4111-8111-111111111111','viewer'),
  ('c2000000-0000-4000-8000-000000000001','evidence-admin-b@example.test',
   'Evidence Admin B','c2222222-2222-4222-8222-222222222222','admin'),
  ('c3000000-0000-4000-8000-000000000001','evidence-admin-c@example.test',
   'Evidence Admin C','c3333333-3333-4333-8333-333333333333','admin');

do $fixture$
declare
  basis_time timestamptz := clock_timestamp() - interval '1 minute';
  basis_text text;
begin
  basis_text := to_char(
    basis_time at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  insert into public.workspace_state(workspace_id,state) values (
    'c1111111-1111-4111-8111-111111111111',
    jsonb_build_object(
      'campaigns',jsonb_build_array(
        jsonb_build_object(
          'id','d1000000-0000-4000-8000-000000000001',
          'title','Evidence role','status','Sourcing'
        )
      ),
      'candidates',jsonb_build_array(
        jsonb_build_object(
          'id','github-11111111111111111111111111111111',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','GitHub Good','provenance','github','sourcePlatform','GitHub'
        ),
        jsonb_build_object(
          'id','github-22222222222222222222222222222222',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Mixed Authority','provenance','manual','sourcePlatform','Manual',
          'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','github-33333333333333333333333333333333',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','GitHub No Receipt','provenance','github','sourcePlatform','GitHub'
        ),
        jsonb_build_object(
          'id','github-44444444444444444444444444444444',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','GitHub Begun','provenance','github','sourcePlatform','GitHub'
        ),
        jsonb_build_object(
          'id','github-77777777777777777777777777777777',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','GitHub Mismatch','provenance','github','sourcePlatform','GitHub'
        ),
        jsonb_build_object(
          'id','github-66666666666666666666666666666666',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Duplicate Canonical One','provenance','github','sourcePlatform','GitHub'
        ),
        jsonb_build_object(
          'id','github-66666666666666666666666666666666',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Duplicate Canonical Two','provenance','github','sourcePlatform','GitHub'
        ),
        jsonb_build_object(
          'id','linkedin-11111111111111111111111111111111',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Tavily Good','provenance','tavily','sourcePlatform','LinkedIn'
        ),
        jsonb_build_object(
          'id','linkedin-22222222222222222222222222222222',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Tavily Short','provenance','tavily','sourcePlatform','LinkedIn'
        ),
        jsonb_build_object(
          'id','linkedin-33333333333333333333333333333333',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Tavily Expired','provenance','tavily','sourcePlatform','LinkedIn'
        ),
        jsonb_build_object(
          'id','linkedin-44444444444444444444444444444444',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','Tavily No Receipt','provenance','tavily','sourcePlatform','LinkedIn'
        ),
        jsonb_build_object(
          'id','manual-consent',
          'campaignId','manual-campaign',
          'name','Manual Consent','provenance','manual','sourcePlatform','Manual',
          'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-li',
          'campaignId','manual-campaign',
          'name','Manual Legitimate Interest','provenance','manual','sourcePlatform','Manual',
          'lawfulBasis','legitimate_interest','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-invalid',
          'campaignId','manual-campaign',
          'name','Manual Invalid','provenance','manual','sourcePlatform','Manual',
          'lawfulBasis','unsupported','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-erase',
          'campaignId','manual-campaign',
          'name','Manual Erase','provenance','manual','sourcePlatform','Manual',
          'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-race-attest',
          'campaignId','manual-campaign',
          'name','Manual Race Attest','provenance','manual','sourcePlatform','Manual',
          'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','github-race-add',
          'campaignId','d1000000-0000-4000-8000-000000000001',
          'name','GitHub Race Add','provenance','github','sourcePlatform','GitHub'
        )
      )
    )
  );
  insert into public.workspace_state(workspace_id,state) values (
    'c2222222-2222-4222-8222-222222222222',
    jsonb_build_object('campaigns','[]'::jsonb,'candidates','[]'::jsonb)
  );
  insert into public.workspace_state(workspace_id,state) values (
    'c3333333-3333-4333-8333-333333333333',
    jsonb_build_object(
      'campaigns','[]'::jsonb,
      'candidates',jsonb_build_array(
        jsonb_build_object(
          'id','manual-invalid-shape','campaignId','manual-campaign',
          'name','Manual Invalid Shape','provenance','manual',
          'sourcePlatform','Manual','lawfulBasis','consent',
          'lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-missing-provenance','campaignId','manual-campaign',
          'name','Manual Missing Provenance','sourcePlatform','Manual',
          'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-missing-platform','campaignId','manual-campaign',
          'name','Manual Missing Platform','provenance','manual',
          'lawfulBasis','consent','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-missing-basis','campaignId','manual-campaign',
          'name','Manual Missing Basis','provenance','manual',
          'sourcePlatform','Manual','lawfulBasisRecordedAt',basis_text,
          'lawfulBasisSource','operator_selection'
        ),
        jsonb_build_object(
          'id','manual-missing-basis-source','campaignId','manual-campaign',
          'name','Manual Missing Basis Source','provenance','manual',
          'sourcePlatform','Manual','lawfulBasis','consent',
          'lawfulBasisRecordedAt',basis_text
        )
      )
    )
  );
end
$fixture$;

insert into public.requisitions(
  id,workspace_id,source_kind,source_ref,status,campaign_id,
  parsed_job_analysis,parse_input_sha256,parse_result_sha256
) values
  ('d1100000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111','api','evidence-req-a',
   'campaign_created','d1000000-0000-4000-8000-000000000001',
   '{"title":"Evidence role","requiredSkills":["verification"]}',
   repeat('1',64),repeat('2',64)),
  ('d2100000-0000-4000-8000-000000000001',
   'c2222222-2222-4222-8222-222222222222','api','evidence-req-b',
   'campaign_created','d2000000-0000-4000-8000-000000000001',
   '{"title":"Foreign role","requiredSkills":["verification"]}',
   repeat('3',64),repeat('4',64));

insert into public.sourcing_campaigns(
  id,workspace_id,requisition_id,activation_actor_id,status,role_basis,
  parse_input_sha256,parse_result_sha256,campaign_sha256
) values
  ('d1000000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111',
   'd1100000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001','sourcing',
   '{"title":"Evidence role","skills":["verification"]}',
   repeat('1',64),repeat('2',64),repeat('a',64)),
  ('d2000000-0000-4000-8000-000000000001',
   'c2222222-2222-4222-8222-222222222222',
   'd2100000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000001','sourcing',
   '{"title":"Foreign role","skills":["verification"]}',
   repeat('3',64),repeat('4',64),repeat('b',64));

insert into public.api_keys(
  id,workspace_id,name,provider,secret,last4,status,last_tested_at,created_by,
  verification_method,verification_http_status
) values
  ('d1200000-0000-4000-8000-000000000001',
   'c1111111-1111-4111-8111-111111111111',
   'Disposable Tavily authority','Tavily','disposable-test-value','test','valid',
   clock_timestamp(),'c1000000-0000-4000-8000-000000000001',
   'tavily_key_info_v1',200),
  ('d2200000-0000-4000-8000-000000000001',
   'c2222222-2222-4222-8222-222222222222',
   'Disposable foreign Tavily authority','Tavily','disposable-test-value','test','valid',
   clock_timestamp(),'c2000000-0000-4000-8000-000000000001',
   'tavily_key_info_v1',200);

insert into public.candidate_lists(id,workspace_id,name,created_by) values
  ('e1111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111',
   'Evidence list A1','c1000000-0000-4000-8000-000000000001'),
  ('e1111111-1111-4111-8111-111111111112',
   'c1111111-1111-4111-8111-111111111111',
   'Evidence list A2','c1000000-0000-4000-8000-000000000001'),
  ('e2222222-2222-4222-8222-222222222222',
   'c2222222-2222-4222-8222-222222222222',
   'Evidence list B','c2000000-0000-4000-8000-000000000001'),
  ('e3333333-3333-4333-8333-333333333333',
   'c3333333-3333-4333-8333-333333333333',
   'Evidence list C','c3000000-0000-4000-8000-000000000001');

create function candidate_list_evidence_test.seed_github_attempt(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_attempt_status text,
  p_with_receipt boolean,
  p_candidate_count integer
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  payload_value jsonb;
  query_value jsonb;
begin
  payload_value := jsonb_build_object(
    'campaign_id',p_campaign_id,'campaign_sha256',repeat('a',64),'batch_ordinal',0
  );
  query_value := jsonb_build_object(
    'policyVersion','github-code-search-v1','value','language:typescript',
    'page',1,'sha256',repeat('c',64)
  );
  insert into public.aria_jobs(
    id,workspace_id,kind,idempotency_key,payload,payload_sha256,status,
    attempt_count,max_attempts,next_run_at,result_sha256
  ) values (
    p_job_id,p_workspace_id,'sourcing_batch','evidence:' || p_job_id::text,
    payload_value,encode(sha256(convert_to(payload_value::text,'UTF8')),'hex'),
    'succeeded',1,4,clock_timestamp(),repeat('d',64)
  );
  insert into public.sourcing_batch_egress_attempts(
    id,job_id,workspace_id,campaign_id,campaign_sha256,batch_ordinal,
    lease_id,claim_token,fence_version,provider,provider_mode,
    canonical_query_sha256,status,result_sha256,candidate_count,query_count,
    begun_at,settled_at
  ) values (
    p_attempt_id,p_job_id,p_workspace_id,p_campaign_id,repeat('a',64),0,
    p_job_id,p_attempt_id,1,'github','authenticated',repeat('c',64),
    p_attempt_status,
    case when p_attempt_status = 'completed' then repeat('d',64) end,
    case when p_attempt_status = 'completed' then p_candidate_count end,
    case when p_attempt_status = 'completed' then 1 end,
    clock_timestamp() - interval '2 minutes',
    case when p_attempt_status = 'completed'
      then clock_timestamp() - interval '1 minute' end
  );
  if p_with_receipt then
    insert into public.sourcing_batch_receipts(
      job_id,lease_id,workspace_id,campaign_id,campaign_sha256,batch_ordinal,
      claim_token,fence_version,egress_attempt_id,provider_mode,
      canonical_query_sha256,canonical_query,result_sha256,candidate_count,
      query_count,completed_at
    ) values (
      p_job_id,p_job_id,p_workspace_id,p_campaign_id,repeat('a',64),0,
      p_attempt_id,1,p_attempt_id,'authenticated',repeat('c',64),query_value,
      repeat('d',64),p_candidate_count,1,clock_timestamp() - interval '1 minute'
    );
  end if;
end
$$;

create function candidate_list_evidence_test.seed_tavily_attempt(
  p_workspace_id uuid,
  p_requisition_id uuid,
  p_campaign_id uuid,
  p_credential_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_with_receipt boolean,
  p_candidate_count integer
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  payload_value jsonb;
  query_value jsonb;
  authorized_time timestamptz := clock_timestamp() - interval '3 minutes';
  begun_time timestamptz := clock_timestamp() - interval '2 minutes';
begin
  payload_value := jsonb_build_object(
    'campaign_id',p_campaign_id,'campaign_sha256',repeat('a',64),'batch_ordinal',0
  );
  query_value := jsonb_build_object(
    'policyVersion','tavily-linkedin-deterministic-v1',
    'value','site:linkedin.com/in evidence role',
    'maxResults',5,
    'includeDomains',jsonb_build_array('linkedin.com'),
    'searchDepth','advanced',
    'sha256',repeat('e',64)
  );
  insert into public.aria_jobs(
    id,workspace_id,kind,idempotency_key,payload,payload_sha256,status,
    attempt_count,max_attempts,next_run_at,result_sha256
  ) values (
    p_job_id,p_workspace_id,'sourcing_batch','evidence:' || p_job_id::text,
    payload_value,encode(sha256(convert_to(payload_value::text,'UTF8')),'hex'),
    'succeeded',1,4,clock_timestamp(),repeat('f',64)
  );
  insert into public.autonomous_web_sourcing_claims(
    job_id,lease_id,workspace_id,requisition_id,campaign_id,campaign_sha256,
    batch_ordinal,claim_token,fence_version,provider,credential_id,
    credential_version,credential_verified_at,query_policy_version,
    canonical_query,canonical_query_sha256,request_sha256,role_basis_sha256,
    authorized_at,expires_at
  ) values (
    p_job_id,p_job_id,p_workspace_id,p_requisition_id,p_campaign_id,
    repeat('a',64),0,p_attempt_id,1,'tavily',p_credential_id,repeat('9',64),
    clock_timestamp() - interval '1 hour',
    'tavily-linkedin-deterministic-v1',query_value,repeat('e',64),
    repeat('8',64),repeat('7',64),
    authorized_time,
    authorized_time + interval '2 minutes'
  );
  insert into public.autonomous_web_sourcing_attempts(
    id,job_id,lease_id,workspace_id,requisition_id,campaign_id,claim_token,
    fence_version,provider,credential_id,credential_version,
    query_policy_version,canonical_query_sha256,request_sha256,
    begun_at,egress_expires_at
  ) values (
    p_attempt_id,p_job_id,p_job_id,p_workspace_id,p_requisition_id,p_campaign_id,
    p_attempt_id,1,'tavily',p_credential_id,repeat('9',64),
    'tavily-linkedin-deterministic-v1',repeat('e',64),repeat('8',64),
    begun_time,
    begun_time + interval '30 seconds'
  );
  if p_with_receipt then
    insert into public.autonomous_web_sourcing_receipts(
      job_id,lease_id,workspace_id,requisition_id,campaign_id,claim_token,
      fence_version,egress_attempt_id,canonical_query_sha256,canonical_query,
      result_sha256,candidate_count,completed_at
    ) values (
      p_job_id,p_job_id,p_workspace_id,p_requisition_id,p_campaign_id,
      p_attempt_id,1,p_attempt_id,repeat('e',64),query_value,repeat('f',64),
      p_candidate_count,clock_timestamp() - interval '1 minute'
    );
  end if;
end
$$;

select candidate_list_evidence_test.seed_github_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'f1100000-0000-4000-8000-000000000001','completed',true,3
);
select candidate_list_evidence_test.seed_github_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000002',
  'f1100000-0000-4000-8000-000000000002','completed',false,1
);
select candidate_list_evidence_test.seed_github_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000003',
  'f1100000-0000-4000-8000-000000000003','begun',true,1
);
select candidate_list_evidence_test.seed_github_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000004',
  'f1100000-0000-4000-8000-000000000004','completed',true,2
);
select candidate_list_evidence_test.seed_github_attempt(
  'c2222222-2222-4222-8222-222222222222',
  'd2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000001','completed',true,1
);

insert into public.sourcing_candidate_evidence(
  workspace_id,campaign_id,candidate_id,job_id,egress_attempt_id,provider,
  provider_external_id,github_url,raw_response_sha256,
  normalized_payload_sha256,evidence,observed_at
) values
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-11111111111111111111111111111111',
   'f1000000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001',
   'github','101','https://github.com/evidence-good',repeat('1',64),repeat('2',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-22222222222222222222222222222222',
   'f1000000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001',
   'github','102','https://github.com/evidence-mixed',repeat('3',64),repeat('4',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-55555555555555555555555555555555',
   'f1000000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001',
   'github','103','https://github.com/evidence-missing-canonical',repeat('5',64),repeat('6',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-33333333333333333333333333333333',
   'f1000000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000002',
   'github','104','https://github.com/evidence-no-receipt',repeat('7',64),repeat('8',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-44444444444444444444444444444444',
   'f1000000-0000-4000-8000-000000000003','f1100000-0000-4000-8000-000000000003',
   'github','105','https://github.com/evidence-begun',repeat('9',64),repeat('a',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-66666666666666666666666666666666',
   'f1000000-0000-4000-8000-000000000004','f1100000-0000-4000-8000-000000000004',
   'github','106','https://github.com/evidence-duplicate',repeat('b',64),repeat('c',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-race-add',
   'f1000000-0000-4000-8000-000000000004','f1100000-0000-4000-8000-000000000004',
   'github','107','https://github.com/evidence-race',repeat('d',64),repeat('e',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'github-77777777777777777777777777777777',
   'f2000000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001',
   'github','108','https://github.com/evidence-mismatch',repeat('f',64),repeat('0',64),
   '{"source":"synthetic"}',clock_timestamp() - interval '1 minute');

select candidate_list_evidence_test.seed_tavily_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001',
  'f3100000-0000-4000-8000-000000000001',true,3
);
select candidate_list_evidence_test.seed_tavily_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000002',
  'f3100000-0000-4000-8000-000000000002',false,1
);

insert into public.autonomous_web_candidate_evidence(
  workspace_id,campaign_id,candidate_id,egress_attempt_id,provider,
  provider_external_id,linkedin_url,canonical_query_sha256,
  raw_response_sha256,provider_result_sha256,normalized_payload_sha256,
  role_evidence,recorded_at,expires_at
) values
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'linkedin-11111111111111111111111111111111',
   'f3100000-0000-4000-8000-000000000001','tavily',repeat('1',64),
   'https://www.linkedin.com/in/evidence-good',repeat('e',64),repeat('1',64),
   repeat('2',64),repeat('3',64),'{"source":"synthetic"}',
   clock_timestamp() - interval '1 minute',clock_timestamp() + interval '1 day'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'linkedin-33333333333333333333333333333333',
   'f3100000-0000-4000-8000-000000000001','tavily',repeat('3',64),
   'https://www.linkedin.com/in/evidence-expired',repeat('e',64),repeat('7',64),
   repeat('8',64),repeat('9',64),'{"source":"synthetic"}',
   clock_timestamp() - interval '2 days',clock_timestamp() - interval '1 second'),
  ('c1111111-1111-4111-8111-111111111111','d1000000-0000-4000-8000-000000000001',
   'linkedin-44444444444444444444444444444444',
   'f3100000-0000-4000-8000-000000000002','tavily',repeat('4',64),
   'https://www.linkedin.com/in/evidence-no-receipt',repeat('e',64),repeat('a',64),
   repeat('b',64),repeat('c',64),'{"source":"synthetic"}',
   clock_timestamp() - interval '1 minute',clock_timestamp() + interval '1 day');

-- Deleting the shadow rows must not affect canonical authority or provider
-- evidence. These candidates are admitted below with the mirror absent.
delete from public.candidates
 where workspace_id = 'c1111111-1111-4111-8111-111111111111'
   and (campaign_id,id) in (
     ('d1000000-0000-4000-8000-000000000001','github-11111111111111111111111111111111'),
     ('d1000000-0000-4000-8000-000000000001','linkedin-11111111111111111111111111111111'),
     ('manual-campaign','manual-consent')
   );
SQL

if psql_stdin --single-transaction --set VERBOSITY=verbose \
  < "$migration" > "$tmp_dir/legacy-preflight.log" 2>&1; then
  echo "candidate-list-evidence-db: 0065 accepted an erasure-incompatible legacy campaign id" >&2
  exit 1
fi
grep -Eiq '55000|legacy|campaign|refus' "$tmp_dir/legacy-preflight.log"

preflight_unchanged="$(psql_stdin -Atq -c "
  select (
    to_regprocedure(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'
    ) is null
    and not exists (
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
    and exists (
      select 1 from public.candidate_list_members
       where campaign_id = 'invalid campaign id'
         and candidate_id = 'legacy-invalid'
    )
  )::text
")"
if [[ "$preflight_unchanged" != "true" ]]; then
  echo "candidate-list-evidence-db: failed 0065 preflight partially mutated 0064 authority" >&2
  exit 1
fi

# Cascaded workspace deletion is the governed fixture cleanup path accepted by
# the 0064 append-only trigger. Remove the auth identity afterward.
psql_stdin -q <<'SQL'
delete from public.workspaces
 where id = 'a1111111-1111-4111-8111-111111111111';
delete from auth.users
 where id = 'a1000000-0000-4000-8000-000000000001';
SQL

# 0064 create_candidate_list acquires a RowShare table lock on receipts before
# it needs RowExclusive on candidate_lists. The 0065 preflight must preserve
# that order. This FIFO holds the create-side transaction after the receipts
# lock, starts the actual migration, proves it is queued at receipts without a
# list lock, then lets both transactions drain without a deadlock.
migration_lock_fifo="$tmp_dir/create-list-migration-lock.fifo"
mkfifo "$migration_lock_fifo"
PGAPPNAME='candidate-list-evidence-create-lock' \
  psql_stdin -q < "$migration_lock_fifo" \
  > "$tmp_dir/create-list-migration-create.log" 2>&1 &
race_pid_1=$!
exec 9>"$migration_lock_fifo"
printf '%s\n' \
  '\set ON_ERROR_STOP on' \
  'begin;' \
  'lock table public.candidate_list_operation_receipts in row share mode;' >&9

create_lock_pid=""
for _ in {1..100}; do
  create_lock_pid="$(psql_stdin -Atq -c "
    select activity.pid
      from pg_stat_activity activity
      join pg_locks held
        on held.pid = activity.pid
       and held.relation = 'public.candidate_list_operation_receipts'::regclass
       and held.mode = 'RowShareLock'
       and held.granted
     where activity.application_name = 'candidate-list-evidence-create-lock'
     limit 1
  ")"
  [[ -n "$create_lock_pid" ]] && break
  sleep 0.05
done
if [[ -z "$create_lock_pid" ]]; then
  echo "candidate-list-evidence-db: create-side receipts lock was not acquired" >&2
  exit 1
fi

PGAPPNAME='candidate-list-evidence-migration-lock' \
  psql_stdin -q < "$migration" \
  > "$tmp_dir/create-list-migration-forward.log" 2>&1 &
race_pid_2=$!

migration_lock_pid=""
migration_lock_state=""
for _ in {1..200}; do
  migration_lock_pid="$(psql_stdin -Atq -c "
    select pid
      from pg_stat_activity
     where application_name = 'candidate-list-evidence-migration-lock'
     limit 1
  ")"
  if [[ -n "$migration_lock_pid" ]]; then
    migration_lock_state="$(psql_stdin -Atq -c "
      select concat(
        exists (
          select 1 from pg_locks
           where pid = ${migration_lock_pid}
             and relation = 'public.candidate_list_operation_receipts'::regclass
             and mode = 'AccessExclusiveLock'
             and not granted
        )::text,
        ':',
        exists (
          select 1 from pg_locks
           where pid = ${migration_lock_pid}
             and relation = 'public.candidate_lists'::regclass
             and granted
             and mode in ('ShareLock','AccessExclusiveLock')
        )::text
      )
    ")"
    [[ "$migration_lock_state" == "true:false" ]] && break
  fi
  sleep 0.05
done
if [[ "$migration_lock_state" != "true:false" ]]; then
  echo "candidate-list-evidence-db: 0065 did not wait at receipts before locking candidate_lists (state=${migration_lock_state:-missing})" >&2
  exit 1
fi

printf '%s\n' \
  'lock table public.candidate_lists in row exclusive mode;' \
  'commit;' >&9
exec 9>&-

set +e
wait "$race_pid_1"
create_lock_rc=$?
wait "$race_pid_2"
migration_lock_rc=$?
set -e
race_pid_1=""
race_pid_2=""

if [[ "$create_lock_rc" -ne 0 || "$migration_lock_rc" -ne 0 ]] \
   || grep -Eiq '40P01|deadlock detected' \
      "$tmp_dir/create-list-migration-create.log" \
      "$tmp_dir/create-list-migration-forward.log"; then
  echo "candidate-list-evidence-db: create-list and 0065 preflight lock order deadlocked" >&2
  sed -n '1,120p' "$tmp_dir/create-list-migration-create.log" >&2
  sed -n '1,160p' "$tmp_dir/create-list-migration-forward.log" >&2
  exit 1
fi

if [[ "$(psql_stdin -Atq -c "select (
  to_regprocedure(
    'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'
  ) is not null
)::text")" != "true" ]]; then
  echo "candidate-list-evidence-db: deadlock regression did not complete the actual 0065 migration" >&2
  exit 1
fi

# Return to the exact 0064 surface so the existing empty forward/rollback
# reconciliation matrix remains independent of this concurrency proof.
psql_stdin -q < "$rollback"

# Empty forward, rollback, rollback retry, and two forward applies prove the
# deployment reconciliation paths before any 0065 evidence exists.
psql_stdin --single-transaction -q < "$migration"
psql_stdin -q < "$rollback"

empty_rollback_restored="$(psql_stdin -Atq -c "
  select (
    to_regprocedure(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'
    ) is null
    and not exists (
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname in ('evidence_provider_attempt_id','evidence_expires_at')
         and not attisdropped
    )
    and exists (
      select 1 from pg_constraint
       where conrelid = 'public.candidate_list_members'::regclass
         and confrelid = 'public.candidates'::regclass
         and contype = 'f'
    )
    and position(
      'public.candidates' in
      pg_get_functiondef(
        'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
      )
    ) > 0
  )::text
")"
if [[ "$empty_rollback_restored" != "true" ]]; then
  echo "candidate-list-evidence-db: empty 0065 rollback did not restore actual 0064 behavior" >&2
  exit 1
fi
psql_stdin -q < "$rollback"
psql_stdin --single-transaction -q < "$migration"
psql_stdin --single-transaction -q < "$migration"

# Compatible 0064 data must survive an upgrade. Roll back to 0064, insert one
# exact legacy member, then reapply 0065 and retain it as a characterization
# fixture proving that legacy evidence is preserved but not promoted.
psql_stdin -q < "$rollback"
psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','legacy-evidence@example.test','',now(),
  '{}','{}',now(),now()
);
insert into public.workspaces(id,name,allowed_domain) values
  ('b1111111-1111-4111-8111-111111111111','Legacy evidence','legacy-evidence.example.test');
insert into public.profiles(id,email,full_name,workspace_id,role) values
  ('b1000000-0000-4000-8000-000000000001','legacy-evidence@example.test',
   'Legacy Evidence','b1111111-1111-4111-8111-111111111111','admin');
insert into public.workspace_state(workspace_id,state) values (
  'b1111111-1111-4111-8111-111111111111',
  '{"candidates":[{"id":"legacy-valid","campaignId":"legacy-campaign","name":"Legacy Valid","provenance":"manual"}]}'
);
insert into public.candidate_lists(
  id,workspace_id,name,created_by
) values (
  'b1222222-2222-4222-8222-222222222222',
  'b1111111-1111-4111-8111-111111111111',
  'Legacy list','b1000000-0000-4000-8000-000000000001'
);
insert into public.candidate_contact_attestations(
  workspace_id,campaign_id,candidate_id,attestation_kind,value_code,
  evidence_sha256,recorded_by,recorded_at
) values (
  'b1111111-1111-4111-8111-111111111111','legacy-campaign',
  'legacy-valid','manual_provenance','operator_verified',repeat('b',64),
  'b1000000-0000-4000-8000-000000000001','2026-07-25 10:00:00+00'
);
insert into public.candidate_list_members(
  workspace_id,list_id,campaign_id,candidate_id,evidence_kind,
  evidence_attestation_id,evidence_sha256,evidence_recorded_at,added_by
) select
  'b1111111-1111-4111-8111-111111111111',
  'b1222222-2222-4222-8222-222222222222',
  'legacy-campaign','legacy-valid','manual_attestation',
  attestation.id,attestation.evidence_sha256,attestation.recorded_at,
  'b1000000-0000-4000-8000-000000000001'
from public.candidate_contact_attestations attestation
where attestation.workspace_id = 'b1111111-1111-4111-8111-111111111111';
SQL

legacy_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'attestations',(select count(*) from public.candidate_contact_attestations),
    'members',(select count(*) from public.candidate_list_members)
  )::text
")"
psql_stdin --single-transaction -q < "$migration"
legacy_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'attestations',(select count(*) from public.candidate_contact_attestations),
    'members',(select count(*) from public.candidate_list_members)
  )::text
")"
if [[ "$legacy_after" != "$legacy_before" ]]; then
  echo "candidate-list-evidence-db: 0065 changed compatible 0064 row counts" >&2
  exit 1
fi

# Production migration history is append-only. A synthetic ledger entry for
# 0065 must make rollback fail before mutation; after removing the synthetic
# ledger entirely, the same safe legacy fixture must round-trip through the
# exact 0064 rollback and 0065 forward migration.
ledgerless_roundtrip_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'canonicalGuard',md5(pg_get_functiondef(
      'public.guard_candidate_list_canonical_authority()'::regprocedure
    )),
    'providerCleanup',md5(pg_get_functiondef(
      'public.cleanup_sourcing_candidate_evidence()'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    ),
    'legacyAttestations',(
      select count(*) from public.candidate_contact_attestations
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    ),
    'legacyMembers',(
      select count(*) from public.candidate_list_members
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    )
  )::text
")"

psql_stdin -q <<'SQL'
create table public.aria_schema_migrations(
  filename text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
insert into public.aria_schema_migrations(filename,sha256)
values ('0065_candidate_list_evidence_authority.sql',repeat('6',64));
SQL

ledgered_rollback_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'ledger',(
      select jsonb_agg(
        jsonb_build_object('filename',filename,'sha256',sha256)
        order by filename
      ) from public.aria_schema_migrations
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'canonicalGuard',md5(pg_get_functiondef(
      'public.guard_candidate_list_canonical_authority()'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    ),
    'legacyAttestations',(
      select count(*) from public.candidate_contact_attestations
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    ),
    'legacyMembers',(
      select count(*) from public.candidate_list_members
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    )
  )::text
")"

if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/ledgered-rollback.log" 2>&1; then
  echo "candidate-list-evidence-db: rollback accepted a ledgered 0065" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:.*refusing ledgered 0065 rollback' \
  "$tmp_dir/ledgered-rollback.log"

ledgered_rollback_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'ledger',(
      select jsonb_agg(
        jsonb_build_object('filename',filename,'sha256',sha256)
        order by filename
      ) from public.aria_schema_migrations
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'canonicalGuard',md5(pg_get_functiondef(
      'public.guard_candidate_list_canonical_authority()'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    ),
    'legacyAttestations',(
      select count(*) from public.candidate_contact_attestations
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    ),
    'legacyMembers',(
      select count(*) from public.candidate_list_members
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    )
  )::text
")"

if [[ "$ledgered_rollback_after" != "$ledgered_rollback_before" ]]; then
  echo "candidate-list-evidence-db: refused ledgered rollback partially mutated 0065" >&2
  exit 1
fi

psql_stdin -q -c 'drop table public.aria_schema_migrations'
psql_stdin -q < "$rollback"

ledgerless_0064_restored="$(psql_stdin -Atq -c "
  select (
    to_regprocedure(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'
    ) is null
    and not exists (
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
    and exists (
      select 1 from pg_constraint
       where conrelid = 'public.candidate_list_members'::regclass
         and confrelid = 'public.candidates'::regclass
         and contype = 'f'
    )
    and (select count(*) = 1
           from public.candidate_contact_attestations
          where workspace_id = 'b1111111-1111-4111-8111-111111111111')
    and (select count(*) = 1
           from public.candidate_list_members
          where workspace_id = 'b1111111-1111-4111-8111-111111111111')
  )::text
")"
if [[ "$ledgerless_0064_restored" != "true" ]]; then
  echo "candidate-list-evidence-db: ledgerless rollback did not restore exact 0064 authority" >&2
  exit 1
fi

psql_stdin --single-transaction -q < "$migration"
ledgerless_roundtrip_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'canonicalGuard',md5(pg_get_functiondef(
      'public.guard_candidate_list_canonical_authority()'::regprocedure
    )),
    'providerCleanup',md5(pg_get_functiondef(
      'public.cleanup_sourcing_candidate_evidence()'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    ),
    'legacyAttestations',(
      select count(*) from public.candidate_contact_attestations
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    ),
    'legacyMembers',(
      select count(*) from public.candidate_list_members
       where workspace_id = 'b1111111-1111-4111-8111-111111111111'
    )
  )::text
")"
if [[ "$ledgerless_roundtrip_after" != "$ledgerless_roundtrip_before" ]]; then
  echo "candidate-list-evidence-db: ledgerless rollback/reapply changed 0065 authority" >&2
  exit 1
fi

# A forward retry owns only the exact 0064 constraints it replaces. Simulate a
# later migration attaching an independent mirror FK and receipt CHECK whose
# definitions resemble those 0064 controls; reapplying 0065 must preserve both
# byte-for-byte rather than wildcard-dropping them.
psql_stdin -q <<'SQL'
alter table public.candidate_list_members
  add constraint candidate_list_evidence_test_later_candidate_fkey
  foreign key (workspace_id,campaign_id,candidate_id)
  references public.candidates(workspace_id,campaign_id,id)
  on delete cascade
  not valid;

alter table public.candidate_list_operation_receipts
  add constraint candidate_list_evidence_test_later_operation_kind_check
  check (operation_kind <> '')
  not valid;
SQL

later_forward_controls_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'candidateFk',(
      select pg_get_constraintdef(constraint_metadata.oid)
        from pg_constraint constraint_metadata
       where constraint_metadata.conrelid =
               'public.candidate_list_members'::regclass
         and constraint_metadata.conname =
               'candidate_list_evidence_test_later_candidate_fkey'
    ),
    'operationCheck',(
      select pg_get_constraintdef(constraint_metadata.oid)
        from pg_constraint constraint_metadata
       where constraint_metadata.conrelid =
               'public.candidate_list_operation_receipts'::regclass
         and constraint_metadata.conname =
               'candidate_list_evidence_test_later_operation_kind_check'
    )
  )::text
")"

psql_stdin --single-transaction -q < "$migration"

later_forward_controls_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'candidateFk',(
      select pg_get_constraintdef(constraint_metadata.oid)
        from pg_constraint constraint_metadata
       where constraint_metadata.conrelid =
               'public.candidate_list_members'::regclass
         and constraint_metadata.conname =
               'candidate_list_evidence_test_later_candidate_fkey'
    ),
    'operationCheck',(
      select pg_get_constraintdef(constraint_metadata.oid)
        from pg_constraint constraint_metadata
       where constraint_metadata.conrelid =
               'public.candidate_list_operation_receipts'::regclass
         and constraint_metadata.conname =
               'candidate_list_evidence_test_later_operation_kind_check'
    )
  )::text
")"

if [[ "$later_forward_controls_after" != "$later_forward_controls_before" ]]; then
  echo "candidate-list-evidence-db: 0065 retry changed independent later constraints" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
alter table public.candidate_list_members
  drop constraint candidate_list_evidence_test_later_candidate_fkey;
alter table public.candidate_list_operation_receipts
  drop constraint candidate_list_evidence_test_later_operation_kind_check;
SQL

# Rollback is intentionally stricter than forward retry: an unknown trigger or
# index may encode a later migration's behavior, so 0065 must refuse before
# changing either that object or any part of its own authority surface.
psql_stdin -q <<'SQL'
create function candidate_list_evidence_test.later_member_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  return new;
end
$$;

create trigger candidate_list_evidence_test_later_member_trigger
before insert on public.candidate_list_members
for each row execute function candidate_list_evidence_test.later_member_trigger();
SQL

later_trigger_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'trigger',(
      select pg_get_triggerdef(trigger_metadata.oid)
        from pg_trigger trigger_metadata
       where trigger_metadata.tgrelid =
               'public.candidate_list_members'::regclass
         and trigger_metadata.tgname =
               'candidate_list_evidence_test_later_member_trigger'
         and not trigger_metadata.tgisinternal
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
  )::text
")"

if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/later-trigger-rollback.log" 2>&1; then
  echo "candidate-list-evidence-db: rollback erased a synthetic later trigger" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:.*later triggers' \
  "$tmp_dir/later-trigger-rollback.log"

later_trigger_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'trigger',(
      select pg_get_triggerdef(trigger_metadata.oid)
        from pg_trigger trigger_metadata
       where trigger_metadata.tgrelid =
               'public.candidate_list_members'::regclass
         and trigger_metadata.tgname =
               'candidate_list_evidence_test_later_member_trigger'
         and not trigger_metadata.tgisinternal
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
  )::text
")"
if [[ "$later_trigger_after" != "$later_trigger_before" ]]; then
  echo "candidate-list-evidence-db: refused later-trigger rollback partially mutated 0065" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
drop trigger candidate_list_evidence_test_later_member_trigger
  on public.candidate_list_members;
drop function candidate_list_evidence_test.later_member_trigger();

create index candidate_list_evidence_test_later_member_index
  on public.candidate_list_members(candidate_id);
SQL

later_index_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'index',pg_get_indexdef(
      'public.candidate_list_evidence_test_later_member_index'::regclass
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
  )::text
")"

if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/later-index-rollback.log" 2>&1; then
  echo "candidate-list-evidence-db: rollback erased a synthetic later index" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:.*later indexes' \
  "$tmp_dir/later-index-rollback.log"

later_index_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'index',pg_get_indexdef(
      'public.candidate_list_evidence_test_later_member_index'::regclass
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
  )::text
")"
if [[ "$later_index_after" != "$later_index_before" ]]; then
  echo "candidate-list-evidence-db: refused later-index rollback partially mutated 0065" >&2
  exit 1
fi

psql_stdin -q -c \
  'drop index public.candidate_list_evidence_test_later_member_index'

# A later migration may attach a control to a 0065-owned table. The 0065
# rollback must detect that unknown catalog object before any DDL, preserve it,
# and leave the complete 0065 surface byte-for-byte unchanged.
psql_stdin -q <<'SQL'
alter table public.candidate_list_members
  add constraint candidate_list_evidence_test_later_constraint check (true)
  not valid;
SQL

later_catalog_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'constraint',(
      select pg_get_constraintdef(constraint_metadata.oid)
        from pg_constraint constraint_metadata
       where constraint_metadata.conrelid =
               'public.candidate_list_members'::regclass
         and constraint_metadata.conname =
               'candidate_list_evidence_test_later_constraint'
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
  )::text
")"

if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/later-catalog-rollback.log" 2>&1; then
  echo "candidate-list-evidence-db: rollback erased a synthetic later constraint" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:.*later constraints' \
  "$tmp_dir/later-catalog-rollback.log"

later_catalog_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'constraint',(
      select pg_get_constraintdef(constraint_metadata.oid)
        from pg_constraint constraint_metadata
       where constraint_metadata.conrelid =
               'public.candidate_list_members'::regclass
         and constraint_metadata.conname =
               'candidate_list_evidence_test_later_constraint'
    ),
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'providerColumn',exists(
      select 1 from pg_attribute
       where attrelid = 'public.candidate_list_members'::regclass
         and attname = 'evidence_provider_attempt_id'
         and not attisdropped
    )
  )::text
")"
if [[ "$later_catalog_after" != "$later_catalog_before" ]]; then
  echo "candidate-list-evidence-db: refused later-object rollback partially mutated 0065" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
alter table public.candidate_list_members
  drop constraint candidate_list_evidence_test_later_constraint;
SQL

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on
create schema if not exists candidate_list_evidence_test;

create table candidate_list_evidence_test.results(
  case_name text primary key,
  passed boolean not null,
  detail text
);

create table candidate_list_evidence_test.outputs(
  case_name text primary key,
  output jsonb not null
);

create function candidate_list_evidence_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, candidate_list_evidence_test
as $$
begin
  insert into candidate_list_evidence_test.results(case_name,passed,detail)
  values (p_case_name,p_passed,p_detail);
end;
$$;

create function candidate_list_evidence_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, candidate_list_evidence_test
as $$
declare caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform candidate_list_evidence_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s',caught,p_expected_codes::text)
    );
    return;
  end;
  perform candidate_list_evidence_test.expect(
    p_case_name,false,'statement unexpectedly succeeded'
  );
end;
$$;

create function candidate_list_evidence_test.set_claims(
  p_subject uuid,
  p_role text
) returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',p_subject,'role',p_role)::text,
    false
  );
  perform set_config('request.jwt.claim.sub',coalesce(p_subject::text,''),false);
  perform set_config('request.jwt.claim.role',p_role,false);
end;
$$;

grant usage on schema candidate_list_evidence_test
  to anon, authenticated, service_role;
grant select,insert on candidate_list_evidence_test.results
  to anon, authenticated, service_role;
grant select,insert on candidate_list_evidence_test.outputs
  to authenticated, service_role;
grant execute on all functions in schema candidate_list_evidence_test
  to anon, authenticated, service_role;

select candidate_list_evidence_test.expect(
  'given_a_synthetic_0065_ledger_entry_when_rollback_is_attempted_then_55000_refuses_atomically_but_ledgerless_rollback_and_reapply_round_trip_exactly',
  true
);

select candidate_list_evidence_test.expect(
  'given_independent_later_fk_and_check_controls_when_0065_is_reapplied_then_both_controls_are_preserved_byte_for_byte',
  true
);

select candidate_list_evidence_test.expect(
  'given_a_synthetic_later_trigger_when_0065_rollback_is_attempted_then_55000_refuses_atomically_and_preserves_the_unknown_trigger',
  true
);

select candidate_list_evidence_test.expect(
  'given_a_synthetic_later_index_when_0065_rollback_is_attempted_then_55000_refuses_atomically_and_preserves_the_unknown_index',
  true
);

select candidate_list_evidence_test.expect(
  'given_a_synthetic_later_constraint_when_0065_rollback_is_attempted_then_55000_refuses_atomically_and_preserves_the_unknown_catalog_object',
  true
);

select candidate_list_evidence_test.expect(
  'given_compatible_0064_rows_when_0065_is_applied_then_legacy_membership_and_attestation_are_preserved',
  (select count(*) = 1
     from public.candidate_list_members
    where workspace_id = 'b1111111-1111-4111-8111-111111111111'
      and campaign_id = 'legacy-campaign'
      and candidate_id = 'legacy-valid')
  and
  (select authority_version = 'legacy-v1'
     from public.candidate_contact_attestations
    where workspace_id = 'b1111111-1111-4111-8111-111111111111'
      and campaign_id = 'legacy-campaign'
      and candidate_id = 'legacy-valid')
);

select candidate_list_evidence_test.expect(
  'given_0065_schema_when_inspected_then_campaign_grammar_and_evidence_snapshot_columns_are_exact',
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.candidate_contact_attestations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid)
         like '%campaign_id ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$''%'
  )
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.candidate_list_members'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid)
         like '%campaign_id ~ ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$''%'
  )
  and exists (
    select 1 from pg_attribute
     where attrelid = 'public.candidate_contact_attestations'::regclass
       and attname = 'authority_version'
       and not attisdropped
  )
  and exists (
    select 1 from pg_attribute
     where attrelid = 'public.candidate_contact_attestations'::regclass
       and attname = 'lawful_basis_code'
       and not attisdropped
  )
  and exists (
    select 1 from pg_attribute
     where attrelid = 'public.candidate_contact_attestations'::regclass
       and attname = 'observed_at'
       and atttypid = 'timestamptz'::regtype
       and not attisdropped
  )
  and exists (
    select 1 from pg_attribute
     where attrelid = 'public.candidate_contact_attestations'::regclass
       and attname = 'supersedes_id'
       and atttypid = 'int8'::regtype
       and not attisdropped
  )
  and exists (
    select 1 from pg_attribute
     where attrelid = 'public.candidate_list_members'::regclass
       and attname = 'evidence_provider_attempt_id'
       and atttypid = 'uuid'::regtype
       and not attisdropped
  )
  and exists (
    select 1 from pg_attribute
     where attrelid = 'public.candidate_list_members'::regclass
       and attname = 'evidence_expires_at'
       and atttypid = 'timestamptz'::regtype
       and not attisdropped
  )
);

select candidate_list_evidence_test.expect(
  'given_0065_authority_when_acl_and_rls_are_inspected_then_runtime_roles_have_only_the_public_authenticated_rpcs',
  not exists (
    select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname in (
         'candidate_lists','candidate_contact_attestations',
         'candidate_list_members','candidate_list_operation_receipts'
       )
       and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  )
  and not exists (
    select 1
      from (values ('anon'),('authenticated'),('service_role'),('authenticator'))
        runtime(role_name)
      cross join (values
        ('candidate_lists'),('candidate_contact_attestations'),
        ('candidate_list_members'),('candidate_list_operation_receipts')
      ) authority(table_name)
     where has_table_privilege(
       runtime.role_name,'public.' || authority.table_name,
       'SELECT,INSERT,UPDATE,DELETE'
     )
  )
  and has_function_privilege(
    'authenticated',
    'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.add_candidate_list_member(uuid,text,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)',
    'EXECUTE'
  )
  and not exists (
    select 1
      from (values ('anon'),('service_role'),('authenticator')) runtime(role_name)
      cross join (values
        ('public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'),
        ('public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)')
      ) authority(signature)
     where has_function_privilege(runtime.role_name,authority.signature,'EXECUTE')
  )
  and not exists (
    select 1
      from (values ('anon'),('authenticated'),('service_role'),('authenticator'))
        runtime(role_name)
      cross join (values
        ('public.candidate_contact_attestations_id_seq'),
        ('public.candidate_list_operation_receipts_id_seq')
      ) authority(sequence_name)
     where has_sequence_privilege(
       runtime.role_name,authority.sequence_name,'USAGE,SELECT,UPDATE'
     )
  )
);

select candidate_list_evidence_test.expect(
  'given_candidate_bearing_writers_when_function_bodies_are_inspected_then_workspace_state_precedes_identity_and_evidence_locks',
  position(
    'from public.workspace_state' in lower(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'from public.workspace_state' in lower(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    ))
  ) < position(
    'candidate_erasure_identity_lock_key' in lower(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    ))
  )
  and position(
    'from public.workspace_state' in lower(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    ))
  ) > 0
  and position(
    'from public.workspace_state' in lower(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    ))
  ) < position(
    'candidate_erasure_identity_lock_key' in lower(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    ))
  )
);
SQL

run_behavior_tests

# ---------------------------------------------------------------------------
# Deterministic freshness-at-admission ordering. Start add while a short-lived
# Tavily row is valid, hold its first workspace-state lock until the database
# clock passes expires_at, then release it. Admission must sample time after
# the ordered locks and fail closed without a member or idempotency receipt.
# ---------------------------------------------------------------------------
psql_stdin -q <<'SQL'
update public.workspace_state workspace
   set state = jsonb_set(
     workspace.state,
     '{candidates}',
     (workspace.state -> 'candidates') || jsonb_build_array(
       jsonb_build_object(
         'id','linkedin-88888888888888888888888888888888',
         'campaignId','d1000000-0000-4000-8000-000000000001',
         'name','LinkedIn Expiry Race',
         'provenance','tavily','sourcePlatform','LinkedIn'
       )
     )
   )
 where workspace.workspace_id = 'c1111111-1111-4111-8111-111111111111';

select candidate_list_evidence_test.seed_tavily_attempt(
  'c1111111-1111-4111-8111-111111111111',
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'f6100000-0000-4000-8000-000000000001',true,1
);
SQL

tavily_expiry_add() {
  psql_stdin -q > "$tmp_dir/tavily-expiry-add.log" 2>&1 <<'SQL'
set application_name = 'candidate-list-evidence-tavily-expiry-add';
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'tavily-expiry-race-add',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111112',
  'd1000000-0000-4000-8000-000000000001',
  'linkedin-88888888888888888888888888888888',
  '05700000-0000-4000-8000-000000000001'
);
commit;
SQL
}

psql_stdin -q > "$tmp_dir/tavily-expiry-holder.log" 2>&1 <<'SQL' &
set application_name = 'candidate-list-evidence-tavily-expiry-holder';
begin;
select 1 from public.workspace_state
 where workspace_id = 'c1111111-1111-4111-8111-111111111111'
 for update;
select pg_sleep(180);
commit;
SQL
holder_pid=$!

holder_db_pid=""
for _ in $(seq 1 120); do
  holder_db_pid="$(psql_stdin -Atq -c "
    select pid from pg_stat_activity
     where application_name = 'candidate-list-evidence-tavily-expiry-holder'
       and state = 'active' and query like '%pg_sleep(180)%'
     limit 1
  ")"
  [[ -n "$holder_db_pid" ]] && break
  sleep 0.25
done
if [[ -z "$holder_db_pid" ]]; then
  echo "candidate-list-evidence-db: Tavily-expiry holder did not acquire the workspace lock" >&2
  exit 1
fi

# Start the short evidence lifetime only after the holder is confirmed, so
# container startup time cannot consume the freshness window before add begins.
psql_stdin -q <<'SQL'
insert into public.autonomous_web_candidate_evidence(
  workspace_id,campaign_id,candidate_id,egress_attempt_id,provider,
  provider_external_id,linkedin_url,canonical_query_sha256,
  raw_response_sha256,provider_result_sha256,normalized_payload_sha256,
  role_evidence,recorded_at,expires_at
) values (
  'c1111111-1111-4111-8111-111111111111',
  'd1000000-0000-4000-8000-000000000001',
  'linkedin-88888888888888888888888888888888',
  'f6100000-0000-4000-8000-000000000001','tavily',repeat('6',64),
  'https://www.linkedin.com/in/evidence-expiry-race',repeat('e',64),
  repeat('1',64),repeat('2',64),repeat('3',64),'{"source":"synthetic"}',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '15 seconds'
);
SQL

expiry_future="$(psql_stdin -Atq -c "
  select (expires_at > clock_timestamp())::text
    from public.autonomous_web_candidate_evidence
   where workspace_id = 'c1111111-1111-4111-8111-111111111111'
     and campaign_id = 'd1000000-0000-4000-8000-000000000001'
     and candidate_id = 'linkedin-88888888888888888888888888888888'
")"
if [[ "$expiry_future" != "true" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  echo "candidate-list-evidence-db: Tavily race evidence expired before add started" >&2
  exit 1
fi

tavily_expiry_add &
race_pid_1=$!

add_waiting=""
for _ in $(seq 1 120); do
  add_waiting="$(psql_stdin -Atq -c "
    select count(*) from pg_stat_activity
     where application_name = 'candidate-list-evidence-tavily-expiry-add'
       and wait_event_type = 'Lock'
       and cardinality(pg_blocking_pids(pid)) > 0
  ")"
  [[ "$add_waiting" == "1" ]] && break
  sleep 0.25
done
if [[ "$add_waiting" != "1" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  wait "$race_pid_1" || true
  echo "candidate-list-evidence-db: Tavily add did not wait on workspace authority" >&2
  exit 1
fi

blocked_before_expiry="$(psql_stdin -Atq -c "
  select (expires_at > clock_timestamp())::text
    from public.autonomous_web_candidate_evidence
   where workspace_id = 'c1111111-1111-4111-8111-111111111111'
     and campaign_id = 'd1000000-0000-4000-8000-000000000001'
     and candidate_id = 'linkedin-88888888888888888888888888888888'
")"
if [[ "$blocked_before_expiry" != "true" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  wait "$race_pid_1" || true
  echo "candidate-list-evidence-db: Tavily add was not blocked before expiry" >&2
  exit 1
fi

evidence_expired=""
for _ in $(seq 1 120); do
  evidence_expired="$(psql_stdin -Atq -c "
    select (expires_at <= clock_timestamp())::text
      from public.autonomous_web_candidate_evidence
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'd1000000-0000-4000-8000-000000000001'
       and candidate_id = 'linkedin-88888888888888888888888888888888'
  ")"
  [[ "$evidence_expired" == "true" ]] && break
  sleep 0.1
done
if [[ "$evidence_expired" != "true" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  wait "$race_pid_1" || true
  echo "candidate-list-evidence-db: Tavily evidence did not expire while add waited" >&2
  exit 1
fi

psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null
wait "$holder_pid" || true
holder_pid=""
if ! wait "$race_pid_1"; then
  cat "$tmp_dir/tavily-expiry-add.log" >&2
  exit 1
fi
race_pid_1=""

psql_stdin -q <<'SQL'
select candidate_list_evidence_test.expect(
  'given_add_starts_before_tavily_expiry_but_waits_on_workspace_authority_until_after_expiry_then_admission_is_expired_without_member_or_receipt',
  (select output = '{"status":"provenance_expired"}'::jsonb
     from candidate_list_evidence_test.outputs
    where case_name = 'tavily-expiry-race-add')
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and list_id = 'e1111111-1111-4111-8111-111111111112'
       and candidate_id = 'linkedin-88888888888888888888888888888888'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and idempotency_key = '05700000-0000-4000-8000-000000000001'
  )
);
SQL

# ---------------------------------------------------------------------------
# Deterministic mutation-before-erasure ordering. The holder owns the exact
# candidate identity lock; add reaches and waits on it while retaining the
# workspace SHARE lock, so erasure must wait behind add. Once released, the
# successful add commits first and erasure must scrub every artifact it made.
# ---------------------------------------------------------------------------
race_add_before_erasure() {
  psql_stdin -q > "$tmp_dir/add-before-erasure.log" 2>&1 <<'SQL'
set application_name = 'candidate-list-evidence-add-before-erasure';
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'race-add-before-erasure',public.add_candidate_list_member(
  'e1111111-1111-4111-8111-111111111112',
  'd1000000-0000-4000-8000-000000000001','github-race-add',
  '06000000-0000-4000-8000-000000000001'
);
commit;
SQL
}

race_erase_after_add() {
  psql_stdin -q > "$tmp_dir/erase-after-add.log" 2>&1 <<'SQL'
set application_name = 'candidate-list-evidence-erase-after-add';
begin;
set local role service_role;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','service_role'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'race-erase-after-add',public.request_candidate_erasure(
  'c1111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001','github-race-add',
  '06100000-0000-4000-8000-000000000001'
);
commit;
SQL
}

psql_stdin -q > "$tmp_dir/add-first-holder.log" 2>&1 <<'SQL' &
set application_name = 'candidate-list-evidence-add-first-holder';
begin;
select pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
  'c1111111-1111-4111-8111-111111111111','candidate_id','github-race-add'
));
select pg_sleep(180);
commit;
SQL
holder_pid=$!

holder_db_pid=""
for _ in $(seq 1 120); do
  holder_db_pid="$(psql_stdin -Atq -c "
    select pid from pg_stat_activity
     where application_name = 'candidate-list-evidence-add-first-holder'
       and state = 'active' and query like '%pg_sleep(180)%'
     limit 1
  ")"
  [[ -n "$holder_db_pid" ]] && break
  sleep 0.25
done
if [[ -z "$holder_db_pid" ]]; then
  echo "candidate-list-evidence-db: add-first holder did not acquire the identity lock" >&2
  exit 1
fi

race_add_before_erasure &
race_pid_1=$!

add_waiting=""
for _ in $(seq 1 120); do
  add_waiting="$(psql_stdin -Atq -c "
    select count(*) from pg_stat_activity
     where application_name = 'candidate-list-evidence-add-before-erasure'
       and wait_event_type = 'Lock' and wait_event = 'advisory'
  ")"
  [[ "$add_waiting" == "1" ]] && break
  sleep 0.25
done
if [[ "$add_waiting" != "1" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  echo "candidate-list-evidence-db: add did not reach the held candidate identity lock" >&2
  exit 1
fi

race_erase_after_add &
race_pid_2=$!

erase_waiting=""
for _ in $(seq 1 120); do
  erase_waiting="$(psql_stdin -Atq -c "
    select count(*) from pg_stat_activity
     where application_name = 'candidate-list-evidence-erase-after-add'
       and wait_event_type = 'Lock'
  ")"
  [[ "$erase_waiting" == "1" ]] && break
  sleep 0.25
done
if [[ "$erase_waiting" != "1" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  echo "candidate-list-evidence-db: erasure did not wait behind add's workspace lock" >&2
  exit 1
fi

psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null
wait "$holder_pid" || true
holder_pid=""
if ! wait "$race_pid_1"; then
  cat "$tmp_dir/add-before-erasure.log" >&2
  exit 1
fi
race_pid_1=""
if ! wait "$race_pid_2"; then
  cat "$tmp_dir/erase-after-add.log" >&2
  exit 1
fi
race_pid_2=""

psql_stdin -q <<'SQL'
select candidate_list_evidence_test.expect(
  'given_add_holds_workspace_authority_before_erasure_when_the_identity_lock_is_released_then_add_commits_first_and_erasure_scrubs_every_linkable_artifact',
  (select output->>'status' = 'added'
     from candidate_list_evidence_test.outputs where case_name = 'race-add-before-erasure')
  and (select output->>'status' = 'manual_required'
          and output->'obligations' @>
            '[{"provider":"github","status":"manual_required"}]'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'race-erase-after-add')
  and not exists (
    select 1 from public.candidate_list_members
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'd1000000-0000-4000-8000-000000000001'
       and candidate_id = 'github-race-add'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '06000000-0000-4000-8000-000000000001'
  )
  and (select scrubbed_rows = 1
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '06100000-0000-4000-8000-000000000001'
          and receipt.store_name = 'candidate_list_members')
  and (select scrubbed_rows = 1
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '06100000-0000-4000-8000-000000000001'
          and receipt.store_name = 'candidate_list_operation_receipts')
  ,jsonb_build_object(
    'add',(select output from candidate_list_evidence_test.outputs
            where case_name = 'race-add-before-erasure'),
    'erase',(select output from candidate_list_evidence_test.outputs
              where case_name = 'race-erase-after-add'),
    'members',(select count(*) from public.candidate_list_members
                where candidate_id = 'github-race-add'),
    'operationReceipts',(select count(*) from public.candidate_list_operation_receipts
                          where idempotency_key =
                            '06000000-0000-4000-8000-000000000001'),
    'erasureReceipts',(
      select coalesce(jsonb_object_agg(receipt.store_name,receipt.scrubbed_rows),'{}'::jsonb)
        from public.candidate_erasure_receipts receipt
        join public.candidate_erasure_requests request on request.id = receipt.request_id
       where request.request_key = '06100000-0000-4000-8000-000000000001'
         and receipt.store_name in (
           'candidate_list_members','candidate_contact_attestations',
           'candidate_list_operation_receipts'
         )
    )
  )::text
);
SQL

# ---------------------------------------------------------------------------
# Deterministic erasure-before-attestation ordering. Both callers queue behind
# a workspace UPDATE lock, but erasure is queued first. After release it writes
# the tombstone before attest can acquire SHARE; attest must then return the
# non-disclosing status without materializing a row or receipt.
# ---------------------------------------------------------------------------
race_erase_before_attest() {
  psql_stdin -q > "$tmp_dir/erase-before-attest.log" 2>&1 <<'SQL'
set application_name = 'candidate-list-evidence-erase-before-attest';
begin;
set local role service_role;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','service_role'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'race-erase-before-attest',public.request_candidate_erasure(
  'c1111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'manual-campaign','manual-race-attest',
  '06100000-0000-4000-8000-000000000002'
);
commit;
SQL
}

race_attest_after_erasure() {
  psql_stdin -q > "$tmp_dir/attest-after-erasure.log" 2>&1 <<'SQL'
set application_name = 'candidate-list-evidence-attest-after-erasure';
begin;
set local role authenticated;
select candidate_list_evidence_test.set_claims(
  'c1000000-0000-4000-8000-000000000001','authenticated'
);
insert into candidate_list_evidence_test.outputs(case_name,output)
select 'race-attest-after-erasure',public.attest_candidate_manual_provenance(
  'manual-campaign','manual-race-attest','verify',
  candidate_list_evidence_test.canonical_observed_at(
    'c1111111-1111-4111-8111-111111111111',
    'manual-campaign','manual-race-attest'
  ),
  null,'06000000-0000-4000-8000-000000000002'
);
commit;
SQL
}

psql_stdin -q > "$tmp_dir/erase-first-holder.log" 2>&1 <<'SQL' &
set application_name = 'candidate-list-evidence-erase-first-holder';
begin;
select 1 from public.workspace_state
 where workspace_id = 'c1111111-1111-4111-8111-111111111111'
 for update;
select pg_sleep(180);
commit;
SQL
holder_pid=$!

holder_db_pid=""
for _ in $(seq 1 120); do
  holder_db_pid="$(psql_stdin -Atq -c "
    select pid from pg_stat_activity
     where application_name = 'candidate-list-evidence-erase-first-holder'
       and state = 'active' and query like '%pg_sleep(180)%'
     limit 1
  ")"
  [[ -n "$holder_db_pid" ]] && break
  sleep 0.25
done
if [[ -z "$holder_db_pid" ]]; then
  echo "candidate-list-evidence-db: erase-first holder did not acquire the workspace lock" >&2
  exit 1
fi

race_erase_before_attest &
race_pid_1=$!

erase_waiting=""
for _ in $(seq 1 120); do
  erase_waiting="$(psql_stdin -Atq -c "
    select count(*) from pg_stat_activity
     where application_name = 'candidate-list-evidence-erase-before-attest'
       and wait_event_type = 'Lock'
  ")"
  [[ "$erase_waiting" == "1" ]] && break
  sleep 0.25
done
if [[ "$erase_waiting" != "1" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  echo "candidate-list-evidence-db: erasure did not queue on the workspace lock" >&2
  exit 1
fi

race_attest_after_erasure &
race_pid_2=$!

attest_waiting=""
for _ in $(seq 1 120); do
  attest_waiting="$(psql_stdin -Atq -c "
    select count(*) from pg_stat_activity
     where application_name = 'candidate-list-evidence-attest-after-erasure'
       and wait_event_type = 'Lock'
  ")"
  [[ "$attest_waiting" == "1" ]] && break
  sleep 0.25
done
if [[ "$attest_waiting" != "1" ]]; then
  psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null || true
  wait "$holder_pid" || true
  echo "candidate-list-evidence-db: attestation did not queue behind erasure" >&2
  exit 1
fi

psql_stdin -Atq -c "select pg_terminate_backend(${holder_db_pid})" >/dev/null
wait "$holder_pid" || true
holder_pid=""
if ! wait "$race_pid_1"; then
  cat "$tmp_dir/erase-before-attest.log" >&2
  exit 1
fi
race_pid_1=""
if ! wait "$race_pid_2"; then
  cat "$tmp_dir/attest-after-erasure.log" >&2
  exit 1
fi
race_pid_2=""

psql_stdin -q <<'SQL'
select candidate_list_evidence_test.expect(
  'given_erasure_is_queued_before_manual_attest_when_the_workspace_lock_is_released_then_erasure_commits_first_and_attest_creates_no_artifact',
  (select output->>'status' = 'completed'
     from candidate_list_evidence_test.outputs where case_name = 'race-erase-before-attest')
  and (select output = '{"status":"candidate_not_found"}'::jsonb
     from candidate_list_evidence_test.outputs where case_name = 'race-attest-after-erasure')
  and not exists (
    select 1 from public.candidate_contact_attestations
     where workspace_id = 'c1111111-1111-4111-8111-111111111111'
       and campaign_id = 'manual-campaign' and candidate_id = 'manual-race-attest'
  )
  and not exists (
    select 1 from public.candidate_list_operation_receipts
     where idempotency_key = '06000000-0000-4000-8000-000000000002'
  )
  and (select scrubbed_rows = 0
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '06100000-0000-4000-8000-000000000002'
          and receipt.store_name = 'candidate_contact_attestations')
  and (select scrubbed_rows = 0
         from public.candidate_erasure_receipts receipt
         join public.candidate_erasure_requests request on request.id = receipt.request_id
        where request.request_key = '06100000-0000-4000-8000-000000000002'
          and receipt.store_name = 'candidate_list_operation_receipts')
  ,jsonb_build_object(
    'erase',(select output from candidate_list_evidence_test.outputs
              where case_name = 'race-erase-before-attest'),
    'attest',(select output from candidate_list_evidence_test.outputs
               where case_name = 'race-attest-after-erasure'),
    'attestations',(select count(*) from public.candidate_contact_attestations
                     where candidate_id = 'manual-race-attest'),
    'operationReceipts',(select count(*) from public.candidate_list_operation_receipts
                          where idempotency_key =
                            '06000000-0000-4000-8000-000000000002'),
    'erasureReceipts',(
      select coalesce(jsonb_object_agg(receipt.store_name,receipt.scrubbed_rows),'{}'::jsonb)
        from public.candidate_erasure_receipts receipt
        join public.candidate_erasure_requests request on request.id = receipt.request_id
       where request.request_key = '06100000-0000-4000-8000-000000000002'
         and receipt.store_name in (
           'candidate_list_members','candidate_contact_attestations',
           'candidate_list_operation_receipts'
         )
    )
  )::text
);
SQL

# A non-empty rollback must refuse with SQLSTATE 55000 before changing any
# object or row. The fingerprint includes the three replaced functions, 0065
# columns, and all three governed row stores.
nonempty_before="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'columns',(
      select jsonb_agg(attribute.attname order by attribute.attname)
        from pg_attribute attribute
       where attribute.attrelid in (
         'public.candidate_contact_attestations'::regclass,
         'public.candidate_list_members'::regclass
       )
         and attribute.attname in (
           'authority_version','lawful_basis_code','observed_at','supersedes_id',
           'evidence_provider_attempt_id','evidence_expires_at'
         )
         and not attribute.attisdropped
    ),
    'attestations',(select count(*) from public.candidate_contact_attestations),
    'members',(select count(*) from public.candidate_list_members),
    'receipts',(select count(*) from public.candidate_list_operation_receipts)
  )::text
")"

if psql_stdin --set VERBOSITY=verbose \
  < "$rollback" > "$tmp_dir/nonempty-rollback.log" 2>&1; then
  echo "candidate-list-evidence-db: non-empty 0065 rollback unexpectedly succeeded" >&2
  exit 1
fi
grep -Eq 'ERROR:[[:space:]]+55000:' "$tmp_dir/nonempty-rollback.log"

nonempty_after="$(psql_stdin -Atq -c "
  select jsonb_build_object(
    'add',md5(pg_get_functiondef(
      'public.add_candidate_list_member(uuid,text,text,uuid)'::regprocedure
    )),
    'attest',md5(pg_get_functiondef(
      'public.attest_candidate_manual_provenance(text,text,text,timestamptz,bigint,uuid)'::regprocedure
    )),
    'resolve',md5(pg_get_functiondef(
      'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'::regprocedure
    )),
    'columns',(
      select jsonb_agg(attribute.attname order by attribute.attname)
        from pg_attribute attribute
       where attribute.attrelid in (
         'public.candidate_contact_attestations'::regclass,
         'public.candidate_list_members'::regclass
       )
         and attribute.attname in (
           'authority_version','lawful_basis_code','observed_at','supersedes_id',
           'evidence_provider_attempt_id','evidence_expires_at'
         )
         and not attribute.attisdropped
    ),
    'attestations',(select count(*) from public.candidate_contact_attestations),
    'members',(select count(*) from public.candidate_list_members),
    'receipts',(select count(*) from public.candidate_list_operation_receipts)
  )::text
")"
if [[ "$nonempty_after" != "$nonempty_before" ]]; then
  echo "candidate-list-evidence-db: refused non-empty rollback partially mutated 0065" >&2
  exit 1
fi

psql_stdin -q <<'SQL'
select candidate_list_evidence_test.expect(
  'given_nonempty_0065_evidence_when_rollback_is_attempted_then_55000_refuses_before_any_row_or_object_changes',
  true
);
SQL

psql_stdin -q <<'SQL'
do $assertions$
declare
  failed integer;
  details text;
begin
  select count(*) into failed
    from candidate_list_evidence_test.results
   where not passed;
  if failed <> 0 then
    select string_agg(
      case_name || ' (' || coalesce(detail,'') || ')',
      '; ' order by case_name
    ) into details
      from candidate_list_evidence_test.results
     where not passed;
    raise exception
      'candidate-list evidence database test failed: %',
      details;
  end if;
end
$assertions$;
SQL

assertions="$(psql_stdin -Atq -c "
  select count(*) from candidate_list_evidence_test.results
")"
echo "candidate-list-evidence-db: evidence authority, lifecycle, ACL/RLS, canonical reachability, rollback: ${assertions} assertions, 0 failed"
