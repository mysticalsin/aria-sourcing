-- 0065_candidate_list_evidence_authority.sql rollback
--
-- Restore the exact 0064 candidate-list contract. Provider-backed membership
-- and governed manual-evidence lifecycle records cannot be represented by
-- 0064, so refuse before the first schema mutation when either exists.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(hashtextextended('aria-schema-migrations', 0));

do $candidate_list_evidence_rollback_guard$
declare
  unsafe_rows boolean := false;
  later_authority_exists boolean := false;
begin
  if to_regclass('public.candidate_list_operation_receipts') is null
     or to_regclass('public.candidate_lists') is null
     or to_regclass('public.candidate_list_members') is null
     or to_regclass('public.candidate_contact_attestations') is null
     or to_regclass('public.workspace_state') is null
     or to_regclass('public.candidates') is null then
    raise exception
      '0065 rollback requires the complete 0064 candidate-list foundation'
      using errcode = '55000';
  end if;

  if to_regclass('public.aria_schema_migrations') is not null then
    execute 'lock table public.aria_schema_migrations in share row exclusive mode';
    execute $query$
      select exists (
        select 1
          from public.aria_schema_migrations migration
         where substring(migration.filename from '^([0-9]{4})_') >= '0066'
      )
    $query$ into later_authority_exists;
  end if;

  -- 0066 wraps the 0065 cleanup and evidence contracts. Its exact markers
  -- close the ledgerless disposable path before any workspace or evidence
  -- table lock can begin a partial downgrade.
  if later_authority_exists
     or to_regclass(
       'public.candidate_legal_holds_active_candidate_idx'
     ) is not null
     or to_regclass(
       'public.candidate_erasure_requests_open_candidate_idx'
     ) is not null
     or to_regprocedure(
       'public.refresh_candidate_erasure_legal_hold_state_pre0066(uuid)'
     ) is not null
     or to_regprocedure(
       'public.candidate_legal_hold_lock_key(uuid,text)'
     ) is not null
     or to_regprocedure(
       'public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)'
     ) is not null then
    raise exception
      'refusing 0065 rollback while candidate-global legal-hold authority 0066 or later remains applied'
      using errcode = '55000';
  end if;

  -- Drain governed add/attest/erasure writers at their first shared authority
  -- before holding any downstream evidence-table lock. This avoids a lock
  -- upgrade cycle with a live RPC that has already read operation receipts.
  lock table public.workspace_state in exclusive mode;
  lock table public.candidates in share mode;
  lock table public.candidate_lists in share mode;
  lock table public.candidate_list_operation_receipts in access exclusive mode;
  lock table public.candidate_lists in access exclusive mode;
  lock table public.candidate_list_members in access exclusive mode;
  lock table public.candidate_contact_attestations in access exclusive mode;

  select exists (
    select 1
      from public.candidate_list_members member
     where member.evidence_kind is distinct from 'manual_attestation'
  ) into unsafe_rows;

  if unsafe_rows then
    raise exception
      'refusing 0065 rollback because provider-backed candidate-list members exist'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_list_members'::regclass
       and attribute.attname = 'evidence_provider_attempt_id'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    execute $query$
      select exists (
        select 1
          from public.candidate_list_members
         where evidence_provider_attempt_id is not null
      )
    $query$ into unsafe_rows;

    if unsafe_rows then
      raise exception
        'refusing 0065 rollback because provider attempt snapshots exist'
        using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_list_members'::regclass
       and attribute.attname = 'evidence_expires_at'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    execute $query$
      select exists (
        select 1
          from public.candidate_list_members
         where evidence_expires_at is not null
      )
    $query$ into unsafe_rows;

    if unsafe_rows then
      raise exception
        'refusing 0065 rollback because expiring provider snapshots exist'
        using errcode = '55000';
    end if;
  end if;

  -- 0064 rows remain operator_verified and carry no governed lifecycle
  -- attributes. Any other value is a verify/revoke record that cannot be
  -- collapsed without destroying its audit meaning.
  select exists (
    select 1
      from public.candidate_contact_attestations attestation
     where attestation.attestation_kind is distinct from 'manual_provenance'
        or attestation.value_code is distinct from 'operator_verified'
  ) into unsafe_rows;

  if unsafe_rows then
    raise exception
      'refusing 0065 rollback because governed manual lifecycle rows exist'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_contact_attestations'::regclass
       and attribute.attname = 'authority_version'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    execute $query$
      select exists (
        select 1
          from public.candidate_contact_attestations
         where authority_version is distinct from 'legacy-v1'
      )
    $query$ into unsafe_rows;

    if unsafe_rows then
      raise exception
        'refusing 0065 rollback because governed-v1 attestations exist'
        using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_contact_attestations'::regclass
       and attribute.attname = 'lawful_basis_code'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    execute 'select exists (select 1 from public.candidate_contact_attestations where lawful_basis_code is not null)'
      into unsafe_rows;
    if unsafe_rows then
      raise exception
        'refusing 0065 rollback because governed lawful-basis attestations exist'
        using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_contact_attestations'::regclass
       and attribute.attname = 'observed_at'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    execute 'select exists (select 1 from public.candidate_contact_attestations where observed_at is not null)'
      into unsafe_rows;
    if unsafe_rows then
      raise exception
        'refusing 0065 rollback because governed observation timestamps exist'
        using errcode = '55000';
    end if;
  end if;

  if exists (
    select 1
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = 'public.candidate_contact_attestations'::regclass
       and attribute.attname = 'supersedes_id'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ) then
    execute 'select exists (select 1 from public.candidate_contact_attestations where supersedes_id is not null)'
      into unsafe_rows;
    if unsafe_rows then
      raise exception
        'refusing 0065 rollback because manual lifecycle predecessor links exist'
        using errcode = '55000';
    end if;
  end if;

  select exists (
    select 1
      from public.candidate_list_operation_receipts receipt
     where receipt.operation_kind not in ('create_list', 'add_member')
  ) into unsafe_rows;

  if unsafe_rows then
    raise exception
      'refusing 0065 rollback because governed manual lifecycle receipts exist'
      using errcode = '55000';
  end if;

  -- Recreating the 0064 mirror and exact-attestation foreign keys after this
  -- point must be deterministic, not a late DDL failure after mutation.
  select exists (
    select 1
      from public.candidate_contact_attestations attestation
     where not exists (
       select 1
         from public.candidates candidate
        where candidate.workspace_id = attestation.workspace_id
          and candidate.campaign_id = attestation.campaign_id
          and candidate.id = attestation.candidate_id
     )
  ) into unsafe_rows;

  if unsafe_rows then
    raise exception
      'refusing 0065 rollback because an attestation has no 0064 candidate mirror'
      using errcode = '55000';
  end if;

  select exists (
    select 1
      from public.candidate_list_members member
     where member.evidence_attestation_id is null
        or not exists (
          select 1
            from public.candidates candidate
           where candidate.workspace_id = member.workspace_id
             and candidate.campaign_id = member.campaign_id
             and candidate.id = member.candidate_id
        )
        or not exists (
          select 1
            from public.candidate_contact_attestations attestation
           where attestation.workspace_id = member.workspace_id
             and attestation.campaign_id = member.campaign_id
             and attestation.candidate_id = member.candidate_id
             and attestation.id = member.evidence_attestation_id
             and attestation.evidence_sha256 = member.evidence_sha256
             and attestation.recorded_at = member.evidence_recorded_at
        )
  ) into unsafe_rows;

  if unsafe_rows then
    raise exception
      'refusing 0065 rollback because a member cannot satisfy the exact 0064 evidence foreign keys'
      using errcode = '55000';
  end if;

  if to_regclass('public.aria_schema_migrations') is not null then
    execute $query$
      select exists (
        select 1
          from public.aria_schema_migrations migration
         where migration.filename >= '0065_candidate_list_evidence_authority.sql'
      )
    $query$ into unsafe_rows;

    if unsafe_rows then
      raise exception
        'refusing ledgered 0065 rollback; migration history is append-only and production reversal requires a new forward migration'
        using errcode = '55000';
    end if;
  end if;
