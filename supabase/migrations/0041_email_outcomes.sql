-- 0041_email_outcomes.sql
--
-- Rock 3 completion: candidate outcome events. When an inbound reply correlates
-- to a send (0040), record an append-only, idempotent outcome the query-ranking
-- feedback loop (0027) later reads — reply_received now, richer kinds as the
-- loop grows. Erasure-enrolled the PROVEN candidate-derived way (0035/0037): a
-- cleanup trigger on candidate_erasure_requests deletes a candidate's outcomes,
-- and record_candidate_outcome skips a tombstoned candidate (defense-in-depth
-- against a resurrection). candidate_outcome_events carries candidate_id + kind
-- + ids only — no free-text PII — so the DELETE-on-erasure covers it fully; no
-- 0033 store-scrub enum extension is needed (relational, not a blob store).
--
-- ⚠️ The bespoke erasure integration below mirrors the proven 0035
-- cleanup_erased_candidate_mirror / 0037 tombstone-skip patterns byte-faithfully,
-- but the disposable-Postgres erasure suite (bash tests/candidate-erasure-db.sh +
-- tests/email-outcomes-db.sh) that PROVES the trigger ordering and the
-- no-re-materialization property could NOT be run in the build sandbox (Docker
-- denied). This migration is OWNER-PROOF-PENDING on that suite and on Codex.
--
-- Idempotent; safe to re-run. Run AFTER 0040_email_inbound_correlation.sql.

