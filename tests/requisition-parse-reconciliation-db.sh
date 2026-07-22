#!/usr/bin/env bash
# Disposable-Postgres proof for 0053 requisition_parse ambiguity reconciliation.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-parse-reconcile-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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

# The reconciliation migration depends only on authority through 0051. Apply
# that stable prefix, then 0053 directly so this focused proof is independent
# of the concurrently-built 0052 campaign slice.
for migration in \
  supabase/migrations/00[0-4][0-9]_*.sql \
  supabase/migrations/0050_requisition_parse_authority.sql \
  supabase/migrations/0051_requisition_parse_execution_claim.sql; do
  psql_stdin -q < "$migration"
done
psql_stdin -q < supabase/migrations/0053_requisition_parse_reconciliation.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema reconciliation_test;
create table reconciliation_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function reconciliation_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, reconciliation_test
as $$
begin
  insert into reconciliation_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function reconciliation_test.expect_scalar(
  p_case_name text,
  p_statement text,
  p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, reconciliation_test
as $$
declare
  actual text;
begin
  execute p_statement into actual;
  perform reconciliation_test.expect(
    p_case_name,
    actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function reconciliation_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, reconciliation_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform reconciliation_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform reconciliation_test.expect(
    p_case_name,
    false,
    'statement unexpectedly succeeded'
  );
end;
$$;

create function reconciliation_test.set_claims(
  p_subject uuid,
  p_role text
) returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_subject, 'role', p_role)::text,
    false
  );
  perform set_config('request.jwt.claim.sub', p_subject::text, false);
  perform set_config('request.jwt.claim.role', p_role, false);
end;
$$;

grant usage on schema reconciliation_test to authenticated, service_role;
grant execute on all functions in schema reconciliation_test
  to authenticated, service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'c1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'reconcile-admin@example.test', '',
    now(), '{}', '{}', now(), now()
  ),
  (
    'c2000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'reconcile-member@example.test', '',
    now(), '{}', '{}', now(), now()
  ),
  (
    'c3000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'other-admin@example.test', '',
    now(), '{}', '{}', now(), now()
  );

insert into public.workspaces(id, name, allowed_domain) values
  (
    '51111111-1111-4111-8111-111111111111',
    'Reconciliation workspace',
    'reconcile.example.test'
  ),
  (
    '52222222-2222-4222-8222-222222222222',
    'Other reconciliation workspace',
    'reconcile-other.example.test'
  );

insert into public.profiles(id, email, full_name, workspace_id, role) values
  (
    'c1000000-0000-4000-8000-000000000001',
    'reconcile-admin@example.test', 'Reconcile Admin',
    '51111111-1111-4111-8111-111111111111', 'admin'
  ),
  (
    'c2000000-0000-4000-8000-000000000002',
    'reconcile-member@example.test', 'Reconcile Member',
    '51111111-1111-4111-8111-111111111111', 'member'
  ),
  (
    'c3000000-0000-4000-8000-000000000003',
    'other-admin@example.test', 'Other Admin',
    '52222222-2222-4222-8222-222222222222', 'admin'
  );

insert into public.requisitions (
  id, workspace_id, source_kind, source_ref, status
) values
  (
    '61111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111',
    'api', 'reconciliation-a-1', 'received'
  ),
  (
    '62222222-2222-4222-8222-222222222222',
    '51111111-1111-4111-8111-111111111111',
    'api', 'reconciliation-a-2', 'received'
  ),
  (
    '63333333-3333-4333-8333-333333333333',
    '52222222-2222-4222-8222-222222222222',
    'api', 'reconciliation-b-1', 'received'
  );

