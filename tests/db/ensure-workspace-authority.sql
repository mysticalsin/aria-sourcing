\set ON_ERROR_STOP on

-- Characterization and authority coverage for migration 0018. Synthetic users,
-- profiles, and workspaces are rolled back in the same database session.
begin;

create schema aria_workspace_db_test;
revoke all on schema aria_workspace_db_test from public;
grant usage on schema aria_workspace_db_test to anon, authenticated;

create function aria_workspace_db_test.assert_sqlstate(
  case_name text,
  statement text,
  expected_codes text[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  caught_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics caught_state = returned_sqlstate;
    if caught_state = any(expected_codes) then
      return;
    end if;
    raise exception 'Case "%" returned SQLSTATE %, expected one of %',
      case_name, caught_state, expected_codes;
  end;
  raise exception 'Case "%" unexpectedly succeeded', case_name;
end;
$$;

create function aria_workspace_db_test.assert_scalar(
  case_name text,
  statement text,
  expected_value text
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  actual_value text;
begin
  execute statement into actual_value;
  if actual_value is distinct from expected_value then
    raise exception 'Case "%" returned %, expected %',
      case_name, actual_value, expected_value;
  end if;
end;
$$;

create function aria_workspace_db_test.set_claims(subject uuid, jwt_role text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', subject, 'role', jwt_role)::text,
    true
  );
  perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
  perform set_config('request.jwt.claim.role', jwt_role, true);
end;
$$;

revoke all on all functions in schema aria_workspace_db_test from public;
grant execute on all functions in schema aria_workspace_db_test
  to anon, authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'Founder@Brand.Example.Test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'e2000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'Joiner@BRAND.EXAMPLE.TEST', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'e3000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'Founder@Other.Example.Test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'e4000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'Existing.Member@Brand.Example.Test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

-- An unauthenticated API role cannot invoke the provisioning routine.
select aria_workspace_db_test.set_claims(null, 'anon');
set local role anon;
select aria_workspace_db_test.assert_sqlstate(
  'anonymous ensure_workspace call is denied',
  'select public.ensure_workspace()',
  array['42501']
);
reset role;

-- The first authenticated user for a new normalized domain creates the exact
-- domain workspace and receives the only creation-time admin grant.
select aria_workspace_db_test.set_claims(
  'e1000000-0000-4000-8000-000000000001', 'authenticated'
);
set local role authenticated;
select public.ensure_workspace();
reset role;

select aria_workspace_db_test.assert_scalar(
  'first authenticated user creates an exact-domain workspace as admin',
  $sql$
    select (
      count(*) = 1
      and bool_and(w.allowed_domain = 'brand.example.test')
      and bool_and(p.workspace_id = w.id)
      and bool_and(p.role = 'admin')
      and bool_and(p.email = 'Founder@Brand.Example.Test')
    )::text
      from public.workspaces w
      join public.profiles p
        on p.workspace_id = w.id
       and p.id = 'e1000000-0000-4000-8000-000000000001'
     where w.allowed_domain = 'brand.example.test'
  $sql$,
  'true'
);

-- A second authenticated user with the same case-insensitive domain joins the
-- existing workspace and cannot receive the creation-time admin grant.
select aria_workspace_db_test.set_claims(
  'e2000000-0000-4000-8000-000000000002', 'authenticated'
);
set local role authenticated;
select public.ensure_workspace();
reset role;

select aria_workspace_db_test.assert_scalar(
  'second same-domain user joins the existing workspace as member',
  $sql$
    select (
      count(*) = 1
      and (select workspace_id from public.profiles
            where id = 'e1000000-0000-4000-8000-000000000001')
          =
          (select workspace_id from public.profiles
            where id = 'e2000000-0000-4000-8000-000000000002')
      and (select role from public.profiles
            where id = 'e2000000-0000-4000-8000-000000000002') = 'member'
    )::text
      from public.workspaces
     where allowed_domain = 'brand.example.test'
  $sql$,
  'true'
);

-- Repeated calls return the existing profile workspace before any role write.
select aria_workspace_db_test.set_claims(
  'e2000000-0000-4000-8000-000000000002', 'authenticated'
);
set local role authenticated;
select public.ensure_workspace();
select public.ensure_workspace();
reset role;

select aria_workspace_db_test.assert_scalar(
  'repeat ensure_workspace calls never elevate an existing member profile',
  $sql$
    select (role = 'member')::text
      from public.profiles
     where id = 'e2000000-0000-4000-8000-000000000002'
  $sql$,
  'true'
);

-- A profile that predates the call is equally protected from elevation.
insert into public.profiles (id, email, full_name, workspace_id, role)
select
  'e4000000-0000-4000-8000-000000000004',
  'Existing.Member@Brand.Example.Test',
  'Existing Member',
  id,
  'member'
from public.workspaces
where allowed_domain = 'brand.example.test';

select aria_workspace_db_test.set_claims(
  'e4000000-0000-4000-8000-000000000004', 'authenticated'
);
set local role authenticated;
select public.ensure_workspace();
reset role;

select aria_workspace_db_test.assert_scalar(
  'pre-existing member profile remains a member after ensure_workspace',
  $sql$
    select (
      p.role = 'member'
      and p.workspace_id = w.id
      and w.allowed_domain = 'brand.example.test'
    )::text
      from public.profiles p
      join public.workspaces w on w.id = p.workspace_id
     where p.id = 'e4000000-0000-4000-8000-000000000004'
  $sql$,
  'true'
);

-- The first user on another domain receives a separate workspace. Domain
-- normalization must never merge unrelated tenants.
select aria_workspace_db_test.set_claims(
  'e3000000-0000-4000-8000-000000000003', 'authenticated'
);
set local role authenticated;
select public.ensure_workspace();
reset role;

select aria_workspace_db_test.assert_scalar(
  'cross-domain users receive distinct exact-domain workspaces',
  $sql$
    select (
      count(*) = 2
      and (select workspace_id from public.profiles
            where id = 'e1000000-0000-4000-8000-000000000001')
          <>
          (select workspace_id from public.profiles
            where id = 'e3000000-0000-4000-8000-000000000003')
      and (select role from public.profiles
            where id = 'e3000000-0000-4000-8000-000000000003') = 'admin'
      and exists (
        select 1 from public.workspaces
         where allowed_domain = 'brand.example.test'
      )
      and exists (
        select 1 from public.workspaces
         where allowed_domain = 'other.example.test'
      )
    )::text
      from public.workspaces
     where allowed_domain in ('brand.example.test', 'other.example.test')
  $sql$,
  'true'
);

rollback;
