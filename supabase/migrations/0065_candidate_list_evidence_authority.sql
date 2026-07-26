-- 0065_candidate_list_evidence_authority.sql
--
-- Replace the best-effort public.candidates mirror as list-admission evidence
-- with exact provider receipts or an append-only governed manual lifecycle.
-- Canonical workspace_state remains mandatory so governed erasure can always
-- locate every newly admitted candidate.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

-- 0064 accepted campaign text that the governed erasure RPC cannot address.
-- Refuse atomically before changing the schema if incompatible durable rows
-- exist; never silently rewrite candidate identities.
do $candidate_list_0065_preflight$
begin
  -- Freeze both canonical source state and every 0064 candidate-bearing table
  -- before validation. Without transaction-held locks, an old RPC could write
  -- a newly unerasable row between the preflight and the later FK alteration.
  -- This must be the first conflicting lock. Governed erasure takes a row lock
  -- in workspace_state before deleting receipts and later updates that same
  -- table. EXCLUSIVE drains any in-flight writer before this migration holds a
  -- downstream evidence-table lock, while ordinary AccessShare readers remain
  -- available during the bounded preflight.
  lock table public.workspace_state in exclusive mode;
  lock table public.candidates in share mode;
  -- Every 0064 create/add/replay path touches receipts before it writes a list
  -- or member. Gate at that earliest shared table so in-flight transactions
  -- drain before this migration takes any later exclusive lock. Taking even a
  -- weaker candidate_lists lock first would invert create_candidate_list's
  -- receipts-then-list order and can deadlock an in-flight create.
  lock table public.candidate_list_operation_receipts in access exclusive mode;
  lock table public.candidate_lists in access exclusive mode;
  lock table public.candidate_list_members in access exclusive mode;
  lock table public.candidate_contact_attestations in access exclusive mode;

  if exists (
    select 1
      from public.candidate_contact_attestations attestation
     where attestation.campaign_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ) then
    raise exception
      '0065 preflight: candidate_contact_attestations contains a campaign id outside governed erasure grammar'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.candidate_list_members member
     where member.campaign_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ) then
    raise exception
      '0065 preflight: candidate_list_members contains a campaign id outside governed erasure grammar'
      using errcode = '23514';
  end if;

  drop table if exists pg_temp.candidate_list_0065_canonical;
  create temporary table candidate_list_0065_canonical
    on commit drop
  as
  with authority_workspaces as materialized (
    select attestation.workspace_id
      from public.candidate_contact_attestations attestation
    union
    select member.workspace_id
      from public.candidate_list_members member
    union
    select receipt.workspace_id
      from public.candidate_list_operation_receipts receipt
     where receipt.operation_kind = 'add_member'
  ),
  receipt_workspaces as materialized (
    select distinct receipt.workspace_id
      from public.candidate_list_operation_receipts receipt
     where receipt.operation_kind = 'add_member'
  ),
  grouped_candidates as materialized (
    select
      workspace.workspace_id,
      candidate.value ->> 'campaignId' as campaign_id,
      candidate.value ->> 'id' as candidate_id,
      count(*) as identity_count
      from authority_workspaces authority_workspace
      join public.workspace_state workspace
        on workspace.workspace_id = authority_workspace.workspace_id
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(workspace.state -> 'candidates') = 'array'
            then workspace.state -> 'candidates'
          else '[]'::jsonb
        end
      ) candidate(value)
     where candidate.value ->> 'campaignId'
       ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
       and candidate.value ->> 'id'
       ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     group by
       workspace.workspace_id,
       candidate.value ->> 'campaignId',
       candidate.value ->> 'id'
  )
  select
    candidate.workspace_id,
    candidate.campaign_id,
    candidate.candidate_id,
    candidate.identity_count,
    case
      when receipt_workspace.workspace_id is not null
           and secret.workspace_id is not null then
        public.sourcing_authority_hmac(
          candidate.workspace_id,
          jsonb_build_array(
            'candidate_list_subject_v1',
            candidate.campaign_id,
            candidate.candidate_id
          )::text
        )
      else null
    end as subject_hmac
    from grouped_candidates candidate
    left join receipt_workspaces receipt_workspace
      on receipt_workspace.workspace_id = candidate.workspace_id
    left join public.sourcing_learning_secrets secret
      on secret.workspace_id = candidate.workspace_id;

  create index candidate_list_0065_canonical_identity_idx
    on candidate_list_0065_canonical (
      workspace_id, campaign_id, candidate_id
    );
  create index candidate_list_0065_canonical_subject_idx
    on candidate_list_0065_canonical (workspace_id, subject_hmac)
    where subject_hmac is not null;

  if exists (
    select 1
      from public.candidate_contact_attestations attestation
      left join candidate_list_0065_canonical candidate
        on candidate.workspace_id = attestation.workspace_id
       and candidate.campaign_id = attestation.campaign_id
       and candidate.candidate_id = attestation.candidate_id
     where candidate.identity_count is distinct from 1
  ) then
    raise exception
      '0065 preflight: every legacy attestation must have exactly one canonical workspace candidate'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.candidate_list_members member
      left join candidate_list_0065_canonical candidate
        on candidate.workspace_id = member.workspace_id
       and candidate.campaign_id = member.campaign_id
       and candidate.candidate_id = member.candidate_id
     where candidate.identity_count is distinct from 1
  ) then
    raise exception
      '0065 preflight: every legacy member must have exactly one canonical workspace candidate'
      using errcode = '23514';
  end if;

  -- 0064 stored candidate identity only as a keyed subject hash in operation
  -- receipts. Reconcile each one against canonical workspace candidates while
  -- the original authority is intact; an unresolvable or duplicate subject
  -- would otherwise become impossible to erase after the mirror FKs are gone.
  if exists (
    select 1
      from public.candidate_list_operation_receipts receipt
      left join lateral (
        select coalesce(sum(candidate.identity_count), 0) as match_count
          from candidate_list_0065_canonical candidate
         where candidate.workspace_id = receipt.workspace_id
           and candidate.subject_hmac = receipt.candidate_subject_hmac
      ) subject on true
     where receipt.operation_kind = 'add_member'
       and subject.match_count is distinct from 1
  ) then
    raise exception
      '0065 preflight: every legacy candidate receipt must resolve to exactly one canonical workspace candidate'
      using errcode = '23514';
  end if;

  drop table pg_temp.candidate_list_0065_canonical;
