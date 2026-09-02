-- 0056_linkedin_workspace_caps_authority.sql
--
-- LinkedIn workspace caps (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S1).
-- Every LinkedIn send in a workspace, whatever path queued it, counts against
-- one visible ceiling: 25 messages and 25 connection requests per local day.
-- The ceiling lives in sourcing_loop_controls next to the kill switch and is
-- re-checked inside the claim RPCs, so a cap that is reached in the UI is the
-- same cap that stops the dispatcher. Additive over 0054 and 0055: the
-- approval trigger is untouched, the claim bodies gain one check each.
--
-- Authority model
--   sourcing_loop_controls   gains linkedin_daily_message_cap (0..25, default 25),
--                            linkedin_daily_connect_cap (0..25, default 25) and
--                            linkedin_timezone (the local day the caps roll in).
--                            A missing row means cap 0: nothing sends.
--   linkedin_connect_attempts per-connection-request ledger (filled by the
--                            connect primitive in a later slice; counted here).
--   linkedin_daily_usage     counter view over outreach_ledger (first touch),
--                            linkedin_reply_attempts (replies) and
--                            linkedin_connect_attempts, in the workspace day.
--   claim_linkedin_outbound_queued and claim_linkedin_loop_reply lock the
--                            controls row and refuse with
--                            workspace-message-cap-reached at the ceiling.

-- ---------------------------------------------------------------------------
-- 1. Workspace caps (hard ceiling 25, fail closed on a missing row)
-- ---------------------------------------------------------------------------
alter table public.sourcing_loop_controls
  add column if not exists linkedin_daily_message_cap int not null default 25;
alter table public.sourcing_loop_controls
  add column if not exists linkedin_daily_connect_cap int not null default 25;
alter table public.sourcing_loop_controls
  add column if not exists linkedin_timezone text not null default 'UTC';

alter table public.sourcing_loop_controls
  drop constraint if exists sourcing_loop_controls_linkedin_message_cap_check;
alter table public.sourcing_loop_controls
  add constraint sourcing_loop_controls_linkedin_message_cap_check
  check (linkedin_daily_message_cap between 0 and 25);

alter table public.sourcing_loop_controls
  drop constraint if exists sourcing_loop_controls_linkedin_connect_cap_check;
alter table public.sourcing_loop_controls
  add constraint sourcing_loop_controls_linkedin_connect_cap_check
  check (linkedin_daily_connect_cap between 0 and 25);

alter table public.sourcing_loop_controls
  drop constraint if exists sourcing_loop_controls_linkedin_timezone_check;
alter table public.sourcing_loop_controls
  add constraint sourcing_loop_controls_linkedin_timezone_check
  check (length(btrim(linkedin_timezone)) between 1 and 64);

-- ---------------------------------------------------------------------------
-- 2. Connection request ledger (same discipline as linkedin_reply_attempts)
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_connect_attempts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  grant_id            uuid not null references public.linkedin_reply_grants(id) on delete cascade,
  candidate_id        text not null,
  profile_url         text not null,
  send_attempt_id     uuid not null unique,
  status              text not null check (status in ('claimed', 'sent', 'skipped', 'ambiguous')),
  provider_request_id text,
  reason              text,
  at                  timestamptz not null default now()
);

create index if not exists linkedin_connect_attempts_workspace_day_idx
  on public.linkedin_connect_attempts (workspace_id, at);
create unique index if not exists linkedin_connect_attempts_open_profile_uniq
  on public.linkedin_connect_attempts (workspace_id, profile_url)
  where status in ('claimed', 'sent', 'ambiguous');

alter table public.linkedin_connect_attempts enable row level security;
alter table public.linkedin_connect_attempts force row level security;
revoke all on public.linkedin_connect_attempts from public, anon, authenticated, authenticator;
grant select on public.linkedin_connect_attempts to authenticated;
grant select, insert, update on public.linkedin_connect_attempts to service_role;

drop policy if exists linkedin_connect_attempts_owner_access on public.linkedin_connect_attempts;
create policy linkedin_connect_attempts_owner_access on public.linkedin_connect_attempts
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists linkedin_connect_attempts_service_access on public.linkedin_connect_attempts;
create policy linkedin_connect_attempts_service_access on public.linkedin_connect_attempts
  for all to service_role using (true) with check (true);
