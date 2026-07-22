#!/usr/bin/env bash
# loop-jobs-db.sh — disposable-Postgres proof for migration 0038 (job spine).
#
# ⚠️ DEGRADED provenance: built solo-visionary (Integrator usage-limited until
# 2026-07-23); Owner acknowledged hybrid build in-conversation (meeting 024).
#
# Proves, against the full migration chain:
#   enqueue idempotency (lock-and-return, payload-drift conflict), claim
#   leasing (single-claim, SKIP LOCKED under a concurrent open transaction),
#   heartbeat lease binding, one-shot completion with transactional
#   events+follow-ons (including full rollback when a follow-on conflicts),
#   retry backoff schedule, dead-letter at max attempts, both lease reapers,
#   admin-gated requeue + controls, the fail-closed controls CHECK, the
#   append-only loop_events guard, and RLS/ACL denial for every table.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-loop-jobs-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
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
  psql_stdin -q < "$migration"
done
psql_stdin -q < tests/db/gotrue-lifecycle-fixture.sql

psql_stdin -q <<'SQL'
\set ON_ERROR_STOP on

create schema loop_jobs_test;

create table loop_jobs_test.results (
  case_name text primary key,
  passed boolean not null,
  detail text
);

create function loop_jobs_test.expect(
  p_case_name text,
  p_passed boolean,
  p_detail text default null
) returns void
language plpgsql
set search_path = pg_catalog, public, loop_jobs_test
as $$
begin
  insert into loop_jobs_test.results(case_name, passed, detail)
  values (p_case_name, p_passed, p_detail);
end;
$$;

create function loop_jobs_test.expect_scalar(
  p_case_name text,
  p_statement text,
  p_expected text
) returns void
language plpgsql
set search_path = pg_catalog, public, loop_jobs_test
as $$
declare
  actual text;
begin
  execute p_statement into actual;
  perform loop_jobs_test.expect(
    p_case_name,
    actual is not distinct from p_expected,
    format('actual=%s expected=%s', coalesce(actual, '<null>'), p_expected)
  );
end;
$$;

create function loop_jobs_test.expect_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, loop_jobs_test
as $$
declare
  caught text;
begin
  begin
    execute p_statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    perform loop_jobs_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  perform loop_jobs_test.expect(
    p_case_name,
    false,
    'statement unexpectedly succeeded'
  );
end;
$$;

create function loop_jobs_test.expect_authenticated_sqlstate(
  p_case_name text,
  p_statement text,
  p_expected_codes text[]
) returns void
language plpgsql
set search_path = pg_catalog, public, loop_jobs_test
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
    perform loop_jobs_test.expect(
      p_case_name,
      caught = any(p_expected_codes),
      format('sqlstate=%s expected=%s', caught, p_expected_codes::text)
    );
    return;
  end;
  execute 'reset role';
  perform loop_jobs_test.expect(
    p_case_name,
    false,
    'statement unexpectedly succeeded'
  );
end;
$$;

create function loop_jobs_test.set_service_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'service_role')::text,
    false
  );
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end;
$$;