insert into public.aria_jobs (
  id, workspace_id, kind, idempotency_key, payload, payload_sha256,
  status, attempt_count, max_attempts, last_error, created_at, updated_at
) values
  (
    '71111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111',
    'requisition_parse', 'requisition_parse:reconcile-a-1',
    jsonb_build_object('requisition_id', '61111111-1111-4111-8111-111111111111'),
    encode(sha256(convert_to(
      jsonb_build_object('requisition_id', '61111111-1111-4111-8111-111111111111')::text,
      'UTF8'
    )), 'hex'),
    'dead', 1, 8, 'provider outcome unknown',
    '2026-07-19 09:00:00+00', '2026-07-19 10:00:01+00'
  ),
  (
    '72222222-2222-4222-8222-222222222222',
    '51111111-1111-4111-8111-111111111111',
    'requisition_parse', 'requisition_parse:reconcile-a-2',
    jsonb_build_object('requisition_id', '62222222-2222-4222-8222-222222222222'),
    encode(sha256(convert_to(
      jsonb_build_object('requisition_id', '62222222-2222-4222-8222-222222222222')::text,
      'UTF8'
    )), 'hex'),
    'dead', 1, 8, 'provider outcome unknown',
    '2026-07-19 09:30:00+00', '2026-07-19 11:00:01+00'
  ),
  (
    '73333333-3333-4333-8333-333333333333',
    '52222222-2222-4222-8222-222222222222',
    'requisition_parse', 'requisition_parse:reconcile-b-1',
    jsonb_build_object('requisition_id', '63333333-3333-4333-8333-333333333333'),
    encode(sha256(convert_to(
      jsonb_build_object('requisition_id', '63333333-3333-4333-8333-333333333333')::text,
      'UTF8'
    )), 'hex'),
    'dead', 1, 8, 'provider outcome unknown',
    '2026-07-19 09:45:00+00', '2026-07-19 10:30:01+00'
  );

insert into public.requisition_parse_execution_claims (
  job_id, claim_token, fence_version, egress_attempt_id, state, lease_id,
  workspace_id, requisition_id, input_sha256, job_kind, payload_sha256,
  provider, model, claimed_at, egress_started_at, ambiguous_at,
  ambiguous_reason
)
select
  job.id,
  fixture.claim_token,
  fixture.fence_version,
  fixture.egress_attempt_id,
  'ambiguous',
  fixture.lease_id,
  job.workspace_id,
  (job.payload->>'requisition_id')::uuid,
  fixture.input_sha256,
  job.kind,
  job.payload_sha256,
  fixture.provider,
  fixture.model,
  fixture.ambiguous_at - interval '2 minutes',
  fixture.ambiguous_at - interval '1 minute',
  fixture.ambiguous_at,
  'provider response outcome unknown'
from public.aria_jobs job
join (
  values
    (
      '71111111-1111-4111-8111-111111111111'::uuid,
      '81111111-1111-4111-8111-111111111111'::uuid,
      3,
      '91111111-1111-4111-8111-111111111111'::uuid,
      'a1111111-1111-4111-8111-111111111111'::uuid,
      repeat('a', 64),
      'anthropic'::text,
      'claude-test'::text,
      '2026-07-19 10:00:00+00'::timestamptz
    ),
    (
      '72222222-2222-4222-8222-222222222222'::uuid,
      '82222222-2222-4222-8222-222222222222'::uuid,
      4,
      '92222222-2222-4222-8222-222222222222'::uuid,
      'a2222222-2222-4222-8222-222222222222'::uuid,
      repeat('b', 64),
      'openai'::text,
      'gpt-test'::text,
      '2026-07-19 11:00:00+00'::timestamptz
    ),
    (
      '73333333-3333-4333-8333-333333333333'::uuid,
      '83333333-3333-4333-8333-333333333333'::uuid,
      5,
      '93333333-3333-4333-8333-333333333333'::uuid,
      'a3333333-3333-4333-8333-333333333333'::uuid,
      repeat('c', 64),
      'anthropic'::text,
      'claude-other'::text,
      '2026-07-19 10:30:00+00'::timestamptz
    )
) fixture(
  job_id, claim_token, fence_version, egress_attempt_id, lease_id,
  input_sha256, provider, model, ambiguous_at
) on fixture.job_id = job.id;

select reconciliation_test.expect_scalar(
  'reconciliation-migration-does-not-build-a-hot-aria-jobs-index',
  $$select (to_regclass('public.aria_jobs_reconciliation_identity_uniq') is null)::text$$,
  'true'
);

-- ---------------------------------------------------------------------------
-- Admin inspection is tenant-bound, keyset-paginated, and capability-safe.
-- ---------------------------------------------------------------------------
set role authenticated;
select reconciliation_test.set_claims(
  'c1000000-0000-4000-8000-000000000001', 'authenticated'
);
create temporary table admin_page_1 as
select public.list_ambiguous_requisition_parse_attempts(null, null, 1) result;
reset role;