end
$candidate_list_0065_preflight$;

-- The mirror is display-only and may be absent even after a successful
-- workspace_state write. Remove only the two foreign keys that made it an
-- admission/deletion authority. Names are the exact PostgreSQL 17 objects
-- created by 0064; never wildcard-drop a later independent candidate FK.
alter table public.candidate_contact_attestations
  drop constraint if exists
    candidate_contact_attestation_workspace_id_campaign_id_can_fkey;
alter table public.candidate_list_members
  drop constraint if exists
    candidate_list_members_workspace_id_campaign_id_candidate__fkey;

alter table public.candidate_contact_attestations
  add column if not exists authority_version text not null default 'legacy-v1',
  add column if not exists lawful_basis_code text,
  add column if not exists observed_at timestamptz,
  add column if not exists supersedes_id bigint;

alter table public.candidate_contact_attestations
  drop constraint if exists candidate_contact_attestations_campaign_id_check,
  drop constraint if exists candidate_contact_attestations_campaign_erasable_check,
  drop constraint if exists candidate_contact_attestations_value_code_check,
  drop constraint if exists candidate_contact_attestations_lifecycle_check,
  drop constraint if exists candidate_contact_attestations_supersedes_order_check;

alter table public.candidate_contact_attestations
  add constraint candidate_contact_attestations_campaign_erasable_check check (
    campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  add constraint candidate_contact_attestations_value_code_check check (
    value_code in ('operator_verified', 'operator_revoked')
  ),
  add constraint candidate_contact_attestations_lifecycle_check check (
    (
      authority_version = 'legacy-v1'
      and value_code = 'operator_verified'
      and lawful_basis_code is null
      and observed_at is null
      and supersedes_id is null
    )
    or (
      authority_version = 'governed-v1'
      and value_code in ('operator_verified', 'operator_revoked')
      and lawful_basis_code in ('consent', 'legitimate_interest')
      and observed_at is not null
      and (supersedes_id is not null or value_code = 'operator_verified')
    )
  ),
  add constraint candidate_contact_attestations_supersedes_order_check check (
    supersedes_id is null or supersedes_id < id
  );

create unique index if not exists candidate_contact_attestations_identity_idx
  on public.candidate_contact_attestations (
    workspace_id, campaign_id, candidate_id, id
  );

do $candidate_list_add_supersedes_fk$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid =
       'public.candidate_contact_attestations'::regclass
       and constraint_row.conname =
         'candidate_contact_attestations_supersedes_fkey'
  ) then
    alter table public.candidate_contact_attestations
      add constraint candidate_contact_attestations_supersedes_fkey
      foreign key (
        workspace_id, campaign_id, candidate_id, supersedes_id
      ) references public.candidate_contact_attestations(
        workspace_id, campaign_id, candidate_id, id
      ) on delete cascade;
  end if;
end
$candidate_list_add_supersedes_fk$;

create unique index if not exists candidate_contact_attestations_governed_root_idx
  on public.candidate_contact_attestations (
    workspace_id, campaign_id, candidate_id
  )
  where authority_version = 'governed-v1' and supersedes_id is null;

create unique index if not exists candidate_contact_attestations_governed_child_idx
  on public.candidate_contact_attestations (
    workspace_id, campaign_id, candidate_id, supersedes_id
  )
  where authority_version = 'governed-v1' and supersedes_id is not null;

create or replace function public.validate_candidate_contact_attestation_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_predecessor public.candidate_contact_attestations%rowtype;
begin
  if new.authority_version <> 'governed-v1' then
    return new;
  end if;

  if new.supersedes_id is null then
    if new.value_code <> 'operator_verified' then
      raise exception 'governed manual evidence must begin with verification'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select predecessor.*
    into v_predecessor
    from public.candidate_contact_attestations predecessor
   where predecessor.workspace_id = new.workspace_id
     and predecessor.campaign_id = new.campaign_id
     and predecessor.candidate_id = new.candidate_id
     and predecessor.id = new.supersedes_id
   for update;

  if not found
     or v_predecessor.authority_version <> 'governed-v1'
     or exists (
       select 1
         from public.candidate_contact_attestations successor
        where successor.workspace_id = new.workspace_id
          and successor.campaign_id = new.campaign_id
          and successor.candidate_id = new.candidate_id
          and successor.authority_version = 'governed-v1'
          and successor.supersedes_id = new.supersedes_id
     ) then
    raise exception 'governed manual evidence predecessor is not current'
      using errcode = '23514';
  end if;

  if new.value_code = 'operator_revoked'
     and v_predecessor.value_code <> 'operator_verified' then
    raise exception 'governed manual revocation requires verified predecessor'
      using errcode = '23514';
  end if;

  if new.value_code = 'operator_revoked'
     and (
       new.lawful_basis_code is distinct from v_predecessor.lawful_basis_code
       or new.observed_at is distinct from v_predecessor.observed_at
     ) then
    raise exception 'governed manual revocation must preserve predecessor evidence context'
      using errcode = '23514';
  end if;

  if new.value_code = 'operator_verified'
     and new.observed_at <= v_predecessor.observed_at then
    raise exception 'governed manual verification must be newer than predecessor'
      using errcode = '23514';
  end if;

  return new;
end
$$;

alter function public.validate_candidate_contact_attestation_lifecycle()
  owner to postgres;
revoke all on function public.validate_candidate_contact_attestation_lifecycle()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_contact_attestations_lifecycle_guard
  on public.candidate_contact_attestations;
create trigger candidate_contact_attestations_lifecycle_guard
  before insert on public.candidate_contact_attestations
  for each row execute function
    public.validate_candidate_contact_attestation_lifecycle();

alter table public.candidate_list_members
  add column if not exists evidence_provider_attempt_id uuid,
  add column if not exists evidence_expires_at timestamptz;

