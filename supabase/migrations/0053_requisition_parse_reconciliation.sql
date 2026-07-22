-- 0053_requisition_parse_reconciliation.sql
--
-- Adds the smallest safe human reconciliation surface for a
-- requisition_parse execution whose provider outcome is unknown.
--
-- This migration deliberately supports only `abandon`: an administrator can
-- record that an investigated ambiguous attempt will not be retried. It does
-- not complete the parse, requeue the job, change the execution claim, or
-- refund any quota. Those actions are unsafe without provider-correlated
-- idempotency/status evidence or a durable response artifact.
--
-- The raw claim_token remains private. Admin inspection returns a SHA-256
-- fingerprint that commits to the exact workspace, job, claim token, fence,
-- provider attempt, requisition, input, job payload, provider, and model. The
-- abandon RPC requires that fingerprint plus the operator-visible bindings,
-- locks job then claim in the established order, and re-proves that the job
-- is still dead and the claim is still ambiguous before writing one
-- append-only receipt.
--
-- Run after 0052_campaign_create_authority.sql. It depends only on authority
-- introduced through 0051_requisition_parse_execution_claim.sql.

-- Every numbered migration runs inside one release transaction in production.
-- Fail fast instead of waiting indefinitely for the brief metadata locks used
-- below; no operation in this migration may scan or index the hot aria_jobs table.
set lock_timeout = '5s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Private fingerprint helper. This avoids exposing claim_token while still
-- making every operator action stale-safe and exactly claim-bound.
-- ---------------------------------------------------------------------------
create or replace function public.requisition_parse_claim_fingerprint(
  p_workspace_id uuid,
  p_job_id uuid,
  p_claim_token uuid,
  p_fence_version integer,
  p_egress_attempt_id uuid,
  p_lease_id uuid,
  p_requisition_id uuid,
  p_input_sha256 text,
  p_payload_sha256 text,
  p_provider text,
  p_model text,
  p_claim_state text
) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public, pg_temp
as $$
  select encode(
    sha256(convert_to(jsonb_build_array(
      p_workspace_id::text,
      p_job_id::text,
      p_claim_token::text,
      p_fence_version,
      p_egress_attempt_id::text,
      p_lease_id::text,
      p_requisition_id::text,
      p_input_sha256,
      p_payload_sha256,
      p_provider,
      p_model,
      p_claim_state
    )::text, 'UTF8')),
    'hex'
  );
$$;

