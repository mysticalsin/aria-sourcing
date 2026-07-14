-- 0023_conversation_identity.sql
--
-- Inbound replies previously carried no conversation identity: the WhatsApp
-- processor threaded a reply to whichever messages_outbound row was written
-- LAST for that bare phone number (workspace_id + to_address only), so two
-- agents or two seats that both messaged one candidate silently stole each
-- other's replies, and only the zero-match case reached triage.
--
-- This migration adds the canonical conversation table — one row binding
-- workspace / agent spec / candidate / channel / provider thread key — and a
-- service-only resolver that derives a WhatsApp reply's identity from PROVIDER
-- context (the registered sender the candidate actually answered), never from
-- the latest outbound address. Ambiguous or unknown threads fail closed so the
-- caller parks the inbound in durable triage (the 0015 completion path retains
-- the reason as last_processing_error); they are never auto-assigned.

create table if not exists public.agent_conversations (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  spec_id             uuid references public.agent_specs(id) on delete set null,
  candidate_id        text not null,
  channel             text not null check (channel in ('Email', 'LinkedIn', 'WhatsApp', 'SMS')),
  whatsapp_sender_id  uuid references public.whatsapp_senders(id) on delete set null,
  -- WhatsApp: '<whatsapp_sender_id>:<candidate E.164>' — sender-scoped, so the
  -- same phone talking to two registered senders is two distinct conversations
  -- (mirrors the whatsapp_conversation_windows primary key from 0009).
  -- Email: the provider thread id (Gmail threadId / Graph conversationId).
  provider_thread_key text not null check (length(btrim(provider_thread_key)) between 1 and 512),
  created_at          timestamptz not null default now(),
  last_inbound_at     timestamptz,
  unique (workspace_id, channel, provider_thread_key)
);

create index if not exists agent_conversations_workspace_idx
  on public.agent_conversations (workspace_id, channel, last_inbound_at desc);

alter table public.messages_inbound
  add column if not exists conversation_id uuid references public.agent_conversations(id) on delete set null;

alter table public.messages_outbound
  add column if not exists conversation_id uuid references public.agent_conversations(id) on delete set null;

-- No backfill: like 0014's sender backfill rule, historic thread bindings are
-- never guessed. Conversations materialize when the next inbound resolves.

-- RLS posture matches the 0007 messages tables: enabled but NOT forced — the
-- SECURITY DEFINER resolver below runs as the table owner. Post-0019 default
-- ACLs grant nothing, so every privilege here is explicit. Members read their
-- own workspace's conversations; all writes go through the resolver.
alter table public.agent_conversations enable row level security;

revoke all on public.agent_conversations
  from public, anon, authenticated, service_role, authenticator;
grant select on public.agent_conversations to authenticated;

drop policy if exists agent_conversations_select on public.agent_conversations;
create policy agent_conversations_select on public.agent_conversations
  for select using (workspace_id = public.current_workspace_id());

-- Resolve a claimed WhatsApp inbound event to its canonical conversation.
-- Identity comes from the registered provider sender the candidate replied to
-- (whatsapp_sender_id + from_address), NEVER from the latest outbound row for
-- the bare phone number. When no conversation exists yet, the binding is
-- derived only from seat-scoped outbound history for that exact sender; zero
-- matches ('no-conversation') or more than one distinct (candidate, spec)
-- pair ('ambiguous-conversation') fails closed for durable triage.
create or replace function public.resolve_whatsapp_inbound_conversation(
  p_inbound_id uuid,
  p_claim_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  sender public.whatsapp_senders%rowtype;
  conversation public.agent_conversations%rowtype;
  thread_key text;
  binding_count int;
  binding_candidate_id text;
  binding_spec_id uuid;
  resolved_conversation_id uuid;
  resolved_candidate_id text;
  resolved_spec_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if inbound.channel <> 'WhatsApp' then return json_build_object('ok', false, 'reason', 'wrong-channel'); end if;
  -- Same claim binding as complete_whatsapp_inbound_processing (0014): only
  -- the worker holding the active processing claim may resolve identity.
  if inbound.processing_claim_id is distinct from p_claim_id then
    return json_build_object('ok', false, 'reason', 'claim-mismatch');
  end if;
  if inbound.whatsapp_sender_id is null then
    return json_build_object('ok', false, 'reason', 'no-sender-context');
  end if;

  thread_key := inbound.whatsapp_sender_id::text || ':' || inbound.from_address;

  select * into conversation
    from public.agent_conversations
    where workspace_id = inbound.workspace_id
      and channel = 'WhatsApp'
      and provider_thread_key = thread_key
    for update;
  if found then
    update public.agent_conversations
      set last_inbound_at = greatest(coalesce(last_inbound_at, inbound.received_at), inbound.received_at)
      where id = conversation.id;
    resolved_conversation_id := conversation.id;
    resolved_candidate_id := conversation.candidate_id;
    resolved_spec_id := conversation.spec_id;
  else
    select * into sender
      from public.whatsapp_senders
      where id = inbound.whatsapp_sender_id;
    if not found then
      return json_build_object('ok', false, 'reason', 'no-sender-context');
    end if;
    -- A sender with no seat binding has no provider-scoped outbound history to
    -- derive from — fail closed rather than fall back to the bare address.
    if sender.seat_id is null then
      return json_build_object('ok', false, 'reason', 'no-conversation');
    end if;

    select count(*) into binding_count from (
      select distinct m.candidate_id, m.spec_id
        from public.messages_outbound m
        where m.workspace_id = inbound.workspace_id
          and m.channel = 'WhatsApp'
          and m.to_address = inbound.from_address
          and m.seat_id = sender.seat_id
          and m.spec_id is not null
    ) pairs;
    if binding_count = 0 then
      return json_build_object('ok', false, 'reason', 'no-conversation');
    end if;
    if binding_count > 1 then
      return json_build_object('ok', false, 'reason', 'ambiguous-conversation');
    end if;

    select distinct m.candidate_id, m.spec_id
      into binding_candidate_id, binding_spec_id
      from public.messages_outbound m
      where m.workspace_id = inbound.workspace_id
        and m.channel = 'WhatsApp'
        and m.to_address = inbound.from_address
        and m.seat_id = sender.seat_id
        and m.spec_id is not null;

    -- Race-safe against a concurrent inbound on the same thread: the loser of
    -- the unique race adopts the winner's canonical binding via RETURNING.
    insert into public.agent_conversations (
      workspace_id, spec_id, candidate_id, channel, whatsapp_sender_id, provider_thread_key, last_inbound_at
    ) values (
      inbound.workspace_id, binding_spec_id, binding_candidate_id, 'WhatsApp', inbound.whatsapp_sender_id, thread_key, inbound.received_at
    )
    on conflict (workspace_id, channel, provider_thread_key)
      do update set last_inbound_at = excluded.last_inbound_at
    returning id, candidate_id, spec_id
      into resolved_conversation_id, resolved_candidate_id, resolved_spec_id;
  end if;

  update public.messages_inbound
    set conversation_id = resolved_conversation_id,
        candidate_id = coalesce(resolved_candidate_id, candidate_id)
    where id = inbound.id;

  return json_build_object(
    'ok', true,
    'conversation_id', resolved_conversation_id,
    'candidate_id', resolved_candidate_id,
    'spec_id', resolved_spec_id
  );
end;
$$;

revoke all on function public.resolve_whatsapp_inbound_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_inbound_conversation(uuid, uuid) to service_role;
