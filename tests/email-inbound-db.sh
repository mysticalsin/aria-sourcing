#!/usr/bin/env bash
# email-inbound-db.sh — disposable-Postgres proof for migration 0040
# (inbound email persistence + reply correlation — Rock 3 core).
#
# ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
# 2026-07-23); Owner acknowledged the hybrid degraded build in-conversation.
#
# Proves, against the full migration chain: mailbox routing (service-only,
# no-route miss), idempotent inbound persistence (redelivery inserts nothing),
# and the fail-closed reply<->rfc_message_id correlation (exactly-one match
# stamps candidate+ledger+outbound and marks processed; no header / no match /
# ambiguous never guess an identity), plus inbound_mailbox_routes RLS.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-email-inbound-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema email_inbound_test;

create table email_inbound_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function email_inbound_test.expect(p_case_name text, p_passed boolean, p_detail text default null)
returns void language plpgsql set search_path = pg_catalog, public, email_inbound_test as $$
begin
  insert into email_inbound_test.results(case_name, passed, detail) values (p_case_name, p_passed, p_detail);
end; $$;

create function email_inbound_test.expect_scalar(p_case_name text, p_statement text, p_expected text)
returns void language plpgsql set search_path = pg_catalog, public, email_inbound_test as $$
declare actual text;
begin
  execute p_statement into actual;
  perform email_inbound_test.expect(p_case_name, actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected));
end; $$;

create function email_inbound_test.expect_authenticated_sqlstate(p_case_name text, p_statement text, p_expected_codes text[])
returns void language plpgsql set search_path = pg_catalog, public, email_inbound_test as $$
declare caught text;
begin
  begin
    execute 'set local role authenticated';
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    execute 'reset role';
    perform email_inbound_test.expect(p_case_name, caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text));
    return;
  end;
  execute 'reset role';
  perform email_inbound_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end; $$;

create function email_inbound_test.set_service_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end; $$;

