-- 0067_candidate_list_set_preview_authority.sql
--
-- Add revision-bound, read-only set previews for evidence-authoritative
-- candidate lists. This migration does not authorize export, enrollment, or
-- outreach.

set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('aria-schema-migrations', 0)
);

-- Drain existing list writers in their established order, then distinguish a
-- wholly fresh apply from an exact retry. Any partial or incompatible state
-- refuses before the first schema mutation.
do $candidate_list_set_preview_preflight$
declare
  any_0067_artifact boolean;
  exact_0067_retry boolean;
  exact_0066_writer boolean;
  ledgered_populated_pre0067 boolean := false;
begin
  if pg_catalog.to_regclass('public.workspace_state') is null
     or pg_catalog.to_regclass('public.candidate_list_operation_receipts') is null
     or pg_catalog.to_regclass('public.candidate_lists') is null
     or pg_catalog.to_regclass('public.candidate_list_members') is null
     or pg_catalog.to_regprocedure(
       'public.request_candidate_erasure_pre0066(uuid,uuid,text,text,uuid)'
     ) is null
     or pg_catalog.to_regclass(
       'public.candidate_legal_holds_active_candidate_idx'
     ) is null
     or (
       pg_catalog.to_regprocedure(
         'public.add_candidate_list_member(uuid,text,text,uuid)'
       ) is null
       and pg_catalog.to_regprocedure(
         'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
       ) is null
     ) then
    raise exception '0067 requires the exact 0066 candidate-list foundation'
      using errcode = '55000';
  end if;

  -- workspace_state is the quiescence barrier used by every 0065 add before
  -- it can reach either list/receipt branch. It drains executing predecessor
  -- bodies and holds parsed-but-not-started calls until this transaction has
  -- installed the wrapper.
  lock table public.workspace_state in access exclusive mode;
  lock table public.candidate_list_operation_receipts in access exclusive mode;
  lock table public.candidate_lists in access exclusive mode;
  lock table public.candidate_list_members in access exclusive mode;

  -- The deploy-side preflight is advisory only. Close its TOCTOU window under
  -- the same schema lock used by this migration: an append-only production
  -- history that already contains 0064 may not build this transactional index
  -- over a populated membership table before a separately ratified online
  -- index phase. Ledgerless disposable proof databases remain supported.
  if pg_catalog.to_regclass('public.aria_schema_migrations') is not null then
    execute $ledger_check$
      select
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename = '0064_candidate_lists_authority.sql'
        )
        and not exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename =
                 '0067_candidate_list_set_preview_authority.sql'
        )
        and exists (
          select 1 from public.candidate_list_members member limit 1
        )
    $ledger_check$ into ledgered_populated_pre0067;
  end if;

  if ledgered_populated_pre0067 then
    raise exception '0067 refuses a transactional preview index build on a populated ledgered candidate-list table'
      using errcode = '55000';
  end if;

  select
    (
      select pg_catalog.count(*) = 1
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
       where namespace_row.nspname = 'public'
         and function_row.proname = 'add_candidate_list_member'
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_language language_row
          on language_row.oid = function_row.prolang
       where function_row.oid = pg_catalog.to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
         and language_row.lanname = 'plpgsql'
         and function_row.prokind = 'f'
         and function_row.provolatile = 'v'
         and function_row.prosecdef
         and not function_row.proisstrict
         and not function_row.proleakproof
         and function_row.proparallel = 'u'
         and function_row.provariadic = 0
         and function_row.proconfig = array[
           'search_path=pg_catalog, public, extensions, pg_temp'
         ]::text[]
         and function_row.prorettype = 'pg_catalog.jsonb'::pg_catalog.regtype
         and not function_row.proretset
         and function_row.pronargs = 4
         and function_row.pronargdefaults = 0
         and function_row.proargmodes is null
         and function_row.proallargtypes is null
         and function_row.proargnames = array[
           'p_list_id',
           'p_campaign_id',
           'p_candidate_id',
           'p_idempotency_key'
         ]::text[]
         and pg_catalog.md5(function_row.prosrc) =
             'd23ad55aa139891e7b7c8c441dffeddc'
         and pg_catalog.obj_description(function_row.oid, 'pg_proc') is null
    )
    and not exists (
      select 1
        from pg_catalog.pg_proc function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where function_row.oid = pg_catalog.to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and acl_entry.privilege_type = 'EXECUTE'
         and acl_entry.grantee <> function_row.proowner
         and not (
           acl_entry.grantee = (
             select role_row.oid
               from pg_catalog.pg_roles role_row
              where role_row.rolname = 'authenticated'
           )
           and not acl_entry.is_grantable
         )
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where function_row.oid = pg_catalog.to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and acl_entry.privilege_type = 'EXECUTE'
         and acl_entry.grantee = (
           select role_row.oid
             from pg_catalog.pg_roles role_row
            where role_row.rolname = 'authenticated'
         )
         and not acl_entry.is_grantable
    )
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(
        'public.add_candidate_list_member(uuid,text,text,uuid)'
      ),
      'EXECUTE'
    ), false)
    into exact_0066_writer;

  select
    exists (
      select 1
        from pg_catalog.pg_attribute attribute
       where attribute.attrelid = 'public.candidate_lists'::pg_catalog.regclass
         and attribute.attname = 'membership_revision'
         and attribute.attnum > 0
         and not attribute.attisdropped
    )
    or exists (
      select 1
        from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid =
             'public.candidate_lists'::pg_catalog.regclass
         and constraint_row.conname =
             'candidate_lists_membership_revision_nonnegative'
    )
    or pg_catalog.to_regclass(
         'public.candidate_list_members_set_preview_idx'
       ) is not null
    or exists (
      select 1
        from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid in (
         'public.candidate_lists'::pg_catalog.regclass,
         'public.candidate_list_members'::pg_catalog.regclass
       )
         and trigger_row.tgname in (
           'candidate_list_members_advance_revision_after_insert',
           'candidate_list_members_advance_revision_after_delete',
           'candidate_list_members_reject_truncate',
           'candidate_lists_guard_membership_revision'
         )
         and not trigger_row.tgisinternal
    )
    or exists (
      select 1
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
       where namespace_row.nspname = 'public'
         and function_row.proname in (
           'add_candidate_list_member_pre0067',
           'advance_candidate_list_membership_revisions',
           'reject_candidate_list_member_truncate',
           'guard_candidate_list_membership_revision',
           'candidate_list_set_preview_window',
           'preview_candidate_list_set'
         )
    )
    into any_0067_artifact;

  if not any_0067_artifact then
    if not coalesce(exact_0066_writer, false) then
      raise exception '0067 refuses an incompatible 0066 candidate-list writer'
        using errcode = '55000';
    end if;
    return;
  end if;

  select
    exists (
      select 1
        from pg_catalog.pg_attribute attribute
        join pg_catalog.pg_attrdef default_row
          on default_row.adrelid = attribute.attrelid
         and default_row.adnum = attribute.attnum
       where attribute.attrelid = 'public.candidate_lists'::pg_catalog.regclass
         and attribute.attname = 'membership_revision'
         and attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
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
       where constraint_row.conrelid =
             'public.candidate_lists'::pg_catalog.regclass
         and constraint_row.conname =
             'candidate_lists_membership_revision_nonnegative'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and not constraint_row.condeferrable
         and not constraint_row.condeferred
         and not constraint_row.connoinherit
         and pg_catalog.pg_get_constraintdef(constraint_row.oid)
             = 'CHECK ((membership_revision >= 0))'
         and pg_catalog.array_length(constraint_row.conkey, 1) = 1
         and constraint_row.conkey[1] = (
           select attribute.attnum
             from pg_catalog.pg_attribute attribute
            where attribute.attrelid =
                  'public.candidate_lists'::pg_catalog.regclass
              and attribute.attname = 'membership_revision'
              and not attribute.attisdropped
         )
    )
    and exists (
      select 1
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_row.indexrelid
        join pg_catalog.pg_am access_method
          on access_method.oid = index_relation.relam
       where index_row.indrelid =
             'public.candidate_list_members'::pg_catalog.regclass
         and index_relation.relname = 'candidate_list_members_set_preview_idx'
         and index_relation.relkind = 'i'
         and access_method.amname = 'btree'
         and index_row.indisvalid
         and index_row.indisready
         and not index_row.indisunique
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
         and (index_row.indcollation::oid[])[2] =
             'pg_catalog."C"'::pg_catalog.regcollation
         and (index_row.indcollation::oid[])[3] =
             'pg_catalog."C"'::pg_catalog.regcollation
         and (index_row.indclass::oid[])[0:3] = array[
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
              join pg_catalog.pg_namespace namespace_row
                on namespace_row.oid = operator_class.opcnamespace
              join pg_catalog.pg_am method
                on method.oid = operator_class.opcmethod
             where namespace_row.nspname = 'pg_catalog'
               and method.amname = 'btree'
               and operator_class.opcname = 'uuid_ops'),
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
              join pg_catalog.pg_namespace namespace_row
                on namespace_row.oid = operator_class.opcnamespace
              join pg_catalog.pg_am method
                on method.oid = operator_class.opcmethod
             where namespace_row.nspname = 'pg_catalog'
               and method.amname = 'btree'
               and operator_class.opcname = 'uuid_ops'),
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
              join pg_catalog.pg_namespace namespace_row
                on namespace_row.oid = operator_class.opcnamespace
              join pg_catalog.pg_am method
                on method.oid = operator_class.opcmethod
             where namespace_row.nspname = 'pg_catalog'
               and method.amname = 'btree'
               and operator_class.opcname = 'text_ops'),
           (select operator_class.oid
              from pg_catalog.pg_opclass operator_class
              join pg_catalog.pg_namespace namespace_row
                on namespace_row.oid = operator_class.opcnamespace
              join pg_catalog.pg_am method
                on method.oid = operator_class.opcmethod
             where namespace_row.nspname = 'pg_catalog'
               and method.amname = 'btree'
               and operator_class.opcname = 'text_ops')
         ]::oid[]
         and (index_row.indoption::smallint[])[0:3] =
             array[0, 0, 0, 0]::smallint[]
    )
    and (
      select pg_catalog.count(*) = 7
        from pg_catalog.pg_proc function_row
        join pg_catalog.pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
       where namespace_row.nspname = 'public'
         and function_row.proname in (
           'add_candidate_list_member',
           'add_candidate_list_member_pre0067',
           'advance_candidate_list_membership_revisions',
           'reject_candidate_list_member_truncate',
           'guard_candidate_list_membership_revision',
           'candidate_list_set_preview_window',
           'preview_candidate_list_set'
         )
    )
    and (
      select pg_catalog.count(*) = 7
             and pg_catalog.bool_and(
               function_row.oid is not null
               and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
               and function_row.prokind = 'f'
               and not function_row.proleakproof
               and not function_row.proisstrict
               and function_row.proparallel = 'u'
               and function_row.provariadic = 0
               and case
                 when expected.signature =
                   'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     'd23ad55aa139891e7b7c8c441dffeddc'
                   and function_row.proargnames = array[
                     'p_list_id',
                     'p_campaign_id',
                     'p_candidate_id',
                     'p_idempotency_key'
                   ]::text[]
                   and function_row.proargmodes is null
                   and function_row.proallargtypes is null
                   and function_row.pronargs = 4
                   and function_row.pronargdefaults = 0
                   and function_row.proparallel = 'u'
                   and function_row.prorettype =
                       'pg_catalog.jsonb'::pg_catalog.regtype
                   and not function_row.proretset
                 )
                 when expected.signature =
                   'public.add_candidate_list_member(uuid,text,text,uuid)'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     '3867226b6607b5a2170a9d9e7653d5d9'
                   and function_row.proargnames = array[
                     'p_list_id',
                     'p_campaign_id',
                     'p_candidate_id',
                     'p_idempotency_key'
                   ]::text[]
                   and function_row.proargmodes is null
                   and function_row.proallargtypes is null
                   and function_row.pronargs = 4
                   and function_row.pronargdefaults = 0
                   and function_row.proparallel = 'u'
                   and function_row.prorettype =
                       'pg_catalog.jsonb'::pg_catalog.regtype
                   and not function_row.proretset
                 )
                 when expected.signature =
                   'public.advance_candidate_list_membership_revisions()'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     '9503b3155d4fe3331fc20a3f5892dcaa'
                   and function_row.prorettype =
                       'pg_catalog.trigger'::pg_catalog.regtype
                   and not function_row.proretset
                   and function_row.pronargs = 0
                   and function_row.pronargdefaults = 0
                   and function_row.proargnames is null
                   and function_row.proargmodes is null
                   and function_row.proallargtypes is null
                 )
                 when expected.signature =
                   'public.reject_candidate_list_member_truncate()'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     'f7d6d315b9909ecee5bcecead6c57076'
                   and function_row.prorettype =
                       'pg_catalog.trigger'::pg_catalog.regtype
                   and not function_row.proretset
                   and function_row.pronargs = 0
                   and function_row.pronargdefaults = 0
                   and function_row.proargnames is null
                   and function_row.proargmodes is null
                   and function_row.proallargtypes is null
                 )
                 when expected.signature =
                   'public.guard_candidate_list_membership_revision()'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     '79aa9728debec055c553496bfaed60d9'
                   and function_row.prorettype =
                       'pg_catalog.trigger'::pg_catalog.regtype
                   and not function_row.proretset
                   and function_row.pronargs = 0
                   and function_row.pronargdefaults = 0
                   and function_row.proargnames is null
                   and function_row.proargmodes is null
                   and function_row.proallargtypes is null
                 )
                 when expected.signature =
                   'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     'ec33c813e301ac6ffc106a662744dfaa'
                   and function_row.prorettype =
                       'pg_catalog.record'::pg_catalog.regtype
                   and function_row.proretset
                   and function_row.pronargs = 7
                   and function_row.pronargdefaults = 0
                   and function_row.proargnames = array[
                     'p_workspace_id',
                     'p_left_list_id',
                     'p_right_list_id',
                     'p_operation',
                     'p_after_campaign_id',
                     'p_after_candidate_id',
                     'p_consume_limit',
                     'campaign_id',
                     'candidate_id',
                     'relation',
                     'disposition',
                     'emit',
                     'is_lookahead'
                   ]::text[]
                   and function_row.proargmodes = array[
                     'i', 'i', 'i', 'i', 'i', 'i', 'i',
                     't', 't', 't', 't', 't', 't'
                   ]::"char"[]
                   and function_row.proallargtypes = array[
                     'pg_catalog.uuid'::pg_catalog.regtype::oid,
                     'pg_catalog.uuid'::pg_catalog.regtype::oid,
                     'pg_catalog.uuid'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.int4'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.text'::pg_catalog.regtype::oid,
                     'pg_catalog.bool'::pg_catalog.regtype::oid,
                     'pg_catalog.bool'::pg_catalog.regtype::oid
                   ]::oid[]
                 )
                 when expected.signature =
                   'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
                 then (
                   pg_catalog.md5(function_row.prosrc) =
                     'ce8cdb4e8d0b3e5aa1e8566913965da8'
                   and function_row.prorettype =
                       'pg_catalog.jsonb'::pg_catalog.regtype
                   and not function_row.proretset
                   and function_row.pronargs = 8
                   and function_row.pronargdefaults = 0
                   and function_row.proargnames = array[
                     'p_left_list_id',
                     'p_left_revision',
                     'p_right_list_id',
                     'p_right_revision',
                     'p_operation',
                     'p_after_campaign_id',
                     'p_after_candidate_id',
                     'p_limit'
                   ]::text[]
                   and function_row.proargmodes is null
                   and function_row.proallargtypes is null
                 )
                 else false
               end
               and pg_catalog.obj_description(
                 function_row.oid, 'pg_proc'
               ) = 'aria:candidate-list-set-preview-authority:0067:'
                   || pg_catalog.md5(function_row.prosrc)
             )
        from (values
          ('public.add_candidate_list_member_pre0067(uuid,text,text,uuid)',
           'plpgsql'::text, 'v'::"char", true,
           array['search_path=pg_catalog, public, extensions, pg_temp']::text[]),
          ('public.add_candidate_list_member(uuid,text,text,uuid)',
           'plpgsql'::text, 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[]),
          ('public.advance_candidate_list_membership_revisions()',
           'plpgsql'::text, 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[]),
          ('public.reject_candidate_list_member_truncate()',
           'plpgsql', 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[]),
          ('public.guard_candidate_list_membership_revision()',
           'plpgsql', 'v'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[]),
          ('public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)',
           'sql', 's'::"char", false, null::text[]),
          ('public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)',
           'plpgsql', 's'::"char", true,
           array['search_path=pg_catalog, public, pg_temp']::text[])
        ) expected(signature, language_name, volatility, security_definer, config)
        left join pg_catalog.pg_proc function_row
          on function_row.oid =
             pg_catalog.to_regprocedure(expected.signature)
        left join pg_catalog.pg_language language_row
          on language_row.oid = function_row.prolang
       where language_row.lanname = expected.language_name
         and function_row.provolatile = expected.volatility
         and function_row.prosecdef = expected.security_definer
         and function_row.proconfig is not distinct from expected.config
    )
    and not exists (
      select 1
        from (values
          ('public.add_candidate_list_member_pre0067(uuid,text,text,uuid)', null::text),
          ('public.add_candidate_list_member(uuid,text,text,uuid)', 'authenticated'::text),
          ('public.advance_candidate_list_membership_revisions()', null::text),
          ('public.reject_candidate_list_member_truncate()', null::text),
          ('public.guard_candidate_list_membership_revision()', null::text),
          ('public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)', null::text),
          ('public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)', 'authenticated'::text)
        ) target(signature, allowed_role)
        join pg_catalog.pg_proc function_row
          on function_row.oid = pg_catalog.to_regprocedure(target.signature)
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
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where function_row.oid = pg_catalog.to_regprocedure(
               'public.add_candidate_list_member(uuid,text,text,uuid)'
             )
         and acl_entry.privilege_type = 'EXECUTE'
         and acl_entry.grantee = (
           select role_row.oid
             from pg_catalog.pg_roles role_row
            where role_row.rolname = 'authenticated'
         )
         and not acl_entry.is_grantable
    )
    and exists (
      select 1
        from pg_catalog.pg_proc function_row
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault('f', function_row.proowner)
          )
        ) acl_entry
       where function_row.oid = pg_catalog.to_regprocedure(
               'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
             )
         and acl_entry.privilege_type = 'EXECUTE'
         and acl_entry.grantee = (
           select role_row.oid
             from pg_catalog.pg_roles role_row
            where role_row.rolname = 'authenticated'
         )
         and not acl_entry.is_grantable
    )
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(
        'public.add_candidate_list_member(uuid,text,text,uuid)'
      ),
      'EXECUTE'
    ), false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(
        'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
      ),
      'EXECUTE'
    ), false)
    and coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(
        'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
      ),
      'EXECUTE'
    ), false)
    and not coalesce(pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(
        'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)'
      ),
      'EXECUTE'
    ), false)
    and (
      select pg_catalog.count(*) = 4
             and pg_catalog.bool_and(trigger_row.tgenabled = 'O')
        from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid in (
         'public.candidate_lists'::pg_catalog.regclass,
         'public.candidate_list_members'::pg_catalog.regclass
       )
         and trigger_row.tgname in (
           'candidate_list_members_advance_revision_after_insert',
           'candidate_list_members_advance_revision_after_delete',
           'candidate_list_members_reject_truncate',
           'candidate_lists_guard_membership_revision'
         )
         and not trigger_row.tgisinternal
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.candidate_list_members'::pg_catalog.regclass
         and trigger_row.tgname =
             'candidate_list_members_advance_revision_after_insert'
         and trigger_row.tgfoid =
             pg_catalog.to_regprocedure(
               'public.advance_candidate_list_membership_revisions()'
             )
         and trigger_row.tgnewtable = 'inserted_rows'
         and trigger_row.tgoldtable is null
         and trigger_row.tgtype = 4
         and trigger_row.tgnargs = 0
         and trigger_row.tgqual is null
         and trigger_row.tgconstraint = 0
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.candidate_list_members'::pg_catalog.regclass
         and trigger_row.tgname =
             'candidate_list_members_advance_revision_after_delete'
         and trigger_row.tgfoid =
             pg_catalog.to_regprocedure(
               'public.advance_candidate_list_membership_revisions()'
             )
         and trigger_row.tgoldtable = 'deleted_rows'
         and trigger_row.tgnewtable is null
         and trigger_row.tgtype = 8
         and trigger_row.tgnargs = 0
         and trigger_row.tgqual is null
         and trigger_row.tgconstraint = 0
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
             'public.candidate_list_members'::pg_catalog.regclass
         and trigger_row.tgname = 'candidate_list_members_reject_truncate'
         and trigger_row.tgfoid =
             pg_catalog.to_regprocedure(
               'public.reject_candidate_list_member_truncate()'
             )
         and trigger_row.tgtype = 34
         and trigger_row.tgnargs = 0
         and trigger_row.tgqual is null
         and trigger_row.tgconstraint = 0
         and trigger_row.tgnewtable is null
         and trigger_row.tgoldtable is null
    )
    and exists (
      select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.candidate_lists'::pg_catalog.regclass
         and trigger_row.tgname = 'candidate_lists_guard_membership_revision'
         and trigger_row.tgfoid =
             pg_catalog.to_regprocedure(
               'public.guard_candidate_list_membership_revision()'
             )
         and trigger_row.tgtype = 19
         and trigger_row.tgnargs = 0
         and trigger_row.tgqual is null
         and trigger_row.tgconstraint = 0
         and trigger_row.tgnewtable is null
         and trigger_row.tgoldtable is null
         and pg_catalog.array_length(
               trigger_row.tgattr::smallint[], 1
             ) = 1
         and (trigger_row.tgattr::smallint[])[0] = (
           select attribute.attnum
             from pg_catalog.pg_attribute attribute
            where attribute.attrelid =
                  'public.candidate_lists'::pg_catalog.regclass
              and attribute.attname = 'membership_revision'
         )
    )
    into exact_0067_retry;

  if not coalesce(exact_0067_retry, false) then
    raise exception '0067 refuses incompatible or partial candidate-list set-preview authority'
      using errcode = '55000';
  end if;
