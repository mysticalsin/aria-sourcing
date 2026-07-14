#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-owner-recovery-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
postgres_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$postgres_password" \
    --entrypoint psql \
    "$client_image" \
    -X -q -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_owner_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$postgres_password" \
    --entrypoint psql \
    "$client_image" \
    -X -q -v ON_ERROR_STOP=1 -h db -U supabase_admin -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_stdin < "$migration" >/dev/null
done

psql_owner_stdin <<'SQL'
-- GoTrue owns these columns in the deployed schema. The minimal database image
-- starts from a deliberately old Auth bootstrap, so add only the fields needed
-- to exercise the 0031 runtime guard.
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  banned_until, deleted_at
) values (
  '31000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'placeholder@workspace', 'placeholder', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), null, null
);

insert into public.workspaces (id, name, allowed_domain)
values ('31000000-0000-4000-8000-000000000010', 'Recovered workspace', 'workspace');
insert into public.workspace_state (workspace_id, state)
values (
  '31000000-0000-4000-8000-000000000010',
  '{"campaigns":[{"id":"preserve-me"}],"settings":{"dryRun":true}}'::jsonb
);
insert into public.profiles (id, email, full_name, workspace_id, role)
values (
  '31000000-0000-4000-8000-000000000001', '', 'Placeholder',
  '31000000-0000-4000-8000-000000000010', 'admin'
);

-- Reproduce the reviewed live legacy topology: one profile whose historical
-- auth identity is absent. The production recovery path itself never disables
-- constraints; this fixture setup is the only place that does.
alter table auth.users disable trigger all;
delete from auth.users where id = '31000000-0000-4000-8000-000000000001';
alter table auth.users enable trigger all;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  banned_until, deleted_at
) values (
  '31000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner@example.test', '$2a$10$synthetic.test.password.hash', now(),
  '{"provider":"email","providers":["email"]}',
  '{"aria_owner_recovery_marker":"aria-owner-recovery-v1:31000000-0000-4000-8000-000000000110:4a8b1f6e098c7413582c4b898ca146aee87a5d8e7a2d151fff29a9c4caaef50c"}',
  now(), now(), null, null
);

create schema aria_owner_recovery_test;
revoke all on schema aria_owner_recovery_test from public;
grant usage on schema aria_owner_recovery_test to anon, authenticator, authenticated, service_role;

-- Snapshot the post-trigger state. Earlier migrations deliberately normalize
-- legacy authority fields on INSERT, so preservation must be measured from the
-- exact row the recovery RPC receives rather than from the pre-trigger literal.
create table aria_owner_recovery_test.state_baseline (state jsonb not null);
insert into aria_owner_recovery_test.state_baseline (state)
select state from public.workspace_state
where workspace_id = '31000000-0000-4000-8000-000000000010';
revoke all on aria_owner_recovery_test.state_baseline from public, anon, authenticator, authenticated, service_role;

create function aria_owner_recovery_test.set_claims(jwt_role text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', jwt_role)::text,
    true
  );
  perform set_config('request.jwt.claim.role', jwt_role, true);
end;
$$;

create function aria_owner_recovery_test.recover(
  request_id uuid,
  expected_domain text default 'workspace',
  email text default 'owner@example.test',
  domain text default 'example.test',
  full_name text default 'Owner Admin',
  release_sha text default 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  recovery_sha text default repeat('b', 64),
  approval_override text default null,
  approval_sha_override text default null
) returns jsonb language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  approval text;
  approval_sha text;
begin
  approval := 'aria-owner-recovery-v1:' ||
    '31000000-0000-4000-8000-000000000010' || ':' ||
    '31000000-0000-4000-8000-000000000001' || ':' ||
    release_sha || ':' || recovery_sha || ':' || request_id::text;
  approval := coalesce(approval_override, approval);
  approval_sha := coalesce(
    approval_sha_override,
    encode(digest(convert_to(approval, 'UTF8'), 'sha256'), 'hex')
  );
  return public.recover_orphan_workspace_owner(
    '31000000-0000-4000-8000-000000000010',
    '31000000-0000-4000-8000-000000000001',
    expected_domain,
    email,
    domain,
    full_name,
    release_sha,
    recovery_sha,
    request_id,
    approval,
    approval_sha
  );