end
$candidate_list_evidence_rollback_guard$;

-- Refuse an out-of-order rollback before removing any catalog object. A later
-- migration or hotfix may add a control to these tables; 0065 must never erase
-- that unknown control merely because it is absent from the 0064 allowlist.
do $candidate_list_evidence_rollback_catalog_guard$
declare
  unexpected_objects text;
begin
  select string_agg(relation.relname || '.' || attribute.attname, ', ' order by 1)
    into unexpected_objects
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and attribute.attnum > 0
     and not attribute.attisdropped
     and relation.relname in (
       'candidate_contact_attestations',
       'candidate_list_members',
       'candidate_list_operation_receipts'
     )
     and relation.relname || '.' || attribute.attname <> all (array[
       'candidate_contact_attestations.attestation_kind',
       'candidate_contact_attestations.authority_version',
       'candidate_contact_attestations.campaign_id',
       'candidate_contact_attestations.candidate_id',
       'candidate_contact_attestations.evidence_sha256',
       'candidate_contact_attestations.id',
       'candidate_contact_attestations.lawful_basis_code',
       'candidate_contact_attestations.observed_at',
       'candidate_contact_attestations.recorded_at',
       'candidate_contact_attestations.recorded_by',
       'candidate_contact_attestations.supersedes_id',
       'candidate_contact_attestations.value_code',
       'candidate_contact_attestations.workspace_id',
       'candidate_list_members.added_at',
       'candidate_list_members.added_by',
       'candidate_list_members.campaign_id',
       'candidate_list_members.candidate_id',
       'candidate_list_members.evidence_attestation_id',
       'candidate_list_members.evidence_expires_at',
       'candidate_list_members.evidence_kind',
       'candidate_list_members.evidence_provider_attempt_id',
       'candidate_list_members.evidence_recorded_at',
       'candidate_list_members.evidence_sha256',
       'candidate_list_members.list_id',
       'candidate_list_members.member_id',
       'candidate_list_members.workspace_id',
       'candidate_list_operation_receipts.actor_id',
       'candidate_list_operation_receipts.candidate_subject_hmac',
       'candidate_list_operation_receipts.created_at',
       'candidate_list_operation_receipts.id',
       'candidate_list_operation_receipts.idempotency_key',
       'candidate_list_operation_receipts.list_id',
       'candidate_list_operation_receipts.operation_kind',
       'candidate_list_operation_receipts.request_hmac_sha256',
       'candidate_list_operation_receipts.result',
       'candidate_list_operation_receipts.workspace_id'
     ]::text[]);

  if unexpected_objects is not null then
    raise exception 'refusing 0065 rollback because later columns exist: %',
      unexpected_objects using errcode = '55000';
  end if;

  select string_agg(relation.relname || '.' || trigger.tgname, ', ' order by 1)
    into unexpected_objects
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_class relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and not trigger.tgisinternal
     and relation.relname in (
       'candidate_contact_attestations',
       'candidate_list_members',
       'candidate_list_operation_receipts'
     )
     and relation.relname || '.' || trigger.tgname <> all (array[
       'candidate_contact_attestations.candidate_contact_attestations_append_only',
       'candidate_contact_attestations.candidate_contact_attestations_lifecycle_guard',
       'candidate_list_members.candidate_list_members_evidence_immutable',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_append_only'
     ]::text[]);

  if unexpected_objects is not null then
    raise exception 'refusing 0065 rollback because later triggers exist: %',
      unexpected_objects using errcode = '55000';
  end if;

  select string_agg(
           relation.relname || '.' || constraint_metadata.conname,
           ', ' order by 1
         )
    into unexpected_objects
    from pg_catalog.pg_constraint constraint_metadata
    join pg_catalog.pg_class relation on relation.oid = constraint_metadata.conrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname in (
       'candidate_contact_attestations',
       'candidate_list_members',
       'candidate_list_operation_receipts'
     )
     and relation.relname || '.' || constraint_metadata.conname <> all (array[
       'candidate_contact_attestations.candidate_contact_attestation_workspace_id_campaign_id_can_fkey',
       'candidate_contact_attestations.candidate_contact_attestation_workspace_id_campaign_id_cand_key',
       'candidate_contact_attestations.candidate_contact_attestations_attestation_kind_check',
       'candidate_contact_attestations.candidate_contact_attestations_campaign_erasable_check',
       'candidate_contact_attestations.candidate_contact_attestations_campaign_id_check',
       'candidate_contact_attestations.candidate_contact_attestations_candidate_id_check',
       'candidate_contact_attestations.candidate_contact_attestations_evidence_sha256_check',
       'candidate_contact_attestations.candidate_contact_attestations_lifecycle_check',
       'candidate_contact_attestations.candidate_contact_attestations_pkey',
       'candidate_contact_attestations.candidate_contact_attestations_supersedes_fkey',
       'candidate_contact_attestations.candidate_contact_attestations_supersedes_order_check',
       'candidate_contact_attestations.candidate_contact_attestations_value_code_check',
       'candidate_contact_attestations.candidate_contact_attestations_workspace_id_fkey',
       'candidate_contact_attestations.candidate_contact_attestations_workspace_id_recorded_by_fkey',
       'candidate_list_members.candidate_list_members_campaign_erasable_check',
       'candidate_list_members.candidate_list_members_campaign_id_check',
       'candidate_list_members.candidate_list_members_candidate_id_check',
       'candidate_list_members.candidate_list_members_evidence_kind_check',
       'candidate_list_members.candidate_list_members_evidence_pointer_check',
       'candidate_list_members.candidate_list_members_evidence_sha256_check',
       'candidate_list_members.candidate_list_members_member_id_key',
       'candidate_list_members.candidate_list_members_pkey',
       'candidate_list_members.candidate_list_members_workspace_id_added_by_fkey',
       'candidate_list_members.candidate_list_members_workspace_id_campaign_id_candidate__fkey',
       'candidate_list_members.candidate_list_members_workspace_id_campaign_id_candidate_fkey1',
       'candidate_list_members.candidate_list_members_workspace_id_fkey',
       'candidate_list_members.candidate_list_members_workspace_id_list_id_fkey',
       'candidate_list_operation_receipts.candidate_list_operation_rece_workspace_id_operation_kind_i_key',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_candidate_subject_hmac_check',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_check',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_operation_kind_check',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_pkey',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_request_hmac_sha256_check',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_result_check',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_subject_check',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_workspace_id_actor_id_fkey',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_workspace_id_fkey',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_workspace_id_list_id_fkey'
     ]::text[]);

  if unexpected_objects is not null then
    raise exception 'refusing 0065 rollback because later constraints exist: %',
      unexpected_objects using errcode = '55000';
  end if;

  select string_agg(relation.relname || '.' || index_relation.relname, ', ' order by 1)
    into unexpected_objects
    from pg_catalog.pg_index index_metadata
    join pg_catalog.pg_class relation on relation.oid = index_metadata.indrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation on index_relation.oid = index_metadata.indexrelid
   where namespace.nspname = 'public'
     and not index_metadata.indisprimary
     and relation.relname in (
       'candidate_contact_attestations',
       'candidate_list_members',
       'candidate_list_operation_receipts'
     )
     and relation.relname || '.' || index_relation.relname <> all (array[
       'candidate_contact_attestations.candidate_contact_attestation_workspace_id_campaign_id_cand_key',
       'candidate_contact_attestations.candidate_contact_attestations_governed_child_idx',
       'candidate_contact_attestations.candidate_contact_attestations_governed_root_idx',
       'candidate_contact_attestations.candidate_contact_attestations_identity_idx',
       'candidate_contact_attestations.candidate_contact_attestations_lookup_idx',
       'candidate_list_members.candidate_list_members_candidate_idx',
       'candidate_list_members.candidate_list_members_member_id_key',
       'candidate_list_members.candidate_list_members_page_idx',
       'candidate_list_operation_receipts.candidate_list_operation_rece_workspace_id_operation_kind_i_key',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_list_idx',
       'candidate_list_operation_receipts.candidate_list_operation_receipts_subject_idx'
     ]::text[]);

  if unexpected_objects is not null then
    raise exception 'refusing 0065 rollback because later indexes exist: %',
      unexpected_objects using errcode = '55000';
  end if;

  select string_agg(relation.relname || '.' || policy.polname, ', ' order by 1)
    into unexpected_objects
    from pg_catalog.pg_policy policy
    join pg_catalog.pg_class relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname in (
       'candidate_lists',
       'candidate_contact_attestations',
       'candidate_list_members',
       'candidate_list_operation_receipts'
     )
     and (
       relation.relname || '.' || policy.polname <> all (array[
         'candidate_lists.candidate_lists_owner_access',
         'candidate_contact_attestations.candidate_contact_attestations_owner_access',
         'candidate_list_members.candidate_list_members_owner_access',
         'candidate_list_operation_receipts.candidate_list_operation_receipts_owner_access'
       ]::text[])
       or policy.polcmd is distinct from '*'
       or policy.polpermissive is distinct from true
       or pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
         is distinct from 'true'
       or pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
         is distinct from 'true'
       or (
         select string_agg(role_row.rolname, ',' order by role_row.rolname)
           from unnest(policy.polroles) policy_role(role_oid)
           join pg_catalog.pg_roles role_row
             on role_row.oid = policy_role.role_oid
       ) is distinct from 'postgres,supabase_admin'
     );

  if unexpected_objects is not null then
    raise exception 'refusing 0065 rollback because later policies exist: %',
      unexpected_objects using errcode = '55000';
  end if;
