#!/usr/bin/env bash
# email-outcomes-db.sh — disposable-Postgres proof for migration 0041
# (candidate outcome events — Rock 3 completion).
#
# ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
# 2026-07-23); Owner acknowledged the hybrid degraded build in-conversation.
#
# Proves the DETERMINISTIC outcome authority: record_candidate_outcome is
# service-only, idempotent (per-workspace idempotency key), rejects bad kinds,
# and append-only for clients (RLS select-only, no client writes); and a
# correlated reply (0040) records a single reply_received outcome.
#
# NOTE: the erasure-specific proofs of 0041 — the tombstone-skip in
# record_candidate_outcome and the cleanup_erased_candidate_outcomes trigger on
# candidate_erasure_requests — are exercised by the full candidate-erasure suite
# (bash tests/candidate-erasure-db.sh), which seeds the workspace sourcing secret,
# tombstones, and erasure-request machinery this focused test does not reconstruct.
# The trigger/skip mirror 0035 cleanup_erased_candidate_mirror + 0037 tombstone-skip
# byte-faithfully; run the erasure suite at this migration tip to confirm ordering.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-email-outcomes-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() { docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i --network "$network" --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql "$client_image" -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin -q < "$migration"
done

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema email_outcomes_test;
create table email_outcomes_test.results (case_name text primary key, passed boolean not null, detail text);

create function email_outcomes_test.expect(p_case_name text, p_passed boolean, p_detail text default null)
returns void language plpgsql set search_path = pg_catalog, public, email_outcomes_test as $$
begin insert into email_outcomes_test.results(case_name, passed, detail) values (p_case_name, p_passed, p_detail); end; $$;

create function email_outcomes_test.expect_scalar(p_case_name text, p_statement text, p_expected text)
returns void language plpgsql set search_path = pg_catalog, public, email_outcomes_test as $$
declare actual text;
begin
  execute p_statement into actual;
  perform email_outcomes_test.expect(p_case_name, actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected));
end; $$;

create function email_outcomes_test.expect_authenticated_sqlstate(p_case_name text, p_statement text, p_expected_codes text[])
returns void language plpgsql set search_path = pg_catalog, public, email_outcomes_test as $$
declare caught text;
begin
  begin execute 'set local role authenticated'; execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate; execute 'reset role';
    perform email_outcomes_test.expect(p_case_name, caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text));
    return;
  end;
  execute 'reset role';
  perform email_outcomes_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end; $$;

create function email_outcomes_test.set_service_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end; $$;
create function email_outcomes_test.set_authenticated_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end; $$;

grant usage on schema email_outcomes_test to service_role, authenticated;
grant execute on all functions in schema email_outcomes_test to service_role, authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out-admin-b@example.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id, name, allowed_domain) values
  ('81111111-1111-4111-8111-111111111111','Out A','out-a.example.test'),
  ('82222222-2222-4222-8222-222222222222','Out B','out-b.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001','out-admin-a@example.test','Out Admin A','81111111-1111-4111-8111-111111111111','admin'),
  ('a2000000-0000-4000-8000-000000000002','out-admin-b@example.test','Out Admin B','82222222-2222-4222-8222-222222222222','admin');

-- 1. record_candidate_outcome: service-only, happy, idempotent, invalid kind.
select email_outcomes_test.expect_authenticated_sqlstate('record-authenticated-denied',
  $$select public.record_candidate_outcome('81111111-1111-4111-8111-111111111111','cand-1','interested','k1')$$, array['42501']);
set role service_role; select email_outcomes_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table rec_ok as select public.record_candidate_outcome('81111111-1111-4111-8111-111111111111','cand-1','interested','k1') r;
create temporary table rec_replay as select public.record_candidate_outcome('81111111-1111-4111-8111-111111111111','cand-1','interested','k1') r;
create temporary table rec_badkind as select public.record_candidate_outcome('81111111-1111-4111-8111-111111111111','cand-1','shrug','k2') r;
reset role;
select email_outcomes_test.expect_scalar('record-happy',
  $$select concat_ws(':', r->>'ok', r->>'duplicate', (r->>'outcome_id' is not null)::text) from rec_ok$$, 'true:false:true');
