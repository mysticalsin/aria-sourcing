-- ============================================================================
-- Active confirmed identity authority for workspace provisioning
--
-- Workspace/domain membership is security-sensitive. A JWT alone is not enough
-- authority when its backing GoTrue identity is unconfirmed, deleted, or banned.
-- Apply the same active-identity decision to direct PostgREST RLS evaluation and
-- workspace provisioning. This makes revocation effective before JWT expiry.
-- ============================================================================

do $aria_auth_owner_bridge_precondition$
declare
  active_identity_bridge oid :=
    to_regprocedure('auth.aria_current_active_identity()');
  recovery_bridge oid :=
    to_regprocedure('auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)');
begin
  if active_identity_bridge is null or recovery_bridge is null then
    raise exception 'ARIA Auth owner bridge is missing; run owner reconciliation before migrations'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc function_definition
      join pg_catalog.pg_roles function_owner
        on function_owner.oid = function_definition.proowner
     where function_definition.oid = active_identity_bridge
       and function_owner.rolname = 'supabase_auth_admin'
       and function_definition.prosecdef
       and function_definition.provolatile = 's'
       and function_definition.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
       and function_definition.proretset
       and function_definition.prorettype = 'pg_catalog.record'::pg_catalog.regtype
  ) or not exists (
    select 1
      from pg_catalog.pg_proc function_definition
      join pg_catalog.pg_roles function_owner
        on function_owner.oid = function_definition.proowner
     where function_definition.oid = recovery_bridge
       and function_owner.rolname = 'supabase_auth_admin'
       and function_definition.prosecdef
       and function_definition.provolatile = 'v'
       and function_definition.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
       and not function_definition.proretset
       and function_definition.prorettype = 'pg_catalog.text'::pg_catalog.regtype
  ) then
    raise exception 'ARIA Auth owner bridge metadata is invalid'
      using errcode = '55000';
  end if;

  if not pg_catalog.has_schema_privilege('postgres', 'auth', 'USAGE')
     or pg_catalog.has_schema_privilege('postgres', 'auth', 'CREATE')
     or not pg_catalog.has_function_privilege('postgres', active_identity_bridge, 'EXECUTE')
     or not pg_catalog.has_function_privilege('postgres', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', active_identity_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticator', active_identity_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', active_identity_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', active_identity_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticator', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', recovery_bridge, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', recovery_bridge, 'EXECUTE')
     or exists (
       select 1
         from pg_catalog.pg_proc function_definition
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             function_definition.proacl,
             pg_catalog.acldefault('f', function_definition.proowner)
           )
         ) function_acl
        where function_definition.oid in (active_identity_bridge, recovery_bridge)
          and function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'ARIA Auth owner bridge privileges are invalid'
      using errcode = '55000';
  end if;
end
$aria_auth_owner_bridge_precondition$;

