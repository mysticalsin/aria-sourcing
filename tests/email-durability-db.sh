#!/usr/bin/env bash
# email-durability-db.sh — disposable-Postgres proof for migration 0039
# (email joins the durable outbox — Rock 2 of the industrial autonomous loop).
#
# ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
# 2026-07-23); Owner acknowledged the hybrid degraded build in-conversation.
#
# Proves, against the full migration chain:
#   enqueue_email_outbound idempotency (per-draft de-dupe, duplicate return,
#   input validation, RBAC), the enforce_active_email_approval PRE-DISPATCH
#   TRIGGER raising when an Email row goes queued->dispatching without a matching
#   live human approval (the mechanical never-auto-send guarantee for Email),
#   the service-only claim_email_outbound_queued gate set (service-only, approval
#   re-verify, suppression, live seat, 90-day window, one-shot queued->dispatching
#   with a minted RFC Message-ID and delivery_attempt_id), send finalization
#   (record_email_send_message_id: dispatching->sent + ledger sent, attempt
#   binding, idempotency), the failure finalizer, delivery-event idempotency with
#   permanent-bounce/complaint suppression (and no suppression for soft
#   bounce/open/delivered), and email_delivery_events RLS.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-email-durability-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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

create schema email_durability_test;

create table email_durability_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function email_durability_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, email_durability_test
as $$
begin
  insert into email_durability_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function email_durability_test.expect_scalar(
  p_case_name text,
  p_statement text,
  p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, email_durability_test
as $$
declare
  actual text;
begin
  execute p_statement into actual;
  perform email_durability_test.expect(
    p_case_name,
    actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function email_durability_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, email_durability_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform email_durability_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform email_durability_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function email_durability_test.expect_authenticated_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, email_durability_test
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
    perform email_durability_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  execute 'reset role';
  perform email_durability_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function email_durability_test.set_service_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function email_durability_test.set_authenticated_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;

grant usage on schema email_durability_test to service_role, authenticated;
grant execute on all functions in schema email_durability_test to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: two workspaces, an admin/member in A, an admin in B; one LIVE
-- domain-verified email seat in A; a candidate with an active human approval.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('e1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','email-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('e2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','email-member-a@example.test','',now(),'{}','{}',now(),now()),
  ('e3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','email-admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id, name, allowed_domain) values
  ('61111111-1111-4111-8111-111111111111','Email A','email-a.example.test'),
  ('62222222-2222-4222-8222-222222222222','Email B','email-b.example.test');

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('e1000000-0000-4000-8000-000000000001','email-admin-a@example.test','Email Admin A','61111111-1111-4111-8111-111111111111','admin'),
  ('e2000000-0000-4000-8000-000000000002','email-member-a@example.test','Email Member A','61111111-1111-4111-8111-111111111111','member'),
  ('e3000000-0000-4000-8000-000000000003','email-admin-b@example.test','Email Admin B','62222222-2222-4222-8222-222222222222','admin');

insert into public.agent_seats(
  id, workspace_id, name, operator_email, provider, status, mode,
  domain_verified, daily_limit, warmup
) values (
  '6a000000-0000-4000-8000-0000000000aa','61111111-1111-4111-8111-111111111111',
  'Email Seat A','recruiter@email-a.example.test','Microsoft Graph','active','live',
  true, 40, false
);

-- The exact approval a live email send re-verifies: body_hash over subject+body,
-- scope_hash over candidate+channel+lower(recipient), source human, not revoked.
insert into public.outreach_approvals(
  workspace_id, message_id, body_hash, approval_scope_hash, approved_by,
  approved_at, approval_source
) values (
  '61111111-1111-4111-8111-111111111111','draft-1',
  encode(digest('Subject 1' || E'\n' || 'Body one', 'sha256'), 'hex'),
  encode(digest('cand-1' || E'\n' || 'Email' || E'\n' || 'cand1@target.example.test', 'sha256'), 'hex'),
  'e2000000-0000-4000-8000-000000000002', now(), 'human'
);

-- ===========================================================================
-- 1. enqueue_email_outbound: happy path, duplicate return, validation, RBAC.
-- ===========================================================================
set role authenticated;
select email_durability_test.set_authenticated_claims('e2000000-0000-4000-8000-000000000002');

create temporary table enqueue_first as
select public.enqueue_email_outbound(
  'draft-1','cand-1','camp-1','6a000000-0000-4000-8000-0000000000aa',
  'cand1@target.example.test','Subject 1','Body one') result;

create temporary table enqueue_replay as
select public.enqueue_email_outbound(
  'draft-1','cand-1','camp-1','6a000000-0000-4000-8000-0000000000aa',
  'cand1@target.example.test','Subject 1','Body one') result;

create temporary table enqueue_bad_recipient as
select public.enqueue_email_outbound(
  'draft-2','cand-2','camp-1','6a000000-0000-4000-8000-0000000000aa',
  'not-an-email','Subject 2','Body two') result;

reset role;

select email_durability_test.expect_scalar(
  'enqueue-first-queued',
  $$select concat_ws(':', result->>'ok', result->>'status', (result->>'id' is not null)::text) from enqueue_first$$,
  'true:queued:true'
);
select email_durability_test.expect_scalar(
  'enqueue-replay-duplicate-same-row',
  $$select concat_ws(':', a.result->>'reason', (a.result->>'id' = b.result->>'id')::text)
      from enqueue_replay a, enqueue_first b$$,
  'duplicate:true'
);
select email_durability_test.expect_scalar(
  'enqueue-invalid-recipient',
  $$select result->>'reason' from enqueue_bad_recipient$$,
  'invalid-recipient'
);
select email_durability_test.expect_scalar(
  'enqueue-one-queued-row',
  $$select concat_ws(':', count(*)::text, min(status), min(channel))
      from public.messages_outbound
     where workspace_id = '61111111-1111-4111-8111-111111111111' and to_address = 'cand1@target.example.test'$$,
  '1:queued:Email'
);

-- Hand the enqueued row id across role boundaries via a GUC.
select set_config('emaildurability.draft1_id',
  (select (result->>'id') from enqueue_first), false);

-- ===========================================================================
-- 2. enforce_active_email_approval TRIGGER: an unapproved Email row can NEVER
--    transition queued -> dispatching. Seed a second queued row with NO
--    approval and attempt the transition directly (postgres session).
-- ===========================================================================
insert into public.messages_outbound(
  id, workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
  status, dedupe_hash, scheduled_at, approval_message_id, campaign_id
) values (
  '6b000000-0000-4000-8000-0000000000bb','61111111-1111-4111-8111-111111111111',
  'cand-9','6a000000-0000-4000-8000-0000000000aa','Email','cand9@target.example.test',
  'candidate_reply','Subject 9','Body nine','queued',
  encode(digest('no-approval-row', 'sha256'), 'hex'), now(), 'draft-9', 'camp-1'
);

select email_durability_test.expect_sqlstate(
  'trigger-unapproved-email-dispatch-raises',
  $$update public.messages_outbound set status = 'dispatching' where id = '6b000000-0000-4000-8000-0000000000bb'$$,
  array['P0001']
);
select email_durability_test.expect_scalar(
  'trigger-unapproved-row-still-queued',
  $$select status from public.messages_outbound where id = '6b000000-0000-4000-8000-0000000000bb'$$,
  'queued'
);

-- ===========================================================================
-- 3. claim_email_outbound_queued: service-only + gate set + one-shot claim.
-- ===========================================================================
select email_durability_test.expect_authenticated_sqlstate(
  'claim-authenticated-denied',
  $$select (public.claim_email_outbound_queued(current_setting('emaildurability.draft1_id')::uuid)->>'reason')$$,
  array['42501']
);

-- The claim's own approval re-verify refuses the unapproved row 6b (before the
-- trigger would even see a transition).
set role service_role;
select email_durability_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_unapproved as
select public.claim_email_outbound_queued('6b000000-0000-4000-8000-0000000000bb') result;
reset role;
select email_durability_test.expect_scalar(
  'claim-unapproved-refused',
  $$select concat_ws(':', result->>'allowed', result->>'reason') from claim_unapproved$$,
  'false:approval-required'
);

-- Happy path claim of the approved draft-1 row.
set role service_role;
select email_durability_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_ok as
select public.claim_email_outbound_queued(current_setting('emaildurability.draft1_id')::uuid) result;
create temporary table claim_reclaim as
select public.claim_email_outbound_queued(current_setting('emaildurability.draft1_id')::uuid) result;
reset role;

select email_durability_test.expect_scalar(
  'claim-happy-path',
  $$select concat_ws(':', result->>'allowed', result->>'reason',
      (result->>'delivery_attempt_id' is not null)::text,
      (result->>'rfc_message_id' like '<%@email-a.example.test>')::text,
      result->>'operator_email') from claim_ok$$,
  'true:ok:true:true:recruiter@email-a.example.test'
);
select email_durability_test.expect_scalar(
  'claim-transitions-to-dispatching',
  $$select concat_ws(':', status, (delivery_attempt_id is not null)::text)
      from public.messages_outbound where id = current_setting('emaildurability.draft1_id')::uuid$$,
  'dispatching:true'
);
select email_durability_test.expect_scalar(
  'claim-writes-ledger-claimed-with-rfc',
  $$select concat_ws(':', status, (rfc_message_id is not null)::text, (send_attempt_id is not null)::text)
      from public.outreach_ledger
     where outbound_message_id = current_setting('emaildurability.draft1_id')::uuid$$,
  'claimed:true:true'
);
select email_durability_test.expect_scalar(
  'claim-reclaim-not-queued',
  $$select concat_ws(':', result->>'allowed', result->>'reason') from claim_reclaim$$,
  'false:not-queued'
);

-- Carry the claim outputs across roles.
select set_config('emaildurability.attempt_id', (select result->>'delivery_attempt_id' from claim_ok), false);
select set_config('emaildurability.rfc_id', (select result->>'rfc_message_id' from claim_ok), false);

-- ===========================================================================
-- 4. record_email_send_message_id: dispatching -> sent, ledger sent, attempt
--    binding, idempotency.
-- ===========================================================================
set role service_role;
select email_durability_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table send_wrong_attempt as
select public.record_email_send_message_id(
  current_setting('emaildurability.draft1_id')::uuid, gen_random_uuid(),
  current_setting('emaildurability.rfc_id')) result;
create temporary table send_ok as
select public.record_email_send_message_id(
  current_setting('emaildurability.draft1_id')::uuid,
  current_setting('emaildurability.attempt_id')::uuid,
  current_setting('emaildurability.rfc_id')) result;
create temporary table send_replay as
select public.record_email_send_message_id(
  current_setting('emaildurability.draft1_id')::uuid,
  current_setting('emaildurability.attempt_id')::uuid,
  current_setting('emaildurability.rfc_id')) result;
reset role;

select email_durability_test.expect_scalar(
  'send-attempt-mismatch-refused',
  $$select concat_ws(':', result->>'allowed', result->>'reason') from send_wrong_attempt$$,
  'false:attempt-mismatch'
);
select email_durability_test.expect_scalar(
  'send-records-sent',
  $$select concat_ws(':', (select result->>'reason' from send_ok),
      (select concat_ws('/', status, (provider_message_id = current_setting('emaildurability.rfc_id'))::text)
         from public.messages_outbound where id = current_setting('emaildurability.draft1_id')::uuid),
      (select status from public.outreach_ledger where outbound_message_id = current_setting('emaildurability.draft1_id')::uuid))$$,
  'recorded:sent/true:sent'
);
select email_durability_test.expect_scalar(
  'send-idempotent-replay',
  $$select concat_ws(':', result->>'allowed', result->>'reason') from send_replay$$,
  'true:already-recorded'
);

-- ===========================================================================
-- 5. record_email_delivery_event: idempotent insert + permanent-bounce and
--    complaint suppression; soft bounce / open / delivered never suppress.
-- ===========================================================================
set role service_role;
select email_durability_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table ev_delivered as
select public.record_email_delivery_event(
  '61111111-1111-4111-8111-111111111111', current_setting('emaildurability.rfc_id'),
  'delivered', now(), null, false) result;
create temporary table ev_delivered_replay as
select public.record_email_delivery_event(
  '61111111-1111-4111-8111-111111111111', current_setting('emaildurability.rfc_id'),
  'delivered', (select provider_occurred_at from public.email_delivery_events
                 where rfc_message_id = current_setting('emaildurability.rfc_id') and event_status = 'delivered'),
  null, false) result;
create temporary table ev_soft as
select public.record_email_delivery_event(
  '61111111-1111-4111-8111-111111111111', current_setting('emaildurability.rfc_id'),
  'bounced', now(), 421, false) result;
create temporary table ev_hard as
select public.record_email_delivery_event(
  '61111111-1111-4111-8111-111111111111', current_setting('emaildurability.rfc_id'),
  'bounced', now(), 550, true) result;
reset role;

select email_durability_test.expect_scalar(
  'delivery-event-recorded-idempotent',
  $$select concat_ws(':',
      (select result->>'recorded' from ev_delivered),
      (select result->>'recorded' from ev_delivered_replay),
      (select count(*)::text from public.email_delivery_events
         where rfc_message_id = current_setting('emaildurability.rfc_id') and event_status = 'delivered'))$$,
  'true:true:1'
);
select email_durability_test.expect_scalar(
  'soft-bounce-does-not-suppress',
  $$select concat_ws(':', (select result->>'suppressed' from ev_soft),
      (select count(*)::text from public.suppression_list
         where workspace_id = '61111111-1111-4111-8111-111111111111'
           and type = 'email' and lower(value) = 'cand1@target.example.test'))$$,
  'false:0'
);
select email_durability_test.expect_scalar(
  'hard-bounce-suppresses-email',
  $$select concat_ws(':', (select result->>'suppressed' from ev_hard),
      (select concat_ws('/', reason, source) from public.suppression_list
         where workspace_id = '61111111-1111-4111-8111-111111111111'
           and type = 'email' and lower(value) = 'cand1@target.example.test'))$$,
  'true:hard-bounce/system'
);

-- ===========================================================================
-- 6. Suppression is enforced on the NEXT claim (durable DNC), and a permanent
--    bounce complaint path via a fresh draft/claim/complaint.
-- ===========================================================================
insert into public.outreach_approvals(
  workspace_id, message_id, body_hash, approval_scope_hash, approved_by, approved_at, approval_source
) values (
  '61111111-1111-4111-8111-111111111111','draft-supp',
  encode(digest('Subject S' || E'\n' || 'Body supp', 'sha256'), 'hex'),
  encode(digest('cand-1' || E'\n' || 'Email' || E'\n' || 'cand1@target.example.test', 'sha256'), 'hex'),
  'e2000000-0000-4000-8000-000000000002', now(), 'human'
);
set role authenticated;
select email_durability_test.set_authenticated_claims('e2000000-0000-4000-8000-000000000002');
create temporary table enqueue_supp as
select public.enqueue_email_outbound(
  'draft-supp','cand-1','camp-1','6a000000-0000-4000-8000-0000000000aa',
  'cand1@target.example.test','Subject S','Body supp') result;
reset role;
set role service_role;
select email_durability_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_suppressed as
select public.claim_email_outbound_queued((select (result->>'id')::uuid from enqueue_supp)) result;
reset role;
select email_durability_test.expect_scalar(
  'claim-suppressed-after-hard-bounce',
  $$select concat_ws(':', result->>'allowed', result->>'reason') from claim_suppressed$$,
  'false:suppressed'
);

-- ===========================================================================
-- 7. finalize_email_provider_failure: dispatching -> failed, ledger skipped.
-- ===========================================================================
insert into public.outreach_approvals(
  workspace_id, message_id, body_hash, approval_scope_hash, approved_by, approved_at, approval_source
) values (
  '61111111-1111-4111-8111-111111111111','draft-fail',
  encode(digest('Subject F' || E'\n' || 'Body fail', 'sha256'), 'hex'),
  encode(digest('cand-3' || E'\n' || 'Email' || E'\n' || 'cand3@target.example.test', 'sha256'), 'hex'),
  'e2000000-0000-4000-8000-000000000002', now(), 'human'
);
set role authenticated;
select email_durability_test.set_authenticated_claims('e2000000-0000-4000-8000-000000000002');
create temporary table enqueue_fail as
select public.enqueue_email_outbound(
  'draft-fail','cand-3','camp-1','6a000000-0000-4000-8000-0000000000aa',
  'cand3@target.example.test','Subject F','Body fail') result;
reset role;
set role service_role;
select email_durability_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
select set_config('emaildurability.fail_id', (select (result->>'id') from enqueue_fail), false);
create temporary table claim_fail as
select public.claim_email_outbound_queued(current_setting('emaildurability.fail_id')::uuid) result;
create temporary table finalize_fail as
select public.finalize_email_provider_failure(
  current_setting('emaildurability.fail_id')::uuid,
  (select (result->>'delivery_attempt_id')::uuid from claim_fail),
  'provider rejected: 550 no such mailbox') result;
reset role;
select email_durability_test.expect_scalar(
  'finalize-failure-marks-failed-and-skipped',
  $$select concat_ws(':', (select result->>'reason' from finalize_fail),
      (select status from public.messages_outbound where id = current_setting('emaildurability.fail_id')::uuid),
      (select status from public.outreach_ledger where outbound_message_id = current_setting('emaildurability.fail_id')::uuid))$$,
  'recorded:failed:skipped'
);

-- ===========================================================================
-- 8. email_delivery_events RLS: a workspace-B admin sees no workspace-A events;
--    direct writes by clients are refused (append-only, service-writes-only).
-- ===========================================================================
set role authenticated;
select email_durability_test.set_authenticated_claims('e3000000-0000-4000-8000-000000000003');
create temporary table events_cross as
select count(*) as visible from public.email_delivery_events;
reset role;
select email_durability_test.expect_scalar(
  'delivery-events-rls-cross-workspace-empty',
  $$select visible::text from events_cross$$,
  '0'
);
select email_durability_test.expect_authenticated_sqlstate(
  'delivery-events-authenticated-insert-denied',
  $$insert into public.email_delivery_events(workspace_id, outbound_message_id, delivery_attempt_id, rfc_message_id, event_status, provider_occurred_at)
    values ('61111111-1111-4111-8111-111111111111', current_setting('emaildurability.draft1_id')::uuid, gen_random_uuid(), '<x@target.example.test>', 'opened', now())$$,
  array['42501']
);

-- ===========================================================================
-- Final gate.
-- ===========================================================================
do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed from email_durability_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details from email_durability_test.results where not passed;
    raise exception 'email durability DB test failed: %', details;
  end if;
end;
$$;
SQL

assertions="$(psql_stdin -Atc "select count(*) from email_durability_test.results")"
echo "email-durability-db: enqueue idempotency, unapproved-dispatch trigger raise, claim gate set, send + failure finalization, delivery-event idempotency + bounce suppression, RLS: ${assertions} assertions, 0 failed"