end
$candidate_list_set_preview_preflight$;

-- Every post-0067 add enters the workspace quiescence barrier, then receipts,
-- before the predecessor can take a list row lock. This preserves the public
-- API while making workspace_state -> receipts -> lists -> members the exact
-- global order, including first-ever adds with no HMAC secret yet.
do $candidate_list_add_predecessor$
begin
  if pg_catalog.to_regprocedure(
    'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)'
  ) is null then
    alter function public.add_candidate_list_member(uuid, text, text, uuid)
      rename to add_candidate_list_member_pre0067;
  end if;
end
$candidate_list_add_predecessor$;

alter function public.add_candidate_list_member_pre0067(
  uuid, text, text, uuid
) owner to postgres;
revoke all on function public.add_candidate_list_member_pre0067(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role, authenticator;

create or replace function public.add_candidate_list_member(
  p_list_id uuid,
  p_campaign_id text,
  p_candidate_id text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  lock table public.workspace_state in access share mode;
  lock table public.candidate_list_operation_receipts in row share mode;
  return public.add_candidate_list_member_pre0067(
    p_list_id,
    p_campaign_id,
    p_candidate_id,
    p_idempotency_key
  );
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

alter table public.candidate_lists
  add column if not exists membership_revision bigint not null default 0;

comment on column public.candidate_lists.membership_revision is
  'aria:candidate-list-set-preview-authority:0067';

do $candidate_list_set_preview_constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
     where constraint_row.conrelid = 'public.candidate_lists'::pg_catalog.regclass
       and constraint_row.conname =
           'candidate_lists_membership_revision_nonnegative'
  ) then
    alter table public.candidate_lists
      add constraint candidate_lists_membership_revision_nonnegative
      check (membership_revision >= 0);
  end if;
end
$candidate_list_set_preview_constraint$;

create index if not exists candidate_list_members_set_preview_idx
  on public.candidate_list_members (
    workspace_id,
    list_id,
    campaign_id collate pg_catalog."C",
    candidate_id collate pg_catalog."C"
  );

create or replace function public.advance_candidate_list_membership_revisions()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform 1
      from public.candidate_lists list_record
      join (
        select distinct inserted.workspace_id, inserted.list_id
          from inserted_rows inserted
      ) affected
        on affected.workspace_id = list_record.workspace_id
       and affected.list_id = list_record.id
     order by list_record.workspace_id, list_record.id
     for no key update of list_record;

    update public.candidate_lists list_record
       set membership_revision = list_record.membership_revision + 1
      from (
        select distinct inserted.workspace_id, inserted.list_id
          from inserted_rows inserted
      ) affected
     where list_record.workspace_id = affected.workspace_id
       and list_record.id = affected.list_id;
  elsif tg_op = 'DELETE' then
    perform 1
      from public.candidate_lists list_record
      join (
        select distinct deleted.workspace_id, deleted.list_id
          from deleted_rows deleted
      ) affected
        on affected.workspace_id = list_record.workspace_id
       and affected.list_id = list_record.id
     order by list_record.workspace_id, list_record.id
     for no key update of list_record;

    update public.candidate_lists list_record
       set membership_revision = list_record.membership_revision + 1
      from (
        select distinct deleted.workspace_id, deleted.list_id
          from deleted_rows deleted
      ) affected
     where list_record.workspace_id = affected.workspace_id
       and list_record.id = affected.list_id;
  else
    raise exception 'unsupported candidate-list membership revision trigger operation'
      using errcode = '55000';
  end if;
  return null;
end
$$;

create or replace function public.reject_candidate_list_member_truncate()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'candidate-list members cannot be truncated'
    using errcode = '55000';
end
$$;

create or replace function public.guard_candidate_list_membership_revision()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if pg_catalog.pg_trigger_depth() <= 1 then
    raise exception 'candidate-list membership revision is database-managed'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create or replace function public.candidate_list_set_preview_window(
  p_workspace_id uuid,
  p_left_list_id uuid,
  p_right_list_id uuid,
  p_operation text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_consume_limit integer
)
returns table (
  campaign_id text,
  candidate_id text,
  relation text,
  disposition text,
  emit boolean,
  is_lookahead boolean
)
language sql
stable
security invoker
as $$
  with left_source as materialized (
    select member.campaign_id, member.candidate_id
      from public.candidate_list_members member
     where member.workspace_id operator(pg_catalog.=) p_workspace_id
       and member.list_id operator(pg_catalog.=) p_left_list_id
       and (
         p_after_campaign_id is null
         or (member.campaign_id collate pg_catalog."C",
             member.candidate_id collate pg_catalog."C")
            operator(pg_catalog.>)
            (p_after_campaign_id collate pg_catalog."C",
             p_after_candidate_id collate pg_catalog."C")
       )
     order by member.campaign_id collate pg_catalog."C",
              member.candidate_id collate pg_catalog."C"
     limit p_consume_limit operator(pg_catalog.+) 1
  ), left_numbered as materialized (
    select source.campaign_id,
           source.candidate_id,
           pg_catalog.row_number() over (
             order by source.campaign_id collate pg_catalog."C",
                      source.candidate_id collate pg_catalog."C"
           ) as ordinal
      from left_source source
  ), union_right_source as materialized (
    select member.campaign_id, member.candidate_id
      from public.candidate_list_members member
     where p_operation operator(pg_catalog.=) 'union'
       and member.workspace_id operator(pg_catalog.=) p_workspace_id
       and member.list_id operator(pg_catalog.=) p_right_list_id
       and (
         p_after_campaign_id is null
         or (member.campaign_id collate pg_catalog."C",
             member.candidate_id collate pg_catalog."C")
            operator(pg_catalog.>)
            (p_after_campaign_id collate pg_catalog."C",
             p_after_candidate_id collate pg_catalog."C")
       )
     order by member.campaign_id collate pg_catalog."C",
              member.candidate_id collate pg_catalog."C"
     limit p_consume_limit operator(pg_catalog.+) 1
  ), union_merged as materialized (
    select candidate.campaign_id collate pg_catalog."C" as campaign_id,
           candidate.candidate_id collate pg_catalog."C" as candidate_id,
           pg_catalog.bool_or(candidate.on_left) as on_left,
           pg_catalog.bool_or(candidate.on_right) as on_right
      from (
        select source.campaign_id, source.candidate_id,
               true as on_left, false as on_right
          from left_source source
         where p_operation operator(pg_catalog.=) 'union'
        union all
        select source.campaign_id, source.candidate_id,
               false as on_left, true as on_right
          from union_right_source source
      ) candidate
     group by candidate.campaign_id collate pg_catalog."C",
              candidate.candidate_id collate pg_catalog."C"
     order by candidate.campaign_id collate pg_catalog."C",
              candidate.candidate_id collate pg_catalog."C"
     limit p_consume_limit operator(pg_catalog.+) 1
  ), union_numbered as (
    select merged.campaign_id,
           merged.candidate_id,
           merged.on_left,
           merged.on_right,
           pg_catalog.row_number() over (
             order by merged.campaign_id collate pg_catalog."C",
                      merged.candidate_id collate pg_catalog."C"
           ) as ordinal
      from union_merged merged
  ), left_consumed as materialized (
    select source.campaign_id,
           source.candidate_id,
           source.ordinal,
           coalesce(right_match.found, false) as on_right
      from left_numbered source
      left join lateral (
        select true as found
          from public.candidate_list_members right_member
         where right_member.workspace_id operator(pg_catalog.=) p_workspace_id
           and right_member.list_id operator(pg_catalog.=) p_right_list_id
           and right_member.campaign_id collate pg_catalog."C"
               operator(pg_catalog.=)
               source.campaign_id collate pg_catalog."C"
           and right_member.candidate_id collate pg_catalog."C"
               operator(pg_catalog.=)
               source.candidate_id collate pg_catalog."C"
         limit 1
      ) right_match on true
     where p_operation in ('intersection', 'difference', 'exclusion')
       and source.ordinal operator(pg_catalog.<=) p_consume_limit
  ), classified as (
    select source.campaign_id,
           source.candidate_id,
           case
             when source.ordinal operator(pg_catalog.>) p_consume_limit then null
             when source.on_left and source.on_right then 'both'
             when source.on_left then 'left'
             else 'right'
           end as relation,
           case
             when source.ordinal operator(pg_catalog.>) p_consume_limit then null
             else 'included'
           end as disposition,
           source.ordinal operator(pg_catalog.<=) p_consume_limit as emit,
           source.ordinal operator(pg_catalog.>) p_consume_limit as is_lookahead
      from union_numbered source
     where p_operation operator(pg_catalog.=) 'union'

    union all

    select source.campaign_id,
           source.candidate_id,
           case when source.on_right then 'both' else 'left' end,
           case
             when p_operation operator(pg_catalog.=) 'exclusion'
               then case when source.on_right
                    then 'would_exclude' else 'retained' end
             when source.on_right
               then case when p_operation operator(pg_catalog.=) 'intersection'
                    then 'included' else 'excluded' end
             else case when p_operation operator(pg_catalog.=) 'difference'
                  then 'included' else 'excluded' end
           end,
           case
             when p_operation operator(pg_catalog.=) 'intersection'
               then source.on_right
             when p_operation operator(pg_catalog.=) 'difference'
               then not source.on_right
             else true
           end,
           false
      from left_consumed source

    union all

    select source.campaign_id, source.candidate_id,
           null::text, null::text, false, true
      from left_numbered source
     where p_operation in ('intersection', 'difference', 'exclusion')
       and source.ordinal operator(pg_catalog.>) p_consume_limit
  )
  select classified.campaign_id,
         classified.candidate_id,
         classified.relation,
         classified.disposition,
         classified.emit,
         classified.is_lookahead
    from classified
   order by classified.campaign_id collate pg_catalog."C",
            classified.candidate_id collate pg_catalog."C"
$$;

create or replace function public.preview_candidate_list_set(
  p_left_list_id uuid,
  p_left_revision bigint,
  p_right_list_id uuid,
  p_right_revision bigint,
  p_operation text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_workspace_id uuid;
  v_profile_role text;
  v_current_left_revision bigint;
  v_current_right_revision bigint;
  v_items jsonb;
  v_has_more boolean;
  v_cursor_campaign_id text;
  v_cursor_candidate_id text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_actor_id := public.current_active_identity_id();
  v_workspace_id := public.current_workspace_id();
  v_profile_role := public.current_profile_role();
  if v_actor_id is null
     or v_workspace_id is null
     or v_profile_role not in ('viewer', 'member', 'admin') then
    raise exception 'view permission required' using errcode = '42501';
  end if;

  if p_left_list_id is null
     or p_right_list_id is null
     or p_operation is null
     or pg_catalog.octet_length(p_operation) < 1
     or pg_catalog.octet_length(p_operation) > 16
     or p_operation not in ('union', 'intersection', 'difference', 'exclusion')
     or p_limit is null
     or p_limit < 1
     or p_limit > 100
     or (p_left_revision is null) <> (p_right_revision is null)
     or p_left_revision < 0
     or p_right_revision < 0
     or (p_after_campaign_id is null) <> (p_after_candidate_id is null)
     or (
       p_after_campaign_id is not null
       and (
         pg_catalog.octet_length(p_after_campaign_id) < 1
         or pg_catalog.octet_length(p_after_campaign_id) > 120
         or p_after_campaign_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
         or pg_catalog.octet_length(p_after_candidate_id) < 1
         or pg_catalog.octet_length(p_after_candidate_id) > 120
         or p_after_candidate_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
       )
     )
     or (
       p_after_campaign_id is not null
       and p_left_revision is null
     ) then
    raise exception 'invalid candidate-list set-preview request'
      using errcode = '22023';
  end if;

  select
    (
      select list_record.membership_revision
        from public.candidate_lists list_record
       where list_record.workspace_id = v_workspace_id
         and list_record.id = p_left_list_id
    ),
    (
      select list_record.membership_revision
        from public.candidate_lists list_record
       where list_record.workspace_id = v_workspace_id
         and list_record.id = p_right_list_id
    )
    into v_current_left_revision, v_current_right_revision;

  if v_current_left_revision is null or v_current_right_revision is null then
    return pg_catalog.jsonb_build_object('status', 'list_not_found');
  end if;

  if p_left_revision is not null
     and (
       p_left_revision <> v_current_left_revision
       or p_right_revision <> v_current_right_revision
     ) then
    return pg_catalog.jsonb_build_object(
      'status', 'revision_conflict',
      'operation', p_operation,
      'left_revision', v_current_left_revision::text,
      'right_revision', v_current_right_revision::text,
      'items', '[]'::jsonb,
      'has_more', false,
      'next_cursor', null,
      'restart_required', true
    );
  end if;

  with preview_window as materialized (
    select window_row.*
      from public.candidate_list_set_preview_window(
        v_workspace_id,
        p_left_list_id,
        p_right_list_id,
        p_operation,
        p_after_campaign_id,
        p_after_candidate_id,
        p_limit
      ) window_row
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'campaign_id', window_row.campaign_id,
          'candidate_id', window_row.candidate_id,
          'relation', window_row.relation,
          'disposition', window_row.disposition
        )
        order by window_row.campaign_id collate pg_catalog."C",
                 window_row.candidate_id collate pg_catalog."C"
      ) filter (where window_row.emit and not window_row.is_lookahead),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.bool_or(window_row.is_lookahead), false
    ),
    (
      pg_catalog.array_agg(
        window_row.campaign_id
        order by window_row.campaign_id collate pg_catalog."C" desc,
                 window_row.candidate_id collate pg_catalog."C" desc
      ) filter (where not window_row.is_lookahead)
    )[1],
    (
      pg_catalog.array_agg(
        window_row.candidate_id
        order by window_row.campaign_id collate pg_catalog."C" desc,
                 window_row.candidate_id collate pg_catalog."C" desc
      ) filter (where not window_row.is_lookahead)
    )[1]
    into v_items, v_has_more, v_cursor_campaign_id, v_cursor_candidate_id
    from preview_window window_row;

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'operation', p_operation,
    'left_revision', v_current_left_revision::text,
    'right_revision', v_current_right_revision::text,
    'items', v_items,
    'has_more', v_has_more,
    'next_cursor', case when v_has_more then pg_catalog.jsonb_build_object(
      'campaign_id', v_cursor_campaign_id,
      'candidate_id', v_cursor_candidate_id
    ) else null end,
    'restart_required', false
  );
