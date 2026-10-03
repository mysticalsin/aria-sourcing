#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

migration="supabase/migrations/0027_sourcing_learning_authority.sql"
database_test="tests/db/sourcing-learning-authority.sql"
project="aria-sourcing-learning-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

postgres_password="$(docker compose -p "$project" config --format json | jq -er '.services["db-init"].environment.POSTGRES_TARGET_PASSWORD')"
authenticator_password="$(docker compose -p "$project" config --format json | jq -er '.services["db-init"].environment.AUTHENTICATOR_TARGET_PASSWORD')"

psql_postgres() {
  docker run --rm -i --network "$network" --env PGPASSWORD="$postgres_password" \
    --entrypoint psql "$client_image" -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_authenticator() {
  docker run --rm -i --network "$network" --env PGPASSWORD="$authenticator_password" \
    --entrypoint psql "$client_image" -X -v ON_ERROR_STOP=1 -h db -U authenticator -d postgres "$@"
}

docker info >/dev/null
docker compose -p "$project" up -d db db-init >/dev/null
db_init_id="$(docker compose -p "$project" ps -a -q db-init)"
test -n "$db_init_id"
db_init_status="$(docker wait "$db_init_id")"
if [ "$db_init_status" != "0" ]; then
  docker logs "$db_init_id" >&2 || true
  exit 1
fi

psql_postgres -q <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.workspaces (id uuid primary key, name text not null);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null
);
SQL
psql_postgres -q < "$migration"
psql_postgres -q < "$database_test"
# Ledger reconciliation may retry a migration after the transaction outcome is
# uncertain. Reapplying must preserve every receipt and authority boundary.
psql_postgres -q < "$migration"

set +e
direct_dml="$(psql_authenticator -qAt 2>&1 <<'SQL'
set request.jwt.claims = '{"role":"service_role"}';
set request.jwt.claim.role = 'service_role';
set role service_role;
insert into public.sourcing_run_quota (workspace_id, bucket_date, scope_key, used)
values ('11111111-1111-4111-8111-111111111111', current_date, 'workspace', 999);
SQL
)"
direct_status=$?
set -e
if [ "$direct_status" -eq 0 ] || [[ "$direct_dml" != *"permission denied for table sourcing_run_quota"* ]]; then
  echo "service_role direct DML boundary failed" >&2
  echo "$direct_dml" >&2
  exit 1
fi

rpc_status="$(psql_authenticator -qAt <<'SQL'
set request.jwt.claims = '{"role":"service_role"}';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.cleanup_sourcing_learning_authority(
  '11111111-1111-4111-8111-111111111111', 10
) ->> 'status';
SQL
)"
if [ "$rpc_status" != "cleaned" ]; then
  echo "service_role RPC grant failed: $rpc_status" >&2
  exit 1
fi

echo "RESULT sourcing-learning-db-harness: direct-dml=denied service-rpc=pass"
