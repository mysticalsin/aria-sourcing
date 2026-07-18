-- 0039_email_channel_durability.sql
--
-- Rock 2 of the industrial autonomous sourcing loop: Email joins the durable
-- outbox on WhatsApp's proven terms. Until now an approved email was sent
-- synchronously inside the /api/outreach/send request (0011 claim_email_outbound
-- -> claim_and_record -> in-request provider call -> ledger reconcile). A closed
-- browser therefore meant no send. This migration gives email the same
-- durable-outbox spine WhatsApp already has (0009/0010/0013/0024):
--
--   * a queued messages_outbound row (channel 'Email') that a headless worker
--     leases and transitions queued -> dispatching in ONE service-only claim,
--   * a pre-dispatch trigger that RAISES if that transition is attempted without
--     an active, unrevoked, hash+scope-matching human approval — the mechanical
--     never-auto-send guarantee, now enforced for Email exactly as for WhatsApp,
--   * an append-only email_delivery_events mirror of whatsapp_delivery_events so a
--     provider webhook records delivered/bounced/complained/opened without ever
--     mutating send state; a permanent bounce or a spam complaint upserts the
--     suppression list,
--   * outreach_ledger.rfc_message_id — the RFC 5322 Message-ID the send stamps in
--     the MIME headers — as the durable correlation key a reply (Rock 3) threads
--     back to.
--
-- Nothing here changes WhatsApp, LinkedIn, or SMS behaviour. The existing
-- synchronous email path stays valid; the worker path is additive and ships dark
-- behind the loop kill switch (0038). Idempotent; safe to re-run.
-- Run AFTER 0038_loop_job_authority.sql.

-- ---------------------------------------------------------------------------
-- 1. messages_outbound: carry the campaign id so the durable claim can stamp it
--    on the ledger (email drafts are scoped by a client campaign id, unlike the
--    agent WhatsApp path that reuses spec_id). Additive, nullable.
-- ---------------------------------------------------------------------------
alter table public.messages_outbound
  add column if not exists campaign_id text;

-- ---------------------------------------------------------------------------
-- 2. outreach_ledger.rfc_message_id — the outbound RFC Message-ID (correlation
--    key for inbound reply threading in Rock 3). Format-checked and unique per
--    workspace so a delivery webhook or a reply resolves exactly one attempt.
-- ---------------------------------------------------------------------------
alter table public.outreach_ledger
  add column if not exists rfc_message_id text;

alter table public.outreach_ledger
  drop constraint if exists outreach_ledger_rfc_message_id_check;

alter table public.outreach_ledger
  add constraint outreach_ledger_rfc_message_id_check
  check (
    rfc_message_id is null
    or rfc_message_id ~ '^<[^<>@\s]+@[^<>@\s]+>$'
  ) not valid;

create unique index if not exists outreach_ledger_rfc_message_id_uniq
  on public.outreach_ledger (workspace_id, rfc_message_id)
  where rfc_message_id is not null;

-- ---------------------------------------------------------------------------
-- 3. email_delivery_events — append-only provider receipts (mirrors
--    whatsapp_delivery_events, 0010). Ids + provider-event facts only; NO
--    candidate PII, so it stays outside the 0033 erasure surface (job/event
--    tables carry ids, not people). Correlated by the outbound RFC Message-ID.
-- ---------------------------------------------------------------------------
create table if not exists public.email_delivery_events (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  outbound_message_id   uuid not null references public.messages_outbound(id) on delete cascade,
  delivery_attempt_id   uuid not null,
  rfc_message_id        text not null check (rfc_message_id ~ '^<[^<>@\s]+@[^<>@\s]+>$'),
  event_status          text not null check (event_status in ('delivered', 'bounced', 'complained', 'opened')),
  is_permanent          boolean not null default false,
  provider_occurred_at  timestamptz not null,
  received_at           timestamptz not null default now(),
  provider_error        jsonb not null default '{}'::jsonb,
  constraint email_delivery_events_dedupe_uniq
    unique (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at)
);
-- Converge existing databases (the original key omitted is_permanent, so a
-- soft->permanent bounce correction at the same timestamp was mis-read as a
-- replay and did not suppress — Codex). Drop any prior unique key on the old
-- column set, then ensure the is_permanent-bearing key exists. Idempotent.
do $email_delivery_events_dedupe$
declare
  old_name text;
  -- Column sets compared by exact NAME (alphabetically ordered), so this only
  -- ever matches the intended keys and never an unrelated unique constraint.
  legacy_cols constant text[] := array['event_status', 'provider_occurred_at', 'rfc_message_id', 'workspace_id'];
  target_cols constant text[] := array['event_status', 'is_permanent', 'provider_occurred_at', 'rfc_message_id', 'workspace_id'];
