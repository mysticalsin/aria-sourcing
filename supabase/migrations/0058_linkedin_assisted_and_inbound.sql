-- 0058_linkedin_assisted_and_inbound.sql
--
-- Closes the assisted-manual E2E gap (durable confirm) and adds vendor inbound
-- routing so LinkedIn replies can re-enter Aria the same way email does —
-- without LinkedIn login, scrape, or session automation.

-- ---------------------------------------------------------------------------
-- 1. linkedin_inbound_routes — seat → route_key for signed vendor webhooks
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_inbound_routes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  seat_id         uuid not null references public.agent_seats(id) on delete cascade,
  route_key       text not null,
  operator_label  text not null default '',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint linkedin_inbound_routes_key_len check (char_length(route_key) between 16 and 128),
  constraint linkedin_inbound_routes_key_uniq unique (route_key),
  constraint linkedin_inbound_routes_seat_uniq unique (workspace_id, seat_id)
);

create index if not exists linkedin_inbound_routes_ws_idx
  on public.linkedin_inbound_routes (workspace_id) where active;

alter table public.linkedin_inbound_routes enable row level security;
alter table public.linkedin_inbound_routes force row level security;

revoke all on public.linkedin_inbound_routes
  from public, anon, authenticated, service_role, authenticator;
grant select on public.linkedin_inbound_routes to authenticated;

drop policy if exists linkedin_inbound_routes_member_read on public.linkedin_inbound_routes;
create policy linkedin_inbound_routes_member_read on public.linkedin_inbound_routes
  for select to authenticated using (workspace_id = public.current_workspace_id());

