-- 0055_linkedin_reply_loop_authority.sql
--
-- LinkedIn reply loop: a human launches a campaign once; after that an inbound
-- reply may be answered automatically after a 2 to 10 minute delay, until a
-- meeting is booked. This migration is additive over 0054. The per-message
-- human approval path for LinkedIn (queued -> dispatching) stays byte-identical
-- for every row that does not carry a launch grant.
--
-- Authority model
--   linkedin_reply_grants   the launch record (who, which campaign, which seat,
--                           caps, quiet hours, revoked_at = per-campaign kill)
--   linkedin_reply_attempts per-reply ledger for the daily cap and
--                           reconciliation (a reply in an existing thread is
--                           not a new contact, so outreach_ledger is untouched)
--   sourcing_loop_controls  gains linkedin_reply_loop_enabled (default false):
--                           the workspace kill switch for the loop, on top of
--                           the existing kill_switch
--
-- The same grant table carries a channel column so WhatsApp can join the loop
-- in a later slice without a new authority model.

-- ---------------------------------------------------------------------------
-- 1. Workspace switch (fail closed: default off, admin-attributed enable)
-- ---------------------------------------------------------------------------
alter table public.sourcing_loop_controls
  add column if not exists linkedin_reply_loop_enabled boolean not null default false;

alter table public.sourcing_loop_controls
  drop constraint if exists sourcing_loop_controls_linkedin_reply_loop_check;
alter table public.sourcing_loop_controls
  add constraint sourcing_loop_controls_linkedin_reply_loop_check
  check (not linkedin_reply_loop_enabled or (not kill_switch and updated_by is not null));

-- ---------------------------------------------------------------------------
-- 2. Launch grants
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_reply_grants (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  channel            text not null default 'LinkedIn' check (channel in ('LinkedIn', 'WhatsApp')),
  campaign_id        text not null check (length(btrim(campaign_id)) between 1 and 120),
  -- The vendor's own campaign id (HeyReach campaignId). The inbound webhook
  -- resolves the tenant from it, so it is unique across the whole table.
  vendor_campaign_id text check (vendor_campaign_id is null or length(btrim(vendor_campaign_id)) between 1 and 200),
  seat_id            uuid not null references public.agent_seats(id) on delete restrict,
  calendar_seat_id   uuid references public.agent_seats(id) on delete set null,
  interviewer_email  text not null default '',
  role_title         text not null default '',
  daily_cap          int not null default 20 check (daily_cap between 0 and 200),
  quiet_start        int not null default 21 check (quiet_start between 0 and 23),
  quiet_end          int not null default 8 check (quiet_end between 0 and 23),
  timezone           text not null default 'UTC' check (length(timezone) between 1 and 64),
  granted_by         uuid not null references auth.users(id),
  granted_at         timestamptz not null default now(),
  revoked_by         uuid references auth.users(id),
  revoked_at         timestamptz,
  revoke_reason      text
);

create unique index if not exists linkedin_reply_grants_active_campaign_uniq
  on public.linkedin_reply_grants (workspace_id, channel, campaign_id)
  where revoked_at is null;

create unique index if not exists linkedin_reply_grants_active_vendor_uniq
  on public.linkedin_reply_grants (vendor_campaign_id)
  where revoked_at is null and vendor_campaign_id is not null;

create index if not exists linkedin_reply_grants_vendor_idx
  on public.linkedin_reply_grants (vendor_campaign_id, granted_at desc);

alter table public.linkedin_reply_grants enable row level security;
alter table public.linkedin_reply_grants force row level security;
revoke all on public.linkedin_reply_grants from public, anon, authenticated, authenticator;
grant select on public.linkedin_reply_grants to authenticated;
grant select, insert, update on public.linkedin_reply_grants to service_role;

drop policy if exists linkedin_reply_grants_owner_access on public.linkedin_reply_grants;
create policy linkedin_reply_grants_owner_access on public.linkedin_reply_grants
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists linkedin_reply_grants_service_access on public.linkedin_reply_grants;
create policy linkedin_reply_grants_service_access on public.linkedin_reply_grants
  for all to service_role using (true) with check (true);
