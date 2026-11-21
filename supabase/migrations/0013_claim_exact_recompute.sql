-- Replace the 0011 claim completely. 0011 is already pushed, so this migration
-- installs the live function instead of rewriting that file. The claim
-- recomputes the exact digest and the wire digest, binds the candidate
-- email, and consumes the server cap before it returns. A refusal writes
-- nothing. A crash before commit leaves no claimed row.

alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_body_hash_hex;
alter table public.outreach_approvals
  add constraint outreach_approvals_body_hash_hex
  check (body_hash ~ '^[0-9a-f]{64}$');

alter table public.outreach_approvals
  drop constraint if exists outreach_approvals_exact_body_hash_hex;
alter table public.outreach_approvals
  add constraint outreach_approvals_exact_body_hash_hex
  check (exact_body_hash is null or exact_body_hash ~ '^[0-9a-f]{64}$');

alter table public.outreach_ledger
  drop constraint if exists outreach_ledger_status_check;
alter table public.outreach_ledger
  add constraint outreach_ledger_status_check
  check (status = any (array['claimed', 'sent', 'ambiguous', 'skipped', 'recontact_elapsed']));

-- Members cannot rewrite a claimed row out of the dedupe index.
drop policy if exists "members update outreach_ledger" on public.outreach_ledger;
revoke update (status) on table public.outreach_ledger from authenticated;
revoke update (reason) on table public.outreach_ledger from authenticated;
revoke delete, truncate on table public.outreach_ledger from authenticated;

create table if not exists public.outreach_ledger_events (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null,
  workspace_id uuid not null,
  status text not null,
  reason text,
  at timestamptz not null default now(),
  constraint outreach_ledger_events_status_check
    check (status = any (array['claimed', 'sent', 'ambiguous', 'skipped', 'recontact_elapsed']))
);

alter table public.outreach_ledger_events enable row level security;
alter table public.outreach_ledger_events force row level security;
revoke all on table public.outreach_ledger_events from public, anon, authenticated;

create or replace function public.apply_channel_daily_cap(p_workspace_id uuid, p_channel text)
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  utc_day date := (now() at time zone 'UTC')::date;
  cap integer;
  next_count integer;
begin
  if p_workspace_id is null or p_channel is null or btrim(p_channel) = '' then
    return json_build_object('allowed', false, 'reason', 'invalid-message');
  end if;
  select daily_cap into cap
    from public.outreach_channel_cap_config
    where channel = p_channel;
  if cap is null then
    select daily_cap into cap
      from public.outreach_channel_cap_config
      where channel = '*';
  end if;
  if cap is null or cap <= 0 then
    return json_build_object('allowed', false, 'reason', 'channel-cap');
  end if;

  insert into public.outreach_channel_daily_sends as daily (workspace_id, channel, send_day, sent_count)
  values (p_workspace_id, p_channel, utc_day, 1)
  on conflict (workspace_id, channel, send_day)
  do update set sent_count = daily.sent_count + 1
  where daily.sent_count < cap
  returning sent_count into next_count;

  if next_count is null then
    return json_build_object('allowed', false, 'reason', 'channel-cap');
  end if;
  return json_build_object('allowed', true, 'reason', 'authorized', 'sent_count', next_count);
end;
$$;

