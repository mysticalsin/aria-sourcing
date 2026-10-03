-- 0045_outreach_sequence_authority.sql
--
-- Rock 6: "approve once, the sequence executes" — a multi-touch outreach ladder a
-- named human approves in ONE review session, then the durable worker schedules and
-- sends across days with the browser closed, stopping on reply/opt-out/erasure.
--
-- NEVER-AUTO-SEND, MECHANICALLY (binding decision D4):
--   * Approving the ladder mints one hash+scope-bound approval row PER STEP via the
--     EXISTING record_outreach_approval (0011/0013). This migration adds NO new
--     approval-minting path.
--   * activate_outreach_sequence refuses unless EVERY step has an unrevoked, human,
--     hash+scope-matching approval (re-derived from the STORED bodies).
--   * claim_sequence_step_for_schedule re-verifies the live approval before it lets a
--     step become schedulable, and the existing dispatch path (enforce_active_*_approval
--     + claim_email_outbound_queued/claim_whatsapp_outbound) independently re-verifies
--     again at dispatch. Two layers, both required.
--   * stop_outreach_sequence revokes remaining approvals via revoke_outreach_approval.
--
-- ⚠️⚠️ HARD OWNER GATE (D4): sequences_enabled (0038 sourcing_loop_controls, DEFAULT
-- FALSE) must NOT be turned on anywhere until the Owner signs off on these semantics
-- in a named review. This migration ships the AUTHORITY DARK — no code activates a
-- sequence, and the worker will not schedule steps while sequences_enabled is false.
-- HIGHEST-RISK of the loop; DEGRADED build (Codex Integrator usage-limited until
-- 2026-07-23) NOT runnable here (Docker denied). Codex adversarial review + the
-- negative-proof-first suite (tests/sequences-db.sh) are REQUIRED before enable.
--
-- Idempotent; safe to re-run. Run AFTER 0044_sourcing_enrichment_authority.sql.

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists public.outreach_sequences (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  candidate_id  text not null check (char_length(candidate_id) between 1 and 200),
  campaign_id   text,
  status        text not null default 'drafting' check (status in (
                 'drafting', 'pending_approval', 'active', 'paused_ambiguous', 'completed',
                 'stopped_reply', 'stopped_optout', 'stopped_manual', 'stopped_erasure',
                 'stopped_campaign', 'expired', 'failed_delivery')),
  max_touches   int not null default 1 check (max_touches between 1 and 5),
  approved_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One active-ish sequence per candidate per workspace (a candidate is never in two
-- live ladders at once).
create unique index if not exists outreach_sequences_one_live_idx
  on public.outreach_sequences (workspace_id, candidate_id)
  where status in ('drafting', 'pending_approval', 'active', 'paused_ambiguous');

create table if not exists public.outreach_sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.outreach_sequences(id) on delete cascade,
  ordinal       int not null check (ordinal between 0 and 4),
  gap_days      int not null default 0 check (gap_days between 0 and 30),
  channel       text not null check (channel in ('Email', 'WhatsApp', 'LinkedIn')),
  message_id    text not null check (char_length(message_id) between 1 and 120),
  body          text not null,
  body_hash     text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  scope_hash    text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  status        text not null default 'waiting' check (status in (
                 'waiting', 'due', 'scheduled', 'sent', 'skipped', 'cancelled', 'expired', 'manual_task')),
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  -- The outbound this step handed to the send path, so stop/erasure can
  -- cancel a still-queued send (Codex P1-19). Null until scheduled.
  queued_outbound_id uuid,
  unique (sequence_id, ordinal)
);

create index if not exists outreach_sequence_steps_due_idx
  on public.outreach_sequence_steps (sequence_id, status, ordinal);