drop policy if exists linkedin_connect_attempts_member_select on public.linkedin_connect_attempts;
create policy linkedin_connect_attempts_member_select on public.linkedin_connect_attempts
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 3. Counters in the workspace day. An unknown timezone name raises, so a
--    corrupt row fails the claim instead of counting against the wrong day.
-- ---------------------------------------------------------------------------
create or replace function public.linkedin_workspace_timezone(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (select c.linkedin_timezone from public.sourcing_loop_controls c where c.workspace_id = p_workspace_id),
    'UTC'
  );
$$;

create or replace function public.linkedin_messages_today(p_workspace_id uuid)
returns int
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with tz as (select public.linkedin_workspace_timezone(p_workspace_id) as name)
  select (
    (select count(*)
       from public.outreach_ledger l, tz
      where l.workspace_id = p_workspace_id
        and l.channel = 'LinkedIn'
        and l.status in ('claimed', 'sent', 'ambiguous')
        and (l.at at time zone tz.name)::date = (now() at time zone tz.name)::date)
    +
    (select count(*)
       from public.linkedin_reply_attempts a, tz
      where a.workspace_id = p_workspace_id
        and a.status in ('claimed', 'sent', 'ambiguous')
        and (a.at at time zone tz.name)::date = (now() at time zone tz.name)::date)
  )::int;
$$;

create or replace function public.linkedin_connects_today(p_workspace_id uuid)
returns int
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with tz as (select public.linkedin_workspace_timezone(p_workspace_id) as name)
  select (
    select count(*)
      from public.linkedin_connect_attempts x, tz
     where x.workspace_id = p_workspace_id
       and x.status in ('claimed', 'sent', 'ambiguous')
       and (x.at at time zone tz.name)::date = (now() at time zone tz.name)::date
  )::int;
$$;

-- Per-day history for the Settings panel and receipts. security_invoker keeps
-- the member RLS of every underlying table.
create or replace view public.linkedin_daily_usage
with (security_invoker = true)
as
select u.workspace_id, u.day, sum(u.messages)::int as messages, sum(u.connects)::int as connects
  from (
    select l.workspace_id, (l.at at time zone c.linkedin_timezone)::date as day, 1 as messages, 0 as connects
      from public.outreach_ledger l
      join public.sourcing_loop_controls c on c.workspace_id = l.workspace_id
     where l.channel = 'LinkedIn' and l.status in ('claimed', 'sent', 'ambiguous')
    union all
    select a.workspace_id, (a.at at time zone c.linkedin_timezone)::date, 1, 0
      from public.linkedin_reply_attempts a
      join public.sourcing_loop_controls c on c.workspace_id = a.workspace_id
     where a.status in ('claimed', 'sent', 'ambiguous')
    union all
    select x.workspace_id, (x.at at time zone c.linkedin_timezone)::date, 0, 1
      from public.linkedin_connect_attempts x
      join public.sourcing_loop_controls c on c.workspace_id = x.workspace_id
     where x.status in ('claimed', 'sent', 'ambiguous')
  ) u
 group by u.workspace_id, u.day;

