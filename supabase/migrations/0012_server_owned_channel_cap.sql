-- The daily cap is server-owned. Callers cannot pass it, authenticated
-- members cannot execute the consume function, and the count table denies
-- every role that is not the service role.

create table if not exists public.outreach_channel_cap_config (
  channel text primary key,
  daily_cap integer not null check (daily_cap >= 0)
);

insert into public.outreach_channel_cap_config(channel, daily_cap)
values ('*', 50)
on conflict (channel) do nothing;

alter table public.outreach_channel_cap_config enable row level security;
alter table public.outreach_channel_cap_config force row level security;
revoke all on table public.outreach_channel_cap_config from public, anon, authenticated;

alter table public.outreach_channel_daily_sends enable row level security;
alter table public.outreach_channel_daily_sends force row level security;
revoke all on table public.outreach_channel_daily_sends from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aria_app') then
    create role aria_app nosuperuser nobypassrls nocreatedb nocreaterole nologin;
  end if;
end $$;
grant aria_app to postgres;

create or replace function public.outreach_wire_body_hash(p_subject text, p_body text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
  select encode(digest(
    public.outreach_sanitized_subject(coalesce(p_subject, '')) || E'\n' || coalesce(p_body, ''),
    'sha256'
  ), 'hex');
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
    or approval.body_hash is distinct from public.outreach_wire_body_hash(new.subject, new.body)
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


revoke all on function public.consume_outreach_channel_daily_cap(uuid, text, integer) from public, anon, authenticated, service_role;
drop function public.consume_outreach_channel_daily_cap(uuid, text, integer);

create function public.consume_outreach_channel_daily_cap(p_workspace_id uuid, p_channel text)
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
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
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

revoke all on function public.outreach_channel_sent_today(uuid, text) from public, anon, authenticated;
revoke all on function public.outreach_wire_body_hash(text, text) from public;
revoke all on function public.consume_outreach_channel_daily_cap(uuid, text) from public;

grant execute on function public.outreach_channel_sent_today(uuid, text) to service_role, aria_app;
grant execute on function public.outreach_wire_body_hash(text, text) to service_role, aria_app;
grant execute on function public.consume_outreach_channel_daily_cap(uuid, text) to service_role, aria_app;
grant usage on schema public to aria_app;
grant select, update on table public.messages_outbound to aria_app;
grant select on table public.outreach_approvals to aria_app;
grant select, update on table public.outreach_ledger to aria_app;
grant execute on function public.claim_email_outbound_queued(uuid) to aria_app;
grant execute on function public.finalize_email_provider_failure(uuid, uuid, text) to aria_app;
grant execute on function public.record_email_send_message_id(uuid, uuid, text) to aria_app;