begin
  -- Drop ONLY a unique constraint whose columns are EXACTLY the legacy dedup
  -- set (no is_permanent). Never the replacement, never anything unrelated.
  for old_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.email_delivery_events'::regclass
       and c.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
          where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       ) = legacy_cols
  loop
    execute format('alter table public.email_delivery_events drop constraint %I', old_name);
  end loop;
  -- Add the is_permanent-bearing key only if no unique constraint with EXACTLY
  -- those five columns already exists (verified by columns, not just by name).
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.email_delivery_events'::regclass
       and c.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
          where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
       ) = target_cols
  ) then
    alter table public.email_delivery_events
      add constraint email_delivery_events_dedupe_uniq
      unique (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at);
  end if;
end
$email_delivery_events_dedupe$;

create index if not exists email_delivery_events_outbound_idx
  on public.email_delivery_events (workspace_id, outbound_message_id, provider_occurred_at desc);

alter table public.email_delivery_events enable row level security;
alter table public.email_delivery_events force row level security;

revoke all on public.email_delivery_events from anon, public, authenticated, service_role, authenticator;
grant select on public.email_delivery_events to authenticated;

drop policy if exists email_delivery_events_select on public.email_delivery_events;
create policy email_delivery_events_select on public.email_delivery_events
  for select using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 3b. email_ledger_delivery_receipts — dedup spine for delivery events that
--     correlate to a SYNCHRONOUS send (an outreach_ledger row, no
--     messages_outbound). email_delivery_events requires an outbound row so it
--     cannot host these; without a receipt the ledger fallback could not tell a
--     fresh bounce from a replay and would re-mutate a suppression an admin had
--     expired or deleted (Codex). Keyed INCLUDING is_permanent so a soft->
--     permanent bounce correction is a distinct event. postgres-only.
-- ---------------------------------------------------------------------------
create table if not exists public.email_ledger_delivery_receipts (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  rfc_message_id        text not null check (rfc_message_id ~ '^<[^<>@\s]+@[^<>@\s]+>$'),
  event_status          text not null check (event_status in ('delivered', 'bounced', 'complained', 'opened')),
  is_permanent          boolean not null default false,
  provider_occurred_at  timestamptz not null,
  received_at           timestamptz not null default now(),
  unique (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at)
);
alter table public.email_ledger_delivery_receipts enable row level security;
alter table public.email_ledger_delivery_receipts force row level security;
revoke all on public.email_ledger_delivery_receipts from anon, public, authenticated, service_role, authenticator;
drop policy if exists email_ledger_delivery_receipts_owner on public.email_ledger_delivery_receipts;
create policy email_ledger_delivery_receipts_owner on public.email_ledger_delivery_receipts
  for all to postgres, supabase_admin using (true) with check (true);