alter table public.candidate_list_members
  alter column evidence_attestation_id drop not null,
  drop constraint if exists candidate_list_members_campaign_id_check,
  drop constraint if exists candidate_list_members_campaign_erasable_check,
  drop constraint if exists candidate_list_members_evidence_kind_check,
  drop constraint if exists candidate_list_members_evidence_pointer_check;

alter table public.candidate_list_members
  add constraint candidate_list_members_campaign_erasable_check check (
    campaign_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
  ),
  add constraint candidate_list_members_evidence_kind_check check (
    evidence_kind in (
      'manual_attestation', 'github_provider', 'tavily_provider'
    )
  ),
  add constraint candidate_list_members_evidence_pointer_check check (
    (
      evidence_kind = 'manual_attestation'
      and evidence_attestation_id is not null
      and evidence_provider_attempt_id is null
      and evidence_expires_at is null
    )
    or (
      evidence_kind = 'github_provider'
      and evidence_attestation_id is null
      and evidence_provider_attempt_id is not null
      and evidence_expires_at is null
    )
    or (
      evidence_kind = 'tavily_provider'
      and evidence_attestation_id is null
      and evidence_provider_attempt_id is not null
      and evidence_expires_at is not null
    )
  );

-- Replace only the exact 0064/0065-owned receipt checks. Request/result
-- integrity checks and any later independent control remain untouched.
alter table public.candidate_list_operation_receipts
  drop constraint if exists candidate_list_operation_receipts_operation_kind_check,
  drop constraint if exists candidate_list_operation_receipts_check,
  drop constraint if exists candidate_list_operation_receipts_subject_check;

alter table public.candidate_list_operation_receipts
  add constraint candidate_list_operation_receipts_operation_kind_check
    check (operation_kind in ('create_list', 'add_member', 'attest_manual')),
  add constraint candidate_list_operation_receipts_subject_check check (
    (operation_kind = 'create_list' and candidate_subject_hmac is null)
    or (
      operation_kind in ('add_member', 'attest_manual')
      and candidate_subject_hmac is not null
    )
  );

-- 0064 allowed every nested trigger delete, which meant an unrelated owner
-- trigger could erase append-only evidence. In 0065 only the governed erasure
-- path (bound to one exact erasure request) and an enclosing workspace deletion
-- may cascade evidence removal.
create or replace function public.reject_candidate_list_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_erasure_request_id text;
  v_erasure_authorized boolean := false;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    if not exists (
      select 1
        from public.workspaces workspace
       where workspace.id = old.workspace_id
    ) then
      return old;
    end if;

    v_erasure_request_id := current_setting(
      'aria.candidate_list_erasure_request_id', true
    );

    if current_setting('aria.candidate_list_erasure_cleanup', true) = 'on'
       and coalesce(v_erasure_request_id, '') <> '' then
      if tg_table_name = 'candidate_contact_attestations' then
        select exists (
          select 1
            from public.candidate_erasure_requests request
           where request.id::text = v_erasure_request_id
             and request.workspace_id = old.workspace_id
             and request.candidate_id = old.candidate_id
             and request.status <> 'blocked_legal_hold'
        ) into v_erasure_authorized;
      elsif tg_table_name = 'candidate_list_operation_receipts'
            and old.candidate_subject_hmac is not null then
        select exists (
          select 1
            from public.candidate_erasure_requests request
            join public.sourcing_learning_secrets secret
              on secret.workspace_id = request.workspace_id
            join public.workspace_state workspace
              on workspace.workspace_id = request.workspace_id
            cross join lateral jsonb_array_elements(
              case
                when jsonb_typeof(workspace.state -> 'candidates') = 'array'
                  then workspace.state -> 'candidates'
                else '[]'::jsonb
              end
            ) candidate(value)
           where request.id::text = v_erasure_request_id
             and request.workspace_id = old.workspace_id
             and request.status <> 'blocked_legal_hold'
             and candidate.value ->> 'id' = request.candidate_id
             and candidate.value ->> 'campaignId'
               ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
             and old.candidate_subject_hmac = public.sourcing_authority_hmac(
               request.workspace_id,
               jsonb_build_array(
                 'candidate_list_subject_v1',
                 candidate.value ->> 'campaignId',
                 request.candidate_id
               )::text
             )
        ) into v_erasure_authorized;
      end if;
    end if;

    if v_erasure_authorized then
      return old;
    end if;
  end if;

  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$$;

alter function public.reject_candidate_list_evidence_mutation()
  owner to postgres;
revoke all on function public.reject_candidate_list_evidence_mutation()
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.reject_candidate_list_member_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'candidate list member identity and evidence are immutable'
    using errcode = '55000';
end
$$;

alter function public.reject_candidate_list_member_evidence_mutation()
  owner to postgres;
revoke all on function public.reject_candidate_list_member_evidence_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_list_members_evidence_immutable
  on public.candidate_list_members;
create trigger candidate_list_members_evidence_immutable
  before update on public.candidate_list_members
  for each row execute function
    public.reject_candidate_list_member_evidence_mutation();