create function loop_jobs_test.set_authenticated_claims(subject uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', 'authenticated')::text,
    false
  );
  perform set_config('request.jwt.claim.sub', subject::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end;
$$;

create function loop_jobs_test.clear_claims()
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', '', false);
end;
$$;

grant usage on schema loop_jobs_test to service_role, authenticated;
grant execute on all functions in schema loop_jobs_test to service_role, authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','loop-admin-a@example.test','',now(),'{}','{}',now(),now()),
  ('c2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000002','authenticated','authenticated','loop-member-a@example.test','',now(),'{}','{}',now(),now()),
  ('c3000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','loop-admin-b@example.test','',now(),'{}','{}',now(),now());

insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111','Loop A','loop-a.example.test'),
  ('52222222-2222-4222-8222-222222222222','Loop B','loop-b.example.test');

insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001','loop-admin-a@example.test','Loop Admin A','51111111-1111-4111-8111-111111111111','admin'),
  ('c2000000-0000-4000-8000-000000000002','loop-member-a@example.test','Loop Member A','51111111-1111-4111-8111-111111111111','member'),
  ('c3000000-0000-4000-8000-000000000003','loop-admin-b@example.test','Loop Admin B','52222222-2222-4222-8222-222222222222','admin');

-- ---------------------------------------------------------------------------
-- 1. Seeding: the workspaces above were created AFTER the trigger existed.
-- ---------------------------------------------------------------------------
select loop_jobs_test.expect_scalar(
  'controls-seeded-fail-closed',
  $$select concat_ws(':', kill_switch::text, intake_enabled::text, sourcing_enabled::text,
                     enrichment_enabled::text, sequences_enabled::text)
      from public.sourcing_loop_controls
     where workspace_id = '51111111-1111-4111-8111-111111111111'$$,
  'true:false:false:false:false'
);

-- ---------------------------------------------------------------------------
-- 2. Enqueue: idempotent lock-and-return + payload-drift conflict.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');

create temporary table enqueue_first as
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'provider_poll', 'batch:camp-1:001',
  '{"campaignId":"camp-1"}'::jsonb, now(), 100
) result;

create temporary table enqueue_replay as
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'provider_poll', 'batch:camp-1:001',
  '{"campaignId":"camp-1"}'::jsonb, now(), 100
) result;

create temporary table enqueue_drift as
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'provider_poll', 'batch:camp-1:001',
  '{"campaignId":"camp-OTHER"}'::jsonb, now(), 100
) result;

create temporary table enqueue_bad_kind as
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'not_a_kind', 'batch:camp-1:002',
  '{}'::jsonb, now(), 100
) result;

reset role;

select loop_jobs_test.expect_scalar(
  'enqueue-first',
  $$select concat_ws(':', result->>'status', result->>'replay') from enqueue_first$$,
  'enqueued:false'
);
select loop_jobs_test.expect_scalar(
  'enqueue-replay-lock-and-return',
  $$select concat_ws(':', a.result->>'status', a.result->>'replay',
                     (a.result->>'id' = b.result->>'id')::text)
      from enqueue_replay a, enqueue_first b$$,
  'enqueued:true:true'
);
select loop_jobs_test.expect_scalar(
  'enqueue-payload-drift-conflict',
  $$select result->>'status' from enqueue_drift$$,
  'idempotency_conflict'
);
select loop_jobs_test.expect_scalar(
  'enqueue-invalid-kind',
  $$select result->>'status' from enqueue_bad_kind$$,
  'invalid_request'
);
select loop_jobs_test.expect_authenticated_sqlstate(
  'enqueue-authenticated-denied',
  $$select public.enqueue_aria_job('51111111-1111-4111-8111-111111111111','provider_poll','batch:x:0000001','{}'::jsonb, now(), 100)$$,
  array['42501']
);

-- ---------------------------------------------------------------------------
-- 3. Claim: leases the job once; a leased job is never re-claimable.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');

create temporary table claim_first as
select id, kind, status, lease_id, attempt_count, claimed_by
  from public.claim_due_aria_jobs('worker-test-1', 120, array['provider_poll'], 10);

create temporary table claim_second as
select id from public.claim_due_aria_jobs('worker-test-2', 120, array['provider_poll'], 10);

reset role;

select loop_jobs_test.expect_scalar(
  'claim-leases-once',
  $$select concat_ws(':', count(*)::text, min(status), min(attempt_count)::text, min(claimed_by))
      from claim_first$$,
  '1:leased:1:worker-test-1'
);
select loop_jobs_test.expect_scalar(
  'claim-leased-not-reclaimable',
  $$select count(*)::text from claim_second$$,
  '0'
);

