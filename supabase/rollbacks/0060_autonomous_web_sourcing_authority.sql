-- Guarded rollback for 0060_autonomous_web_sourcing_authority.sql.
-- Refuse to destroy durable attempts or candidate evidence unless the operator
-- explicitly acknowledges the data-loss boundary in the same transaction.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

do $aria_0060_rollback_guard$
declare
  row_total bigint := 0;
  table_name text;
  table_rows bigint;
begin
  foreach table_name in array array[
    'autonomous_web_sourcing_claims',
    'autonomous_web_sourcing_attempts',
    'autonomous_web_sourcing_confirmations',
    'autonomous_web_sourcing_results',
    'autonomous_web_sourcing_staged_results',
    'autonomous_web_candidate_evidence',
    'autonomous_web_sourcing_receipts',
    'autonomous_web_sourcing_failures',
    'autonomous_web_sourcing_reconciliations',
    'autonomous_web_sourcing_quota_ledger'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('select count(*) from public.%I', table_name) into table_rows;
      row_total := row_total + table_rows;
    end if;
  end loop;
  if row_total > 0
     and current_setting('aria.allow_0060_rollback', true) is distinct from 'on' then
    raise exception '0060 rollback refused: % durable rows exist; set aria.allow_0060_rollback=on in this transaction after evidence export', row_total
      using errcode = '55000';
  end if;
end;
$aria_0060_rollback_guard$;

-- Restore the exact 0054 three-handler runtime identity and readiness contract
-- before dropping 0060 tables, removing every dependency on autonomous state.
create or replace function public.expected_sourcing_loop_handler_contract_sha256()
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(sha256(convert_to(
    'aria.sourcing-loop-handlers.v1|campaign_create|requisition_parse|sourcing_batch',
    'UTF8'
  )), 'hex');
$$;

create or replace function public.get_sourcing_loop_readiness(p_release_sha text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  expected_contract text := public.expected_sourcing_loop_handler_contract_sha256();
  wall_now timestamptz := clock_timestamp();
  freshest_heartbeat timestamptz;
  active_workers integer := 0;
  fresh_known_workers integer := 0;
  expected_handler_count constant integer := 3;
  oldest_runnable_job_age_seconds bigint := 0;
  overdue_runnable_jobs integer := 0;
  dead_sourcing_jobs integer := 0;
  ambiguous_sourcing_attempts integer := 0;
  overdue_begun_attempts integer := 0;
  heartbeat_status text;
  heartbeat_age_seconds integer;
  healthy boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$' then
    return jsonb_build_object(
      'healthy', false,
      'status', 'not_ready',
      'heartbeat_status', 'release_invalid',
      'active_workers', 0,
      'expected_handler_count', expected_handler_count,
      'freshest_heartbeat_age_seconds', null,
      'oldest_runnable_job_age_seconds', 0,
      'overdue_runnable_jobs', 0,
      'dead_sourcing_jobs', 0,
      'ambiguous_sourcing_attempts', 0,
      'overdue_begun_attempts', 0
    );
  end if;

  select max(heartbeat.last_seen_at),
         count(*) filter (where heartbeat.last_seen_at > wall_now - interval '90 seconds'),
         count(*) filter (
           where heartbeat.last_seen_at > wall_now - interval '90 seconds'
             and heartbeat.handler_contract_sha256 = expected_contract
         )
    into freshest_heartbeat, active_workers, fresh_known_workers
    from public.loop_worker_heartbeats heartbeat
   where heartbeat.release_sha = p_release_sha;

  heartbeat_age_seconds := case when freshest_heartbeat is null then null else
    greatest(0, floor(extract(epoch from wall_now - freshest_heartbeat))::integer) end;
  heartbeat_status := case
    when freshest_heartbeat is null then 'missing'
    when freshest_heartbeat <= wall_now - interval '90 seconds' then 'stale'
    when fresh_known_workers = 0 then 'contract_mismatch'
    else 'fresh'
  end;

  select count(*) filter (
           where job.next_run_at < wall_now - interval '120 seconds'
         ),
         coalesce(
           greatest(0, floor(extract(epoch from wall_now - min(job.next_run_at)))::bigint),
           0
         )
    into overdue_runnable_jobs, oldest_runnable_job_age_seconds
    from public.aria_jobs job
   where job.status = 'queued'
     and job.kind in ('requisition_parse', 'campaign_create', 'sourcing_batch')
     and job.next_run_at <= wall_now;
  select count(*) into dead_sourcing_jobs
    from public.aria_jobs job
   where job.status = 'dead'
     and job.kind in ('requisition_parse', 'campaign_create', 'sourcing_batch');
  select count(*) into ambiguous_sourcing_attempts
    from public.sourcing_batch_egress_attempts attempt
   where attempt.status = 'ambiguous';
  select count(*) into overdue_begun_attempts
    from public.sourcing_batch_egress_attempts attempt
   where attempt.status = 'begun'
     and attempt.begun_at < wall_now - interval '5 minutes';

  healthy := expected_handler_count > 0
    and heartbeat_status = 'fresh'
    and oldest_runnable_job_age_seconds <= 120
    and overdue_runnable_jobs = 0
    and dead_sourcing_jobs = 0
    and ambiguous_sourcing_attempts = 0
    and overdue_begun_attempts = 0;
  return jsonb_build_object(
    'healthy', healthy,
    'status', case when healthy then 'ready' else 'not_ready' end,
    'heartbeat_status', heartbeat_status,
    'active_workers', active_workers,
    'expected_handler_count', expected_handler_count,
    'freshest_heartbeat_age_seconds', heartbeat_age_seconds,
    'oldest_runnable_job_age_seconds', oldest_runnable_job_age_seconds,
    'overdue_runnable_jobs', overdue_runnable_jobs,
    'dead_sourcing_jobs', dead_sourcing_jobs,
    'ambiguous_sourcing_attempts', ambiguous_sourcing_attempts,
    'overdue_begun_attempts', overdue_begun_attempts
  );
end;
$$;

alter function public.expected_sourcing_loop_handler_contract_sha256() owner to postgres;
alter function public.get_sourcing_loop_readiness(text) owner to postgres;
revoke all on function public.expected_sourcing_loop_handler_contract_sha256()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.get_sourcing_loop_readiness(text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.get_sourcing_loop_readiness(text)
  to service_role;

-- Remove the 0060 provider-lane wrapper and restore the original 0054 RPC
-- name, ownership, and service-only ACL exactly.
drop function if exists public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
);
alter function public.authorize_sourcing_batch_0054(
  uuid, uuid, uuid, uuid, text, integer, text
) rename to authorize_sourcing_batch;
alter function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) owner to postgres;
revoke all on function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.authorize_sourcing_batch(
  uuid, uuid, uuid, uuid, text, integer, text
) to service_role;

drop trigger if exists candidate_erasure_tombstones_autonomous_web_cleanup
  on public.candidate_erasure_suppression_tombstones;
drop trigger if exists aria_jobs_autonomous_web_transition_guard on public.aria_jobs;

drop function if exists public.cleanup_autonomous_web_sourcing_retention(integer);
drop function if exists public.get_autonomous_web_sourcing_activation_proof(uuid, uuid);
drop function if exists public.autonomous_web_activation_counts_are_valid(
  integer, integer, integer, integer
);
drop function if exists public.autonomous_web_activation_job_counts_are_valid(
  integer, integer, integer, integer
);
drop function if exists public.cleanup_autonomous_web_from_tombstone();
drop function if exists public.reconcile_autonomous_web_sourcing(uuid, uuid, uuid, text);
drop function if exists public.fail_autonomous_web_sourcing(
  uuid, uuid, uuid, uuid, bigint, uuid, text, boolean, boolean
);
drop function if exists public.commit_autonomous_web_sourcing(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, text
);
drop function if exists public.record_autonomous_web_sourcing_result(
  uuid, uuid, uuid, uuid, uuid, bigint, text, uuid, text, text,
  text, text, text, integer, jsonb, jsonb
);
drop function if exists public.confirm_autonomous_web_sourcing_egress(
  uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, text, text
);
drop function if exists public.begin_autonomous_web_sourcing_egress(
  uuid, uuid, uuid, uuid, uuid, bigint
);
drop function if exists public.authorize_autonomous_web_sourcing(
  uuid, uuid, uuid, uuid, text, integer
);
drop function if exists public.autonomous_web_sourcing_candidates(
  uuid, uuid, uuid, jsonb, jsonb, text, jsonb, timestamptz
);
drop function if exists public.guard_autonomous_web_sourcing_job_transition();

drop table if exists public.autonomous_web_sourcing_staged_results;
drop table if exists public.autonomous_web_sourcing_reconciliations;
drop table if exists public.autonomous_web_sourcing_failures;
drop table if exists public.autonomous_web_sourcing_receipts;
drop table if exists public.autonomous_web_candidate_evidence;
drop table if exists public.autonomous_web_sourcing_quota_ledger;
drop table if exists public.autonomous_web_sourcing_results;
drop table if exists public.autonomous_web_sourcing_confirmations;
drop table if exists public.autonomous_web_sourcing_attempts;
drop table if exists public.autonomous_web_sourcing_claims;

drop function if exists public.guard_autonomous_web_staged_mutation();
drop function if exists public.reject_autonomous_web_sourcing_mutation();
drop function if exists public.autonomous_web_linkedin_external_id(text);
drop function if exists public.autonomous_web_sourcing_request_sha256(jsonb);
drop function if exists public.autonomous_web_sourcing_request(jsonb);
drop function if exists public.autonomous_web_sourcing_credential_version(
  uuid, uuid, text, text, timestamptz, text, integer
);
drop function if exists public.autonomous_web_sourcing_query_is_allowed(jsonb, jsonb);
drop function if exists public.autonomous_web_sourcing_expected_query(jsonb, integer);