select reconciliation_test.expect_scalar(
  'admin-page-1-is-own-oldest-attempt',
  $$select concat_ws(':',
      result->>'status',
      jsonb_array_length(result->'items')::text,
      result->'items'->0->>'job_id',
      jsonb_typeof(result->'next_cursor')
    ) from admin_page_1$$,
  'ok:1:71111111-1111-4111-8111-111111111111:object'
);
select reconciliation_test.expect_scalar(
  'inspection-exposes-no-raw-capability-or-content',
  $$select concat_ws(':',
      (result->'items'->0 ? 'claim_token')::text,
      (result->'items'->0 ? 'content')::text,
      ((result->'items'->0->>'claim_fingerprint') ~ '^[0-9a-f]{64}$')::text
    ) from admin_page_1$$,
  'false:false:true'
);

select
  result->'next_cursor'->>'ambiguous_at' as page_cursor_at,
  result->'next_cursor'->>'job_id' as page_cursor_job,
  result->'items'->0->>'claim_fingerprint' as first_claim_fingerprint
from admin_page_1 \gset

set role authenticated;
select reconciliation_test.set_claims(
  'c1000000-0000-4000-8000-000000000001', 'authenticated'
);
create temporary table admin_page_2 as
select public.list_ambiguous_requisition_parse_attempts(
  :'page_cursor_at'::timestamptz,
  :'page_cursor_job'::uuid,
  1
) result;
create temporary table invalid_cursor_page as
select public.list_ambiguous_requisition_parse_attempts(
  :'page_cursor_at'::timestamptz,
  null,
  1
) result;
reset role;

select reconciliation_test.expect_scalar(
  'admin-page-2-continues-without-cross-tenant-data',
  $$select concat_ws(':',
      result->'items'->0->>'job_id',
      jsonb_typeof(result->'next_cursor')
    ) from admin_page_2$$,
  '72222222-2222-4222-8222-222222222222:null'
);
select result->'items'->0->>'claim_fingerprint' as second_claim_fingerprint
  from admin_page_2 \gset
select reconciliation_test.expect_scalar(
  'half-cursor-is-rejected',
  $$select result->>'status' from invalid_cursor_page$$,
  'invalid_request'
);

select reconciliation_test.expect_sqlstate(
  'workspace-member-cannot-inspect-ambiguity',
  $statement$do $body$
    begin
      set local role authenticated;
      perform reconciliation_test.set_claims(
        'c2000000-0000-4000-8000-000000000002', 'authenticated'
      );
      perform public.list_ambiguous_requisition_parse_attempts(null, null, 10);
    end;
  $body$;$statement$,
  array['42501']
);

set role authenticated;
select reconciliation_test.set_claims(
  'c3000000-0000-4000-8000-000000000003', 'authenticated'
);
create temporary table other_admin_page as
select public.list_ambiguous_requisition_parse_attempts(null, null, 10) result;
reset role;
select reconciliation_test.expect_scalar(
  'other-workspace-admin-sees-only-own-attempt',
  $$select concat_ws(':',
      jsonb_array_length(result->'items')::text,
      result->'items'->0->>'job_id'
    ) from other_admin_page$$,
  '1:73333333-3333-4333-8333-333333333333'
);

-- ---------------------------------------------------------------------------
-- Exact binding is mandatory. Invalid or stale operator input writes nothing.
-- ---------------------------------------------------------------------------
set role authenticated;
select reconciliation_test.set_claims(
  'c1000000-0000-4000-8000-000000000001', 'authenticated'
);
create temporary table binding_denials as
select
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    repeat('f', 64),
    3,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
    'b1111111-1111-4111-8111-111111111111'
  ) as wrong_fingerprint,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    4,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
    'b2111111-1111-4111-8111-111111111111'
  ) as wrong_fence,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    3,
    '99999999-9999-4999-8999-999999999999',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
    'b3111111-1111-4111-8111-111111111111'
  ) as wrong_attempt,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    3,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('e', 64),
    'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
    'b4111111-1111-4111-8111-111111111111'
  ) as wrong_input,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    3,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'openai', 'claude-test', 'INC-2026-0001', repeat('d', 64),
    'b5111111-1111-4111-8111-111111111111'
  ) as wrong_provider,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    3,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'anthropic', 'other-model', 'INC-2026-0001', repeat('d', 64),
    'b6111111-1111-4111-8111-111111111111'
  ) as wrong_model,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    3,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'anthropic', 'claude-test', '', repeat('d', 64),
    'b7111111-1111-4111-8111-111111111111'
  ) as invalid_case,
  public.abandon_ambiguous_requisition_parse_attempt(
    '51111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111',
    :'first_claim_fingerprint',
    3,
    '91111111-1111-4111-8111-111111111111',
    '61111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'anthropic', 'claude-test', 'INC-2026-0001', 'BAD-HASH',
    'b8111111-1111-4111-8111-111111111111'
  ) as invalid_evidence;
