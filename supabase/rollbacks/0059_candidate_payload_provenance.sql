-- Guarded rollback for 0059. Candidate provenance, erasure receipts, and
-- independently verified provider evidence are compliance records. Refuse to
-- discard them once any of those records exists.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(590059202607210059::bigint);

do $candidate_payload_provenance_rollback_guard$
declare
  provenance_exists boolean := false;
  provider_evidence_exists boolean := false;
  linked_completion_exists boolean := false;
  erasure_receipt_exists boolean := false;
begin
  if to_regclass('public.candidate_payload_provenance') is not null then
    execute 'lock table public.candidate_payload_provenance in access exclusive mode';
    execute 'select exists (select 1 from public.candidate_payload_provenance)'
      into provenance_exists;
  end if;
  if to_regclass('public.candidate_erasure_provider_evidence_receipts') is not null then
    execute 'lock table public.candidate_erasure_provider_evidence_receipts in access exclusive mode';
    execute 'select exists (select 1 from public.candidate_erasure_provider_evidence_receipts)'
      into provider_evidence_exists;
  end if;
  if to_regclass('public.candidate_erasure_obligations') is not null
     and exists (
       select 1
         from pg_attribute attribute
        where attribute.attrelid = 'public.candidate_erasure_obligations'::regclass
          and attribute.attname = 'completion_evidence_receipt_id'
          and not attribute.attisdropped
     ) then
    execute 'lock table public.candidate_erasure_obligations in access exclusive mode';
    execute $query$
      select exists (
        select 1 from public.candidate_erasure_obligations
         where completion_evidence_receipt_id is not null
      )
    $query$ into linked_completion_exists;
  end if;
  if to_regclass('public.candidate_erasure_receipts') is not null then
    execute 'lock table public.candidate_erasure_receipts in access exclusive mode';
    execute $query$
      select exists (
        select 1 from public.candidate_erasure_receipts
         where store_name in ('agent_memories', 'candidate_payload_provenance')
      )
    $query$ into erasure_receipt_exists;
  end if;
  if provenance_exists
     or provider_evidence_exists
     or linked_completion_exists
     or erasure_receipt_exists then
    raise exception 'refusing 0059 rollback because candidate provenance or verified erasure evidence exists'
      using errcode = '55000';
  end if;
end;
$candidate_payload_provenance_rollback_guard$;

drop trigger if exists agent_runs_candidate_provenance on public.agent_runs;
drop trigger if exists agent_events_candidate_provenance on public.agent_events;
drop trigger if exists agent_framework_results_candidate_provenance
  on public.agent_framework_sourcing_authorizations;
drop trigger if exists candidate_erasure_requests_payload_provenance_cleanup
  on public.candidate_erasure_requests;
drop trigger if exists candidate_erasure_tombstones_payload_provenance_cleanup
  on public.candidate_erasure_suppression_tombstones;
drop trigger if exists candidate_erasure_obligations_verified_completion
  on public.candidate_erasure_obligations;

drop function if exists public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
);

alter table public.candidate_erasure_obligations
  drop constraint if exists candidate_erasure_obligations_completion_evidence_receipt_fkey;
alter table public.candidate_erasure_obligations
  drop column if exists completion_evidence_receipt_id;

drop table if exists public.candidate_erasure_provider_evidence_receipts;
drop function if exists public.enforce_verified_candidate_erasure_completion();
drop function if exists public.reject_candidate_erasure_provider_evidence_mutation();
drop function if exists public.validate_candidate_erasure_provider_evidence_receipt();
drop function if exists public.candidate_erasure_provider_evidence_document(
  uuid, uuid, uuid, text, integer, text, text, text, text, text, timestamptz
);

drop function if exists public.cleanup_candidate_payload_from_tombstone();
drop function if exists public.cleanup_candidate_payload_provenance();
drop function if exists public.candidate_payload_matches_erasure(uuid, uuid, jsonb);
drop function if exists public.mutate_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz, boolean, text, jsonb
);
drop function if exists public.create_agent_memory_with_candidate_provenance(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz,
  text, jsonb
);
drop function if exists public.register_agent_memory_candidate_provenance(
  uuid, uuid, uuid, uuid, uuid, integer, text, jsonb
);
drop function if exists public.index_candidate_json_payload();
drop function if exists public.index_candidate_payload_provenance(
  uuid, text, uuid, bigint, uuid, uuid, jsonb
);
drop function if exists public.candidate_payload_identifiers(jsonb);
drop table if exists public.candidate_payload_provenance;

drop index if exists public.candidate_erasure_obligations_scope_key;
drop index if exists public.agent_runs_workspace_id_provenance_key;
drop index if exists public.agent_events_workspace_id_provenance_key;
drop index if exists public.agent_memories_workspace_id_provenance_key;

-- Restore the exact pre-0059 legacy table grants from migration 0025. Agent
-- runs never granted INSERT directly; events did.
grant update, delete on public.agent_runs to service_role;
grant insert, update, delete on public.agent_events to service_role;

