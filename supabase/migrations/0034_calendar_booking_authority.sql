-- 0034_calendar_booking_authority.sql
--
-- Calendar booking authority (closes a NO-GO finding).
--
-- /api/calendar/event created a LIVE Google/Microsoft calendar event with no
-- durable, auditable authority record and no claim-before-effect — unlike
-- every other live mutation in this app (outreach: claim_and_record / 0021;
-- Apollo enrichment: 0026; owner recovery: 0031). A double-click, a client
-- retry, or a crash between "created" and the response could silently create
-- a second interview event for the same candidate and time, with no row
-- anywhere recording that the first attempt ever happened.
--
-- This migration adds an append-authority ledger, fully locked down (RLS
-- enabled + forced, all direct grants revoked — mirrors 0026/0031, not the
-- older 0002/0005 outreach_ledger column-grant pattern): every read and write
-- goes through a SECURITY DEFINER RPC owned by the table owner.
--
--   * claim_calendar_booking  — claim-before-effect. Uses the FOR UPDATE /
--     ON CONFLICT (unique_violation) pattern from claim_and_record (0021):
--     an idempotency lock-and-return on (workspace_id, request_id) runs
--     first, then a plain insert relies on two partial/unique indexes to
--     fail closed atomically — no pre-check, no TOCTOU window.
--   * reconcile_calendar_booking — reconcile-after-effect. One-shot: it only
--     transitions a row that is still 'claimed', so a delayed duplicate
--     reconciliation call can never flip a terminal outcome.
--
-- Idempotency key = (workspace_id, candidate_id, start_time) — the double-
-- book guard, enforced by a partial unique index over the two ACTIVE
-- statuses ('claimed', 'confirmed'). A second key, (workspace_id,
-- request_id), gives the CLIENT a safe retry: the same request_id always
-- resolves to the same row, never a second attempt.
--
-- The status enum deliberately has no 'ambiguous' state. 'claimed' already
-- IS the active, retry-blocking state (it participates in the double-book
-- partial index), so an unknown post-transport provider outcome is handled
-- by the caller simply never calling reconcile — the row stays 'claimed'
-- and keeps holding the slot until a human resolves it, mirroring the
-- outreach route's fail-closed 'ambiguous' handling (0022) without adding a
-- redundant status value.

create table if not exists public.calendar_booking_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id text not null check (char_length(candidate_id) between 1 and 200),
  start_time timestamptz not null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  provider text not null check (provider in ('Gmail API', 'Microsoft Graph')),
  status text not null default 'claimed'
    check (status in ('claimed', 'confirmed', 'failed', 'released')),
  external_event_id text
    check (external_event_id is null or char_length(external_event_id) between 1 and 512),
  detail text check (detail is null or char_length(detail) <= 1000),
  processing_lease_until timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_booking_ledger_workspace_request_uniq unique (workspace_id, request_id)
);

-- The double-book guard: at most one ACTIVE (claimed or confirmed) booking
-- per candidate per exact start_time, per workspace.
create unique index if not exists calendar_booking_ledger_active_slot_uniq
  on public.calendar_booking_ledger (workspace_id, candidate_id, start_time)
  where status in ('claimed', 'confirmed');

create index if not exists calendar_booking_ledger_workspace_candidate_idx
  on public.calendar_booking_ledger (workspace_id, candidate_id, start_time desc);

-- ---- RLS: fully locked down. No role — not even service_role — receives a
-- direct table grant. All access is mediated by the two SECURITY DEFINER
-- RPCs below (mirrors 0026 apollo_enrichment_* / 0031 owner_recovery_receipts).
alter table public.calendar_booking_ledger enable row level security;
alter table public.calendar_booking_ledger force row level security;
revoke all on public.calendar_booking_ledger
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists calendar_booking_ledger_postgres_all on public.calendar_booking_ledger;
create policy calendar_booking_ledger_postgres_all
  on public.calendar_booking_ledger
  for all to postgres using (true) with check (true);

