-- 0051_requisition_parse_execution_claim.sql
--
-- Closes a provider-egress duplication gap in 0050: authorize_requisition_
-- parse_job proved a live lease but was read-only (`stable`), so two
-- concurrent calls with the same valid job_id + lease_id (duplicate worker
-- dispatch, retried HTTP call, etc.) could both observe 'authorized' and
-- both make a paid provider request. Receipt replay in finalize_requisition_
-- parse stops duplicate DB effects, but not duplicate provider egress that
-- already happened before either call reached finalize.
--
-- Safety invariant: at most one provider request is ever made without known
-- provider idempotency. A crash BEFORE egress starts may always recover
-- (the claim is just discarded and re-won). Any uncertainty AFTER egress
-- starts is held ambiguous/dead until an operator reconciles it -- it is
-- never automatically retried, because a retry would risk a second paid
-- call for work that may already have gone out.
--
-- Adds a service-only, mutable execution-claim table with an explicit
-- fencing state machine: claimed -> egress_started -> completed, with a
-- fourth terminal state 'ambiguous' reachable only from egress_started (by
-- either the reaper, on lease expiry, or the new
-- fail_requisition_parse_egress authority, on a post-egress failure). Does
-- not edit 0038/0043/0049/0050 (append-only); re-creates
-- reap_expired_aria_job_leases (0038) with unchanged signature/owner/grants
-- to add requisition_parse-specific egress handling, exactly as 0050
-- already re-created heartbeat/complete/fail_aria_job.
--
--   * requisition_parse_execution_claims -- one row per requisition_parse
--     job_id. Bound to aria_jobs(id) on delete cascade so it can never
--     outlive its job. A second unique authority on workspace + requisition
--     + input hash prevents a differently keyed duplicate job from winning
--     a second paid parse for the same immutable input.
--       - claim_token: an unguessable (gen_random_uuid) capability handed
--         back only to the caller that won the claim via authorize.
--       - fence_version: a monotonically increasing integer, incremented
--         every time a stale 'claimed' row is overwritten by a newer lease.
--         Checked alongside claim_token everywhere as a second, independent
--         fencing signal.
--       - egress_attempt_id: a second unguessable capability, minted only
--         by begin_requisition_parse_egress the one time a given claim_token
--         is allowed to reach egress_started. finalize and the terminal
--         failure authority both require it, so neither can be invoked by
--         anything that only ever saw the authorize response.
--       - state: 'claimed' (authorized, no provider egress yet),
--         'egress_started' (the provider call is in flight or already
--         happened and must never be duplicated), 'completed' (finalize
--         wrote the result), or 'ambiguous' (egress_started ended without a
--         proven completion -- lease expiry or an explicit post-egress
--         failure; terminal, held for operator reconciliation).
--       - provider/model are bound at begin (not before): they are exactly
--         what is about to be called, and finalize must see the identical
--         values back.
--     Mutable (not append-only): a claim whose lease is no longer aria_jobs'
--     current live lease for that job is stale and may be replaced by
--     whichever lease is current -- but ONLY while it is still 'claimed'.
--     This is what makes crash recovery (reap -> re-lease -> re-claim) work
--     before egress without leaving a permanently stuck row, while making a
--     crash *during* egress unresumable by design.
--   * authorize_requisition_parse_job_v2 -- locks the job row FOR UPDATE before
--     validating it (still not `stable`), serializing every concurrent call
--     for the same job_id. An already-succeeded job's exact-match replay
--     (proven by the immutable receipt, since the live lease is cleared on
--     success) now also reproves the requisition's CURRENT input hash
--     against the receipt's stored input hash before replaying -- if the
--     underlying input has since changed, replay is refused. After all
--     existing validation passes, it claims or re-claims the job atomically:
--     a claim already held by this exact lease_id is a duplicate concurrent
--     request and is denied ('already_claimed'); a claim held by any other
--     lease_id is necessarily stale (the job-row lock above already proved
--     p_lease_id is the one live lease) and may be overwritten only while
--     still 'claimed' (fence_version increments) -- an 'egress_started' (or
--     later) stale claim is atomically quarantined with the current job and
--     returns 'quarantined_ambiguous'; it is never overwritten or retried.
--   * begin_requisition_parse_egress (new) -- the only RPC allowed to move a
--     claim from 'claimed' to 'egress_started'. Must be called after
--     settings/vault resolution and immediately before the provider fetch.
--     Locks the job row FOR UPDATE, revalidates the live unexpired exact
--     lease, the exact claim token/fence version/workspace/requisition/
--     input hash/job payload/state, and current intake controls, then
--     atomically binds provider+model, mints egress_attempt_id, flips the
--     claim, and extends the job lease (never shortens it) to at least 60
--     seconds -- enough for the bounded 20-second fetch plus bounded read,
--     parse, and finalization. A stale worker whose lease was already
--     transferred to a newer claim is denied here (lease_mismatch) before it
--     can ever reach fetch.
--   * finalize_requisition_parse -- when transitioning a still-'leased' job
--     (the real completion path; the lost-response replay path for an
--     already-'succeeded' job is gated by exact receipt equality instead,
--     unchanged), now requires an exact claim_token + fence_version +
--     egress_attempt_id + provider + model match and that the claim is in
--     state 'egress_started', inside the same locked transaction. On
--     success it atomically flips the claim to 'completed'. A missing,
--     wrong-state, or mismatched claim denies with 'claim_lost' and writes
--     nothing. It takes the requisition lock used by ingress replay before
--     the job and claim locks, avoiding requisition/job lock inversion.
--   * fail_requisition_parse_egress (new) -- the ONLY authority the handler
--     may use for a failure discovered after begin succeeded. Locks the job
--     then the claim (same lock order as every other RPC here), reproves
--     the exact live lease/token/fence/attempt/workspace/requisition/
--     provider/model/state, and atomically marks the claim 'ambiguous' (with
--     a bounded reason) and the job 'dead' in one transaction. Never
--     requeues: a post-egress failure must never be retried without known
--     provider idempotency.
--   * reap_expired_aria_job_leases -- re-created with the same signature,
--     owner, and grants as 0038. Behavior for every other job kind, and for
--     a requisition_parse job whose claim is 'claimed' (or absent), is
--     byte-for-byte unchanged: it requeues (or dead-letters on exhausted
--     attempts) exactly as before. The one new branch is a requisition_parse
--     job whose claim is beyond 'claimed': egress_started is first marked
--     ambiguous, while already ambiguous/completed evidence is preserved;
--     in every case the job is marked dead and never requeued. Requeuing
--     could let a new worker call the provider a second time or corrupt a
--     terminal receipt. Every path locks job-row before claim-row, and
--     clock_timestamp() is read only after the
--     job-row lock is held, so a lease extended by a concurrent
--     begin_requisition_parse_egress call is correctly seen as no-longer-
--     expired once this reaper actually acquires the row.
--
-- Run after 0050_requisition_parse_authority.sql.

