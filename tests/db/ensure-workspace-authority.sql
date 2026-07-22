\set ON_ERROR_STOP on

-- Characterization and authority coverage for migration 0018. Synthetic users,
-- profiles, workspaces, and test helpers are deleted before commit. Only the
-- two GoTrue-owned lifecycle columns remain for subsequent disposable-DB tests.
begin;

create schema aria_workspace_db_test;
revoke all on schema aria_workspace_db_test from public;
grant usage on schema aria_workspace_db_test to anon, authenticated, service_role;

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
  to anon, authenticated, service_role;

-- The pinned PostgreSQL image creates auth.users before GoTrue adds its
-- revocation columns. That transitional state must deny identity authority and
-- make the deep Auth readiness probe fail closed without blocking migration.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'e8000000-0000-4000-8000-000000000008',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'pre-gotrue@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

set local role service_role;
select aria_workspace_db_test.assert_scalar(
  'missing GoTrue lifecycle columns fail Auth readiness closed',
  'select public.auth_identity_lifecycle_schema_ready()::text',
  'false'
);
reset role;

select aria_workspace_db_test.set_claims(
  'e8000000-0000-4000-8000-000000000008', 'authenticated'
);
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'missing GoTrue lifecycle columns deny active identity authority',
  'select (public.current_active_identity_id() is null)::text',
  'true'
);
reset role;

delete from auth.users
 where id = 'e8000000-0000-4000-8000-000000000008';

alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users enable row level security;
alter table auth.users no force row level security;

set local role service_role;
select aria_workspace_db_test.assert_scalar(
  'exact GoTrue lifecycle columns satisfy Auth readiness',
  'select public.auth_identity_lifecycle_schema_ready()::text',
  'true'
);
reset role;

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

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  deleted_at, banned_until, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    'e5000000-0000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'user@unconfirmed.example.test', '', null,
    null, null, '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'e6000000-0000-4000-8000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'user@deleted.example.test', '', now(),
    now(), null, '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'e7000000-0000-4000-8000-000000000007',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'user@banned.example.test', '', now(),
    null, now() + interval '1 day', '{}'::jsonb, '{}'::jsonb, now(), now()
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

-- Identity revocation is checked before both tenant creation and the existing-
-- profile early return. None of these callers may mutate tenant state.
select aria_workspace_db_test.set_claims(
  'e5000000-0000-4000-8000-000000000005', 'authenticated'
);
set local role authenticated;
select aria_workspace_db_test.assert_sqlstate(
  'unconfirmed identity cannot provision a workspace',
  'select public.ensure_workspace()',
  array['42501']
);
reset role;

select aria_workspace_db_test.set_claims(
  'e6000000-0000-4000-8000-000000000006', 'authenticated'
);
set local role authenticated;
select aria_workspace_db_test.assert_sqlstate(
  'deleted identity cannot provision a workspace',
  'select public.ensure_workspace()',
  array['42501']
);
reset role;

select aria_workspace_db_test.set_claims(
  'e7000000-0000-4000-8000-000000000007', 'authenticated'
);
set local role authenticated;
select aria_workspace_db_test.assert_sqlstate(
  'currently banned identity cannot provision a workspace',
  'select public.ensure_workspace()',
  array['42501']
);
reset role;

select aria_workspace_db_test.assert_scalar(
  'inactive identities create no workspace or profile rows',
  $sql$
    select (
      not exists (
        select 1 from public.profiles
         where id in (
           'e5000000-0000-4000-8000-000000000005',
           'e6000000-0000-4000-8000-000000000006',
           'e7000000-0000-4000-8000-000000000007'
         )
      )
      and not exists (
        select 1 from public.workspaces
         where allowed_domain in (
           'unconfirmed.example.test',
           'deleted.example.test',
           'banned.example.test'
         )
      )
    )::text
  $sql$,
  'true'
);

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