end
$$;

alter function public.advance_candidate_list_membership_revisions()
  owner to postgres;
alter function public.reject_candidate_list_member_truncate()
  owner to postgres;
alter function public.guard_candidate_list_membership_revision()
  owner to postgres;
alter function public.candidate_list_set_preview_window(
  uuid, uuid, uuid, text, text, text, integer
) owner to postgres;
alter function public.preview_candidate_list_set(
  uuid, bigint, uuid, bigint, text, text, text, integer
) owner to postgres;

revoke all on function public.advance_candidate_list_membership_revisions()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.reject_candidate_list_member_truncate()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.guard_candidate_list_membership_revision()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.candidate_list_set_preview_window(
  uuid, uuid, uuid, text, text, text, integer
) from public, anon, authenticated, service_role, authenticator;
revoke all on function public.preview_candidate_list_set(
  uuid, bigint, uuid, bigint, text, text, text, integer
) from public, anon, authenticated, service_role, authenticator;
grant execute on function public.preview_candidate_list_set(
  uuid, bigint, uuid, bigint, text, text, text, integer
) to authenticated;

-- Bind the checked source bodies to the exact-retry preflight. A changed body
-- without its corresponding authority marker is a poisoned partial apply.
do $candidate_list_set_preview_function_markers$
declare
  routine_oid oid;