revoke all on public.linkedin_daily_usage from public, anon, authenticated, service_role, authenticator;
grant select on public.linkedin_daily_usage to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. claim_linkedin_outbound_queued: 0054 body plus the workspace ceiling.
--    The controls row is locked before the count so concurrent claims in one
--    workspace serialise: the 26th claim in the same second sees 25 and holds.
-- ---------------------------------------------------------------------------
create or replace function public.claim_linkedin_outbound_queued(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound      public.messages_outbound%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  approval_id   text;
  used_today    int;
  cap           int;
  ws_cap        int;
  ws_used       int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  backend       text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('allowed', false, 'reason', 'invalid-linkedin-profile');
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = outbound.workspace_id
      and a.message_id = approval_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.body_hash is distinct from encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    return json_build_object('allowed', false, 'reason', 'approval-required');
  end if;

  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and s.type = 'linkedin'
        and lower(s.value) = recipient
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active'
    or seat.mode <> 'live'
    or seat.provider not in ('LinkedIn Assisted Manual', 'LinkedIn Vendor API')
  then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent', 'ambiguous')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
  end if;

  cap := seat.daily_limit;
  if seat.warmup then
    cap := least(
      seat.daily_limit,
      greatest(
        seat.warmup_start_cap,
        seat.warmup_start_cap + seat.warmup_step_per_day
          * floor(extract(epoch from (now() - seat.warmup_started_at)) / 86400)::int
      )
    );
  end if;
  select count(*) into used_today
    from public.outreach_ledger l
    where l.seat_id = seat.id
      and l.at::date = now()::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  -- Workspace ceiling (0056). Lock the controls row so claims serialise per
  -- workspace; a missing row is cap 0.
  select c.linkedin_daily_message_cap into ws_cap
    from public.sourcing_loop_controls c
    where c.workspace_id = outbound.workspace_id
    for update;
  if not found then ws_cap := 0; end if;
  ws_used := public.linkedin_messages_today(outbound.workspace_id);
  if ws_used >= ws_cap then
    return json_build_object('allowed', false, 'reason', 'workspace-message-cap-reached');
  end if;

  backend := case seat.provider
    when 'LinkedIn Vendor API' then 'vendor-api'
    else 'assisted-manual'
  end;

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      approval_message_id, outbound_message_id, send_attempt_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.campaign_id, outbound.spec_id::text, 'agent'), 'LinkedIn', 'claimed',
      approval_id, outbound.id, attempt_id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-09-02-linkedin-caps',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', backend,
          'workspace_message_cap', ws_cap
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'profile_url', recipient,
    'provider', seat.provider,
    'backend', backend
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. claim_linkedin_loop_reply: 0055 body plus the workspace ceiling. The
--    grant daily_cap stays as the per-campaign sub-limit; the workspace cap
--    is the ceiling over every campaign.
-- ---------------------------------------------------------------------------
create or replace function public.claim_linkedin_loop_reply(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound   public.messages_outbound%rowtype;
  grant_row  public.linkedin_reply_grants%rowtype;
  seat       public.agent_seats%rowtype;
  recipient  text;
  used_today int;
  ws_cap     int;
  ws_used    int;
  attempt_id uuid := gen_random_uuid();
  new_attempt_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound from public.messages_outbound where id = p_message_id for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;
  if outbound.type <> 'candidate_reply' or outbound.linkedin_reply_grant_id is null then
    return json_build_object('allowed', false, 'reason', 'not-a-loop-reply');
  end if;

  select * into grant_row
    from public.linkedin_reply_grants
    where id = outbound.linkedin_reply_grant_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'grant-not-found'); end if;
  if not public.linkedin_reply_grant_active(outbound.workspace_id, grant_row.id) then
    return json_build_object('allowed', false, 'reason', 'campaign-launch-revoked');
  end if;

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('allowed', false, 'reason', 'invalid-linkedin-profile');
  end if;

  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and s.type = 'linkedin'
        and lower(s.value) = recipient
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  select * into seat
    from public.agent_seats
    where id = coalesce(outbound.seat_id, grant_row.seat_id) and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active' or seat.mode <> 'live' or seat.provider <> 'LinkedIn Vendor API' then
    return json_build_object('allowed', false, 'reason', 'seat-not-live-vendor');
  end if;

  -- The grant sub-cap day is the grant's local day, not the UTC day.
  select count(*) into used_today
    from public.linkedin_reply_attempts a
    where a.grant_id = grant_row.id
      and (a.at at time zone grant_row.timezone)::date = (now() at time zone grant_row.timezone)::date
      and a.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= grant_row.daily_cap then
    return json_build_object('allowed', false, 'reason', 'loop-daily-cap-reached');
  end if;

  -- Workspace ceiling (0056). Lock the controls row so claims serialise per
  -- workspace; a missing row is cap 0.
  select c.linkedin_daily_message_cap into ws_cap
    from public.sourcing_loop_controls c
    where c.workspace_id = outbound.workspace_id
    for update;
  if not found then ws_cap := 0; end if;
  ws_used := public.linkedin_messages_today(outbound.workspace_id);
  if ws_used >= ws_cap then
    return json_build_object('allowed', false, 'reason', 'workspace-message-cap-reached');
  end if;

  begin
    insert into public.linkedin_reply_attempts(
      workspace_id, grant_id, outbound_message_id, candidate_id, profile_url, send_attempt_id, status
    ) values (
      outbound.workspace_id, grant_row.id, outbound.id, outbound.candidate_id, recipient, attempt_id, 'claimed'
    ) returning id into new_attempt_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-attempted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-09-02-linkedin-caps',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', 'vendor-api',
          'grant_id', grant_row.id,
          'workspace_message_cap', ws_cap
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'attempt_id', new_attempt_id,
    'delivery_attempt_id', attempt_id,
    'profile_url', recipient,
    'provider', seat.provider
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Human-facing authority: read usage with the switch, set the caps.
-- ---------------------------------------------------------------------------
create or replace function public.read_linkedin_reply_loop_controls()
returns json
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select json_build_object(
      'kill_switch', c.kill_switch,
      'enabled', c.linkedin_reply_loop_enabled,
      'message_cap', c.linkedin_daily_message_cap,
      'connect_cap', c.linkedin_daily_connect_cap,
      'timezone', c.linkedin_timezone,
      'messages_today', public.linkedin_messages_today(c.workspace_id),
      'connects_today', public.linkedin_connects_today(c.workspace_id),
      'day', (now() at time zone c.linkedin_timezone)::date,
      'resets_at', (((now() at time zone c.linkedin_timezone)::date + 1)::timestamp at time zone c.linkedin_timezone)
    )
    from public.sourcing_loop_controls c
    where c.workspace_id = public.current_workspace_id()
  ), json_build_object(
    'kill_switch', true,
    'enabled', false,
    'message_cap', 0,
    'connect_cap', 0,
    'timezone', 'UTC',
    'messages_today', 0,
    'connects_today', 0,
    'day', null,
    'resets_at', null
  ));