create or replace function public.guard_candidate_list_canonical_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_invalid_identity record;
begin
  if tg_op = 'DELETE' then
    -- An enclosing workspace deletion owns the lifecycle of all dependent
    -- rows. A direct workspace_state deletion must not orphan durable list
    -- authority while the tenant itself still exists.
    if not exists (
      select 1
        from public.workspaces workspace
       where workspace.id = old.workspace_id
    ) then
      return old;
    end if;

    if exists (
      select 1
        from public.candidate_list_members member
       where member.workspace_id = old.workspace_id
    ) or exists (
      select 1
        from public.candidate_contact_attestations attestation
       where attestation.workspace_id = old.workspace_id
    ) or exists (
      select 1
        from public.candidate_list_operation_receipts receipt
       where receipt.workspace_id = old.workspace_id
    ) then
      raise exception
        'workspace state cannot be removed while candidate-list authority exists'
        using errcode = '23514';
    end if;

    return old;
  end if;

  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace-state tenant identity is immutable'
      using errcode = '55000';
  end if;

  with old_candidates as materialized (
    select
      candidate.value ->> 'campaignId' as campaign_id,
      candidate.value ->> 'id' as candidate_id
      from jsonb_array_elements(
        case
          when jsonb_typeof(old.state -> 'candidates') = 'array'
            then old.state -> 'candidates'
          else '[]'::jsonb
        end
      ) candidate(value)
     where candidate.value ->> 'campaignId'
       ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
       and candidate.value ->> 'id'
       ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     group by candidate.value ->> 'campaignId', candidate.value ->> 'id'
  ),
  new_candidates as materialized (
    select
      candidate.value ->> 'campaignId' as campaign_id,
      candidate.value ->> 'id' as candidate_id,
      count(*)::integer as identity_count
      from jsonb_array_elements(
        case
          when jsonb_typeof(new.state -> 'candidates') = 'array'
            then new.state -> 'candidates'
          else '[]'::jsonb
        end
      ) candidate(value)
     where candidate.value ->> 'campaignId'
       ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
       and candidate.value ->> 'id'
       ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     group by candidate.value ->> 'campaignId', candidate.value ->> 'id'
  ),
  authority_identities as materialized (
    select member.campaign_id, member.candidate_id
      from public.candidate_list_members member
     where member.workspace_id = new.workspace_id
    union
    select attestation.campaign_id, attestation.candidate_id
      from public.candidate_contact_attestations attestation
     where attestation.workspace_id = new.workspace_id
    union
    select candidate.campaign_id, candidate.candidate_id
      from old_candidates candidate
      join public.sourcing_learning_secrets secret
        on secret.workspace_id = new.workspace_id
      join public.candidate_list_operation_receipts receipt
        on receipt.workspace_id = new.workspace_id
       and receipt.operation_kind in ('add_member', 'attest_manual')
       and receipt.candidate_subject_hmac = public.sourcing_authority_hmac(
         new.workspace_id,
         jsonb_build_array(
           'candidate_list_subject_v1',
           candidate.campaign_id,
           candidate.candidate_id
         )::text
       )
  )
  select authority.campaign_id, authority.candidate_id
    into v_invalid_identity
    from authority_identities authority
    left join new_candidates candidate
      on candidate.campaign_id = authority.campaign_id
     and candidate.candidate_id = authority.candidate_id
   where candidate.identity_count is distinct from 1
   order by authority.campaign_id, authority.candidate_id
   limit 1;

  if found then
    raise exception
      'candidate-list authority requires exactly one canonical workspace candidate'
      using errcode = '23514';
  end if;

  return new;
end
$$;

alter function public.guard_candidate_list_canonical_authority()
  owner to postgres;
revoke all on function public.guard_candidate_list_canonical_authority()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists workspace_state_candidate_list_authority_guard
  on public.workspace_state;
create trigger workspace_state_candidate_list_authority_guard
  after update of workspace_id, state on public.workspace_state
  for each row
  when (
    old.workspace_id is distinct from new.workspace_id
    or old.state -> 'candidates' is distinct from new.state -> 'candidates'
  )
  execute function public.guard_candidate_list_canonical_authority();

drop trigger if exists workspace_state_candidate_list_delete_guard
  on public.workspace_state;
create trigger workspace_state_candidate_list_delete_guard
  before delete on public.workspace_state
  for each row execute function public.guard_candidate_list_canonical_authority();

-- Owner-only resolver. It accepts no actor/workspace claims from a runtime
-- caller. Provider rows count only when bound to the exact completed attempt
-- and durable completion receipt. A completed but expired/revoked source still
-- participates in ambiguity detection so another source cannot silently win.
create or replace function public.resolve_candidate_list_evidence(
  p_workspace_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_captured_at timestamptz
)
returns table (
  status text,
  evidence_kind text,
  evidence_attestation_id bigint,
  evidence_provider_attempt_id uuid,
  evidence_sha256 text,
  evidence_recorded_at timestamptz,
  evidence_expires_at timestamptz
)
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_campaign_uuid uuid;
  v_evidence_count integer;
  v_source_status text;
  v_evidence_kind text;
  v_attestation_id bigint;
  v_provider_attempt_id uuid;
  v_evidence_sha256 text;
  v_evidence_recorded_at timestamptz;
  v_evidence_expires_at timestamptz;