revoke all on function public.apply_channel_daily_cap(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.outreach_channel_sent_today(p_workspace_id uuid, p_channel text)
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  wid uuid;
  utc_day date := (now() at time zone 'UTC')::date;
  used integer;
  cap integer;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    wid := p_workspace_id;
  elsif coalesce(auth.role(), '') = 'authenticated' then
    wid := public.current_workspace_id();
  else
    return json_build_object('reason', 'not-authenticated');
  end if;
  if wid is null or p_channel is null or btrim(p_channel) = '' then
    return json_build_object('reason', 'not-authenticated');
  end if;
  select daily_cap into cap
    from public.outreach_channel_cap_config
    where channel = p_channel;
  if cap is null then
    select daily_cap into cap
      from public.outreach_channel_cap_config
      where channel = '*';
  end if;
  if cap is null then
    return json_build_object('reason', 'cap-config-missing');
  end if;
  select sent_count into used
    from public.outreach_channel_daily_sends
    where workspace_id = wid and channel = p_channel and send_day = utc_day;
  return json_build_object('sent_count', coalesce(used, 0), 'daily_cap', cap);
end;
$$;

revoke all on function public.outreach_channel_sent_today(uuid, text) from public, anon, authenticated;
grant execute on function public.outreach_channel_sent_today(uuid, text) to service_role;

drop function if exists public.claim_email_outbound(text, text, text, text, text, text, uuid);

create function public.claim_email_outbound(
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text,
  p_candidate_id text,
  p_candidate_email text,
  p_campaign_id text,
  p_seat_id uuid,
  p_subject text,
  p_body text
) returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
  claim json;
  cap_result json;
  ledger_id uuid;
  recipient text := lower(btrim(coalesce(p_candidate_email, '')));
  wire text;
  scope text;
  exact text;
begin
  if auth.uid() is null or wid is null then
    return json_build_object('allowed', false, 'reason', 'not-authenticated');
  end if;
  if role_name not in ('admin', 'member') then
    return json_build_object('allowed', false, 'reason', 'insufficient-permissions');
  end if;

  select * into approval
    from public.outreach_approvals
    where workspace_id = wid and message_id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.revoked_at is not null then return json_build_object('allowed', false, 'reason', 'approval-revoked'); end if;
  if approval.approval_source <> 'human' then return json_build_object('allowed', false, 'reason', 'approval-not-human'); end if;
  if approval.approved_at is null or approval.approved_at < (now() - interval '7 days') then
    return json_build_object('allowed', false, 'reason', 'approval-expired');
  end if;

  wire := public.outreach_wire_body_hash(p_subject, p_body);
  scope := encode(digest(p_candidate_id || E'\n' || 'Email' || E'\n' || recipient, 'sha256'), 'hex');
  exact := public.exact_outreach_body_hash(
    'Email', recipient, p_subject, p_body,
    'outreach-v1', approval.approved_by::text, approval.approved_at
  );
  if approval.body_hash is distinct from wire
    or p_body_hash is distinct from wire
    or approval.approval_scope_hash is distinct from scope
    or p_approval_scope_hash is distinct from scope
    or approval.exact_body_hash is distinct from exact
  then
    return json_build_object('allowed', false, 'reason', 'approval-mismatch');
  end if;

  claim := public.claim_and_record(
    p_candidate_id,
    recipient,
    p_campaign_id,
    p_seat_id,
    'Email'
  );
  if coalesce((claim ->> 'allowed')::boolean, false) is not true then
    return claim;
  end if;

  cap_result := public.apply_channel_daily_cap(wid, 'Email');
  if coalesce((cap_result ->> 'allowed')::boolean, false) is not true then
    raise exception 'channel daily cap' using errcode = 'P0001';
  end if;

  ledger_id := (claim ->> 'ledger_id')::uuid;
  update public.outreach_ledger
    set approval_message_id = p_message_id
    where id = ledger_id
      and workspace_id = wid
      and status = 'claimed';
  if not found then
    raise exception 'ledger bind failed' using errcode = 'P0001';
  end if;
  return claim;
end;
$$;

revoke all on function public.claim_email_outbound(text, text, text, text, text, text, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.claim_email_outbound(text, text, text, text, text, text, uuid, text, text)
  to authenticated;

create or replace function public.claim_email_outbound_queued(p_message_id uuid) returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
declare
  outbound      public.messages_outbound%rowtype;
  seat          public.agent_seats%rowtype;
  approval      public.outreach_approvals%rowtype;
  recipient     text;
  domain        text;
  approval_id   text;
  used_today    int;
  cap           int;
  new_ledger_id uuid;
  attempt_id    uuid := gen_random_uuid();
  rfc_id        text;
  cap_result    json;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.status <> 'queued' then return json_build_object('allowed', false, 'reason', 'not-queued'); end if;

  approval_id := coalesce(outbound.approval_message_id, outbound.id::text);
  perform pg_advisory_xact_lock(hashtextextended(outbound.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(outbound.to_address, '')));
  domain := split_part(recipient, '@', 2);
  if recipient = '' or domain = '' then
    return json_build_object('allowed', false, 'reason', 'invalid-recipient');
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = outbound.workspace_id
      and a.message_id = approval_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.body_hash is distinct from public.outreach_wire_body_hash(outbound.subject, outbound.body)
    or approval.exact_body_hash is distinct from public.exact_outreach_body_hash(
         outbound.channel, recipient, outbound.subject, outbound.body,
         'outreach-v1', approval.approved_by::text, approval.approved_at)
    or approval.approval_scope_hash is distinct from encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
    or approval.approved_at is null
    or approval.approved_at < (now() - interval '7 days')
  then
    return json_build_object('allowed', false, 'reason', 'approval-required');
  end if;

  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and ((s.type = 'email' and lower(s.value) = recipient)
          or (s.type = 'domain' and lower(s.value) = domain))
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
    or not seat.domain_verified
    or seat.provider in ('WhatsApp Cloud', 'Twilio SMS')
  then
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

  rfc_id := '<' || attempt_id::text || '@' || split_part(seat.operator_email, '@', 2) || '>';

  begin
    insert into public.outreach_ledger(
      workspace_id, candidate_id, candidate_email, seat_id, campaign_id, channel, status,
      approval_message_id, outbound_message_id, send_attempt_id, rfc_message_id
    ) values (
      outbound.workspace_id, outbound.candidate_id, recipient, seat.id,
      coalesce(outbound.campaign_id, outbound.spec_id::text, 'agent'), 'Email', 'claimed',
      approval_id, outbound.id, attempt_id, rfc_id
    ) returning id into new_ledger_id;
  exception when unique_violation then
    return json_build_object('allowed', false, 'reason', 'already-contacted');
  end;

  update public.messages_outbound
    set status = 'dispatching',
        dispatching_at = now(),
        delivery_attempt_id = attempt_id,
        policy_snapshot = jsonb_build_object(
          'policy_version', '2026-07-17',
          'recipient', recipient,
          'content_kind', outbound.type,
          'rfc_message_id', rfc_id
        )
    where id = outbound.id;

  cap_result := public.apply_channel_daily_cap(outbound.workspace_id, 'Email');
  if coalesce((cap_result ->> 'allowed')::boolean, false) is not true then
    raise exception 'channel daily cap' using errcode = 'P0001';
  end if;

  return json_build_object(
    'allowed', true,
    'reason', 'ok',
    'ledger_id', new_ledger_id,
    'delivery_attempt_id', attempt_id,
    'rfc_message_id', rfc_id,
    'operator_email', seat.operator_email,
    'provider', seat.provider
  );
end;
$$;

create or replace function public.append_outreach_ledger_event(
  p_ledger_id uuid,
  p_status text,
  p_reason text
) returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  existing public.outreach_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_status is null or p_status not in ('sent', 'ambiguous', 'skipped', 'recontact_elapsed') then
    return json_build_object('ok', false, 'reason', 'invalid-status');
  end if;
  select * into existing
    from public.outreach_ledger
    where id = p_ledger_id
    for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'missing');
  end if;
  insert into public.outreach_ledger_events(ledger_id, workspace_id, status, reason)
  values (existing.id, existing.workspace_id, p_status, p_reason);
  update public.outreach_ledger
    set status = p_status,
        reason = p_reason
    where id = existing.id;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.append_outreach_ledger_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.append_outreach_ledger_event(uuid, text, text) to service_role;