-- ---------------------------------------------------------------------------
-- 4. Heartbeat: lease-bound extension.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table heartbeat_results as
select
  public.heartbeat_aria_job((select id from claim_first), (select lease_id from claim_first), 300) as with_lease,
  public.heartbeat_aria_job((select id from claim_first), gen_random_uuid(), 300) as wrong_lease;
reset role;

select loop_jobs_test.expect_scalar(
  'heartbeat-lease-bound',
  $$select concat_ws(':', with_lease::text, wrong_lease::text) from heartbeat_results$$,
  'true:false'
);

-- ---------------------------------------------------------------------------
-- 5. Complete: one-shot; events + follow-on land in the SAME transaction.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table complete_results as
select
  public.complete_aria_job(
    (select id from claim_first), (select lease_id from claim_first), repeat('a', 64),
    '[{"event_type":"sourcing.batch_done","subject_kind":"campaign","subject_id":"camp-1","payload":{"count":7}}]'::jsonb,
    '[{"kind":"provider_poll","idempotency_key":"poll:camp-1:001","payload":{"campaignId":"camp-1"}}]'::jsonb
  ) as first_complete;
create temporary table complete_replay as
select public.complete_aria_job(
  (select id from claim_first), (select lease_id from claim_first), repeat('a', 64),
  '[]'::jsonb, '[]'::jsonb
) as second_complete;
reset role;

select loop_jobs_test.expect_scalar(
  'complete-one-shot',
  $$select concat_ws(':', (select first_complete from complete_results)::text,
                     (select second_complete from complete_replay)::text)$$,
  'true:false'
);
select loop_jobs_test.expect_scalar(
  'complete-writes-event',
  $$select count(*)::text from public.loop_events
     where workspace_id = '51111111-1111-4111-8111-111111111111'
       and event_type = 'sourcing.batch_done' and subject_id = 'camp-1'$$,
  '1'
);
select loop_jobs_test.expect_scalar(
  'complete-enqueues-follow-on',
  $$select concat_ws(':', status, kind) from public.aria_jobs
     where workspace_id = '51111111-1111-4111-8111-111111111111'
       and idempotency_key = 'poll:camp-1:001'$$,
  'queued:provider_poll'
);

-- ---------------------------------------------------------------------------
-- 6. Transactional outbox: a conflicting follow-on rolls back the WHOLE
--    completion — the job stays leased, no event row survives.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.enqueue_aria_job(
  '51111111-1111-4111-8111-111111111111', 'email_sync', 'sync:conn-1:bucket-1',
  '{"connectionId":"conn-1"}'::jsonb, now(), 100
);
create temporary table outbox_claim as
select id, lease_id from public.claim_due_aria_jobs('worker-test-3', 120, array['email_sync'], 1);
reset role;

-- The follow-on reuses poll:camp-1:001 with a DIFFERENT payload -> 22023.
select loop_jobs_test.expect_sqlstate(
  'complete-follow-on-conflict-raises',
  $$
    do $body$
    begin
      set local role service_role;
      perform loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
      perform public.complete_aria_job(
        (select id from outbox_claim), (select lease_id from outbox_claim), null,
        '[{"event_type":"email.sync_done"}]'::jsonb,
        '[{"kind":"provider_poll","idempotency_key":"poll:camp-1:001","payload":{"campaignId":"DIFFERENT"}}]'::jsonb
      );
    end;
    $body$
  $$,
  array['22023']
);
select loop_jobs_test.expect_scalar(
  'complete-rollback-job-still-leased',
  $$select status from public.aria_jobs where id = (select id from outbox_claim)$$,
  'leased'
);
select loop_jobs_test.expect_scalar(
  'complete-rollback-no-event',
  $$select count(*)::text from public.loop_events where event_type = 'email.sync_done'$$,
  '0'
);

-- ---------------------------------------------------------------------------
-- 7. Fail: retry backoff schedule, then dead-letter at max attempts.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table fail_retry as
select public.fail_aria_job(
  (select id from outbox_claim), (select lease_id from outbox_claim), 'provider timeout', true
) as outcome;
reset role;