begin
  if p_workspace_id is null
     or p_campaign_id is null
     or p_campaign_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_captured_at is null then
    raise exception 'invalid candidate evidence request'
      using errcode = '22023';
  end if;

  -- Cast only the canonical lowercase textual UUID form. Non-UUID manual
  -- campaigns never reach a cast and therefore remain valid manual identities.
  if p_campaign_id
    ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
  then
    v_campaign_uuid := p_campaign_id::uuid;
  end if;

  with evidence_rows as (
    select
      case attestation.value_code
        when 'operator_verified' then 'resolved'
        else 'provenance_revoked'
      end as source_status,
      'manual_attestation'::text as source_kind,
      attestation.id as source_attestation_id,
      null::uuid as source_provider_attempt_id,
      attestation.evidence_sha256 as source_sha256,
      attestation.recorded_at as source_recorded_at,
      null::timestamptz as source_expires_at
      from public.candidate_contact_attestations attestation
     where attestation.workspace_id = p_workspace_id
       and attestation.campaign_id = p_campaign_id
       and attestation.candidate_id = p_candidate_id
       and attestation.authority_version = 'governed-v1'
       and not exists (
         select 1
           from public.candidate_contact_attestations successor
          where successor.workspace_id = attestation.workspace_id
            and successor.campaign_id = attestation.campaign_id
            and successor.candidate_id = attestation.candidate_id
            and successor.authority_version = 'governed-v1'
            and successor.supersedes_id = attestation.id
       )

    union all

    select
      'resolved'::text,
      'github_provider'::text,
      null::bigint,
      evidence.egress_attempt_id,
      evidence.normalized_payload_sha256,
      evidence.observed_at,
      null::timestamptz
      from public.sourcing_candidate_evidence evidence
      join public.sourcing_batch_egress_attempts attempt
        on attempt.id = evidence.egress_attempt_id
       and attempt.workspace_id = evidence.workspace_id
       and attempt.campaign_id = evidence.campaign_id
       and attempt.job_id = evidence.job_id
       and attempt.provider = evidence.provider
       and attempt.status = 'completed'
      join public.sourcing_batch_receipts receipt
        on receipt.egress_attempt_id = attempt.id
       and receipt.workspace_id = attempt.workspace_id
       and receipt.campaign_id = attempt.campaign_id
       and receipt.job_id = attempt.job_id
     where v_campaign_uuid is not null
       and evidence.workspace_id = p_workspace_id
       and evidence.campaign_id = v_campaign_uuid
       and evidence.candidate_id = p_candidate_id
       and evidence.provider = 'github'

    union all

    select
      case
        when evidence.expires_at > p_captured_at then 'resolved'
        else 'provenance_expired'
      end,
      'tavily_provider'::text,
      null::bigint,
      evidence.egress_attempt_id,
      evidence.normalized_payload_sha256,
      evidence.recorded_at,
      evidence.expires_at
      from public.autonomous_web_candidate_evidence evidence
      join public.autonomous_web_sourcing_attempts attempt
        on attempt.id = evidence.egress_attempt_id
       and attempt.workspace_id = evidence.workspace_id
       and attempt.campaign_id = evidence.campaign_id
       and attempt.provider = evidence.provider
      join public.autonomous_web_sourcing_receipts receipt
        on receipt.egress_attempt_id = attempt.id
       and receipt.workspace_id = attempt.workspace_id
       and receipt.campaign_id = attempt.campaign_id
       and receipt.job_id = attempt.job_id
     where v_campaign_uuid is not null
       and evidence.workspace_id = p_workspace_id
       and evidence.campaign_id = v_campaign_uuid
       and evidence.candidate_id = p_candidate_id
       and evidence.provider = 'tavily'
  )
  select
    count(*)::integer,
    min(source_status),
    min(source_kind),
    min(source_attestation_id),
    min(source_provider_attempt_id::text)::uuid,
    min(source_sha256),
    min(source_recorded_at),
    min(source_expires_at)
    into
      v_evidence_count,
      v_source_status,
      v_evidence_kind,
      v_attestation_id,
      v_provider_attempt_id,
      v_evidence_sha256,
      v_evidence_recorded_at,
      v_evidence_expires_at
    from evidence_rows;

  if v_evidence_count = 0 then
    return query select
      'provenance_missing'::text, null::text, null::bigint, null::uuid,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_evidence_count > 1 then
    return query select
      'provenance_ambiguous'::text, null::text, null::bigint, null::uuid,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_source_status <> 'resolved' then
    return query select
      v_source_status, null::text, null::bigint, null::uuid,
      null::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  return query select
    'resolved'::text,
    v_evidence_kind,
    v_attestation_id,
    v_provider_attempt_id,
    v_evidence_sha256,
    v_evidence_recorded_at,
    v_evidence_expires_at;
end
$$;

alter function public.resolve_candidate_list_evidence(
  uuid, text, text, timestamptz
) owner to postgres;
revoke all on function public.resolve_candidate_list_evidence(
  uuid, text, text, timestamptz
) from public, anon, authenticated, service_role, authenticator;

-- Candidate erasure is identity-global within a workspace. Keep provider
-- cleanup symmetric with the candidate-id tombstone and canonical-state scrub;
-- a second campaign must not retain evidence for the erased identity.
create or replace function public.cleanup_sourcing_candidate_evidence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  scrubbed integer := 0;
begin
  if new.status = 'blocked_legal_hold' then
    return null;
  end if;
  delete from public.sourcing_candidate_evidence evidence
   where evidence.workspace_id = new.workspace_id
     and evidence.candidate_id = new.candidate_id;
  get diagnostics scrubbed = row_count;
  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values (
    new.id, new.workspace_id, 'sourcing_candidate_evidence', scrubbed
  ) on conflict (request_id, store_name) do nothing;
  return null;
end
$$;

