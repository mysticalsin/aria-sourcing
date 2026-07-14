\set ON_ERROR_STOP on

-- Effective-role verification for normalized Dust authority. Everything is
-- transactional so synthetic identities, credentials, and audit rows vanish.
begin;

create schema aria_dust_db_test;
revoke all on schema aria_dust_db_test from public;
grant usage on schema aria_dust_db_test to anon, authenticated, service_role;

create function aria_dust_db_test.assert_sqlstate(
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

create function aria_dust_db_test.assert_affected(
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

create function aria_dust_db_test.assert_scalar(
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

create function aria_dust_db_test.set_claims(subject uuid, jwt_role text)
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

revoke all on all functions in schema aria_dust_db_test from public;
grant execute on all functions in schema aria_dust_db_test
  to anon, authenticated, service_role;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'dust-admin-one@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'dust-member-one@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'dust-viewer-one@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'dust-admin-two@example.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.workspaces (id, name, allowed_domain)
values
  ('31111111-1111-4111-8111-111111111111', 'Dust Authority One', 'dust-one.example.test'),
  ('32222222-2222-4222-8222-222222222222', 'Dust Authority Two', 'dust-two.example.test');

insert into public.profiles (id, email, full_name, workspace_id, role)
values
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'dust-admin-one@example.test', 'Dust Admin One',
    '31111111-1111-4111-8111-111111111111', 'admin'
  ),
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'dust-member-one@example.test', 'Dust Member One',
    '31111111-1111-4111-8111-111111111111', 'member'
  ),
  (
    'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'dust-viewer-one@example.test', 'Dust Viewer One',
    '31111111-1111-4111-8111-111111111111', 'viewer'
  ),
  (
    'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'dust-admin-two@example.test', 'Dust Admin Two',
    '32222222-2222-4222-8222-222222222222', 'admin'
  );

insert into public.api_keys (
  id, workspace_id, name, provider, secret, last4, status, created_by
)
values
  (
    '41000000-0000-4000-8000-000000000001',
    '31111111-1111-4111-8111-111111111111',
    'Dust W1', 'Dust', 'dust-secret-marker-one',
    'one1', 'valid', 'dust-authority-test'
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    '31111111-1111-4111-8111-111111111111',
    'Wrong Provider W1', 'Tavily', 'dust-secret-marker-two',
    'two2', 'valid', 'dust-authority-test'
  ),
  (
    '43000000-0000-4000-8000-000000000003',
    '32222222-2222-4222-8222-222222222222',
    'Dust W2', 'Dust', 'dust-secret-marker-three',
    'thr3', 'valid', 'dust-authority-test'
  );

-- Admin one: database-enforced key binding and immutable authority fields.
select aria_dust_db_test.set_claims(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authenticated'
);
set local role authenticated;

select aria_dust_db_test.assert_sqlstate(
  'wrong-provider Dust credential binding is rejected',
  $sql$
    insert into public.dust_connections (
      id, workspace_id, dust_workspace_id, api_key_id
    ) values (
      'd5100000-0000-4000-8000-000000000010',
      '31111111-1111-4111-8111-111111111111',
      'dust-wrong-provider',
      '42000000-0000-4000-8000-000000000002'
    )
  $sql$,
  array['23503']
);

select aria_dust_db_test.assert_sqlstate(
  'foreign-workspace Dust credential binding is rejected',
  $sql$
    insert into public.dust_connections (
      id, workspace_id, dust_workspace_id, api_key_id
    ) values (
      'd5100000-0000-4000-8000-000000000011',
      '31111111-1111-4111-8111-111111111111',
      'dust-foreign-key',
      '43000000-0000-4000-8000-000000000003'
    )
  $sql$,
  array['23503']
);

insert into public.dust_connections (
  id, workspace_id, dust_workspace_id, region, api_key_id,
  agent_locks, agents, config_revision, created_by, updated_by,
  created_at, updated_at
)
values (
  'd5100000-0000-4000-8000-000000000001',
  '31111111-1111-4111-8111-111111111111',
  'dust-workspace-secret-adjacent-marker',
  'us',
  '41000000-0000-4000-8000-000000000001',
  '{"jdAnalysis":"agent-sensitive-marker"}'::jsonb,
  '[{"sId":"agent-sensitive-marker","name":"Synthetic","description":"No production data"}]'::jsonb,
  999,
  'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  '2000-01-01T00:00:00Z',
  '2000-01-01T00:00:00Z'
);

select aria_dust_db_test.assert_scalar(
  'admin can manage its workspace Dust connection',
  $sql$
    select count(*)::text
      from public.dust_connections
     where id = 'd5100000-0000-4000-8000-000000000001'
       and workspace_id = '31111111-1111-4111-8111-111111111111'
       and credential_provider = 'Dust'
       and config_revision = 1
       and created_by = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and updated_by = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and created_at <> '2000-01-01T00:00:00Z'
       and updated_at <> '2000-01-01T00:00:00Z'
  $sql$,
  '1'
);

update public.dust_connections
   set id = 'd5100000-0000-4000-8000-000000000099',
       workspace_id = '32222222-2222-4222-8222-222222222222',
       credential_provider = 'Tavily',
       dust_workspace_id = 'dust-workspace-updated',
       region = 'eu',
       config_revision = 999,
       created_by = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       updated_by = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
       created_at = '2000-01-01T00:00:00Z',
       updated_at = '2000-01-01T00:00:00Z'
 where id = 'd5100000-0000-4000-8000-000000000001';

select aria_dust_db_test.assert_scalar(
  'Dust revision and immutable authority fields are database-owned',
  $sql$
    select count(*)::text
      from public.dust_connections
     where id = 'd5100000-0000-4000-8000-000000000001'
       and workspace_id = '31111111-1111-4111-8111-111111111111'
       and credential_provider = 'Dust'
       and dust_workspace_id = 'dust-workspace-updated'
       and region = 'eu'
       and config_revision = 2
       and created_by = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and updated_by = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
       and created_at <> '2000-01-01T00:00:00Z'
       and updated_at <> '2000-01-01T00:00:00Z'
  $sql$,
  '1'
);

select aria_dust_db_test.assert_sqlstate(
  'Dust connection cannot be rebound to a wrong-provider key',
  $sql$
    update public.dust_connections
       set api_key_id = '42000000-0000-4000-8000-000000000002'
     where id = 'd5100000-0000-4000-8000-000000000001'
  $sql$,
  array['23503']
);

reset role;

-- Admin two creates a foreign tenant row through the same authenticated path.
select aria_dust_db_test.set_claims(
  'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'authenticated'
);
set local role authenticated;
insert into public.dust_connections (
  id, workspace_id, dust_workspace_id, region, api_key_id
)
values (
  'd5200000-0000-4000-8000-000000000002',
  '32222222-2222-4222-8222-222222222222',
  'dust-workspace-two', 'us',
  '43000000-0000-4000-8000-000000000003'
);
reset role;

-- Admin one cannot observe or mutate the foreign tenant or its audit events.
select aria_dust_db_test.set_claims(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authenticated'
);
set local role authenticated;
select aria_dust_db_test.assert_scalar(
  'admin cannot read a foreign workspace Dust connection',
  $sql$
    select count(*)::text from public.dust_connections
     where workspace_id = '32222222-2222-4222-8222-222222222222'
  $sql$,
  '0'
);
select aria_dust_db_test.assert_affected(
  'admin cannot update a foreign workspace Dust connection',
  $sql$
    update public.dust_connections set enabled = false
     where workspace_id = '32222222-2222-4222-8222-222222222222'
  $sql$,
  0
);
select aria_dust_db_test.assert_sqlstate(
  'admin cannot insert a foreign workspace Dust connection',
  $sql$
    insert into public.dust_connections (
      workspace_id, dust_workspace_id, api_key_id
    ) values (
      '32222222-2222-4222-8222-222222222222',
      'dust-foreign-policy',
      '43000000-0000-4000-8000-000000000003'
    )
  $sql$,
  array['42501']
);
select aria_dust_db_test.assert_scalar(
  'admin cannot read foreign Dust audit events',
  $sql$
    select count(*)::text from public.dust_connection_events
     where workspace_id = '32222222-2222-4222-8222-222222222222'
  $sql$,
  '0'
);
reset role;

-- Workspace members and viewers can see non-secret connection metadata but
-- cannot change authority or access the admin audit stream.
select aria_dust_db_test.set_claims(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'authenticated'
);
set local role authenticated;
select aria_dust_db_test.assert_scalar(
  'member can read same-workspace Dust connection metadata',
  'select count(*)::text from public.dust_connections',
  '1'
);
select aria_dust_db_test.assert_affected(
  'member cannot update Dust connections',
  'update public.dust_connections set enabled = false',
  0
);
select aria_dust_db_test.assert_sqlstate(
  'member cannot insert Dust connections',
  $sql$
    insert into public.dust_connections (
      workspace_id, dust_workspace_id, api_key_id
    ) values (
      '31111111-1111-4111-8111-111111111111',
      'dust-member-write',
      '41000000-0000-4000-8000-000000000001'
    )
  $sql$,
  array['42501']
);
select aria_dust_db_test.assert_scalar(
  'member cannot read Dust audit events',
  'select count(*)::text from public.dust_connection_events',
  '0'
);
select aria_dust_db_test.assert_sqlstate(
  'member cannot insert Dust audit events',
  $sql$
    insert into public.dust_connection_events (
      workspace_id, connection_id, action, config_revision, config_hash
    ) values (
      '31111111-1111-4111-8111-111111111111',
      'd5100000-0000-4000-8000-000000000001',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'member cannot update Dust audit events',
  'update public.dust_connection_events set config_revision = 99',
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'member cannot delete Dust audit events',
  'delete from public.dust_connection_events',
  array['42501']
);
reset role;

select aria_dust_db_test.set_claims(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'authenticated'
);
set local role authenticated;
select aria_dust_db_test.assert_scalar(
  'viewer can read same-workspace Dust connection metadata',
  'select count(*)::text from public.dust_connections',
  '1'
);
select aria_dust_db_test.assert_affected(
  'viewer cannot delete Dust connections',
  'delete from public.dust_connections',
  0
);
select aria_dust_db_test.assert_scalar(
  'viewer cannot read Dust audit events',
  'select count(*)::text from public.dust_connection_events',
  '0'
);
reset role;

-- Anonymous callers have no table privileges at all.
select aria_dust_db_test.set_claims(null, 'anon');
set local role anon;
select aria_dust_db_test.assert_sqlstate(
  'anonymous callers cannot access Dust connections',
  'select count(*) from public.dust_connections',
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'anonymous callers cannot access Dust audit events',
  'select count(*) from public.dust_connection_events',
  array['42501']
);
reset role;

-- The service role resolves normalized authority read-only. It cannot read the
-- admin audit stream or execute trigger-only routines directly.
select aria_dust_db_test.set_claims(null, 'service_role');
set local role service_role;
select aria_dust_db_test.assert_scalar(
  'service role can read normalized Dust connections',
  'select count(*)::text from public.dust_connections',
  '2'
);
select aria_dust_db_test.assert_sqlstate(
  'service role cannot write normalized Dust connections',
  $sql$
    insert into public.dust_connections (
      workspace_id, dust_workspace_id, api_key_id
    ) values (
      '31111111-1111-4111-8111-111111111111',
      'dust-service-write',
      '41000000-0000-4000-8000-000000000001'
    )
  $sql$,
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'service role cannot update normalized Dust connections',
  'update public.dust_connections set enabled = false',
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'service role cannot delete normalized Dust connections',
  'delete from public.dust_connections',
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'service role cannot access Dust audit events',
  'select count(*) from public.dust_connection_events',
  array['42501']
);
select aria_dust_db_test.assert_scalar(
  'service role cannot execute Dust trigger helpers',
  $sql$
    select (
      not has_function_privilege(
        current_user, 'public.stamp_dust_connection_authority()', 'EXECUTE'
      )
      and not has_function_privilege(
        current_user, 'public.audit_dust_connection_authority()', 'EXECUTE'
      )
      and not has_function_privilege(
        current_user, 'public.strip_legacy_dust_authority()', 'EXECUTE'
      )
    )::text
  $sql$,
  'true'
);
reset role;

select aria_dust_db_test.assert_scalar(
  'authenticator has no direct Dust table privileges',
  $sql$
    select (
      not has_table_privilege('authenticator', 'public.dust_connections', 'SELECT')
      and not has_table_privilege('authenticator', 'public.dust_connections', 'INSERT')
      and not has_table_privilege('authenticator', 'public.dust_connections', 'UPDATE')
      and not has_table_privilege('authenticator', 'public.dust_connections', 'DELETE')
      and not has_table_privilege('authenticator', 'public.dust_connection_events', 'SELECT')
      and not has_table_privilege('authenticator', 'public.dust_connection_events', 'INSERT')
      and not has_table_privilege('authenticator', 'public.dust_connection_events', 'UPDATE')
      and not has_table_privilege('authenticator', 'public.dust_connection_events', 'DELETE')
    )::text
  $sql$,
  'true'
);

-- Admin one: the trigger is the only event writer and the event shape cannot
-- disclose Dust configuration, credential material, or agent metadata.
select aria_dust_db_test.set_claims(
  'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'authenticated'
);
set local role authenticated;
select aria_dust_db_test.assert_sqlstate(
  'bound Dust credential cannot be deleted',
  $sql$
    delete from public.api_keys
     where id = '41000000-0000-4000-8000-000000000001'
  $sql$,
  array['23503']
);
select aria_dust_db_test.assert_sqlstate(
  'admin cannot insert Dust audit events directly',
  $sql$
    insert into public.dust_connection_events (
      workspace_id, connection_id, actor_id, action, config_revision, config_hash
    ) values (
      '31111111-1111-4111-8111-111111111111',
      'd5100000-0000-4000-8000-000000000001',
      'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'insert', 1, repeat('0', 64)
    )
  $sql$,
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'admin cannot update Dust audit events directly',
  'update public.dust_connection_events set config_revision = 99',
  array['42501']
);
select aria_dust_db_test.assert_sqlstate(
  'admin cannot delete Dust audit events directly',
  'delete from public.dust_connection_events',
  array['42501']
);
select aria_dust_db_test.assert_scalar(
  'Dust audit events are append-only and non-secret',
  $sql$
    select (
      count(*) = 2
      and count(*) filter (where action = 'insert' and config_revision = 1) = 1
      and count(*) filter (where action = 'update' and config_revision = 2) = 1
      and bool_and(actor_id = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
      and bool_and(config_hash ~ '^[0-9a-f]{64}$')
      and bool_and(
        to_jsonb(dust_connection_events)::text not like '%dust-secret-marker-one%'
        and to_jsonb(dust_connection_events)::text not like '%agent-sensitive-marker%'
        and to_jsonb(dust_connection_events)::text not like '%dust-workspace-updated%'
      )
    )::text
      from public.dust_connection_events
     where workspace_id = '31111111-1111-4111-8111-111111111111'
       and connection_id = 'd5100000-0000-4000-8000-000000000001'
  $sql$,
  'true'
);
select aria_dust_db_test.assert_scalar(
  'Dust audit schema has no secret-bearing configuration columns',
  $sql$
    select count(*)::text
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'dust_connection_events'
       and column_name in (
         'secret', 'dust_workspace_id', 'region', 'api_key_id',
         'credential_provider', 'agent_locks', 'agents', 'enabled'
       )
  $sql$,
  '0'
);
select aria_dust_db_test.assert_affected(
  'admin can delete its workspace Dust connection',
  $sql$
    delete from public.dust_connections
     where id = 'd5100000-0000-4000-8000-000000000001'
  $sql$,
  1
);
select aria_dust_db_test.assert_scalar(
  'delete appends a final Dust audit event',
  $sql$
    select (
      count(*) = 3
      and count(*) filter (where action = 'insert' and config_revision = 1) = 1
      and count(*) filter (where action = 'update' and config_revision = 2) = 1
      and count(*) filter (where action = 'delete' and config_revision = 2) = 1
    )::text
      from public.dust_connection_events
     where workspace_id = '31111111-1111-4111-8111-111111111111'
       and connection_id = 'd5100000-0000-4000-8000-000000000001'
  $sql$,
  'true'
);
select aria_dust_db_test.assert_affected(
  'credential can be deleted after its Dust connection is removed',
  $sql$
    delete from public.api_keys
     where id = '41000000-0000-4000-8000-000000000001'
  $sql$,
  1
);
reset role;

rollback;
