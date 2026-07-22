-- Guarded rollback for 0058. A staged, completed, failed, or expired result is
-- authority and audit evidence. Never delete it to make a rollback succeed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(580058202607210058::bigint);

do $ordinary_sourcing_result_rollback_guard$
declare
  result_evidence_exists boolean := false;
  erasure_evidence_exists boolean := false;
begin
  if to_regclass('public.sourcing_run_results') is not null then
    execute 'lock table public.sourcing_run_results in access exclusive mode';
    execute 'select exists (select 1 from public.sourcing_run_results)'
      into result_evidence_exists;
  end if;
  if to_regclass('public.candidate_erasure_receipts') is not null then
    execute 'lock table public.candidate_erasure_receipts in access exclusive mode';
    execute $query$
      select exists (
        select 1 from public.candidate_erasure_receipts
         where store_name = 'ordinary_sourcing_results'
      )
    $query$ into erasure_evidence_exists;
  end if;
  if result_evidence_exists or erasure_evidence_exists then
    raise exception 'refusing 0058 rollback because ordinary sourcing result evidence exists'
      using errcode = '55000';
  end if;
end;
$ordinary_sourcing_result_rollback_guard$;

do $ordinary_sourcing_result_dependency_guard$
begin
  if to_regclass('public.candidate_payload_provenance') is not null then
    raise exception 'refusing 0058 rollback while later migration 0059 remains applied'
      using errcode = '55000';
  end if;
end;
$ordinary_sourcing_result_dependency_guard$;

do $restore_pre0058_cleanup$
begin
  if to_regprocedure(
    'public.cleanup_sourcing_learning_authority_pre0058(uuid,integer)'
  ) is not null then
    drop function public.cleanup_sourcing_learning_authority(uuid, integer);
    alter function public.cleanup_sourcing_learning_authority_pre0058(uuid, integer)
      rename to cleanup_sourcing_learning_authority;
    revoke all on function public.cleanup_sourcing_learning_authority(uuid, integer)
      from public, anon, authenticated, service_role, authenticator;
    grant execute on function public.cleanup_sourcing_learning_authority(uuid, integer)
      to service_role;
  end if;
end;
$restore_pre0058_cleanup$;

drop trigger if exists candidate_erasure_requests_ordinary_sourcing_cleanup
  on public.candidate_erasure_requests;
drop function if exists public.cleanup_ordinary_sourcing_erasure();
drop function if exists public.cleanup_ordinary_sourcing_results(uuid, integer);
drop function if exists public.fail_ordinary_sourcing_run(uuid, uuid, uuid, text);
drop function if exists public.ack_ordinary_sourcing_result(uuid, uuid, uuid, text);
drop function if exists public.complete_ordinary_sourcing_run(uuid, uuid, uuid, jsonb, jsonb);
drop function if exists public.begin_ordinary_sourcing_run(
  uuid, uuid, text, jsonb, text, text, text, text, uuid, text, integer, text
);
drop function if exists public.resume_ordinary_sourcing_run(uuid, uuid, text, text, integer);
drop function if exists public.validate_ordinary_sourcing_candidates(uuid, text, jsonb, integer);
drop table if exists public.sourcing_run_results;

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results',
    'sourcing_candidate_evidence'
  ));

commit;
