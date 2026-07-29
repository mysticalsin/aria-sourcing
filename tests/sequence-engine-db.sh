#!/usr/bin/env bash
# sequence-engine-db.sh — disposable-Postgres proof for Rock 6 sequence authority.
#
# Proves, against the full migration chain: identity-keyed suppression with
# expires_at, campaign exclusions, re-contact window release/refusal, atomic
# workspace sequence send cap under concurrent schedulers, approval-required
# scheduling, DAG cycle rejection, seat warmup/gap/cap refusals, credit debits,
# dark switchboard behavior, and inbox correlation to the producing step.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-sequence-engine-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
migration_log="$(mktemp /tmp/aria-sequence-migration.XXXXXX)"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$migration_log"
}
trap cleanup EXIT

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_at() {
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres -qAtc "$1"
}

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  if ! psql_stdin -q < "$migration" >"$migration_log" 2>&1; then
    echo "migration failed: $migration" >&2
    tail -n 80 "$migration_log" >&2
    exit 1
  fi
done

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema sequence_engine_test;

create table sequence_engine_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function sequence_engine_test.expect(p_case_name text, p_passed boolean, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, sequence_engine_test
as $$
begin
  insert into sequence_engine_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;
alter function sequence_engine_test.expect(text, boolean, text) owner to postgres;

create function sequence_engine_test.expect_scalar(p_case_name text, p_statement text, p_expected text)
returns void
language plpgsql
set search_path = pg_catalog, public, sequence_engine_test
as $$
declare actual text;
begin
  execute p_statement into actual;
  perform sequence_engine_test.expect(
    p_case_name,
    actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function sequence_engine_test.expect_sqlstate(p_case_name text, p_statement text, p_expected_codes text[])
returns void
language plpgsql
set search_path = pg_catalog, public, sequence_engine_test
as $$
declare caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform sequence_engine_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform sequence_engine_test.expect(p_case_name, false, 'statement unexpectedly succeeded');
end;
$$;

create function sequence_engine_test.set_service_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', subject, 'role', 'service_role')::text, false);
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function sequence_engine_test.call_claim(step_id uuid)
returns json
language plpgsql
set search_path = pg_catalog, public, sequence_engine_test
as $$
begin
  perform sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
  return public.claim_sequence_step_for_schedule(step_id);
end;
$$;

grant usage on schema sequence_engine_test to service_role, authenticated;
grant execute on all functions in schema sequence_engine_test to service_role, authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'e1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'seq-admin@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.workspaces(id, name, allowed_domain)
values ('e2000000-0000-4000-8000-000000000001', 'Sequence Engine', 'example.test');

insert into public.profiles(id, email, full_name, workspace_id, role)
values (
  'e1000000-0000-4000-8000-000000000001',
  'seq-admin@example.test',
  'Sequence Admin',
  'e2000000-0000-4000-8000-000000000001',
  'admin'
);

insert into public.workspace_state(workspace_id, state)
values ('e2000000-0000-4000-8000-000000000001', '{"campaigns":[],"candidates":[],"replies":[],"activities":[]}'::jsonb);

insert into public.agent_seats(
  id, workspace_id, name, operator_email, provider, status, mode,
  domain_verified, daily_limit, warmup, warmup_start_cap, warmup_step_per_day,
  warmup_started_at, min_gap_minutes
) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'Primary seat', 'sender@example.test', 'Microsoft Graph', 'active', 'live', true, 10, false, 10, 1, now() - interval '10 days', 0),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'Warmup seat', 'warmup@example.test', 'Microsoft Graph', 'active', 'live', true, 10, true, 2, 1, now(), 0),
  ('e3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'Gap seat', 'gap@example.test', 'Microsoft Graph', 'active', 'live', true, 10, false, 10, 1, now(), 12);

insert into public.outreach_sequence_credit_accounts(workspace_id, credits_available)
values ('e2000000-0000-4000-8000-000000000001', 100);

update public.sourcing_loop_controls
   set kill_switch = false,
       sequences_enabled = true,
       max_sequence_sends_per_day = 50,
       updated_by = 'e1000000-0000-4000-8000-000000000001',
       updated_at = now()
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';

insert into public.candidates(
  workspace_id, campaign_id, id, email, linkedin_url, payload, mirrored_at
) values
  ('e2000000-0000-4000-8000-000000000001', 'camp-supp', 'cand-supp', 'suppressed@example.test', 'https://linkedin.example/in/suppressed', '{}'::jsonb, now()),
  ('e2000000-0000-4000-8000-000000000001', 'camp-expired', 'cand-expired', 'expired@example.test', null, '{}'::jsonb, now()),
  ('e2000000-0000-4000-8000-000000000001', 'camp-excl', 'cand-excl', 'excluded@example.test', null, '{}'::jsonb, now()),
  ('e2000000-0000-4000-8000-000000000001', 'camp-window', 'cand-old', 'old@example.test', null, '{}'::jsonb, now()),
  ('e2000000-0000-4000-8000-000000000001', 'camp-window', 'cand-new', 'new@example.test', null, '{}'::jsonb, now());

insert into public.suppression_list(workspace_id, type, value, reason, source)
values ('e2000000-0000-4000-8000-000000000001', 'email', 'suppressed@example.test', 'test', 'sequence-test');
insert into public.suppression_list(workspace_id, type, value, reason, source, expires_at)
values ('e2000000-0000-4000-8000-000000000001', 'email', 'expired@example.test', 'test', 'sequence-test', now() - interval '1 day');
insert into public.outreach_campaign_exclusions(workspace_id, campaign_id, exclusion_kind, value, reason)
values ('e2000000-0000-4000-8000-000000000001', 'camp-excl', 'candidate', 'cand-excl', 'test');

insert into public.outreach_approvals(workspace_id, message_id, body_hash, approval_scope_hash, approved_by, approval_source)
select 'e2000000-0000-4000-8000-000000000001', 'msg-' || n::text, repeat('a', 64), repeat('b', 64),
       'e1000000-0000-4000-8000-000000000001', 'human'
from generate_series(1, 80) n;

select sequence_engine_test.expect_sqlstate(
  'cycle-rejected-at-save-time',
  $$
    set local role service_role;
    select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
    select public.create_outreach_sequence(
      'e2000000-0000-4000-8000-000000000001',
      'cand-cycle',
      'camp-cycle',
      2,
      jsonb_build_array(
        jsonb_build_object('stepKey','a','nextStepKeys',jsonb_build_array('b'),'channel','Email','messageId','msg-1','body','A','bodyHash',repeat('a',64),'scopeHash',repeat('b',64),'seatId','e3000000-0000-4000-8000-000000000001'),
        jsonb_build_object('stepKey','b','nextStepKeys',jsonb_build_array('a'),'channel','Email','messageId','msg-2','body','B','bodyHash',repeat('a',64),'scopeHash',repeat('b',64),'seatId','e3000000-0000-4000-8000-000000000001')
      )
    );
  $$,
  array['23514']
);

create function sequence_engine_test.add_due_step(
  seq_id uuid,
  step_id uuid,
  candidate text,
  campaign text,
  message_id text,
  seat_id uuid default 'e3000000-0000-4000-8000-000000000001'
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.outreach_sequences(id, workspace_id, candidate_id, campaign_id, status, max_touches)
  values (seq_id, 'e2000000-0000-4000-8000-000000000001', candidate, campaign, 'active', 1);
  insert into public.outreach_sequence_steps(
    id, sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash,
    status, scheduled_at, step_key, seat_id
  ) values (
    step_id, seq_id, 0, 0, 'Email', message_id, 'Body', repeat('a',64), repeat('b',64),
    'due', now() - interval '1 minute', 'step-0', seat_id
  );
end;
$$;

select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','cand-supp','camp-supp','msg-1');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_suppressed as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000001') r;
reset role;
select sequence_engine_test.expect_scalar('suppressed-candidate-refused',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_suppressed$$, 'false:suppressed');
select sequence_engine_test.expect_scalar('suppression-refusal-recorded',
  $$select count(*)::text from public.outreach_sequence_refusals where reason='suppressed'$$, '1');

select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000002','cand-expired','camp-expired','msg-2');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_expired as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000002') r;
reset role;
select sequence_engine_test.expect_scalar('expired-suppression-does-not-block',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_expired$$, 'true:scheduled');

