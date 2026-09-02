-- 0059_linkedin_connect_primitive_authority.sql
--
-- Connect primitive and accepted event (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S5).
-- A connection request is an outbox row of its own kind: same human gate as a
-- first touch (an approval row hashed over the exact note the launch sheet
-- showed, bound to the campaign launch by 0057), its own claim, its own ledger
-- (linkedin_connect_attempts, created in 0056) and its own daily ceiling
-- (linkedin_daily_connect_cap). It never counts against the message cap and
-- the message claim never sends it.
--
-- Additive over 0056, 0057 and 0058. claim_linkedin_outbound_queued is the
-- 0058 bytes plus one branch that refuses a connection request
-- (tests/linkedin-connect.mts proves it). The approval trigger, the loop
-- claim and the launch are untouched.
--
-- Authority model
--   messages_outbound.type = 'connection_request'
--                                 a connect note (<= 200 chars, may be empty)
--                                 addressed to a LinkedIn profile. Queued by the
--                                 launch, drained by dispatchLinkedInCampaignDue.
--   claim_linkedin_connect        service-only atomic claim: approval row for
--                                 the exact note, campaign-scope launch grant
--                                 still live, suppression, a live vendor seat
--                                 whose sender is connected, the 90-day window,
--                                 the workspace connect cap (controls row locked
--                                 so the 26th claim in the same second holds);
--                                 writes the attempt ledger; queued -> dispatching.
--   record_linkedin_connect_outcome
--                                 service-only reconciliation of the vendor
--                                 answer: sent, skipped or ambiguous.
--   linkedin_connect_events       every CONNECTION_REQUEST_ACCEPTED the vendor
--                                 reports, stored for a person before any
--                                 decision. 'held' with a reason when the first
--                                 message cannot be scheduled; 'scheduled' with
--                                 the outbox row it queued when it can.