end
$candidate_list_evidence_rollback_catalog_guard$;

-- Remove 0065-only callers before removing the columns they reference.
drop function if exists public.attest_candidate_manual_provenance(
  text, text, text, timestamptz, bigint, uuid
);
drop function if exists public.add_candidate_list_member(
  uuid, text, text, uuid
);
drop function if exists public.resolve_candidate_list_evidence(
  uuid, text, text, timestamptz
);
drop trigger if exists workspace_state_candidate_list_authority_guard
  on public.workspace_state;
drop trigger if exists workspace_state_candidate_list_delete_guard
  on public.workspace_state;
drop function if exists public.guard_candidate_list_canonical_authority();

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
     and evidence.campaign_id::text = new.campaign_id
     and evidence.candidate_id = new.candidate_id;
  get diagnostics scrubbed = row_count;
  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values (
    new.id, new.workspace_id, 'sourcing_candidate_evidence', scrubbed
  ) on conflict (request_id, store_name) do nothing;
  return null;
end;
$$;

alter function public.cleanup_sourcing_candidate_evidence() owner to postgres;
revoke all on function public.cleanup_sourcing_candidate_evidence()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_contact_attestations_lifecycle_guard
  on public.candidate_contact_attestations;
drop trigger if exists candidate_list_members_evidence_immutable
  on public.candidate_list_members;