-- ---------------------------------------------------------------------------
-- 1. candidate_outcome_events — append-only outcomes (grant model = append-only:
--    clients read only; writes via the service-role RPC; deletes only via the
--    erasure cleanup trigger running as owner).
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_outcome_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  candidate_id    text not null check (candidate_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  kind            text not null check (kind in (
                    'reply_received', 'interested', 'not_interested', 'ooo', 'booked',
                    'bounced', 'unsubscribed', 'manual_stage_change', 'sequence_exhausted')),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  source_inbound_id uuid references public.messages_inbound(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index if not exists candidate_outcome_events_candidate_idx
  on public.candidate_outcome_events (workspace_id, candidate_id, created_at desc);

alter table public.candidate_outcome_events enable row level security;
alter table public.candidate_outcome_events force row level security;

revoke all on public.candidate_outcome_events
  from public, anon, authenticated, service_role, authenticator;
grant select on public.candidate_outcome_events to authenticated;

drop policy if exists candidate_outcome_events_owner_access on public.candidate_outcome_events;
create policy candidate_outcome_events_owner_access on public.candidate_outcome_events
  for all to postgres, supabase_admin using (true) with check (true);

drop policy if exists candidate_outcome_events_member_read on public.candidate_outcome_events;
create policy candidate_outcome_events_member_read on public.candidate_outcome_events
  for select to authenticated using (workspace_id = public.current_workspace_id());

-- ---------------------------------------------------------------------------
-- 2. record_candidate_outcome — service-only, idempotent, tombstone-skipping.
--    A tombstoned (erased) candidate can NEVER receive a fresh outcome row — the
--    HMAC guard mirrors 0037: compute the identifier HMAC only when candidate_id
--    tombstones actually exist for the workspace (the helper RAISES without a
--    workspace sourcing secret, and Postgres would hoist that STABLE call out of
--    the predicate otherwise).
-- ---------------------------------------------------------------------------
create or replace function public.record_candidate_outcome(
  p_workspace_id uuid,
  p_candidate_id text,
  p_kind text,
  p_idempotency_key text,
  p_source_inbound_id uuid default null
) returns json
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  new_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return json_build_object('ok', false, 'reason', 'service-only');
  end if;
  if p_candidate_id is null or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    return json_build_object('ok', false, 'reason', 'invalid-candidate');
  end if;
  if p_kind is null or p_kind not in (
      'reply_received', 'interested', 'not_interested', 'ooo', 'booked',
      'bounced', 'unsubscribed', 'manual_stage_change', 'sequence_exhausted') then
    return json_build_object('ok', false, 'reason', 'invalid-kind');
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) < 1 or char_length(p_idempotency_key) > 200 then
    return json_build_object('ok', false, 'reason', 'invalid-idempotency-key');
  end if;

  -- Tombstone-skip: refuse to record an outcome for an erased candidate.
  if exists (
    select 1 from public.candidate_erasure_suppression_tombstones t
     where t.workspace_id = p_workspace_id and t.identifier_kind = 'candidate_id'
  ) then
    if exists (
      select 1 from public.candidate_erasure_suppression_tombstones tombstone
       where tombstone.workspace_id = p_workspace_id
         and tombstone.identifier_kind = 'candidate_id'
         and tombstone.identifier_hmac = public.candidate_erasure_identifier_hmac(
           p_workspace_id, 'candidate_id', p_candidate_id)
    ) then
      return json_build_object('ok', false, 'reason', 'candidate-erased');
    end if;
  end if;

  begin
    insert into public.candidate_outcome_events(workspace_id, candidate_id, kind, idempotency_key, source_inbound_id)
      values (p_workspace_id, p_candidate_id, p_kind, btrim(p_idempotency_key), p_source_inbound_id)
      returning id into new_id;
  exception when unique_violation then
    return json_build_object('ok', true, 'duplicate', true);
  end;

  return json_build_object('ok', true, 'duplicate', false, 'outcome_id', new_id);
end;
$$;

revoke all on function public.record_candidate_outcome(uuid, text, text, text, uuid)
  from public, anon, authenticated, authenticator;
grant execute on function public.record_candidate_outcome(uuid, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Erasure cleanup: delete a candidate's outcomes when their erasure request
--    lands (mirrors 0035 cleanup_erased_candidate_mirror). Legal-hold-blocked
--    requests are skipped, exactly like the corpus mirror cleanup.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_erased_candidate_outcomes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.candidate_outcome_events
   where workspace_id = new.workspace_id
     and candidate_id = new.candidate_id;
  return null;
end;
$$;

revoke all on function public.cleanup_erased_candidate_outcomes()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_erasure_requests_outcomes_cleanup on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_outcomes_cleanup
  after insert or update on public.candidate_erasure_requests
  for each row
  when (new.status <> 'blocked_legal_hold')
  execute function public.cleanup_erased_candidate_outcomes();

-- ---------------------------------------------------------------------------
-- 4. Wire correlate_inbound_email to record the reply_received outcome on a
--    successful single-match correlation. Redefines the 0040 function additively
--    (same signature + behaviour; adds one idempotent outcome write inside the
--    already-correlated branch). Idempotency key = 'reply:' || inbound id, so a
--    reprocessed reply never double-counts.
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

  if needle = '' or needle !~ '^<[^<>@\s]+@[^<>@\s]+>$' then
    update public.messages_inbound set last_processing_error = 'no-in-reply-to' where id = inbound.id;
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
    return json_build_object('ok', true, 'correlated', false, 'reason', 'race-lost');
  end if;

  -- Append-only reply outcome for the query-ranking feedback loop (idempotent).
  perform public.record_candidate_outcome(
    inbound.workspace_id, ledger.candidate_id, 'reply_received', 'reply:' || inbound.id::text, inbound.id);

  return json_build_object(
    'ok', true,
    'correlated', true,
    'candidate_id', ledger.candidate_id,
    'ledger_id', ledger.id,
    'outbound_message_id', ledger.outbound_message_id,
    'outcome_recorded', true
  );
end;
$$;

alter function public.record_candidate_outcome(uuid, text, text, text, uuid) owner to postgres;
alter function public.cleanup_erased_candidate_outcomes() owner to postgres;
alter function public.correlate_inbound_email(uuid, text) owner to postgres;
