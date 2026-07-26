-- 0064_candidate_lists_authority.sql rollback
--
-- Candidate-list authority contains durable provenance and operation evidence.
-- Refuse before any schema mutation unless every Phase 1 table is empty.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $candidate_list_rollback_guard$
declare
  table_name text;
  contains_rows boolean;
begin
  foreach table_name in array array[
    'candidate_list_operation_receipts',
    'candidate_list_members',
    'candidate_contact_attestations',
    'candidate_erasure_receipts',
    'candidate_lists'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'lock table public.%I in access exclusive mode',
        table_name
      );
    end if;
  end loop;

  foreach table_name in array array[
    'candidate_lists',
    'candidate_contact_attestations',
    'candidate_list_members',
    'candidate_list_operation_receipts'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('select exists (select 1 from public.%I)', table_name)
        into contains_rows;

      if contains_rows then
        raise exception
          'refusing candidate-list rollback because public.% contains rows',
          table_name
          using errcode = '55000';
      end if;
    end if;
  end loop;

  if exists (
    select 1
      from public.candidate_erasure_receipts receipt
     where receipt.store_name in (
       'candidate_list_members',
       'candidate_contact_attestations',
       'candidate_list_operation_receipts'
     )
  ) then
    raise exception
      'refusing candidate-list rollback because erasure receipts use 0064 stores'
      using errcode = '55000';
  end if;
end
$candidate_list_rollback_guard$;

drop trigger if exists candidate_erasure_requests_candidate_lists_cleanup
  on public.candidate_erasure_requests;
drop function if exists public.cleanup_erased_candidate_lists();

drop function if exists public.list_candidate_list_members(
  uuid, timestamptz, uuid, int
);
drop function if exists public.add_candidate_list_member(
  uuid, text, text, uuid
);
drop function if exists public.create_candidate_list(text, uuid);

drop table if exists public.candidate_list_members;
drop table if exists public.candidate_list_operation_receipts;
drop table if exists public.candidate_contact_attestations;
drop table if exists public.candidate_lists;

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results',
    'sourcing_candidate_evidence', 'ordinary_sourcing_results',
    'agent_memories', 'candidate_payload_provenance'
  ));

drop function if exists public.reject_candidate_list_evidence_mutation();

commit;