reset role;

select reconciliation_test.expect_scalar(
  'all-exact-binding-mismatches-fail-closed',
  $$select concat_ws(':',
      wrong_fingerprint->>'status',
      wrong_fence->>'status',
      wrong_attempt->>'status',
      wrong_input->>'status',
      wrong_provider->>'status',
      wrong_model->>'status'
    ) from binding_denials$$,
  'binding_mismatch:binding_mismatch:binding_mismatch:binding_mismatch:binding_mismatch:binding_mismatch'
);
select reconciliation_test.expect_scalar(
  'case-reference-and-evidence-are-required',
  $$select concat_ws(':', invalid_case->>'status', invalid_evidence->>'status')
      from binding_denials$$,
  'invalid_request:invalid_request'
);
select reconciliation_test.expect_scalar(
  'binding-denials-write-no-receipt',
  $$select count(*)::text from public.requisition_parse_reconciliation_receipts$$,
  '0'
);

select reconciliation_test.expect_sqlstate(
  'other-workspace-admin-cannot-abandon-owning-workspace-attempt',
  $statement$do $body$
    begin
      set local role authenticated;
      perform reconciliation_test.set_claims(
        'c3000000-0000-4000-8000-000000000003', 'authenticated'
      );
      perform public.abandon_ambiguous_requisition_parse_attempt(
        '51111111-1111-4111-8111-111111111111',
        '71111111-1111-4111-8111-111111111111',
        repeat('f', 64), 3,
        '91111111-1111-4111-8111-111111111111',
        '61111111-1111-4111-8111-111111111111', repeat('a', 64),
        'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
        'b9111111-1111-4111-8111-111111111111'
      );
    end;
  $body$;$statement$,
  array['42501']
);

select reconciliation_test.expect_sqlstate(
  'workspace-member-cannot-abandon-attempt',
  $statement$do $body$
    begin
      set local role authenticated;
      perform reconciliation_test.set_claims(
        'c2000000-0000-4000-8000-000000000002', 'authenticated'
      );
      perform public.abandon_ambiguous_requisition_parse_attempt(
        '51111111-1111-4111-8111-111111111111',
        '71111111-1111-4111-8111-111111111111',
        repeat('f', 64), 3,
        '91111111-1111-4111-8111-111111111111',
        '61111111-1111-4111-8111-111111111111', repeat('a', 64),
        'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
        'ba111111-1111-4111-8111-111111111111'
      );
    end;
  $body$;$statement$,
  array['42501']
);

-- Snapshot every mutable field that could turn this into retry/completion or
-- quota-refund behavior. The abandon call may add only one receipt.
create temporary table before_abandon as
select
  job.status as job_status,
  job.attempt_count,
  job.next_run_at,
  job.lease_id as job_lease_id,
  job.lease_expires_at,
  job.last_error,
  job.result_sha256,
  job.updated_at,
  claim.state as claim_state,
  claim.claim_token,
  claim.fence_version,
  claim.egress_attempt_id,
  claim.lease_id as claim_lease_id,
  claim.input_sha256,
  claim.provider,
  claim.model,
  claim.ambiguous_at,
  claim.ambiguous_reason,
  (select count(*) from public.enrichment_spend_ledger) as spend_rows,
  (select count(*) from public.aria_jobs where kind = 'campaign_create') as campaign_jobs