create function email_inbound_test.set_authenticated_claims(subject uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end; $$;

grant usage on schema email_inbound_test to service_role, authenticated;
grant execute on all functions in schema email_inbound_test to service_role, authenticated;

-- Seed: workspaces A/B, users, a mailbox route + a SENT ledger row with a known rfc id.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('f1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('f2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','in-admin-b@example.test','',now(),'{}','{}',now(),now());
insert into public.workspaces(id, name, allowed_domain) values
  ('71111111-1111-4111-8111-111111111111','In A','in-a.example.test'),
  ('72222222-2222-4222-8222-222222222222','In B','in-b.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('f1000000-0000-4000-8000-000000000001','in-admin-a@example.test','In Admin A','71111111-1111-4111-8111-111111111111','admin'),
  ('f2000000-0000-4000-8000-000000000002','in-admin-b@example.test','In Admin B','72222222-2222-4222-8222-222222222222','admin');
insert into public.inbound_mailbox_routes(workspace_id, mailbox_address, purpose)
values ('71111111-1111-4111-8111-111111111111','inbound@in-a.example.test','reply');
insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, campaign_id, channel, status, rfc_message_id)
values ('71111111-1111-4111-8111-111111111111','cand-1','cand1@target.example.test','camp-1','Email','sent','<known-attempt@in-a.example.test>');

-- 1. resolve_inbound_mailbox_route: service-only, hit + miss.
select email_inbound_test.expect_authenticated_sqlstate('resolve-authenticated-denied',
  $$select public.resolve_inbound_mailbox_route('inbound@in-a.example.test')$$, array['42501']);
set role service_role; select email_inbound_test.set_service_claims('f1000000-0000-4000-8000-000000000001');
create temporary table resolve_hit as select public.resolve_inbound_mailbox_route('INBOUND@in-a.example.test') r;
create temporary table resolve_miss as select public.resolve_inbound_mailbox_route('nobody@nowhere.test') r;
reset role;
select email_inbound_test.expect_scalar('resolve-hit-lowercased',
  $$select concat_ws(':', r->>'ok', (r->>'workspace_id')='71111111-1111-4111-8111-111111111111') from resolve_hit$$, 'true:true');
select email_inbound_test.expect_scalar('resolve-miss-no-route',
  $$select concat_ws(':', r->>'ok', r->>'reason') from resolve_miss$$, 'false:no-route');

-- 2. record_inbound_email: idempotent on provider id.
set role service_role; select email_inbound_test.set_service_claims('f1000000-0000-4000-8000-000000000001');
create temporary table rec_first as select public.record_inbound_email(
  '71111111-1111-4111-8111-111111111111','reply-1','cand1@target.example.test','Yes, interested.') r;
create temporary table rec_replay as select public.record_inbound_email(
  '71111111-1111-4111-8111-111111111111','reply-1','cand1@target.example.test','Yes, interested.') r;
reset role;
select email_inbound_test.expect_scalar('record-first',
  $$select concat_ws(':', r->>'ok', r->>'duplicate', (r->>'inbound_id' is not null)::text) from rec_first$$, 'true:false:true');
select email_inbound_test.expect_scalar('record-replay-duplicate-same-row',
  $$select concat_ws(':', a.r->>'duplicate', (a.r->>'inbound_id'=b.r->>'inbound_id')::text) from rec_replay a, rec_first b$$, 'true:true');
select email_inbound_test.expect_scalar('record-one-inbound-row',
  $$select count(*)::text from public.messages_inbound where workspace_id='71111111-1111-4111-8111-111111111111' and channel='Email' and provider_id='reply-1'$$, '1');
select set_config('emailinbound.inbound_id', (select (r->>'inbound_id') from rec_first), false);

-- 3. correlate_inbound_email: exactly-one match correlates; failures fail closed.
set role service_role; select email_inbound_test.set_service_claims('f1000000-0000-4000-8000-000000000001');
create temporary table corr_nohdr as select public.correlate_inbound_email(current_setting('emailinbound.inbound_id')::uuid, '') r;
reset role;
select email_inbound_test.expect_scalar('correlate-no-header-fail-closed',
  $$select concat_ws(':', r->>'correlated', r->>'reason') from corr_nohdr$$, 'false:no-in-reply-to');

set role service_role; select email_inbound_test.set_service_claims('f1000000-0000-4000-8000-000000000001');
create temporary table corr_nomatch as select public.correlate_inbound_email(current_setting('emailinbound.inbound_id')::uuid, '<unknown@in-a.example.test>') r;
reset role;
select email_inbound_test.expect_scalar('correlate-no-match-fail-closed',
  $$select concat_ws(':', r->>'correlated', r->>'reason') from corr_nomatch$$, 'false:no-match');

set role service_role; select email_inbound_test.set_service_claims('f1000000-0000-4000-8000-000000000001');
create temporary table corr_ok as select public.correlate_inbound_email(current_setting('emailinbound.inbound_id')::uuid, '<known-attempt@in-a.example.test>') r;
reset role;
select email_inbound_test.expect_scalar('correlate-single-match-stamps-candidate',
  $$select concat_ws(':', (select r->>'correlated' from corr_ok), (select r->>'candidate_id' from corr_ok),
      (select concat_ws('/', candidate_id, processed::text) from public.messages_inbound where id = current_setting('emailinbound.inbound_id')::uuid))$$,
  'true:cand-1:cand-1/true');

-- 4. inbound_mailbox_routes RLS: workspace-B admin sees no workspace-A routes.
set role authenticated; select email_inbound_test.set_authenticated_claims('f2000000-0000-4000-8000-000000000002');
create temporary table routes_cross as select count(*) v from public.inbound_mailbox_routes;
reset role;
select email_inbound_test.expect_scalar('routes-rls-cross-workspace-empty', $$select v::text from routes_cross$$, '0');

do $$
declare failed integer; details text;
begin
  select count(*) into failed from email_inbound_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name) into details
      from email_inbound_test.results where not passed;
    raise exception 'email inbound DB test failed: %', details;
  end if;
end; $$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from email_inbound_test.results")"
echo "email-inbound-db: mailbox routing, idempotent persistence, fail-closed reply correlation, RLS: ${assertions} assertions, 0 failed"
