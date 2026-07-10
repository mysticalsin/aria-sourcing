-- 0013_outreach_approval_race_safety.sql
--
-- A delivery claim, approval re-record, and revoke must serialize on the same
-- workspace/message key.  The WhatsApp claim owns its outbox row before the
-- pre-dispatch trigger runs, so revocation takes that outbox lock first, then
-- the advisory lock, then the approval row.  That order prevents both a
-- revoked approval from reaching Meta and a lock-order deadlock.

-- A reconciled provider failure is retryable.  Keep the one-live-attempt rule
-- for a human approval without letting an historical `skipped` row reserve its
-- approval id forever.  Build the new index before dropping the old one so a
-- running deployment never has an unprotected interval.
create unique index if not exists outreach_ledger_approval_message_live_uniq
  on public.outreach_ledger (workspace_id, approval_message_id)
  where approval_message_id is not null
    and status in ('claimed', 'sent');

drop index if exists public.outreach_ledger_approval_message_uniq;

-- Approval changes are only valid through the lifecycle RPCs below.  The
-- browser already uses them, and removing table DML closes bypasses that could
-- skip the transaction locks in this migration.
revoke insert, update, delete on public.outreach_approvals from authenticated;
grant select on public.outreach_approvals to authenticated;
drop policy if exists outreach_approvals_insert on public.outreach_approvals;
drop policy if exists outreach_approvals_update on public.outreach_approvals;

-- 0009 accidentally stored two backslashes in these POSIX expressions.  That
-- matched a literal backslash before the number and rejected every normal
-- E.164 recipient in the service-side claim.
create or replace function public.normalize_whatsapp_e164(p_value text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_value ~ '^\+?[1-9][0-9]{7,14}$' then regexp_replace(p_value, '^\+', '')
    else null
  end;
$$;

-- Replace the original claim so its lookup, transaction locks, and pgcrypto
-- search path agree with the lifecycle functions below.  It locks the durable
-- outbox before the advisory key and approval row, exactly like revocation.
create or replace function public.claim_whatsapp_outbound(p_message_id uuid)
returns json
language plpgsql
security definer
set search_path = public, extensions
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
    where id = outbound.seat_id and workspace_id = outbound.workspace_id;
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
    where l.seat_id = seat.id and l.at::date = now()::date and l.status in ('claimed', 'sent');
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

revoke all on function public.claim_whatsapp_outbound(uuid) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_outbound(uuid) to service_role;

create or replace function public.record_outreach_approval(
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;
  if p_body_hash is null or p_approval_scope_hash is null
    or p_body_hash !~ '^[0-9a-f]{64}$' or p_approval_scope_hash !~ '^[0-9a-f]{64}$' then
    return json_build_object('ok', false, 'reason', 'invalid-approval-hash');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;

  -- Re-check after locking the approval.  Otherwise a waiting record request
  -- can overwrite the approval that a completed claim just bound to the ledger.
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  if found then
    update public.outreach_approvals
      set body_hash = p_body_hash,
          approval_scope_hash = p_approval_scope_hash,
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  else
    insert into public.outreach_approvals(
      workspace_id,
      message_id,
      body_hash,
      approval_scope_hash,
      approved_by,
      approved_at,
      approval_source,
      revoked_at,
      revoked_by,
      revocation_reason
    ) values (
      wid,
      p_message_id,
      p_body_hash,
      p_approval_scope_hash,
      auth.uid(),
      now(),
      'human',
      null,
      null,
      null
    ) on conflict (workspace_id, message_id) do nothing;

    select * into approval
      from public.outreach_approvals
      where workspace_id = wid and message_id = p_message_id
      for update;
    if not found then return json_build_object('ok', false, 'reason', 'approval-record-failed'); end if;

    -- The conflict path is only reachable for a legacy/direct writer.  Check
    -- again after taking its row lock before allowing any mutation.
    if exists (
      select 1 from public.outreach_ledger l
        where l.workspace_id = wid
          and l.approval_message_id = p_message_id
          and l.status in ('claimed', 'sent')
    ) then
      return json_build_object('ok', false, 'reason', 'already-dispatching');
    end if;

    update public.outreach_approvals
      set body_hash = p_body_hash,
          approval_scope_hash = p_approval_scope_hash,
          approved_by = auth.uid(),
          approved_at = now(),
          approval_source = 'human',
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = approval.id;
  end if;

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.record_outreach_approval(text, text, text) from public, anon;
grant execute on function public.record_outreach_approval(text, text, text) to authenticated;

create or replace function public.revoke_outreach_approval(
  p_message_id text,
  p_reason text default 'Operator rejected the outreach draft.'
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('ok', false, 'reason', 'insufficient-permissions'); end if;
  if wid is null then return json_build_object('ok', false, 'reason', 'workspace-not-found'); end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;

  -- claim_whatsapp_outbound() owns a queued outbox row before its pre-dispatch
  -- trigger takes the advisory lock.  Taking the same row first is therefore
  -- the common lock order: outbox -> advisory key -> approval row.
  perform 1
    from public.messages_outbound
    where workspace_id = wid
      and coalesce(approval_message_id, id::text) = p_message_id
      and status = 'queued'
    for update;

  perform pg_advisory_xact_lock(hashtextextended(wid::text || ':' || p_message_id, 0));

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;
  if not found then return json_build_object('ok', true, 'revoked', false, 'reason', 'not-found'); end if;
  if approval.revoked_at is not null then return json_build_object('ok', true, 'revoked', false, 'reason', 'already-revoked'); end if;
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = wid
        and l.approval_message_id = p_message_id
        and l.status in ('claimed', 'sent')
  ) then
    return json_build_object('ok', false, 'reason', 'already-dispatching');
  end if;

  update public.outreach_approvals
    set revoked_at = now(),
        revoked_by = auth.uid(),
        revocation_reason = left(coalesce(nullif(trim(p_reason), ''), 'Operator rejected the outreach draft.'), 500)
    where id = approval.id;

  update public.messages_outbound
    set status = 'blocked',
        gate_result = jsonb_build_object('pass', false, 'reasons', jsonb_build_array('approval-revoked'))
    where workspace_id = wid
      and coalesce(approval_message_id, id::text) = p_message_id
      and status = 'queued';

  return json_build_object('ok', true, 'revoked', true);
end;
$$;

revoke all on function public.revoke_outreach_approval(text, text) from public, anon;
grant execute on function public.revoke_outreach_approval(text, text) to authenticated;

-- This trigger is the WhatsApp claim's final gate.  It serializes with the
-- revoke RPC while the claim still owns the outbox row, then locks and reads
-- the exact approval that authorizes the transition to `dispatching`.
create or replace function public.enforce_active_whatsapp_approval()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'WhatsApp' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := public.normalize_whatsapp_e164(coalesce(new.recipient_e164, new.to_address));
  if recipient is null then
    raise exception 'active human approval required for WhatsApp dispatch' using errcode = 'P0001';
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
    raise exception 'active human approval required for WhatsApp dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_outbound_active_whatsapp_approval on public.messages_outbound;
create trigger messages_outbound_active_whatsapp_approval
  before update of status on public.messages_outbound
  for each row execute function public.enforce_active_whatsapp_approval();
