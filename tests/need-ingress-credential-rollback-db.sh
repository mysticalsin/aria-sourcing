#!/usr/bin/env bash
# Disposable-Postgres proof for the guarded 0056 rollback.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-need-ingress-rollback-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
bootstrap_password="local_owner_current_password_00000000000000000"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null
docker compose -p "$project" up -d --wait db >/dev/null

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$bootstrap_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  sequence="${migration##*/}"
  sequence="${sequence%%_*}"
  if ((10#$sequence > 56)); then
    break
  fi
  psql_stdin --single-transaction -q < "$migration"
done

# With no issued authority, rollback is reversible and restores the retired
# primitive only for compatibility with the preceding application release.
psql_stdin -q < supabase/rollbacks/0056_need_ingress_credential_authority.sql
empty_rollback_state="$(psql_stdin -Atc "select concat_ws(':',
  (to_regclass('public.need_ingress_credentials') is null)::text,
  (to_regprocedure('public.resolve_need_ingress_credential(text)') is null)::text,
  has_function_privilege('service_role',
    'public.ingest_requisition_and_enqueue(uuid,text,text,text)', 'EXECUTE')::text)")"
if [[ "$empty_rollback_state" != "true:true:true" ]]; then
  echo "need-ingress-credential-rollback-db: empty rollback state was $empty_rollback_state" >&2
  exit 1
fi

psql_stdin --single-transaction -q \
  < supabase/migrations/0056_need_ingress_credential_authority.sql
psql_stdin -q <<'SQL'
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'rollback-admin@example.test', '', now(),
  '{}', '{}', now(), now()
);
insert into public.workspaces(id, name, allowed_domain) values
  ('51111111-1111-4111-8111-111111111111', 'Rollback proof', 'rollback.example.test');
insert into public.profiles(id, email, full_name, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001', 'rollback-admin@example.test', 'Rollback Admin',
   '51111111-1111-4111-8111-111111111111', 'admin');

do $issued_fixture$
begin
  perform set_config('aria.need_ingress_credential_mutation_authorized', '0056', true);
  insert into public.need_ingress_credentials (
    id, workspace_id, key_sha256, label, expires_at, created_by
  ) values (
    '81111111-1111-4111-8111-111111111111',
    '51111111-1111-4111-8111-111111111111',
    repeat('a', 64),
    'Issued authority',
    now() + interval '30 days',
    'c1000000-0000-4000-8000-000000000001'
  );
end;
$issued_fixture$;
SQL

set +e
guard_output="$(psql_stdin -q \
  < supabase/rollbacks/0056_need_ingress_credential_authority.sql 2>&1)"
guard_status=$?
set -e
if [[ $guard_status -eq 0 ]]; then
  echo "need-ingress-credential-rollback-db: issued-authority rollback unexpectedly succeeded" >&2
  exit 1
fi
if [[ "$guard_output" != *"refusing 0056 rollback because need ingress credential evidence exists"* ]]; then
  echo "need-ingress-credential-rollback-db: rollback failed for an unexpected reason" >&2
  echo "$guard_output" >&2
  exit 1
fi

guarded_state="$(psql_stdin -Atc "select concat_ws(':',
  (to_regclass('public.need_ingress_credentials') is not null)::text,
  (select count(*) from public.need_ingress_credentials)::text,
  has_function_privilege('service_role',
    'public.ingest_requisition_and_enqueue(uuid,text,text,text)', 'EXECUTE')::text)")"
if [[ "$guarded_state" != "true:1:false" ]]; then
  echo "need-ingress-credential-rollback-db: guarded rollback state was $guarded_state" >&2
  exit 1
fi

echo "need-ingress-credential-rollback-db: empty rollback succeeded; issued authority blocked rollback and retained fail-closed ACL"
