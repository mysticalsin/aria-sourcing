-- 0090_claim_linkedin_min_gap_and_defer.sql
-- 1) claim_linkedin: enforce seat.min_gap_minutes against durable ledger
--    (concurrent dispatchDue can both pass in-process pace then dual-send).
-- 2) record_linkedin_delivery_outcome: accept outcome=deferred → requeue
--    outbox + release claimed ledger so soft refuses do not burn the message.

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
  last_send     timestamptz;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  backend       text;
  camp          text;
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
    or not public.outbound_approval_authorizes_send(
         outbound.workspace_id, approval.approval_source, approval.approved_by, approval.template_id, approval.revoked_at
       )
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
    or seat.provider not in (
      'LinkedIn Assisted Manual',
      'LinkedIn Vendor API',
      'LinkedIn Browser Computer'
    )
  then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  -- N-agent: Browser Computer requires durable computer_id + campaign attach (parity with enqueue).
  if seat.provider = 'LinkedIn Browser Computer' then
    if seat.computer_id is null or length(btrim(seat.computer_id)) < 1 then
      return json_build_object('allowed', false, 'reason', 'linkedin-computer-id-missing');
    end if;
    camp := btrim(coalesce(outbound.campaign_id, ''));
    if camp = '' or length(camp) > 120 then
      return json_build_object('allowed', false, 'reason', 'campaign-required');
    end if;
    if not (camp = any(coalesce(seat.assigned_campaign_ids, '{}'::text[]))) then
      return json_build_object('allowed', false, 'reason', 'linkedin-seat-not-attached');
    end if;
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
  -- Europe/Berlin calendar day (CET/CEST) — matches defaultSendWindow("CET").
  select count(*) into used_today
    from public.outreach_ledger l
    where l.seat_id = seat.id
      and (timezone('Europe/Berlin', l.at))::date = (timezone('Europe/Berlin', now()))::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

  -- Durable min-gap: in-process evaluateSendPace is not serialized across workers.
  select max(l.at) into last_send
    from public.outreach_ledger l
    where l.seat_id = seat.id
      and l.status in ('claimed', 'sent', 'ambiguous');
  if last_send is not null
    and coalesce(seat.min_gap_minutes, 0) > 0
    and last_send > now() - make_interval(mins => seat.min_gap_minutes)
  then
    return json_build_object('allowed', false, 'reason', 'seat-min-gap');
  end if;

  backend := case seat.provider
    when 'LinkedIn Vendor API' then 'vendor-api'
    when 'LinkedIn Browser Computer' then 'browser-computer'
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
          'policy_version', '2026-10-04-linkedin-n-agent-min-gap',
          'recipient', recipient,
          'content_kind', outbound.type,
          'linkedin_backend', backend,
          'approval_source', approval.approval_source
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

revoke all on function public.claim_linkedin_outbound_queued(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_linkedin_outbound_queued(uuid) to service_role;


-- Soft-refuse after claim must not burn the outbox (skipped as queued).
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
  if p_outcome not in ('sent', 'skipped', 'ambiguous', 'deferred') then
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

  if p_outcome = 'deferred' then
    -- Release claim: skipped frees active-uniq; clear outbound_message_id for re-claim.
    update public.outreach_ledger
      set status = 'skipped',
          reason = left(coalesce(p_reason, 'LinkedIn delivery deferred.'), 512),
          outbound_message_id = null,
          send_attempt_id = null
      where id = ledger.id
        and status = 'claimed';
    update public.messages_outbound
      set status = 'queued',
          delivery_attempt_id = null,
          dispatching_at = null,
          gate_result = jsonb_build_object(
            'pass', false,
            'deferred', true,
            'reasons', jsonb_build_array(coalesce(nullif(p_reason, ''), 'linkedin-delivery-deferred'))
          )
      where id = outbound.id
        and status = 'dispatching'
        and delivery_attempt_id = p_delivery_attempt_id;
    return json_build_object('allowed', true, 'reason', 'deferred');
  end if;

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

revoke all on function public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text) to service_role;