from public.aria_jobs job
join public.requisition_parse_execution_claims claim on claim.job_id = job.id
where job.id = '71111111-1111-4111-8111-111111111111';

set role authenticated;
select reconciliation_test.set_claims(
  'c1000000-0000-4000-8000-000000000001', 'authenticated'
);
create temporary table abandon_exact as
select public.abandon_ambiguous_requisition_parse_attempt(
  '51111111-1111-4111-8111-111111111111',
  '71111111-1111-4111-8111-111111111111',
  :'first_claim_fingerprint',
  3,
  '91111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111',
  repeat('a', 64),
  'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
  'bb111111-1111-4111-8111-111111111111'
) result;
create temporary table abandon_replay as
select public.abandon_ambiguous_requisition_parse_attempt(
  '51111111-1111-4111-8111-111111111111',
  '71111111-1111-4111-8111-111111111111',
  :'first_claim_fingerprint',
  3,
  '91111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111',
  repeat('a', 64),
  'anthropic', 'claude-test', 'INC-2026-0001', repeat('d', 64),
  'bb111111-1111-4111-8111-111111111111'
) result;
create temporary table abandon_replay_conflict as
select public.abandon_ambiguous_requisition_parse_attempt(
  '51111111-1111-4111-8111-111111111111',
  '71111111-1111-4111-8111-111111111111',
  :'first_claim_fingerprint',
  3,
  '91111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111',
  repeat('a', 64),
  'anthropic', 'claude-test', 'INC-2026-0001', repeat('e', 64),
  'bb111111-1111-4111-8111-111111111111'
) result;
create temporary table abandon_already_recorded as
select public.abandon_ambiguous_requisition_parse_attempt(
  '51111111-1111-4111-8111-111111111111',
  '71111111-1111-4111-8111-111111111111',
  :'first_claim_fingerprint',
  3,
  '91111111-1111-4111-8111-111111111111',
  '61111111-1111-4111-8111-111111111111',
  repeat('a', 64),
  'anthropic', 'claude-test', 'CASE-SECOND-REQUEST', repeat('e', 64),
  'bc111111-1111-4111-8111-111111111111'
) result;
create temporary table abandon_request_reused_for_other_job as
select public.abandon_ambiguous_requisition_parse_attempt(
  '51111111-1111-4111-8111-111111111111',
  '72222222-2222-4222-8222-222222222222',
  :'second_claim_fingerprint',
  4,
  '92222222-2222-4222-8222-222222222222',
  '62222222-2222-4222-8222-222222222222',
  repeat('b', 64),
  'openai', 'gpt-test', 'INC-OTHER-JOB', repeat('f', 64),
  'bb111111-1111-4111-8111-111111111111'
) result;
reset role;

select reconciliation_test.expect_scalar(
  'exact-abandon-writes-one-receipt',
  $$select concat_ws(':',
      result->>'status',
      (result->>'receipt_id')::bigint::text,
      (select count(*)::text from public.requisition_parse_reconciliation_receipts)
    ) from abandon_exact$$,
  'abandon_recorded:1:1'
);
select reconciliation_test.expect_scalar(
  'exact-request-replay-is-a-no-op',
  $$select concat_ws(':',
      result->>'status',
      result->>'receipt_id',
      (select count(*)::text from public.requisition_parse_reconciliation_receipts)
    ) from abandon_replay$$,
  'no_op_replay:1:1'
);
select reconciliation_test.expect_scalar(
  'request-id-reuse-with-different-evidence-conflicts',
  $$select result->>'status' from abandon_replay_conflict$$,
  'idempotency_conflict'
);
select reconciliation_test.expect_scalar(
  'second-request-cannot-append-another-job-receipt',
  $$select concat_ws(':', result->>'status', result->>'receipt_id')
      from abandon_already_recorded$$,
  'already_abandoned:1'
);
select reconciliation_test.expect_scalar(
  'same-request-id-cannot-be-reused-for-another-job',
  $$select result->>'status' from abandon_request_reused_for_other_job$$,
  'idempotency_conflict'
);