alter table public.outreach_sequences enable row level security;
alter table public.outreach_sequences force row level security;
alter table public.outreach_sequence_steps enable row level security;
alter table public.outreach_sequence_steps force row level security;
revoke all on public.outreach_sequences from public, anon, authenticated, service_role, authenticator;
revoke all on public.outreach_sequence_steps from public, anon, authenticated, service_role, authenticator;
-- No direct table reads (Codex P2-22): sequence bodies are outreach content —
-- member visibility ships as a bounded RPC alongside the (pre-enable)
-- scheduling authority.
revoke all on public.outreach_sequences from authenticated;
revoke all on public.outreach_sequence_steps from authenticated;
drop policy if exists outreach_sequences_owner_access on public.outreach_sequences;
create policy outreach_sequences_owner_access on public.outreach_sequences
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists outreach_sequences_member_read on public.outreach_sequences;
create policy outreach_sequences_member_read on public.outreach_sequences
  for select to authenticated using (workspace_id = public.current_workspace_id());
drop policy if exists outreach_sequence_steps_owner_access on public.outreach_sequence_steps;
create policy outreach_sequence_steps_owner_access on public.outreach_sequence_steps
  for all to postgres, supabase_admin using (true) with check (true);
drop policy if exists outreach_sequence_steps_member_read on public.outreach_sequence_steps;
create policy outreach_sequence_steps_member_read on public.outreach_sequence_steps
  for select to authenticated using (
    sequence_id in (select id from public.outreach_sequences where workspace_id = public.current_workspace_id()));