-- Restore the pre-0059 direct memory writer privileges only after the atomic
-- wrappers and provenance table have been removed by a guarded rollback.
grant execute on function public.create_agent_memory(
  uuid, uuid, uuid, uuid, text, text, text, integer, boolean, timestamptz
) to service_role;
grant execute on function public.mutate_agent_memory(
  uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, integer,
  boolean, boolean, timestamptz
) to service_role;

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;
alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results',
    'sourcing_candidate_evidence', 'ordinary_sourcing_results'
  ));

-- Restore the pre-0059 reconciliation contract. This accepts operator
-- evidence directly and is intentionally only reachable after the guard has
-- proven that no 0059 evidence or completion exists.
create or replace function public.reconcile_candidate_erasure_obligation(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_obligation_id uuid,
  p_expected_attempt_count integer,
  p_status text,
  p_error_code text default null,
  p_evidence_sha256 text default null,
  p_case_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  obligation public.candidate_erasure_obligations%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  next_attempt_count integer;
  request_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = p_workspace_id
       and profile.id = p_actor_id
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_expected_attempt_count is null or p_expected_attempt_count < 0
     or p_status not in ('pending_provider', 'retryable_failure', 'completed')
     or (p_status = 'retryable_failure' and (
       p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$'
     ))
     or (p_status <> 'retryable_failure' and p_error_code is not null)
     or (p_status = 'completed' and (
       p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
       or p_case_reference is null
       or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     ))
     or (p_status <> 'completed' and (
       p_evidence_sha256 is not null or p_case_reference is not null
     )) then
    raise exception 'invalid obligation transition' using errcode = '22023';
  end if;
  select * into obligation
    from public.candidate_erasure_obligations item
   where item.id = p_obligation_id
     and item.workspace_id = p_workspace_id
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = obligation.request_id
   for update;
  perform public.refresh_candidate_erasure_legal_hold_state(request_record.id);
  select * into obligation
    from public.candidate_erasure_obligations item
   where item.id = p_obligation_id
     and item.workspace_id = p_workspace_id
   for update;
  select * into request_record
    from public.candidate_erasure_requests request
   where request.id = obligation.request_id
   for update;
  if obligation.status <> 'completed' and exists (
    select 1 from public.candidate_legal_holds hold
     where hold.workspace_id = request_record.workspace_id
       and hold.campaign_id = request_record.campaign_id
       and hold.candidate_id = request_record.candidate_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > now())
  ) then
    return jsonb_build_object(
      'status', 'blocked_legal_hold', 'obligation_id', obligation.id,
      'attempt_count', obligation.attempt_count
    );
  end if;
  if obligation.status = 'completed' then
    if p_status <> 'completed'
       or obligation.completed_by <> p_actor_id
       or obligation.completion_evidence_sha256 <> p_evidence_sha256
       or obligation.completion_case_reference <> p_case_reference
       or p_expected_attempt_count not in (
         obligation.attempt_count,
         greatest(obligation.attempt_count - 1, 0)
       ) then
      return jsonb_build_object(
        'status', 'conflict', 'attempt_count', obligation.attempt_count
      );
    end if;
    return public.candidate_erasure_response(obligation.request_id, true);
  end if;
  if obligation.attempt_count <> p_expected_attempt_count then
    return jsonb_build_object(
      'status', 'conflict', 'attempt_count', obligation.attempt_count
    );
  end if;
  if obligation.status = 'manual_required' and p_status <> 'completed' then
    return jsonb_build_object('status', 'invalid_transition');
  end if;
  next_attempt_count := obligation.attempt_count + 1;
  update public.candidate_erasure_obligations
     set status = p_status,
         attempt_count = next_attempt_count,
         last_error_code = p_error_code,
         next_attempt_at = case when p_status = 'retryable_failure'
           then now() + interval '15 minutes' else null end,
         completed_at = case when p_status = 'completed' then now() else null end,
         completion_evidence_sha256 = case when p_status = 'completed'
           then p_evidence_sha256 else null end,
         completion_case_reference = case when p_status = 'completed'
           then p_case_reference else null end,
         completed_by = case when p_status = 'completed' then p_actor_id else null end,
         reference_ciphertext = case when p_status = 'completed'
           then null else reference_ciphertext end,
         updated_at = now()
   where id = obligation.id;

  select case
    when bool_and(item.status = 'completed') then 'completed'
    when bool_or(item.status = 'manual_required') then 'manual_required'
    when bool_or(item.status = 'retryable_failure') then 'retryable_failure'
    else 'pending_provider'
  end into request_status
    from public.candidate_erasure_obligations item
   where item.request_id = request_record.id;
  update public.candidate_erasure_requests
     set status = request_status,
         provider_completed_at = case when request_status = 'completed' then now() else null end,
         updated_at = now()
   where id = request_record.id;
  return public.candidate_erasure_response(request_record.id, false);
end;
$$;

revoke all on function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) to service_role;
alter function public.reconcile_candidate_erasure_obligation(
  uuid, uuid, uuid, integer, text, text, text, text
) owner to postgres;

commit;
