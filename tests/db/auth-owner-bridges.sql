\set ON_ERROR_STOP on

-- Direct restricted-postgres verification for the narrow Auth-owner bridge
-- boundary. This runs immediately after owner reconciliation and before any
-- application migration can depend on the functions.
begin;

do $aria_auth_owner_bridge_contract$
declare
  current_identity_oid oid :=
    'auth.aria_current_active_identity()'::regprocedure::oid;
  recovery_identity_oid oid :=
    'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)'::regprocedure::oid;
  function_record record;
  unexpected_acl_count bigint;
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'Auth-owner bridge contract requires direct postgres session';
  end if;

  select function_owner.rolname as owner_name,
         function_definition.prosecdef,
         function_definition.provolatile,
         function_definition.proconfig,
         pg_catalog.pg_get_function_result(function_definition.oid) as result_shape
    into function_record
    from pg_catalog.pg_proc function_definition
    join pg_catalog.pg_roles function_owner
      on function_owner.oid = function_definition.proowner
   where function_definition.oid = current_identity_oid;
  if function_record.owner_name <> 'supabase_auth_admin'
     or not function_record.prosecdef
     or function_record.provolatile <> 's'
     or function_record.proconfig is distinct from
       array['search_path=pg_catalog, pg_temp']::text[]
     or function_record.result_shape <> 'TABLE(identity_id uuid, email text)' then
    raise exception 'current-identity bridge metadata drifted: %',
      row_to_json(function_record);
  end if;

  select function_owner.rolname as owner_name,
         function_definition.prosecdef,
         function_definition.provolatile,
         function_definition.proconfig,
         pg_catalog.pg_get_function_result(function_definition.oid) as result_shape
    into function_record
    from pg_catalog.pg_proc function_definition
    join pg_catalog.pg_roles function_owner
      on function_owner.oid = function_definition.proowner
   where function_definition.oid = recovery_identity_oid;
  if function_record.owner_name <> 'supabase_auth_admin'
     or not function_record.prosecdef
     or function_record.provolatile <> 'v'
     or function_record.proconfig is distinct from
       array['search_path=pg_catalog, pg_temp']::text[]
     or function_record.result_shape <> 'text' then
    raise exception 'owner-recovery bridge metadata drifted: %',
      row_to_json(function_record);
  end if;

  if not pg_catalog.has_schema_privilege('postgres', 'auth', 'USAGE')
     or pg_catalog.has_schema_privilege('postgres', 'auth', 'CREATE') then
    raise exception 'postgres Auth schema boundary is not usage-only';
  end if;

  if not pg_catalog.has_function_privilege(
       'postgres', current_identity_oid, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'postgres', recovery_identity_oid, 'EXECUTE'
     ) then
    raise exception 'postgres cannot execute the bounded Auth-owner bridges';
  end if;

  if pg_catalog.has_function_privilege('anon', current_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', current_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', current_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticator', current_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', recovery_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', recovery_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', recovery_identity_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticator', recovery_identity_oid, 'EXECUTE') then
    raise exception 'an API role can execute an internal Auth-owner bridge';
  end if;

  select count(*)
    into unexpected_acl_count
    from pg_catalog.pg_proc function_definition
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_definition.proacl,
        pg_catalog.acldefault('f', function_definition.proowner)
      )
    ) function_acl
    left join pg_catalog.pg_roles grantee
      on grantee.oid = function_acl.grantee
   where function_definition.oid in (current_identity_oid, recovery_identity_oid)
     and function_acl.privilege_type = 'EXECUTE'
     and coalesce(grantee.rolname, 'PUBLIC') not in (
       'supabase_auth_admin', 'postgres'
     );
  if unexpected_acl_count <> 0 then
    raise exception 'Auth-owner bridge execute ACL contains unexpected grantees';
  end if;

  if exists (select 1 from auth.aria_current_active_identity()) then
    raise exception 'current-identity bridge returned authority without an authenticated JWT';
  end if;

  begin
    perform auth.aria_orphan_owner_recovery_identity_status(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'owner@example.test',
      'marker'
    );
    raise exception 'owner-recovery bridge accepted a non-service JWT';
  exception
    when insufficient_privilege then null;
  end;
end
$aria_auth_owner_bridge_contract$;

rollback;