-- ---------------------------------------------------------------------------
-- 2. create_outreach_sequence — service-only; drafts a ladder (pending_approval).
--    Steps are supplied pre-hashed by the worker (body_hash/scope_hash computed the
--    same way approvalHash/approvalScopeHash do). No send, no approval minted here.
-- ---------------------------------------------------------------------------
create or replace function public.create_outreach_sequence(
  p_workspace_id uuid, p_candidate_id text, p_campaign_id text, p_max_touches int, p_steps jsonb
) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare seq_id uuid; step jsonb; n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) < 1 or jsonb_array_length(p_steps) > 5 then
    return json_build_object('ok', false, 'reason', 'invalid-steps');
  end if;
  insert into public.outreach_sequences(workspace_id, candidate_id, campaign_id, status, max_touches)
    values (p_workspace_id, p_candidate_id, p_campaign_id, 'pending_approval', least(greatest(coalesce(p_max_touches, 1), 1), 5))
    returning id into seq_id;
  n := 0;
  for step in select * from jsonb_array_elements(p_steps) loop
    insert into public.outreach_sequence_steps(sequence_id, ordinal, gap_days, channel, message_id, body, body_hash, scope_hash)
      values (seq_id, n, coalesce((step->>'gapDays')::int, 0), step->>'channel', step->>'messageId',
              step->>'body', step->>'bodyHash', step->>'scopeHash');
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'sequence_id', seq_id, 'status', 'pending_approval', 'steps', n);
end; $$;
revoke all on function public.create_outreach_sequence(uuid, text, text, int, jsonb) from public, anon, authenticated, authenticator;
grant execute on function public.create_outreach_sequence(uuid, text, text, int, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. activate_outreach_sequence — service-only, one-shot pending_approval -> active.
--    Refuses unless EVERY step has a live, human, unrevoked approval whose hashes
--    match the STORED step bodies. This is the mechanical "approve once" gate.
-- ---------------------------------------------------------------------------
create or replace function public.activate_outreach_sequence(p_sequence_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare seq public.outreach_sequences%rowtype; unapproved int; updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  select * into seq from public.outreach_sequences where id = p_sequence_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if seq.status <> 'pending_approval' then return json_build_object('ok', false, 'reason', 'not-pending'); end if;

  -- The HARD OWNER GATE, enforced in the authority itself (Codex P1-17):
  -- no service-role component can activate a sequence while the workspace
  -- switchboard has sequences disabled or the kill switch engaged.
  if not exists (
    select 1 from public.sourcing_loop_controls controls
     where controls.workspace_id = seq.workspace_id
       and controls.kill_switch = false
       and controls.sequences_enabled = true
     for share
  ) then
    return json_build_object('ok', false, 'reason', 'sequences_disabled');
  end if;

  -- Every step must have an unrevoked human approval with matching hashes.
  select count(*) into unapproved
    from public.outreach_sequence_steps s
    where s.sequence_id = p_sequence_id
      and not exists (
        select 1 from public.outreach_approvals a
        where a.workspace_id = seq.workspace_id
          and a.message_id = s.message_id
          and a.body_hash = s.body_hash
          and a.approval_scope_hash = s.scope_hash
          and a.approval_source = 'human'
          and a.revoked_at is null);
  if unapproved > 0 then
    return json_build_object('ok', false, 'reason', 'steps-unapproved', 'missing', unapproved);
  end if;

  update public.outreach_sequences set status = 'active', updated_at = now()
   where id = p_sequence_id and status = 'pending_approval';
  get diagnostics updated = row_count;
  if updated = 0 then return json_build_object('ok', false, 'reason', 'race-lost'); end if;

  -- Mark the first step due; the rest wait on cadence.
  update public.outreach_sequence_steps set status = 'due' where sequence_id = p_sequence_id and ordinal = 0 and status = 'waiting';
  return json_build_object('ok', true, 'status', 'active');
end; $$;
revoke all on function public.activate_outreach_sequence(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.activate_outreach_sequence(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. stop_outreach_sequence — service-only. Terminal stop; revokes remaining
--    approvals (via the existing lifecycle RPC would need auth.uid — here the
--    worker cancels the waiting/due steps and marks the sequence stopped; approval
--    revocation for future steps is enforced by claim-time re-verification + the
--    review UI's stop action which calls revoke_outreach_approval under a human).
-- ---------------------------------------------------------------------------
create or replace function public.stop_outreach_sequence(p_sequence_id uuid, p_reason text) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare new_status text; updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  new_status := case p_reason
    when 'reply' then 'stopped_reply' when 'optout' then 'stopped_optout'
    when 'manual' then 'stopped_manual' when 'erasure' then 'stopped_erasure'
    when 'campaign' then 'stopped_campaign' else 'stopped_manual' end;
  update public.outreach_sequences set status = new_status, updated_at = now()
   where id = p_sequence_id and status in ('active', 'paused_ambiguous', 'pending_approval');
  get diagnostics updated = row_count;
  if updated = 0 then return json_build_object('ok', false, 'reason', 'not-stoppable'); end if;
  -- Cancel a still-queued outbound for any scheduled step before cancelling
  -- the step (Codex P1-19): a stopped ladder must not leave a send in flight.
  update public.messages_outbound mo
     set status = 'cancelled', updated_at = now()
    from public.outreach_sequence_steps s
   where s.sequence_id = p_sequence_id
     and s.queued_outbound_id = mo.id
     and s.status = 'scheduled'
     and mo.status in ('queued', 'blocked');
  update public.outreach_sequence_steps set status = 'cancelled'
   where sequence_id = p_sequence_id and status in ('waiting', 'due', 'scheduled');
  return json_build_object('ok', true, 'status', new_status);
end; $$;
revoke all on function public.stop_outreach_sequence(uuid, text) from public, anon, authenticated, authenticator;
grant execute on function public.stop_outreach_sequence(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4b. claim_sequence_step_for_schedule — the scheduling authority (Codex
--     P1-20: previously referenced in comments but never defined). A due step
--     may only be claimed for scheduling when, atomically under locks:
--       * the workspace switchboard still allows sequences (hard owner gate),
--       * the sequence is still 'active',
--       * a live, human, unrevoked outreach approval still matches THIS step's
--         stored message_id + body_hash + scope_hash (approve-once re-verified
--         at send time, never trusted from activation),
--       * the candidate is not suppressed,
--       * the step is actually due (scheduled_at <= now or ordinal 0).
--     It flips the step to 'scheduled' and returns the body the caller hands to
--     the EXISTING send path (claim_email_outbound / WhatsApp claim). It mints
--     NO new approval and NO new send authority.
-- ---------------------------------------------------------------------------
create or replace function public.claim_sequence_step_for_schedule(p_step_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare step public.outreach_sequence_steps%rowtype; seq public.outreach_sequences%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;

  select * into step from public.outreach_sequence_steps where id = p_step_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'not-found'); end if;
  if step.status <> 'due' then return json_build_object('ok', false, 'reason', 'not-due'); end if;

  select * into seq from public.outreach_sequences where id = step.sequence_id for update;
  if not found or seq.status <> 'active' then return json_build_object('ok', false, 'reason', 'sequence-not-active'); end if;

  -- Hard owner gate, re-checked at schedule time.
  if not exists (
    select 1 from public.sourcing_loop_controls controls
     where controls.workspace_id = seq.workspace_id
       and controls.kill_switch = false
       and controls.sequences_enabled = true
     for share
  ) then
    return json_build_object('ok', false, 'reason', 'sequences_disabled');
  end if;

  -- Live approval re-verification against THIS step's stored identity.
  if not exists (
    select 1 from public.outreach_approvals a
     where a.workspace_id = seq.workspace_id
       and a.message_id = step.message_id
       and a.body_hash = step.body_hash
       and a.approval_scope_hash = step.scope_hash
       and a.approval_source = 'human'
       and a.revoked_at is null
  ) then
    return json_build_object('ok', false, 'reason', 'approval-revoked');
  end if;

  -- Suppression check (channel-aware): a suppressed candidate never schedules.
  if exists (
    select 1 from public.suppression_list sl
     where sl.workspace_id = seq.workspace_id
       and sl.candidate_id = seq.candidate_id
  ) then
    return json_build_object('ok', false, 'reason', 'suppressed');
  end if;

  update public.outreach_sequence_steps
     set status = 'scheduled', scheduled_at = now()
   where id = p_step_id;

  return json_build_object(
    'ok', true, 'reason', 'scheduled',
    'step_id', step.id, 'sequence_id', seq.id, 'ordinal', step.ordinal,
    'channel', step.channel, 'message_id', step.message_id,
    'candidate_id', seq.candidate_id, 'workspace_id', seq.workspace_id,
    'body', step.body
  );
end; $$;
revoke all on function public.claim_sequence_step_for_schedule(uuid) from public, anon, authenticated, authenticator;
grant execute on function public.claim_sequence_step_for_schedule(uuid) to service_role;

-- Bind a scheduled step to the outbound it produced, so stop can reach it.
create or replace function public.bind_sequence_step_outbound(p_step_id uuid, p_outbound_id uuid) returns json
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare updated int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then return json_build_object('ok', false, 'reason', 'service-only'); end if;
  update public.outreach_sequence_steps
     set queued_outbound_id = p_outbound_id
   where id = p_step_id and status = 'scheduled' and queued_outbound_id is null;
  get diagnostics updated = row_count;
  return json_build_object('ok', updated = 1, 'reason', case when updated = 1 then 'bound' else 'not-bindable' end);
end; $$;
revoke all on function public.bind_sequence_step_outbound(uuid, uuid) from public, anon, authenticated, authenticator;
grant execute on function public.bind_sequence_step_outbound(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Erasure enrollment (0035/0037 pattern): an erased candidate's sequences +
--    steps are deleted when the erasure request lands.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_erased_candidate_sequences()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  delete from public.outreach_sequences
   where workspace_id = new.workspace_id and candidate_id = new.candidate_id;
  return null;
end; $$;
revoke all on function public.cleanup_erased_candidate_sequences() from public, anon, authenticated, service_role, authenticator;
drop trigger if exists candidate_erasure_requests_sequences_cleanup on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_sequences_cleanup
  after insert or update on public.candidate_erasure_requests
  for each row when (new.status <> 'blocked_legal_hold')
  execute function public.cleanup_erased_candidate_sequences();

alter function public.create_outreach_sequence(uuid, text, text, int, jsonb) owner to postgres;
alter function public.activate_outreach_sequence(uuid) owner to postgres;
alter function public.stop_outreach_sequence(uuid, text) owner to postgres;
alter function public.claim_sequence_step_for_schedule(uuid) owner to postgres;
alter function public.bind_sequence_step_outbound(uuid, uuid) owner to postgres;
alter function public.cleanup_erased_candidate_sequences() owner to postgres;