-- Bounded cleanup for the dedup spine (Codex: receipts grow unbounded). Safe to
-- schedule from the loop worker. Retention is floored at 90 days so it can never
-- delete a receipt inside any realistic provider replay window — deleting a
-- receipt early would reopen the replay it exists to prevent.
create or replace function public.cleanup_email_ledger_delivery_receipts(p_retention_days integer default 180)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  deleted integer;
  retention integer := greatest(coalesce(p_retention_days, 180), 90);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  delete from public.email_ledger_delivery_receipts
   where received_at < now() - make_interval(days => retention);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;
alter function public.cleanup_email_ledger_delivery_receipts(integer) owner to postgres;
revoke all on function public.cleanup_email_ledger_delivery_receipts(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.cleanup_email_ledger_delivery_receipts(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. enqueue_email_outbound — authenticated SECURITY DEFINER. Places an approved
--    email draft into the durable outbox as a queued row. Mirrors the WhatsApp
--    enqueue contract used by /api/outreach/send: returns {ok, status, id,
--    reason}; a re-enqueue of the same draft returns reason 'duplicate' with the
--    existing row rather than a second wire-eligible row. The row is NOT
--    dispatchable until the pre-dispatch trigger below re-verifies the approval.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_email_outbound(
  p_message_id  text,
  p_candidate_id text,
  p_campaign_id text,
  p_seat_id     uuid,
  p_recipient   text,
  p_subject     text,
  p_body        text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  wid uuid := public.current_workspace_id();
  role_name text := public.current_profile_role();
  recipient text := lower(btrim(coalesce(p_recipient, '')));
  dedupe text;
  new_id uuid;
  existing public.messages_outbound%rowtype;
begin
  if auth.uid() is null or wid is null then
    return json_build_object('ok', false, 'reason', 'not-authenticated');
  end if;
  if role_name not in ('admin', 'member') then
    return json_build_object('ok', false, 'reason', 'insufficient-permissions');
  end if;
  if p_message_id is null or length(p_message_id) < 1 or length(p_message_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-message-id');
  end if;
  if p_candidate_id is null or length(p_candidate_id) < 1 or length(p_candidate_id) > 120 then
    return json_build_object('ok', false, 'reason', 'invalid-candidate');
  end if;
  if recipient = '' or recipient !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'reason', 'invalid-recipient');
  end if;
  if p_body is null or length(btrim(p_body)) < 1 then
    return json_build_object('ok', false, 'reason', 'empty-body');
  end if;

  -- Deterministic per-draft de-dupe key: the same approved draft to the same
  -- recipient can never mint two wire-eligible rows, even across retries.
  dedupe := encode(
    digest('email' || E'\n' || p_candidate_id || E'\n' || recipient || E'\n' || p_message_id, 'sha256'),
    'hex'
  );

  begin
    insert into public.messages_outbound(
      workspace_id, candidate_id, seat_id, channel, to_address, type, subject, body,
      status, dedupe_hash, scheduled_at, approval_message_id, campaign_id
    ) values (
      wid, p_candidate_id, p_seat_id, 'Email', recipient, 'candidate_reply',
      coalesce(p_subject, ''), p_body,
      'queued', dedupe, now(), p_message_id, p_campaign_id
    ) returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_outbound
      where workspace_id = wid and dedupe_hash = dedupe;
    return json_build_object(
      'ok', false,
      'status', coalesce(existing.status, 'queued'),
      'id', existing.id,
      'reason', 'duplicate'
    );
  end;

  return json_build_object('ok', true, 'status', 'queued', 'id', new_id);
end;
$$;

revoke all on function public.enqueue_email_outbound(text, text, text, uuid, text, text, text) from public, anon, authenticator, service_role;
grant execute on function public.enqueue_email_outbound(text, text, text, uuid, text, text, text) to authenticated;
-- The route sanitizes the subject (src/lib/outreach-content.ts sanitizeOutreachSubject)
-- BEFORE approval and enqueue, so the stored subject is byte-identical to what the
-- operator approved and the approval body_hash still matches at claim time.

-- ---------------------------------------------------------------------------
-- 5. claim_email_outbound_queued — service-only atomic claim. The email analog
--    of claim_whatsapp_outbound (0024): locks the outbox row first, then the
--    advisory key, then the approval row; re-verifies the human approval (body +
--    scope hash, source, not revoked), suppression, a LIVE domain-verified email
--    seat, the 90-day re-contact window, and the per-seat warmup cap; inserts the
--    ledger claim carrying a freshly minted RFC Message-ID; and transitions the
--    outbox row queued -> dispatching under a delivery_attempt_id. A second
--    worker or a retry cannot make a second provider send for the same row.
-- ---------------------------------------------------------------------------
create or replace function public.claim_email_outbound_queued(p_message_id uuid)
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
    or approval.approval_scope_hash is distinct from encode(digest(outbound.candidate_id || E'\n' || outbound.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
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

revoke all on function public.claim_email_outbound_queued(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.claim_email_outbound_queued(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. record_email_send_message_id — service-only. The email analog of
--    record_whatsapp_provider_acceptance (0010). Persists provider acceptance
--    atomically: outbox dispatching -> sent (stamping provider_message_id with the
--    RFC Message-ID), ledger claimed -> sent. If this fails after the provider
--    accepted the message, the row deliberately stays dispatching — a worker must
--    never retry an ambiguous external send.
-- ---------------------------------------------------------------------------
create or replace function public.record_email_send_message_id(
  p_message_id uuid,
  p_delivery_attempt_id uuid,
  p_rfc_message_id text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound public.messages_outbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_rfc_message_id is null or p_rfc_message_id !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    return json_build_object('allowed', false, 'reason', 'invalid-rfc-message-id');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;
  if outbound.status = 'sent' and outbound.provider_message_id = p_rfc_message_id then
    return json_build_object('allowed', true, 'reason', 'already-recorded');
  end if;
  if outbound.status <> 'dispatching' then return json_build_object('allowed', false, 'reason', 'not-dispatching'); end if;

  update public.messages_outbound
    set status = 'sent',
        sent_at = now(),
        provider_message_id = p_rfc_message_id
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;
  if not found then raise exception 'outbox ownership changed during email send finalization'; end if;

  update public.outreach_ledger
    set status = 'sent',
        reason = null,
        rfc_message_id = p_rfc_message_id
    where workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
      and status = 'claimed';

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.record_email_send_message_id(uuid, uuid, text) from public, anon, authenticated, authenticator;
grant execute on function public.record_email_send_message_id(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. finalize_email_provider_failure — service-only terminal transition for an
--    email attempt the provider DEFINITIVELY rejected (pre-transport). Mirrors
--    finalize_whatsapp_provider_failure (0017): dispatching -> failed, ledger
--    claimed -> skipped (retryable). Unknown/ambiguous outcomes are NEVER passed
--    here; they stay dispatching for human reconciliation via send_attempt_id.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_email_provider_failure(
  p_message_id uuid,
  p_delivery_attempt_id uuid,
  p_reason text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound public.messages_outbound%rowtype;
  ledger public.outreach_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('allowed', false, 'reason', 'service-only');
  end if;
  if p_delivery_attempt_id is null then
    return json_build_object('allowed', false, 'reason', 'invalid-delivery-attempt');
  end if;
  if p_reason is null or length(btrim(p_reason)) < 1 or length(p_reason) > 512 then
    return json_build_object('allowed', false, 'reason', 'invalid-reason');
  end if;

  select * into outbound
    from public.messages_outbound
    where id = p_message_id
    for update;
  if not found then return json_build_object('allowed', false, 'reason', 'message-not-found'); end if;
  if outbound.channel <> 'Email' then return json_build_object('allowed', false, 'reason', 'wrong-channel'); end if;
  if outbound.delivery_attempt_id is distinct from p_delivery_attempt_id then
    return json_build_object('allowed', false, 'reason', 'attempt-mismatch');
  end if;
  if outbound.status <> 'dispatching' then
    return json_build_object('allowed', false, 'reason', 'not-dispatching');
  end if;

  select * into ledger
    from public.outreach_ledger
    where workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
    for update;
  if not found or ledger.status <> 'claimed' then
    return json_build_object('allowed', false, 'reason', 'ledger-not-claimed');
  end if;

  update public.messages_outbound
    set status = 'failed'
    where id = outbound.id
      and status = 'dispatching'
      and delivery_attempt_id = p_delivery_attempt_id;
  if not found then raise exception 'outbox ownership changed during email failure finalization'; end if;

  update public.outreach_ledger
    set status = 'skipped',
        reason = p_reason
    where id = ledger.id
      and workspace_id = outbound.workspace_id
      and outbound_message_id = outbound.id
      and status = 'claimed';
  if not found then raise exception 'ledger ownership changed during email failure finalization'; end if;

  return json_build_object('allowed', true, 'reason', 'recorded');
end;
$$;

revoke all on function public.finalize_email_provider_failure(uuid, uuid, text) from public, anon, authenticated, authenticator;
grant execute on function public.finalize_email_provider_failure(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. record_email_delivery_event — service-only, append-only. Mirrors
--    record_whatsapp_delivery_event (0010): resolves the outbound row by the RFC
--    Message-ID we stamped at send, records a signed provider receipt idempotently
--    (unknown/stale ids are a no-op, never a fabricated cross-workspace event). A
--    PERMANENT bounce or a spam complaint upserts the workspace suppression list
--    so the address is never contacted again. Soft bounces / opens / deliveries
--    record history only. (Sequence-stop on bounce is a Rock 6 concern:
--    outreach_sequences does not exist yet, so there is deliberately nothing to
--    stop here.)
-- ---------------------------------------------------------------------------
create or replace function public.record_email_delivery_event(
  p_workspace_id uuid,
  p_rfc_message_id text,
  p_event_status text,
  p_provider_occurred_at timestamptz,
  p_provider_error_code integer default null,
  p_permanent boolean default false
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  outbound public.messages_outbound%rowtype;
  recipient text;
  suppress boolean;
  event_is_new integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('recorded', false, 'reason', 'service-only');
  end if;
  if p_event_status not in ('delivered', 'bounced', 'complained', 'opened') then
    return json_build_object('recorded', false, 'reason', 'invalid-status');
  end if;
  if p_rfc_message_id is null or p_rfc_message_id !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    return json_build_object('recorded', false, 'reason', 'invalid-rfc-message-id');
  end if;
  if p_provider_occurred_at is null then
    return json_build_object('recorded', false, 'reason', 'invalid-event-time');
  end if;

  select * into outbound
    from public.messages_outbound
    where workspace_id = p_workspace_id
      and provider_message_id = p_rfc_message_id
      and channel = 'Email'
    for share;
  if not found then
    -- Synchronous-send path: the interactive /api/outreach/send never creates a
    -- messages_outbound row — it sends off outreach_ledger and stamps the RFC
    -- Message-ID there. A bounce/complaint for such a send MUST still suppress
    -- the address (CAN-SPAM / deliverability), so fall back to the ledger.
    select lower(btrim(coalesce(l.candidate_email, ''))) into recipient
      from public.outreach_ledger l
      where l.workspace_id = p_workspace_id
        and l.rfc_message_id = p_rfc_message_id
      for share;
    if recipient is null then
      return json_build_object('recorded', false, 'reason', 'outbound-not-found');
    end if;
    -- Durable receipt makes this branch replay-idempotent: a re-delivered event
    -- inserts nothing and does not touch the suppression (Codex).
    insert into public.email_ledger_delivery_receipts(
      workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at
    ) values (
      p_workspace_id, p_rfc_message_id, p_event_status, coalesce(p_permanent, false), p_provider_occurred_at
    ) on conflict (workspace_id, rfc_message_id, event_status, is_permanent, provider_occurred_at) do nothing;
    get diagnostics event_is_new = row_count;

    suppress := (p_event_status = 'bounced' and coalesce(p_permanent, false)) or p_event_status = 'complained';
    if suppress and event_is_new = 1 and recipient <> '' then
      insert into public.suppression_list(workspace_id, type, value, reason, source)
        values (
          p_workspace_id, 'email', recipient,
          case when p_event_status = 'complained' then 'spam-complaint' else 'hard-bounce' end,
          'system'
        )
      on conflict (workspace_id, type, value)
        do update set expires_at = null,
                      reason = excluded.reason,
                      source = excluded.source;
    end if;
    return json_build_object('recorded', true, 'reason', 'ledger-correlated', 'suppressed', suppress and event_is_new = 1);
  end if;
  if outbound.delivery_attempt_id is null then
    return json_build_object('recorded', false, 'reason', 'attempt-not-found');
  end if;

  insert into public.email_delivery_events(
    workspace_id,
    outbound_message_id,
    delivery_attempt_id,
    rfc_message_id,
    event_status,
    is_permanent,
    provider_occurred_at,
    provider_error
  ) values (
    outbound.workspace_id,
    outbound.id,
    outbound.delivery_attempt_id,
    p_rfc_message_id,
    p_event_status,
    coalesce(p_permanent, false),
    p_provider_occurred_at,
    case
      when p_provider_error_code is null then '{}'::jsonb
      else jsonb_build_object('code', p_provider_error_code)
    end
  ) on conflict on constraint email_delivery_events_dedupe_uniq do nothing;
  get diagnostics event_is_new = row_count;

  -- Permanent bounce or spam complaint -> never contact this address again.
  -- Only act on a genuinely NEW event (Codex P1): a replayed event inserts no
  -- delivery row and must not mutate a suppression an admin later expired.
  suppress := (p_event_status = 'bounced' and coalesce(p_permanent, false)) or p_event_status = 'complained';
  if suppress and event_is_new = 1 then
    recipient := lower(btrim(coalesce(outbound.to_address, '')));
    if recipient <> '' then
      insert into public.suppression_list(workspace_id, type, value, reason, source)
        values (
          outbound.workspace_id,
          'email',
          recipient,
          case when p_event_status = 'complained' then 'spam-complaint' else 'hard-bounce' end,
          'system'
        )
      on conflict (workspace_id, type, value)
        do update set expires_at = null,
                      reason = excluded.reason,
                      source = excluded.source;
    end if;
  end if;

  return json_build_object('recorded', true, 'reason', 'recorded', 'suppressed', suppress and event_is_new = 1);
end;
$$;

revoke all on function public.record_email_delivery_event(uuid, text, text, timestamptz, integer, boolean) from public, anon, authenticated, authenticator;
grant execute on function public.record_email_delivery_event(uuid, text, text, timestamptz, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 9. enforce_active_email_approval — the pre-dispatch trigger that makes the
--    never-auto-send guarantee mechanical for Email, exactly as
--    enforce_active_whatsapp_approval (0013) does for WhatsApp. It fires ONLY on
--    a queued -> dispatching status update of an Email row and RAISES P0001 unless
--    a locked, matching, unrevoked human approval exists. A separate trigger from
--    the WhatsApp one, guarded by channel, so neither can affect the other.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_active_email_approval()
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
    or approval.approval_scope_hash is distinct from encode(digest(new.candidate_id || E'\n' || new.channel || E'\n' || recipient, 'sha256'), 'hex')
    or approval.approval_source <> 'human'
    or approval.revoked_at is not null
  then
    raise exception 'active human approval required for Email dispatch' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_outbound_active_email_approval on public.messages_outbound;
create trigger messages_outbound_active_email_approval
  before update of status on public.messages_outbound
  for each row execute function public.enforce_active_email_approval();
