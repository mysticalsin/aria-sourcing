-- 0054_linkedin_channel_adapter_authority.sql
--
-- Rock 7: LinkedIn is a real outbox channel without making ARIA log into,
-- scrape, or automate LinkedIn itself. This migration is additive over 0053.
-- Existing Email and WhatsApp approval triggers stay byte-identical.

-- ---------------------------------------------------------------------------
-- 1. enforce_active_linkedin_approval: LinkedIn gets its own channel-guarded
--    never-auto-send trigger. It mirrors the Email/WhatsApp shape but fires
--    only on queued -> dispatching LinkedIn rows.
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

drop trigger if exists messages_outbound_active_linkedin_approval on public.messages_outbound;
create trigger messages_outbound_active_linkedin_approval
  before update of status on public.messages_outbound
  for each row execute function public.enforce_active_linkedin_approval();

-- ---------------------------------------------------------------------------
-- 2. claim_linkedin_outbound_queued: service-only atomic claim. It locks the
--    outbox row, re-verifies the exact human approval, suppression, live
--    LinkedIn seat, 90-day cross-channel contact window, and per-seat daily cap;
--    then writes the shared outreach_ledger and transitions queued -> dispatching.
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
          'policy_version', '2026-07-29-linkedin',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', backend
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
-- 3. record_linkedin_delivery_outcome: service-only reconciliation for both
--    LinkedIn backends. It records the operator/vendor outcome in the same
--    durable ledger as Email and WhatsApp.
-- ---------------------------------------------------------------------------
create or replace function public.record_linkedin_delivery_outcome(
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
  ledger public.outreach_ledger%rowtype;
  next_outbox_status text;
  next_ledger_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_outcome not in ('sent', 'skipped', 'ambiguous') then
    return json_build_object('allowed', false, 'reason', 'invalid-outcome');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'LinkedIn' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;

  select * into ledger
    from public.outreach_ledger l
    where l.workspace_id = outbound.workspace_id
      and l.outbound_message_id = outbound.id
      and l.send_attempt_id = p_delivery_attempt_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'ledger-not-found'); end if;
  if ledger.status <> 'claimed' then return json_build_object('allowed', false, 'reason', 'ledger-not-claimed'); end if;

  next_outbox_status := case p_outcome when 'sent' then 'sent' else 'failed' end;
  next_ledger_status := p_outcome;

  update public.messages_outbound
    set status = next_outbox_status,
        sent_at = case when p_outcome = 'sent' then now() else sent_at end,
        provider_message_id = coalesce(nullif(p_provider_message_id, ''), provider_message_id),
        gate_result = case
          when p_outcome = 'sent' then gate_result
          else jsonb_build_object('pass', false, 'reasons', jsonb_build_array(coalesce(nullif(p_reason, ''), 'linkedin-delivery-failed')))
        end
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;

  update public.outreach_ledger
    set status = next_ledger_status,
        reason = case when p_outcome = 'sent' then null else left(coalesce(p_reason, 'LinkedIn delivery failed.'), 512) end
    where id = ledger.id
      and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.enforce_active_linkedin_approval() from public, anon, authenticated, service_role, authenticator;
revoke all on function public.claim_linkedin_outbound_queued(uuid) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text) from public, anon, authenticated, service_role, authenticator;

grant execute on function public.claim_linkedin_outbound_queued(uuid) to service_role;
grant execute on function public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text) to service_role;

alter function public.enforce_active_linkedin_approval() owner to postgres;
alter function public.claim_linkedin_outbound_queued(uuid) owner to postgres;
alter function public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text) owner to postgres;