-- Direct PostgREST requests evaluate these helpers and policies without going
-- through Next.js getUser(). Reuse one unchanged JWT claim set while changing
-- only the backing GoTrue identity to prove immediate revocation before expiry.
select set_config(
  'aria_workspace_db_test.workspace_id',
  (select workspace_id::text
     from public.profiles
    where id = 'e1000000-0000-4000-8000-000000000001'),
  true
);

insert into public.workspace_state(workspace_id, state)
values (
  current_setting('aria_workspace_db_test.workspace_id')::uuid,
  '{"revocation_test":true}'::jsonb
)
on conflict (workspace_id) do update set state = excluded.state;

insert into public.agent_seats(workspace_id, name, operator_email)
values (
  current_setting('aria_workspace_db_test.workspace_id')::uuid,
  'Revocation Test Seat',
  'revocation-seat@example.test'
);

select aria_workspace_db_test.assert_scalar(
  'complete profile RLS policy set requires an active backing identity',
  $sql$
    select (
      count(*) = 3
      and count(*) filter (
        where policyname in (
          'own profile read',
          'own profile insert',
          'own profile update'
        )
      ) = 3
      and bool_and(
        coalesce(qual, '') || coalesce(with_check, '')
          like '%current_active_identity_id%'
      )
    )::text
      from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
  $sql$,
  'true'
);

select aria_workspace_db_test.assert_scalar(
  'active identity helpers are owned by postgres',
  $sql$
    select (
      count(*) = 3
      and bool_and(pg_get_userbyid(function_row.proowner) = 'postgres')
    )::text
      from pg_proc function_row
      join pg_namespace function_schema
        on function_schema.oid = function_row.pronamespace
     where function_schema.nspname = 'public'
       and function_row.proname in (
         'current_active_identity_id',
         'current_workspace_id',
         'current_profile_role'
       )
  $sql$,
  'true'
);

select aria_workspace_db_test.set_claims(
  'e1000000-0000-4000-8000-000000000001', 'authenticated'
);
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'active identity retains direct PostgREST RLS authority',
  $sql$
    select (
      public.current_active_identity_id()
        = 'e1000000-0000-4000-8000-000000000001'
      and public.current_workspace_id()
        = current_setting('aria_workspace_db_test.workspace_id')::uuid
      and public.current_profile_role() = 'admin'
      and (select count(*) from public.profiles) = 1
      and (select count(*) from public.workspaces) = 1
      and (select count(*) from public.workspace_state) = 1
      and (select count(*) from public.agent_seats) = 1
    )::text
  $sql$,
  'true'
);

insert into public.agent_seats(workspace_id, name, operator_email)
values (
  current_setting('aria_workspace_db_test.workspace_id')::uuid,
  'Authorized Active Seat',
  'authorized-active@example.test'
);
select aria_workspace_db_test.assert_scalar(
  'active administrator retains direct PostgREST write authority',
  'select (count(*) = 2)::text from public.agent_seats',
  'true'
);
reset role;

update auth.users
   set banned_until = now() + interval '1 day'
 where id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'currently banned identity loses direct PostgREST RLS authority',
  $sql$
    select (
      public.current_active_identity_id() is null
      and public.current_workspace_id() is null
      and public.current_profile_role() is null
      and (select count(*) from public.profiles) = 0
      and (select count(*) from public.workspaces) = 0
      and (select count(*) from public.workspace_state) = 0
      and (select count(*) from public.agent_seats) = 0
    )::text
  $sql$,
  'true'
);
select aria_workspace_db_test.assert_sqlstate(
  'currently banned identity cannot use direct PostgREST admin write',
  $sql$
    insert into public.agent_seats(workspace_id, name, operator_email)
    values (
      current_setting('aria_workspace_db_test.workspace_id')::uuid,
      'Denied Banned Seat',
      'denied-banned@example.test'
    )
  $sql$,
  array['42501']
);
reset role;

update auth.users
   set banned_until = now() - interval '1 second'
 where id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'expired ban restores active identity authority',
  $sql$
    select (
      public.current_active_identity_id()
        = 'e1000000-0000-4000-8000-000000000001'
      and public.current_workspace_id()
        = current_setting('aria_workspace_db_test.workspace_id')::uuid
      and public.current_profile_role() = 'admin'
    )::text
  $sql$,
  'true'
);
reset role;