select reconciliation_test.expect_scalar(
  'receipt-binds-exact-attempt-and-required-investigation-proof',
  $$select concat_ws(':',
      workspace_id::text,
      job_id::text,
      fence_version::text,
      egress_attempt_id::text,
      requisition_id::text,
      input_sha256,
      provider,
      model,
      action,
      case_reference,
      evidence_sha256,
      actor_id::text,
      job_status,
      claim_state,
      (claim_fingerprint = public.requisition_parse_claim_fingerprint(
        workspace_id, job_id, claim_token, fence_version, egress_attempt_id,
        lease_id, requisition_id, input_sha256, payload_sha256, provider, model,
        claim_state
      ))::text
    ) from public.requisition_parse_reconciliation_receipts$$,
  '51111111-1111-4111-8111-111111111111:71111111-1111-4111-8111-111111111111:3:91111111-1111-4111-8111-111111111111:61111111-1111-4111-8111-111111111111:'
    || repeat('a', 64)
    || ':anthropic:claude-test:abandon:INC-2026-0001:'
    || repeat('d', 64)
    || ':c1000000-0000-4000-8000-000000000001:dead:ambiguous:true'
);

select reconciliation_test.expect_scalar(
  'abandon-does-not-change-job-claim-quota-or-follow-on-jobs',
  $$select (before_abandon is not distinct from after_abandon)::text
      from before_abandon,
      lateral (
        select
          job.status as job_status,
          job.attempt_count,
          job.next_run_at,
          job.lease_id as job_lease_id,
          job.lease_expires_at,
          job.last_error,
          job.result_sha256,
          job.updated_at,
          claim.state as claim_state,
          claim.claim_token,
          claim.fence_version,
          claim.egress_attempt_id,
          claim.lease_id as claim_lease_id,
          claim.input_sha256,
          claim.provider,
          claim.model,
          claim.ambiguous_at,
          claim.ambiguous_reason,
          (select count(*) from public.enrichment_spend_ledger) as spend_rows,
          (select count(*) from public.aria_jobs where kind = 'campaign_create') as campaign_jobs
        from public.aria_jobs job
        join public.requisition_parse_execution_claims claim on claim.job_id = job.id
        where job.id = '71111111-1111-4111-8111-111111111111'
      ) after_abandon$$,
  'true'
);

set role authenticated;
select reconciliation_test.set_claims(
  'c1000000-0000-4000-8000-000000000001', 'authenticated'
);
create temporary table reconciled_page as
select public.list_ambiguous_requisition_parse_attempts(null, null, 10) result;
reset role;
select reconciliation_test.expect_scalar(
  'inspection-surfaces-reconciled-receipt-without-secret',
  $$select concat_ws(':',
      item->>'reconciled',
      item->>'reconciliation_receipt_id',
      item->>'case_reference',
      item->>'evidence_sha256',
      (item ? 'claim_token')::text
    )
    from reconciled_page,
    lateral jsonb_array_elements(result->'items') item
    where item->>'job_id' = '71111111-1111-4111-8111-111111111111'$$,
  'true:1:INC-2026-0001:' || repeat('d', 64) || ':false'
);

