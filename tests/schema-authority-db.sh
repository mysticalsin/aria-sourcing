#!/usr/bin/env bash
# Runs the standalone SQL authority scenarios in tests/db/ against a disposable
# database that went through the real owner reconciliation (db-init) and every
# numbered migration, using the same direct sessions as the local bootstrap.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="aria-schema-authority-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
export DB_HOST_PORT=0

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

config="$(docker compose -p "$project" config --format json)"
postgres_password="$(jq -er '.services["db-init"].environment.POSTGRES_TARGET_PASSWORD' <<<"$config")"
owner_password="$(jq -er '.services["db-init"].environment.SUPABASE_ADMIN_TARGET_PASSWORD' <<<"$config")"

psql_as() {
  local role="$1" password="$2"
  shift 2
  docker run --rm -i --network "$network" --env PGPASSWORD="$password" \
    --entrypoint psql "$client_image" -X -q -v ON_ERROR_STOP=1 -h db -U "$role" -d postgres "$@"
}

docker info >/dev/null

for scenario in function-privileges ensure-workspace-authority dust-authority; do
  # Each scenario seeds fixed identities, so it gets a fresh database.
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose -p "$project" up -d db db-init >/dev/null
  db_init_id="$(docker compose -p "$project" ps -a -q db-init)"
  if [ "$(docker wait "$db_init_id")" != "0" ]; then
    docker logs "$db_init_id" >&2 || true
    exit 1
  fi

  for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
    psql_as postgres "$postgres_password" < "$migration" >/dev/null
  done

  if [ "$scenario" = "function-privileges" ]; then
    # Future-object probes must come from a direct supabase_admin session;
    # SET ROLE inside a postgres session does not prove owner-local defaults.
    psql_as supabase_admin "$owner_password" -c '
      create table public.__aria_supabase_admin_default_acl_table_probe(id bigint);
      create sequence public.__aria_supabase_admin_default_acl_sequence_probe;
      create function public.__aria_supabase_admin_default_acl_function_probe()
      returns integer language sql as $$select 1$$;
    ' >/dev/null
    psql_as postgres "$postgres_password" < "tests/db/$scenario.sql" >/dev/null
  else
    psql_as supabase_admin "$owner_password" < "tests/db/$scenario.sql" >/dev/null
  fi
  echo "PASS: $scenario"
done

echo "RESULT schema-authority-db: passed"
