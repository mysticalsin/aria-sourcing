\set ON_ERROR_STOP on

begin;

-- This file owns the only superuser-required bootstrap work. Application
-- migrations use a separate postgres session after this transaction commits.
set local log_statement = 'none';
set local log_min_error_statement = 'panic';
set local log_parameter_max_length_on_error = 0;

do $aria_owner_identity$
declare
  owner_is_superuser boolean;
begin
  select rolsuper
    into owner_is_superuser
    from pg_roles
   where rolname = current_user;

  if session_user <> 'supabase_admin'
     or current_user <> 'supabase_admin'
     or owner_is_superuser is not true then
    raise exception 'direct supabase_admin superuser session required'
      using errcode = '42501';
  end if;
end
$aria_owner_identity$;

\getenv supabase_admin_target_password SUPABASE_ADMIN_TARGET_PASSWORD
\if :{?supabase_admin_target_password}
\else
\set supabase_admin_target_password ''
\endif
\getenv postgres_target_password POSTGRES_TARGET_PASSWORD
\if :{?postgres_target_password}
\else
\set postgres_target_password ''
\endif
\getenv supabase_auth_admin_target_password SUPABASE_AUTH_ADMIN_TARGET_PASSWORD
\if :{?supabase_auth_admin_target_password}
\else
\set supabase_auth_admin_target_password ''
\endif
\getenv authenticator_target_password AUTHENTICATOR_TARGET_PASSWORD
\if :{?authenticator_target_password}
\else
\set authenticator_target_password ''
\endif
\getenv jwt_secret JWT_SECRET
\if :{?jwt_secret}
\else
\set jwt_secret ''
\endif
\getenv jwt_exp JWT_EXP
\if :{?jwt_exp}
\else
\set jwt_exp ''
\endif

create temporary table aria_bootstrap_inputs (
  input_name text primary key,
  input_value text not null,
  input_format text not null check (input_format in ('base64url', 'positive_integer')),
  must_be_distinct boolean not null
) on commit drop;

insert into aria_bootstrap_inputs (input_name, input_value, input_format, must_be_distinct)
values
  ('supabase_admin_password', :'supabase_admin_target_password', 'base64url', true),
  ('postgres_password', :'postgres_target_password', 'base64url', true),
  ('supabase_auth_admin_password', :'supabase_auth_admin_target_password', 'base64url', true),
  ('authenticator_password', :'authenticator_target_password', 'base64url', true),
  ('jwt_secret', :'jwt_secret', 'base64url', true),
  ('jwt_exp', :'jwt_exp', 'positive_integer', false);

