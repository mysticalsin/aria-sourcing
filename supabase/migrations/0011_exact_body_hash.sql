-- Store the wire hash and the exact approval hash in separate columns.
-- claim_email_outbound_queued and enforce_active_email_approval check both,
-- so a row can satisfy the SQL wire digest and the TypeScript exact binding.

alter table public.outreach_approvals
  add column if not exists exact_body_hash text;

comment on column public.outreach_approvals.exact_body_hash is
  'Length-prefixed SHA-256 of channel, recipient, subject, body, notice, approver, and approval time. body_hash remains sha256(subject || newline || body).';

create function public.outreach_length_prefixed(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select octet_length(coalesce(p_value, ''))::text || ':' || coalesce(p_value, '');
$$;

create function public.outreach_sanitized_subject(p_value text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select btrim(regexp_replace(
    regexp_replace(coalesce(p_value, ''), '[\x00-\x1F\x7F]', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'
  ));
$$;

create function public.outreach_canonical_approved_at(p_at timestamp with time zone)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
  select case
    when p_at is null then ''
    else to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  end;
$$;

create function public.exact_outreach_body_hash(
  p_channel text,
  p_recipient text,
  p_subject text,
  p_body text,
  p_notice text,
  p_approver text,
  p_approved_at timestamp with time zone
) returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
  select encode(digest(
      public.outreach_length_prefixed(btrim(normalize(coalesce(p_channel, ''), NFC)))
      || public.outreach_length_prefixed(lower(btrim(normalize(coalesce(p_recipient, ''), NFC))))
      || public.outreach_length_prefixed(public.outreach_sanitized_subject(normalize(coalesce(p_subject, ''), NFC)))
      || public.outreach_length_prefixed(normalize(coalesce(p_body, ''), NFC))
      || public.outreach_length_prefixed(btrim(normalize(coalesce(p_notice, ''), NFC)))
      || public.outreach_length_prefixed(btrim(normalize(coalesce(p_approver, ''), NFC)))
      || public.outreach_length_prefixed(public.outreach_canonical_approved_at(p_approved_at))
    , 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.claim_email_outbound_queued(p_message_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
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

  -- Active human approval, locked, matching the exact stored subject/body and the
  -- candidate+channel+recipient scope. Same shape as the WhatsApp claim (0024).
  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = outbound.workspace_id
      and a.message_id = approval_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'approval-required'); end if;
  if approval.body_hash is distinct from encode(digest(coalesce(outbound.subject, '') || E'\n' || outbound.body, 'sha256'), 'hex')
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

  -- Suppression: opt-out / do-not-contact by exact email or by domain.
  if exists (
    select 1 from public.suppression_list s
      where s.workspace_id = outbound.workspace_id
        and (s.expires_at is null or s.expires_at > now())
        and ((s.type = 'email' and lower(s.value) = recipient)
          or (s.type = 'domain' and lower(s.value) = domain))
  ) then
    return json_build_object('allowed', false, 'reason', 'suppressed');
  end if;

  -- Live, domain-verified email seat (never a WhatsApp/SMS sender).
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

  -- 90-day fleet-wide re-contact window (claimed | sent hold the slot).
  if exists (
    select 1 from public.outreach_ledger l
      where l.workspace_id = outbound.workspace_id
        and l.candidate_id = outbound.candidate_id
        and l.status in ('claimed', 'sent')
        and l.at > now() - interval '90 days'
  ) then
    return json_build_object('allowed', false, 'reason', 'recently-contacted');
  end if;

  -- Per-seat effective warmup cap (ambiguous also consumes a slot, mirroring 0024).
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

  -- Mint the RFC Message-ID BEFORE the send so the MIME header, the ledger, and
  -- the eventual delivery-event correlation all agree on one value. The domain is
  -- the SENDER's (the seat mailbox), per RFC 5322 — never the recipient's.
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

CREATE OR REPLACE FUNCTION public.enforce_active_email_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
    AS $$
declare
  recipient text;
  approval public.outreach_approvals%rowtype;
  approval_id text;
begin
  if new.channel <> 'Email' or old.status <> 'queued' or new.status <> 'dispatching' then
    return new;
  end if;

  approval_id := coalesce(new.approval_message_id, new.id::text);
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || ':' || approval_id, 0));

  recipient := lower(btrim(coalesce(new.to_address, '')));
  if recipient = '' then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  select * into approval
    from public.outreach_approvals a
    where a.workspace_id = new.workspace_id
      and a.message_id = approval_id
    for update;

  if not found
    or approval.body_hash is distinct from encode(digest(coalesce(new.subject, '') || E'\n' || new.body, 'sha256'), 'hex')
    or approval.exact_body_hash is distinct from public.exact_outreach_body_hash(
         new.channel, recipient, new.subject, new.body,
         'outreach-v1', approval.approved_by::text, approval.approved_at)
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
    or approval.approved_at is null
    or approval.approved_at < (now() - interval '7 days')
  then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.claim_email_outbound(p_message_id text, p_body_hash text, p_approval_scope_hash text, p_candidate_id text, p_candidate_email text, p_campaign_id text, p_seat_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  approval public.outreach_approvals%rowtype;
  claim json;
  ledger_id uuid;
begin
  if auth.uid() is null or wid is null then return json_build_object('allowed', false, 'reason', 'not-authenticated'); end if;
  if role_name not in ('admin', 'member') then return json_build_object('allowed', false, 'reason', 'insufficient-permissions'); end if;

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
  if approval.body_hash is distinct from p_body_hash or approval.approval_scope_hash is distinct from p_approval_scope_hash then
    return json_build_object('allowed', false, 'reason', 'approval-mismatch');
  end if;
  if approval.exact_body_hash is null then
    return json_build_object('allowed', false, 'reason', 'approval-mismatch');
  end if;

  claim := public.claim_and_record(
    p_candidate_id,
    p_candidate_email,
    p_campaign_id,
    p_seat_id,
    'Email'
  );
  if coalesce((claim ->> 'allowed')::boolean, false) is not true then return claim; end if;
  ledger_id := (claim ->> 'ledger_id')::uuid;

  update public.outreach_ledger
    set approval_message_id = p_message_id
    where id = ledger_id
      and workspace_id = wid
      and status = 'claimed';
  if not found then
    return json_build_object('allowed', false, 'reason', 'ledger-bind-failed');
  end if;
  return claim;
end;
$$;


create table public.outreach_channel_daily_sends (
  workspace_id uuid not null,
  channel text not null,
  send_day date not null,
  sent_count integer not null default 0,
  primary key (workspace_id, channel, send_day)
);

create function public.outreach_channel_sent_today(p_workspace_id uuid, p_channel text)
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  wid uuid;
  utc_day date := (now() at time zone 'UTC')::date;
  used integer;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    wid := p_workspace_id;
  elsif coalesce(auth.role(), '') = 'authenticated' then
    wid := public.current_workspace_id();
  else
    return json_build_object('sent_count', 0, 'reason', 'not-authenticated');
  end if;
  if wid is null then
    return json_build_object('sent_count', 0, 'reason', 'not-authenticated');
  end if;
  select sent_count into used
    from public.outreach_channel_daily_sends
    where workspace_id = wid and channel = p_channel and send_day = utc_day;
  return json_build_object('sent_count', coalesce(used, 0));
end;
$$;

create function public.consume_outreach_channel_daily_cap(p_workspace_id uuid, p_channel text, p_cap integer)
returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  wid uuid;
  utc_day date := (now() at time zone 'UTC')::date;
  next_count integer;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    wid := p_workspace_id;
  elsif coalesce(auth.role(), '') = 'authenticated' then
    wid := public.current_workspace_id();
    if wid is null or (p_workspace_id is not null and p_workspace_id is distinct from wid) then
      return json_build_object('allowed', false, 'reason', 'not-authenticated');
    end if;
  else
    return json_build_object('allowed', false, 'reason', 'not-authenticated');
  end if;
  if wid is null or p_channel is null or btrim(p_channel) = '' then
    return json_build_object('allowed', false, 'reason', 'invalid-message');
  end if;
  if p_cap is null or p_cap <= 0 then
    return json_build_object('allowed', false, 'reason', 'channel-cap');
  end if;

  insert into public.outreach_channel_daily_sends as daily (workspace_id, channel, send_day, sent_count)
  values (wid, p_channel, utc_day, 1)
  on conflict (workspace_id, channel, send_day)
  do update set sent_count = daily.sent_count + 1
  where daily.sent_count < p_cap
  returning sent_count into next_count;

  if next_count is null then
    return json_build_object('allowed', false, 'reason', 'channel-cap');
  end if;
  return json_build_object('allowed', true, 'reason', 'authorized', 'sent_count', next_count);
end;
$$;

create function public.record_outreach_approval(
  p_message_id text,
  p_body_hash text,
  p_approval_scope_hash text,
  p_approved_at timestamp with time zone,
  p_exact_body_hash text
) returns json
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  result json;
  wid uuid;
begin
  if p_approved_at is null
     or p_approved_at > now() + interval '5 minutes'
     or p_approved_at < now() - interval '5 minutes' then
    return json_build_object('ok', false, 'reason', 'approval-expired');
  end if;
  if p_exact_body_hash is null or p_exact_body_hash !~ '^[0-9a-f]{64}$' then
    return json_build_object('ok', false, 'reason', 'invalid-approval-hash');
  end if;
  result := public.record_outreach_approval(p_message_id, p_body_hash, p_approval_scope_hash);
  if coalesce((result ->> 'ok')::boolean, false) is not true then
    return result;
  end if;
  wid := public.current_workspace_id();
  update public.outreach_approvals
     set approved_at = p_approved_at,
         exact_body_hash = p_exact_body_hash
   where workspace_id = wid
     and message_id = p_message_id
     and revoked_at is null;
  if not found then
    return json_build_object('ok', false, 'reason', 'approval-record-failed');
  end if;
  return result;
end;
$$;

revoke all on function public.outreach_length_prefixed(text) from public;
revoke all on function public.outreach_sanitized_subject(text) from public;
revoke all on function public.outreach_canonical_approved_at(timestamp with time zone) from public;
revoke all on function public.exact_outreach_body_hash(text, text, text, text, text, text, timestamp with time zone) from public;
revoke all on function public.outreach_channel_sent_today(uuid, text) from public;
revoke all on function public.consume_outreach_channel_daily_cap(uuid, text, integer) from public;
revoke all on function public.record_outreach_approval(text, text, text, timestamp with time zone, text) from public;

grant execute on function public.outreach_channel_sent_today(uuid, text) to authenticated, service_role;
grant execute on function public.consume_outreach_channel_daily_cap(uuid, text, integer) to authenticated, service_role;
grant execute on function public.record_outreach_approval(text, text, text, timestamp with time zone, text) to authenticated;
