\set ON_ERROR_STOP on

-- Assertion-only post-migration fixture. The privileged test owner phase must
-- have installed GoTrue's lifecycle shape and the Auth-owned bridge functions
-- before application migrations ran.

do $aria_gotrue_lifecycle_fixture$
begin
  if (
    select count(*)
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
  ) <> 2 then
    raise exception 'disposable GoTrue lifecycle owner phase was not installed';
  end if;

  if to_regprocedure('auth.aria_current_active_identity()') is null
     or to_regprocedure(
       'auth.aria_orphan_owner_recovery_identity_status(uuid,text,text)'
     ) is null then
    raise exception 'disposable GoTrue Auth-owner bridges were not installed';
  end if;

  if to_regprocedure('public.auth_identity_lifecycle_schema_ready()') is not null
     and not public.auth_identity_lifecycle_schema_ready() then
    raise exception 'disposable GoTrue lifecycle owner phase did not satisfy identity readiness';
  end if;
end
$aria_gotrue_lifecycle_fixture$;
