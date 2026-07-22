\set ON_ERROR_STOP on

-- This suite runs after every numbered migration in a disposable PostgreSQL
-- database. Everything is transactional so no test identity or fixture remains.
begin;

create schema aria_db_test;
revoke all on schema aria_db_test from public;
grant usage on schema aria_db_test to anon, authenticated, service_role;

create function aria_db_test.assert_sqlstate(
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

create function aria_db_test.assert_affected(
  case_name text,
  statement text,
  expected_rows bigint
)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  affected_rows bigint;
begin
  execute statement;
  get diagnostics affected_rows = row_count;
  if affected_rows is distinct from expected_rows then
    raise exception 'Case "%" affected % rows, expected %',
      case_name, affected_rows, expected_rows;
  end if;
end;
$$;

create function aria_db_test.assert_scalar(
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

-- Supabase/PostgREST versions have used both the consolidated claims JSON GUC
-- and the legacy per-claim GUCs. Set both so auth.uid()/auth.role() exercise the
-- same identity regardless of which compatible implementation the pinned image
-- exposes.
create function aria_db_test.set_claims(subject uuid, jwt_role text)
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

revoke all on all functions in schema aria_db_test from public;
grant execute on all functions in schema aria_db_test
  to anon, authenticated, service_role;

-- Deterministic identities and tenants. These are synthetic test-only values.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-one@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'member-one@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'viewer-one@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin-two@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.workspaces (id, name, allowed_domain)
values
  ('11111111-1111-4111-8111-111111111111', 'Authority Test One', 'one.example.test'),
  ('22222222-2222-4222-8222-222222222222', 'Authority Test Two', 'two.example.test');

insert into public.profiles (id, email, full_name, workspace_id, role)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'admin-one@example.test', 'Admin One',
    '11111111-1111-4111-8111-111111111111', 'admin'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'member-one@example.test', 'Member One',
    '11111111-1111-4111-8111-111111111111', 'member'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'viewer-one@example.test', 'Viewer One',
    '11111111-1111-4111-8111-111111111111', 'viewer'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'admin-two@example.test', 'Admin Two',
    '22222222-2222-4222-8222-222222222222', 'admin'
  );

insert into public.api_keys (
  id, workspace_id, name, provider, secret, last4, status, created_by
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Databricks W1', 'Databricks', 'test-only-credential-marker-one',
    'udit', 'valid', 'authority-test'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Wrong Provider W1', 'Tavily', 'test-only-credential-marker-two',
    'cret', 'untested', 'authority-test'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '22222222-2222-4222-8222-222222222222',
    'Databricks W2', 'Databricks', 'test-only-credential-marker-three',
    'cret', 'valid', 'authority-test'
  );

-- Admin one: composite credential authority and owned-row lifecycle.
select aria_db_test.set_claims(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'authenticated'
);
set local role authenticated;

select aria_db_test.assert_sqlstate(
  'wrong-provider credential binding is rejected',
  $sql$
    insert into public.databricks_connections (
      id, workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      'd1000000-0000-4000-8000-000000000010',
      '11111111-1111-4111-8111-111111111111',
      'https://dbc-one.example.test', 'warehouse-one', 'pat',
      '20000000-0000-4000-8000-000000000002',
      'select id from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['23503']
);

select aria_db_test.assert_sqlstate(
  'foreign-workspace credential binding is rejected',
  $sql$
    insert into public.databricks_connections (
      id, workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      'd1000000-0000-4000-8000-000000000011',
      '11111111-1111-4111-8111-111111111111',
      'https://dbc-one.example.test', 'warehouse-one', 'pat',
      '30000000-0000-4000-8000-000000000003',
      'select id from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['23503']
);

insert into public.databricks_connections (
  id,
  workspace_id,
  origin,
  warehouse_id,
  auth_mode,
  api_key_id,
  needs_query,
  config_revision,
  created_by,
  updated_by,
  created_at,
  updated_at
)
values (
  'd1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'https://dbc-one.example.test',
  'warehouse-one',
  'pat',
  '10000000-0000-4000-8000-000000000001',
  'select hidden_marker from hiring_needs where updated_at > :since',
  999,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  '2000-01-01T00:00:00Z',
  '2000-01-01T00:00:00Z'
);

select aria_db_test.assert_scalar(
  'admin can manage its workspace Databricks connection',
  $sql$
    select count(*)::text
      from public.databricks_connections
     where id = 'd1000000-0000-4000-8000-000000000001'
       and workspace_id = '11111111-1111-4111-8111-111111111111'
       and config_revision = 1
       and created_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and updated_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and created_at <> '2000-01-01T00:00:00Z'
       and updated_at <> '2000-01-01T00:00:00Z'
  $sql$,
  '1'
);

update public.databricks_connections
   set id = 'd1000000-0000-4000-8000-000000000099',
       workspace_id = '22222222-2222-4222-8222-222222222222',
       purpose = 'caller-controlled-purpose',
       credential_provider = 'Tavily',
       origin = 'https://dbc-one-updated.example.test',
       config_revision = 999,
       created_by = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       updated_by = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       created_at = '2000-01-01T00:00:00Z',
       updated_at = '2000-01-01T00:00:00Z'
 where id = 'd1000000-0000-4000-8000-000000000001';

select aria_db_test.assert_scalar(
  'Databricks revision and immutable authority fields are database-owned',
  $sql$
    select count(*)::text
      from public.databricks_connections
     where id = 'd1000000-0000-4000-8000-000000000001'
       and workspace_id = '11111111-1111-4111-8111-111111111111'
       and purpose = 'hiring_needs'
       and credential_provider = 'Databricks'
       and origin = 'https://dbc-one-updated.example.test'
       and config_revision = 2
       and created_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and updated_by = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and created_at <> '2000-01-01T00:00:00Z'
       and updated_at <> '2000-01-01T00:00:00Z'
  $sql$,
  '1'
);

select aria_db_test.assert_scalar(
  'caller cannot replace the immutable connection identifier',
  $sql$
    select count(*)::text
      from public.databricks_connections
     where id = 'd1000000-0000-4000-8000-000000000099'
  $sql$,
  '0'
);

reset role;

-- Admin two creates the foreign tenant fixture through the same RLS path.
select aria_db_test.set_claims(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'authenticated'
);
set local role authenticated;

insert into public.databricks_connections (
  id, workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
)
values (
  'd2000000-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  'https://dbc-two.example.test',
  'warehouse-two',
  'pat',
  '30000000-0000-4000-8000-000000000003',
  'select id from hiring_needs where updated_at > :since'
);

reset role;

-- Admin one cannot observe or mutate tenant two.
select aria_db_test.set_claims(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'authenticated'
);
set local role authenticated;

select aria_db_test.assert_scalar(
  'admin cannot manage a foreign workspace Databricks connection',
  $sql$
    select count(*)::text
      from public.databricks_connections
     where workspace_id = '22222222-2222-4222-8222-222222222222'
  $sql$,
  '0'
);
select aria_db_test.assert_affected(
  'admin cannot update a foreign workspace Databricks connection',
  $sql$
    update public.databricks_connections
       set enabled = false
     where workspace_id = '22222222-2222-4222-8222-222222222222'
  $sql$,
  0
);
select aria_db_test.assert_affected(
  'admin cannot delete a foreign workspace Databricks connection',
  $sql$
    delete from public.databricks_connections
     where workspace_id = '22222222-2222-4222-8222-222222222222'
  $sql$,
  0
);
select aria_db_test.assert_sqlstate(
  'admin cannot insert a foreign workspace Databricks connection',
  $sql$
    insert into public.databricks_connections (
      workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'https://blocked-foreign.example.test', 'blocked', 'pat',
      '30000000-0000-4000-8000-000000000003',
      'select id from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_scalar(
  'admin cannot read foreign Databricks audit events',
  $sql$
    select count(*)::text
      from public.databricks_connection_events
     where workspace_id = '22222222-2222-4222-8222-222222222222'
  $sql$,
  '0'
);

reset role;

-- Member: no normalized connection or audit authority, but shared state remains
-- writable and the legacy integration field is removed by PostgreSQL.
select aria_db_test.set_claims(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'authenticated'
);
set local role authenticated;

select aria_db_test.assert_scalar(
  'member cannot read Databricks connections',
  'select count(*)::text from public.databricks_connections',
  '0'
);
select aria_db_test.assert_sqlstate(
  'member cannot insert Databricks connections',
  $sql$
    insert into public.databricks_connections (
      workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'https://member.example.test', 'member', 'pat',
      '10000000-0000-4000-8000-000000000001',
      'select id from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_affected(
  'member cannot update Databricks connections',
  'update public.databricks_connections set enabled = false',
  0
);
select aria_db_test.assert_affected(
  'member cannot delete Databricks connections',
  'delete from public.databricks_connections',
  0
);
select aria_db_test.assert_scalar(
  'member cannot read Databricks audit events',
  'select count(*)::text from public.databricks_connection_events',
  '0'
);
select aria_db_test.assert_sqlstate(
  'member cannot insert Databricks audit events',
  $sql$
    insert into public.databricks_connection_events (
      workspace_id, connection_id, actor_id, action, config_revision, config_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'd1000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'member cannot update Databricks audit events',
  'update public.databricks_connection_events set config_revision = 99',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'member cannot delete Databricks audit events',
  'delete from public.databricks_connection_events',
  array['42501']
);

insert into public.workspace_state (workspace_id, state)
values (
  '11111111-1111-4111-8111-111111111111',
  '{"settings":{"databricks":{"legacyAuthority":"remove-me"},"theme":"dark"},"other":{"keep":true}}'::jsonb
);

select aria_db_test.assert_scalar(
  'legacy Databricks state is stripped without losing unrelated state',
  $sql$
    select (
      (state #> '{settings,databricks}') is null
      and state #>> '{settings,theme}' = 'dark'
      and (state #>> '{other,keep}')::boolean
    )::text
      from public.workspace_state
     where workspace_id = '11111111-1111-4111-8111-111111111111'
  $sql$,
  'true'
);

update public.workspace_state
   set state = '{"settings":{"databricks":{"legacyAuthority":"remove-again"},"theme":"light"},"other":{"keep":true,"newValue":7}}'::jsonb
 where workspace_id = '11111111-1111-4111-8111-111111111111';

select aria_db_test.assert_scalar(
  'legacy Databricks state is stripped on update without losing unrelated state',
  $sql$
    select (
      (state #> '{settings,databricks}') is null
      and state #>> '{settings,theme}' = 'light'
      and (state #>> '{other,keep}')::boolean
      and (state #>> '{other,newValue}')::integer = 7
    )::text
      from public.workspace_state
     where workspace_id = '11111111-1111-4111-8111-111111111111'
  $sql$,
  'true'
);

reset role;

-- Viewer: the authenticated table grants do not override admin-only RLS.
select aria_db_test.set_claims(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'authenticated'
);
set local role authenticated;

select aria_db_test.assert_scalar(
  'viewer cannot read Databricks connections',
  'select count(*)::text from public.databricks_connections',
  '0'
);
select aria_db_test.assert_sqlstate(
  'viewer cannot insert Databricks connections',
  $sql$
    insert into public.databricks_connections (
      workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'https://viewer.example.test', 'viewer', 'pat',
      '10000000-0000-4000-8000-000000000001',
      'select id from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_affected(
  'viewer cannot update Databricks connections',
  'update public.databricks_connections set enabled = false',
  0
);
select aria_db_test.assert_affected(
  'viewer cannot delete Databricks connections',
  'delete from public.databricks_connections',
  0
);
select aria_db_test.assert_scalar(
  'viewer cannot read Databricks audit events',
  'select count(*)::text from public.databricks_connection_events',
  '0'
);
select aria_db_test.assert_sqlstate(
  'viewer cannot insert Databricks audit events',
  $sql$
    insert into public.databricks_connection_events (
      workspace_id, connection_id, actor_id, action, config_revision, config_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'd1000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'viewer cannot update Databricks audit events',
  'update public.databricks_connection_events set config_revision = 99',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'viewer cannot delete Databricks audit events',
  'delete from public.databricks_connection_events',
  array['42501']
);

reset role;

-- Anonymous: table privileges fail before any row policy can disclose state.
select aria_db_test.set_claims(null, 'anon');
set local role anon;

select aria_db_test.assert_sqlstate(
  'anonymous callers cannot access Databricks connections',
  'select count(*) from public.databricks_connections',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot insert Databricks connections',
  $sql$
    insert into public.databricks_connections (
      workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'https://anon.example.test', 'anon', 'pat',
      '10000000-0000-4000-8000-000000000001',
      'select id from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot update Databricks connections',
  'update public.databricks_connections set enabled = false',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot delete Databricks connections',
  'delete from public.databricks_connections',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot access Databricks audit events',
  'select count(*) from public.databricks_connection_events',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot insert Databricks audit events',
  $sql$
    insert into public.databricks_connection_events (
      workspace_id, connection_id, action, config_revision, config_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'd1000000-0000-4000-8000-000000000001',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot update Databricks audit events',
  'update public.databricks_connection_events set config_revision = 99',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'anonymous callers cannot delete Databricks audit events',
  'delete from public.databricks_connection_events',
  array['42501']
);

reset role;

-- The service role is the server-only resolver: read normalized authority, but
-- never execute the trigger-only routines directly.
select aria_db_test.set_claims(null, 'service_role');
set local role service_role;

select aria_db_test.assert_scalar(
  'service role can read normalized Databricks connections',
  'select count(*)::text from public.databricks_connections',
  '2'
);
select aria_db_test.assert_sqlstate(
  'service role cannot write normalized Databricks connections',
  $sql$
    insert into public.databricks_connections (
      workspace_id, origin, warehouse_id, auth_mode, api_key_id, needs_query
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'https://service-write.example.test', 'service-write', 'pat',
      '10000000-0000-4000-8000-000000000001',
      'select * from hiring_needs where updated_at > :since'
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'service role cannot update normalized Databricks connections',
  'update public.databricks_connections set enabled = false',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'service role cannot delete normalized Databricks connections',
  'delete from public.databricks_connections',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'service role cannot access Databricks audit events',
  'select count(*) from public.databricks_connection_events',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'service role cannot insert Databricks audit events',
  $sql$
    insert into public.databricks_connection_events (
      workspace_id, connection_id, action, config_revision, config_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'd1000000-0000-4000-8000-000000000001',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'service role cannot update Databricks audit events',
  'update public.databricks_connection_events set config_revision = 99',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'service role cannot delete Databricks audit events',
  'delete from public.databricks_connection_events',
  array['42501']
);
select aria_db_test.assert_scalar(
  'service role cannot execute Databricks trigger helpers',
  $sql$
    select (
      not has_function_privilege(
        current_user,
        'public.stamp_databricks_connection_authority()',
        'EXECUTE'
      )
      and not has_function_privilege(
        current_user,
        'public.audit_databricks_connection_authority()',
        'EXECUTE'
      )
      and not has_function_privilege(
        current_user,
        'public.strip_legacy_databricks_authority()',
        'EXECUTE'
      )
    )::text
  $sql$,
  'true'
);

reset role;

select aria_db_test.assert_scalar(
  'authenticator has no direct Databricks table privileges',
  $sql$
    select (
      not has_table_privilege('authenticator', 'public.databricks_connections', 'SELECT')
      and not has_table_privilege('authenticator', 'public.databricks_connections', 'INSERT')
      and not has_table_privilege('authenticator', 'public.databricks_connections', 'UPDATE')
      and not has_table_privilege('authenticator', 'public.databricks_connections', 'DELETE')
      and not has_table_privilege('authenticator', 'public.databricks_connection_events', 'SELECT')
      and not has_table_privilege('authenticator', 'public.databricks_connection_events', 'INSERT')
      and not has_table_privilege('authenticator', 'public.databricks_connection_events', 'UPDATE')
      and not has_table_privilege('authenticator', 'public.databricks_connection_events', 'DELETE')
    )::text
  $sql$,
  'true'
);

-- Admin one: bound-key protection, append-only audit, and owned deletion.
select aria_db_test.set_claims(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'authenticated'
);
set local role authenticated;

select aria_db_test.assert_sqlstate(
  'bound Databricks credential cannot be deleted',
  $sql$
    delete from public.api_keys
     where id = '10000000-0000-4000-8000-000000000001'
  $sql$,
  array['23503']
);

select aria_db_test.assert_sqlstate(
  'admin cannot insert Databricks audit events directly',
  $sql$
    insert into public.databricks_connection_events (
      workspace_id, connection_id, actor_id, action, config_revision, config_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'd1000000-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'admin cannot update Databricks audit events directly',
  'update public.databricks_connection_events set config_revision = 99',
  array['42501']
);
select aria_db_test.assert_sqlstate(
  'admin cannot delete Databricks audit events directly',
  'delete from public.databricks_connection_events',
  array['42501']
);

select aria_db_test.assert_scalar(
  'Databricks audit events are append-only and non-secret',
  $sql$
    select (
      count(*) = 2
      and count(*) filter (where action = 'insert' and config_revision = 1) = 1
      and count(*) filter (where action = 'update' and config_revision = 2) = 1
      and bool_and(actor_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
      and bool_and(config_hash ~ '^[0-9a-f]{64}$')
      and bool_and(
        to_jsonb(databricks_connection_events)::text
          not like '%test-only-credential-marker-one%'
        and to_jsonb(databricks_connection_events)::text
          not like '%hidden_marker%'
        and to_jsonb(databricks_connection_events)::text
          not like '%dbc-one-updated.example.test%'
      )
    )::text
      from public.databricks_connection_events
     where workspace_id = '11111111-1111-4111-8111-111111111111'
       and connection_id = 'd1000000-0000-4000-8000-000000000001'
  $sql$,
  'true'
);

select aria_db_test.assert_scalar(
  'Databricks audit schema has no secret-bearing configuration columns',
  $sql$
    select count(*)::text
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'databricks_connection_events'
       and column_name in (
         'secret', 'origin', 'warehouse_id', 'auth_mode', 'client_id',
         'api_key_id', 'credential_provider', 'needs_query'
       )
  $sql$,
  '0'
);

select aria_db_test.assert_affected(
  'admin can delete its workspace Databricks connection',
  $sql$
    delete from public.databricks_connections
     where id = 'd1000000-0000-4000-8000-000000000001'
  $sql$,
  1
);

select aria_db_test.assert_scalar(
  'delete appends a final Databricks audit event',
  $sql$
    select (
      count(*) = 3
      and count(*) filter (where action = 'insert' and config_revision = 1) = 1
      and count(*) filter (where action = 'update' and config_revision = 2) = 1
      and count(*) filter (where action = 'delete' and config_revision = 2) = 1
    )::text
      from public.databricks_connection_events
     where workspace_id = '11111111-1111-4111-8111-111111111111'
       and connection_id = 'd1000000-0000-4000-8000-000000000001'
  $sql$,
  'true'
);

select aria_db_test.assert_affected(
  'credential can be deleted after its Databricks connection is removed',
  $sql$
    delete from public.api_keys
     where id = '10000000-0000-4000-8000-000000000001'
  $sql$,
  1
);

reset role;
rollback;