select loop_jobs_test.expect_scalar(
  'fail-retryable-requeues',
  $$select outcome from fail_retry$$,
  'queued'
);
-- attempt_count = 1 after the claim, so backoff = 1min * 2^1 + jitter(<=30s).
select loop_jobs_test.expect_scalar(
  'fail-backoff-schedule',
  $$select (next_run_at > now() + interval '110 seconds'
        and next_run_at <= now() + interval '160 seconds')::text
      from public.aria_jobs where id = (select id from outbox_claim)$$,
  'true'
);

-- Exhaust attempts: force the job due, claim+fail until dead.
update public.aria_jobs
   set max_attempts = 2, next_run_at = now() - interval '1 second'
 where id = (select id from outbox_claim);

set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table final_claim as
select id, lease_id, attempt_count from public.claim_due_aria_jobs('worker-test-4', 120, array['email_sync'], 1);
create temporary table fail_final as
select public.fail_aria_job(
  (select id from final_claim), (select lease_id from final_claim), 'provider timeout again', true
) as outcome;
reset role;

select loop_jobs_test.expect_scalar(
  'fail-dead-at-max-attempts',
  $$select concat_ws(':', (select outcome from fail_final),
                     (select status from public.aria_jobs where id = (select id from final_claim)))$$,
  'dead:dead'
);
select loop_jobs_test.expect_scalar(
  'dead-letter-event-written',
  $$select count(*)::text from public.loop_events
     where event_type = 'job.dead' and subject_id = (select id from final_claim)::text$$,
  '1'
);

-- Temp tables created under service_role are unreadable by other roles; hand
-- the dead job id to the role-switched requeue scenarios through a GUC.
select set_config('loopjobs.final_claim_id', (select id::text from final_claim), false);

-- ---------------------------------------------------------------------------
-- 8. Requeue: workspace-admin only, own-workspace only, dead-only.
-- ---------------------------------------------------------------------------
select loop_jobs_test.expect_sqlstate(
  'requeue-member-denied',
  $$
    do $body$
    begin
      set local role authenticated;
      perform loop_jobs_test.set_authenticated_claims('c2000000-0000-4000-8000-000000000002');
      perform public.requeue_dead_aria_job(current_setting('loopjobs.final_claim_id')::uuid);
    end;
    $body$
  $$,
  array['42501']
);

set role authenticated;
select loop_jobs_test.set_authenticated_claims('c3000000-0000-4000-8000-000000000003');
create temporary table requeue_cross_workspace as
select public.requeue_dead_aria_job(current_setting('loopjobs.final_claim_id')::uuid) as outcome;
reset role;

select loop_jobs_test.expect_scalar(
  'requeue-cross-workspace-refused',
  $$select outcome::text from requeue_cross_workspace$$,
  'false'
);

set role authenticated;
select loop_jobs_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table requeue_admin as
select public.requeue_dead_aria_job(current_setting('loopjobs.final_claim_id')::uuid) as outcome;
reset role;

select loop_jobs_test.expect_scalar(
  'requeue-admin-succeeds',
  $$select concat_ws(':', (select outcome::text from requeue_admin),
                     (select concat_ws('/', status, attempt_count::text)
                        from public.aria_jobs where id = (select id from final_claim)))$$,
  'true:queued/0'
);

-- ---------------------------------------------------------------------------
-- 9. Lease reaper: expired leases requeue; exhausted ones go dead.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table reap_claim as
select id, lease_id from public.claim_due_aria_jobs('worker-crash', 120, array['email_sync'], 1);
reset role;

update public.aria_jobs
   set lease_expires_at = now() - interval '1 second'
 where id = (select id from reap_claim);

set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table reap_result as
select public.reap_expired_aria_job_leases(100) as reaped;
reset role;

