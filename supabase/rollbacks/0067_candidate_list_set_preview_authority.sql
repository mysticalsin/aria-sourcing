-- 0067_candidate_list_set_preview_authority.sql rollback
--
-- This rollback exists only for ledgerless disposable verification. Production
-- migration history is append-only. Refuse before the first schema mutation
-- when 0067 or a later migration is ledgered, when a later authority marker is
-- present, or when a partial 0067 surface has lost its ownership marker.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_advisory_xact_lock(hashtextextended('aria-schema-migrations', 0));

do $candidate_list_set_preview_rollback_guard$
declare
  noncanonical_ledger_filename_exists boolean := false;
  ledgered_0067_or_later boolean := false;
  has_0067_artifact boolean := false;
  catalog_is_exact boolean := false;
  writer_repair_is_exact boolean := false;
  revision_column_attnum smallint;
  revision_marker text;
begin
  if to_regclass('public.aria_schema_migrations') is not null then
    execute 'lock table public.aria_schema_migrations in share mode';
    execute $query$
      select
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename is null
              or migration.filename !~
                 '^[0-9]{4}_[a-z0-9]+(_[a-z0-9]+)*[.]sql$'
        ),
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename ~
                 '^[0-9]{4}_[a-z0-9]+(_[a-z0-9]+)*[.]sql$'
             and substring(migration.filename from 1 for 4)::integer >= 67
        )
    $query$
      into noncanonical_ledger_filename_exists, ledgered_0067_or_later;
  end if;

  if noncanonical_ledger_filename_exists then
    raise exception
      'refusing 0067 rollback because the migration ledger contains a noncanonical filename'
      using errcode = '55000';
  end if;

  if ledgered_0067_or_later then
    raise exception
      'refusing ledgered 0067 rollback; migration history is append-only and production reversal requires a new forward migration'
      using errcode = '55000';
  end if;

  select attribute.attnum
    into revision_column_attnum
    from pg_catalog.pg_attribute attribute
   where attribute.attrelid = to_regclass('public.candidate_lists')
     and attribute.attname = 'membership_revision'
     and attribute.attnum > 0
     and not attribute.attisdropped;

  has_0067_artifact := revision_column_attnum is not null
    or to_regclass('public.candidate_list_members_set_preview_idx') is not null
    or to_regprocedure(
      'public.advance_candidate_list_membership_revisions()'
    ) is not null
    or to_regprocedure(
      'public.reject_candidate_list_member_truncate()'
    ) is not null
    or to_regprocedure(
      'public.guard_candidate_list_membership_revision()'
    ) is not null
    or to_regprocedure(
      'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'
    ) is not null
    or to_regprocedure(
      'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
    ) is not null
    or to_regprocedure(
      'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
    ) is not null
    or exists (
      select 1
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
       where namespace_row.nspname = 'public'
         and function_row.proname in (
           'advance_candidate_list_membership_revisions',
           'reject_candidate_list_member_truncate',
           'guard_candidate_list_membership_revision',
           'candidate_list_set_preview_window',
           'preview_candidate_list_set',
           'add_candidate_list_member_pre0067'
         )
    )
    or exists (
      select 1
        from pg_catalog.pg_proc function_row
       where function_row.oid = to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and (
           pg_catalog.md5(function_row.prosrc) =
             '3867226b6607b5a2170a9d9e7653d5d9'
           or pg_catalog.obj_description(function_row.oid, 'pg_proc') =
             'aria:candidate-list-set-preview-authority:0067:'
             || '3867226b6607b5a2170a9d9e7653d5d9'
           or function_row.proconfig = array[
             'search_path=pg_catalog, public, pg_temp'
           ]::text[]
         )
    )
    or exists (
      select 1
        from pg_catalog.pg_constraint constraint_row
        join pg_catalog.pg_class relation
          on relation.oid = constraint_row.conrelid
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = relation.relnamespace
       where namespace_row.nspname = 'public'
         and relation.relname = 'candidate_lists'
         and constraint_row.conname =
           'candidate_lists_membership_revision_nonnegative'
    )
    or exists (
      select 1
        from pg_catalog.pg_trigger trigger_row
        join pg_catalog.pg_class relation
          on relation.oid = trigger_row.tgrelid
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = relation.relnamespace
       where namespace_row.nspname = 'public'
         and not trigger_row.tgisinternal
         and (
           (
             relation.relname = 'candidate_list_members'
             and trigger_row.tgname in (
               'candidate_list_members_advance_revision_after_insert',
               'candidate_list_members_advance_revision_after_delete',
               'candidate_list_members_reject_truncate'
             )
           )
           or (
             relation.relname = 'candidate_lists'
             and trigger_row.tgname =
               'candidate_lists_guard_membership_revision'
           )
         )
    );

  -- An already-clean disposable database is a strict no-op.
  if not has_0067_artifact then
    return;
  end if;

  if revision_column_attnum is null then
    raise exception
      'refusing 0067 rollback because a markerless partial authority artifact remains'
      using errcode = '55000';
  end if;

  revision_marker := pg_catalog.col_description(
    to_regclass('public.candidate_lists'),
    revision_column_attnum
  );

  if revision_marker is distinct from
       'aria:candidate-list-set-preview-authority:0067' then
    raise exception
      'refusing 0067 rollback because the membership revision marker is not exact 0067'
      using errcode = '55000';
  end if;

  if to_regclass('public.workspace_state') is null
     or to_regclass('public.candidate_list_operation_receipts') is null
     or to_regclass('public.candidate_lists') is null
     or to_regclass('public.candidate_list_members') is null then
    raise exception
      'refusing 0067 rollback because the 0064 candidate-list foundation is incomplete'
      using errcode = '55000';
  end if;

  -- Drain both legacy bodies and 0067 wrappers at the workspace barrier before
  -- requesting the downstream receipts, lists, and members locks. Keeping the
  -- cleanup inside this guarded block makes an artifact-free database a true
  -- no-op, including before the 0064 foundation exists.
  execute 'lock table public.workspace_state in access exclusive mode';
  execute
    'lock table public.candidate_list_operation_receipts in access exclusive mode';
  execute 'lock table public.candidate_lists in access exclusive mode';
  execute 'lock table public.candidate_list_members in access exclusive mode';

  select
    exists (
      select 1
        from pg_catalog.pg_attribute attribute
        join pg_catalog.pg_attrdef default_row
          on default_row.adrelid = attribute.attrelid
         and default_row.adnum = attribute.attnum
       where attribute.attrelid = 'public.candidate_lists'::regclass
         and attribute.attname = 'membership_revision'
         and attribute.atttypid = 'pg_catalog.int8'::regtype
         and attribute.attnotnull
         and not attribute.attisdropped
         and pg_catalog.pg_get_expr(
           default_row.adbin, default_row.adrelid
         ) in ('0', '0::bigint')
         and pg_catalog.col_description(
           attribute.attrelid, attribute.attnum
         ) = 'aria:candidate-list-set-preview-authority:0067'
    )
    and exists (
      select 1
        from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = 'public.candidate_lists'::regclass
         and constraint_row.conname =
             'candidate_lists_membership_revision_nonnegative'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and not constraint_row.condeferrable
         and not constraint_row.condeferred
         and not constraint_row.connoinherit
         and constraint_row.conislocal
         and constraint_row.coninhcount = 0
         and pg_catalog.array_length(constraint_row.conkey, 1) = 1
         and constraint_row.conkey[1] = (
           select attribute.attnum
             from pg_catalog.pg_attribute attribute
            where attribute.attrelid = 'public.candidate_lists'::regclass
              and attribute.attname = 'membership_revision'
              and not attribute.attisdropped
         )
         and pg_catalog.pg_get_constraintdef(constraint_row.oid) =
             'CHECK ((membership_revision >= 0))'
    )
    and exists (
      select 1
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_row.indexrelid
        join pg_catalog.pg_am access_method
          on access_method.oid = index_relation.relam
       where index_row.indrelid =
             'public.candidate_list_members'::regclass
         and index_relation.relnamespace = 'public'::regnamespace
         and index_relation.relname = 'candidate_list_members_set_preview_idx'
         and index_relation.relkind = 'i'
         and index_relation.relpersistence = 'p'
         and index_relation.reltablespace = 0
         and index_relation.reloptions is null
         and pg_catalog.pg_get_userbyid(index_relation.relowner) = 'postgres'
         and access_method.amname = 'btree'
         and index_row.indisvalid
         and index_row.indisready
         and index_row.indislive
         and index_row.indimmediate
         and not index_row.indisunique
         and not index_row.indisprimary
         and not index_row.indisexclusion
         and not index_row.indisclustered
         and not index_row.indisreplident
         and not index_row.indnullsnotdistinct
         and not index_row.indcheckxmin
         and index_row.indnkeyatts = 4
         and index_row.indnatts = 4
         and index_row.indpred is null
         and index_row.indexprs is null
         and (index_row.indkey::smallint[])[0:3] = array[
           (select attnum from pg_catalog.pg_attribute
             where attrelid = index_row.indrelid and attname = 'workspace_id'),
           (select attnum from pg_catalog.pg_attribute
             where attrelid = index_row.indrelid and attname = 'list_id'),
           (select attnum from pg_catalog.pg_attribute
             where attrelid = index_row.indrelid and attname = 'campaign_id'),
           (select attnum from pg_catalog.pg_attribute
             where attrelid = index_row.indrelid and attname = 'candidate_id')
         ]::smallint[]
         and (index_row.indcollation::oid[])[0] = 0
         and (index_row.indcollation::oid[])[1] = 0
         and (index_row.indcollation::oid[])[2] =
             'pg_catalog."C"'::regcollation
         and (index_row.indcollation::oid[])[3] =
             'pg_catalog."C"'::regcollation
         and (index_row.indclass::oid[])[0:3] = array[
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
             where operator_class.opcnamespace = 'pg_catalog'::regnamespace
               and operator_class.opcmethod = access_method.oid
               and operator_class.opcname = 'uuid_ops'),
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
             where operator_class.opcnamespace = 'pg_catalog'::regnamespace
               and operator_class.opcmethod = access_method.oid
               and operator_class.opcname = 'uuid_ops'),
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
             where operator_class.opcnamespace = 'pg_catalog'::regnamespace
               and operator_class.opcmethod = access_method.oid
               and operator_class.opcname = 'text_ops'),
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
             where operator_class.opcnamespace = 'pg_catalog'::regnamespace
               and operator_class.opcmethod = access_method.oid
               and operator_class.opcname = 'text_ops')
         ]::oid[]
         and (index_row.indoption::smallint[])[0:3] =
             array[0, 0, 0, 0]::smallint[]
    )
    and (
      select pg_catalog.count(*) = 5
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
       where namespace_row.nspname = 'public'
         and function_row.proname in (
           'advance_candidate_list_membership_revisions',
           'reject_candidate_list_member_truncate',
           'guard_candidate_list_membership_revision',
           'candidate_list_set_preview_window',
           'preview_candidate_list_set'
         )
    )
    and (
      select pg_catalog.count(*) = 5
             and pg_catalog.bool_and(
               function_row.oid is not null
               and pg_catalog.pg_get_userbyid(function_row.proowner) =
                   'postgres'
               and language_row.lanname = expected.language_name
               and function_row.prokind = 'f'
               and function_row.provolatile = expected.volatility
               and function_row.prosecdef = expected.security_definer
               and function_row.proconfig is not distinct from expected.config
               and not function_row.proleakproof
               and not function_row.proisstrict
               and function_row.proparallel = 'u'
               and function_row.provariadic = 0
               and pg_catalog.md5(function_row.prosrc) = expected.source_md5
               and pg_catalog.obj_description(
                 function_row.oid, 'pg_proc'
               ) = 'aria:candidate-list-set-preview-authority:0067:'
                   || expected.source_md5
             )
        from (values
          ('public.advance_candidate_list_membership_revisions()',
           'plpgsql'::text, 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[],
           '9503b3155d4fe3331fc20a3f5892dcaa'::text),
          ('public.reject_candidate_list_member_truncate()',
           'plpgsql', 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[],
           'f7d6d315b9909ecee5bcecead6c57076'),
          ('public.guard_candidate_list_membership_revision()',
           'plpgsql', 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[],
           '79aa9728debec055c553496bfaed60d9'),
          ('public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)',
           'sql', 's'::"char", false, null::text[],
           'ec33c813e301ac6ffc106a662744dfaa'),
          ('public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)',
           'plpgsql', 's'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[],
           'ce8cdb4e8d0b3e5aa1e8566913965da8')
        ) expected(
          signature, language_name, volatility, security_definer,
          config, source_md5
        )
        left join pg_catalog.pg_proc function_row
          on function_row.oid = to_regprocedure(expected.signature)
        left join pg_catalog.pg_language language_row
          on language_row.oid = function_row.prolang
    )
    and (
      select pg_catalog.count(*) = 3
             and pg_catalog.bool_and(
               function_row.pronargs = 0
               and function_row.pronargdefaults = 0
               and function_row.proargnames is null
               and function_row.proargmodes is null
               and function_row.proallargtypes is null
               and function_row.prorettype = 'pg_catalog.trigger'::regtype
               and not function_row.proretset
             )
        from pg_catalog.pg_proc function_row
       where function_row.oid in (
         to_regprocedure(
           'public.advance_candidate_list_membership_revisions()'
         ),
         to_regprocedure('public.reject_candidate_list_member_truncate()'),
         to_regprocedure(
           'public.guard_candidate_list_membership_revision()'
         )
       )
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
       where function_row.oid = to_regprocedure(
               'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'
             )
         and function_row.pronargs = 7
         and function_row.pronargdefaults = 0
         and function_row.prorettype = 'pg_catalog.record'::regtype
         and function_row.proretset
         and function_row.proargnames = array[
           'p_workspace_id', 'p_left_list_id', 'p_right_list_id',
           'p_operation', 'p_after_campaign_id', 'p_after_candidate_id',
           'p_consume_limit', 'campaign_id', 'candidate_id', 'relation',
           'disposition', 'emit', 'is_lookahead'
         ]::text[]
         and function_row.proargmodes = array[
           'i', 'i', 'i', 'i', 'i', 'i', 'i',
           't', 't', 't', 't', 't', 't'
         ]::"char"[]
         and function_row.proallargtypes = array[
           'pg_catalog.uuid'::regtype::oid,
           'pg_catalog.uuid'::regtype::oid,
           'pg_catalog.uuid'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.int4'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.text'::regtype::oid,
           'pg_catalog.bool'::regtype::oid,
           'pg_catalog.bool'::regtype::oid
         ]::oid[]
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
       where function_row.oid = to_regprocedure(
               'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
             )
         and function_row.pronargs = 8
         and function_row.pronargdefaults = 0
         and function_row.prorettype = 'pg_catalog.jsonb'::regtype
         and not function_row.proretset
         and function_row.proargnames = array[
           'p_left_list_id', 'p_left_revision', 'p_right_list_id',
           'p_right_revision', 'p_operation', 'p_after_campaign_id',
           'p_after_candidate_id', 'p_limit'
         ]::text[]
         and function_row.proargmodes is null
         and function_row.proallargtypes is null
    )
    and not exists (
      select 1
        from (values
          ('public.advance_candidate_list_membership_revisions()', null::text),
          ('public.reject_candidate_list_member_truncate()', null::text),
          ('public.guard_candidate_list_membership_revision()', null::text),
          ('public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)', null::text),
          ('public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)', 'authenticated'::text)
        ) target(signature, allowed_role)
        join pg_catalog.pg_proc function_row
          on function_row.oid = to_regprocedure(target.signature)
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where acl_entry.privilege_type = 'EXECUTE'
         and acl_entry.grantee <> function_row.proowner
         and not (
           target.allowed_role is not null
           and acl_entry.grantee = (
             select role_row.oid
               from pg_catalog.pg_roles role_row
              where role_row.rolname = target.allowed_role
           )
           and not acl_entry.is_grantable
         )
    )
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
      ),
      'EXECUTE'
    ), false)
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where function_row.oid = to_regprocedure(
               'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
             )
         and acl_entry.grantee = (
           select role_row.oid
             from pg_catalog.pg_roles role_row
            where role_row.rolname = 'authenticated'
         )
         and acl_entry.privilege_type = 'EXECUTE'
         and not acl_entry.is_grantable
    )
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'
      ),
      'EXECUTE'
    ), false)
    and (
      select pg_catalog.count(*) = 4
             and pg_catalog.bool_and(
               trigger_row.tgenabled = 'O'
               and not trigger_row.tgisinternal
               and trigger_row.tgconstraint = 0
               and not trigger_row.tgdeferrable
               and not trigger_row.tginitdeferred
               and trigger_row.tgnargs = 0
               and trigger_row.tgargs = ''::bytea
               and trigger_row.tgqual is null
             )
        from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid in (
         'public.candidate_lists'::regclass,
         'public.candidate_list_members'::regclass
       )
         and trigger_row.tgname in (
           'candidate_list_members_advance_revision_after_insert',
           'candidate_list_members_advance_revision_after_delete',
           'candidate_list_members_reject_truncate',
           'candidate_lists_guard_membership_revision'
         )
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.candidate_list_members'::regclass
         and trigger_row.tgname =
             'candidate_list_members_advance_revision_after_insert'
         and trigger_row.tgfoid = to_regprocedure(
               'public.advance_candidate_list_membership_revisions()'
             )
         and trigger_row.tgtype = 4
         and trigger_row.tgnewtable = 'inserted_rows'
         and trigger_row.tgoldtable is null
         and cardinality(trigger_row.tgattr::smallint[]) = 0
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.candidate_list_members'::regclass
         and trigger_row.tgname =
             'candidate_list_members_advance_revision_after_delete'
         and trigger_row.tgfoid = to_regprocedure(
               'public.advance_candidate_list_membership_revisions()'
             )
         and trigger_row.tgtype = 8
         and trigger_row.tgoldtable = 'deleted_rows'
         and trigger_row.tgnewtable is null
         and cardinality(trigger_row.tgattr::smallint[]) = 0
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.candidate_list_members'::regclass
         and trigger_row.tgname = 'candidate_list_members_reject_truncate'
         and trigger_row.tgfoid = to_regprocedure(
               'public.reject_candidate_list_member_truncate()'
             )
         and trigger_row.tgtype = 34
         and trigger_row.tgnewtable is null
         and trigger_row.tgoldtable is null
         and cardinality(trigger_row.tgattr::smallint[]) = 0
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.candidate_lists'::regclass
         and trigger_row.tgname =
             'candidate_lists_guard_membership_revision'
         and trigger_row.tgfoid = to_regprocedure(
               'public.guard_candidate_list_membership_revision()'
             )
         and trigger_row.tgtype = 19
         and trigger_row.tgnewtable is null
         and trigger_row.tgoldtable is null
         and cardinality(trigger_row.tgattr::smallint[]) = 1
         and (trigger_row.tgattr::smallint[])[0] = (
           select attribute.attnum
             from pg_catalog.pg_attribute attribute
            where attribute.attrelid = 'public.candidate_lists'::regclass
              and attribute.attname = 'membership_revision'
         )
    )
    into catalog_is_exact;

  if not coalesce(catalog_is_exact, false) then
    raise exception
      'refusing 0067 rollback because the candidate-list set-preview catalog is incompatible or partial'
      using errcode = '55000';
  end if;

  select
    (
      select pg_catalog.count(*) = 2
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
       where namespace_row.nspname = 'public'
         and function_row.proname in (
           'add_candidate_list_member',
           'add_candidate_list_member_pre0067'
         )
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_language language_row
          on language_row.oid = function_row.prolang
       where function_row.oid = to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
         and language_row.lanname = 'plpgsql'
         and function_row.prokind = 'f'
         and function_row.pronargs = 4
         and function_row.pronargdefaults = 0
         and function_row.proargnames = array[
           'p_list_id', 'p_campaign_id', 'p_candidate_id',
           'p_idempotency_key'
         ]::text[]
         and function_row.proargmodes is null
         and function_row.provolatile = 'v'
         and function_row.proparallel = 'u'
         and function_row.provariadic = 0
         and function_row.prosecdef
         and not function_row.proisstrict
         and not function_row.proleakproof
         and function_row.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
         and not function_row.proretset
         and function_row.proallargtypes is null
         and function_row.proconfig = array[
           'search_path=pg_catalog, public, pg_temp'
         ]::text[]
         and pg_catalog.md5(function_row.prosrc) =
             '3867226b6607b5a2170a9d9e7653d5d9'
         and pg_catalog.obj_description(function_row.oid, 'pg_proc') =
             'aria:candidate-list-set-preview-authority:0067:'
             || '3867226b6607b5a2170a9d9e7653d5d9'
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_language language_row
          on language_row.oid = function_row.prolang
       where function_row.oid = to_regprocedure(
               'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
             )
         and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
         and language_row.lanname = 'plpgsql'
         and function_row.prokind = 'f'
         and function_row.pronargs = 4
         and function_row.pronargdefaults = 0
         and function_row.proargnames = array[
           'p_list_id', 'p_campaign_id', 'p_candidate_id',
           'p_idempotency_key'
         ]::text[]
         and function_row.proargmodes is null
         and function_row.provolatile = 'v'
         and function_row.proparallel = 'u'
         and function_row.provariadic = 0
         and function_row.prosecdef
         and not function_row.proisstrict
         and not function_row.proleakproof
         and function_row.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
         and not function_row.proretset
         and function_row.proallargtypes is null
         and function_row.proconfig = array[
           'search_path=pg_catalog, public, extensions, pg_temp'
         ]::text[]
         and pg_catalog.md5(function_row.prosrc) =
             'd23ad55aa139891e7b7c8c441dffeddc'
         and pg_catalog.obj_description(function_row.oid, 'pg_proc') =
             'aria:candidate-list-set-preview-authority:0067:'
             || 'd23ad55aa139891e7b7c8c441dffeddc'
    )
    and not exists (
      select 1
        from (values
          ('public.add_candidate_list_member_pre0067(uuid,text,text,uuid)', null::text),
          ('public.add_candidate_list_member(uuid,text,text,uuid)', 'authenticated'::text)
        ) target(signature, allowed_role)
        join pg_catalog.pg_proc function_row
          on function_row.oid = to_regprocedure(target.signature)
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where acl_entry.privilege_type = 'EXECUTE'
         and acl_entry.grantee <> function_row.proowner
         and not (
           target.allowed_role is not null
           and acl_entry.grantee = (
             select role_row.oid
               from pg_catalog.pg_roles role_row
              where role_row.rolname = target.allowed_role
           )
           and not acl_entry.is_grantable
         )
    )
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.add_candidate_list_member(uuid,text,text,uuid)'
      ),
      'EXECUTE'
    ), false)
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where function_row.oid = to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and acl_entry.grantee = (
           select role_row.oid
             from pg_catalog.pg_roles role_row
            where role_row.rolname = 'authenticated'
         )
         and acl_entry.privilege_type = 'EXECUTE'
         and not acl_entry.is_grantable
    )
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      to_regprocedure(
        'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
      ),
      'EXECUTE'
    ), false)
    into writer_repair_is_exact;

  if not coalesce(writer_repair_is_exact, false) then
    raise exception
      'refusing 0067 rollback because the candidate-list writer repair is incompatible or partial'
      using errcode = '55000';
  end if;

  execute
    'drop trigger if exists candidate_list_members_advance_revision_after_insert on public.candidate_list_members';
  execute
    'drop trigger if exists candidate_list_members_advance_revision_after_delete on public.candidate_list_members';
  execute
    'drop trigger if exists candidate_list_members_reject_truncate on public.candidate_list_members';
  execute
    'drop trigger if exists candidate_lists_guard_membership_revision on public.candidate_lists';

  execute
    'drop function public.add_candidate_list_member(uuid,text,text,uuid)';
  execute
    'alter function public.add_candidate_list_member_pre0067(uuid,text,text,uuid) rename to add_candidate_list_member';
  execute
    'alter function public.add_candidate_list_member(uuid,text,text,uuid) owner to postgres';
  execute
    'alter function public.add_candidate_list_member(uuid,text,text,uuid) volatile';
  execute
    'alter function public.add_candidate_list_member(uuid,text,text,uuid) security definer';
  execute
    'alter function public.add_candidate_list_member(uuid,text,text,uuid) called on null input';
  execute
    'alter function public.add_candidate_list_member(uuid,text,text,uuid) set search_path = pg_catalog, public, extensions, pg_temp';
  execute
    'comment on function public.add_candidate_list_member(uuid,text,text,uuid) is null';
  execute
    'revoke all on function public.add_candidate_list_member(uuid,text,text,uuid) from public, anon, authenticated, service_role, authenticator';
  execute
    'grant execute on function public.add_candidate_list_member(uuid,text,text,uuid) to authenticated';

  execute
    'drop function if exists public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)';
  execute
    'drop function if exists public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)';
  execute
    'drop function if exists public.advance_candidate_list_membership_revisions()';
  execute
    'drop function if exists public.reject_candidate_list_member_truncate()';
  execute
    'drop function if exists public.guard_candidate_list_membership_revision()';

  execute 'drop index if exists public.candidate_list_members_set_preview_idx';
  execute
    'alter table public.candidate_lists drop constraint if exists candidate_lists_membership_revision_nonnegative';
  execute
    'alter table public.candidate_lists drop column if exists membership_revision';
end
$candidate_list_set_preview_rollback_guard$;

commit;