create or replace function public.claim_calendar_booking(
  p_workspace_id uuid,
  p_candidate_id text,
  p_start_time timestamptz,
  p_request_id text,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  existing_row public.calendar_booking_ledger%rowtype;
  new_row public.calendar_booking_ledger%rowtype;
  violated_constraint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_candidate_id is null
     or char_length(p_candidate_id) not between 1 and 200
     or p_start_time is null
     or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9._:-]{1,100}$'
     or p_provider is null
     or p_provider not in ('Gmail API', 'Microsoft Graph') then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Idempotent retry check FIRST, and lock the row if it exists. The
  -- (workspace_id, request_id) unique constraint permanently binds one
  -- request_id to one row, so a genuine retry must always return that row
  -- rather than ever attempting a second insert. A request_id reused for a
  -- DIFFERENT candidate/start_time/provider is not a valid retry — it is
  -- rejected rather than silently returned as if it matched (mirrors
  -- claim_apollo_enrichment's idempotency_conflict, 0026).
  select * into existing_row
    from public.calendar_booking_ledger
   where workspace_id = p_workspace_id and request_id = p_request_id
   for update;
  if found then
    if existing_row.candidate_id <> p_candidate_id
       or existing_row.start_time <> p_start_time
       or existing_row.provider <> p_provider then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'claimed',
      'id', existing_row.id,
      'booking_status', existing_row.status,
      'external_event_id', existing_row.external_event_id,
      'replay', true
    );
  end if;

  begin
    insert into public.calendar_booking_ledger (
      workspace_id, candidate_id, start_time, request_id, provider, status
    ) values (
      p_workspace_id, p_candidate_id, p_start_time, p_request_id, p_provider, 'claimed'
    )
    returning * into new_row;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = constraint_name;
    if violated_constraint = 'calendar_booking_ledger_workspace_request_uniq' then
      -- A concurrent identical retry committed first. Return its row instead
      -- of racing a second insert under the same request_id — unless the
      -- concurrent winner was for a different candidate/start_time/provider,
      -- which is an idempotency conflict, not a valid replay.
      select * into existing_row
        from public.calendar_booking_ledger
       where workspace_id = p_workspace_id and request_id = p_request_id
       for update;
      if existing_row.candidate_id <> p_candidate_id
         or existing_row.start_time <> p_start_time
         or existing_row.provider <> p_provider then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object(
        'status', 'claimed',
        'id', existing_row.id,
        'booking_status', existing_row.status,
        'external_event_id', existing_row.external_event_id,
        'replay', true
      );
    end if;
    -- Any other unique violation is the active-slot guard firing: another
    -- claimed or confirmed booking already holds this exact candidate +
    -- start_time. Fail closed — no row is created, the caller must never
    -- call the provider.
    return jsonb_build_object('status', 'double_booked');
  end;

  return jsonb_build_object(
    'status', 'claimed',
    'id', new_row.id,
    'booking_status', new_row.status,
    'external_event_id', new_row.external_event_id,
    'replay', false
  );
end;
$$;

revoke all on function public.claim_calendar_booking(uuid, text, timestamptz, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.claim_calendar_booking(uuid, text, timestamptz, text, text)
  to service_role;

create or replace function public.reconcile_calendar_booking(
  p_workspace_id uuid,
  p_id uuid,
  p_status text,
  p_external_event_id text,
  p_detail text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  updated_row public.calendar_booking_ledger%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null
     or p_id is null
     or p_status not in ('confirmed', 'failed', 'released')
     or (p_external_event_id is not null and char_length(p_external_event_id) > 512)
     or (p_detail is not null and char_length(p_detail) > 1000) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- One-shot terminal transition: only a row still 'claimed' may be
  -- reconciled. A delayed duplicate reconciliation call (e.g. two racing
  -- responses for the same attempt) can therefore never flip an
  -- already-confirmed booking to failed, or vice versa.
  update public.calendar_booking_ledger
     set status = p_status,
         external_event_id = coalesce(p_external_event_id, external_event_id),
         detail = p_detail,
         updated_at = now()
   where id = p_id
     and workspace_id = p_workspace_id
     and status = 'claimed'
  returning * into updated_row;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'reconciled',
    'id', updated_row.id,
    'booking_status', updated_row.status
  );
end;
$$;

revoke all on function public.reconcile_calendar_booking(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reconcile_calendar_booking(uuid, uuid, text, text, text)
  to service_role;
