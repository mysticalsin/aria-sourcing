\set ON_ERROR_STOP on

begin;

do $aria_direct_postgres_session_test$
begin
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'Function privilege verification requires a direct postgres session';
  end if;
end
$aria_direct_postgres_session_test$;

do $aria_function_privilege_test$
declare
  item record;
  role_name text;
  actual boolean;
  expected boolean;
  public_execute boolean;
  function_def text;
  saved_path text;
  object_owner text;
begin
  for item in
    select * from (values
      ('public.current_workspace_id()',                                      'authenticated', true),
      ('public.current_profile_role()',                                      'authenticated', true),
      ('public.ensure_workspace()',                                          'authenticated', true),
      ('public.record_outreach_approval(text,text,text)',                     'authenticated', true),
      ('public.revoke_outreach_approval(text,text)',                          'authenticated', true),
      ('public.claim_email_outbound(text,text,text,text,text,text,uuid)',      'authenticated', true),
      ('public.review_whatsapp_outbound(uuid,text)',                          'authenticated', true),
      ('public.claim_and_record(text,text,text,uuid,text,integer)',            'service_role',  true),
      ('public.claim_whatsapp_outbound(uuid)',                                'service_role',  true),
      ('public.record_whatsapp_provider_acceptance(uuid,uuid,text)',          'service_role',  true),
      ('public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)', 'service_role', true),
      ('public.claim_whatsapp_inbound_processing(uuid,uuid)',                 'service_role',  true),
      ('public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)',     'service_role',  true),
      ('public.finalize_whatsapp_provider_failure(uuid,uuid,text)',           'service_role',  true),
      ('public.stamp_databricks_connection_authority()',                      'owner_only',    false),
      ('public.audit_databricks_connection_authority()',                      'owner_only',    true),
      ('public.strip_legacy_databricks_authority()',                          'owner_only',    false),
      ('public.normalize_whatsapp_e164(text)',                                'owner_only',    false),
      ('public.touch_updated_at()',                                           'owner_only',    false),
      ('public.enforce_active_whatsapp_approval()',                           'owner_only',    true)
    ) as expected_matrix(signature, allowed_role, security_definer)
  loop
    if to_regprocedure(item.signature) is null then
      raise exception 'Missing expected routine: %', item.signature;
    end if;

    foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
    loop
      expected := role_name = item.allowed_role;
      execute format('select has_function_privilege(%L, %L, %L)', role_name, item.signature, 'EXECUTE') into actual;
      if actual is distinct from expected then
        raise exception 'Unexpected EXECUTE privilege for role % on %: expected %, got %',
          role_name, item.signature, expected, actual;
      end if;
    end loop;

    select exists (
      select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = to_regprocedure(item.signature)
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
    ) into public_execute;
    if public_execute then
      raise exception 'PUBLIC retains EXECUTE on %', item.signature;
    end if;

    select p.prosecdef, array_to_string(p.proconfig, ',')
      into actual, saved_path
      from pg_proc p
     where p.oid = to_regprocedure(item.signature);
    if actual is distinct from item.security_definer then
      raise exception 'Unexpected SECURITY DEFINER state on %', item.signature;
    end if;
    if saved_path is null or saved_path !~ 'search_path=.*pg_temp$' then
      raise exception 'Unsafe saved search_path on %: %', item.signature, saved_path;
    end if;
  end loop;

  if to_regprocedure('public.record_whatsapp_delivery_event(uuid,text,text,timestamptz,integer)') is not null then
    raise exception 'Removed five-argument delivery-event overload still exists';
  end if;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_schema_privilege(role_name, 'public', 'CREATE') then
      raise exception 'Role % retains CREATE on public schema', role_name;
    end if;
    if to_regnamespace('extensions') is not null and has_schema_privilege(role_name, 'extensions', 'CREATE') then
      raise exception 'Role % retains CREATE on extensions schema', role_name;
    end if;
  end loop;

  select pg_get_functiondef(to_regprocedure('public.claim_and_record(text,text,text,uuid,text,integer)'))
    into function_def;
  if function_def ~* 'auth\.role\(\).*service_role' then
    raise exception 'claim_and_record service JWT assertion breaks the authenticated SECURITY DEFINER wrapper';
  end if;

  for item in
    select signature from (values
      ('public.claim_whatsapp_outbound(uuid)'),
      ('public.record_whatsapp_provider_acceptance(uuid,uuid,text)'),
      ('public.record_whatsapp_delivery_event(uuid,uuid,text,text,timestamptz,integer)'),
      ('public.claim_whatsapp_inbound_processing(uuid,uuid)'),
      ('public.complete_whatsapp_inbound_processing(uuid,uuid,text,text)'),
      ('public.finalize_whatsapp_provider_failure(uuid,uuid,text)')
    ) as service_functions(signature)
  loop
    select pg_get_functiondef(to_regprocedure(item.signature)) into function_def;
    if function_def !~* 'auth\.role\(\).*service_role' then
      raise exception 'Service RPC lacks an in-body service_role assertion: %', item.signature;
    end if;
  end loop;

  execute 'create table public.__aria_default_acl_table_probe(id bigint)';
  execute 'create sequence public.__aria_default_acl_sequence_probe';
  execute 'create function public.__aria_default_acl_function_probe() returns integer language sql as ''select 1''';

  select pg_get_userbyid(relowner) into object_owner
    from pg_class where oid = 'public.__aria_default_acl_table_probe'::regclass;
  if object_owner <> 'postgres' then
    raise exception 'Postgres direct-session probe has unexpected owner: %', object_owner;
  end if;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'SELECT')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'INSERT')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'UPDATE')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'DELETE')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'TRUNCATE')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'REFERENCES')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'TRIGGER')
       or has_table_privilege(role_name, 'public.__aria_default_acl_table_probe', 'MAINTAIN') then
      raise exception 'New tables expose privileges to role %', role_name;
    end if;
    if has_sequence_privilege(role_name, 'public.__aria_default_acl_sequence_probe', 'USAGE')
       or has_sequence_privilege(role_name, 'public.__aria_default_acl_sequence_probe', 'SELECT')
       or has_sequence_privilege(role_name, 'public.__aria_default_acl_sequence_probe', 'UPDATE') then
      raise exception 'New sequences expose privileges to role %', role_name;
    end if;
    if has_function_privilege(role_name, 'public.__aria_default_acl_function_probe()', 'EXECUTE') then
      raise exception 'New functions expose EXECUTE to role %', role_name;
    end if;
  end loop;

  select exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = to_regprocedure('public.__aria_default_acl_function_probe()')
       and acl.grantee = 0
  ) into public_execute;
  if public_execute then
    raise exception 'New functions still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where c.oid = 'public.__aria_default_acl_table_probe'::regclass
       and acl.grantee = 0
  ) into public_execute;
  if public_execute then
    raise exception 'New tables still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) acl
     where c.oid = 'public.__aria_default_acl_sequence_probe'::regclass
       and acl.grantee = 0
  ) into public_execute;
  if public_execute then
    raise exception 'New sequences still inherit PUBLIC privileges';
  end if;

  execute 'drop function public.__aria_default_acl_function_probe()';
  execute 'drop sequence public.__aria_default_acl_sequence_probe';
  execute 'drop table public.__aria_default_acl_table_probe';