alter function public.cleanup_sourcing_candidate_evidence() owner to postgres;
revoke all on function public.cleanup_sourcing_candidate_evidence()
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.attest_candidate_manual_provenance(
  p_campaign_id text,
  p_candidate_id text,
  p_decision text,
  p_observed_at timestamptz,
  p_supersedes_id bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor_id uuid;
  v_workspace_id uuid;
  v_profile_role text;
  v_state jsonb;
  v_workspace_state_found boolean;
  v_has_secret boolean;
  v_candidate jsonb;
  v_candidate_count integer;
  v_lawful_basis_code text;
  v_canonical_observed_at timestamptz;
  v_observed_at_hmac text;
  v_evidence_observed_at timestamptz;
  v_evidence_observed_at_hmac text;
  v_captured_at timestamptz;
  v_request_hmac_sha256 text;
  v_candidate_subject_hmac text;
  v_evidence_sha256 text;
  v_receipt public.candidate_list_operation_receipts%rowtype;
  v_current public.candidate_contact_attestations%rowtype;
  v_attestation_id bigint;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_actor_id := public.current_active_identity_id();
  v_workspace_id := public.current_workspace_id();
  v_profile_role := public.current_profile_role();

  if v_actor_id is null or v_workspace_id is null
     or v_profile_role is null
     or v_profile_role not in ('member', 'admin') then
    raise exception 'source permission required' using errcode = '42501';
  end if;

  if p_campaign_id is null
     or p_campaign_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_decision is null
     or p_decision not in ('verify', 'revoke')
     or p_observed_at is null
     or p_idempotency_key is null then
    raise exception 'invalid manual provenance request'
      using errcode = '22023';
  end if;

  -- timestamptz JSON rendering follows the session TimeZone. Canonicalize the
  -- instant before hashing so the same retry remains identical across pools.
  v_observed_at_hmac := to_char(
    p_observed_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  );

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':attest_manual:' || p_idempotency_key::text,
    0
  ));

  -- Governed erasure locks this row FOR UPDATE before candidate identities.
  -- The shared lock preserves the same global order without blocking other
  -- candidate operations in the workspace.
  select workspace.state
    into v_state
    from public.workspace_state workspace
   where workspace.workspace_id = v_workspace_id
   for share;
  v_workspace_state_found := found;

  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    v_workspace_id, 'candidate_id', p_candidate_id
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':candidate_contact_evidence:'
      || p_campaign_id || ':' || p_candidate_id,
    0
  ));

  -- A replay is never returned before the tombstone check. Erasure therefore
  -- invalidates old successful retries instead of resurrecting evidence.
  v_has_secret := exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = v_workspace_id
  );

  if v_has_secret and public.candidate_erasure_tombstone_exists(
    v_workspace_id, 'candidate_id', p_candidate_id
  ) then
    return jsonb_build_object('status', 'candidate_not_found');
  end if;

  if v_has_secret then
    v_request_hmac_sha256 := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_request_v1', 'attest_manual', v_actor_id,
        p_campaign_id, p_candidate_id, p_decision, v_observed_at_hmac,
        p_supersedes_id
      )::text
    );
    v_candidate_subject_hmac := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1', p_campaign_id, p_candidate_id
      )::text
    );

    select receipt.*
      into v_receipt
      from public.candidate_list_operation_receipts receipt
     where receipt.workspace_id = v_workspace_id
       and receipt.operation_kind = 'attest_manual'
       and receipt.idempotency_key = p_idempotency_key
     for update;

    if found then
      if v_receipt.request_hmac_sha256 <> v_request_hmac_sha256 then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return v_receipt.result;
    end if;
  end if;

  if not v_workspace_state_found then
    return jsonb_build_object('status', 'candidate_not_found');
  end if;

  select count(*)::integer, min(candidate.value::text)::jsonb
    into v_candidate_count, v_candidate
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_state -> 'candidates') = 'array'
          then v_state -> 'candidates'
        else '[]'::jsonb
      end
    ) candidate(value)
   where candidate.value ->> 'id' = p_candidate_id
     and candidate.value ->> 'campaignId' = p_campaign_id;

  if v_candidate_count = 0 then
    return jsonb_build_object('status', 'candidate_not_found');
  end if;
  if v_candidate_count > 1 then
    return jsonb_build_object('status', 'provenance_ambiguous');
  end if;

  if p_decision = 'verify' then
    v_lawful_basis_code := v_candidate ->> 'lawfulBasis';
    if v_candidate ->> 'provenance' is distinct from 'manual'
       or v_candidate ->> 'sourcePlatform' is distinct from 'Manual'
       or v_lawful_basis_code is null
       or v_lawful_basis_code not in ('consent', 'legitimate_interest')
       or v_candidate ->> 'lawfulBasisSource'
         is distinct from 'operator_selection'
       or coalesce(v_candidate ->> 'lawfulBasisRecordedAt', '')
         !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    then
      return jsonb_build_object('status', 'provenance_missing');
    end if;

    begin
      v_canonical_observed_at :=
        (v_candidate ->> 'lawfulBasisRecordedAt')::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        return jsonb_build_object('status', 'provenance_missing');
    end;

    -- Freshness is decided after every contended lock and canonical read.
    -- A request that waited past the acceptance window must fail closed.
    v_captured_at := clock_timestamp();

    if p_observed_at <> v_canonical_observed_at
       or p_observed_at < v_captured_at - interval '180 days'
       or p_observed_at > v_captured_at + interval '5 minutes' then
      return jsonb_build_object('status', 'provenance_missing');
    end if;

    v_evidence_observed_at := p_observed_at;
    v_evidence_observed_at_hmac := v_observed_at_hmac;
  end if;

  if not v_has_secret then
    insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
    values (v_workspace_id, gen_random_bytes(32))
    on conflict (workspace_id) do nothing;

    v_request_hmac_sha256 := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_request_v1', 'attest_manual', v_actor_id,
        p_campaign_id, p_candidate_id, p_decision, v_observed_at_hmac,
        p_supersedes_id
      )::text
    );
    v_candidate_subject_hmac := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1', p_campaign_id, p_candidate_id
      )::text
    );
  end if;

  select attestation.*
    into v_current
    from public.candidate_contact_attestations attestation
   where attestation.workspace_id = v_workspace_id
     and attestation.campaign_id = p_campaign_id
     and attestation.candidate_id = p_candidate_id
     and attestation.authority_version = 'governed-v1'
     and not exists (
       select 1
         from public.candidate_contact_attestations successor
        where successor.workspace_id = attestation.workspace_id
          and successor.campaign_id = attestation.campaign_id
          and successor.candidate_id = attestation.candidate_id
          and successor.authority_version = 'governed-v1'
          and successor.supersedes_id = attestation.id
     )
   order by attestation.id
   limit 1
   for update;

  if not found then
    if p_decision <> 'verify' or p_supersedes_id is not null then
      v_result := jsonb_build_object('status', 'predecessor_conflict');
    end if;
  elsif p_supersedes_id is distinct from v_current.id then
    v_result := jsonb_build_object('status', 'predecessor_conflict');
  elsif p_decision = 'revoke'
        and v_current.value_code <> 'operator_verified' then
    v_result := jsonb_build_object('status', 'predecessor_conflict');
  elsif p_decision = 'verify'
        and p_observed_at <= v_current.observed_at then
    v_result := jsonb_build_object('status', 'predecessor_conflict');
  end if;

  if v_result is null and p_decision = 'revoke' then
    -- Revocation lowers risk and must remain possible after the original
    -- verification ages or canonical lawful-basis display fields degrade.
    -- Preserve the verified predecessor's evidence instant and basis instead
    -- of accepting new provenance from the revoke request.
    v_lawful_basis_code := v_current.lawful_basis_code;
    v_evidence_observed_at := v_current.observed_at;
    v_evidence_observed_at_hmac := to_char(
      v_current.observed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    );
  end if;

  if v_result is null then
    v_evidence_sha256 := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_manual_evidence_v1', v_actor_id,
        p_campaign_id, p_candidate_id, p_decision,
        v_lawful_basis_code, v_evidence_observed_at_hmac, p_supersedes_id
      )::text
    );

    insert into public.candidate_contact_attestations (
      workspace_id,
      campaign_id,
      candidate_id,
      attestation_kind,
      value_code,
      evidence_sha256,
      recorded_by,
      authority_version,
      lawful_basis_code,
      observed_at,
      supersedes_id
    ) values (
      v_workspace_id,
      p_campaign_id,
      p_candidate_id,
      'manual_provenance',
      case p_decision
        when 'verify' then 'operator_verified'
        else 'operator_revoked'
      end,
      v_evidence_sha256,
      v_actor_id,
      'governed-v1',
      v_lawful_basis_code,
      v_evidence_observed_at,
      p_supersedes_id
    ) returning id into v_attestation_id;

    v_result := jsonb_build_object(
      'status', case p_decision
        when 'verify' then 'verified'
        else 'revoked'
      end,
      'attestation_id', v_attestation_id
    );
  end if;

  insert into public.candidate_list_operation_receipts (
    workspace_id,
    list_id,
    operation_kind,
    idempotency_key,
    request_hmac_sha256,
    candidate_subject_hmac,
    actor_id,
    result
  ) values (
    v_workspace_id,
    null,
    'attest_manual',
    p_idempotency_key,
    v_request_hmac_sha256,
    v_candidate_subject_hmac,
    v_actor_id,
    v_result
  );

  return v_result;