select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000003','e5000000-0000-4000-8000-000000000003','cand-excl','camp-excl','msg-3');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_excluded as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000003') r;
reset role;
select sequence_engine_test.expect_scalar('campaign-exclusion-refused',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_excluded$$, 'false:campaign_excluded');

insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status, at)
values ('e2000000-0000-4000-8000-000000000001','cand-old','old@example.test','e3000000-0000-4000-8000-000000000001','camp-window','Email','sent', now() - interval '91 days');
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000004','e5000000-0000-4000-8000-000000000004','cand-old','camp-window','msg-4');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_old_contact as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000004') r;
reset role;
select sequence_engine_test.expect_scalar('recontact-window-opens-after-90-days',
  $$select concat_ws(':', (select r->>'ok' from claim_old_contact),
    (select count(*)::text from public.outreach_ledger where candidate_id='cand-old' and status='recontact_elapsed'))$$,
  'true:1');

insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status, at)
values ('e2000000-0000-4000-8000-000000000001','cand-new','new@example.test','e3000000-0000-4000-8000-000000000001','camp-window','Email','sent', now() - interval '10 days');
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000005','e5000000-0000-4000-8000-000000000005','cand-new','camp-window','msg-5');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_new_contact as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000005') r;
reset role;
select sequence_engine_test.expect_scalar('recontact-window-closes-inside-90-days',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_new_contact$$, 'false:recently-contacted');