select loop_jobs_test.expect_scalar(
  'reaper-requeues-expired-lease',
  $$select concat_ws(':', (select reaped::text from reap_result),
                     (select status from public.aria_jobs where id = (select id from reap_claim)))$$,
  '1:queued'
);

-- ---------------------------------------------------------------------------
-- 10. Agent-framework lease reaper (the 0029 gap). FK graph is bypassed with
--     session_replication_role — this proves the REAPER's transition only.
-- ---------------------------------------------------------------------------
set session_replication_role = replica;
insert into public.agent_framework_runs (
  id, workspace_id, owner_id, actor_id, spec_id, campaign_id, campaign_fingerprint,
  workflow_version_id, deerflow_instance_id, flowise_instance_id, idempotency_key,
  capability_sha256, configuration_sha256, workflow_sha256,
  deerflow_source_commit, deerflow_image_digest, deerflow_readiness_sha256, deerflow_last_ready_at,
  flowise_source_commit, flowise_image_digest, flowise_isolation_mode, flowise_readiness_sha256, flowise_last_ready_at,
  status, lease_id, lease_expires_at
) values (
  '77777777-7777-4777-8777-777777777777',
  '51111111-1111-4111-8111-111111111111',
  'c1000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  gen_random_uuid(), 'camp-1', repeat('b', 64),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'run:expired:001',
  repeat('c', 64), repeat('d', 64), repeat('e', 64),
  '3c0a45ad772cdba388009b8d5ecad5e48cd22429',
  'registry.example/deerflow@sha256:' || repeat('0', 64), repeat('f', 64), now(),
  'ed9e100fb71643cd3922b005908f9732bc0e07dc',
  'registry.example/flowise@sha256:' || repeat('0', 64), 'instance-per-workspace', repeat('a', 64), now(),
  'running', gen_random_uuid(), now() - interval '1 minute'
);
set session_replication_role = default;

set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table framework_reap as
select public.reap_expired_agent_framework_leases(50) as reaped;
reset role;

select loop_jobs_test.expect_scalar(
  'framework-reaper-fails-expired-run',
  $$select concat_ws(':', (select reaped::text from framework_reap),
                     (select concat_ws('/', status, error_code, (finished_at is not null)::text)
                        from public.agent_framework_runs
                       where id = '77777777-7777-4777-8777-777777777777'))$$,
  '1:failed/LEASE_EXPIRED/true'
);
select loop_jobs_test.expect_authenticated_sqlstate(
  'framework-reaper-authenticated-denied',
  $$select public.reap_expired_agent_framework_leases(50)$$,
  array['42501']
);

-- ---------------------------------------------------------------------------
-- 11. Controls: fail-closed CHECK + admin gate + audit event.
-- ---------------------------------------------------------------------------
select loop_jobs_test.expect_sqlstate(
  'controls-enable-with-kill-switch-rejected',
  $$
    do $body$
    begin
      set local role authenticated;
      perform loop_jobs_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
      perform public.set_sourcing_loop_controls(true, false, true, false, false, false, 10, 50, 200);
    end;
    $body$
  $$,
  array['23514']
);

select loop_jobs_test.expect_sqlstate(
  'controls-member-denied',
  $$
    do $body$
    begin
      set local role authenticated;
      perform loop_jobs_test.set_authenticated_claims('c2000000-0000-4000-8000-000000000002');
      perform public.set_sourcing_loop_controls(false, false, true, false, false, false, 10, 50, 200);
    end;
    $body$
  $$,
  array['42501']
);

set role authenticated;
select loop_jobs_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table controls_update as
select public.set_sourcing_loop_controls(false, false, true, false, false, false, 10, 50, 200) as result;
reset role;