do $aria_secret_contract$
begin
  if exists (
    select 1 from aria_bootstrap_inputs where input_value = ''
  ) then
    raise exception 'bootstrap secret and configuration inputs must be nonempty';
  end if;

  if exists (
    select 1
     from aria_bootstrap_inputs
     where input_format = 'base64url'
       and input_value !~ '^[A-Za-z0-9_-]{43,128}$'
  ) then
    raise exception 'bootstrap secrets must be 43 to 128 base64url characters';
  end if;

  if exists (
    select 1
      from aria_bootstrap_inputs
     where input_format = 'positive_integer'
       and input_value !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'JWT_EXP must be a positive integer';
  end if;

  if (
    select count(distinct input_value) = count(*)
      from aria_bootstrap_inputs
     where must_be_distinct
  ) is not true then
    raise exception 'active database passwords and JWT secret must be distinct';
  end if;
end
$aria_secret_contract$;

-- The application migrator keeps direct session identity but no cluster-wide
-- administration capability and no inherited role authority. Object grants,
-- not role substitution, are the only migration authorization mechanism.
select format('revoke %I from postgres', granted_role.rolname)
  from pg_auth_members membership
  join pg_roles granted_role on granted_role.oid = membership.roleid
  join pg_roles member_role on member_role.oid = membership.member
 where member_role.rolname = 'postgres'
\gexec
alter role postgres
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

do $aria_role_contract$
begin
  if (
    select count(distinct rolname)
      from pg_roles
     where rolname in (
       'supabase_admin',
       'postgres',
       'supabase_auth_admin',
       'authenticator'
     )
  ) <> 4 then
    raise exception 'required active database roles are missing';
  end if;

  if exists (
    select 1
      from pg_roles
     where rolname = 'postgres'
       and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'postgres migrator retains a cluster-wide privilege';
  end if;

  if exists (
    select 1
      from pg_auth_members membership
      join pg_roles member_role on member_role.oid = membership.member
     where member_role.rolname = 'postgres'
  ) then
    raise exception 'postgres migrator must not retain role memberships or admin options';
  end if;
end
$aria_role_contract$;

-- Supabase configures permissive defaults independently for each creating
-- role. These statements intentionally omit FOR ROLE: current_user owns the
-- default ACL and no membership or postgres elevation is required.
alter default privileges revoke all on tables from public;
alter default privileges revoke all on sequences from public;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role, authenticator;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role, authenticator;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role, authenticator;

-- Rotate every active network login with SQL-literal quoting. psql variables
-- never enter shell interpolation, and statement/error logging is disabled for
-- this transaction before any secret-bearing statement is generated.
select format('alter role %I login password %L', 'postgres', :'postgres_target_password')
\gexec
select format(
  'alter role %I login password %L',
  'supabase_auth_admin',
  :'supabase_auth_admin_target_password'
)
\gexec
select format(
  'alter role %I login password %L',
  'authenticator',
  :'authenticator_target_password'
)
\gexec
select format(
  'alter role %I login password %L',
  'supabase_admin',
  :'supabase_admin_target_password'
)
\gexec

-- These pinned-image roles are not used by this topology. Leaving their
-- bootstrap password active would preserve alternate BYPASSRLS, replication,
-- storage, or pooler login paths. Optional roles are changed only when present.
select format('alter role %I nologin password null', rolname)
  from pg_roles
 where rolname in (
   'pgbouncer',
   'supabase_storage_admin',
   'supabase_functions_admin',
   'supabase_etl_admin',
   'supabase_read_only_user',
   'supabase_replication_admin'
 )
\gexec

-- Hand the complete Auth surface to the dedicated GoTrue role while the
-- direct owner session is still active. This remains safe on a fresh image
-- before Auth exists and idempotent on every later owner phase.
do $aria_auth_owner$
declare
  item record;
begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    return;
  end if;

  execute 'alter schema auth owner to supabase_auth_admin';
  for item in
    select format('alter table auth.%I owner to supabase_auth_admin', tablename) as command
      from pg_tables
     where schemaname = 'auth'
  loop
    execute item.command;
  end loop;

  for item in
    select format(
      'alter function auth.%I(%s) owner to supabase_auth_admin',
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as command
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth'
  loop
    execute item.command;
  end loop;
end
$aria_auth_owner$;

-- Install the bounded Auth-owner routines next to this reconciliation file.
-- The included file guards early base-image passes where auth.users does not
-- exist yet; the final owner pass installs and reasserts the exact ACLs.
\ir auth-owner-bridges.sql

-- Keep database JWT settings in the same owner transaction as credential and
-- ownership changes. Values are SQL-literal quoted and statement logging is
-- disabled before they are materialized.
select format(
  'alter database %I set "app.settings.jwt_secret" to %L',
  current_database(),
  input_value
)
  from aria_bootstrap_inputs
 where input_name = 'jwt_secret'
\gexec
select format(
  'alter database %I set "app.settings.jwt_exp" to %L',
  current_database(),
  input_value
)
  from aria_bootstrap_inputs
 where input_name = 'jwt_exp'
\gexec

do $aria_login_allowlist$
declare
  unexpected_roles text;
begin
  if (
    select count(distinct rolname)
      from pg_authid
     where rolname in (
       'supabase_admin',
       'postgres',
       'supabase_auth_admin',
       'authenticator'
     )
       and rolcanlogin
       and rolpassword is not null
  ) <> 4 then
    raise exception 'active database login reconciliation is incomplete';
  end if;

  if (
    select count(distinct rolpassword)
      from pg_authid
     where rolname in (
       'supabase_admin',
       'postgres',
       'supabase_auth_admin',
       'authenticator'
     )
  ) <> 4 then
    raise exception 'active database credential verifier count is invalid';
  end if;

  if exists (
    select 1
      from pg_authid
     where rolname in (
       'pgbouncer',
       'supabase_storage_admin',
       'supabase_functions_admin',
       'supabase_etl_admin',
       'supabase_read_only_user',
       'supabase_replication_admin'
     )
       and (rolcanlogin or rolpassword is not null)
  ) then
    raise exception 'unused Supabase login roles must remain disabled';
  end if;

  select string_agg(rolname, ', ' order by rolname)
    into unexpected_roles
    from pg_roles
   where rolcanlogin
     and rolname not in (
       'supabase_admin',
       'postgres',
       'supabase_auth_admin',
       'authenticator'
     )
     and rolname !~ '^pg_';

  if unexpected_roles is not null then
    raise exception 'unexpected non-system LOGIN roles remain: %', unexpected_roles;
  end if;
end
$aria_login_allowlist$;

commit;

\unset supabase_admin_target_password
\unset postgres_target_password
\unset supabase_auth_admin_target_password
\unset authenticator_target_password
\unset jwt_secret
\unset jwt_exp
