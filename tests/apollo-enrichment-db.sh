#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

migration="supabase/migrations/0026_apollo_enrichment_authority.sql"
database_test="tests/db/apollo-enrichment-authority.sql"
project="aria-apollo-authority-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
network="${project}_default"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
compose_log="$(mktemp /tmp/aria-apollo-compose.XXXXXX)"
migration_log="$(mktemp /tmp/aria-apollo-migration.XXXXXX)"
first_result="$(mktemp /tmp/aria-apollo-first.XXXXXX)"
reconcile_result="$(mktemp /tmp/aria-apollo-reconcile.XXXXXX)"
first_pid=""
reconcile_pid=""
export DB_HOST_PORT=0

cleanup() {
  if [ -n "$first_pid" ]; then
    kill "$first_pid" >/dev/null 2>&1 || true
    wait "$first_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$reconcile_pid" ]; then
    kill "$reconcile_pid" >/dev/null 2>&1 || true
    wait "$reconcile_pid" >/dev/null 2>&1 || true
  fi
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$compose_log" "$migration_log" "$first_result" "$reconcile_result"
}
trap cleanup EXIT HUP INT TERM

if [ ! -f "$migration" ] || [ ! -f "$database_test" ]; then
  echo "missing Apollo authority migration or database test" >&2
  exit 1
fi

postgres_password="$(
  docker compose -p "$project" config --format json |
    jq -er '.services["db-init"].environment.POSTGRES_TARGET_PASSWORD'
)"
authenticator_password="$(
  docker compose -p "$project" config --format json |
    jq -er '.services["db-init"].environment.AUTHENTICATOR_TARGET_PASSWORD'
)"
owner_password="$(
  docker compose -p "$project" config --format json |
    jq -er '.services["db-init"].environment.SUPABASE_ADMIN_TARGET_PASSWORD'
)"
test -n "$postgres_password"
test -n "$authenticator_password"
test -n "$owner_password"

psql_stdin() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$postgres_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_command() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$postgres_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres "$@"
}

psql_authenticator() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$authenticator_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U authenticator -d postgres "$@"
}

psql_owner() {
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$owner_password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U supabase_admin -d postgres "$@"
}

service_claim() {
  local application_name="$1" user_id="$2" target_id="$3" nonce="$4" idempotency_key="$5"
  psql_authenticator -qAt <<SQL
set application_name = '$application_name';
set request.jwt.claims = '{"role":"service_role"}';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.claim_apollo_enrichment(
  'a1000000-0000-4000-8000-000000000001',
  '$user_id',
  '$target_id',
  'email',
  '$nonce',
  '$idempotency_key',
  '$application_name'
);
SQL
}

service_reconcile() {
  local application_name="$1" actor_id="$2" attempt_id="$3"
  psql_authenticator -qAt <<SQL
set application_name = '$application_name';
set request.jwt.claims = '{"role":"service_role"}';
set request.jwt.claim.role = 'service_role';
set role service_role;
select public.reconcile_apollo_enrichment(
  'a1000000-0000-4000-8000-000000000001',
  '$actor_id',
  '$attempt_id',
  2,
  'complete_not_found',
  '',
  'case-admin-race',
  'abababababababababababababababababababababababababababababababab',
  '$application_name'
);
SQL
}

docker info >/dev/null
if ! docker compose -p "$project" up -d db db-init >"$compose_log" 2>&1; then
  tail -n 60 "$compose_log" >&2
  exit 1
fi
db_init_id="$(docker compose -p "$project" ps -a -q db-init)"
test -n "$db_init_id"
db_init_status="$(docker wait "$db_init_id")"
if [ "$db_init_status" != "0" ]; then
  echo "database owner reconciliation failed with status $db_init_status" >&2
  docker logs "$db_init_id" >&2 || true
  exit 1
fi

# Migration 0026 is the only numbered application migration applied. These
# minimal tables and pgcrypto are prerequisites supplied by earlier releases.
psql_stdin -q <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.workspaces (
  id uuid primary key,
  name text not null
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null
);

create table public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb
);
SQL

if ! psql_stdin -q < "$migration" >"$migration_log" 2>&1; then
  echo "migration failed: $migration" >&2
  tail -n 80 "$migration_log" >&2
  exit 1
fi

psql_stdin -q -v base=1 -v final=0 -v owner=0 < "$database_test"

set +e
direct_dml_output="$(psql_authenticator -qAt 2>&1 <<'SQL'
set role service_role;
insert into public.apollo_enrichment_quota (
  workspace_id, bucket_date, scope_key, used
) values (
  'a1000000-0000-4000-8000-000000000001', current_date, 'forbidden-direct', 1
);
SQL
)"
direct_dml_status=$?
set -e
if [ "$direct_dml_status" -eq 0 ] ||
   [[ "$direct_dml_output" != *"permission denied for table apollo_enrichment_quota"* ]]; then
  echo "service_role direct DML boundary failed" >&2
  echo "$direct_dml_output" >&2
  exit 1
fi

