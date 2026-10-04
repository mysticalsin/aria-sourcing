-- 0059_linkedin_heyreach_parity.sql
--
-- HeyReach-parity authority for LinkedIn messaging:
--   * multi-event channel log (reply, connection_accepted, …)
--   * correlate inbound reply → candidate via profile URL + recent ledger
--   * conversation upsert for LinkedIn threads
--   * read_inbound_message_for_loop (Email OR LinkedIn) for classify worker

-- ---------------------------------------------------------------------------
-- 1. linkedin_channel_events — durable multi-event log
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_channel_events (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  seat_id              uuid references public.agent_seats(id) on delete set null,
  event_id             text not null,
  event_type           text not null
    check (event_type in (
      'reply', 'connection_accepted', 'connection_rejected',
      'invite_sent', 'message_sent', 'message_delivered', 'message_seen', 'message_failed'
    )),
  profile_url          text not null default '',
  provider_thread_key  text,
  provider_message_id  text,
  body                 text not null default '',
  payload              jsonb not null default '{}'::jsonb,
  inbound_id           uuid references public.messages_inbound(id) on delete set null,
  conversation_id      uuid references public.agent_conversations(id) on delete set null,
  candidate_id         text,
  occurred_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint linkedin_channel_events_event_id_len check (char_length(event_id) between 1 and 512),
  unique (workspace_id, event_id)
);

create index if not exists linkedin_channel_events_ws_type_idx
  on public.linkedin_channel_events (workspace_id, event_type, occurred_at desc);

create index if not exists linkedin_channel_events_profile_idx
  on public.linkedin_channel_events (workspace_id, lower(profile_url));

alter table public.linkedin_channel_events enable row level security;
alter table public.linkedin_channel_events force row level security;

revoke all on public.linkedin_channel_events
  from public, anon, authenticated, service_role, authenticator;
grant select on public.linkedin_channel_events to authenticated;

drop policy if exists linkedin_channel_events_member_read on public.linkedin_channel_events;
create policy linkedin_channel_events_member_read on public.linkedin_channel_events
  for select to authenticated using (workspace_id = public.current_workspace_id());

drop policy if exists linkedin_channel_events_owner_access on public.linkedin_channel_events;
create policy linkedin_channel_events_owner_access on public.linkedin_channel_events
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. correlate_linkedin_inbound — match profile → candidate + ledger campaign
-- ---------------------------------------------------------------------------
create or replace function public.correlate_linkedin_inbound(p_inbound_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  needle text;
  matched_candidate text;
  matched_ledger uuid;
  matched_campaign text;
  match_count int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;

  select * into inbound from public.messages_inbound where id = p_inbound_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'not-found');
  end if;
  if inbound.channel <> 'LinkedIn' then
    return json_build_object('ok', false, 'reason', 'wrong-channel');
  end if;

  needle := lower(btrim(coalesce(inbound.from_address, '')));
  if needle = '' then
    return json_build_object('ok', false, 'reason', 'empty-profile');
  end if;

  -- Prefer candidates whose linkedinUrl contains the same /in/ or /pub/ slug.
  select count(distinct c.id), min(c.id)
    into match_count, matched_candidate
    from public.candidates c
   where c.workspace_id = inbound.workspace_id
     and c.linkedin_url is not null
     and lower(c.linkedin_url) like '%' || regexp_replace(needle, '^https?://(www\.)?', '') || '%';

  -- Fallback: exact from_address equals a prior LinkedIn ledger candidate_email (profile).
  if match_count is null or match_count = 0 then
    select count(distinct l.candidate_id), min(l.candidate_id)
      into match_count, matched_candidate
      from public.outreach_ledger l
     where l.workspace_id = inbound.workspace_id
       and l.channel = 'LinkedIn'
       and lower(l.candidate_email) = needle
       and l.status in ('claimed', 'sent', 'ambiguous');
  end if;

  if match_count is null or match_count = 0 then
    return json_build_object('ok', true, 'correlated', false, 'reason', 'no-match');
  end if;
  if match_count > 1 then
    return json_build_object('ok', true, 'correlated', false, 'reason', 'ambiguous');
  end if;

  select l.id, l.campaign_id
    into matched_ledger, matched_campaign
    from public.outreach_ledger l
   where l.workspace_id = inbound.workspace_id
     and l.candidate_id = matched_candidate
     and l.channel = 'LinkedIn'
     and l.status in ('claimed', 'sent', 'ambiguous')
   order by l.at desc
   limit 1;

  update public.messages_inbound
     set candidate_id = matched_candidate,
         correlated_ledger_id = matched_ledger
   where id = inbound.id;

  return json_build_object(
    'ok', true,
    'correlated', true,
    'candidate_id', matched_candidate,
    'ledger_id', matched_ledger,
    'campaign_id', coalesce(matched_campaign, '')
  );