drop policy if exists linkedin_reply_grants_member_select on public.linkedin_reply_grants;
create policy linkedin_reply_grants_member_select on public.linkedin_reply_grants
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 3. Per-reply attempt ledger
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_reply_attempts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  grant_id            uuid not null references public.linkedin_reply_grants(id) on delete cascade,
  outbound_message_id uuid not null references public.messages_outbound(id) on delete cascade,
  candidate_id        text not null,
  profile_url         text not null,
  send_attempt_id     uuid not null unique,
  status              text not null check (status in ('claimed', 'sent', 'skipped', 'ambiguous')),
  provider_message_id text,
  reason              text,
  at                  timestamptz not null default now()
);

create unique index if not exists linkedin_reply_attempts_outbound_uniq
  on public.linkedin_reply_attempts (outbound_message_id);
create index if not exists linkedin_reply_attempts_grant_day_idx
  on public.linkedin_reply_attempts (grant_id, at);

alter table public.linkedin_reply_attempts enable row level security;
alter table public.linkedin_reply_attempts force row level security;
revoke all on public.linkedin_reply_attempts from public, anon, authenticated, authenticator;
grant select on public.linkedin_reply_attempts to authenticated;
grant select, insert, update on public.linkedin_reply_attempts to service_role;

drop policy if exists linkedin_reply_attempts_owner_access on public.linkedin_reply_attempts;
create policy linkedin_reply_attempts_owner_access on public.linkedin_reply_attempts
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists linkedin_reply_attempts_service_access on public.linkedin_reply_attempts;
create policy linkedin_reply_attempts_service_access on public.linkedin_reply_attempts
  for all to service_role using (true) with check (true);
drop policy if exists linkedin_reply_attempts_member_select on public.linkedin_reply_attempts;
create policy linkedin_reply_attempts_member_select on public.linkedin_reply_attempts
  for select to authenticated using (workspace_id = public.current_workspace_id());

alter table public.messages_outbound
  add column if not exists linkedin_reply_grant_id uuid references public.linkedin_reply_grants(id) on delete set null;

create index if not exists messages_outbound_linkedin_loop_due_idx
  on public.messages_outbound (status, scheduled_at)
  where linkedin_reply_grant_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Grant liveness: the one predicate every send-side check shares
-- ---------------------------------------------------------------------------
create or replace function public.linkedin_reply_grant_active(p_workspace_id uuid, p_grant_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.linkedin_reply_grants g
      join public.sourcing_loop_controls c on c.workspace_id = g.workspace_id
     where g.id = p_grant_id
       and g.workspace_id = p_workspace_id
       and g.revoked_at is null
       and c.kill_switch = false
       and c.linkedin_reply_loop_enabled = true
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Approval trigger: additive branch for loop replies. Everything after the
--    branch is the 0054 body unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_active_linkedin_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'LinkedIn' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  -- Loop reply: the human gate was the campaign launch. The grant must still
  -- be live and the workspace switch on at the moment of dispatch.
  if new.linkedin_reply_grant_id is not null then
    if new.type = 'candidate_reply'
       and public.linkedin_reply_grant_active(new.workspace_id, new.linkedin_reply_grant_id)
    then
      return new;
    end if;
    raise exception 'active campaign launch grant required for LinkedIn loop reply' using errcode = 'P0001';
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(new.to_address, '')));
  if recipient = '' then
    raise exception 'active human approval required for LinkedIn dispatch' using errcode = 'P0001';
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = new.workspace_id
      and a.message_id = approval_id
    for update;

  if not found
    or approval.body_hash is distinct from encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    raise exception 'active human approval required for LinkedIn dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. claim_linkedin_loop_reply: service-only atomic claim for a loop reply.