select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000006','e5000000-0000-4000-8000-000000000006','cand-noapproval','camp-approval','missing-approval');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_noapproval as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000006') r;
reset role;
select sequence_engine_test.expect_scalar('sequence-step-cannot-schedule-without-approval',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_noapproval$$, 'false:approval-required');

update public.sourcing_loop_controls
   set sequences_enabled = false,
       max_sequence_sends_per_day = 50,
       updated_at = now()
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000007','e5000000-0000-4000-8000-000000000007','cand-dark','camp-dark','msg-7');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_dark as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000007') r;
create temporary table promote_dark as select public.promote_due_sequence_steps('e2000000-0000-4000-8000-000000000001', 10) n;
reset role;
select sequence_engine_test.expect_scalar('sequences-enabled-false-schedules-nothing',
  $$select concat_ws(':', (select r->>'ok' from claim_dark), (select r->>'reason' from claim_dark), (select n::text from promote_dark))$$,
  'false:sequences_disabled:0');
update public.sourcing_loop_controls
   set sequences_enabled = true,
       updated_at = now()
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';

update public.sourcing_loop_controls set max_sequence_sends_per_day = 1
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';
insert into public.outreach_sequences(id, workspace_id, candidate_id, campaign_id, status, max_touches)
values ('e4000000-0000-4000-8000-000000000008','e2000000-0000-4000-8000-000000000001','cand-cap-seed','camp-cap','active',1);
insert into public.outreach_sequence_steps(id, sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash, status, scheduled_at, step_key, seat_id)
values ('e5000000-0000-4000-8000-000000000008','e4000000-0000-4000-8000-000000000008',0,0,'Email','msg-8','Body',repeat('a',64),repeat('b',64),'scheduled',now(),'step-0','e3000000-0000-4000-8000-000000000001');
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000009','e5000000-0000-4000-8000-000000000009','cand-cap-block','camp-cap','msg-9');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_at_cap as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000009') r;
reset role;
select sequence_engine_test.expect_scalar('workspace-sequence-daily-cap-refuses-next',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_at_cap$$, 'false:sequence_daily_cap_reached');

update public.sourcing_loop_controls set max_sequence_sends_per_day = 50
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';
insert into public.outreach_sequences(id, workspace_id, candidate_id, campaign_id, status, max_touches)
values ('e4000000-0000-4000-8000-000000000010','e2000000-0000-4000-8000-000000000001','cand-seat-seed','camp-seat','active',1);
insert into public.outreach_sequence_steps(id, sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash, status, scheduled_at, step_key, seat_id)
values
  ('e5000000-0000-4000-8000-000000000010','e4000000-0000-4000-8000-000000000010',0,0,'Email','msg-10','Body',repeat('a',64),repeat('b',64),'scheduled',now(),'step-0','e3000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000011','e4000000-0000-4000-8000-000000000010',1,0,'Email','msg-11','Body',repeat('a',64),repeat('b',64),'scheduled',now(),'step-1','e3000000-0000-4000-8000-000000000002');
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000012','e5000000-0000-4000-8000-000000000012','cand-warmup','camp-seat','msg-12','e3000000-0000-4000-8000-000000000002');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_warmup as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000012') r;
reset role;
select sequence_engine_test.expect_scalar('warmup-effective-cap-refuses-at-start-cap',
  $$select concat_ws(':', r->>'ok', r->>'reason', r->>'limit') from claim_warmup$$, 'false:seat-daily-cap-reached:2');

