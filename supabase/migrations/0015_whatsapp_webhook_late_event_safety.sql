-- 0015_whatsapp_webhook_late_event_safety.sql
--
-- A signed receipt can arrive after Meta accepts an outbound request but before
-- the acceptance transaction attaches the provider message id to the outbox.
-- Keep that race retryable, while explicitly acknowledging receipts that are
-- provably unrelated to any live dispatch for the registered sender.

drop function if exists public.record_whatsapp_delivery_event(uuid, text, text, timestamptz, integer);

create function public.record_whatsapp_delivery_event(
  p_workspace_id uuid,
  p_sender_id uuid,
  p_provider_message_id text,
  p_event_status text,
  p_provider_occurred_at timestamptz,
  p_provider_error_code integer default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  outbound public.messages_outbound%rowtype;
  pending_outbound_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('recorded', false, 'retryable', false, 'reason', 'service-only');
  end if;
  if p_event_status not in ('sent', 'delivered', 'read', 'failed') then
    return json_build_object('recorded', false, 'retryable', false, 'reason', 'invalid-status');
  end if;
  if p_provider_message_id is null or length(p_provider_message_id) < 1 or length(p_provider_message_id) > 512 then
    return json_build_object('recorded', false, 'retryable', false, 'reason', 'invalid-provider-message-id');
  end if;
  if p_provider_occurred_at is null then
    return json_build_object('recorded', false, 'retryable', false, 'reason', 'invalid-event-time');
  end if;
  if p_sender_id is null or not exists (
    select 1
      from public.whatsapp_senders sender
      where sender.id = p_sender_id
        and sender.workspace_id = p_workspace_id
  ) then
    return json_build_object('recorded', false, 'retryable', false, 'reason', 'unknown-sender');
  end if;

  select * into outbound
    from public.messages_outbound
    where workspace_id = p_workspace_id
      and provider_message_id = p_provider_message_id
      and channel = 'WhatsApp'
    for share;

  if not found then
    -- Serialize briefly with any same-sender acceptance transaction. The claim
    -- is already dispatching before the provider call, so a locked candidate
    -- is proof that this receipt may become addressable once acceptance commits.
    select pending.id into pending_outbound_id
      from public.messages_outbound pending
      join public.whatsapp_senders sender
        on sender.workspace_id = pending.workspace_id
       and sender.seat_id is not distinct from pending.seat_id
      where pending.workspace_id = p_workspace_id
        and pending.channel = 'WhatsApp'
        and pending.status = 'dispatching'
        and sender.id = p_sender_id
      order by pending.dispatching_at asc nulls last
      limit 1
      for key share of pending;

    -- A provider-acceptance writer may have committed while the shared lock
    -- waited. Re-read the authoritative provider-id association before calling
    -- the receipt unknown.
    select * into outbound
      from public.messages_outbound
      where workspace_id = p_workspace_id
        and provider_message_id = p_provider_message_id
        and channel = 'WhatsApp'
      for share;

    if not found then
      if pending_outbound_id is not null then
        return json_build_object('recorded', false, 'retryable', true, 'reason', 'awaiting-provider-acceptance');
      end if;
      return json_build_object('recorded', false, 'retryable', false, 'reason', 'unknown-provider-message');
    end if;
  end if;

  if outbound.delivery_attempt_id is null then
    return json_build_object('recorded', false, 'retryable', true, 'reason', 'attempt-not-found');
  end if;

  insert into public.whatsapp_delivery_events(
    workspace_id,
    outbound_message_id,
    delivery_attempt_id,
    provider_message_id,
    event_status,
    provider_occurred_at,
    provider_error
  ) values (
    outbound.workspace_id,
    outbound.id,
    outbound.delivery_attempt_id,
    p_provider_message_id,
    p_event_status,
    p_provider_occurred_at,
    case
      when p_provider_error_code is null then '{}'::jsonb
      else jsonb_build_object('code', p_provider_error_code)
    end
  ) on conflict (workspace_id, provider_message_id, event_status, provider_occurred_at) do nothing;

  return json_build_object('recorded', true, 'retryable', false, 'reason', 'recorded');
end;
$$;

revoke all on function public.record_whatsapp_delivery_event(uuid, uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.record_whatsapp_delivery_event(uuid, uuid, text, text, timestamptz, integer) to service_role;

-- A duplicate generated review draft can be an idempotent replay or a content
-- collision with another inbound event. Retain the latter as explicit triage
-- instead of clearing its reason while marking the inbound complete.
create or replace function public.complete_whatsapp_inbound_processing(
  p_inbound_id uuid,
  p_claim_id uuid,
  p_outcome text,
  p_error text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inbound public.messages_inbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_outcome not in ('processed', 'triage', 'retry') then
    return json_build_object('ok', false, 'reason', 'invalid-outcome');
  end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if inbound.processing_claim_id is distinct from p_claim_id then
    return json_build_object('ok', false, 'reason', 'claim-mismatch');
  end if;

  update public.messages_inbound
    set processed = p_outcome in ('processed', 'triage'),
        last_processing_error = case
          when p_outcome in ('retry', 'triage') then left(coalesce(p_error, p_outcome), 500)
          else null
        end,
        processing_claim_id = null,
        processing_lease_until = null
    where id = inbound.id;

  return json_build_object('ok', true, 'outcome', p_outcome);
end;
$$;

revoke all on function public.complete_whatsapp_inbound_processing(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_whatsapp_inbound_processing(uuid, uuid, text, text) to service_role;
