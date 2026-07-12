-- Serialize every per-seat daily-cap claimant on the same agent_seats row.
-- 0021 fixed generic/email claim races, but the WhatsApp claim still counted
-- the same ledger without taking that row lock. Two different candidates could
-- therefore observe cap - 1 and both reserve the last slot. Unknown email
-- outcomes are also counted conservatively until a human reconciles them.
--
-- Lock order remains approvals before seats. The email path locks its approval
-- row and then enters claim_and_record. The WhatsApp path keeps its established
-- outbox -> advisory key -> approval -> contact -> sender -> optional template
-- order, then locks the seat immediately before its capacity calculation.

create or replace function public.claim_and_record(
  p_candidate_id    text,
  p_candidate_email text,
  p_campaign_id     text,
  p_seat_id         uuid,
  p_channel         text default 'Email',
  p_recontact_days  int  default 90
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  wid        uuid := public.current_workspace_id();
  domain     text := lower(split_part(coalesce(p_candidate_email,''), '@', 2));
  seat       public.agent_seats%rowtype;
  used_today int;
  cap        int;
  new_id     uuid;
begin
  if wid is null then return json_build_object('allowed', false, 'reason', 'no workspace'); end if;

  if exists (
    select 1 from public.suppression_list s
     where s.workspace_id = wid
       and (s.expires_at is null or s.expires_at > now())
       and ((s.type='email' and lower(s.value)=lower(p_candidate_email))
         or (s.type='domain' and lower(s.value)=domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  if exists (
    select 1 from public.outreach_ledger l
     where l.workspace_id = wid and l.candidate_id = p_candidate_id
       and l.status in ('claimed','sent') and l.at > now() - make_interval(days => p_recontact_days)
  ) then
    return json_build_object('allowed', false, 'reason', 'recently contacted');
  end if;

  select * into seat
    from public.agent_seats
    where id = p_seat_id and workspace_id = wid
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat not found'); end if;
  if seat.status <> 'active' then return json_build_object('allowed', false, 'reason', 'seat not active'); end if;

  cap := seat.daily_limit;
  if seat.warmup then
    cap := least(seat.daily_limit,
                 greatest(seat.warmup_start_cap,
                          seat.warmup_start_cap + seat.warmup_step_per_day *
                          floor(extract(epoch from (now() - seat.warmup_started_at)) / 86400)::int));
  end if;

  select count(*) into used_today from public.outreach_ledger
   where seat_id = p_seat_id
     and at::date = now()::date
     and status in ('claimed','sent','ambiguous');
  if used_today >= cap then
    return json_build_object('allowed', false, 'reason', 'seat daily cap reached');
  end if;

  begin
    insert into public.outreach_ledger(workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status)
      values (wid, p_candidate_id, p_candidate_email, p_seat_id, p_campaign_id, p_channel, 'claimed')
      returning id into new_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already contacted');
  end;

  return json_build_object('allowed', true, 'reason', 'ok', 'ledger_id', new_id);
end;
$$;

revoke all on function public.claim_and_record(text,text,text,uuid,text,int) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_and_record(text,text,text,uuid,text,int) to service_role;

create or replace function public.claim_whatsapp_outbound(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound      public.messages_outbound%rowtype;
  contact       public.whatsapp_contacts%rowtype;
  sender_row    public.whatsapp_senders%rowtype;
  template_row  public.whatsapp_templates%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  approval_id   text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'WhatsApp' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := public.normalize_whatsapp_e164(coalesce(outbound.recipient_e164, outbound.to_address));
  if recipient is null then return json_build_object('allowed', false, 'reason', 'invalid-recipient'); end if;

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

  select * into contact
    from public.whatsapp_contacts
    where workspace_id = outbound.workspace_id and recipient_e164 = recipient
    for update;
  if not found or contact.consent_status <> 'opted_in' then
    return json_build_object('allowed', false, 'reason', 'missing-opt-in');
  end if;
  if contact.expires_at is not null and contact.expires_at <= now() then
    return json_build_object('allowed', false, 'reason', 'permission-expired');
  end if;
  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and s.type = 'phone'
        and s.value = recipient
        and (s.expires_at is null or s.expires_at > now())
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  select * into sender_row
    from public.whatsapp_senders
    where workspace_id = outbound.workspace_id
      and seat_id = outbound.seat_id
      and status = 'active'
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'sender-not-active'); end if;

  if outbound.type = 'approved_template' then
    select * into template_row
      from public.whatsapp_templates
      where id = outbound.template_id
        and workspace_id = outbound.workspace_id
        and sender_id = sender_row.id
      for update;
    if not found or template_row.status <> 'approved' then
      return json_build_object('allowed', false, 'reason', 'template-not-approved');
    end if;
    if jsonb_typeof(outbound.template_parameters) <> 'array'
      or jsonb_array_length(outbound.template_parameters) <> template_row.body_parameter_count then
      return json_build_object('allowed', false, 'reason', 'template-parameters-invalid');
    end if;
  elsif not exists (
    select 1 from public.whatsapp_conversation_windows w
      where w.workspace_id = outbound.workspace_id
        and w.recipient_e164 = recipient
        and w.sender_id = sender_row.id
        and w.freeform_until > now()
  ) then
    return json_build_object('allowed', false, 'reason', 'reply-window-closed');
  end if;

  select * into seat
    from public.agent_seats
    where id = outbound.seat_id and workspace_id = outbound.workspace_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'seat-not-found'); end if;
  if seat.status <> 'active' or seat.mode <> 'live' or seat.provider <> 'WhatsApp Cloud' then
    return json_build_object('allowed', false, 'reason', 'seat-not-live');
  end if;

  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent')
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

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status, approval_message_id, outbound_message_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.spec_id::text, 'agent'), 'WhatsApp', 'claimed', approval_id, outbound.id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set recipient_e164 = recipient,
        status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-07-09',
          'recipient_e164', recipient,
          'consent_recorded_at', contact.recorded_at,
          'content_kind', outbound.type,
          'template_id', outbound.template_id
        )
    where id = outbound.id;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'meta_phone_number_id', sender_row.meta_phone_number_id,
    'template_id', outbound.template_id
  );
end;
$$;

revoke all on function public.claim_whatsapp_outbound(uuid) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_whatsapp_outbound(uuid) to service_role;
