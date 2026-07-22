-- Narrow Auth-owner bridges for application routines that must evaluate the
-- live GoTrue identity behind a JWT while auth.users has RLS enabled.
--
-- This file is included only by the direct supabase_admin owner phase. The
-- functions return bounded decisions instead of exposing auth.users rows, and
-- only the restricted postgres routine owner may execute them.

select (
  to_regclass('auth.users') is not null
  and to_regprocedure('auth.uid()') is not null
  and to_regprocedure('auth.role()') is not null
) as aria_auth_bridge_dependencies_ready \gset

\if :aria_auth_bridge_dependencies_ready
create or replace function auth.aria_current_active_identity()
returns table(identity_id uuid, email text)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $aria_current_active_identity$
  select identity.id, identity.email
    from auth.users as identity
   where coalesce(auth.role(), '') = 'authenticated'
     and identity.id = auth.uid()
     and identity.email is not null
     and identity.email = btrim(identity.email)
     and octet_length(identity.email) between 3 and 320
     and identity.email ~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,253}$'
     and identity.confirmed_at is not null
     -- The base database image creates auth.users before GoTrue adds these
     -- lifecycle columns. Deny authority until both exact columns exist.
     and (
       select count(*) = 2
         from pg_catalog.pg_attribute as attribute
         join pg_catalog.pg_class as relation
           on relation.oid = attribute.attrelid
         join pg_catalog.pg_namespace as relation_schema
           on relation_schema.oid = relation.relnamespace
        where relation_schema.nspname = 'auth'
          and relation.relname = 'users'
          and relation.relkind in ('r', 'p')
          and attribute.attnum > 0
          and not attribute.attisdropped
          and attribute.attname in ('deleted_at', 'banned_until')
          and attribute.atttypid = 'pg_catalog.timestamptz'::pg_catalog.regtype
     )
     and to_jsonb(identity) ? 'deleted_at'
     and to_jsonb(identity) ? 'banned_until'
     and nullif(to_jsonb(identity) ->> 'deleted_at', '') is null
     and (
       nullif(to_jsonb(identity) ->> 'banned_until', '') is null
       or (to_jsonb(identity) ->> 'banned_until')::pg_catalog.timestamptz <= now()
     )
$aria_current_active_identity$;

create or replace function auth.aria_orphan_owner_recovery_identity_status(
  p_profile_id uuid,
  p_canonical_email text,
  p_expected_identity_marker text
)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $aria_orphan_owner_recovery_identity_status$
declare
  auth_user_record auth.users%rowtype;
  auth_user_json jsonb;
  auth_user_count bigint;
  banned_until_value timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_profile_id is null
     or p_canonical_email is null
     or p_expected_identity_marker is null then
    return 'identity_not_eligible';
  end if;

  -- SHARE conflicts with GoTrue's insert/update/delete table lock and remains
  -- held until the outer recovery transaction ends.
  lock table auth.users in share mode;
  select count(*) into auth_user_count from auth.users;
  if auth_user_count <> 1 then
    return 'auth_inventory_mismatch';
  end if;

  select * into auth_user_record
    from auth.users
   where id = p_profile_id
   for share;
  if not found then
    return 'identity_not_eligible';
  end if;

  auth_user_json := to_jsonb(auth_user_record);
  if not (auth_user_json ? 'banned_until')
     or not (auth_user_json ? 'deleted_at') then
    return 'identity_schema_unsupported';
  end if;

  if auth_user_record.email is distinct from p_canonical_email
     or auth_user_record.email is distinct from lower(auth_user_record.email)
     or auth_user_record.confirmed_at is null
     or coalesce(auth_user_record.encrypted_password, '') = ''
     or auth_user_record.aud is distinct from 'authenticated'
     or auth_user_record.role is distinct from 'authenticated'
     or auth_user_record.raw_app_meta_data ->> 'provider' is distinct from 'email'
     or auth_user_record.raw_app_meta_data -> 'providers' is distinct from '["email"]'::jsonb
     or auth_user_record.raw_user_meta_data ->> 'aria_owner_recovery_marker'
       is distinct from p_expected_identity_marker
     or jsonb_typeof(auth_user_json -> 'deleted_at') is distinct from 'null' then
    return 'identity_not_eligible';
  end if;

  if jsonb_typeof(auth_user_json -> 'banned_until') = 'string' then
    begin
      banned_until_value := (auth_user_json ->> 'banned_until')::pg_catalog.timestamptz;
    exception when others then
      return 'identity_not_eligible';
    end;
    if banned_until_value > now() then
      return 'identity_not_eligible';
    end if;
  elsif jsonb_typeof(auth_user_json -> 'banned_until') is distinct from 'null' then
    return 'identity_not_eligible';
  end if;

  return 'eligible';
end
$aria_orphan_owner_recovery_identity_status$;

alter function auth.aria_current_active_identity()
  owner to supabase_auth_admin;
alter function auth.aria_orphan_owner_recovery_identity_status(uuid, text, text)
  owner to supabase_auth_admin;

revoke all on function auth.aria_current_active_identity()
  from public, anon, authenticator, authenticated, service_role, postgres;
revoke all on function auth.aria_orphan_owner_recovery_identity_status(uuid, text, text)
  from public, anon, authenticator, authenticated, service_role, postgres;
grant usage on schema auth to postgres;
grant execute on function auth.aria_current_active_identity() to postgres;
grant execute on function auth.aria_orphan_owner_recovery_identity_status(uuid, text, text)
  to postgres;
\endif

\unset aria_auth_bridge_dependencies_ready