drop policy if exists linkedin_inbound_routes_owner_access on public.linkedin_inbound_routes;
create policy linkedin_inbound_routes_owner_access on public.linkedin_inbound_routes
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. upsert_linkedin_inbound_route — admin JWT or service_role
-- ---------------------------------------------------------------------------
create or replace function public.upsert_linkedin_inbound_route(
  p_seat_id uuid,
  p_operator_label text default '',
  p_workspace_id uuid default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  role_name text := coalesce(auth.role(), '');
  wid uuid;
  seat public.agent_seats%rowtype;
  route_id uuid;
  key text;
begin
  if p_seat_id is null then
    return json_build_object('ok', false, 'reason', 'missing-seat');
  end if;

  if role_name = 'service_role' then
    if p_workspace_id is null then
      return json_build_object('ok', false, 'reason', 'missing-workspace');
    end if;
    wid := p_workspace_id;
  else
    if auth.uid() is null then
      return json_build_object('ok', false, 'reason', 'auth-required');
    end if;
    wid := public.current_workspace_id();
    if wid is null then
      return json_build_object('ok', false, 'reason', 'no-workspace');
    end if;
    if not exists (
      select 1 from public.profiles p
       where p.workspace_id = wid and p.id = auth.uid() and p.role = 'admin'
    ) then
      return json_build_object('ok', false, 'reason', 'admin-required');
    end if;
  end if;

  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;
  if not found then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;
  if seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API') then
    return json_build_object('ok', false, 'reason', 'not-linkedin-seat');
  end if;

  key := encode(gen_random_bytes(24), 'hex');

  insert into public.linkedin_inbound_routes (workspace_id, seat_id, route_key, operator_label, active)
  values (wid, p_seat_id, key, coalesce(btrim(p_operator_label), ''), true)
  on conflict (workspace_id, seat_id) do update
    set operator_label = excluded.operator_label,
        active = true;

  select id, route_key into route_id, key
    from public.linkedin_inbound_routes
   where workspace_id = wid and seat_id = p_seat_id;

  if route_id is null then
    return json_build_object('ok', false, 'reason', 'route-upsert-failed');
  end if;

  return json_build_object(
    'ok', true,
    'route_id', route_id,
    'route_key', key,
    'seat_id', p_seat_id,
    'workspace_id', wid
  );
end;
$$;

revoke all on function public.upsert_linkedin_inbound_route(uuid, text, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.upsert_linkedin_inbound_route(uuid, text, uuid)
  to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 3. resolve_linkedin_inbound_route — service-only
-- ---------------------------------------------------------------------------
create or replace function public.resolve_linkedin_inbound_route(p_route_key text)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  route public.linkedin_inbound_routes%rowtype;
  needle text := btrim(coalesce(p_route_key, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if needle = '' then
    return json_build_object('ok', false, 'reason', 'invalid-route-key');
  end if;

  select * into route
    from public.linkedin_inbound_routes
   where route_key = needle and active;
  if not found then
    return json_build_object('ok', false, 'reason', 'no-route');
  end if;

  return json_build_object(
    'ok', true,
    'workspace_id', route.workspace_id,
    'seat_id', route.seat_id,
    'route_id', route.id
  );
end;
$$;

revoke all on function public.resolve_linkedin_inbound_route(text)
  from public, anon, authenticated, authenticator;
grant execute on function public.resolve_linkedin_inbound_route(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. record_linkedin_inbound — service-only, idempotent on provider_id
-- ---------------------------------------------------------------------------
create or replace function public.record_linkedin_inbound(
  p_workspace_id uuid,
  p_provider_id text,
  p_from_profile text,
  p_body text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  existing uuid;
  new_id uuid;
  from_addr text := lower(btrim(coalesce(p_from_profile, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_workspace_id is null or btrim(coalesce(p_provider_id, '')) = '' then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;

  select id into existing
    from public.messages_inbound
   where workspace_id = p_workspace_id
     and channel = 'LinkedIn'
     and provider_id = p_provider_id
   limit 1;
  if existing is not null then
    return json_build_object('ok', true, 'inbound_id', existing, 'duplicate', true);
  end if;

  insert into public.messages_inbound (
    workspace_id, channel, from_address, body, provider_id, processed, received_at
  ) values (
    p_workspace_id, 'LinkedIn', from_addr, coalesce(p_body, ''), p_provider_id, false, now()
  )
  returning id into new_id;

  return json_build_object('ok', true, 'inbound_id', new_id, 'duplicate', false);
end;
$$;

revoke all on function public.record_linkedin_inbound(uuid, text, text, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.record_linkedin_inbound(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. record_linkedin_assisted_manual_send — durable confirm after human paste
-- ---------------------------------------------------------------------------
create or replace function public.record_linkedin_assisted_manual_send(
  p_message_id text,
  p_candidate_id text,
  p_candidate_profile text,
  p_campaign_id text,
  p_seat_id uuid
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  wid uuid;
  seat public.agent_seats%rowtype;
  profile text := lower(btrim(coalesce(p_candidate_profile, '')));
  new_id uuid;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'reason', 'auth-required');
  end if;
  wid := public.current_workspace_id();
  if wid is null then
    return json_build_object('ok', false, 'reason', 'no-workspace');
  end if;
  if btrim(coalesce(p_message_id, '')) = '' or btrim(coalesce(p_candidate_id, '')) = '' then
    return json_build_object('ok', false, 'reason', 'invalid-request');
  end if;
  if profile = '' or position('linkedin.com/' in profile) = 0 then
    return json_build_object('ok', false, 'reason', 'invalid-profile');
  end if;

  -- Suppression (linkedin type) — same axis as claim_linkedin_outbound_queued.
  if exists (
    select 1 from public.suppression_list s
     where s.workspace_id = wid
       and s.type = 'linkedin'
       and s.value = profile
       and (s.expires_at is null or s.expires_at > now())
  ) then
    return json_build_object('ok', false, 'reason', 'suppressed');
  end if;

  select * into seat
    from public.agent_seats
   where id = p_seat_id and workspace_id = wid;
  if not found then
    return json_build_object('ok', false, 'reason', 'seat-not-found');
  end if;
  if seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API') then
    return json_build_object('ok', false, 'reason', 'not-linkedin-seat');
  end if;
  if seat.status <> 'active' then
    return json_build_object('ok', false, 'reason', 'seat-inactive');
  end if;

  begin
    insert into public.outreach_ledger (
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      reason, approval_message_id
    ) values (
      wid, p_candidate_id, profile, seat.id, coalesce(p_campaign_id, 'linkedin'),
      'LinkedIn', 'sent',
      'Operator confirmed assisted-manual LinkedIn send.',
      p_message_id
    )
    returning id into new_id;
  exception when unique_violation then
    return json_build_object('ok', true, 'duplicate', true, 'reason', 'already-recorded');
  end;

  return json_build_object('ok', true, 'ledger_id', new_id, 'duplicate', false);
end;
$$;

revoke all on function public.record_linkedin_assisted_manual_send(text, text, text, text, uuid)
  from public, anon, authenticator;
grant execute on function public.record_linkedin_assisted_manual_send(text, text, text, text, uuid)
  to authenticated;