--    Re-verifies the grant, the switch, suppression, a live vendor seat and
--    the grant's daily cap; writes the attempt ledger; queued -> dispatching.
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

  -- The cap day is the grant's local day, not the UTC day.
  select count(*) into used_today
    from public.linkedin_reply_attempts a
    where a.grant_id = grant_row.id
      and (a.at at time zone grant_row.timezone)::date = (now() at time zone grant_row.timezone)::date
      and a.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= grant_row.daily_cap then
    return json_build_object('allowed', false, 'reason', 'loop-daily-cap-reached');
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
          'policy_version', '2026-09-02-linkedin-loop',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', 'vendor-api',
          'grant_id', grant_row.id
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
-- 7. record_linkedin_loop_outcome: service-only reconciliation.
-- ---------------------------------------------------------------------------
create or replace function public.record_linkedin_loop_outcome(
  p_message_id uuid,
  p_delivery_attempt_id uuid,
  p_outcome text,
  p_reason text default null,
  p_provider_message_id text default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  outbound public.messages_outbound%rowtype;
  attempt  public.linkedin_reply_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_outcome not in ('sent', 'skipped', 'ambiguous') then
    return json_build_object('allowed', false, 'reason', 'invalid-outcome');
  end if;

  select * into outbound from public.messages_outbound where id = p_message_id for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;

  select * into attempt
    from public.linkedin_reply_attempts a
    where a.outbound_message_id = outbound.id and a.send_attempt_id = p_delivery_attempt_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'attempt-not-found'); end if;
  if attempt.status <> 'claimed' then return json_build_object('allowed', false, 'reason', 'attempt-not-claimed'); end if;

  update public.messages_outbound
    set status = case p_outcome when 'sent' then 'sent' else 'failed' end,
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        provider_message_id = coalesce(nullif(p_provider_message_id, ''), provider_message_id),
        gate_result = case
          when p_outcome = 'sent' then gate_result
          else jsonb_build_object('pass', false, 'reasons', jsonb_build_array(coalesce(nullif(p_reason, ''), 'linkedin-delivery-failed')))
        end
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;

  update public.linkedin_reply_attempts
    set status = p_outcome,
        provider_message_id = coalesce(nullif(p_provider_message_id, ''), provider_message_id),
        reason = case when p_outcome = 'sent' then null else left(coalesce(p_reason, 'LinkedIn delivery failed.'), 512) end
    where id = attempt.id and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Human-facing authority: launch, revoke, workspace switch.