-- ---------------------------------------------------------------------------
-- ACL, RLS, and append-only behavior are enforced at the database boundary.
-- ---------------------------------------------------------------------------
select reconciliation_test.expect_scalar(
  'reconciliation-receipts-force-rls',
  $$select concat_ws(':', relrowsecurity::text, relforcerowsecurity::text)
      from pg_class
     where oid = 'public.requisition_parse_reconciliation_receipts'::regclass$$,
  'true:true'
);
select reconciliation_test.expect_scalar(
  'application-roles-have-no-direct-receipt-table-privileges',
  $$select concat_ws(':',
      has_table_privilege('authenticated', 'public.requisition_parse_reconciliation_receipts', 'SELECT')::text,
      has_table_privilege('authenticated', 'public.requisition_parse_reconciliation_receipts', 'INSERT')::text,
      has_table_privilege('authenticated', 'public.requisition_parse_reconciliation_receipts', 'UPDATE')::text,
      has_table_privilege('authenticated', 'public.requisition_parse_reconciliation_receipts', 'DELETE')::text,
      has_table_privilege('service_role', 'public.requisition_parse_reconciliation_receipts', 'SELECT')::text,
      has_table_privilege('service_role', 'public.requisition_parse_reconciliation_receipts', 'INSERT')::text,
      has_table_privilege('service_role', 'public.requisition_parse_reconciliation_receipts', 'UPDATE')::text,
      has_table_privilege('service_role', 'public.requisition_parse_reconciliation_receipts', 'DELETE')::text
    )$$,
  'false:false:false:false:false:false:false:false'
);
select reconciliation_test.expect_scalar(
  'only-authenticated-role-can-execute-admin-reconciliation-rpcs',
  $$select concat_ws(':',
      has_function_privilege(
        'authenticated',
        'public.list_ambiguous_requisition_parse_attempts(timestamptz,uuid,integer)',
        'EXECUTE'
      )::text,
      has_function_privilege(
        'service_role',
        'public.list_ambiguous_requisition_parse_attempts(timestamptz,uuid,integer)',
        'EXECUTE'
      )::text,
      has_function_privilege(
        'authenticated',
        'public.abandon_ambiguous_requisition_parse_attempt(uuid,uuid,text,integer,uuid,uuid,text,text,text,text,text,uuid)',
        'EXECUTE'
      )::text,
      has_function_privilege(
        'service_role',
        'public.abandon_ambiguous_requisition_parse_attempt(uuid,uuid,text,integer,uuid,uuid,text,text,text,text,text,uuid)',
        'EXECUTE'
      )::text
    )$$,
  'true:false:true:false'
);
select reconciliation_test.expect_scalar(
  'claim-fingerprint-helper-is-private',
  $$select concat_ws(':',
      has_function_privilege(
        'authenticated',
        'public.requisition_parse_claim_fingerprint(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,text,text,text)',
        'EXECUTE'
      )::text,
      has_function_privilege(
        'service_role',
        'public.requisition_parse_claim_fingerprint(uuid,uuid,uuid,integer,uuid,uuid,uuid,text,text,text,text,text)',
        'EXECUTE'
      )::text
    )$$,
  'false:false'
);

select reconciliation_test.expect_sqlstate(
  'database-rejects-owner-level-cross-tenant-receipt-pairing',
  $statement$insert into public.requisition_parse_reconciliation_receipts (
    workspace_id, request_id, job_id, job_kind, claim_token,
    claim_fingerprint, fence_version, egress_attempt_id, lease_id,
    requisition_id, input_sha256, payload_sha256, provider, model, action,
    case_reference, evidence_sha256, actor_id, job_status, claim_state,
    ambiguous_at
  )
  select
    '52222222-2222-4222-8222-222222222222'::uuid,
    'bd111111-1111-4111-8111-111111111111'::uuid,
    '72222222-2222-4222-8222-222222222222'::uuid,
    'requisition_parse',
    '82222222-2222-4222-8222-222222222222'::uuid,
    public.requisition_parse_claim_fingerprint(
      '52222222-2222-4222-8222-222222222222'::uuid,
      '72222222-2222-4222-8222-222222222222'::uuid,
      '82222222-2222-4222-8222-222222222222'::uuid,
      4,
      '92222222-2222-4222-8222-222222222222'::uuid,
      'a2222222-2222-4222-8222-222222222222'::uuid,
      '63333333-3333-4333-8333-333333333333'::uuid,
      repeat('b', 64),
      job.payload_sha256,
      'openai', 'gpt-test', 'ambiguous'
    ),
    4,
    '92222222-2222-4222-8222-222222222222'::uuid,
    'a2222222-2222-4222-8222-222222222222'::uuid,
    '63333333-3333-4333-8333-333333333333'::uuid,
    repeat('b', 64),
    job.payload_sha256,
    'openai', 'gpt-test', 'abandon', 'INC-CROSS-TENANT', repeat('f', 64),
    'c3000000-0000-4000-8000-000000000003'::uuid,
    'dead', 'ambiguous', '2026-07-19 11:00:00+00'::timestamptz
  from public.aria_jobs job
  where job.id = '72222222-2222-4222-8222-222222222222'$statement$,
  array['23503']
);

-- A simple job-id foreign key is not enough: an owner could otherwise alter
-- an unreconciled job payload while leaving its stored hash unchanged, then
-- insert an exact-looking receipt bound only to the claim. The insert trigger
-- must lock the job and re-prove its canonical payload/hash pair.
update public.aria_jobs
   set payload = payload || jsonb_build_object('unexpected', true)
 where id = '72222222-2222-4222-8222-222222222222';