$$;

create or replace function public.set_linkedin_sending_caps(
  p_message_cap int,
  p_connect_cap int,
  p_timezone text default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  tz text := nullif(btrim(coalesce(p_timezone, '')), '');
  probe timestamptz;
begin
  if actor_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if role_name <> 'admin' then return json_build_object('ok', false, 'reason', 'admins-only'); end if;
  if p_message_cap is null or p_message_cap not between 0 and 25
     or p_connect_cap is null or p_connect_cap not between 0 and 25 then
    return json_build_object('ok', false, 'reason', 'cap-out-of-range');
  end if;
  if tz is not null then
    if length(tz) > 64 then return json_build_object('ok', false, 'reason', 'invalid-timezone'); end if;
    begin
      probe := (now() at time zone tz);
    exception when others then
      return json_build_object('ok', false, 'reason', 'invalid-timezone');
    end;
  end if;

  insert into public.sourcing_loop_controls (workspace_id) values (wid) on conflict (workspace_id) do nothing;

  update public.sourcing_loop_controls
     set linkedin_daily_message_cap = p_message_cap,
         linkedin_daily_connect_cap = p_connect_cap,
         linkedin_timezone = coalesce(tz, linkedin_timezone),
         updated_by = actor_id,
         updated_at = now()
   where workspace_id = wid;

  return json_build_object(
    'ok', true,
    'message_cap', p_message_cap,
    'connect_cap', p_connect_cap,
    'timezone', coalesce(tz, public.linkedin_workspace_timezone(wid))
  );
end;
$$;

revoke all on function public.linkedin_workspace_timezone(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.linkedin_messages_today(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.linkedin_connects_today(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_linkedin_outbound_queued(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_linkedin_loop_reply(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.read_linkedin_reply_loop_controls() from public, anon, authenticated, service_role, authenticator;
revoke all on function public.set_linkedin_sending_caps(int, int, text) from public, anon, authenticated, service_role, authenticator;

grant execute on function public.claim_linkedin_outbound_queued(uuid) to service_role;
grant execute on function public.claim_linkedin_loop_reply(uuid) to service_role;
grant execute on function public.read_linkedin_reply_loop_controls() to authenticated;
grant execute on function public.set_linkedin_sending_caps(int, int, text) to authenticated;

alter function public.linkedin_workspace_timezone(uuid) owner to postgres;
alter function public.linkedin_messages_today(uuid) owner to postgres;
alter function public.linkedin_connects_today(uuid) owner to postgres;
alter function public.claim_linkedin_outbound_queued(uuid) owner to postgres;
alter function public.claim_linkedin_loop_reply(uuid) owner to postgres;
alter function public.read_linkedin_reply_loop_controls() owner to postgres;
alter function public.set_linkedin_sending_caps(int, int, text) owner to postgres;
alter view public.linkedin_daily_usage owner to postgres;