drop function if exists public.reject_candidate_list_member_evidence_mutation();
drop function if exists public.validate_candidate_contact_attestation_lifecycle();

alter table public.candidate_list_members
  drop constraint if exists candidate_list_members_workspace_id_campaign_id_candidate_fkey1,
  drop constraint if exists candidate_list_members_workspace_id_campaign_id_candidate__fkey,
  drop constraint if exists candidate_list_members_campaign_id_check,
  drop constraint if exists candidate_list_members_campaign_erasable_check,
  drop constraint if exists candidate_list_members_evidence_kind_check,
  drop constraint if exists candidate_list_members_evidence_pointer_check;

alter table public.candidate_contact_attestations
  drop constraint if exists candidate_contact_attestation_workspace_id_campaign_id_can_fkey,
  drop constraint if exists candidate_contact_attestations_campaign_id_check,
  drop constraint if exists candidate_contact_attestations_campaign_erasable_check,
  drop constraint if exists candidate_contact_attestations_attestation_kind_check,
  drop constraint if exists candidate_contact_attestations_value_code_check,
  drop constraint if exists candidate_contact_attestations_lifecycle_check,
  drop constraint if exists candidate_contact_attestations_supersedes_order_check,
  drop constraint if exists candidate_contact_attestations_supersedes_fkey;

