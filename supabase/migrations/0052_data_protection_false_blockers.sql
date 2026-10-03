-- 0052_data_protection_false_blockers.sql
--
-- Rock 5 data-protection repair. Keeps existing migrations byte-identical.

alter table public.candidate_erasure_receipts
  drop constraint if exists candidate_erasure_receipts_store_name_check;

alter table public.candidate_erasure_receipts
  add constraint candidate_erasure_receipts_store_name_check
  check (store_name in (
    'workspace_state', 'messages_outbound', 'messages_inbound',
    'agent_conversations', 'outreach_ledger', 'outreach_approvals',
    'suppression_list', 'whatsapp_contacts', 'whatsapp_conversation_windows',
    'whatsapp_delivery_events', 'outbound_content_cache', 'apollo_enrichment',
    'agent_runs', 'agent_events', 'agent_framework_results', 'loop_events'
  ));

create or replace function public.aria_job_payload_contract_ok(
  p_kind text,
  p_payload jsonb
)
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
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  case p_kind
    when 'email_sync' then allowed_keys := array['inboundIds'];
    when 'inbound_classify' then allowed_keys := array['inboundId'];
    when 'requisition_parse' then allowed_keys := array['requisitionId', 'campaignId'];
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
      if item.value #>> '{}' !~ id_pattern then
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

create or replace function public.reject_loop_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('aria.candidate_erasure_loop_event_redaction', true) = 'on'
     and new.id = old.id
     and new.workspace_id = old.workspace_id
     and new.event_type = old.event_type
     and new.subject_kind is not distinct from old.subject_kind
     and new.job_id is not distinct from old.job_id
     and new.created_at = old.created_at
     and new.subject_id is null
     and new.payload = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure') then
    return new;
  end if;
  raise exception 'loop events are append-only' using errcode = '42501';
end;
$$;

revoke all on function public.reject_loop_event_mutation()
  from public, anon, authenticated, service_role, authenticator;
alter function public.reject_loop_event_mutation() owner to postgres;

