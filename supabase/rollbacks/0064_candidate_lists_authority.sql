-- 0064_candidate_lists_authority.sql rollback
--
-- Candidate-list authority contains durable provenance and operation evidence.
-- Refuse before any schema mutation unless every Phase 1 table is empty.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(hashtextextended('aria-schema-migrations', 0));

do $candidate_list_rollback_guard$
declare
  table_name text;
  contains_rows boolean;
  later_authority_exists boolean := false;
begin
  -- 0065 changes list evidence and 0066 depends on that exact cleanup surface.
  -- Refuse both ledgered and disposable/ledgerless out-of-order rollback before
  -- taking any destructive table lock. Production migration history is
  -- append-only; there is deliberately no operator bypass.
  if to_regclass('public.aria_schema_migrations') is not null then
    execute 'lock table public.aria_schema_migrations in share mode';
    execute $query$
      select exists (
        select 1
          from public.aria_schema_migrations migration
         where substring(migration.filename from '^([0-9]{4})_') >= '0065'
      )
    $query$ into later_authority_exists;
  end if;

  if later_authority_exists
     or exists (
       select 1
         from pg_catalog.pg_attribute attribute
        where attribute.attrelid =
              to_regclass('public.candidate_contact_attestations')
          and attribute.attname = 'authority_version'
          and attribute.attnum > 0
          and not attribute.attisdropped
     )
     or (
       to_regclass('public.candidate_contact_attestations') is not null
       and not exists (
         select 1
           from pg_catalog.pg_constraint constraint_row
          where constraint_row.conrelid =
                to_regclass('public.candidate_contact_attestations')
            and constraint_row.conname =
                'candidate_contact_attestation_workspace_id_campaign_id_can_fkey'
       )
     )
     or (
       to_regclass('public.candidate_list_members') is not null
       and not exists (
         select 1
           from pg_catalog.pg_constraint constraint_row
          where constraint_row.conrelid =
                to_regclass('public.candidate_list_members')
            and constraint_row.conname =
                'candidate_list_members_workspace_id_campaign_id_candidate__fkey'
       )
     )
     or to_regprocedure(
       'public.resolve_candidate_list_evidence(uuid,text,text,timestamptz)'
     ) is not null
     or to_regprocedure(
       'public.candidate_legal_hold_lock_key(uuid,text)'
     ) is not null
     or to_regprocedure(
       'public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)'
     ) is not null then
    raise exception
      'refusing 0064 rollback while candidate-list evidence or candidate-global legal-hold authority remains applied'
      using errcode = '55000';
  end if;

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