end
$aria_function_privilege_test$;

do $aria_supabase_admin_default_acl_test$
declare
  role_name text;
  public_privilege boolean;
  object_owner text;
begin
  if to_regclass('public.__aria_supabase_admin_default_acl_table_probe') is null
     or to_regclass('public.__aria_supabase_admin_default_acl_sequence_probe') is null
     or to_regprocedure('public.__aria_supabase_admin_default_acl_function_probe()') is null then
    raise exception 'Missing probes from the direct supabase_admin session';
  end if;

  select pg_get_userbyid(relowner) into object_owner
    from pg_class
   where oid = 'public.__aria_supabase_admin_default_acl_table_probe'::regclass;
  if object_owner <> 'supabase_admin' then
    raise exception 'Supabase owner probe has unexpected owner: %', object_owner;
  end if;
  select pg_get_userbyid(proowner) into object_owner
    from pg_proc
   where oid = to_regprocedure('public.__aria_supabase_admin_default_acl_function_probe()');
  if object_owner <> 'supabase_admin' then
    raise exception 'Supabase owner function has unexpected owner: %', object_owner;
  end if;

  foreach role_name in array array['anon', 'authenticator', 'authenticated', 'service_role']
  loop
    if has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'SELECT')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'INSERT')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'UPDATE')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'DELETE')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'TRUNCATE')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'REFERENCES')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'TRIGGER')
       or has_table_privilege(role_name, 'public.__aria_supabase_admin_default_acl_table_probe', 'MAINTAIN') then
      raise exception 'New supabase_admin tables expose privileges to role %', role_name;
    end if;
    if has_sequence_privilege(role_name, 'public.__aria_supabase_admin_default_acl_sequence_probe', 'USAGE')
       or has_sequence_privilege(role_name, 'public.__aria_supabase_admin_default_acl_sequence_probe', 'SELECT')
       or has_sequence_privilege(role_name, 'public.__aria_supabase_admin_default_acl_sequence_probe', 'UPDATE') then
      raise exception 'New supabase_admin sequences expose privileges to role %', role_name;
    end if;
    if has_function_privilege(
      role_name,
      'public.__aria_supabase_admin_default_acl_function_probe()',
      'EXECUTE'
    ) then
      raise exception 'New supabase_admin functions expose EXECUTE to role %', role_name;
    end if;
  end loop;

  select exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = to_regprocedure('public.__aria_supabase_admin_default_acl_function_probe()')
       and acl.grantee = 0
  ) into public_privilege;
  if public_privilege then
    raise exception 'New supabase_admin functions still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where c.oid = 'public.__aria_supabase_admin_default_acl_table_probe'::regclass
       and acl.grantee = 0
  ) into public_privilege;
  if public_privilege then
    raise exception 'New supabase_admin tables still inherit PUBLIC privileges';
  end if;
  select exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) acl
     where c.oid = 'public.__aria_supabase_admin_default_acl_sequence_probe'::regclass
       and acl.grantee = 0
  ) into public_privilege;
  if public_privilege then
    raise exception 'New supabase_admin sequences still inherit PUBLIC privileges';
  end if;
end
$aria_supabase_admin_default_acl_test$;

rollback;