reconciliation_attempt_id="$(psql_command -qAtc "
  select id from public.apollo_enrichment_attempts
  where request_id='request-release-retry' and status='ambiguous'
")"
if [ -z "$reconciliation_attempt_id" ]; then
  echo "reconciliation race fixture is missing" >&2
  exit 1
fi

service_reconcile \
  "aria-reconcile-first" \
  "b1000000-0000-4000-8000-000000000001" \
  "$reconciliation_attempt_id" \
  >"$reconcile_result" &
reconcile_pid=$!

reconcile_paused=""
for _ in $(seq 1 60); do
  reconcile_paused="$(psql_authenticator -qAtc "
    select count(*) from pg_stat_activity
    where datname=current_database() and wait_event='PgSleep'
  ")"
  [ "$reconcile_paused" = "1" ] && break
  sleep 0.1
done
if [ "$reconcile_paused" != "1" ]; then
  wait "$reconcile_pid" || true
  reconcile_pid=""
  echo "first admin did not reach the reconciliation update barrier" >&2
  tail -n 40 "$reconcile_result" >&2
  exit 1
fi

reconcile_second_payload="$(service_reconcile \
  "aria-reconcile-second" \
  "b4000000-0000-4000-8000-000000000004" \
  "$reconciliation_attempt_id" |
  tail -n 1)"
wait "$reconcile_pid"
reconcile_pid=""
reconcile_first_payload="$(tail -n 1 "$reconcile_result")"

if [ "$(jq -r '.status' <<<"$reconcile_first_payload")" != "reconciled" ]; then
  echo "first admin did not win the expected-version race: $reconcile_first_payload" >&2
  exit 1
fi
if [ "$(jq -r '.status' <<<"$reconcile_second_payload")" != "conflict" ]; then
  echo "second admin did not receive an expected-version conflict: $reconcile_second_payload" >&2
  exit 1
fi

target_id="$(psql_command -qAtc "
  select id from public.apollo_enrichment_targets
  where provider_external_id='apollo-concurrent'
")"
nonce_rows="$(psql_command -qAtc "
  select nonce from public.apollo_enrichment_confirmations
  where target_id='$target_id' and consumed_at is null
  order by created_at, nonce
")"
nonce_count="$(printf '%s\n' "$nonce_rows" | awk 'NF { count += 1 } END { print count + 0 }')"
first_nonce="$(printf '%s\n' "$nonce_rows" | sed -n '1p')"
second_nonce="$(printf '%s\n' "$nonce_rows" | sed -n '2p')"
if [ -z "$target_id" ] || [ "$nonce_count" -ne 1 ]; then
  echo "concurrency fixture did not produce one target and one singleton nonce" >&2
  exit 1
fi
second_nonce="$first_nonce"

service_claim \
  "aria-apollo-first" \
  "b1000000-0000-4000-8000-000000000001" \
  "$target_id" \
  "$first_nonce" \
  "f1000000-0000-4000-8000-000000000001" \
  >"$first_result" &
first_pid=$!

first_paused=""
for _ in $(seq 1 60); do
  first_paused="$(psql_authenticator -qAtc "
    select count(*) from pg_stat_activity
    where datname=current_database() and wait_event='PgSleep'
  ")"
  [ "$first_paused" = "1" ] && break
  sleep 0.1
done
if [ "$first_paused" != "1" ]; then
  wait "$first_pid" || true
  first_pid=""
  echo "first claim did not reach the deterministic insert barrier" >&2
  tail -n 40 "$first_result" >&2
  exit 1
fi

second_payload="$(service_claim \
  "aria-apollo-second" \
  "b1000000-0000-4000-8000-000000000001" \
  "$target_id" \
  "$second_nonce" \
  "f2000000-0000-4000-8000-000000000002" |
  tail -n 1)"
wait "$first_pid"
first_pid=""
first_payload="$(tail -n 1 "$first_result")"

if [ "$(jq -r '.status' <<<"$first_payload")" != "claimed" ]; then
  echo "first concurrent claim did not own the provider attempt: $first_payload" >&2
  exit 1
fi
if [ "$(jq -r '.status' <<<"$second_payload")" != "nonce_invalid" ]; then
  echo "second concurrent claim was not serialized: $second_payload" >&2
  exit 1
fi

psql_stdin -q -v base=0 -v final=1 -v owner=0 < "$database_test"
psql_owner -q -v base=0 -v final=0 -v owner=1 < "$database_test"

printf 'RESULT apollo-enrichment-db: migration=0026-only pgcrypto=resolved jwt=service-only tables=no-direct-dml tenant=bound campaign-candidate=workspace-persisted teammate-handoff=allowed provider-handle-expiry=scrubbed-terminal reconciliation-handle=preserved-unresolved revocation=immediate receipt-retention=30-days erasure=idempotent-audited cleanup=bounded nonce=single-live idempotency=replayed cached=fresh-nonce quotas=enforced ambiguous=blocked reconciliation=state-gated events=append-only admin-race=single-winner release=fresh-authority concurrency=serialized\n'
