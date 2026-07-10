-- 0010_whatsapp_delivery_reconciliation.sql
--
-- Meta acceptance, delivery, and read receipts are distinct facts. The outbox
-- remains `sent` once Meta accepts a message; append-only delivery events keep
-- receipt history without allowing a delayed webhook to mutate send state.

create unique index if not exists messages_outbound_provider_message_uniq
  on public.messages_outbound (workspace_id, provider_message_id)
  where provider_message_id is not null;

create table if not exists public.whatsapp_delivery_events (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  outbound_message_id   uuid not null references public.messages_outbound(id) on delete cascade,
  delivery_attempt_id   uuid not null,
  provider_message_id   text not null check (length(provider_message_id) between 1 and 512),
  event_status          text not null check (event_status in ('sent', 'delivered', 'read', 'failed')),
  provider_occurred_at  timestamptz not null,
  received_at           timestamptz not null default now(),
  provider_error        jsonb not null default '{}'::jsonb,
  unique (workspace_id, provider_message_id, event_status, provider_occurred_at)
);

create index if not exists whatsapp_delivery_events_outbound_idx
  on public.whatsapp_delivery_events (workspace_id, outbound_message_id, provider_occurred_at desc);

alter table public.whatsapp_delivery_events enable row level security;

revoke all on public.whatsapp_delivery_events from anon, public;
grant select on public.whatsapp_delivery_events to authenticated;

drop policy if exists whatsapp_delivery_events_select on public.whatsapp_delivery_events;
create policy whatsapp_delivery_events_select on public.whatsapp_delivery_events
  for select using (workspace_id = public.current_workspace_id());

-- Persist Meta provider acceptance atomically with the claimed ledger row.
-- If this fails after Meta accepted the request, the row deliberately remains
-- dispatching: a worker must never retry an ambiguous external send.
create or replace function public.record_whatsapp_provider_acceptance(
  p_message_id uuid,
  p_delivery_attempt_id uuid,
  p_provider_message_id text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  outbound public.messages_outbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_provider_message_id is null or length(p_provider_message_id) < 1 or length(p_provider_message_id) > 512 then
    return json_build_object('allowed', false, 'reason', 'invalid-provider-message-id');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'WhatsApp' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;
  if outbound.status = 'sent' and outbound.provider_message_id = p_provider_message_id then
    return json_build_object('allowed', true, 'reason', 'already-recorded');
  end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;

  update public.messages_outbound
    set status = 'sent',
        sent_at = now(),
        provider_message_id = p_provider_message_id
    where id = outbound.id;

  update public.outreach_ledger
    set status = 'sent',
        reason = null
    where workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
      and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.record_whatsapp_provider_acceptance(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_provider_acceptance(uuid, uuid, text) to service_role;

-- Record a signed provider receipt. Unknown or stale IDs are intentionally a
-- no-op; they never fabricate a cross-workspace delivery association.
create or replace function public.record_whatsapp_delivery_event(
  p_workspace_id uuid,
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('recorded', false, 'reason', 'service-only');
  end if;
  if p_event_status not in ('sent', 'delivered', 'read', 'failed') then
    return json_build_object('recorded', false, 'reason', 'invalid-status');
  end if;
  if p_provider_message_id is null or length(p_provider_message_id) < 1 or length(p_provider_message_id) > 512 then
    return json_build_object('recorded', false, 'reason', 'invalid-provider-message-id');
  end if;
  if p_provider_occurred_at is null then
    return json_build_object('recorded', false, 'reason', 'invalid-event-time');
  end if;

  select * into outbound
    from public.messages_outbound
    where workspace_id = p_workspace_id
      and provider_message_id = p_provider_message_id
      and channel = 'WhatsApp'
    for share;
  if not found then return json_build_object('recorded', false, 'reason', 'outbound-not-found'); end if;
  if outbound.delivery_attempt_id is null then
    return json_build_object('recorded', false, 'reason', 'attempt-not-found');
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

  return json_build_object('recorded', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.record_whatsapp_delivery_event(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.record_whatsapp_delivery_event(uuid, text, text, timestamptz, integer) to service_role;