alter table public.candidate_list_operation_receipts
  drop constraint if exists candidate_list_operation_receipts_operation_kind_check,
  drop constraint if exists candidate_list_operation_receipts_check,
  drop constraint if exists candidate_list_operation_receipts_subject_check;

drop index if exists public.candidate_contact_attestations_governed_child_idx;
drop index if exists public.candidate_contact_attestations_governed_root_idx;
drop index if exists public.candidate_contact_attestations_identity_idx;

alter table public.candidate_list_members
  drop column if exists evidence_expires_at,
  drop column if exists evidence_provider_attempt_id;

alter table public.candidate_contact_attestations
  drop column if exists supersedes_id,
  drop column if exists observed_at,
  drop column if exists lawful_basis_code,
  drop column if exists authority_version;

alter table public.candidate_contact_attestations
  add constraint candidate_contact_attestations_campaign_id_check
    check (char_length(campaign_id) between 1 and 200),
  add constraint candidate_contact_attestations_attestation_kind_check
    check (attestation_kind in ('manual_provenance')),
  add constraint candidate_contact_attestations_value_code_check
    check (value_code in ('operator_verified')),
  add constraint candidate_contact_attestation_workspace_id_campaign_id_can_fkey
    foreign key (workspace_id, campaign_id, candidate_id)
    references public.candidates(workspace_id, campaign_id, id)
    on delete cascade;