end
$$;

alter function public.attest_candidate_manual_provenance(
  text, text, text, timestamptz, bigint, uuid
) owner to postgres;
revoke all on function public.attest_candidate_manual_provenance(
  text, text, text, timestamptz, bigint, uuid
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.attest_candidate_manual_provenance(
  text, text, text, timestamptz, bigint, uuid
) to authenticated;

create or replace function public.add_candidate_list_member(
  p_list_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor_id uuid;
  v_workspace_id uuid;
  v_profile_role text;
  v_state jsonb;
  v_workspace_state_found boolean;
  v_has_secret boolean;
  v_candidate_count integer;
  v_captured_at timestamptz;
  v_request_hmac_sha256 text;
  v_candidate_subject_hmac text;
  v_receipt public.candidate_list_operation_receipts%rowtype;
  v_resolution record;
  v_result jsonb;
  v_rows_inserted bigint;
  v_existing_member boolean;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_actor_id := public.current_active_identity_id();
  v_workspace_id := public.current_workspace_id();
  v_profile_role := public.current_profile_role();

  if v_actor_id is null or v_workspace_id is null
     or v_profile_role is null
     or v_profile_role not in ('member', 'admin') then
    raise exception 'source permission required' using errcode = '42501';
  end if;

  if p_list_id is null
     or p_idempotency_key is null
     or p_campaign_id is null
     or p_campaign_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or p_candidate_id is null
     or p_candidate_id
       !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate list member request'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':add_member:' || p_idempotency_key::text,
    0
  ));

  -- Match the canonical erasure order: workspace row before candidate
  -- identity. Exactly one canonical candidate is required for every source.
  select workspace.state
    into v_state
    from public.workspace_state workspace
   where workspace.workspace_id = v_workspace_id
   for share;
  v_workspace_state_found := found;

  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    v_workspace_id, 'candidate_id', p_candidate_id
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':candidate_contact_evidence:'
      || p_campaign_id || ':' || p_candidate_id,
    0
  ));

  v_has_secret := exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = v_workspace_id
  );

  if v_has_secret and public.candidate_erasure_tombstone_exists(
    v_workspace_id, 'candidate_id', p_candidate_id
  ) then
    return jsonb_build_object('status', 'candidate_not_found');
  end if;

  if v_has_secret then
    v_request_hmac_sha256 := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_request_v1', 'add_member', v_actor_id,
        p_list_id, p_campaign_id, p_candidate_id
      )::text
    );
    v_candidate_subject_hmac := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1', p_campaign_id, p_candidate_id
      )::text
    );

    select receipt.*
      into v_receipt
      from public.candidate_list_operation_receipts receipt
     where receipt.workspace_id = v_workspace_id
       and receipt.operation_kind = 'add_member'
       and receipt.idempotency_key = p_idempotency_key
     for update;

    if found then
      if v_receipt.request_hmac_sha256 <> v_request_hmac_sha256 then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return v_receipt.result;
    end if;
  end if;

  if not v_workspace_state_found then
    return jsonb_build_object('status', 'candidate_not_found');
  end if;

  select count(*)::integer
    into v_candidate_count
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_state -> 'candidates') = 'array'
          then v_state -> 'candidates'
        else '[]'::jsonb
      end
    ) candidate(value)
   where candidate.value ->> 'id' = p_candidate_id
     and candidate.value ->> 'campaignId' = p_campaign_id;

  if v_candidate_count = 0 then
    return jsonb_build_object('status', 'candidate_not_found');
  end if;
  if v_candidate_count > 1 then
    return jsonb_build_object('status', 'provenance_ambiguous');
  end if;

  if not v_has_secret then
    insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
    values (v_workspace_id, gen_random_bytes(32))
    on conflict (workspace_id) do nothing;

    v_request_hmac_sha256 := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_request_v1', 'add_member', v_actor_id,
        p_list_id, p_campaign_id, p_candidate_id
      )::text
    );
    v_candidate_subject_hmac := public.sourcing_authority_hmac(
      v_workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1', p_campaign_id, p_candidate_id
      )::text
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':candidate_list_member:' || p_list_id::text
      || ':' || p_campaign_id || ':' || p_candidate_id,
    0
  ));

  perform 1
    from public.candidate_lists list_record
   where list_record.workspace_id = v_workspace_id
     and list_record.id = p_list_id
   for key share;

  if not found then
    v_result := jsonb_build_object('status', 'list_not_found');

    insert into public.candidate_list_operation_receipts (
      workspace_id, list_id, operation_kind, idempotency_key,
      request_hmac_sha256, candidate_subject_hmac, actor_id, result
    ) values (
      v_workspace_id, null, 'add_member', p_idempotency_key,
      v_request_hmac_sha256, v_candidate_subject_hmac, v_actor_id, v_result
    );

    return v_result;
  end if;

  select exists (
    select 1
      from public.candidate_list_members member
     where member.workspace_id = v_workspace_id
       and member.list_id = p_list_id
       and member.campaign_id = p_campaign_id
       and member.candidate_id = p_candidate_id
  ) into v_existing_member;

  if v_existing_member then
    v_result := jsonb_build_object('status', 'already_member');
  else
    -- Sample after workspace, identity, evidence, member, and list locks. A
    -- Tavily observation that expires while this request waits is not valid
    -- admission authority.
    v_captured_at := clock_timestamp();

    select resolved.*
      into v_resolution
      from public.resolve_candidate_list_evidence(
        v_workspace_id,
        p_campaign_id,
        p_candidate_id,
        v_captured_at
      ) resolved;

    if v_resolution.status <> 'resolved' then
      -- Evidence state can legitimately change (a provider receipt completes,
      -- Tavily is refreshed, or a manual record is verified/revoked). Do not
      -- make a transient evidence denial permanent under an idempotency key,
      -- and do not create a candidate-linkable failure artifact.
      return jsonb_build_object('status', v_resolution.status);
    else
      insert into public.candidate_list_members (
        workspace_id,
        list_id,
        campaign_id,
        candidate_id,
        evidence_kind,
        evidence_attestation_id,
        evidence_provider_attempt_id,
        evidence_sha256,
        evidence_recorded_at,
        evidence_expires_at,
        added_by
      ) values (
        v_workspace_id,
        p_list_id,
        p_campaign_id,
        p_candidate_id,
        v_resolution.evidence_kind,
        v_resolution.evidence_attestation_id,
        v_resolution.evidence_provider_attempt_id,
        v_resolution.evidence_sha256,
        v_resolution.evidence_recorded_at,
        v_resolution.evidence_expires_at,
        v_actor_id
      )
      on conflict (workspace_id, list_id, campaign_id, candidate_id)
      do nothing;

      get diagnostics v_rows_inserted = row_count;

      if v_rows_inserted = 1 then
        v_result := jsonb_build_object(
          'status', 'added',
          'list_id', p_list_id
        );
      else
        v_result := jsonb_build_object('status', 'already_member');
      end if;
    end if;
  end if;

  insert into public.candidate_list_operation_receipts (
    workspace_id,
    list_id,
    operation_kind,
    idempotency_key,
    request_hmac_sha256,
    candidate_subject_hmac,
    actor_id,
    result
  ) values (
    v_workspace_id,
    p_list_id,
    'add_member',
    p_idempotency_key,
    v_request_hmac_sha256,
    v_candidate_subject_hmac,
    v_actor_id,
    v_result
  );

  return v_result;