create or replace function public.redact_loop_events_for_candidate_erasure(
  p_workspace_id uuid,
  p_candidate_id text,
  p_identities text[],
  p_phones text[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  redacted_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_candidate_id is null or p_candidate_id = '' then
    raise exception 'invalid loop event erasure request' using errcode = '22023';
  end if;

  perform set_config('aria.candidate_erasure_loop_event_redaction', 'on', true);
  update public.loop_events event
     set subject_id = null,
         payload = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure')
   where event.workspace_id = p_workspace_id
     and (
       event.subject_id = p_candidate_id
       or public.candidate_erasure_contains_identity(event.subject_id, p_identities)
       or public.candidate_erasure_contains_identity(event.payload::text, p_identities)
       or exists (
         select 1 from unnest(coalesce(p_phones, array[]::text[])) phone
          where length(phone) between 8 and 15
            and position(phone in regexp_replace(event.payload::text, '[^0-9]', '', 'g')) > 0
       )
     );
  get diagnostics redacted_count = row_count;
  perform set_config('aria.candidate_erasure_loop_event_redaction', '', true);
  return redacted_count;
exception when others then
  perform set_config('aria.candidate_erasure_loop_event_redaction', '', true);
  raise;
end;
$$;

revoke all on function public.redact_loop_events_for_candidate_erasure(uuid, text, text[], text[])
  from public, anon, authenticated, authenticator;
grant execute on function public.redact_loop_events_for_candidate_erasure(uuid, text, text[], text[])
  to service_role;
alter function public.redact_loop_events_for_candidate_erasure(uuid, text, text[], text[]) owner to postgres;

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
       'draft_generate', 'delivery_reconcile', 'outcome_feedback'
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

with sanitized as (
  select id,
         case kind
           when 'email_sync' then jsonb_strip_nulls(jsonb_build_object('inboundIds', payload->'inboundIds'))
           when 'inbound_classify' then jsonb_strip_nulls(jsonb_build_object('inboundId', payload->'inboundId'))
           when 'provider_poll' then jsonb_strip_nulls(jsonb_build_object('campaignId', payload->'campaignId', 'batchId', payload->'batchId', 'providerRunId', coalesce(payload->'providerRunId', payload->'runId')))
           when 'shortlist_build' then jsonb_strip_nulls(jsonb_build_object('campaignId', payload->'campaignId', 'batchId', payload->'batchId', 'providerRunId', coalesce(payload->'providerRunId', payload->'runId'), 'receiptKey', payload->'receiptKey'))
           when 'sourcing_batch' then jsonb_strip_nulls(jsonb_build_object('campaignId', payload->'campaignId', 'batchId', payload->'batchId', 'providerRunId', coalesce(payload->'providerRunId', payload->'runId'), 'candidateIds', coalesce(payload->'candidateIds', payload->'shortlistedCandidateIds')))
           when 'enrich_candidate' then jsonb_strip_nulls(jsonb_build_object('campaignId', payload->'campaignId', 'candidateId', payload->'candidateId', 'targetId', payload->'targetId', 'providerRunId', coalesce(payload->'providerRunId', payload->'runId')))
           else '{}'::jsonb
         end as payload
    from public.aria_jobs
   where not public.aria_job_payload_contract_ok(kind, payload)
)
update public.aria_jobs job
   set payload = sanitized.payload,
       payload_sha256 = encode(sha256(convert_to(sanitized.payload::text, 'UTF8')), 'hex'),
       updated_at = now()
  from sanitized
 where job.id = sanitized.id;

create or replace function public.request_candidate_erasure(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  workspace_record public.workspace_state%rowtype;
  request_record public.candidate_erasure_requests%rowtype;
  candidate jsonb;
  candidate_mirror public.candidates%rowtype;
  workspace_state_present boolean := false;
  workspace_state_candidate_present boolean := false;
  scrubbed_state jsonb;
  identities text[] := array[]::text[];
  phones text[] := array[]::text[];
  outbound_ids uuid[] := array[]::uuid[];
  approval_ids text[] := array[]::text[];
  content_hashes text[] := array[]::text[];
  conversation_ids uuid[] := array[]::uuid[];
  affected_run_ids uuid[] := array[]::uuid[];
  source_provider text;
  source_reference text;
  source_reference_payload jsonb;
  target_record record;
  apollo_result jsonb;
  obligation_count integer := 0;
  workspace_state_count integer := 0;
  outbound_count integer := 0;
  inbound_count integer := 0;
  conversation_count integer := 0;
  ledger_count integer := 0;
  approval_count integer := 0;
  suppression_count integer := 0;
  contact_count integer := 0;
  window_count integer := 0;
  delivery_count integer := 0;
  cache_count integer := 0;
  apollo_count integer := 0;
  run_count integer := 0;
  event_count integer := 0;
  framework_result_count integer := 0;
  loop_event_count integer := 0;
  final_status text;
  legal_hold_active boolean := false;
  identity_lock_key bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_actor_id is null or p_request_key is null
     or p_campaign_id is null
     or p_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate erasure request' using errcode = '22023';
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

  select * into request_record
    from public.candidate_erasure_requests request
   where request.workspace_id = p_workspace_id
     and request.request_key = p_request_key
   for update;
  if found then
    if request_record.actor_id <> p_actor_id
       or request_record.campaign_id <> p_campaign_id
       or request_record.candidate_id <> p_candidate_id then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    legal_hold_active := public.refresh_candidate_erasure_legal_hold_state(request_record.id);
    select * into request_record
      from public.candidate_erasure_requests request
     where request.id = request_record.id
     for update;
    if request_record.status <> 'blocked_legal_hold' or legal_hold_active then
      return public.candidate_erasure_response(request_record.id, true);
    end if;
  end if;

  select * into workspace_record
    from public.workspace_state state
   where state.workspace_id = p_workspace_id
   for update;
  workspace_state_present := found;

  if workspace_state_present and jsonb_typeof(workspace_record.state->'candidates') = 'array' then
    select item.value into candidate
      from jsonb_array_elements(workspace_record.state->'candidates') item(value)
     where item.value->>'id' = p_candidate_id
       and item.value->>'campaignId' = p_campaign_id
     limit 1;
    workspace_state_candidate_present := found;
  end if;

  if candidate is null then
    select * into candidate_mirror
      from public.candidates mirrored
     where mirrored.workspace_id = p_workspace_id
       and mirrored.campaign_id = p_campaign_id
       and mirrored.id = p_candidate_id
     limit 1;
    if found then
      candidate := candidate_mirror.payload;
    end if;
  end if;

  candidate := coalesce(candidate, jsonb_build_object(
    'id', p_candidate_id,
    'campaignId', p_campaign_id
  ));

  if request_record.id is null then
    select * into request_record
      from public.candidate_erasure_requests request
     where request.workspace_id = p_workspace_id
       and request.campaign_id = p_campaign_id
       and request.candidate_id = p_candidate_id
     for update;
    if found then
      legal_hold_active := public.refresh_candidate_erasure_legal_hold_state(request_record.id);
      select * into request_record
        from public.candidate_erasure_requests request
       where request.id = request_record.id
       for update;
      if request_record.status <> 'blocked_legal_hold' or legal_hold_active then
        return public.candidate_erasure_response(request_record.id, true);
      end if;
    end if;
  end if;

  if exists (
    select 1 from public.candidate_legal_holds hold
     where hold.workspace_id = p_workspace_id
       and hold.campaign_id = p_campaign_id
       and hold.candidate_id = p_candidate_id
       and hold.status = 'active'
       and (hold.expires_at is null or hold.expires_at > now())
  ) then
    if request_record.id is null then
      insert into public.candidate_erasure_requests(
        workspace_id, campaign_id, candidate_id, actor_id, request_key, status
      ) values (
        p_workspace_id, p_campaign_id, p_candidate_id, p_actor_id,
        p_request_key, 'blocked_legal_hold'
      ) returning * into request_record;
    end if;
    return public.candidate_erasure_response(request_record.id, request_record.request_key <> p_request_key);
  end if;

  for identity_lock_key in
    select distinct identity.lock_key
      from (
        select public.candidate_erasure_identity_lock_key(
          p_workspace_id,
          identifier.kind,
          identifier.value
        ) as lock_key
          from (values
            ('candidate_id', p_candidate_id),
            ('email', candidate->>'email'),
            ('phone', candidate->>'phone'),
            ('linkedin', candidate->>'linkedinUrl'),
            ('github', candidate->>'githubUrl'),
            ('source_url', candidate->>'sourceUrl'),
            ('source_external_id', candidate->>'sourceExternalId'),
            ('source_authority_id', candidate->>'sourceAuthorityId')
          ) identifier(kind, value)
        union all
        select public.candidate_erasure_identity_lock_key(
          p_workspace_id,
          'provider_external_id',
          target.provider_external_id
        )
          from public.apollo_enrichment_targets target
         where p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           and target.workspace_id = p_workspace_id
           and target.campaign_id = p_campaign_id
           and target.candidate_id = p_candidate_id::uuid
           and target.erased_at is null
      ) identity
     where identity.lock_key is not null
     order by identity.lock_key
  loop
    perform pg_advisory_xact_lock(identity_lock_key);
  end loop;

  if request_record.id is null then
    insert into public.candidate_erasure_requests(
      workspace_id, campaign_id, candidate_id, actor_id, request_key, status,
      local_scrub_completed_at
    ) values (
      p_workspace_id, p_campaign_id, p_candidate_id, p_actor_id,
      p_request_key, 'pending_provider', now()
    ) returning * into request_record;
  else
    update public.candidate_erasure_requests
       set status = 'pending_provider',
           local_scrub_completed_at = now(),
           updated_at = now()
     where id = request_record.id
     returning * into request_record;
  end if;

  insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
  values (p_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;
  insert into public.candidate_erasure_suppression_tombstones(
    request_id, workspace_id, identifier_kind, identifier_hmac
  )
  select request_record.id, p_workspace_id, identifier.kind,
         public.candidate_erasure_identifier_hmac(
           p_workspace_id, identifier.kind, identifier.value
         )
    from (values
      ('candidate_id', p_candidate_id),
      ('email', candidate->>'email'),
      ('phone', candidate->>'phone'),
      ('linkedin', candidate->>'linkedinUrl'),
      ('github', candidate->>'githubUrl'),
      ('source_url', candidate->>'sourceUrl'),
      ('source_external_id', candidate->>'sourceExternalId'),
      ('source_authority_id', candidate->>'sourceAuthorityId')
    ) identifier(kind, value)
   where coalesce(btrim(identifier.value), '') <> ''
  on conflict (workspace_id, identifier_kind, identifier_hmac) do nothing;
  if p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    insert into public.candidate_erasure_suppression_tombstones(
      request_id, workspace_id, identifier_kind, identifier_hmac
    )
    select request_record.id, p_workspace_id, 'provider_external_id',
           public.candidate_erasure_identifier_hmac(
             p_workspace_id, 'provider_external_id', target.provider_external_id
           )
      from public.apollo_enrichment_targets target
     where target.workspace_id = p_workspace_id
       and target.campaign_id = p_campaign_id
       and target.candidate_id = p_candidate_id::uuid
       and target.erased_at is null
    on conflict (workspace_id, identifier_kind, identifier_hmac) do nothing;
  end if;

  select coalesce(array_agg(distinct lower(btrim(value))) filter (
    where value is not null and btrim(value) <> ''
  ), array[]::text[])
    into identities
    from unnest(array[
      p_candidate_id, candidate->>'email', candidate->>'phone', candidate->>'linkedinUrl',
      candidate->>'githubUrl', candidate->>'sourceUrl'
    ]) value;

  select coalesce(array_agg(distinct normalized) filter (
    where length(normalized) between 8 and 15
  ), array[]::text[])
    into phones
    from (
      select regexp_replace(coalesce(candidate->>'phone', ''), '[^0-9]', '', 'g') normalized
      union all
      select regexp_replace(coalesce(message.recipient_e164, message.to_address), '[^0-9]', '', 'g')
        from public.messages_outbound message
       where message.workspace_id = p_workspace_id
         and message.candidate_id = p_candidate_id
      union all
      select regexp_replace(message.from_address, '[^0-9]', '', 'g')
        from public.messages_inbound message
       where message.workspace_id = p_workspace_id
         and (
           message.candidate_id = p_candidate_id
           or lower(btrim(message.from_address)) = any(identities)
           or regexp_replace(message.from_address, '[^0-9]', '', 'g')
             = regexp_replace(coalesce(candidate->>'phone', ''), '[^0-9]', '', 'g')
         )
    ) candidate_phones;
  identities := identities || phones;

  select coalesce(array_agg(message.id), array[]::uuid[]),
         coalesce(array_agg(distinct coalesce(message.approval_message_id, message.id::text)), array[]::text[]),
         coalesce(array_agg(distinct message.content_hash) filter (where message.content_hash is not null), array[]::text[])
    into outbound_ids, approval_ids, content_hashes
    from public.messages_outbound message
   where message.workspace_id = p_workspace_id
     and message.candidate_id = p_candidate_id;
  select coalesce(array_agg(conversation.id), array[]::uuid[])
    into conversation_ids
    from public.agent_conversations conversation
   where conversation.workspace_id = p_workspace_id
     and conversation.candidate_id = p_candidate_id;

  source_provider := regexp_replace(lower(coalesce(candidate->>'sourcePlatform', '')), '[^a-z0-9._:-]', '', 'g');
  source_reference := coalesce(
    nullif(candidate->>'sourceExternalId', ''), nullif(candidate->>'sourceAuthorityId', ''),
    nullif(candidate->>'sourceUrl', ''), p_candidate_id
  );
  if source_provider <> '' and source_provider not in ('manual', 'applicant', 'referral') then
    source_reference_payload := jsonb_strip_nulls(jsonb_build_object(
      'kind', 'source_record',
      'provider', source_provider,
      'campaignId', p_campaign_id,
      'externalId', nullif(candidate->>'sourceExternalId', ''),
      'authorityId', nullif(candidate->>'sourceAuthorityId', ''),
      'sourceUrl', nullif(candidate->>'sourceUrl', ''),
      'lookupEmail', case when source_reference = p_candidate_id
        then nullif(candidate->>'email', '') else null end,
      'lookupName', case when source_reference = p_candidate_id
        then nullif(candidate->>'name', '') else null end
    ));
    insert into public.candidate_erasure_obligations(
      request_id, workspace_id, provider, reference_hmac,
      reference_ciphertext, status
    ) values (
      request_record.id, p_workspace_id, source_provider,
      public.candidate_erasure_reference_hmac(p_workspace_id, source_reference_payload),
      public.candidate_erasure_encrypt_reference(
        p_workspace_id,
        source_reference_payload
      ),
      'manual_required'
    ) on conflict do nothing;
  end if;
  insert into public.candidate_erasure_obligations(
    request_id, workspace_id, provider, reference_hmac,
    reference_ciphertext, status
  )
  select request_record.id, p_workspace_id,
         public.candidate_erasure_provider_for_channel(message.channel),
         public.candidate_erasure_reference_hmac(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'outbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_message_id
           )
         ),
         public.candidate_erasure_encrypt_reference(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'outbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_message_id
           )
         ),
         'manual_required'
    from public.messages_outbound message
   where message.workspace_id = p_workspace_id
     and message.candidate_id = p_candidate_id
     and message.provider_message_id is not null
  on conflict do nothing;
  insert into public.candidate_erasure_obligations(
    request_id, workspace_id, provider, reference_hmac,
    reference_ciphertext, status
  )
  select request_record.id, p_workspace_id,
         public.candidate_erasure_provider_for_channel(message.channel),
         public.candidate_erasure_reference_hmac(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'inbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_id
           )
         ),
         public.candidate_erasure_encrypt_reference(
           p_workspace_id,
           jsonb_build_object(
             'kind', 'message_record',
             'recordId', message.id,
             'direction', 'inbound',
             'channel', lower(message.channel),
             'providerMessageId', message.provider_id
           )
         ),
         'manual_required'
    from public.messages_inbound message
   where message.workspace_id = p_workspace_id
     and (
       message.candidate_id = p_candidate_id
       or message.conversation_id = any(conversation_ids)
       or lower(btrim(message.from_address)) = any(identities)
       or regexp_replace(message.from_address, '[^0-9]', '', 'g') = any(phones)
     )
     and message.provider_id is not null
  on conflict do nothing;
  if p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    insert into public.candidate_erasure_obligations(
      request_id, workspace_id, provider, reference_hmac,
      reference_ciphertext, status
    )
    select request_record.id, p_workspace_id, 'apollo',
           public.candidate_erasure_reference_hmac(
             p_workspace_id,
             jsonb_build_object(
               'kind', 'apollo_profile',
               'targetId', target.id,
               'campaignId', target.campaign_id,
               'providerExternalId', target.provider_external_id
             )
           ),
           public.candidate_erasure_encrypt_reference(
             p_workspace_id,
             jsonb_build_object(
               'kind', 'apollo_profile',
               'targetId', target.id,
               'campaignId', target.campaign_id,
               'providerExternalId', target.provider_external_id
             )
           ),
           'manual_required'
      from public.apollo_enrichment_targets target
     where target.workspace_id = p_workspace_id
       and target.campaign_id = p_campaign_id
       and target.candidate_id = p_candidate_id::uuid
    on conflict do nothing;
  end if;

  delete from public.whatsapp_delivery_events delivery
   where delivery.workspace_id = p_workspace_id
     and delivery.outbound_message_id = any(outbound_ids);
  get diagnostics delivery_count = row_count;
  delete from public.outreach_approvals approval
   where approval.workspace_id = p_workspace_id
     and approval.message_id = any(approval_ids);
  get diagnostics approval_count = row_count;
  delete from public.outbound_content_cache cache
   where cache.workspace_id = p_workspace_id
     and cache.content_hash = any(content_hashes);
  get diagnostics cache_count = row_count;

  update public.messages_inbound message
     set candidate_id = null,
         from_address = '',
         body = 'Candidate data erased',
         provider_id = null,
         last_processing_error = null,
         conversation_id = null,
         owner_id = null
   where message.workspace_id = p_workspace_id
     and (
       message.candidate_id = p_candidate_id
       or message.conversation_id = any(conversation_ids)
       or lower(btrim(message.from_address)) = any(identities)
       or regexp_replace(message.from_address, '[^0-9]', '', 'g') = any(phones)
     );
  get diagnostics inbound_count = row_count;
  update public.messages_outbound message
     set candidate_id = 'erased:' || request_record.id::text || ':' || message.id::text,
         to_address = '',
         recipient_e164 = null,
         subject = '',
         body = 'Candidate data erased',
         gate_result = jsonb_build_object('redacted', true),
         dedupe_hash = encode(digest(convert_to(
           'erased:' || request_record.id::text || ':' || message.id::text,
           'UTF8'
         ), 'sha256'), 'hex'),
         template_parameters = '[]'::jsonb,
         policy_snapshot = null,
         provider_message_id = null,
         delivery_attempt_id = null,
         content_hash = null
   where message.workspace_id = p_workspace_id
     and message.id = any(outbound_ids);
  get diagnostics outbound_count = row_count;
  update public.agent_conversations conversation
     set candidate_id = 'erased:' || request_record.id::text || ':' || conversation.id::text,
         provider_thread_key = 'erased:' || request_record.id::text || ':' || conversation.id::text
   where conversation.workspace_id = p_workspace_id
     and conversation.id = any(conversation_ids);
  get diagnostics conversation_count = row_count;
  update public.outreach_ledger ledger
     set candidate_id = 'erased:' || request_record.id::text || ':' || ledger.id::text,
         candidate_email = '',
         reason = null,
         email_unsubscribe_token_hash = null
   where ledger.workspace_id = p_workspace_id
     and ledger.candidate_id = p_candidate_id;
  get diagnostics ledger_count = row_count;
  delete from public.suppression_list suppression
   where suppression.workspace_id = p_workspace_id
     and lower(btrim(suppression.value)) = any(identities);
  get diagnostics suppression_count = row_count;
  delete from public.whatsapp_conversation_windows conversation_window
   where conversation_window.workspace_id = p_workspace_id
     and conversation_window.recipient_e164 = any(phones);
  get diagnostics window_count = row_count;
  delete from public.whatsapp_contacts contact
   where contact.workspace_id = p_workspace_id
     and contact.recipient_e164 = any(phones);
  get diagnostics contact_count = row_count;

  if p_candidate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    for target_record in
      select target.id, target.erased_at
        from public.apollo_enrichment_targets target
       where target.workspace_id = p_workspace_id
         and target.campaign_id = p_campaign_id
         and target.candidate_id = p_candidate_id::uuid
       for update
    loop
      apollo_count := apollo_count + 1;
      if target_record.erased_at is null then
        apollo_result := public.erase_apollo_enrichment_target(
          p_workspace_id, p_actor_id, p_campaign_id, p_candidate_id::uuid,
          target_record.id, 'erasure:' || request_record.id::text,
          request_record.id::text
        );
        if apollo_result->>'status' not in ('erased', 'already_erased') then
          raise exception 'Apollo local erasure failed' using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  select coalesce(array_agg(run.id), array[]::uuid[])
    into affected_run_ids
    from public.agent_runs run
   where run.workspace_id = p_workspace_id
     and (
       run.state_json::text like '%' || to_jsonb(p_candidate_id)::text || '%'
       or public.candidate_erasure_contains_identity(run.state_json::text, identities)
       or exists (
         select 1 from unnest(phones) phone
          where length(phone) between 8 and 15
            and position(phone in regexp_replace(run.state_json::text, '[^0-9]', '', 'g')) > 0
       )
     );
  update public.agent_runs run
     set state_json = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure'),
         status = case when run.status in ('running', 'awaiting_gate') then 'failed' else run.status end,
         finished_at = case when run.status in ('running', 'awaiting_gate')
           then coalesce(run.finished_at, now()) else run.finished_at end
   where run.workspace_id = p_workspace_id
     and run.id = any(affected_run_ids);
  get diagnostics run_count = row_count;
  update public.agent_events event
     set payload = jsonb_build_object('redacted', true, 'reason', 'candidate_erasure')
   where event.workspace_id = p_workspace_id
     and (
       event.run_id = any(affected_run_ids)
       or event.payload::text like '%' || to_jsonb(p_candidate_id)::text || '%'
       or public.candidate_erasure_contains_identity(event.payload::text, identities)
       or exists (
         select 1 from unnest(phones) phone
          where length(phone) between 8 and 15
            and position(phone in regexp_replace(event.payload::text, '[^0-9]', '', 'g')) > 0
       )
     );
  get diagnostics event_count = row_count;
  update public.agent_framework_sourcing_authorizations sourcing_authorization
     set result_payload = jsonb_set(
       sourcing_authorization.result_payload,
       '{candidates}',
       coalesce((
         select jsonb_agg(item.value order by item.ordinality)
           from jsonb_array_elements(sourcing_authorization.result_payload->'candidates')
             with ordinality item(value, ordinality)
          where item.value->>'id' <> p_candidate_id
            and not public.candidate_erasure_contains_identity(item.value::text, identities)
            and not exists (
              select 1 from unnest(phones) phone
               where length(phone) between 8 and 15
                 and position(phone in regexp_replace(item.value::text, '[^0-9]', '', 'g')) > 0
            )
       ), '[]'::jsonb),
       false
     )
   where sourcing_authorization.workspace_id = p_workspace_id
     and sourcing_authorization.result_payload is not null
     and jsonb_typeof(sourcing_authorization.result_payload->'candidates') = 'array'
     and exists (
       select 1 from jsonb_array_elements(sourcing_authorization.result_payload->'candidates') item(value)
        where item.value->>'id' = p_candidate_id
           or public.candidate_erasure_contains_identity(item.value::text, identities)
           or exists (
             select 1 from unnest(phones) phone
              where length(phone) between 8 and 15
                and position(phone in regexp_replace(item.value::text, '[^0-9]', '', 'g')) > 0
           )
     );
  get diagnostics framework_result_count = row_count;

  if workspace_state_present then
    if jsonb_typeof(workspace_record.state) is distinct from 'object'
       or jsonb_typeof(workspace_record.state->'candidates') is distinct from 'array' then
      raise exception 'candidate workspace scrub failed' using errcode = 'P0001';
    end if;
    if workspace_state_candidate_present then
      scrubbed_state := public.scrub_candidate_workspace_document(
        workspace_record.state, p_candidate_id
      );
      if scrubbed_state is null then
        raise exception 'candidate workspace scrub failed' using errcode = 'P0001';
      end if;
      update public.workspace_state
         set state = scrubbed_state
       where workspace_id = p_workspace_id;
      get diagnostics workspace_state_count = row_count;
      if workspace_state_count <> 1 then
        raise exception 'candidate workspace scrub changed concurrently' using errcode = '40001';
      end if;
    end if;
  end if;

  loop_event_count := public.redact_loop_events_for_candidate_erasure(
    p_workspace_id,
    p_candidate_id,
    identities,
    phones
  );

  insert into public.candidate_erasure_receipts(request_id, workspace_id, store_name, scrubbed_rows)
  values
    (request_record.id, p_workspace_id, 'workspace_state', workspace_state_count),
    (request_record.id, p_workspace_id, 'messages_outbound', outbound_count),
    (request_record.id, p_workspace_id, 'messages_inbound', inbound_count),
    (request_record.id, p_workspace_id, 'agent_conversations', conversation_count),
    (request_record.id, p_workspace_id, 'outreach_ledger', ledger_count),
    (request_record.id, p_workspace_id, 'outreach_approvals', approval_count),
    (request_record.id, p_workspace_id, 'suppression_list', suppression_count),
    (request_record.id, p_workspace_id, 'whatsapp_contacts', contact_count),
    (request_record.id, p_workspace_id, 'whatsapp_conversation_windows', window_count),
    (request_record.id, p_workspace_id, 'whatsapp_delivery_events', delivery_count),
    (request_record.id, p_workspace_id, 'outbound_content_cache', cache_count),
    (request_record.id, p_workspace_id, 'apollo_enrichment', apollo_count),
    (request_record.id, p_workspace_id, 'agent_runs', run_count),
    (request_record.id, p_workspace_id, 'agent_events', event_count),
    (request_record.id, p_workspace_id, 'agent_framework_results', framework_result_count),
    (request_record.id, p_workspace_id, 'loop_events', loop_event_count)
  on conflict (request_id, store_name) do nothing;

  select count(*) into obligation_count
    from public.candidate_erasure_obligations obligation
   where obligation.request_id = request_record.id
     and obligation.status <> 'completed';
  final_status := case when obligation_count = 0 then 'completed' else 'manual_required' end;
  update public.candidate_erasure_requests
     set status = final_status,
         provider_completed_at = case when final_status = 'completed' then now() else null end,
         updated_at = now()
   where id = request_record.id;
  return public.candidate_erasure_response(request_record.id, false);
end;
$$;

revoke all on function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.request_candidate_erasure(uuid, uuid, text, text, uuid)
  to service_role;