alter table public.candidate_list_members
  alter column evidence_attestation_id set not null,
  add constraint candidate_list_members_campaign_id_check
    check (char_length(campaign_id) between 1 and 200),
  add constraint candidate_list_members_evidence_kind_check
    check (evidence_kind in ('manual_attestation')),
  add constraint candidate_list_members_workspace_id_campaign_id_candidate__fkey
    foreign key (workspace_id, campaign_id, candidate_id)
    references public.candidates(workspace_id, campaign_id, id)
    on delete cascade,
  add constraint candidate_list_members_workspace_id_campaign_id_candidate_fkey1
    foreign key (
      workspace_id,
      campaign_id,
      candidate_id,
      evidence_attestation_id,
      evidence_sha256,
      evidence_recorded_at
    ) references public.candidate_contact_attestations(
      workspace_id,
      campaign_id,
      candidate_id,
      id,
      evidence_sha256,
      recorded_at
    ) on delete cascade;

alter table public.candidate_list_operation_receipts
  add constraint candidate_list_operation_receipts_operation_kind_check
    check (operation_kind in ('create_list', 'add_member')),
  add constraint candidate_list_operation_receipts_check check (
    (operation_kind = 'create_list' and candidate_subject_hmac is null)
    or (operation_kind = 'add_member' and candidate_subject_hmac is not null)
  );

create or replace function public.reject_candidate_list_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  -- Foreign-key cascades are the governed erasure/workspace-deletion path.
  -- Direct owner updates/deletes remain forbidden and are tested separately.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$$;

alter function public.reject_candidate_list_evidence_mutation() owner to postgres;
revoke all on function public.reject_candidate_list_evidence_mutation()
  from public, anon, authenticated, service_role, authenticator;

drop trigger if exists candidate_contact_attestations_append_only
  on public.candidate_contact_attestations;
