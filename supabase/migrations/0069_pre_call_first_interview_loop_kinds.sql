-- 0069_pre_call_first_interview_loop_kinds.sql
--
-- Add pre_call_propose and first_interview_book to the autonomous loop.
-- calendar_book remains for backward compatibility but is no longer enqueued.

create or replace function public.aria_job_payload_contract_ok(p_kind text, p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  allowed_keys text[];
  item record;
  array_item jsonb;
  id_pattern constant text := '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$';
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  case p_kind
    when 'email_sync' then allowed_keys := array['inboundIds'];
    when 'inbound_classify' then allowed_keys := array['inboundId'];
    when 'requisition_parse' then allowed_keys := array['inboundId', 'requisitionId', 'campaignId'];
    when 'campaign_create' then allowed_keys := array['requisitionId', 'campaignId'];
    when 'sourcing_batch' then allowed_keys := array['campaignId', 'batchId', 'providerRunId', 'runId', 'candidateIds', 'shortlistedCandidateIds'];
    when 'provider_poll' then allowed_keys := array['campaignId', 'batchId', 'providerRunId', 'runId'];
    when 'enrich_candidate' then allowed_keys := array['campaignId', 'candidateId', 'targetId', 'providerRunId', 'runId'];
    when 'shortlist_build' then allowed_keys := array['campaignId', 'batchId', 'providerRunId', 'runId', 'candidateIds', 'shortlistedCandidateIds', 'receiptKey'];
    when 'draft_generate' then allowed_keys := array['campaignId', 'candidateId', 'messageId', 'approvedBy', 'approvalSource', 'trigger', 'intent'];
    when 'calendar_book' then allowed_keys := array['campaignId', 'candidateId', 'intent', 'trigger', 'approvedBy'];
    when 'pre_call_propose' then allowed_keys := array['campaignId', 'candidateId', 'intent', 'trigger', 'approvedBy'];
    when 'first_interview_book' then allowed_keys := array['campaignId', 'candidateId', 'intent', 'trigger', 'approvedBy'];
    when 'delivery_reconcile' then allowed_keys := array['campaignId', 'candidateId', 'messageId', 'ledgerId'];
    when 'outcome_feedback' then allowed_keys := array['campaignId', 'candidateId', 'messageId', 'ledgerId'];
    else return false;
  end case;

  for item in select key, value from jsonb_each(p_payload) loop
    if not (item.key = any(allowed_keys)) then
      return false;
    end if;
    if jsonb_typeof(item.value) = 'string' then
      if item.key in ('inboundId', 'requisitionId') then
        if item.value #>> '{}' !~ uuid_pattern then
          return false;
        end if;
      elsif item.value #>> '{}' !~ id_pattern then
        return false;
      end if;
    elsif jsonb_typeof(item.value) = 'array' then
      for array_item in select value from jsonb_array_elements(item.value) loop
        if jsonb_typeof(array_item) <> 'string' or array_item #>> '{}' !~ id_pattern then
          return false;
        end if;
      end loop;
    else
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.sourcing_loop_stage_enabled(
  p_workspace_id uuid,
  p_kind text
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  controls public.sourcing_loop_controls%rowtype;
begin
  select * into controls
  from public.sourcing_loop_controls
  where workspace_id = p_workspace_id;

  if not found then
    return false;
  end if;

  if controls.kill_switch then
    return false;
  end if;

  case p_kind
    when 'email_sync' then return controls.email_sync_enabled;
    when 'inbound_classify' then return controls.inbound_classify_enabled;
    when 'requisition_parse' then return controls.requisition_parse_enabled;
    when 'campaign_create' then return controls.campaign_create_enabled;
    when 'sourcing_batch' then return controls.sourcing_batch_enabled;
    when 'provider_poll' then return controls.provider_poll_enabled;
    when 'enrich_candidate' then return controls.enrich_candidate_enabled;
    when 'shortlist_build' then return controls.shortlist_build_enabled;
    when 'draft_generate' then return controls.draft_generate_enabled;
    when 'calendar_book', 'pre_call_propose', 'first_interview_book' then return controls.sequences_enabled;
    when 'delivery_reconcile' then return controls.delivery_reconcile_enabled;
    when 'outcome_feedback' then return controls.outcome_feedback_enabled;
    else return false;
  end case;
end;
$$;

revoke all on function public.sourcing_loop_stage_enabled(uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.sourcing_loop_stage_enabled(uuid, text) to service_role;

comment on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) is
  'Enqueue an aria_jobs row. Kinds include pre_call_propose and first_interview_book (0069) for Mantu interview pipeline.';