end
$$;

alter function public.add_candidate_list_member(uuid, text, text, uuid)
  owner to postgres;
revoke all on function public.add_candidate_list_member(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.add_candidate_list_member(
  uuid, text, text, uuid
) to authenticated;

create or replace function public.cleanup_erased_candidate_lists()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_member_count integer := 0;
  v_attestation_count integer := 0;
  v_receipt_count integer := 0;
  v_subject_hmacs text[];
begin
  if new.status = 'blocked_legal_hold' then
    return null;
  end if;

  perform set_config('aria.candidate_list_erasure_cleanup', 'on', true);
  perform set_config(
    'aria.candidate_list_erasure_request_id', new.id::text, true
  );

  if exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = new.workspace_id
  ) then
    select array_agg(distinct public.sourcing_authority_hmac(
      new.workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1',
        candidate.value ->> 'campaignId',
        new.candidate_id
      )::text
    ))
      into v_subject_hmacs
      from public.workspace_state workspace
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(workspace.state -> 'candidates') = 'array'
            then workspace.state -> 'candidates'
          else '[]'::jsonb
        end
      ) candidate(value)
     where workspace.workspace_id = new.workspace_id
       and candidate.value ->> 'id' = new.candidate_id
       and candidate.value ->> 'campaignId'
         ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$';

    -- Every non-create operation for this candidate is subject-bound to one
    -- canonical campaign identity. Candidate erasure removes the candidate
    -- from every campaign, so remove every matching add/attest/revoke receipt.
    delete from public.candidate_list_operation_receipts receipt
     where receipt.workspace_id = new.workspace_id
       and receipt.candidate_subject_hmac = any(v_subject_hmacs);
    get diagnostics v_receipt_count = row_count;
  end if;

  delete from public.candidate_list_members member
   where member.workspace_id = new.workspace_id
     and member.candidate_id = new.candidate_id;
  get diagnostics v_member_count = row_count;

  select count(*)::integer
    into v_attestation_count
    from public.candidate_contact_attestations attestation
   where attestation.workspace_id = new.workspace_id
     and attestation.candidate_id = new.candidate_id;

  delete from public.candidate_contact_attestations attestation
   where attestation.workspace_id = new.workspace_id
     and attestation.candidate_id = new.candidate_id;

  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values
    (new.id, new.workspace_id, 'candidate_list_members', v_member_count),
    (new.id, new.workspace_id, 'candidate_contact_attestations', v_attestation_count),
    (new.id, new.workspace_id, 'candidate_list_operation_receipts', v_receipt_count)
  on conflict (request_id, store_name) do nothing;

  perform set_config('aria.candidate_list_erasure_request_id', '', true);
  perform set_config('aria.candidate_list_erasure_cleanup', '', true);

  return null;
end
$$;

alter function public.cleanup_erased_candidate_lists() owner to postgres;
revoke all on function public.cleanup_erased_candidate_lists()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_erasure_requests_candidate_lists_cleanup
  on public.candidate_erasure_requests;
create trigger candidate_erasure_requests_candidate_lists_cleanup
  after insert or update on public.candidate_erasure_requests
  for each row
  when (new.status <> 'blocked_legal_hold')
  execute function public.cleanup_erased_candidate_lists();

-- Reassert table and sequence privacy after the alterations. The resolver is
-- intentionally owner-only; runtime callers can mutate only through the two
-- narrow authenticated RPCs above.
do $candidate_list_0065_security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'candidate_lists',
    'candidate_contact_attestations',
    'candidate_list_members',
    'candidate_list_operation_receipts'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'revoke all on public.%I from public, anon, authenticated, service_role, authenticator',
      table_name
    );
  end loop;
end
$candidate_list_0065_security$;

revoke all on sequence public.candidate_contact_attestations_id_seq
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.candidate_list_operation_receipts_id_seq
  from public, anon, authenticated, service_role, authenticator;