begin
  for routine_oid in
    select signature::pg_catalog.regprocedure::oid
      from pg_catalog.unnest(array[
        'public.add_candidate_list_member_pre0067(uuid,text,text,uuid)',
        'public.add_candidate_list_member(uuid,text,text,uuid)',
        'public.advance_candidate_list_membership_revisions()',
        'public.reject_candidate_list_member_truncate()',
        'public.guard_candidate_list_membership_revision()',
        'public.candidate_list_set_preview_window(uuid,uuid,uuid,text,text,text,integer)',
        'public.preview_candidate_list_set(uuid,bigint,uuid,bigint,text,text,text,integer)'
      ]) signature
  loop
    execute pg_catalog.format(
      'comment on function %s is %L',
      routine_oid::pg_catalog.regprocedure,
      'aria:candidate-list-set-preview-authority:0067:' || (
        select pg_catalog.md5(function_row.prosrc)
          from pg_catalog.pg_proc function_row
         where function_row.oid = routine_oid
      )
    );
  end loop;
end
$candidate_list_set_preview_function_markers$;

drop trigger if exists candidate_list_members_advance_revision_after_insert
  on public.candidate_list_members;
create trigger candidate_list_members_advance_revision_after_insert
after insert on public.candidate_list_members
referencing new table as inserted_rows
for each statement
execute function public.advance_candidate_list_membership_revisions();

drop trigger if exists candidate_list_members_advance_revision_after_delete
  on public.candidate_list_members;
create trigger candidate_list_members_advance_revision_after_delete
after delete on public.candidate_list_members
referencing old table as deleted_rows
for each statement
execute function public.advance_candidate_list_membership_revisions();

drop trigger if exists candidate_list_members_reject_truncate
  on public.candidate_list_members;
create trigger candidate_list_members_reject_truncate
before truncate on public.candidate_list_members
for each statement
execute function public.reject_candidate_list_member_truncate();

drop trigger if exists candidate_lists_guard_membership_revision
  on public.candidate_lists;
create trigger candidate_lists_guard_membership_revision
before update of membership_revision on public.candidate_lists
for each row
execute function public.guard_candidate_list_membership_revision();