select reconciliation_test.expect_sqlstate(
  'database-rejects-owner-receipt-for-mutated-job-payload',
  $statement$insert into public.requisition_parse_reconciliation_receipts (
    workspace_id, request_id, job_id, job_kind, claim_token,
    claim_fingerprint, fence_version, egress_attempt_id, lease_id,
    requisition_id, input_sha256, payload_sha256, provider, model, action,
    case_reference, evidence_sha256, actor_id, job_status, claim_state,
    ambiguous_at
  )
  select
    claim.workspace_id,
    'be111111-1111-4111-8111-111111111111'::uuid,
    claim.job_id,
    claim.job_kind,
    claim.claim_token,
    claim.reconciliation_fingerprint,
    claim.fence_version,
    claim.egress_attempt_id,
    claim.lease_id,
    claim.requisition_id,
    claim.input_sha256,
    claim.payload_sha256,
    claim.provider,
    claim.model,
    'abandon',
    'INC-MUTATED-JOB',
    repeat('f', 64),
    'c1000000-0000-4000-8000-000000000001'::uuid,
    'dead',
    'ambiguous',
    claim.ambiguous_at
  from public.requisition_parse_execution_claims claim
  where claim.job_id = '72222222-2222-4222-8222-222222222222'$statement$,
  array['23503']
);
update public.aria_jobs
   set payload = jsonb_build_object(
     'requisition_id', '62222222-2222-4222-8222-222222222222'
   )
 where id = '72222222-2222-4222-8222-222222222222';

select reconciliation_test.expect_sqlstate(
  'receipt-update-is-rejected-even-for-owner',
  $statement$update public.requisition_parse_reconciliation_receipts
       set case_reference = 'INC-CHANGED'$statement$,
  array['42501']
);
select reconciliation_test.expect_sqlstate(
  'receipt-delete-is-rejected-even-for-owner',
  $statement$delete from public.requisition_parse_reconciliation_receipts$statement$,
  array['42501']
);
select reconciliation_test.expect_sqlstate(
  'receipt-foreign-key-keeps-claim-ambiguous',
  $statement$update public.requisition_parse_execution_claims
     set state = 'egress_started', ambiguous_at = null, ambiguous_reason = null
   where job_id = '71111111-1111-4111-8111-111111111111'$statement$,
  array['23503']
);
select reconciliation_test.expect_sqlstate(
  'receipt-foreign-key-keeps-job-dead',
  $statement$update public.aria_jobs
     set status = 'failed'
   where id = '71111111-1111-4111-8111-111111111111'$statement$,
  array['23503']
);
select reconciliation_test.expect_sqlstate(
  'receipt-guard-keeps-job-payload-identity',
  $statement$update public.aria_jobs
     set payload = payload || jsonb_build_object('unexpected', true)
   where id = '71111111-1111-4111-8111-111111111111'$statement$,
  array['23503']
);
update public.aria_jobs
   set last_error = 'investigation receipt recorded'
 where id = '71111111-1111-4111-8111-111111111111';
select reconciliation_test.expect_scalar(
  'receipt-guard-allows-nonidentity-operational-metadata',
  $$select last_error from public.aria_jobs
     where id = '71111111-1111-4111-8111-111111111111'$$,
  'investigation receipt recorded'
);
select reconciliation_test.expect_scalar(
  'append-only-denials-preserve-the-one-receipt',
  $$select count(*)::text from public.requisition_parse_reconciliation_receipts$$,
  '1'
);

do $$
declare
  failed integer;
  total integer;
  details text;
begin
  select count(*), count(*) filter (where not passed)
    into total, failed
    from reconciliation_test.results;
  if failed <> 0 then
    select string_agg(
      case_name || ' (' || coalesce(detail, '') || ')',
      '; ' order by case_name
    ) into details
    from reconciliation_test.results
    where not passed;
    raise exception 'requisition-parse reconciliation DB test failed: %', details;
  end if;
  raise notice 'requisition-parse reconciliation DB test: % assertions, 0 failed', total;
end;
$$;
SQL

echo "requisition-parse-reconciliation-db: admin keyset inspection, exact abandon receipt, idempotency, terminal immutability and ACLs passed"
