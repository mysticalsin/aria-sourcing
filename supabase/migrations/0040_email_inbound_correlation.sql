-- 0040_email_inbound_correlation.sql
--
-- Rock 3 (core) of the industrial autonomous sourcing loop: an inbound email
-- REPLY lands durably and threads back to the exact send that produced it —
-- with zero browser open. This is the read-side complement of Rock 2 (0039),
-- which stamped every outbound send with an RFC Message-ID on
-- outreach_ledger.rfc_message_id. A reply's In-Reply-To / References header
-- points at that Message-ID; here the worker resolves it back to the ledger row
-- and its candidate, deterministically and idempotently.
--
-- Scope note (honest): this migration is the CORRELATION core only —
--   * inbound_mailbox_routes  : mailbox -> workspace routing (ensure_workspace
--     keys off a human's email domain, which is useless for a machine mailbox;
--     this closes that gap),
--   * record_inbound_email    : idempotent insert into the EXISTING messages_inbound
--     (channel 'Email' already allowed 0007; already covered by the 0033 erasure
--     store enum, so inbound email rides existing GDPR coverage — NO new erasure
--     surface here),
--   * correlate_inbound_email : In-Reply-To <-> outreach_ledger.rfc_message_id;
--     exactly-one match correlates, zero/many FAIL CLOSED to operator triage
--     (mirroring the WhatsApp resolve_whatsapp_inbound_conversation posture).
--
-- DELIBERATELY DEFERRED to a Codex-reviewed, erasure-suite-runnable session:
--   candidate_outcome_events + its bespoke 0033 erasure trio (store_name enum
--   extension + scrub + cleanup trigger + reimport-before guard + trigger-ordering
--   proof). Extending the 0033 GDPR-erasure authority is the single highest-risk
--   change in this engagement (a prior round caught a P0 erased-PII
--   re-materialization there); the plan's own risk register requires re-running
--   the full erasure suite for every new enrolled table, which cannot be done in
--   the current build sandbox (Docker denied). record_candidate_outcome and the
--   outcome table land next, not blind.
--
-- Idempotent; safe to re-run. Run AFTER 0039_email_channel_durability.sql.

-- ---------------------------------------------------------------------------
-- 1. inbound_mailbox_routes — which workspace (and optional email connection)
--    owns an inbound mailbox address. Operator/routing config (not candidate
--    PII), so no candidate-erasure enrollment (same posture as email_connections).
-- ---------------------------------------------------------------------------
create table if not exists public.inbound_mailbox_routes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  mailbox_address text not null check (char_length(mailbox_address) between 3 and 320
                    and mailbox_address = lower(mailbox_address)),
  connection_id   uuid references public.email_connections(id) on delete set null,
  purpose         text not null default 'reply' check (purpose in ('reply', 'intake')),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  -- A mailbox routes to exactly one workspace (global uniqueness).
  unique (mailbox_address)
);

create index if not exists inbound_mailbox_routes_ws_idx
  on public.inbound_mailbox_routes (workspace_id, purpose) where active;

alter table public.inbound_mailbox_routes enable row level security;
alter table public.inbound_mailbox_routes force row level security;

revoke all on public.inbound_mailbox_routes
  from public, anon, authenticated, service_role, authenticator;
grant select on public.inbound_mailbox_routes to authenticated;

drop policy if exists inbound_mailbox_routes_owner_access on public.inbound_mailbox_routes;
create policy inbound_mailbox_routes_owner_access on public.inbound_mailbox_routes
  for all to postgres, supabase_admin using (true) with check (true);

-- A workspace member may READ their own routes (settings surface); all writes go
-- through the service-role RPCs below (or a direct postgres/supabase_admin session).
drop policy if exists inbound_mailbox_routes_member_read on public.inbound_mailbox_routes;
create policy inbound_mailbox_routes_member_read on public.inbound_mailbox_routes
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- Correlated-reply provenance on the inbound row: the ledger + outbound the reply
-- threaded back to. Additive columns on the existing messages_inbound.
alter table public.messages_inbound
  add column if not exists correlated_ledger_id uuid,
  add column if not exists correlated_outbound_id uuid;