create table if not exists public.requisition_parse_execution_claims (
  job_id uuid primary key references public.aria_jobs(id) on delete cascade,
  claim_token uuid not null unique default gen_random_uuid(),
  fence_version integer not null default 1 check (fence_version >= 1),
  egress_attempt_id uuid unique,
  state text not null default 'claimed'
    check (state in ('claimed', 'egress_started', 'completed', 'ambiguous')),
  lease_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requisition_id uuid not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  job_kind text not null check (job_kind = 'requisition_parse'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider text check (provider is null or char_length(provider) between 1 and 100),
  model text check (model is null or char_length(model) between 1 and 200),
  claimed_at timestamptz not null default now(),
  egress_started_at timestamptz,
  completed_at timestamptz,
  ambiguous_at timestamptz,
  ambiguous_reason text check (ambiguous_reason is null or char_length(ambiguous_reason) <= 500),
  foreign key (workspace_id, requisition_id)
    references public.requisitions(workspace_id, id) on delete cascade,
  constraint requisition_parse_execution_claims_input_uniq
    unique (workspace_id, requisition_id, input_sha256),
  constraint requisition_parse_execution_claims_state_coherence check (
    (
      state = 'claimed'
      and egress_attempt_id is null
      and provider is null
      and model is null
      and egress_started_at is null
      and completed_at is null
      and ambiguous_at is null
      and ambiguous_reason is null
    )
    or (
      state = 'egress_started'
      and egress_attempt_id is not null
      and provider is not null
      and model is not null
      and egress_started_at is not null
      and completed_at is null
      and ambiguous_at is null
      and ambiguous_reason is null
    )
    or (
      state = 'completed'
      and egress_attempt_id is not null
      and provider is not null
      and model is not null
      and egress_started_at is not null
      and completed_at is not null
      and ambiguous_at is null
      and ambiguous_reason is null
    )
    or (
      state = 'ambiguous'
      and egress_attempt_id is not null
      and provider is not null
      and model is not null
      and egress_started_at is not null
      and completed_at is null
      and ambiguous_at is not null
      and ambiguous_reason is not null
    )
  )
);

alter table public.requisition_parse_execution_claims enable row level security;
alter table public.requisition_parse_execution_claims force row level security;
revoke all on public.requisition_parse_execution_claims
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists requisition_parse_execution_claims_postgres_all
  on public.requisition_parse_execution_claims;
create policy requisition_parse_execution_claims_postgres_all
  on public.requisition_parse_execution_claims
  for all to postgres, supabase_admin using (true) with check (true);

-- ---------------------------------------------------------------------------
-- authorize_requisition_parse_job_v2 -- claims exclusive provider-egress
-- rights atomically, in the same transaction that proves the live lease.
--
-- IMPORTANT expand/contract boundary: 0050's four-argument
-- authorize_requisition_parse_job remains unchanged for the already-running
-- image and its rollback path. The fenced protocol uses a distinct v2 name so
-- an old handler can never receive a claim token it does not understand.
-- ---------------------------------------------------------------------------
create or replace function public.authorize_requisition_parse_job_v2(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  input_row public.requisition_inputs%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
  receipt_row public.requisition_parse_receipts%rowtype;
  current_input_hash text;
  new_claim_token uuid;
  new_fence_version integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_requisition_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Lock the job row for the rest of this transaction. A second concurrent
  -- call for the same job_id blocks here until the first call's transaction
  -- commits or rolls back, which is what makes the claim upsert below
  -- atomic: only one caller can ever observe and win an empty/stale claim
  -- for a given job_id at a time.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'requisition_parse' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  -- A succeeded job's live lease is cleared by finalize, so a lost-response
  -- retry cannot be proven via job_row.lease_id any more. The immutable
  -- receipt is the proof: exact job + exact original lease/workspace/
  -- requisition, AND the requisition's CURRENT input hash still matching the
  -- receipt's stored input hash (the underlying input has not since
  -- changed), replays no_op with zero raw content and zero provider egress.
  -- Any other caller for an already-succeeded job is stale/orphaned and is
  -- denied read-only -- it can never be mistaken for completion.
  if job_row.status = 'succeeded' then
    select * into receipt_row from public.requisition_parse_receipts where job_id = p_job_id;
    if found
       and receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.requisition_id = p_requisition_id
    then
      select need_sha256 into current_input_hash
        from public.requisition_inputs
       where requisition_id = p_requisition_id
         and workspace_id = p_workspace_id;
      if current_input_hash is not null and current_input_hash = receipt_row.input_sha256 then
        return jsonb_build_object('status', 'no_op_replay', 'ready', receipt_row.ready);
      end if;
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lease_expired');
  end if;

  select * into input_row
    from public.requisition_inputs
   where requisition_id = p_requisition_id
     and workspace_id = p_workspace_id;
  if not found then
    return jsonb_build_object('status', 'input_not_found');
  end if;

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id;
  if not found or control_row.kill_switch or not control_row.intake_enabled then
    return jsonb_build_object('status', 'intake_disabled');
  end if;

  -- Execution claim: only one concurrent authorize call for this exact live
  -- job lease may proceed to provider egress.
  select * into claim_row
    from public.requisition_parse_execution_claims
   where job_id = p_job_id
     for update;

  if found and claim_row.lease_id = p_lease_id then
    -- A prior claim already bound to THIS lease_id means a duplicate
    -- concurrent request lost the race; deny it without returning raw
    -- input, regardless of the claim's current state.
    return jsonb_build_object('status', 'already_claimed');
  end if;

  if found and claim_row.state <> 'claimed' then
    -- The job-row lock above proved this caller owns the *current* lease,
    -- but the claim belongs to an older lease that already crossed the
    -- provider-egress boundary (or is otherwise terminal/inconsistent).
    -- Quarantine the current job atomically instead of returning a status
    -- that would leave it leased or route it through generic failure.
    if claim_row.state = 'egress_started' then
      update public.requisition_parse_execution_claims
         set state = 'ambiguous',
             ambiguous_reason = 'stale egress claim discovered under a newer live lease',
             ambiguous_at = clock_timestamp()
       where job_id = p_job_id;
    end if;

    update public.aria_jobs
       set status = 'dead',
           lease_id = null,
           lease_expires_at = null,
           last_error = left('requisition_parse quarantined: prior claim state ' || claim_row.state, 2000),
           updated_at = clock_timestamp()
     where id = p_job_id;

    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      p_workspace_id, 'job.dead', 'aria_job', p_job_id::text, p_job_id,
      jsonb_build_object(
        'kind', job_row.kind,
        'attempts', job_row.attempt_count,
        'reason', 'prior_egress_claim_quarantined',
        'claim_state', claim_row.state
      )
    );
    return jsonb_build_object('status', 'quarantined_ambiguous');
  end if;

  -- Any remaining stale claim is 'claimed' (no provider egress ever began
  -- under it) and is safely replaced; fence_version increments so a fencing
  -- check against the old epoch can never be satisfied by the new one. This
  -- is what lets a later lease claim after a pre-egress crash without
  -- leaving a permanently stuck row.
  new_claim_token := gen_random_uuid();
  begin
    if found then
      new_fence_version := claim_row.fence_version + 1;
      update public.requisition_parse_execution_claims
         set claim_token = new_claim_token,
             fence_version = new_fence_version,
             egress_attempt_id = null,
             state = 'claimed',
             lease_id = p_lease_id,
             workspace_id = p_workspace_id,
             requisition_id = p_requisition_id,
             input_sha256 = input_row.need_sha256,
             job_kind = job_row.kind,
             payload_sha256 = job_row.payload_sha256,
             provider = null,
             model = null,
             claimed_at = clock_timestamp(),
             egress_started_at = null,
             completed_at = null,
             ambiguous_at = null,
             ambiguous_reason = null
       where job_id = p_job_id;
    else
      new_fence_version := 1;
      insert into public.requisition_parse_execution_claims (
        job_id, claim_token, fence_version, state, lease_id, workspace_id, requisition_id,
        input_sha256, job_kind, payload_sha256
      ) values (
        p_job_id, new_claim_token, new_fence_version, 'claimed', p_lease_id, p_workspace_id, p_requisition_id,
        input_row.need_sha256, job_row.kind, job_row.payload_sha256
      );
    end if;
  exception
    when unique_violation then
      -- Another job already owns this exact tenant/requisition/input
      -- execution identity. The unique constraint is the concurrency
      -- authority; catching its conflict here keeps the denial read-only
      -- and, critically, returns no raw requisition content.
      return jsonb_build_object('status', 'duplicate_input_claim');
  end;

  return jsonb_build_object(
    'status', 'authorized',
    'workspace_id', input_row.workspace_id,
    'requisition_id', input_row.requisition_id,
    'content', input_row.content,
    'content_type', input_row.content_type,
    'need_sha256', input_row.need_sha256,
    'claim_token', new_claim_token,
    'fence_version', new_fence_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- begin_requisition_parse_egress (new) -- the only path from 'claimed' to
-- 'egress_started'. Must be called after settings/vault resolution and
-- immediately before the provider fetch.
-- ---------------------------------------------------------------------------
create or replace function public.begin_requisition_parse_egress(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid,
  p_claim_token uuid,
  p_fence_version integer,
  p_input_sha256 text,
  p_provider text,
  p_model text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
  new_attempt_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_requisition_id is null or p_claim_token is null or p_fence_version is null
     or p_input_sha256 is null or p_input_sha256 !~ '^[0-9a-f]{64}$'
     or p_provider is null or char_length(p_provider) not between 1 and 100
     or p_model is null or char_length(p_model) not between 1 and 200 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Lock the job row: a stale worker whose lease was already transferred to
  -- a newer claim (crash -> reap -> re-lease -> re-authorize) is denied here
  -- by the lease_id check below, before it can ever reach fetch.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'requisition_parse' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  if job_row.lease_expires_at is null or job_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'lease_expired');
  end if;

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id;
  if not found or control_row.kill_switch or not control_row.intake_enabled then
    return jsonb_build_object('status', 'intake_disabled');
  end if;

  select * into claim_row
    from public.requisition_parse_execution_claims
   where job_id = p_job_id
     for update;
  if not found
     or claim_row.claim_token <> p_claim_token
     or claim_row.fence_version <> p_fence_version
     or claim_row.state <> 'claimed'
     or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.requisition_id <> p_requisition_id
     or claim_row.input_sha256 <> p_input_sha256
     or claim_row.job_kind <> job_row.kind
     or claim_row.payload_sha256 <> job_row.payload_sha256 then
    -- Covers: no claim, wrong token/fence, already past 'claimed' (defends
    -- against a duplicate begin call for this exact lease -- only one
    -- provider fetch is ever permitted per claim), or a claim bound to a
    -- different lease/workspace/requisition/input/job payload.
    return jsonb_build_object('status', 'claim_lost');
  end if;

  new_attempt_id := gen_random_uuid();
  update public.requisition_parse_execution_claims
     set state = 'egress_started',
         egress_attempt_id = new_attempt_id,
         provider = p_provider,
         model = p_model,
         egress_started_at = clock_timestamp()
   where job_id = p_job_id;

  -- Ensure the lease outlives the bounded 20-second fetch plus the bounded
  -- read/parse/finalize that follow it: extend to at least 60 seconds,
  -- never shorten it.
  update public.aria_jobs
     set lease_expires_at = greatest(lease_expires_at, clock_timestamp() + interval '60 seconds')
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id;

  return jsonb_build_object(
    'status', 'egress_started',
    'egress_attempt_id', new_attempt_id,
    'fence_version', p_fence_version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_requisition_parse -- same atomic transaction, now also requires
-- the execution claim to have reached 'egress_started' under this exact
-- token/fence/attempt/provider/model before it will write anything, and
-- flips the claim to 'completed' on success.
-- ---------------------------------------------------------------------------
-- The 0050 nine-argument finalizer intentionally remains unchanged during
-- this expansion release so the already-running image and exact rollback
-- image remain compatible. A later protected contraction migration may drop
-- both legacy functions only after the live prior fleet proves fenced-v2.

create or replace function public.finalize_requisition_parse(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid,
  p_claim_token uuid,
  p_fence_version integer,
  p_egress_attempt_id uuid,
  p_input_sha256 text,
  p_job_analysis jsonb,
  p_warnings jsonb,
  p_provider text,
  p_model text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  input_row public.requisition_inputs%rowtype;
  control_row public.sourcing_loop_controls%rowtype;
  receipt_row public.requisition_parse_receipts%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
  ready boolean;
  result_hash text;
  confidence numeric;
  updated int;
  enqueue_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_requisition_id is null or p_claim_token is null
     or p_fence_version is null or p_egress_attempt_id is null
     or p_input_sha256 is null
     or p_input_sha256 !~ '^[0-9a-f]{64}$'
     or p_job_analysis is null or jsonb_typeof(p_job_analysis) <> 'object'
     or p_warnings is null or jsonb_typeof(p_warnings) <> 'array'
     or p_provider is null or char_length(p_provider) not between 1 and 100
     or p_model is null or char_length(p_model) not between 1 and 200 then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Ingress replay takes the requisition lock before it inspects the parse
  -- job. Take the same leading lock here before the job->claim locks so the
  -- two transactions cannot form requisition->job / job->requisition lock
  -- inversion. The job is still always locked before the claim.
  perform 1
    from public.requisitions
   where id = p_requisition_id
     and workspace_id = p_workspace_id
   for update;
  if not found then
    return jsonb_build_object('status', 'input_mismatch');
  end if;

  -- Lock the job row for the rest of this transaction: nothing else can
  -- change its status/lease under us from here on.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'requisition_parse' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.status not in ('leased', 'succeeded') then
    return jsonb_build_object('status', 'lease_mismatch');
  end if;
  if job_row.status = 'leased' then
    if job_row.lease_id <> p_lease_id then
      return jsonb_build_object('status', 'lease_mismatch');
    end if;
    if job_row.lease_expires_at is null or job_row.lease_expires_at <= clock_timestamp() then
      return jsonb_build_object('status', 'lease_expired');
    end if;
  end if;
  if job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;

  -- The execution claim proves THIS exact lease/token/fence/attempt won
  -- provider-egress rights via authorize_requisition_parse_job_v2 and actually
  -- began egress via begin_requisition_parse_egress for exactly this
  -- provider/model. Only the real completion path (job still 'leased')
  -- needs this: the lost-response replay path below (job already
  -- 'succeeded') is gated by exact receipt equality instead, which is a
  -- strictly stronger check.
  if job_row.status = 'leased' then
    select * into claim_row
      from public.requisition_parse_execution_claims
     where job_id = p_job_id
       for update;
    if not found
       or claim_row.claim_token <> p_claim_token
       or claim_row.fence_version <> p_fence_version
       or claim_row.egress_attempt_id <> p_egress_attempt_id
       or claim_row.state <> 'egress_started'
       or claim_row.lease_id <> p_lease_id
       or claim_row.workspace_id <> p_workspace_id
       or claim_row.requisition_id <> p_requisition_id
       or claim_row.input_sha256 <> p_input_sha256
       or claim_row.job_kind <> job_row.kind
       or claim_row.payload_sha256 <> job_row.payload_sha256
       or claim_row.provider <> p_provider
       or claim_row.model <> p_model then
      return jsonb_build_object('status', 'claim_lost');
    end if;
  end if;

  select * into input_row
    from public.requisition_inputs
   where requisition_id = p_requisition_id
     and workspace_id = p_workspace_id;
  if not found or input_row.need_sha256 <> p_input_sha256 then
    return jsonb_build_object('status', 'input_mismatch');
  end if;

  select * into control_row
    from public.sourcing_loop_controls
   where workspace_id = p_workspace_id
     for share;
  if not found or control_row.kill_switch or not control_row.intake_enabled then
    return jsonb_build_object('status', 'intake_disabled');
  end if;

  -- Readiness is computed HERE, from the grounded job-analysis values, and
  -- is never taken from a caller-supplied flag. Mirrors
  -- src/lib/needs/readiness.ts::evaluateNeedReadiness exactly.
  ready := (
    length(btrim(coalesce(p_job_analysis->>'title', ''))) >= 2
    and coalesce(p_job_analysis->>'seniority', 'Unspecified') <> 'Unspecified'
    and coalesce(p_job_analysis->>'employmentType', 'Unspecified') <> 'Unspecified'
    and coalesce(p_job_analysis->>'locationType', 'Unspecified') <> 'Unspecified'
    and exists (
      select 1
        from jsonb_array_elements_text(coalesce(p_job_analysis->'requiredSkills', '[]'::jsonb)) skill
       where length(btrim(skill)) > 0
    )
  );
  confidence := (
    select round((count(*) filter (where present))::numeric / 5, 4)
      from (values
        (length(btrim(coalesce(p_job_analysis->>'title', ''))) > 0),
        (coalesce(p_job_analysis->>'seniority', 'Unspecified') <> 'Unspecified'),
        (coalesce(p_job_analysis->>'employmentType', 'Unspecified') <> 'Unspecified'),
        (coalesce(p_job_analysis->>'locationType', 'Unspecified') <> 'Unspecified'),
        (jsonb_array_length(coalesce(p_job_analysis->'requiredSkills', '[]'::jsonb)) > 0)
      ) as f(present)
  );
  -- The receipt commits to every persisted model-derived field. Hashing only
  -- job_analysis would incorrectly accept a replay whose warnings drifted.
  result_hash := encode(sha256(convert_to(
    jsonb_build_object('job_analysis', p_job_analysis, 'warnings', p_warnings)::text,
    'UTF8'
  )), 'hex');

  -- Lost-response retry: only the exact completed lease and exact immutable
  -- parse evidence may replay successfully. A different job, lease, input,
  -- model or output is a conflict and can never be mistaken for completion.
  if job_row.status = 'succeeded' then
    select * into receipt_row
      from public.requisition_parse_receipts
     where job_id = p_job_id;
    if found
       and receipt_row.lease_id = p_lease_id
       and receipt_row.workspace_id = p_workspace_id
       and receipt_row.requisition_id = p_requisition_id
       and receipt_row.input_sha256 = p_input_sha256
       and receipt_row.result_sha256 = result_hash
       and receipt_row.provider = p_provider
       and receipt_row.model = p_model then
      return jsonb_build_object(
        'status', 'no_op_replay',
        'ready', receipt_row.ready
      );
    end if;
    return jsonb_build_object('status', 'replay_conflict');
  end if;

  update public.requisitions
     set parsed_job_analysis = p_job_analysis,
         parse_warnings = p_warnings,
         parse_confidence = confidence,
         status = case when ready then 'ready' else 'needs_clarification' end,
         parse_provider = p_provider,
         parse_model = p_model,
         parse_input_sha256 = p_input_sha256,
         parse_result_sha256 = result_hash,
         updated_at = now()
   where id = p_requisition_id
     and workspace_id = p_workspace_id
     and status in ('received', 'parsed');
  get diagnostics updated = row_count;

  if updated = 0 then
    return jsonb_build_object('status', 'state_conflict');
  end if;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
  values (
    p_workspace_id, 'requisition.parsed', 'requisition', p_requisition_id::text, p_job_id,
    jsonb_build_object('ready', ready)
  );

  -- The requisitions row is already written at this point: any failure from
  -- here on must raise (never return) so the whole transaction rolls back
  -- together, never leaving a parsed requisition with a job that isn't
  -- actually complete.
  update public.aria_jobs
     set status = 'succeeded',
         result_sha256 = result_hash,
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = now()
   where id = p_job_id
     and status = 'leased'
     and lease_id = p_lease_id
     and lease_expires_at > clock_timestamp();
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'requisition parse job lease lost mid-commit' using errcode = 'P0001';
  end if;

  if ready then
    enqueue_result := public.enqueue_aria_job(
      p_workspace_id,
      'campaign_create',
      'campaign_create:' || p_requisition_id::text,
      jsonb_build_object('requisition_id', p_requisition_id::text),
      now(),
      100
    );
    if enqueue_result->>'status' <> 'enqueued' then
      raise exception 'campaign_create enqueue failed: %', enqueue_result->>'status'
        using errcode = '22023';
    end if;
  end if;

  insert into public.requisition_parse_receipts (
    job_id, lease_id, workspace_id, requisition_id,
    input_sha256, result_sha256, provider, model, ready
  ) values (
    p_job_id, p_lease_id, p_workspace_id, p_requisition_id,
    p_input_sha256, result_hash, p_provider, p_model, ready
  );

  update public.requisition_parse_execution_claims
     set state = 'completed',
         completed_at = clock_timestamp()
   where job_id = p_job_id;

  return jsonb_build_object('status', 'completed', 'ready', ready);
end;
$$;

-- ---------------------------------------------------------------------------
-- fail_requisition_parse_egress (new) -- the only authority the handler may
-- use for a failure discovered after begin_requisition_parse_egress
-- succeeded. Atomically marks the claim 'ambiguous' and the job 'dead'.
-- Never requeues.
-- ---------------------------------------------------------------------------
create or replace function public.fail_requisition_parse_egress(
  p_job_id uuid,
  p_lease_id uuid,
  p_workspace_id uuid,
  p_requisition_id uuid,
  p_claim_token uuid,
  p_fence_version integer,
  p_egress_attempt_id uuid,
  p_provider text,
  p_model text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_workspace_id is null
     or p_requisition_id is null or p_claim_token is null
     or p_fence_version is null or p_egress_attempt_id is null
     or p_provider is null or char_length(p_provider) not between 1 and 100
     or p_model is null or char_length(p_model) not between 1 and 200
     or (p_reason is not null and char_length(p_reason) > 2000) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- Same lock order as every other RPC in this file: job row first, then
  -- claim row. A racing reaper (which also locks job-then-claim) can never
  -- deadlock against this function, and whichever of the two acquires the
  -- job-row lock first simply wins -- the other observes the job already
  -- terminal and no-ops.
  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('status', 'job_not_found');
  end if;
  if job_row.kind <> 'requisition_parse' then
    return jsonb_build_object('status', 'wrong_kind');
  end if;
  if job_row.workspace_id <> p_workspace_id then
    return jsonb_build_object('status', 'wrong_workspace');
  end if;
  if job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'payload_mismatch');
  end if;
  if job_row.status <> 'leased' or job_row.lease_id <> p_lease_id then
    -- Already reaped/failed/succeeded by someone else (e.g. the reaper won
    -- the race): nothing left to mutate, and this call must never touch a
    -- job it no longer exactly owns.
    return jsonb_build_object('status', 'lease_mismatch');
  end if;

  select * into claim_row
    from public.requisition_parse_execution_claims
   where job_id = p_job_id
     for update;
  if not found
     or claim_row.claim_token <> p_claim_token
     or claim_row.fence_version <> p_fence_version
     or claim_row.egress_attempt_id <> p_egress_attempt_id
     or claim_row.state <> 'egress_started'
     or claim_row.lease_id <> p_lease_id
     or claim_row.workspace_id <> p_workspace_id
     or claim_row.requisition_id <> p_requisition_id
     or claim_row.job_kind <> job_row.kind
     or claim_row.payload_sha256 <> job_row.payload_sha256
     or claim_row.provider <> p_provider
     or claim_row.model <> p_model then
    return jsonb_build_object('status', 'claim_lost');
  end if;

  update public.requisition_parse_execution_claims
     set state = 'ambiguous',
         ambiguous_reason = left(coalesce(p_reason, 'provider egress outcome unknown'), 500),
         ambiguous_at = clock_timestamp()
   where job_id = p_job_id;

  update public.aria_jobs
     set status = 'dead',
         lease_id = null,
         lease_expires_at = null,
         last_error = left('requisition_parse egress ambiguous: ' || coalesce(p_reason, 'unknown'), 2000),
         updated_at = now()
   where id = p_job_id;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
  values (
    p_workspace_id, 'job.dead', 'aria_job', p_job_id::text, p_job_id,
    jsonb_build_object('kind', job_row.kind, 'attempts', job_row.attempt_count, 'reason', 'egress_ambiguous')
  );

  return jsonb_build_object('status', 'marked_ambiguous');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fence the generic job authorities around requisition_parse. The dedicated
-- finalizer is the only completion path for that kind, and a generic failure
-- may only act before provider egress starts. All other job kinds retain the
-- 0050 behavior verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.complete_aria_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_result_sha256 text,
  p_events jsonb default '[]'::jsonb,
  p_enqueue jsonb default '[]'::jsonb
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  event_item jsonb;
  enqueue_item jsonb;
  enqueue_result jsonb;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null
     or (p_result_sha256 is not null and p_result_sha256 !~ '^[0-9a-f]{64}$')
     or p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 20
     or p_enqueue is null or jsonb_typeof(p_enqueue) <> 'array'
     or jsonb_array_length(p_enqueue) > 50 then
    return false;
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return false;
  end if;
  wall_now := clock_timestamp();
  if job_row.status <> 'leased'
     or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at is null
     or job_row.lease_expires_at <= wall_now then
    return false;
  end if;
  if job_row.kind = 'requisition_parse' then
    -- A generic completion has no execution token, input hash, provider,
    -- model, receipt, or campaign-enqueue proof. It must never bypass the
    -- dedicated fenced finalizer.
    return false;
  end if;

  update public.aria_jobs
     set status = 'succeeded',
         result_sha256 = p_result_sha256,
         lease_id = null,
         lease_expires_at = null,
         last_error = null,
         updated_at = wall_now
   where id = p_job_id;

  for event_item in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(event_item) <> 'object'
       or event_item->>'event_type' is null
       or (event_item->>'event_type') !~ '^[a-z][a-z0-9_.]{1,60}$' then
      raise exception 'invalid loop event' using errcode = '22023';
    end if;
    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      job_row.workspace_id,
      event_item->>'event_type',
      event_item->>'subject_kind',
      event_item->>'subject_id',
      job_row.id,
      coalesce(event_item->'payload', '{}'::jsonb)
    );
  end loop;

  for enqueue_item in select value from jsonb_array_elements(p_enqueue)
  loop
    if jsonb_typeof(enqueue_item) <> 'object' then
      raise exception 'invalid follow-on job' using errcode = '22023';
    end if;
    enqueue_result := public.enqueue_aria_job(
      job_row.workspace_id,
      enqueue_item->>'kind',
      enqueue_item->>'idempotency_key',
      coalesce(enqueue_item->'payload', '{}'::jsonb),
      coalesce((enqueue_item->>'run_at')::timestamptz, wall_now),
      coalesce((enqueue_item->>'priority')::integer, 100)
    );
    if enqueue_result->>'status' not in ('enqueued') then
      raise exception 'follow-on enqueue failed: %', enqueue_result->>'status'
        using errcode = '22023';
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.fail_aria_job(
  p_job_id uuid,
  p_lease_id uuid,
  p_error text,
  p_retryable boolean
) returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  job_row public.aria_jobs%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
  new_status text;
  backoff interval;
  wall_now timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_job_id is null or p_lease_id is null or p_retryable is null then
    return 'invalid_request';
  end if;

  select * into job_row from public.aria_jobs where id = p_job_id for update;
  if not found then
    return 'not_found';
  end if;
  wall_now := clock_timestamp();
  if job_row.status <> 'leased'
     or job_row.lease_id <> p_lease_id
     or job_row.lease_expires_at is null
     or job_row.lease_expires_at <= wall_now then
    return 'not_found';
  end if;

  if job_row.kind = 'requisition_parse' then
    select * into claim_row
      from public.requisition_parse_execution_claims
     where job_id = p_job_id
       for update;
    if found and claim_row.state <> 'claimed' then
      -- Once provider egress has begun, only the attempt-bound failure RPC
      -- or the expiry reaper may make this job terminal. Generic failure
      -- must never requeue it and authorize a duplicate paid request.
      return 'not_found';
    end if;
  end if;

  if p_retryable and job_row.attempt_count < job_row.max_attempts then
    new_status := 'queued';
    backoff := least(
      make_interval(mins => 1) * power(2, job_row.attempt_count),
      make_interval(hours => 4)
    ) + make_interval(secs => floor(random() * 30)::integer);
  else
    new_status := 'dead';
  end if;

  update public.aria_jobs
     set status = new_status,
         lease_id = null,
         lease_expires_at = null,
         next_run_at = case when new_status = 'queued' then wall_now + backoff else next_run_at end,
         last_error = left(coalesce(p_error, 'unknown'), 2000),
         updated_at = wall_now
   where id = p_job_id;

  if new_status = 'dead' then
    insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
    values (
      job_row.workspace_id, 'job.dead', 'aria_job', job_row.id::text, job_row.id,
      jsonb_build_object('kind', job_row.kind, 'attempts', job_row.attempt_count)
    );
  end if;

  return new_status;
end;
$$;

create or replace function public.requeue_dead_aria_job(
  p_job_id uuid
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_workspace uuid;
  job_row public.aria_jobs%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_job_id is null then
    return false;
  end if;

  select * into job_row
    from public.aria_jobs
   where id = p_job_id
     and workspace_id = caller_workspace
     and status = 'dead'
   for update;
  if not found then
    return false;
  end if;

  if job_row.kind = 'requisition_parse' then
    select * into claim_row
      from public.requisition_parse_execution_claims
     where job_id = p_job_id
       for update;
    if found and claim_row.state <> 'claimed' then
      -- Ambiguous egress must remain held for explicit investigation; the
      -- generic dead-letter button cannot silently authorize another call.
      return false;
    end if;
  end if;

  update public.aria_jobs
     set status = 'queued',
         attempt_count = 0,
         next_run_at = now(),
         lease_id = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_job_id;

  insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
  values (
    caller_workspace, 'job.requeued', 'aria_job', p_job_id::text, p_job_id,
    jsonb_build_object('actor_id', auth.uid()::text)
  );
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- reap_expired_aria_job_leases -- re-created (0038 signature/owner/grants
-- unchanged) to quarantine a requisition_parse job whose claim has passed
-- the safe 'claimed' state instead of requeuing it.
-- ---------------------------------------------------------------------------
create or replace function public.reap_expired_aria_job_leases(
  p_limit integer
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  reaped_count integer := 0;
  job_row public.aria_jobs%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    return 0;
  end if;

  for job_row in
    select * from public.aria_jobs
     where status = 'leased'
       and lease_expires_at < now()
     order by lease_expires_at asc
     limit p_limit
       for update skip locked
  loop
    -- clock_timestamp() is read only after the job-row lock is held: a
    -- lease extended by a concurrent begin_requisition_parse_egress call
    -- between the snapshot above and this lock is correctly seen as
    -- no-longer-expired, and this row is left untouched.
    if job_row.lease_expires_at >= clock_timestamp() then
      continue;
    end if;

    if job_row.kind = 'requisition_parse' then
      select * into claim_row
        from public.requisition_parse_execution_claims
       where job_id = job_row.id
         for update;
      if found and claim_row.state <> 'claimed' then
        if claim_row.state = 'egress_started' then
          update public.requisition_parse_execution_claims
             set state = 'ambiguous',
                 ambiguous_reason = 'lease expired mid-egress; provider call outcome unknown',
                 ambiguous_at = clock_timestamp()
           where job_id = job_row.id;
        end if;

        update public.aria_jobs
           set status = 'dead',
               lease_id = null,
               lease_expires_at = null,
               last_error = left(
                 'requisition_parse claim quarantined on lease expiry: ' || claim_row.state,
                 2000
               ),
               updated_at = now()
         where id = job_row.id;

        insert into public.loop_events (workspace_id, event_type, subject_kind, subject_id, job_id, payload)
        values (
          job_row.workspace_id, 'job.dead', 'aria_job', job_row.id::text, job_row.id,
          jsonb_build_object(
            'kind', job_row.kind,
            'attempts', job_row.attempt_count,
            'reason', 'claim_state_quarantined',
            'claim_state', claim_row.state
          )
        );
        reaped_count := reaped_count + 1;
        continue;
      end if;
    end if;

    -- Unchanged from 0038 for every other job kind, and for a
    -- requisition_parse job whose claim is 'claimed' or absent: requeue, or
    -- dead-letter on exhausted attempts.
    update public.aria_jobs
       set status = case when job_row.attempt_count >= job_row.max_attempts then 'dead' else 'queued' end,
           lease_id = null,
           lease_expires_at = null,
           next_run_at = now() + make_interval(secs => 30 + floor(random() * 30)::integer),
           last_error = coalesce(job_row.last_error, 'lease expired'),
           updated_at = now()
     where id = job_row.id;
    reaped_count := reaped_count + 1;
  end loop;

  return reaped_count;
end;
$$;

alter function public.authorize_requisition_parse_job_v2(uuid, uuid, uuid, uuid) owner to postgres;
alter function public.begin_requisition_parse_egress(uuid, uuid, uuid, uuid, uuid, integer, text, text, text) owner to postgres;
alter function public.finalize_requisition_parse(uuid, uuid, uuid, uuid, uuid, integer, uuid, text, jsonb, jsonb, text, text) owner to postgres;
alter function public.fail_requisition_parse_egress(uuid, uuid, uuid, uuid, uuid, integer, uuid, text, text, text) owner to postgres;
alter function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb) owner to postgres;
alter function public.fail_aria_job(uuid, uuid, text, boolean) owner to postgres;
alter function public.requeue_dead_aria_job(uuid) owner to postgres;
alter function public.reap_expired_aria_job_leases(integer) owner to postgres;

revoke all on function public.authorize_requisition_parse_job_v2(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.authorize_requisition_parse_job_v2(uuid, uuid, uuid, uuid)
  to service_role;

revoke all on function public.begin_requisition_parse_egress(uuid, uuid, uuid, uuid, uuid, integer, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.begin_requisition_parse_egress(uuid, uuid, uuid, uuid, uuid, integer, text, text, text)
  to service_role;

revoke all on function public.finalize_requisition_parse(uuid, uuid, uuid, uuid, uuid, integer, uuid, text, jsonb, jsonb, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.finalize_requisition_parse(uuid, uuid, uuid, uuid, uuid, integer, uuid, text, jsonb, jsonb, text, text)
  to service_role;

revoke all on function public.fail_requisition_parse_egress(uuid, uuid, uuid, uuid, uuid, integer, uuid, text, text, text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.fail_requisition_parse_egress(uuid, uuid, uuid, uuid, uuid, integer, uuid, text, text, text)
  to service_role;

revoke all on function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.complete_aria_job(uuid, uuid, text, jsonb, jsonb)
  to service_role;

revoke all on function public.fail_aria_job(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.fail_aria_job(uuid, uuid, text, boolean)
  to service_role;

revoke all on function public.requeue_dead_aria_job(uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.requeue_dead_aria_job(uuid)
  to authenticated;

-- 0049's raw-input helper predates lease and execution-claim fencing. The
-- parser now receives content only from authorize_requisition_parse_job_v2, so
-- no application role may call this legacy read path directly.
revoke all on function public.get_requisition_input(uuid, uuid)
  from public, anon, authenticated, service_role, authenticator;

revoke all on function public.reap_expired_aria_job_leases(integer)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.reap_expired_aria_job_leases(integer)
  to service_role;