create trigger candidate_contact_attestations_append_only
  before update or delete on public.candidate_contact_attestations
  for each row execute function public.reject_candidate_list_evidence_mutation();

drop trigger if exists candidate_list_operation_receipts_append_only
  on public.candidate_list_operation_receipts;
create trigger candidate_list_operation_receipts_append_only
  before update or delete on public.candidate_list_operation_receipts
  for each row execute function public.reject_candidate_list_evidence_mutation();

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
  v_subject_hmac text;
begin
  if new.status = 'blocked_legal_hold' then
    return null;
  end if;

  perform set_config('aria.candidate_list_erasure_cleanup', 'on', true);

  -- The canonical erasure RPC creates the workspace HMAC secret after the
  -- request row. No secret also means no 0064 add receipt could have been
  -- created, so legacy/manual erasure must continue without computing a HMAC.
  if exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = new.workspace_id
  ) then
    v_subject_hmac := public.sourcing_authority_hmac(
      new.workspace_id,
      jsonb_build_array(
        'candidate_list_subject_v1', new.campaign_id, new.candidate_id
      )::text
    );

    delete from public.candidate_list_operation_receipts receipt
     where receipt.workspace_id = new.workspace_id
       and receipt.operation_kind = 'add_member'
       and receipt.candidate_subject_hmac = v_subject_hmac;
    get diagnostics v_receipt_count = row_count;
  end if;

  delete from public.candidate_list_members member
   where member.workspace_id = new.workspace_id
     and member.campaign_id = new.campaign_id
     and member.candidate_id = new.candidate_id;
  get diagnostics v_member_count = row_count;

  delete from public.candidate_contact_attestations attestation
   where attestation.workspace_id = new.workspace_id
     and attestation.campaign_id = new.campaign_id
     and attestation.candidate_id = new.candidate_id;
  get diagnostics v_attestation_count = row_count;

  insert into public.candidate_erasure_receipts(
    request_id, workspace_id, store_name, scrubbed_rows
  ) values
    (new.id, new.workspace_id, 'candidate_list_members', v_member_count),
    (new.id, new.workspace_id, 'candidate_contact_attestations', v_attestation_count),
    (new.id, new.workspace_id, 'candidate_list_operation_receipts', v_receipt_count)
  on conflict (request_id, store_name) do nothing;

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
  v_request_hmac_sha256 text;
  v_candidate_subject_hmac text;
  v_receipt public.candidate_list_operation_receipts%rowtype;
  v_result jsonb;
  v_attestation_ids bigint[];
  v_attestation public.candidate_contact_attestations%rowtype;
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
     or v_profile_role not in ('member', 'admin') then
    raise exception 'source permission required' using errcode = '42501';
  end if;

  if p_list_id is null or p_idempotency_key is null
     or p_campaign_id is null or p_candidate_id is null
     or char_length(p_campaign_id) not between 1 and 200
     or p_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception 'invalid candidate list member request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_workspace_id::text || ':add_member:' || p_idempotency_key::text,
    0
  ));

  -- Candidate erasure uses this same identity lock before creating a
  -- suppression tombstone and deleting candidate-bearing records. Holding it
  -- before secret creation, HMAC computation, or receipt lookup ensures an
  -- add either commits before erasure (and is scrubbed) or observes the
  -- tombstone afterward (and creates no candidate-linked receipt).
  perform pg_advisory_xact_lock(public.candidate_erasure_identity_lock_key(
    v_workspace_id, 'candidate_id', p_candidate_id
  ));

  if exists (
    select 1
      from public.sourcing_learning_secrets secret
     where secret.workspace_id = v_workspace_id
  ) then
    if public.candidate_erasure_tombstone_exists(
      v_workspace_id, 'candidate_id', p_candidate_id
    ) then
      return jsonb_build_object('status', 'candidate_not_found');
    end if;
  end if;

  insert into public.sourcing_learning_secrets(workspace_id, hmac_key)
  values (v_workspace_id, gen_random_bytes(32))
  on conflict (workspace_id) do nothing;

  v_request_hmac_sha256 := public.sourcing_authority_hmac(
    v_workspace_id,
    jsonb_build_array('candidate_list_request_v1', 'add_member',
      v_actor_id, p_list_id, p_campaign_id, p_candidate_id)::text
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

  perform 1
    from public.candidates candidate
   where candidate.workspace_id = v_workspace_id
     and candidate.campaign_id = p_campaign_id
     and candidate.id = p_candidate_id
   for key share;

  if not found then
    v_result := jsonb_build_object('status', 'candidate_not_found');

    insert into public.candidate_list_operation_receipts (
      workspace_id, list_id, operation_kind, idempotency_key,
      request_hmac_sha256, candidate_subject_hmac, actor_id, result
    ) values (
      v_workspace_id, p_list_id, 'add_member', p_idempotency_key,
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
    -- Future evidence writers must share this candidate-global lock. The
    -- bounded one-statement snapshot distinguishes zero, one, and many rows
    -- without an unbounded count/select race.
    perform pg_advisory_xact_lock(hashtextextended(
      v_workspace_id::text || ':candidate_contact_evidence:'
        || p_campaign_id || ':' || p_candidate_id,
      0
    ));

    select coalesce(array_agg(candidate_evidence.id order by candidate_evidence.id), array[]::bigint[])
      into v_attestation_ids
      from (
        select attestation.id
          from public.candidate_contact_attestations attestation
         where attestation.workspace_id = v_workspace_id
           and attestation.campaign_id = p_campaign_id
           and attestation.candidate_id = p_candidate_id
           and attestation.attestation_kind = 'manual_provenance'
         order by attestation.id
         limit 2
      ) candidate_evidence;

    if cardinality(v_attestation_ids) = 0 then
      v_result := jsonb_build_object('status', 'provenance_missing');
    elsif cardinality(v_attestation_ids) > 1 then
      v_result := jsonb_build_object('status', 'provenance_ambiguous');
    else
      select attestation.*
        into strict v_attestation
        from public.candidate_contact_attestations attestation
       where attestation.workspace_id = v_workspace_id
         and attestation.id = v_attestation_ids[1];

      insert into public.candidate_list_members (
        workspace_id,
        list_id,
        campaign_id,
        candidate_id,
        evidence_kind,
        evidence_attestation_id,
        evidence_sha256,
        evidence_recorded_at,
        added_by
      ) values (
        v_workspace_id,
        p_list_id,
        p_campaign_id,
        p_candidate_id,
        'manual_attestation',
        v_attestation.id,
        v_attestation.evidence_sha256,
        v_attestation.recorded_at,
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
revoke all on function public.add_candidate_list_member(uuid, text, text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.add_candidate_list_member(uuid, text, text, uuid)
  to authenticated;

-- Reassert every 0064 runtime ACL. This is intentionally redundant on a
-- second rollback run and therefore closes grant drift idempotently.
alter function public.create_candidate_list(text, uuid) owner to postgres;
revoke all on function public.create_candidate_list(text, uuid)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.create_candidate_list(text, uuid)
  to authenticated;

alter function public.list_candidate_list_members(uuid, timestamptz, uuid, int)
  owner to postgres;
revoke all on function public.list_candidate_list_members(uuid, timestamptz, uuid, int)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.list_candidate_list_members(uuid, timestamptz, uuid, int)
  to authenticated;

revoke all on sequence public.candidate_contact_attestations_id_seq
  from public, anon, authenticated, service_role, authenticator;
revoke all on sequence public.candidate_list_operation_receipts_id_seq
  from public, anon, authenticated, service_role, authenticator;

do $restore_0064_candidate_list_security$
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
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_owner_access',
      table_name
    );
    execute format(
      'create policy %I on public.%I for all to postgres, supabase_admin using (true) with check (true)',
      table_name || '_owner_access',
      table_name
    );
  end loop;
end
$restore_0064_candidate_list_security$;

commit;