alter function public.requisition_parse_claim_fingerprint(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text, text, text, text
) owner to postgres;
revoke all on function public.requisition_parse_claim_fingerprint(
  uuid, uuid, uuid, integer, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role, authenticator;

-- Database-native linkage for receipts created by any owner-level path. The
-- generated value includes claim state, so once a receipt references an
-- ambiguous claim, changing that claim to any other state is rejected by the
-- foreign key rather than relying only on RPC discipline.
alter table public.requisition_parse_execution_claims
  add column if not exists reconciliation_fingerprint text
  generated always as (
    public.requisition_parse_claim_fingerprint(
      workspace_id,
      job_id,
      claim_token,
      fence_version,
      egress_attempt_id,
      lease_id,
      requisition_id,
      input_sha256,
      payload_sha256,
      provider,
      model,
      state
    )
  ) stored;

create unique index if not exists requisition_parse_claim_reconciliation_identity_uniq
  on public.requisition_parse_execution_claims
  (workspace_id, job_id, reconciliation_fingerprint);

-- ---------------------------------------------------------------------------
-- Append-only administrative decision receipt. No raw requisition content or
-- provider response is stored here. Evidence stays in the external case
-- system and is represented only by a case reference and SHA-256 digest.
-- ---------------------------------------------------------------------------
create table if not exists public.requisition_parse_reconciliation_receipts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  request_id uuid not null,
  job_id uuid not null,
  job_kind text not null check (job_kind = 'requisition_parse'),
  claim_token uuid not null,
  claim_fingerprint text not null check (claim_fingerprint ~ '^[0-9a-f]{64}$'),
  fence_version integer not null check (fence_version >= 1),
  egress_attempt_id uuid not null,
  lease_id uuid not null,
  requisition_id uuid not null,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null check (char_length(provider) between 1 and 100),
  model text not null check (char_length(model) between 1 and 200),
  action text not null default 'abandon' check (action = 'abandon'),
  case_reference text not null
    check (case_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  job_status text not null check (job_status = 'dead'),
  claim_state text not null check (claim_state = 'ambiguous'),
  ambiguous_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint requisition_parse_reconciliation_request_uniq
    unique (workspace_id, request_id),
  constraint requisition_parse_reconciliation_job_uniq unique (job_id),
  constraint requisition_parse_reconciliation_actor_fk
    foreign key (workspace_id, actor_id)
    references public.profiles(workspace_id, id) on delete restrict,
  constraint requisition_parse_reconciliation_requisition_fk
    foreign key (workspace_id, requisition_id)
    references public.requisitions(workspace_id, id) on delete restrict,
  constraint requisition_parse_reconciliation_fingerprint_exact check (
    claim_fingerprint = public.requisition_parse_claim_fingerprint(
      workspace_id,
      job_id,
      claim_token,
      fence_version,
      egress_attempt_id,
      lease_id,
      requisition_id,
      input_sha256,
      payload_sha256,
      provider,
      model,
      claim_state
    )
  ),
  constraint requisition_parse_reconciliation_job_identity_fk
    foreign key (job_id)
    references public.aria_jobs(id)
    on update restrict on delete restrict,
  constraint requisition_parse_reconciliation_claim_identity_fk
    foreign key (workspace_id, job_id, claim_fingerprint)
    references public.requisition_parse_execution_claims(
      workspace_id, job_id, reconciliation_fingerprint
    ) on update restrict on delete restrict
);

-- The receipt table is empty when it is created, but aria_jobs is a hot shared
-- queue. Validate the exact terminal job binding at insert time instead of
-- adding a blocking composite unique index to aria_jobs. The row lock also
-- serializes a direct owner insert against a concurrent job mutation.
create or replace function public.validate_requisition_parse_reconciliation_job()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  job_row public.aria_jobs%rowtype;
  job_found boolean;
  exact_payload jsonb;
  exact_payload_sha256 text;
begin
  select * into job_row
    from public.aria_jobs
   where id = new.job_id
   for update;
  job_found := found;

  exact_payload := jsonb_build_object('requisition_id', new.requisition_id::text);
  if job_found then
    exact_payload_sha256 := encode(
      sha256(convert_to(job_row.payload::text, 'UTF8')),
      'hex'
    );
  end if;

  if not job_found
     or job_row.workspace_id is distinct from new.workspace_id
     or job_row.kind <> 'requisition_parse'
     or new.job_kind <> job_row.kind
     or job_row.status <> 'dead'
     or new.job_status <> job_row.status
     or job_row.lease_id is not null
     or job_row.lease_expires_at is not null
     or job_row.result_sha256 is not null
     or job_row.payload is distinct from exact_payload
     or job_row.payload_sha256 is distinct from exact_payload_sha256
     or new.payload_sha256 is distinct from job_row.payload_sha256 then
    raise exception 'requisition parse reconciliation job binding is invalid'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

alter function public.validate_requisition_parse_reconciliation_job()
  owner to postgres;
revoke all on function public.validate_requisition_parse_reconciliation_job()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists requisition_parse_reconciliation_receipts_validate_job
  on public.requisition_parse_reconciliation_receipts;
create trigger requisition_parse_reconciliation_receipts_validate_job
  before insert on public.requisition_parse_reconciliation_receipts
  for each row execute function public.validate_requisition_parse_reconciliation_job();

-- Once a receipt exists, keep every job field committed by that receipt stable.
-- The simple foreign key above already protects id changes and deletion. This
-- narrow guard leaves operational metadata such as last_error and updated_at
-- mutable while preserving terminal identity and retry safety.
create or replace function public.reject_reconciled_requisition_parse_job_identity_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if (
       new.workspace_id is distinct from old.workspace_id
       or new.kind is distinct from old.kind
       or new.status is distinct from old.status
       or new.payload is distinct from old.payload
       or new.payload_sha256 is distinct from old.payload_sha256
       or new.lease_id is distinct from old.lease_id
       or new.lease_expires_at is distinct from old.lease_expires_at
       or new.result_sha256 is distinct from old.result_sha256
     )
     and exists (
       select 1
         from public.requisition_parse_reconciliation_receipts receipt
        where receipt.job_id = old.id
     ) then
    raise exception 'reconciled requisition parse job identity is immutable'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

alter function public.reject_reconciled_requisition_parse_job_identity_mutation()
  owner to postgres;
revoke all on function public.reject_reconciled_requisition_parse_job_identity_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists aria_jobs_reconciled_requisition_parse_guard
  on public.aria_jobs;
create trigger aria_jobs_reconciled_requisition_parse_guard
  before update of workspace_id, kind, status, payload, payload_sha256,
    lease_id, lease_expires_at, result_sha256
  on public.aria_jobs
  for each row
  when (
    old.kind = 'requisition_parse'
    and old.status = 'dead'
    and (
      new.workspace_id is distinct from old.workspace_id
      or new.kind is distinct from old.kind
      or new.status is distinct from old.status
      or new.payload is distinct from old.payload
      or new.payload_sha256 is distinct from old.payload_sha256
      or new.lease_id is distinct from old.lease_id
      or new.lease_expires_at is distinct from old.lease_expires_at
      or new.result_sha256 is distinct from old.result_sha256
    )
  )
  execute function public.reject_reconciled_requisition_parse_job_identity_mutation();

create index if not exists requisition_parse_reconciliation_workspace_recorded_idx
  on public.requisition_parse_reconciliation_receipts
  (workspace_id, recorded_at, id);
create index if not exists requisition_parse_ambiguous_admin_page_idx
  on public.requisition_parse_execution_claims
  (workspace_id, ambiguous_at, job_id)
  where state = 'ambiguous';

alter table public.requisition_parse_reconciliation_receipts enable row level security;
alter table public.requisition_parse_reconciliation_receipts force row level security;
revoke all on public.requisition_parse_reconciliation_receipts
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.requisition_parse_reconciliation_receipts_id_seq
  from public, anon, authenticated, service_role, authenticator;
drop policy if exists requisition_parse_reconciliation_receipts_owner_access
  on public.requisition_parse_reconciliation_receipts;
create policy requisition_parse_reconciliation_receipts_owner_access
  on public.requisition_parse_reconciliation_receipts
  for all to postgres, supabase_admin using (true) with check (true);

create or replace function public.reject_requisition_parse_reconciliation_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'requisition parse reconciliation receipts are append-only'
    using errcode = '42501';
end;
$$;

alter function public.reject_requisition_parse_reconciliation_receipt_mutation()
  owner to postgres;
revoke all on function public.reject_requisition_parse_reconciliation_receipt_mutation()
  from public, anon, authenticated, service_role, authenticator;
drop trigger if exists requisition_parse_reconciliation_receipts_append_only
  on public.requisition_parse_reconciliation_receipts;
create trigger requisition_parse_reconciliation_receipts_append_only
  before update or delete on public.requisition_parse_reconciliation_receipts
  for each row execute function public.reject_requisition_parse_reconciliation_receipt_mutation();

-- ---------------------------------------------------------------------------
-- Admin-only keyset inspection. The page contains no raw input, claim token,
-- provider response, or evidence body. Stable cursor fields are immutable once
-- a claim enters the ambiguous terminal state.
-- ---------------------------------------------------------------------------
create or replace function public.list_ambiguous_requisition_parse_attempts(
  p_after_ambiguous_at timestamptz default null,
  p_after_job_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  page_items jsonb;
  has_more boolean;
  last_item jsonb;
  next_cursor jsonb := null;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = auth.uid()
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 100
     or ((p_after_ambiguous_at is null) <> (p_after_job_id is null)) then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  with candidates as (
    select
      claim.job_id,
      claim.requisition_id,
      claim.fence_version,
      claim.egress_attempt_id,
      claim.lease_id,
      claim.input_sha256,
      claim.payload_sha256,
      claim.provider,
      claim.model,
      claim.ambiguous_at,
      claim.ambiguous_reason,
      job.status as job_status,
      receipt.id as reconciliation_receipt_id,
      receipt.case_reference,
      receipt.evidence_sha256,
      receipt.recorded_at,
      public.requisition_parse_claim_fingerprint(
        claim.workspace_id,
        claim.job_id,
        claim.claim_token,
        claim.fence_version,
        claim.egress_attempt_id,
        claim.lease_id,
        claim.requisition_id,
        claim.input_sha256,
        claim.payload_sha256,
        claim.provider,
        claim.model,
        claim.state
      ) as claim_fingerprint
      from public.requisition_parse_execution_claims claim
      join public.aria_jobs job on job.id = claim.job_id
      left join public.requisition_parse_reconciliation_receipts receipt
        on receipt.job_id = claim.job_id
     where claim.workspace_id = caller_workspace
       and claim.state = 'ambiguous'
       and (
         p_after_ambiguous_at is null
         or (claim.ambiguous_at, claim.job_id) >
            (p_after_ambiguous_at, p_after_job_id)
       )
     order by claim.ambiguous_at, claim.job_id
     limit p_limit + 1
  ), numbered as (
    select candidate.*,
           row_number() over (order by candidate.ambiguous_at, candidate.job_id) as page_row
      from candidates candidate
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'workspace_id', caller_workspace,
          'job_id', page.job_id,
          'requisition_id', page.requisition_id,
          'claim_fingerprint', page.claim_fingerprint,
          'fence_version', page.fence_version,
          'egress_attempt_id', page.egress_attempt_id,
          'input_sha256', page.input_sha256,
          'provider', page.provider,
          'model', page.model,
          'ambiguous_at', page.ambiguous_at,
          'ambiguous_reason', page.ambiguous_reason,
          'job_status', page.job_status,
          'reconciled', page.reconciliation_receipt_id is not null,
          'reconciliation_receipt_id', page.reconciliation_receipt_id,
          'case_reference', page.case_reference,
          'evidence_sha256', page.evidence_sha256,
          'recorded_at', page.recorded_at
        ) order by page.ambiguous_at, page.job_id
      ) filter (where page.page_row <= p_limit),
      '[]'::jsonb
    ),
    count(*) > p_limit
    into page_items, has_more
    from numbered page;

  if has_more and jsonb_array_length(page_items) > 0 then
    last_item := page_items -> (jsonb_array_length(page_items) - 1);
    next_cursor := jsonb_build_object(
      'ambiguous_at', last_item->'ambiguous_at',
      'job_id', last_item->'job_id'
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'items', page_items,
    'next_cursor', next_cursor
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin-only, idempotent abandon receipt. This function has no UPDATE/DELETE
-- statements by design. The job and claim locks exist only to re-prove exact
-- terminal authority and serialize concurrent decisions for one job.
-- ---------------------------------------------------------------------------
create or replace function public.abandon_ambiguous_requisition_parse_attempt(
  p_workspace_id uuid,
  p_job_id uuid,
  p_claim_fingerprint text,
  p_fence_version integer,
  p_egress_attempt_id uuid,
  p_requisition_id uuid,
  p_input_sha256 text,
  p_provider text,
  p_model text,
  p_case_reference text,
  p_evidence_sha256 text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  caller_workspace uuid;
  actor uuid;
  job_row public.aria_jobs%rowtype;
  claim_row public.requisition_parse_execution_claims%rowtype;
  receipt_row public.requisition_parse_reconciliation_receipts%rowtype;
  exact_fingerprint text;
  new_receipt_id bigint;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  actor := auth.uid();
  caller_workspace := public.current_workspace_id();
  if caller_workspace is null then
    raise exception 'workspace required' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.profiles profile
     where profile.workspace_id = caller_workspace
       and profile.id = actor
       and profile.role = 'admin'
     for key share
  ) then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;
  if p_workspace_id is distinct from caller_workspace then
    raise exception 'workspace mismatch' using errcode = '42501';
  end if;

  if p_job_id is null
     or p_claim_fingerprint is null
     or p_claim_fingerprint !~ '^[0-9a-f]{64}$'
     or p_fence_version is null or p_fence_version < 1
     or p_egress_attempt_id is null
     or p_requisition_id is null
     or p_input_sha256 is null or p_input_sha256 !~ '^[0-9a-f]{64}$'
     or p_provider is null or char_length(p_provider) not between 1 and 100
     or p_model is null or char_length(p_model) not between 1 and 200
     or p_case_reference is null
     or p_case_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,119}$'
     or p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_id is null then
    return jsonb_build_object('status', 'invalid_request');
  end if;

  -- The request key serializes idempotency even if it is accidentally reused
  -- for two different jobs. Job row remains the first relational row lock,
  -- preserving the 0051 job-then-claim lock order.
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_request_id::text, 0)
  );

  select * into job_row
    from public.aria_jobs
   where id = p_job_id
     and workspace_id = p_workspace_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if job_row.kind <> 'requisition_parse'
     or job_row.status <> 'dead'
     or job_row.lease_id is not null
     or job_row.lease_expires_at is not null
     or job_row.payload->>'requisition_id' <> p_requisition_id::text then
    return jsonb_build_object('status', 'not_ambiguous_terminal');
  end if;

  select * into claim_row
    from public.requisition_parse_execution_claims
   where job_id = p_job_id
     and workspace_id = p_workspace_id
   for update;
  if not found or claim_row.state <> 'ambiguous' then
    return jsonb_build_object('status', 'not_ambiguous_terminal');
  end if;

  exact_fingerprint := public.requisition_parse_claim_fingerprint(
    claim_row.workspace_id,
    claim_row.job_id,
    claim_row.claim_token,
    claim_row.fence_version,
    claim_row.egress_attempt_id,
    claim_row.lease_id,
    claim_row.requisition_id,
    claim_row.input_sha256,
    claim_row.payload_sha256,
    claim_row.provider,
    claim_row.model,
    claim_row.state
  );

  if claim_row.job_kind <> job_row.kind
     or claim_row.payload_sha256 <> job_row.payload_sha256
     or claim_row.fence_version <> p_fence_version
     or claim_row.egress_attempt_id <> p_egress_attempt_id
     or claim_row.requisition_id <> p_requisition_id
     or claim_row.input_sha256 <> p_input_sha256
     or claim_row.provider <> p_provider
     or claim_row.model <> p_model
     or exact_fingerprint <> p_claim_fingerprint then
    return jsonb_build_object('status', 'binding_mismatch');
  end if;

  select * into receipt_row
    from public.requisition_parse_reconciliation_receipts receipt
   where receipt.workspace_id = p_workspace_id
     and receipt.request_id = p_request_id;
  if found then
    if receipt_row.job_id = p_job_id
       and receipt_row.claim_token = claim_row.claim_token
       and receipt_row.claim_fingerprint = exact_fingerprint
       and receipt_row.fence_version = p_fence_version
       and receipt_row.egress_attempt_id = p_egress_attempt_id
       and receipt_row.lease_id = claim_row.lease_id
       and receipt_row.requisition_id = p_requisition_id
       and receipt_row.input_sha256 = p_input_sha256
       and receipt_row.payload_sha256 = claim_row.payload_sha256
       and receipt_row.provider = p_provider
       and receipt_row.model = p_model
       and receipt_row.case_reference = p_case_reference
       and receipt_row.evidence_sha256 = p_evidence_sha256 then
      return jsonb_build_object(
        'status', 'no_op_replay',
        'receipt_id', receipt_row.id
      );
    end if;
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  select * into receipt_row
    from public.requisition_parse_reconciliation_receipts receipt
   where receipt.job_id = p_job_id;
  if found then
    return jsonb_build_object(
      'status', 'already_abandoned',
      'receipt_id', receipt_row.id
    );
  end if;

  insert into public.requisition_parse_reconciliation_receipts (
    workspace_id,
    request_id,
    job_id,
    job_kind,
    claim_token,
    claim_fingerprint,
    fence_version,
    egress_attempt_id,
    lease_id,
    requisition_id,
    input_sha256,
    payload_sha256,
    provider,
    model,
    action,
    case_reference,
    evidence_sha256,
    actor_id,
    job_status,
    claim_state,
    ambiguous_at
  ) values (
    p_workspace_id,
    p_request_id,
    p_job_id,
    'requisition_parse',
    claim_row.claim_token,
    exact_fingerprint,
    p_fence_version,
    p_egress_attempt_id,
    claim_row.lease_id,
    p_requisition_id,
    p_input_sha256,
    claim_row.payload_sha256,
    p_provider,
    p_model,
    'abandon',
    p_case_reference,
    p_evidence_sha256,
    actor,
    'dead',
    'ambiguous',
    claim_row.ambiguous_at
  ) returning id into new_receipt_id;

  return jsonb_build_object(
    'status', 'abandon_recorded',
    'receipt_id', new_receipt_id
  );
end;
$$;

alter function public.list_ambiguous_requisition_parse_attempts(
  timestamptz, uuid, integer
) owner to postgres;
alter function public.abandon_ambiguous_requisition_parse_attempt(
  uuid, uuid, text, integer, uuid, uuid, text, text, text, text, text, uuid
) owner to postgres;

revoke all on function public.list_ambiguous_requisition_parse_attempts(
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_ambiguous_requisition_parse_attempts(
  timestamptz, uuid, integer
) to authenticated;

revoke all on function public.abandon_ambiguous_requisition_parse_attempt(
  uuid, uuid, text, integer, uuid, uuid, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.abandon_ambiguous_requisition_parse_attempt(
  uuid, uuid, text, integer, uuid, uuid, text, text, text, text, text, uuid
) to authenticated;

reset lock_timeout;
reset statement_timeout;