insert into public.outreach_sequences(id, workspace_id, candidate_id, campaign_id, status, max_touches)
values ('e4000000-0000-4000-8000-000000000013','e2000000-0000-4000-8000-000000000001','cand-gap-seed','camp-gap','active',1);
insert into public.outreach_sequence_steps(id, sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash, status, scheduled_at, step_key, seat_id)
values ('e5000000-0000-4000-8000-000000000013','e4000000-0000-4000-8000-000000000013',0,0,'Email','msg-13','Body',repeat('a',64),repeat('b',64),'scheduled',now() - interval '5 minutes','step-0','e3000000-0000-4000-8000-000000000003');
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000014','e5000000-0000-4000-8000-000000000014','cand-gap','camp-gap','msg-14','e3000000-0000-4000-8000-000000000003');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_gap as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000014') r;
reset role;
select sequence_engine_test.expect_scalar('seat-min-gap-refuses',
  $$select concat_ws(':', r->>'ok', r->>'reason') from claim_gap$$, 'false:seat-min-gap');

update public.outreach_sequence_credit_accounts
   set credits_available = 0
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';
select sequence_engine_test.add_due_step('e4000000-0000-4000-8000-000000000015','e5000000-0000-4000-8000-000000000015','cand-credit','camp-credit','msg-15');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table claim_credit as select public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-000000000015') r;
reset role;
select sequence_engine_test.expect_scalar('credits-exhausted-refuses-and-records',
  $$select concat_ws(':', (select r->>'ok' from claim_credit), (select r->>'reason' from claim_credit),
    (select count(*)::text from public.outreach_sequence_refusals where reason='credits-exhausted'))$$,
  'false:credits-exhausted:1');
update public.outreach_sequence_credit_accounts
   set credits_available = 100
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';

insert into public.outreach_sequences(id, workspace_id, candidate_id, campaign_id, status, max_touches)
values ('e4000000-0000-4000-8000-000000000016','e2000000-0000-4000-8000-000000000001','cand-advance','camp-advance','active',2);
insert into public.outreach_sequence_steps(id, sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash, status, scheduled_at, step_key, next_step_keys, seat_id)
values
  ('e5000000-0000-4000-8000-000000000016','e4000000-0000-4000-8000-000000000016',0,0,'Email','msg-16','Body',repeat('a',64),repeat('b',64),'scheduled',now() - interval '1 day','step-0',array['step-1'],'e3000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000017','e4000000-0000-4000-8000-000000000016',1,0,'Email','msg-17','Body',repeat('a',64),repeat('b',64),'waiting',null,'step-1','{}','e3000000-0000-4000-8000-000000000001');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table sent_step as select public.record_sequence_step_sent('e5000000-0000-4000-8000-000000000016', null) r;
create temporary table promoted_step as select public.promote_due_sequence_steps('e2000000-0000-4000-8000-000000000001', 10) n;
reset role;
select sequence_engine_test.expect_scalar('sent-step-promotes-next-after-gap',
  $$select concat_ws(':', (select r->>'ok' from sent_step), (select n::text from promoted_step),
    (select status from public.outreach_sequence_steps where id='e5000000-0000-4000-8000-000000000017'))$$,
  'true:1:due');

insert into public.outreach_ledger(
  id, workspace_id, candidate_id, candidate_email, campaign_id, channel, status,
  rfc_message_id, sequence_id, sequence_step_id
) values (
  'e6000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'cand-inbox', 'inbox@example.test', 'camp-inbox', 'Email', 'sent',
  '<seq-inbox@example.test>',
  'e4000000-0000-4000-8000-000000000016',
  'e5000000-0000-4000-8000-000000000016'
);
insert into public.messages_inbound(id, workspace_id, channel, from_address, body, provider_id)
values ('e7000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Email','inbox@example.test','Reply','provider-inbox');
set role service_role; select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
create temporary table inbox_corr as select public.correlate_inbound_email('e7000000-0000-4000-8000-000000000001','<seq-inbox@example.test>') r;
reset role;
select sequence_engine_test.expect_scalar('unified-inbox-correlates-to-sequence-step',
  $$select concat_ws(':', (select r->>'correlated' from inbox_corr),
    (select campaign_id from public.messages_inbound where id='e7000000-0000-4000-8000-000000000001'),
    (select sequence_step_id::text from public.messages_inbound where id='e7000000-0000-4000-8000-000000000001'))$$,
  'true:camp-inbox:e5000000-0000-4000-8000-000000000016');