select email_outcomes_test.expect_scalar('record-idempotent',
  $$select concat_ws(':', r->>'ok', r->>'duplicate') from rec_replay$$, 'true:true');
select email_outcomes_test.expect_scalar('record-one-row',
  $$select count(*)::text from public.candidate_outcome_events where workspace_id='81111111-1111-4111-8111-111111111111' and idempotency_key='k1'$$, '1');
select email_outcomes_test.expect_scalar('record-invalid-kind',
  $$select r->>'reason' from rec_badkind$$, 'invalid-kind');

-- 2. append-only for clients: authenticated cannot insert/update/delete.
select email_outcomes_test.expect_authenticated_sqlstate('outcomes-authenticated-insert-denied',
  $$insert into public.candidate_outcome_events(workspace_id, candidate_id, kind, idempotency_key) values ('81111111-1111-4111-8111-111111111111','cand-1','interested','x')$$, array['42501']);
select email_outcomes_test.expect_authenticated_sqlstate('outcomes-authenticated-delete-denied',
  $$delete from public.candidate_outcome_events where true$$, array['42501']);

-- 3. RLS: workspace-B admin sees no workspace-A outcomes.
set role authenticated; select email_outcomes_test.set_authenticated_claims('a2000000-0000-4000-8000-000000000002');
create temporary table cross_read as select count(*) v from public.candidate_outcome_events;
reset role;
select email_outcomes_test.expect_scalar('outcomes-rls-cross-workspace-empty', $$select v::text from cross_read$$, '0');

-- 4. correlate_inbound_email records a single reply_received outcome.
insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, campaign_id, channel, status, rfc_message_id)
values ('81111111-1111-4111-8111-111111111111','cand-9','cand9@target.example.test','camp-1','Email','sent','<reply-key@out-a.example.test>');
set role service_role; select email_outcomes_test.set_service_claims('a1000000-0000-4000-8000-000000000001');
create temporary table rec_in as select public.record_inbound_email('81111111-1111-4111-8111-111111111111','in-1','cand9@target.example.test','Interested!') r;
select set_config('emailoutcomes.inbound_id', (select (r->>'inbound_id') from rec_in), false);
create temporary table corr as select public.correlate_inbound_email(current_setting('emailoutcomes.inbound_id')::uuid, '<reply-key@out-a.example.test>') r;
create temporary table corr_replay as select public.correlate_inbound_email(current_setting('emailoutcomes.inbound_id')::uuid, '<reply-key@out-a.example.test>') r;
reset role;
select email_outcomes_test.expect_scalar('correlate-records-reply-outcome',
  $$select concat_ws(':', (select r->>'correlated' from corr), (select r->>'outcome_recorded' from corr),
      (select count(*)::text from public.candidate_outcome_events
        where workspace_id='81111111-1111-4111-8111-111111111111' and candidate_id='cand-9' and kind='reply_received'))$$,
  'true:true:1');
select email_outcomes_test.expect_scalar('correlate-replay-does-not-duplicate-reply-outcome',
  $$select concat_ws(':', (select r->>'correlated' from corr_replay), (select r->>'reason' from corr_replay),
      (select count(*)::text from public.candidate_outcome_events
        where workspace_id='81111111-1111-4111-8111-111111111111' and candidate_id='cand-9' and kind='reply_received'))$$,
  'true:already-processed:1');

do $$
declare failed integer; details text;
begin
  select count(*) into failed from email_outcomes_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name) into details
      from email_outcomes_test.results where not passed;
    raise exception 'email outcomes DB test failed: %', details;
  end if;
end; $$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from email_outcomes_test.results")"
echo "email-outcomes-db: outcome authority (service-only, idempotent, append-only RLS) + correlated-reply outcome: ${assertions} assertions, 0 failed"
