-- 0065_calendar_book_and_graph_renew.sql
--
-- 1) Add calendar_book to the autonomous loop (human-gated Teams/Outlook propose).
-- 2) Allow draft_generate payload keys used by inbound_classify successors (trigger, intent).
-- 3) Map calendar_book to sequences_enabled on the switchboard.

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

create or replace function public.enqueue_aria_job(
  p_workspace_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_payload jsonb,
  p_run_at timestamptz default now(),
  p_priority integer default 100
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  existing_row public.aria_jobs%rowtype;
  new_row public.aria_jobs%rowtype;
  violated_constraint text;
  payload_hash text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_kind is null
     or p_kind not in (
       'email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create',
       'sourcing_batch', 'provider_poll', 'enrich_candidate', 'shortlist_build',
       'draft_generate', 'calendar_book', 'delivery_reconcile', 'outcome_feedback'
     )
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 8192
     or not public.aria_job_payload_contract_ok(p_kind, p_payload)
     or p_run_at is null
     or p_run_at > now() + interval '30 days'
     or p_priority is null
     or p_priority not between 0 and 1000 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not public.sourcing_loop_stage_enabled(p_workspace_id, p_kind) then
    return jsonb_build_object('status', 'control_blocked');
  end if;

  payload_hash := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');

  select * into existing_row
    from public.aria_jobs
   where workspace_id = p_workspace_id
     and kind = p_kind
     and idempotency_key = p_idempotency_key
   for update;
  if found then
    if existing_row.payload_sha256 <> payload_hash then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'enqueued',
      'id', existing_row.id,
      'job_status', existing_row.status,
      'replay', true
    );
  end if;

  begin
    insert into public.aria_jobs (
      workspace_id, kind, idempotency_key, payload, payload_sha256,
      next_run_at, priority
    ) values (
      p_workspace_id, p_kind, p_idempotency_key, p_payload, payload_hash,
      p_run_at, p_priority
    )
    returning * into new_row;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'aria_jobs_workspace_kind_idem_uniq' then
      select * into existing_row
        from public.aria_jobs
       where workspace_id = p_workspace_id
         and kind = p_kind
         and idempotency_key = p_idempotency_key
       for update;
      if existing_row.payload_sha256 <> payload_hash then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'enqueued',
        'id', existing_row.id,
        'job_status', existing_row.status,
        'replay', true
      );
    end if;
    raise;
  end;

  return jsonb_build_object(
    'status', 'enqueued',
    'id', new_row.id,
    'job_status', new_row.status,
    'replay', false
  );
end;
$$;

revoke all on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer)
  to service_role;
alter function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) owner to postgres;

create or replace function public.sourcing_loop_stage_enabled(
  p_workspace_id uuid,
  p_kind text
) returns boolean
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(auth.role(), '') = 'service_role'
     and coalesce((
      select case
        when p_kind in ('email_sync', 'inbound_classify', 'requisition_parse', 'campaign_create')
          then not controls.kill_switch and controls.intake_enabled
        when p_kind in ('sourcing_batch', 'provider_poll', 'shortlist_build', 'draft_generate')
          then not controls.kill_switch and controls.sourcing_enabled
        when p_kind = 'enrich_candidate'
          then not controls.kill_switch and controls.enrichment_enabled
        when p_kind in ('calendar_book', 'delivery_reconcile', 'outcome_feedback')
          then not controls.kill_switch and controls.sequences_enabled
        when p_kind = 'swarm_assignment'
          then not controls.kill_switch and controls.swarm_enabled
        else false
      end
      from public.sourcing_loop_controls controls
      where controls.workspace_id = p_workspace_id
    ), false);
$$;

revoke all on function public.sourcing_loop_stage_enabled(uuid, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.sourcing_loop_stage_enabled(uuid, text) to service_role;

comment on function public.enqueue_aria_job(uuid, text, text, jsonb, timestamptz, integer) is
  'Enqueue an aria_jobs row. Kinds include calendar_book (0065) for Teams/Outlook interview propose.';