-- ---------------------------------------------------------------------------
create or replace function public.launch_linkedin_reply_loop(
  p_campaign_id text,
  p_vendor_campaign_id text,
  p_seat_id uuid,
  p_calendar_seat_id uuid default null,
  p_interviewer_email text default '',
  p_role_title text default '',
  p_daily_cap int default 20,
  p_quiet_start int default 21,
  p_quiet_end int default 8,
  p_timezone text default 'UTC'
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  seat public.agent_seats%rowtype;
  new_id uuid;
begin
  if actor_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if p_campaign_id is null or length(btrim(p_campaign_id)) not between 1 and 120 then
    return json_build_object('ok', false, 'reason', 'invalid-campaign');
  end if;

  select * into seat from public.agent_seats where id = p_seat_id and workspace_id = wid;
  if not found or seat.provider not in ('LinkedIn Vendor API', 'LinkedIn Assisted Manual') then
    return json_build_object('ok', false, 'reason', 'seat-not-linkedin');
  end if;
  if p_calendar_seat_id is not null and not exists (
    select 1 from public.agent_seats s
      where s.id = p_calendar_seat_id and s.workspace_id = wid and s.provider in ('Gmail API', 'Microsoft Graph')
  ) then
    return json_build_object('ok', false, 'reason', 'calendar-seat-invalid');
  end if;

  begin
    insert into public.linkedin_reply_grants(
      workspace_id, channel, campaign_id, vendor_campaign_id, seat_id, calendar_seat_id,
      interviewer_email, role_title, daily_cap, quiet_start, quiet_end, timezone, granted_by
    ) values (
      wid, 'LinkedIn', btrim(p_campaign_id), nullif(btrim(coalesce(p_vendor_campaign_id, '')), ''), p_seat_id, p_calendar_seat_id,
      coalesce(p_interviewer_email, ''), coalesce(p_role_title, ''),
      coalesce(p_daily_cap, 20), coalesce(p_quiet_start, 21), coalesce(p_quiet_end, 8), coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
      actor_id
    ) returning id into new_id;
  exception when unique_violation then
    return json_build_object('ok', false, 'reason', 'already-launched');
  end;

  return json_build_object('ok', true, 'grant_id', new_id);
end;
$$;

create or replace function public.revoke_linkedin_reply_loop(p_grant_id uuid, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  affected int;
begin
  if actor_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;

  update public.linkedin_reply_grants
     set revoked_at = now(), revoked_by = actor_id, revoke_reason = left(coalesce(p_reason, 'revoked'), 200)
   where (p_grant_id is null or id = p_grant_id)
     and workspace_id = wid
     and revoked_at is null;
  get diagnostics affected = row_count;

  -- Anything still waiting its delay is pulled back to a visible draft.
  update public.messages_outbound
     set status = 'blocked',
         gate_result = jsonb_build_object('pass', false, 'reasons', jsonb_build_array('linkedin-loop:campaign-launch-revoked'))
   where workspace_id = wid
     and channel = 'LinkedIn'
     and status = 'queued'
     and linkedin_reply_grant_id is not null
     and (p_grant_id is null or linkedin_reply_grant_id = p_grant_id);

  return json_build_object('ok', true, 'revoked', affected);
end;
$$;

create or replace function public.set_linkedin_reply_loop_enabled(p_enabled boolean)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
begin
  if actor_id is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if role_name <> 'admin' then return json_build_object('ok', false, 'reason', 'admins-only'); end if;

  insert into public.sourcing_loop_controls (workspace_id) values (wid) on conflict (workspace_id) do nothing;

  if p_enabled then
    update public.sourcing_loop_controls
       set linkedin_reply_loop_enabled = true, updated_by = actor_id, updated_at = now()
     where workspace_id = wid and kill_switch = false;
    if not found then
      return json_build_object('ok', false, 'reason', 'kill-switch-engaged');
    end if;
  else
    update public.sourcing_loop_controls
       set linkedin_reply_loop_enabled = false, updated_by = actor_id, updated_at = now()
     where workspace_id = wid;
  end if;

  return json_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

create or replace function public.read_linkedin_reply_loop_controls()
returns json
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce((
    select json_build_object(
      'kill_switch', c.kill_switch,
      'enabled', c.linkedin_reply_loop_enabled
    )
    from public.sourcing_loop_controls c
    where c.workspace_id = public.current_workspace_id()
  ), json_build_object('kill_switch', true, 'enabled', false));
$$;

revoke all on function public.linkedin_reply_grant_active(uuid, uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.enforce_active_linkedin_approval() from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_linkedin_loop_reply(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.record_linkedin_loop_outcome(uuid, uuid, text, text, text) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.launch_linkedin_reply_loop(text, text, uuid, uuid, text, text, int, int, int, text) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.revoke_linkedin_reply_loop(uuid, text) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.set_linkedin_reply_loop_enabled(boolean) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.read_linkedin_reply_loop_controls() from public, anon, authenticated, service_role, authenticator;

grant execute on function public.claim_linkedin_loop_reply(uuid) to service_role;
grant execute on function public.record_linkedin_loop_outcome(uuid, uuid, text, text, text) to service_role;
grant execute on function public.launch_linkedin_reply_loop(text, text, uuid, uuid, text, text, int, int, int, text) to authenticated;
grant execute on function public.revoke_linkedin_reply_loop(uuid, text) to authenticated;
grant execute on function public.set_linkedin_reply_loop_enabled(boolean) to authenticated;
grant execute on function public.read_linkedin_reply_loop_controls() to authenticated;

alter function public.linkedin_reply_grant_active(uuid, uuid) owner to postgres;
alter function public.enforce_active_linkedin_approval() owner to postgres;
alter function public.claim_linkedin_loop_reply(uuid) owner to postgres;
alter function public.record_linkedin_loop_outcome(uuid, uuid, text, text, text) owner to postgres;
alter function public.launch_linkedin_reply_loop(text, text, uuid, uuid, text, text, int, int, int, text) owner to postgres;
alter function public.revoke_linkedin_reply_loop(uuid, text) owner to postgres;
alter function public.set_linkedin_reply_loop_enabled(boolean) owner to postgres;
alter function public.read_linkedin_reply_loop_controls() owner to postgres;
