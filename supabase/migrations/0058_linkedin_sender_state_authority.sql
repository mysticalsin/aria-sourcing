-- 0058_linkedin_sender_state_authority.sql
--
-- Connect LinkedIn card (docs/outreach/ARIA-LINKEDIN-CONNECT.md, S4).
-- The licensed delivery seat mirrors the vendor's last known sender state and
-- sends only while that state is 'connected'. The fail-closed default is
-- 'disconnected': a seat that finished the identity step (OIDC) but whose
-- sender was never attached at the vendor holds every claim. Nothing in this
-- migration sets 'connected'; that is the sender attach (S0 decides the
-- mechanics) or a vendor state event (S5).
--
-- Additive over 0056 and 0057. Both claim bodies are the 0056 bytes plus one
-- branch each (tests/linkedin-connect-card.mts proves it). The approval
-- trigger is untouched.
--
-- Authority model
--   agent_seats.provider_sender_ref   the vendor's opaque sender id. Never
--                                     selected by the browser, never shown.
--   agent_seats.provider_state        'connected' | 'paused' | 'restricted' |
--                                     'disconnected' (default). 'connected'
--                                     requires a sender ref (check constraint),
--                                     so the card can trust the state alone.
--   claim_linkedin_outbound_queued    refuses with linkedin-sender-not-connected
--                                     for the delivery seat in any state but
--                                     'connected'. Assisted-manual has no vendor
--                                     sender and keeps its human copy/paste path.
--   claim_linkedin_loop_reply         same refusal; the loop is vendor-only.

-- ---------------------------------------------------------------------------
-- 1. Sender columns (fail closed: existing seats read as disconnected)
-- ---------------------------------------------------------------------------
alter table public.agent_seats
  add column if not exists provider_sender_ref text;
alter table public.agent_seats
  add column if not exists provider_state text not null default 'disconnected';

alter table public.agent_seats
  drop constraint if exists agent_seats_provider_state_check;
alter table public.agent_seats
  add constraint agent_seats_provider_state_check
  check (provider_state in ('connected', 'paused', 'restricted', 'disconnected'));

alter table public.agent_seats
  drop constraint if exists agent_seats_provider_connected_needs_ref_check;
alter table public.agent_seats
  add constraint agent_seats_provider_connected_needs_ref_check
  check (provider_state <> 'connected' or length(btrim(coalesce(provider_sender_ref, ''))) > 0);

-- ---------------------------------------------------------------------------
-- 2. claim_linkedin_outbound_queued: 0056 body plus the sender state branch.
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
-- 3. claim_linkedin_loop_reply: 0056 body plus the sender state branch.
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

  -- Sender state (0058). The loop is vendor-only, so any state but
  -- 'connected' holds the reply; the default holds too.
  if seat.provider_state <> 'connected' then
    return json_build_object('allowed', false, 'reason', 'linkedin-sender-not-connected');
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
-- 4. Privileges: unchanged from 0056, restated because the bodies were replaced.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_linkedin_outbound_queued(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_linkedin_loop_reply(uuid) from public, anon, authenticated, service_role, authenticator;

grant execute on function public.claim_linkedin_outbound_queued(uuid) to service_role;
grant execute on function public.claim_linkedin_loop_reply(uuid) to service_role;

alter function public.claim_linkedin_outbound_queued(uuid) owner to postgres;
alter function public.claim_linkedin_loop_reply(uuid) owner to postgres;