select sequence_engine_test.expect_scalar('unified-inbox-populates-sequence-linkage',
  $$select concat_ws(':', (select r->>'sequence_id' from inbox_corr),
    (select r->>'sequence_step_id' from inbox_corr),
    (select sequence_id::text from public.messages_inbound where id='e7000000-0000-4000-8000-000000000001'),
    (select sequence_step_id::text from public.messages_inbound where id='e7000000-0000-4000-8000-000000000001'))$$,
  'e4000000-0000-4000-8000-000000000016:e5000000-0000-4000-8000-000000000016:e4000000-0000-4000-8000-000000000016:e5000000-0000-4000-8000-000000000016');

do $$
declare failed integer; details text;
begin
  select count(*) into failed from sequence_engine_test.results where not passed;
  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details
      from sequence_engine_test.results
     where not passed;
    raise exception 'sequence engine DB test failed: %', details;
  end if;
end;
$$;
SQL

psql_stdin -q <<'SQL'
update public.sourcing_loop_controls
   set max_sequence_sends_per_day = 1,
       kill_switch = false,
       sequences_enabled = true,
       updated_by = 'e1000000-0000-4000-8000-000000000001',
       updated_at = now()
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';
update public.outreach_sequence_steps
   set scheduled_at = now() - interval '2 days'
 where status in ('scheduled', 'sent')
   and sequence_id in (
     select id from public.outreach_sequences
      where workspace_id = 'e2000000-0000-4000-8000-000000000001'
   );
update public.outreach_sequence_credit_accounts
   set credits_available = 20
 where workspace_id = 'e2000000-0000-4000-8000-000000000001';
delete from public.outreach_sequence_steps where id in (
  'e5000000-0000-4000-8000-000000000071',
  'e5000000-0000-4000-8000-000000000072'
);
delete from public.outreach_sequences where id in (
  'e4000000-0000-4000-8000-000000000071',
  'e4000000-0000-4000-8000-000000000072'
);
insert into public.outreach_sequences(id, workspace_id, candidate_id, campaign_id, status, max_touches)
values
  ('e4000000-0000-4000-8000-000000000071','e2000000-0000-4000-8000-000000000001','race-cand-1','camp-race','active',1),
  ('e4000000-0000-4000-8000-000000000072','e2000000-0000-4000-8000-000000000001','race-cand-2','camp-race','active',1);
insert into public.outreach_sequence_steps(id, sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash, status, scheduled_at, step_key, seat_id)
values
  ('e5000000-0000-4000-8000-000000000071','e4000000-0000-4000-8000-000000000071',0,0,'Email','msg-71','Body',repeat('a',64),repeat('b',64),'due',now() - interval '1 minute','step-0','e3000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-000000000072','e4000000-0000-4000-8000-000000000072',0,0,'Email','msg-72','Body',repeat('a',64),repeat('b',64),'due',now() - interval '1 minute','step-0','e3000000-0000-4000-8000-000000000001');
SQL

race_dir="$(mktemp -d)"
pids=()
for step in 71 72; do
  psql_stdin -Atq >"${race_dir}/claim-${step}.out" <<RACE &
set role service_role;
select sequence_engine_test.set_service_claims('e1000000-0000-4000-8000-000000000001');
select (public.claim_sequence_step_for_schedule('e5000000-0000-4000-8000-0000000000${step}') ->> 'ok');
RACE
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
successes="$(grep -h '^true$' "${race_dir}"/claim-*.out | wc -l | tr -d ' ')"
scheduled="$(psql_at "select count(*) from public.outreach_sequence_steps where id in ('e5000000-0000-4000-8000-000000000071','e5000000-0000-4000-8000-000000000072') and status='scheduled'")"
rm -rf "$race_dir"
if [ "$successes" != "1" ] || [ "$scheduled" != "1" ]; then
  echo "sequence-engine-db: sequence daily cap race FAILED (successes=${successes}, scheduled=${scheduled}, expected 1)" >&2
  exit 1
fi

assertions="$(psql_at "select count(*) from sequence_engine_test.results")"
echo "sequence-engine-db: suppression, exclusions, recontact, approvals, dark gate, seats, credits, DAG, inbox: ${assertions} assertions + sequence cap race, 0 failed"