update auth.users
   set banned_until = null, deleted_at = now()
 where id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'soft-deleted identity loses direct PostgREST RLS authority',
  $sql$
    select (
      public.current_active_identity_id() is null
      and public.current_workspace_id() is null
      and public.current_profile_role() is null
      and (select count(*) from public.profiles) = 0
      and (select count(*) from public.workspace_state) = 0
      and (select count(*) from public.agent_seats) = 0
    )::text
  $sql$,
  'true'
);
select aria_workspace_db_test.assert_sqlstate(
  'soft-deleted identity cannot use direct PostgREST admin write',
  $sql$
    insert into public.agent_seats(workspace_id, name, operator_email)
    values (
      current_setting('aria_workspace_db_test.workspace_id')::uuid,
      'Denied Deleted Seat',
      'denied-deleted@example.test'
    )
  $sql$,
  array['42501']
);
reset role;

update auth.users
   set deleted_at = null, confirmed_at = null
 where id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'unconfirmed existing identity loses direct PostgREST RLS authority',
  $sql$
    select (
      public.current_active_identity_id() is null
      and public.current_workspace_id() is null
      and public.current_profile_role() is null
      and (select count(*) from public.profiles) = 0
      and (select count(*) from public.workspace_state) = 0
      and (select count(*) from public.agent_seats) = 0
    )::text
  $sql$,
  'true'
);
select aria_workspace_db_test.assert_sqlstate(
  'unconfirmed existing identity cannot use direct PostgREST admin write',
  $sql$
    insert into public.agent_seats(workspace_id, name, operator_email)
    values (
      current_setting('aria_workspace_db_test.workspace_id')::uuid,
      'Denied Unconfirmed Seat',
      'denied-unconfirmed@example.test'
    )
  $sql$,
  array['42501']
);
reset role;

update auth.users
   set confirmed_at = now()
 where id = 'e1000000-0000-4000-8000-000000000001';
delete from auth.users
 where id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select aria_workspace_db_test.assert_scalar(
  'missing identity loses direct PostgREST RLS authority',
  $sql$
    select (
      public.current_active_identity_id() is null
      and public.current_workspace_id() is null
      and public.current_profile_role() is null
      and (select count(*) from public.workspaces) = 0
      and (select count(*) from public.workspace_state) = 0
      and (select count(*) from public.agent_seats) = 0
    )::text
  $sql$,
  'true'
);
select aria_workspace_db_test.assert_sqlstate(
  'missing identity cannot use direct PostgREST admin write',
  $sql$
    insert into public.agent_seats(workspace_id, name, operator_email)
    values (
      current_setting('aria_workspace_db_test.workspace_id')::uuid,
      'Denied Missing Seat',
      'denied-missing@example.test'
    )
  $sql$,
  array['42501']
);
reset role;

delete from public.agent_seats
 where operator_email in (
   'revocation-seat@example.test',
   'authorized-active@example.test'
 );
delete from public.workspace_state
 where workspace_id in (
   select id
     from public.workspaces
    where allowed_domain in ('brand.example.test', 'other.example.test')
 );
delete from public.profiles
 where id in (
   'e1000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000002',
   'e3000000-0000-4000-8000-000000000003',
   'e4000000-0000-4000-8000-000000000004',
   'e5000000-0000-4000-8000-000000000005',
   'e6000000-0000-4000-8000-000000000006',
   'e7000000-0000-4000-8000-000000000007'
 );
delete from public.workspaces
 where allowed_domain in ('brand.example.test', 'other.example.test');
delete from auth.users
 where id in (
   'e1000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000002',
   'e3000000-0000-4000-8000-000000000003',
   'e4000000-0000-4000-8000-000000000004',
   'e5000000-0000-4000-8000-000000000005',
   'e6000000-0000-4000-8000-000000000006',
   'e7000000-0000-4000-8000-000000000007'
 );
drop schema aria_workspace_db_test cascade;

commit;