select loop_jobs_test.expect_scalar(
  'controls-admin-enables-sourcing',
  $$select concat_ws(':', (select result->>'status' from controls_update),
                     (select concat_ws('/', kill_switch::text, sourcing_enabled::text,
                                       (updated_by = 'c1000000-0000-4000-8000-000000000001')::text)
                        from public.sourcing_loop_controls
                       where workspace_id = '51111111-1111-4111-8111-111111111111'))$$,
  'updated:false/true/true'
);
select loop_jobs_test.expect_scalar(
  'controls-update-audited',
  $$select count(*)::text from public.loop_events
     where workspace_id = '51111111-1111-4111-8111-111111111111'
       and event_type = 'controls.updated'$$,
  '1'
);

set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
create temporary table controls_read as
select kill_switch, sourcing_enabled
  from public.get_sourcing_loop_controls('51111111-1111-4111-8111-111111111111');
reset role;

select loop_jobs_test.expect_scalar(
  'controls-service-read',
  $$select concat_ws(':', kill_switch::text, sourcing_enabled::text) from controls_read$$,
  'false:true'
);

-- ---------------------------------------------------------------------------
-- 12. loop_events is append-only for EVERYONE (including postgres).
-- ---------------------------------------------------------------------------
select loop_jobs_test.expect_sqlstate(
  'loop-events-update-rejected',
  $$update public.loop_events set event_type = 'tampered.event' where true$$,
  array['42501']
);
select loop_jobs_test.expect_sqlstate(
  'loop-events-delete-rejected',
  $$delete from public.loop_events where true$$,
  array['42501']
);

-- ---------------------------------------------------------------------------
-- 13. list_loop_events: workspace-scoped; anonymous sees nothing.
-- ---------------------------------------------------------------------------
set role authenticated;
select loop_jobs_test.set_authenticated_claims('c3000000-0000-4000-8000-000000000003');
create temporary table events_other_workspace as
select count(*) as visible from public.list_loop_events(0, 200);
reset role;

select loop_jobs_test.expect_scalar(
  'list-events-workspace-scoped',
  $$select visible::text from events_other_workspace$$,
  '0'
);

set role authenticated;
select loop_jobs_test.set_authenticated_claims('c1000000-0000-4000-8000-000000000001');
create temporary table events_own_workspace as
select count(*) as visible from public.list_loop_events(0, 200);
reset role;

select loop_jobs_test.expect_scalar(
  'list-events-own-workspace-visible',
  $$select (visible > 0)::text from events_own_workspace$$,
  'true'
);

select loop_jobs_test.clear_claims();
set role authenticated;
create temporary table events_anonymous as
select count(*) as visible from public.list_loop_events(0, 200);
reset role;

select loop_jobs_test.expect_scalar(
  'list-events-anonymous-empty',
  $$select visible::text from events_anonymous$$,
  '0'
);

-- ---------------------------------------------------------------------------
-- 14. Heartbeats: upsert + tick increment; malformed sha ignored.
-- ---------------------------------------------------------------------------
set role service_role;
select loop_jobs_test.set_service_claims('c1000000-0000-4000-8000-000000000001');
select public.record_loop_worker_heartbeat('loop-test-machine', repeat('9', 40));
select public.record_loop_worker_heartbeat('loop-test-machine', repeat('9', 40));
select public.record_loop_worker_heartbeat('bad-sha-machine', 'NOT-A-SHA');
reset role;

select loop_jobs_test.expect_scalar(
  'heartbeat-upsert-ticks',
  $$select concat_ws(':',
      (select tick_count::text from public.loop_worker_heartbeats where worker_id = 'loop-test-machine'),
      (select count(*)::text from public.loop_worker_heartbeats where worker_id = 'bad-sha-machine'))$$,
  '2:0'
);