-- ---------------------------------------------------------------------------
-- 1. The outbox learns the connection request kind. The 0007 check named the
--    two message kinds inline; find it by content so the widening is exact.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.messages_outbound'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ 'candidate_reply'
  loop
    execute format('alter table public.messages_outbound drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.messages_outbound
  add constraint messages_outbound_type_check
  check (type in ('candidate_reply', 'approved_template', 'connection_request'));

create index if not exists messages_outbound_linkedin_connect_due_idx
  on public.messages_outbound (status, scheduled_at)
  where type = 'connection_request';

-- ---------------------------------------------------------------------------
-- 2. The connect ledger remembers the outbox row it was claimed for.
-- ---------------------------------------------------------------------------
alter table public.linkedin_connect_attempts
  add column if not exists outbound_message_id uuid references public.messages_outbound(id) on delete set null;

create unique index if not exists linkedin_connect_attempts_outbound_uniq
  on public.linkedin_connect_attempts (outbound_message_id)
  where outbound_message_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Accepted events (stored before any decision, one row per vendor event)
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_connect_events (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  grant_id            uuid references public.linkedin_reply_grants(id) on delete set null,
  profile_url         text not null,
  event_type          text not null default 'accepted' check (event_type in ('accepted')),
  provider_id         text not null,
  received_at         timestamptz not null default now(),
  status              text not null default 'held' check (status in ('held', 'scheduled')),
  reason              text,
  outbound_message_id uuid references public.messages_outbound(id) on delete set null,
  at                  timestamptz not null default now(),
  unique (workspace_id, provider_id)
);

create index if not exists linkedin_connect_events_workspace_idx
  on public.linkedin_connect_events (workspace_id, at desc);

alter table public.linkedin_connect_events enable row level security;
alter table public.linkedin_connect_events force row level security;
revoke all on public.linkedin_connect_events from public, anon, authenticated, authenticator;
grant select on public.linkedin_connect_events to authenticated;
grant select, insert, update on public.linkedin_connect_events to service_role;

drop policy if exists linkedin_connect_events_owner_access on public.linkedin_connect_events;
create policy linkedin_connect_events_owner_access on public.linkedin_connect_events
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists linkedin_connect_events_service_access on public.linkedin_connect_events;
create policy linkedin_connect_events_service_access on public.linkedin_connect_events
  for all to service_role using (true) with check (true);
drop policy if exists linkedin_connect_events_member_select on public.linkedin_connect_events;
create policy linkedin_connect_events_member_select on public.linkedin_connect_events
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 4. claim_linkedin_connect: service-only atomic claim for a connection request.
-- ---------------------------------------------------------------------------
create or replace function public.claim_linkedin_connect(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound       public.messages_outbound%rowtype;
  approval       public.outreach_approvals%rowtype;
  grant_row      public.linkedin_reply_grants%rowtype;
  seat           public.agent_seats%rowtype;
  recipient      text;
  approval_id    text;
  ws_cap         int;
  ws_used        int;
  attempt_id     uuid := gen_random_uuid();
  new_attempt_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound from public.messages_outbound where id = p_message_id for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;
  if outbound.type <> 'connection_request' or outbound.linkedin_reply_grant_id is not null then
    return json_build_object('allowed', false, 'reason', 'not-a-connection-request');
  end if;
  if length(outbound.body) > 200 then
    return json_build_object('allowed', false, 'reason', 'note-too-long');
  end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  if recipient = '' or recipient !~ '^https?://([^/]+\.)?linkedin\.com/(in|pub)/.+' then
    return json_build_object('allowed', false, 'reason', 'invalid-linkedin-profile');
  end if;

  -- The human gate: the note exactly as the launch sheet showed it (the two
  -- 0054 hashes), approved by a person and bound to a launch (0057).
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
  if approval.linkedin_reply_grant_id is null then
    return json_build_object('allowed', false, 'reason', 'no-campaign-launch');
  end if;

  -- The launch that approved the note must be a campaign launch and still live
  -- (not revoked, kill switch off, workspace switch on).
  select * into grant_row
    from public.linkedin_reply_grants
    where id = approval.linkedin_reply_grant_id and workspace_id = outbound.workspace_id
    for update;
  if not found or grant_row.scope <> 'campaign' then
    return json_build_object('allowed', false, 'reason', 'no-campaign-launch');
  end if;
  if not public.linkedin_reply_grant_active(outbound.workspace_id, grant_row.id) then
    return json_build_object('allowed', false, 'reason', 'campaign-launch-revoked');
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

  -- Connection requests are vendor-only: a person cannot be asked to copy and
  -- paste an invitation, so assisted-manual never claims one.
  select * into seat
    from public.agent_seats
    where id = coalesce(outbound.seat_id, grant_row.seat_id) and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active' or seat.mode <> 'live' or seat.provider <> 'LinkedIn Vendor API' then
    return json_build_object('allowed', false, 'reason', 'seat-not-live-vendor');
  end if;

  -- Sender state (0058). Any state but 'connected' holds, the default included.
  if seat.provider_state <> 'connected' then
    return json_build_object('allowed', false, 'reason', 'linkedin-sender-not-connected');
  end if;

  -- Someone Aria already wrote to in the last 90 days is not asked to connect.
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent', 'ambiguous')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
  end if;

  -- Workspace connect ceiling (0056). Lock the controls row so claims serialise
  -- per workspace; a missing row is cap 0.
  select c.linkedin_daily_connect_cap into ws_cap
    from public.sourcing_loop_controls c
    where c.workspace_id = outbound.workspace_id
    for update;
  if not found then ws_cap := 0; end if;
  ws_used := public.linkedin_connects_today(outbound.workspace_id);
  if ws_used >= ws_cap then
    return json_build_object('allowed', false, 'reason', 'workspace-connect-cap-reached');
  end if;

  -- Human cadence: at least two minutes between two requests from one
  -- workspace, whichever drain sends them. The controls row lock above makes
  -- this check race-safe across concurrent drains; the dispatcher reschedules.
  if exists (
    select 1 from public.linkedin_connect_attempts x
      where x.workspace_id = outbound.workspace_id
        and x.status in ('claimed', 'sent', 'ambiguous')
        and x.at > now() - interval '2 minutes'
  ) then
    return json_build_object('allowed', false, 'reason', 'connect-too-soon');
  end if;

  -- One open request per profile per workspace (0056 partial unique index).
  begin
    insert into public.linkedin_connect_attempts(
      workspace_id, grant_id, outbound_message_id, candidate_id, profile_url, send_attempt_id, status
    ) values (
      outbound.workspace_id, grant_row.id, outbound.id, outbound.candidate_id, recipient, attempt_id, 'claimed'
    ) returning id into new_attempt_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-requested');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-09-02-linkedin-connect',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', 'vendor-api',
          'grant_id', grant_row.id,
          'workspace_connect_cap', ws_cap
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
-- 5. record_linkedin_connect_outcome: service-only reconciliation.
-- ---------------------------------------------------------------------------
create or replace function public.record_linkedin_connect_outcome(
  p_message_id uuid,
  p_delivery_attempt_id uuid,
  p_outcome text,
  p_reason text default null,
  p_provider_request_id text default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  outbound public.messages_outbound%rowtype;
  attempt  public.linkedin_connect_attempts%rowtype;
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
  if outbound.type <> 'connection_request' then return json_build_object('allowed', false, 'reason', 'not-a-connection-request'); end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;

  select * into attempt
    from public.linkedin_connect_attempts a
    where a.outbound_message_id = outbound.id and a.send_attempt_id = p_delivery_attempt_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'attempt-not-found'); end if;
  if attempt.status <> 'claimed' then return json_build_object('allowed', false, 'reason', 'attempt-not-claimed'); end if;

  update public.messages_outbound
    set status = case p_outcome when 'sent' then 'sent' else 'failed' end,
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        provider_message_id = coalesce(nullif(p_provider_request_id, ''), provider_message_id),
        gate_result = case
          when p_outcome = 'sent' then gate_result
          else jsonb_build_object('pass', false, 'reasons', jsonb_build_array(coalesce(nullif(p_reason, ''), 'linkedin-connect-failed')))
        end
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;

  update public.linkedin_connect_attempts
    set status = p_outcome,
        provider_request_id = coalesce(nullif(p_provider_request_id, ''), provider_request_id),
        reason = case when p_outcome = 'sent' then null else left(coalesce(p_reason, 'LinkedIn connection request failed.'), 512) end
    where id = attempt.id and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. claim_linkedin_outbound_queued: 0058 body plus one branch. A connection
--    request has its own claim above; the message claim refuses it so a note
--    can never leave as a message or count against the message cap.
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

  -- Connection request (0059). A connect note is not a message: it has its
  -- own claim, ledger and cap, and this claim never sends one.
  if outbound.type = 'connection_request' then
    return json_build_object('allowed', false, 'reason', 'not-a-message');
  end if;

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

  -- Sender state (0058). The delivery seat sends only while the vendor reports
  -- the sender attached; every other state, the default included, holds.
  -- Assisted-manual has no vendor sender: a person copies and pastes.
  if seat.provider = 'LinkedIn Vendor API' and seat.provider_state <> 'connected' then
    return json_build_object('allowed', false, 'reason', 'linkedin-sender-not-connected');
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
-- 7. Privileges: service_role only for the claims and the reconciliation.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_linkedin_connect(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.record_linkedin_connect_outcome(uuid, uuid, text, text, text) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_linkedin_outbound_queued(uuid) from public, anon, authenticated, service_role, authenticator;

grant execute on function public.claim_linkedin_connect(uuid) to service_role;
grant execute on function public.record_linkedin_connect_outcome(uuid, uuid, text, text, text) to service_role;
grant execute on function public.claim_linkedin_outbound_queued(uuid) to service_role;

alter function public.claim_linkedin_connect(uuid) owner to postgres;
alter function public.record_linkedin_connect_outcome(uuid, uuid, text, text, text) owner to postgres;
alter function public.claim_linkedin_outbound_queued(uuid) owner to postgres;