end;
$$;

revoke all on function public.correlate_linkedin_inbound(uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.correlate_linkedin_inbound(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. resolve_linkedin_inbound_conversation
-- ---------------------------------------------------------------------------
create or replace function public.resolve_linkedin_inbound_conversation(
  p_inbound_id uuid,
  p_provider_thread_key text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  thread_key text := btrim(coalesce(p_provider_thread_key, ''));
  conversation public.agent_conversations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;

  select * into inbound from public.messages_inbound where id = p_inbound_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'not-found');
  end if;
  if inbound.channel <> 'LinkedIn' then
    return json_build_object('ok', false, 'reason', 'wrong-channel');
  end if;
  if coalesce(inbound.candidate_id, '') = '' then
    return json_build_object('ok', false, 'reason', 'uncorrelated');
  end if;
  if thread_key = '' then
    thread_key := 'li:' || inbound.candidate_id;
  end if;

  insert into public.agent_conversations (
    workspace_id, candidate_id, channel, provider_thread_key, last_inbound_at
  ) values (
    inbound.workspace_id, inbound.candidate_id, 'LinkedIn', thread_key, inbound.received_at
  )
  on conflict (workspace_id, channel, provider_thread_key) do update
    set last_inbound_at = greatest(
          coalesce(public.agent_conversations.last_inbound_at, inbound.received_at),
          inbound.received_at
        ),
        candidate_id = excluded.candidate_id
  returning * into conversation;

  -- Do NOT set messages_inbound.conversation_id here: migration 0028 requires
  -- owner_id whenever conversation_id is set. LinkedIn assisted-manual often
  -- has no agent_specs owner binding; store the conversation on the event row
  -- and keep inbound correlation via candidate_id only.
  return json_build_object(
    'ok', true,
    'conversation_id', conversation.id,
    'provider_thread_key', conversation.provider_thread_key
  );
end;
$$;

revoke all on function public.resolve_linkedin_inbound_conversation(uuid, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.resolve_linkedin_inbound_conversation(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. record_linkedin_channel_event — idempotent multi-event ingest
-- ---------------------------------------------------------------------------
create or replace function public.record_linkedin_channel_event(
  p_workspace_id uuid,
  p_seat_id uuid,
  p_event_id text,
  p_event_type text,
  p_profile_url text,
  p_provider_thread_key text,
  p_provider_message_id text,
  p_body text,
  p_payload jsonb,
  p_occurred_at timestamptz
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  existing uuid;
  new_id uuid;
  inbound_id uuid;
  corr json;
  conv json;
  profile text := lower(btrim(coalesce(p_profile_url, '')));
  evt text := lower(btrim(coalesce(p_event_type, '')));
  eid text := btrim(coalesce(p_event_id, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_workspace_id is null or eid = '' or evt = '' then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;
  if evt not in (
    'reply', 'connection_accepted', 'connection_rejected',
    'invite_sent', 'message_sent', 'message_delivered', 'message_seen', 'message_failed'
  ) then
    return json_build_object('ok', false, 'reason', 'invalid-event-type');
  end if;

  select id into existing
    from public.linkedin_channel_events
   where workspace_id = p_workspace_id and event_id = eid;
  if existing is not null then
    return json_build_object('ok', true, 'duplicate', true, 'event_row_id', existing);
  end if;

  -- Reply events also land in messages_inbound for classify.
  if evt = 'reply' then
    select (public.record_linkedin_inbound(
      p_workspace_id,
      coalesce(nullif(btrim(p_provider_message_id), ''), eid),
      profile,
      coalesce(p_body, '')
    )->>'inbound_id')::uuid into inbound_id;

    if inbound_id is not null then
      corr := public.correlate_linkedin_inbound(inbound_id);
      if (corr->>'correlated')::boolean is true then
        conv := public.resolve_linkedin_inbound_conversation(
          inbound_id,
          coalesce(nullif(btrim(p_provider_thread_key), ''), '')
        );
      end if;
    end if;
  end if;

  insert into public.linkedin_channel_events (
    workspace_id, seat_id, event_id, event_type, profile_url,
    provider_thread_key, provider_message_id, body, payload,
    inbound_id, conversation_id, candidate_id, occurred_at
  ) values (
    p_workspace_id, p_seat_id, eid, evt, profile,
    nullif(btrim(coalesce(p_provider_thread_key, '')), ''),
    nullif(btrim(coalesce(p_provider_message_id, '')), ''),
    coalesce(p_body, ''),
    coalesce(p_payload, '{}'::jsonb),
    inbound_id,
    case when conv is not null and (conv->>'ok')::boolean then (conv->>'conversation_id')::uuid else null end,
    case when corr is not null then corr->>'candidate_id' else null end,
    coalesce(p_occurred_at, now())
  )
  returning id into new_id;

  return json_build_object(
    'ok', true,
    'duplicate', false,
    'event_row_id', new_id,
    'inbound_id', inbound_id,
    'correlated', coalesce((corr->>'correlated')::boolean, false),
    'candidate_id', corr->>'candidate_id',
    'conversation_id', conv->>'conversation_id',
    'event_type', evt
  );
end;
$$;

revoke all on function public.record_linkedin_channel_event(uuid, uuid, text, text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated, authenticator;
grant execute on function public.record_linkedin_channel_event(uuid, uuid, text, text, text, text, text, text, jsonb, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. read_inbound_message_for_loop — Email OR LinkedIn for classify worker
-- ---------------------------------------------------------------------------
create or replace function public.read_inbound_message_for_loop(
  p_workspace_id uuid,
  p_inbound_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  ledger_campaign_id text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('status', 'service_only');
  end if;
  if p_workspace_id is null or p_inbound_id is null then
    return json_build_object('status', 'invalid_request');
  end if;

  select message.*
    into inbound
    from public.messages_inbound message
   where message.id = p_inbound_id
     and message.workspace_id = p_workspace_id
     and message.channel in ('Email', 'LinkedIn');

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  select ledger.campaign_id
    into ledger_campaign_id
    from public.outreach_ledger ledger
   where ledger.id = inbound.correlated_ledger_id
     and ledger.workspace_id = inbound.workspace_id;

  return json_build_object(
    'status', 'ok',
    'inbound_id', inbound.id,
    'channel', inbound.channel,
    'candidate_id', coalesce(inbound.candidate_id, ''),
    'campaign_id', coalesce(ledger_campaign_id, ''),
    'body', inbound.body,
    'received_at', inbound.received_at,
    'message_id', coalesce(inbound.provider_id, ''),
    'from_address', inbound.from_address
  );
end;
$$;

revoke all on function public.read_inbound_message_for_loop(uuid, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.read_inbound_message_for_loop(uuid, uuid) to service_role;

alter function public.correlate_linkedin_inbound(uuid) owner to postgres;
alter function public.resolve_linkedin_inbound_conversation(uuid, text) owner to postgres;
alter function public.record_linkedin_channel_event(uuid, uuid, text, text, text, text, text, text, jsonb, timestamptz) owner to postgres;
alter function public.read_inbound_message_for_loop(uuid, uuid) owner to postgres;

-- Keep legacy email reader as a thin wrapper so older callers stay valid.
create or replace function public.read_inbound_email_for_loop(
  p_workspace_id uuid,
  p_inbound_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  result json;
begin
  result := public.read_inbound_message_for_loop(p_workspace_id, p_inbound_id);
  if (result->>'status') = 'ok' and (result->>'channel') is distinct from 'Email' then
    -- Preserve historical Email-only contract for any remaining Email-specific callers.
    return json_build_object('status', 'not_found');
  end if;
  return result;
end;
$$;