-- ---------------------------------------------------------------------------
-- 15. Direct-table ACL: authenticated AND service_role are both denied.
-- ---------------------------------------------------------------------------
select loop_jobs_test.expect_authenticated_sqlstate(
  'rls-aria-jobs-denied',
  $$select count(*) from public.aria_jobs$$,
  array['42501']
);
select loop_jobs_test.expect_authenticated_sqlstate(
  'rls-loop-events-denied',
  $$select count(*) from public.loop_events$$,
  array['42501']
);
select loop_jobs_test.expect_authenticated_sqlstate(
  'rls-controls-denied',
  $$select count(*) from public.sourcing_loop_controls$$,
  array['42501']
);
select loop_jobs_test.expect_authenticated_sqlstate(
  'rls-heartbeats-denied',
  $$select count(*) from public.loop_worker_heartbeats$$,
  array['42501']
);
select loop_jobs_test.expect_sqlstate(
  'service-direct-table-denied',
  $$
    do $body$
    begin
      set local role service_role;
      perform count(*) from public.aria_jobs;
    end;
    $body$
  $$,
  array['42501']
);

do $$
declare
  failed integer;
  details text;
begin
  select count(*) into failed
    from loop_jobs_test.results
   where not passed;

  if failed <> 0 then
    select string_agg(case_name || ' (' || coalesce(detail, '') || ')', '; ' order by case_name)
      into details
      from loop_jobs_test.results
     where not passed;
    raise exception 'loop jobs DB test failed: %', details;
  end if;
end;
$$;
SQL

concurrent_claim() {
  # Genuine SKIP LOCKED race: session 1 claims job R1 inside an OPEN
  # transaction and sleeps; session 2 claims concurrently and must get the
  # OTHER job (R2), never blocking, never double-claiming.
  psql_stdin -q <<'RACE_SETUP'
set role service_role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"service_role"}', false);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claim.role', 'service_role', false);
select public.enqueue_aria_job('51111111-1111-4111-8111-111111111111','provider_poll','race:job:00001','{"n":1}'::jsonb, now(), 100);
select public.enqueue_aria_job('51111111-1111-4111-8111-111111111111','provider_poll','race:job:00002','{"n":2}'::jsonb, now(), 100);
reset role;
RACE_SETUP

  # The holder takes a raw row lock on job 00001 inside an OPEN transaction
  # (an uncommitted claim would be invisible to polling under READ COMMITTED,
  # so the lock — not a status flip — is the contended resource). The
  # challenger's claim must SKIP the locked row and lease exactly job 00002,
  # without blocking.
  psql_stdin -q <<'RACE_HOLDER' &
begin;
select id from public.aria_jobs where idempotency_key = 'race:job:00001' for update;
select pg_sleep(8);
commit;
RACE_HOLDER
  holder_pid=$!

  ready=""
  for _ in $(seq 1 60); do
    ready="$(psql_stdin -Atc "select count(*) from pg_stat_activity where state = 'active' and query like '%pg_sleep(8)%' and query not like '%pg_stat_activity%'")"
    [ "$ready" = "1" ] && break
    sleep 0.5
  done
  if [ "$ready" != "1" ]; then
    echo "loop-jobs-db: race holder never acquired its row lock" >&2
    exit 1
  fi

  raced="$(psql_stdin -Atq <<'RACE_CHALLENGER' | tail -n 1
set role service_role;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"service_role"}', false);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claim.role', 'service_role', false);
select coalesce(string_agg(idempotency_key, ',') filter (where idempotency_key like 'race:job:%'), '<none>')
  from public.claim_due_aria_jobs('race-challenger', 120, array['provider_poll'], 3);
RACE_CHALLENGER
)"
  wait "$holder_pid"

  held_status="$(psql_stdin -Atc "select status from public.aria_jobs where idempotency_key = 'race:job:00001'")"
  if [ "$raced" != "race:job:00002" ] || [ "$held_status" != "queued" ]; then
    echo "loop-jobs-db: SKIP LOCKED race FAILED (challenger got '${raced}', held job status '${held_status}')" >&2
    exit 1
  fi
}
concurrent_claim

assertions="$(psql_stdin -Atc "select count(*) from loop_jobs_test.results")"
echo "loop-jobs-db: spine, idempotency, leases, outbox, backoff, reapers, controls, append-only, ACL: ${assertions} assertions + SKIP LOCKED race, 0 failed"