-- ---------------------------------------------------------------------------
-- 2. resolve_inbound_mailbox_route — service-only. A webhook receives a mailbox
--    address (the To/delivered-to of the inbound) and must learn which workspace
--    owns it BEFORE trusting any tenant-scoped data. Unknown -> no-route (the
--    caller fails closed; it never guesses a workspace from the sender).
-- ---------------------------------------------------------------------------
create or replace function public.resolve_inbound_mailbox_route(p_mailbox text)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  route public.inbound_mailbox_routes%rowtype;
  needle text := lower(btrim(coalesce(p_mailbox, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if needle = '' then
    return json_build_object('ok', false, 'reason', 'invalid-mailbox');
  end if;

  select * into route
    from public.inbound_mailbox_routes
    where mailbox_address = needle and active;
  if not found then
    return json_build_object('ok', false, 'reason', 'no-route');
  end if;

  return json_build_object(
    'ok', true,
    'workspace_id', route.workspace_id,
    'connection_id', route.connection_id,
    'purpose', route.purpose
  );
end;
$$;

revoke all on function public.resolve_inbound_mailbox_route(text)
  from public, anon, authenticated, authenticator;
grant execute on function public.resolve_inbound_mailbox_route(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. record_inbound_email — service-only, idempotent. Persists an inbound email
--    into the EXISTING messages_inbound (channel 'Email'). Redelivery of the same
--    provider message id inserts nothing (the 0007 unique (workspace_id, channel,
--    provider_id)). No candidate identity is assigned here — that is the separate,
--    fail-closed correlation step below. messages_inbound is already inside the
--    0033 erasure store enum, so the reply body rides existing GDPR coverage.
-- ---------------------------------------------------------------------------
create or replace function public.record_inbound_email(
  p_workspace_id uuid,
  p_provider_id text,
  p_from_address text,
  p_body text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  new_id uuid;
  existing public.messages_inbound%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_provider_id is null or char_length(btrim(p_provider_id)) < 1 or char_length(p_provider_id) > 512 then
    return json_build_object('ok', false, 'reason', 'invalid-provider-id');
  end if;
  if p_from_address is null or char_length(btrim(p_from_address)) < 3 then
    return json_build_object('ok', false, 'reason', 'invalid-from');
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return json_build_object('ok', false, 'reason', 'unknown-workspace');
  end if;

  begin
    insert into public.messages_inbound(workspace_id, channel, from_address, body, provider_id, processed)
      values (p_workspace_id, 'Email', lower(btrim(p_from_address)), coalesce(p_body, ''), btrim(p_provider_id), false)
      returning id into new_id;
  exception when unique_violation then
    select * into existing
      from public.messages_inbound
      where workspace_id = p_workspace_id and channel = 'Email' and provider_id = btrim(p_provider_id);
    return json_build_object('ok', true, 'inbound_id', existing.id, 'duplicate', true);
  end;

  return json_build_object('ok', true, 'inbound_id', new_id, 'duplicate', false);
end;
$$;

revoke all on function public.record_inbound_email(uuid, text, text, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.record_inbound_email(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. correlate_inbound_email — service-only. Threads a stored inbound reply back
--    to the exact send via In-Reply-To <-> outreach_ledger.rfc_message_id.
--    EXACTLY ONE sent ledger match correlates (stamps the inbound's candidate +
--    ledger + outbound and marks it processed). Zero or many matches FAIL CLOSED
--    to operator triage (processed stays false, the reason is returned and
--    persisted as last_processing_error) — never a guessed identity. Mirrors the
--    WhatsApp resolve_whatsapp_inbound_conversation no/ambiguous-conversation posture.
-- ---------------------------------------------------------------------------
create or replace function public.correlate_inbound_email(
  p_inbound_id uuid,
  p_in_reply_to text
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inbound public.messages_inbound%rowtype;
  needle text := btrim(coalesce(p_in_reply_to, ''));
  match_count int;
  ledger public.outreach_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;

  select * into inbound
    from public.messages_inbound
    where id = p_inbound_id
    for update;
  if not found then return json_build_object('ok', false, 'reason', 'inbound-not-found'); end if;
  if inbound.channel <> 'Email' then return json_build_object('ok', false, 'reason', 'wrong-channel'); end if;
  if inbound.processed then return json_build_object('ok', true, 'correlated', inbound.candidate_id is not null, 'reason', 'already-processed'); end if;

  -- No usable threading header -> fail closed to triage.
  if needle = '' or needle !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    update public.messages_inbound
       set last_processing_error = 'no-in-reply-to'
     where id = inbound.id;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'no-in-reply-to');
  end if;

  select count(*) into match_count
    from public.outreach_ledger l
    where l.workspace_id = inbound.workspace_id
      and l.rfc_message_id = needle
      and l.status in ('sent', 'ambiguous');

  if match_count = 0 then
    update public.messages_inbound set last_processing_error = 'no-match' where id = inbound.id;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'no-match');
  end if;
  if match_count > 1 then
    -- rfc_message_id is unique per workspace, so this is defense-in-depth only.
    update public.messages_inbound set last_processing_error = 'ambiguous' where id = inbound.id;
    return json_build_object('ok', true, 'correlated', false, 'reason', 'ambiguous');
  end if;

  select * into ledger
    from public.outreach_ledger l
    where l.workspace_id = inbound.workspace_id
      and l.rfc_message_id = needle
      and l.status in ('sent', 'ambiguous');

  update public.messages_inbound
     set candidate_id = ledger.candidate_id,
         correlated_ledger_id = ledger.id,
         correlated_outbound_id = ledger.outbound_message_id,
         processed = true,
         last_processing_error = null
   where id = inbound.id
     and processed = false;
  if not found then
    -- Another worker correlated it between our lock and update (shouldn't happen
    -- under the row lock, but stay fail-closed rather than double-report).
    return json_build_object('ok', true, 'correlated', false, 'reason', 'race-lost');
  end if;

  return json_build_object(
    'ok', true,
    'correlated', true,
    'candidate_id', ledger.candidate_id,
    'ledger_id', ledger.id,
    'outbound_message_id', ledger.outbound_message_id
  );
end;
$$;

revoke all on function public.correlate_inbound_email(uuid, text)
  from public, anon, authenticated, authenticator;
grant execute on function public.correlate_inbound_email(uuid, text) to service_role;

alter function public.resolve_inbound_mailbox_route(text) owner to postgres;
alter function public.record_inbound_email(uuid, text, text, text) owner to postgres;
alter function public.correlate_inbound_email(uuid, text) owner to postgres;