end;
$$;

create function aria_owner_recovery_test.assert_scalar(
  case_name text, statement text, expected text
) returns void language plpgsql set search_path = pg_catalog as $$
declare actual text;
begin
  execute statement into actual;
  if actual is distinct from expected then
    raise exception 'Case "%" returned %, expected %', case_name, actual, expected;
  end if;
end;
$$;

create function aria_owner_recovery_test.assert_sqlstate(
  case_name text, statement text, expected_codes text[]
) returns void language plpgsql set search_path = pg_catalog as $$
declare caught text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics caught = returned_sqlstate;
    if caught = any(expected_codes) then return; end if;
    raise exception 'Case "%" returned SQLSTATE %, expected %', case_name, caught, expected_codes;
  end;
  raise exception 'Case "%" unexpectedly succeeded', case_name;
end;
$$;

revoke all on all functions in schema aria_owner_recovery_test from public;
grant execute on all functions in schema aria_owner_recovery_test
  to anon, authenticator, authenticated, service_role;
SQL

# The RPC is service-only and the receipt table has no API-role DML surface.
psql_owner_stdin <<'SQL'
begin;
select aria_owner_recovery_test.set_claims('authenticated');
set local role authenticated;
select aria_owner_recovery_test.assert_sqlstate(
  'authenticated cannot invoke recovery',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000101')$$,
  array['42501']
);
rollback;

do $privilege_proof$
declare
  role_name text;
  signature text := 'public.recover_orphan_workspace_owner(uuid,uuid,text,text,text,text,text,text,uuid,text,text)';
begin
  foreach role_name in array array['anon','authenticator','authenticated','service_role'] loop
    if has_function_privilege(role_name, signature, 'EXECUTE') is distinct from (role_name = 'service_role') then
      raise exception 'unexpected recovery RPC privilege for %', role_name;
    end if;
    if has_table_privilege(role_name, 'public.owner_recovery_receipts', 'SELECT')
       or has_table_privilege(role_name, 'public.owner_recovery_receipts', 'INSERT')
       or has_table_privilege(role_name, 'public.owner_recovery_receipts', 'UPDATE')
       or has_table_privilege(role_name, 'public.owner_recovery_receipts', 'DELETE') then
      raise exception 'API role % has direct recovery receipt DML', role_name;
    end if;
  end loop;
end
$privilege_proof$;
SQL

# Adversarial topology and identity states fail before mutation.
psql_owner_stdin <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  banned_until, deleted_at
) values (
  '31000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','member@example.test','hash',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now(),null,null
);
insert into public.profiles (id,email,workspace_id,role)
values (
  '31000000-0000-4000-8000-000000000002','member@example.test',
  '31000000-0000-4000-8000-000000000010','member'
);
begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'another real workspace member blocks recovery',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000102')->>'status'$$,
  'profile_inventory_mismatch'
);
rollback;
delete from public.profiles where id = '31000000-0000-4000-8000-000000000002';
delete from auth.users where id = '31000000-0000-4000-8000-000000000002';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  banned_until, deleted_at
) values (
  '31000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','unrelated@example.test','hash',now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now(),null,null
);
begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'another auth identity blocks recovery',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000103')->>'status'$$,
  'auth_inventory_mismatch'
);
rollback;
delete from auth.users where id = '31000000-0000-4000-8000-000000000003';

update auth.users
set banned_until = now() + interval '1 day'
where id = '31000000-0000-4000-8000-000000000001';
begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'a banned GoTrue identity is rejected',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000104')->>'status'$$,
  'identity_not_eligible'
);
rollback;
update auth.users
set banned_until = null, raw_app_meta_data = '{"provider":"github","providers":["github"]}'
where id = '31000000-0000-4000-8000-000000000001';
begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'a non-email GoTrue provider is rejected',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000105')->>'status'$$,
  'identity_not_eligible'
);
rollback;
update auth.users
set raw_app_meta_data = '{"provider":"email","providers":["email"]}'
where id = '31000000-0000-4000-8000-000000000001';

begin;
update auth.users
set raw_user_meta_data = '{}'
where id = '31000000-0000-4000-8000-000000000001';
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'an unmarked GoTrue identity cannot bypass the reviewed operator path',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000109')->>'status'$$,
  'identity_not_eligible'
);
rollback;

begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'a foreign operator approval is rejected',
  $$select aria_owner_recovery_test.recover(
    '31000000-0000-4000-8000-000000000106',
    approval_override => 'foreign-approval',
    approval_sha_override => repeat('c',64)
  )->>'status'$$,
  'invalid_request'
);
select aria_owner_recovery_test.assert_scalar(
  'the recovery path accepts only the placeholder domain',
  $$select aria_owner_recovery_test.recover(
    '31000000-0000-4000-8000-000000000107',
    expected_domain => 'example.test'
  )->>'status'$$,
  'invalid_request'
);
select aria_owner_recovery_test.assert_scalar(
  'a single-label resulting domain is not a canonical public email domain',
  $$select aria_owner_recovery_test.recover(
    '31000000-0000-4000-8000-000000000108',
    email => 'owner@invalid',
    domain => 'invalid'
  )->>'status'$$,
  'invalid_request'
);
rollback;

select count(*) = 0 from public.owner_recovery_receipts;
select allowed_domain = 'workspace'
from public.workspaces where id = '31000000-0000-4000-8000-000000000010';
select email = '' and full_name = 'Placeholder' and role = 'admin'
from public.profiles where id = '31000000-0000-4000-8000-000000000001';
SQL

# Exact recovery succeeds once, preserves state, and writes one minimized receipt.
psql_owner_stdin <<'SQL'
begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'the exact reviewed topology is recovered',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000110')->>'status'$$,
  'recovered'
);
commit;

do $post_recovery$
declare
  state_value jsonb;
begin
  if (select allowed_domain from public.workspaces where id='31000000-0000-4000-8000-000000000010') <> 'example.test' then
    raise exception 'workspace domain was not recovered';
  end if;
  if not exists (
    select 1 from public.profiles
    where id='31000000-0000-4000-8000-000000000001'
      and workspace_id='31000000-0000-4000-8000-000000000010'
      and role='admin' and email='owner@example.test' and full_name='Owner Admin'
  ) then
    raise exception 'admin binding is incorrect';
  end if;
  select state into state_value from public.workspace_state
   where workspace_id='31000000-0000-4000-8000-000000000010';
  if state_value is distinct from (
    select state from aria_owner_recovery_test.state_baseline
  ) then
    raise exception 'workspace state changed during owner recovery';
  end if;
  if (select count(*) from public.owner_recovery_receipts) <> 1 then
    raise exception 'recovery receipt count is not exact';
  end if;
end
$post_recovery$;

select aria_owner_recovery_test.assert_sqlstate(
  'recovery receipts cannot be updated',
  $$update public.owner_recovery_receipts set release_sha=repeat('d',40)$$,
  array['42501']
);
select aria_owner_recovery_test.assert_sqlstate(
  'recovery receipts cannot be deleted',
  $$delete from public.owner_recovery_receipts$$,
  array['42501']
);
SQL

# The migration is safe to reapply; replay remains exact and changed material conflicts.
psql_stdin < supabase/migrations/0031_orphan_owner_recovery_authority.sql >/dev/null
psql_owner_stdin <<'SQL'
begin;
select aria_owner_recovery_test.set_claims('service_role');
set local role service_role;
select aria_owner_recovery_test.assert_scalar(
  'an exact request replay returns the original receipt',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000110')->>'status'$$,
  'replay'
);
select aria_owner_recovery_test.assert_scalar(
  'a reused request UUID with changed material conflicts',
  $$select aria_owner_recovery_test.recover(
    '31000000-0000-4000-8000-000000000110',
    full_name => 'Changed Owner'
  )->>'status'$$,
  'idempotency_conflict'
);
select aria_owner_recovery_test.assert_scalar(
  'a second request cannot silently re-run recovery',
  $$select aria_owner_recovery_test.recover('31000000-0000-4000-8000-000000000111')->>'status'$$,
  'topology_mismatch'
);
rollback;

select count(*) = 1 from public.owner_recovery_receipts;
SQL

printf 'RESULT orphan-owner-recovery-db: topology=exact-only auth=confirmed-email-local non-banned=true non-deleted=true cas=workspace-profile-domain state=preserved mutation=two-fields receipt=append-only replay=exact privileges=service-rpc-only\n'
