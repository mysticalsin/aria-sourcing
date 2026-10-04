-- 0088_claim_linkedin_browser_computer.sql
-- N-agent: claim_linkedin_outbound_queued must allow LinkedIn Browser Computer.
-- Enqueue (0086/0087) already accepts BC + campaign attach, but claim (0055) still
-- allowlists only Assisted Manual / Vendor API → every BC dispatch dies seat-not-live.

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
  select count(*) into used_today
    from public.outreach_ledger l
    where l.seat_id = seat.id
      and l.at::date = now()::date
      and l.status in ('claimed', 'sent', 'ambiguous');
  if used_today >= cap then return json_build_object('allowed', false, 'reason', 'seat-daily-cap-reached'); end if;

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
          'policy_version', '2026-10-03-linkedin-n-agent',
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