create or replace function public.auth_identity_lifecycle_schema_ready()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with bridge_functions as (
    select function_definition.oid,
           function_definition.proname,
           function_definition.prosecdef,
           function_definition.provolatile,
           function_definition.proconfig,
           function_definition.proretset,
           function_definition.prorettype,
           function_definition.proowner,
           function_definition.proacl
      from pg_catalog.pg_proc function_definition
      join pg_catalog.pg_namespace function_schema
        on function_schema.oid = function_definition.pronamespace
     where function_schema.nspname = 'auth'
       and function_definition.oid in (
         to_regprocedure('auth.aria_current_active_identity()'),
         to_regprocedure('auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)')
       )
  )
  select (
    select count(*) = 2
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation
        on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace relation_schema
        on relation_schema.oid = relation.relnamespace
     where relation_schema.nspname = 'auth'
       and relation.relname = 'users'
       and relation.relkind in ('r', 'p')
       and attribute.attnum > 0
       and not attribute.attisdropped
       and attribute.attname in ('deleted_at', 'banned_until')
       and attribute.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype
  )
  and exists (
    select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace relation_schema
        on relation_schema.oid = relation.relnamespace
      join pg_catalog.pg_roles relation_owner
        on relation_owner.oid = relation.relowner
     where relation_schema.nspname = 'auth'
       and relation.relname = 'users'
       and relation.relkind in ('r', 'p')
       and relation_owner.rolname = 'supabase_auth_admin'
       and relation.relrowsecurity
       and not relation.relforcerowsecurity
  )
  and pg_catalog.has_schema_privilege('postgres', 'auth', 'USAGE')
  and not pg_catalog.has_schema_privilege('postgres', 'auth', 'CREATE')
  and (
    select count(*) = 2
      from bridge_functions function_definition
      join pg_catalog.pg_roles function_owner
        on function_owner.oid = function_definition.proowner
     where function_owner.rolname = 'supabase_auth_admin'
       and function_definition.prosecdef
       and function_definition.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
       and (
         (
           function_definition.proname = 'aria_current_active_identity'
           and function_definition.provolatile = 's'
           and function_definition.proretset
           and function_definition.prorettype = 'pg_catalog.record'::pg_catalog.regtype
         )
         or (
           function_definition.proname = 'aria_orphan_owner_recovery_identity_status'
           and function_definition.provolatile = 'v'
           and not function_definition.proretset
           and function_definition.prorettype = 'pg_catalog.text'::pg_catalog.regtype
         )
       )
       and pg_catalog.has_function_privilege('postgres', function_definition.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('anon', function_definition.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticator', function_definition.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('authenticated', function_definition.oid, 'EXECUTE')
       and not pg_catalog.has_function_privilege('service_role', function_definition.oid, 'EXECUTE')
       and not exists (
         select 1
           from pg_catalog.aclexplode(
             coalesce(
               function_definition.proacl,
               pg_catalog.acldefault('f', function_definition.proowner)
             )
           ) function_acl
          where function_acl.grantee = 0
            and function_acl.privilege_type = 'EXECUTE'
       )
  )
$$;

create or replace function public.current_active_identity_id()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  active_identity_id uuid;
begin
  if not public.auth_identity_lifecycle_schema_ready() then
    return null;
  end if;

  select identity.identity_id
    into active_identity_id
    from auth.aria_current_active_identity() identity;
  return active_identity_id;
end
$$;

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select profile.workspace_id
    from public.profiles profile
   where profile.id = public.current_active_identity_id()
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select profile.role
    from public.profiles profile
   where profile.id = public.current_active_identity_id()
$$;

alter function public.auth_identity_lifecycle_schema_ready() owner to postgres;
alter function public.current_active_identity_id() owner to postgres;
alter function public.current_workspace_id() owner to postgres;
alter function public.current_profile_role() owner to postgres;
revoke all on function public.auth_identity_lifecycle_schema_ready()
  from public, anon, authenticator, authenticated, service_role;
revoke all on function public.current_active_identity_id()
  from public, anon, authenticator, authenticated, service_role;
revoke all on function public.current_workspace_id()
  from public, anon, authenticator, authenticated, service_role;
revoke all on function public.current_profile_role()
  from public, anon, authenticator, authenticated, service_role;
grant execute on function public.auth_identity_lifecycle_schema_ready() to service_role;
grant execute on function public.current_active_identity_id() to authenticated;
grant execute on function public.current_workspace_id() to authenticated;
grant execute on function public.current_profile_role() to authenticated;

-- The profile table is the only tenant-scoped table whose policies previously
-- depended on auth.uid() without also consulting current_workspace_id(). Keep
-- the pre-provision insert path, but require an active backing identity for all
-- three client operations.
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select
  using (id = public.current_active_identity_id());

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles for insert
  with check (
    id = public.current_active_identity_id()
    and workspace_id is null
    and role = 'member'
  );

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update
  using (id = public.current_active_identity_id())
  with check (
    id = public.current_active_identity_id()
    and workspace_id is not distinct from public.current_workspace_id()
    and role is not distinct from public.current_profile_role()
  );

create or replace function public.ensure_workspace()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  uid uuid;
  uemail text;
  domain text;
  wid uuid;
  workspace_was_created boolean := false;
begin
  if not public.auth_identity_lifecycle_schema_ready() then
    raise exception 'active identity authority is not ready' using errcode = '55000';
  end if;

  select identity.identity_id, identity.email
    into uid, uemail
    from auth.aria_current_active_identity() identity;

  if not found
     or uid is null
     or uemail is null
     or uemail <> btrim(uemail)
     or octet_length(uemail) not between 3 and 320
     or uemail !~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,253}$'
  then
    raise exception 'active confirmed identity required' using errcode = '42501';
  end if;

  domain := lower(split_part(uemail, '@', 2));
  if domain = ''
     or domain !~ '^[a-z0-9.-]+$'
     or left(domain, 1) = '.'
     or right(domain, 1) = '.'
     or position('..' in domain) > 0 then
    raise exception 'active confirmed identity required' using errcode = '42501';
  end if;

  -- Identity state is checked before this early return so revocation is effective
  -- even when the caller already has a profile row.
  select profile.workspace_id into wid
    from public.profiles profile
   where profile.id = uid;
  if wid is not null then
    return wid;
  end if;

  -- Serialize only users from the same domain. This makes the first-admin grant
  -- deterministic without blocking unrelated tenant provisioning.
  perform pg_advisory_xact_lock(hashtextextended(domain, 0));

  select profile.workspace_id into wid
    from public.profiles profile
   where profile.id = uid;
  if wid is not null then
    return wid;
  end if;

  select workspace.id into wid
    from public.workspaces workspace
   where workspace.allowed_domain = domain;
  if wid is null then
    insert into public.workspaces(name, allowed_domain)
      values (initcap(domain) || ' Workspace', domain)
      returning id into wid;
    workspace_was_created := true;
  end if;

  insert into public.profiles(id, email, full_name, workspace_id, role)
    values (
      uid,
      uemail,
      split_part(uemail, '@', 1),
      wid,
      case when workspace_was_created then 'admin' else 'member' end
    )
    on conflict (id) do update
      set workspace_id = excluded.workspace_id,
          email = excluded.email,
          role = case
            when workspace_was_created then 'admin'
            else public.profiles.role
          end;

  return wid;
end;
$$;

alter function public.ensure_workspace() owner to postgres;
revoke all on function public.ensure_workspace() from public, anon;
grant execute on function public.ensure_workspace() to authenticated;
