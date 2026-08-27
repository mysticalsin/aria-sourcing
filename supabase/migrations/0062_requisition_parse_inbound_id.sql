-- 0062_requisition_parse_inbound_id.sql
--
-- Webhook-triggered hiring needs enqueue requisition_parse with inboundId only
-- (same ids-only contract as inbound_classify). The loop worker reads the stored
-- inbound body and parses via the internal cron route.

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
    when 'draft_generate' then allowed_keys := array['campaignId', 'candidateId', 'messageId', 'approvedBy', 'approvalSource'];
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

revoke all on function public.aria_job_payload_contract_ok(text, jsonb)
  from public, anon, authenticated, service_role, authenticator;
alter function public.aria_job_payload_contract_ok(text, jsonb) owner to postgres;

with sanitized as (
  select id,
         case kind
           when 'requisition_parse' then jsonb_strip_nulls(jsonb_build_object(
             'inboundId', payload->'inboundId',
             'requisitionId', payload->'requisitionId',
             'campaignId', payload->'campaignId'
           ))
           else payload
         end as payload
    from public.aria_jobs
   where kind = 'requisition_parse'
     and not public.aria_job_payload_contract_ok(kind, payload)
)
update public.aria_jobs job
   set payload = sanitized.payload,
       payload_sha256 = encode(sha256(convert_to(sanitized.payload::text, 'UTF8')), 'hex'),
       updated_at = now()
  from sanitized
 where job.id = sanitized.id;
