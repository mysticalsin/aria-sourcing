#!/usr/bin/env bash
set -Eeuo pipefail

command -v docker >/dev/null 2>&1
docker info >/dev/null

suffix="${GITHUB_RUN_ID:-local}-$$"
image="aria-fly-db-volume-test:${suffix}"
base_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="aria-fly-db-network-${suffix}"
root_volume="aria-fly-db-root-${suffix}"
override_volume="aria-fly-db-override-${suffix}"
legacy_volume="aria-fly-db-legacy-${suffix}"
legacy_real_volume="aria-fly-db-legacy-real-${suffix}"
partial_volume="aria-fly-db-partial-${suffix}"
resume_volume="aria-fly-db-resume-${suffix}"
ambiguous_volume="aria-fly-db-ambiguous-${suffix}"
unexpected_volume="aria-fly-db-unexpected-${suffix}"
major_volume="aria-fly-db-major-${suffix}"
parent_volume="aria-fly-db-parent-${suffix}"
root_container="aria-fly-db-root-${suffix}"
override_container="aria-fly-db-override-${suffix}"
legacy_container="aria-fly-db-legacy-${suffix}"
legacy_real_container="aria-fly-db-legacy-real-${suffix}"
partial_container="aria-fly-db-partial-${suffix}"
resume_container="aria-fly-db-resume-${suffix}"
ambiguous_container="aria-fly-db-ambiguous-${suffix}"
unexpected_container="aria-fly-db-unexpected-${suffix}"
major_container="aria-fly-db-major-${suffix}"
parent_container="aria-fly-db-parent-${suffix}"
owner_password="OwnerTarget_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
postgres_password="PostgresTarget_0123456789abcdefghijklmnopqrstuvwxyzABCD"
auth_password="AuthTarget_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH"
rest_password="RestTarget_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH"
jwt_secret="JwtSecret_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ"
layout_release_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
layout_receipt_sha="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
layout_approval="aria-db-root-to-child-v1:${layout_release_sha}:${layout_receipt_sha}"
wrong_layout_approval="aria-db-root-to-child-v1:${layout_release_sha}:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"

cleanup() {
  docker rm -f "$root_container" "$override_container" "$legacy_container" "$legacy_real_container" "$partial_container" "$resume_container" "$ambiguous_container" "$unexpected_container" "$major_container" "$parent_container" >/dev/null 2>&1 || true
  docker volume rm -f "$root_volume" "$override_volume" "$legacy_volume" "$legacy_real_volume" "$partial_volume" "$resume_volume" "$ambiguous_volume" "$unexpected_volume" "$major_volume" "$parent_volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm -f "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --file docker/db/Dockerfile.fly --tag "$image" . >/dev/null
docker network create "$network" >/dev/null

seed_lost_found() {
  local volume="$1" destination="$2" seed_image="${3:-$image}"
  docker volume create "$volume" >/dev/null
  docker run --rm \
    --volume "$volume:$destination" \
    --entrypoint /bin/sh \
    "$seed_image" \
    -c "mkdir -p '$destination/lost+found'"
}

seed_legacy_cluster() {
  local volume="$1" major="${2:-17}"
  docker volume create "$volume" >/dev/null
  docker run --rm \
    --volume "$volume:/var/lib/postgresql" \
    --entrypoint /bin/sh \
    "$image" \
    -c "set -eu
      root=/var/lib/postgresql
      rm -rf \"\$root/data\"
      mkdir -p \
        \"\$root/base\" \"\$root/global\" \"\$root/lost+found\" \
        \"\$root/pg_commit_ts\" \"\$root/pg_dynshmem\" \"\$root/pg_logical\" \
        \"\$root/pg_multixact\" \"\$root/pg_notify\" \"\$root/pg_replslot\" \
        \"\$root/pg_serial\" \"\$root/pg_snapshots\" \"\$root/pg_stat\" \
        \"\$root/pg_stat_tmp\" \"\$root/pg_subtrans\" \"\$root/pg_tblspc\" \
        \"\$root/pg_twophase\" \"\$root/pg_wal\" \"\$root/pg_xact\"
      printf '%s\\n' '$major' > \"\$root/PG_VERSION\"
      : > \"\$root/pg_hba.conf\"
      : > \"\$root/pg_ident.conf\"
      : > \"\$root/postgresql.auto.conf\"
      : > \"\$root/postgresql.conf\"
      printf 'canonical-control\\n' > \"\$root/global/pg_control\"
      printf 'preserved-row\\n' > \"\$root/base/aria-preserved-probe\""
}

start_layout_probe() {
  local container="$1" volume="$2" approval="${3:-}"
  if [ -n "$approval" ]; then
    docker run --detach \
      --name "$container" \
      --volume "$volume:/var/lib/postgresql" \
      --env "ARIA_DB_LAYOUT_MIGRATION_APPROVAL=$approval" \
      --entrypoint /usr/local/bin/aria-db-entrypoint \
      "$image" /bin/true >/dev/null
  else
    docker run --detach \
      --name "$container" \
      --volume "$volume:/var/lib/postgresql" \
      --entrypoint /usr/local/bin/aria-db-entrypoint \
      "$image" /bin/true >/dev/null
  fi
}

run_layout_success() {
  local volume="$1" approval="${2:-}" output
  if [ -n "$approval" ]; then
    output="$(docker run --rm \
      --volume "$volume:/var/lib/postgresql" \
      --env "ARIA_DB_LAYOUT_MIGRATION_APPROVAL=$approval" \
      --entrypoint /usr/local/bin/aria-db-entrypoint \
      "$image" /bin/true 2>&1)" || {
        printf '%s\n' "$output" >&2
        return 1
      }
  else
    output="$(docker run --rm \
      --volume "$volume:/var/lib/postgresql" \
      --entrypoint /usr/local/bin/aria-db-entrypoint \
      "$image" /bin/true 2>&1)" || {
        printf '%s\n' "$output" >&2
        return 1
      }
  fi
  if [ -n "$approval" ] && [[ "$output" == *"$approval"* ]]; then
    printf 'Layout migration output exposed its approval value.\n' >&2
    return 1
  fi
}

volume_shell() {
  local volume="$1"
  shift
  docker run --rm \
    --volume "$volume:/var/lib/postgresql" \
    --entrypoint /bin/sh \
    "$image" -c "$*"
}

expect_failure() {
  local container="$1" expected_code="$2" expected_fragment="$3" attempt state code output
  for attempt in $(seq 1 30); do
    state="$(docker inspect --format '{{.State.Status}}' "$container")"
    if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
      code="$(docker inspect --format '{{.State.ExitCode}}' "$container")"
      output="$(docker logs "$container" 2>&1)"
      if [ "$code" != "$expected_code" ] || [[ "$output" != *"$expected_fragment"* ]]; then
        printf '%s\n' "$output" >&2
        printf 'Observed exit code %s for %s.\n' "$code" "$container" >&2
        printf 'Expected %s to exit %s with: %s\n' "$container" "$expected_code" "$expected_fragment" >&2
        exit 1
      fi
      return 0
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  printf 'Expected %s to fail, but it remained running.\n' "$container" >&2
  exit 1
}

seed_lost_found "$root_volume" /var/lib/postgresql/data
docker run --detach \
  --name "$root_container" \
  --volume "$root_volume:/var/lib/postgresql/data" \
  --env POSTGRES_PASSWORD=test-only-password \
  --env JWT_SECRET=test-only-jwt-secret-with-sufficient-length \
  --env JWT_EXP=3600 \
  "$image" >/dev/null
expect_failure "$root_container" 1 "contains a lost+found directory"

seed_lost_found "$override_volume" /var/lib/postgresql/data "$base_image"
docker run --detach \
  --name "$override_container" \
  --volume "$override_volume:/var/lib/postgresql/data" \
  --env PGDATA=/var/lib/postgresql/data/pgdata \
  --env POSTGRES_PASSWORD=test-only-password \
  "$base_image" >/dev/null
expect_failure "$override_container" 1 'data directory "/var/lib/postgresql/data"'

seed_legacy_cluster "$legacy_volume"
start_layout_probe "$legacy_container" "$legacy_volume"
expect_failure "$legacy_container" 78 "explicit layout migration approval is required"
docker rm "$legacy_container" >/dev/null
volume_shell "$legacy_volume" \
  'test -s /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/data; test ! -e /var/lib/postgresql/.aria-layout-migration-v1'

start_layout_probe "$legacy_container" "$legacy_volume" \
  "aria-db-root-to-child-v1:${layout_release_sha}:not-a-receipt-digest"
expect_failure "$legacy_container" 78 "layout migration approval is invalid"
docker rm "$legacy_container" >/dev/null
volume_shell "$legacy_volume" \
  'test -s /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/data; test ! -e /var/lib/postgresql/.aria-layout-migration-v1'

run_layout_success "$legacy_volume" "$layout_approval"
volume_shell "$legacy_volume" \
  'set -eu
   grep -qx 17 /var/lib/postgresql/data/PG_VERSION
   grep -qx aria-db-init-v1 /var/lib/postgresql/data/.aria-init-complete
   grep -qx preserved-row /var/lib/postgresql/data/base/aria-preserved-probe
   test ! -e /var/lib/postgresql/PG_VERSION
   test ! -e /var/lib/postgresql/.aria-layout-migration-v1
   test ! -e /var/lib/postgresql/.aria-layout-migration-v1.pending
   test -d /var/lib/postgresql/lost+found'
# A completed child layout is independently safe and must not depend on the
# one-shot approval remaining in the Machine environment.
run_layout_success "$legacy_volume" "$wrong_layout_approval"
run_layout_success "$legacy_volume"
volume_shell "$legacy_volume" \
  'grep -qx preserved-row /var/lib/postgresql/data/base/aria-preserved-probe'

# Reproduce the prior Fly layout with a real PostgreSQL 17 cluster. The same
# volume is first mounted at /var/lib/postgresql/data, then remounted at its
# parent so the guarded root-to-child migration handles actual database files.
docker volume create "$legacy_real_volume" >/dev/null
docker run --detach \
  --name "$legacy_real_container" \
  --network "$network" \
  --volume "$legacy_real_volume:/var/lib/postgresql/data" \
  --env POSTGRES_PASSWORD="$owner_password" \
  "$base_image" >/dev/null
for attempt in $(seq 1 180); do
  if docker exec --env PGPASSWORD="$owner_password" "$legacy_real_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -Atqc 'select 1' \
    2>/dev/null | grep -qx '1'; then
    break
  fi
  [ "$attempt" -lt 180 ] || { docker logs "$legacy_real_container" >&2; exit 1; }
  sleep 1
done
docker exec --env PGPASSWORD="$owner_password" "$legacy_real_container" \
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
  -c "create table public.__aria_layout_probe(value text not null); insert into public.__aria_layout_probe values ('preserved-real-cluster');" \
  >/dev/null
docker stop "$legacy_real_container" >/dev/null
docker rm "$legacy_real_container" >/dev/null

docker run --detach \
  --name "$legacy_real_container" \
  --network "$network" \
  --volume "$legacy_real_volume:/var/lib/postgresql" \
  --env ARIA_DB_LAYOUT_MIGRATION_APPROVAL="$layout_approval" \
  "$image" >/dev/null
for attempt in $(seq 1 180); do
  if docker exec --env PGPASSWORD="$owner_password" "$legacy_real_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -Atqc \
      'select value from public.__aria_layout_probe' 2>/dev/null \
    | grep -qx 'preserved-real-cluster'; then
    break
  fi
  [ "$attempt" -lt 180 ] || { docker logs "$legacy_real_container" >&2; exit 1; }
  sleep 1
done
docker restart "$legacy_real_container" >/dev/null
for attempt in $(seq 1 180); do
  if docker exec --env PGPASSWORD="$owner_password" "$legacy_real_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -Atqc \
      'select value from public.__aria_layout_probe' 2>/dev/null \
    | grep -qx 'preserved-real-cluster'; then
    break
  fi
  [ "$attempt" -lt 180 ] || { docker logs "$legacy_real_container" >&2; exit 1; }
  sleep 1
done
docker exec "$legacy_real_container" grep -qx aria-db-init-v1 /var/lib/postgresql/data/.aria-init-complete
docker exec "$legacy_real_container" test ! -e /var/lib/postgresql/PG_VERSION
docker rm -f "$legacy_real_container" >/dev/null
printf 'legacy_real_cluster=pass\n'

seed_legacy_cluster "$resume_volume"
volume_shell "$resume_volume" \
  "set -eu
   umask 077
   printf '%s\\n' '$layout_approval' > /var/lib/postgresql/.aria-layout-migration-v1
   mkdir /var/lib/postgresql/data
   mv /var/lib/postgresql/base /var/lib/postgresql/global /var/lib/postgresql/data/"
start_layout_probe "$resume_container" "$resume_volume" "$wrong_layout_approval"
expect_failure "$resume_container" 78 "approval does not match the in-progress layout migration"
docker rm "$resume_container" >/dev/null
volume_shell "$resume_volume" \
  'test -d /var/lib/postgresql/data/base; test -s /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/data/PG_VERSION'
run_layout_success "$resume_volume" "$layout_approval"
volume_shell "$resume_volume" \
  'grep -qx aria-db-init-v1 /var/lib/postgresql/data/.aria-init-complete; grep -qx preserved-row /var/lib/postgresql/data/base/aria-preserved-probe; test ! -e /var/lib/postgresql/PG_VERSION'

seed_legacy_cluster "$ambiguous_volume"
volume_shell "$ambiguous_volume" \
  'mkdir -p /var/lib/postgresql/data/base; printf "foreign-child\n" > /var/lib/postgresql/data/base/do-not-overwrite'
start_layout_probe "$ambiguous_container" "$ambiguous_volume" "$layout_approval"
expect_failure "$ambiguous_container" 78 "ambiguous PostgreSQL layout exists without a migration journal"
docker rm "$ambiguous_container" >/dev/null
volume_shell "$ambiguous_volume" \
  'test -d /var/lib/postgresql/base; grep -qx foreign-child /var/lib/postgresql/data/base/do-not-overwrite; test -s /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/.aria-layout-migration-v1'
volume_shell "$ambiguous_volume" \
  "umask 077; printf '%s\\n' '$layout_approval' > /var/lib/postgresql/.aria-layout-migration-v1"
start_layout_probe "$ambiguous_container" "$ambiguous_volume" "$layout_approval"
expect_failure "$ambiguous_container" 78 "layout migration would overwrite an existing PostgreSQL child entry: base"
docker rm "$ambiguous_container" >/dev/null
volume_shell "$ambiguous_volume" \
  'test -d /var/lib/postgresql/base; grep -qx foreign-child /var/lib/postgresql/data/base/do-not-overwrite; test ! -e /var/lib/postgresql/data/.aria-init-complete'

seed_legacy_cluster "$unexpected_volume"
volume_shell "$unexpected_volume" 'mkdir /var/lib/postgresql/operator-notes'
start_layout_probe "$unexpected_container" "$unexpected_volume" "$layout_approval"
expect_failure "$unexpected_container" 78 "unexpected entry exists at the PostgreSQL volume root"
docker rm "$unexpected_container" >/dev/null
volume_shell "$unexpected_volume" \
  'test -d /var/lib/postgresql/operator-notes; test -s /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/data'

seed_legacy_cluster "$major_volume" 16
start_layout_probe "$major_container" "$major_volume" "$layout_approval"
expect_failure "$major_container" 78 "legacy PostgreSQL cluster must be major version 17"
docker rm "$major_container" >/dev/null
volume_shell "$major_volume" \
  'grep -qx 16 /var/lib/postgresql/PG_VERSION; test ! -e /var/lib/postgresql/data'

docker volume create "$partial_volume" >/dev/null
docker run --rm \
  --volume "$partial_volume:/var/lib/postgresql" \
  --entrypoint /bin/sh \
  "$image" \
  -c 'mkdir -p /var/lib/postgresql/data; touch /var/lib/postgresql/data/PG_VERSION; printf "foreign-marker\n" > /var/lib/postgresql/data/.aria-init-complete'
docker run --detach \
  --name "$partial_container" \
  --volume "$partial_volume:/var/lib/postgresql" \
  --env POSTGRES_PASSWORD=test-only-password \
  --env JWT_SECRET=test-only-jwt-secret-with-sufficient-length \
  --env JWT_EXP=3600 \
  "$image" >/dev/null
expect_failure "$partial_container" 78 "incomplete PostgreSQL initialization detected"
docker run --rm \
  --volume "$partial_volume:/var/lib/postgresql" \
  --entrypoint /bin/sh \
  "$image" \
  -c 'grep -qx "foreign-marker" /var/lib/postgresql/data/.aria-init-complete'

seed_lost_found "$parent_volume" /var/lib/postgresql
docker run --detach \
  --name "$parent_container" \
  --network "$network" \
  --network-alias db \
  --volume "$parent_volume:/var/lib/postgresql" \
  --env POSTGRES_PASSWORD="$owner_password" \
  --env SUPABASE_ADMIN_TARGET_PASSWORD="$owner_password" \
  --env POSTGRES_TARGET_PASSWORD="$postgres_password" \
  --env SUPABASE_AUTH_ADMIN_TARGET_PASSWORD="$auth_password" \
  --env AUTHENTICATOR_TARGET_PASSWORD="$rest_password" \
  --env JWT_SECRET="$jwt_secret" \
  --env JWT_EXP=3600 \
  --env ARIA_DB_LAYOUT_MIGRATION_APPROVAL="$layout_approval" \
  "$image" >/dev/null

wait_ready() {
  local require_init_log="${1:-1}" attempt state
  for attempt in $(seq 1 180); do
    if docker exec "$parent_container" sh -c \
      'tr "\000" " " </proc/1/cmdline | grep -Eq "(^|/)postgres[[:space:]].*-D[[:space:]]+/etc/postgresql([[:space:]]|$)"' \
      >/dev/null 2>&1 \
      && docker exec --env PGPASSWORD="$postgres_password" "$parent_container" \
        pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1 \
      && docker exec --env PGPASSWORD="$postgres_password" "$parent_container" \
        psql -X -h 127.0.0.1 -U postgres -d postgres -Atqc 'select 1' 2>/dev/null \
        | grep -qx '1'; then
      if [ "$require_init_log" = 0 ] \
        || docker logs "$parent_container" 2>&1 \
          | grep -F 'PostgreSQL init process complete' >/dev/null; then
        return 0
      fi
    fi
    state="$(docker inspect --format '{{.State.Status}}' "$parent_container")"
    if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
      docker logs "$parent_container" >&2
      return 1
    fi
    sleep 1
  done
  docker logs "$parent_container" >&2
  return 1
}

psql_tcp() {
  docker exec --env PGPASSWORD="$postgres_password" "$parent_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"
}

password_for_role() {
  case "$1" in
    postgres) printf '%s' "$postgres_password" ;;
    authenticator) printf '%s' "$rest_password" ;;
    supabase_auth_admin) printf '%s' "$auth_password" ;;
    supabase_admin) printf '%s' "$owner_password" ;;
    *) printf 'Unknown database role in external-auth probe: %s\n' "$1" >&2; return 2 ;;
  esac
}

psql_external() {
  local role="$1" password
  shift
  password="$(password_for_role "$role")"
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$password" \
    --entrypoint psql \
    "$base_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "$role" -d postgres "$@"
}

assert_logs_exclude_canaries() {
  local logs canary_name canary_value
  logs="$(docker logs "$parent_container" 2>&1)"
  for canary_name in owner_password postgres_password auth_password rest_password jwt_secret; do
    canary_value="${!canary_name}"
    if [[ "$logs" == *"$canary_value"* ]]; then
      printf 'Database logs exposed the %s canary.\n' "$canary_name" >&2
      return 1
    fi
  done
}

wait_ready
docker exec "$parent_container" sh -c \
  'test "$HISTFILE" = /dev/null; test "$PSQL_HISTORY" = /dev/null; test "$LESSHISTFILE" = -'
printf 'operator_history_environment=pass\n'
psql_external supabase_admin -Atqc 'SHOW data_directory' \
  | grep -qx '/var/lib/postgresql/data'
psql_tcp -Atqc 'SHOW server_version_num' \
  | grep -Eq '^17[0-9]{4}$'
psql_tcp -Atqc "select count(*) from pg_roles where rolname in ('authenticator','postgres','pgbouncer','supabase_auth_admin','supabase_storage_admin')" \
  | grep -qx '5'
psql_tcp -Atqc "select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'auth'" \
  | grep -qx 'supabase_auth_admin'
for role in postgres authenticator supabase_auth_admin supabase_admin; do
  psql_external "$role" -Atqc 'select 1' | grep -qx '1'
done
psql_tcp \
  -c 'create table public.__aria_restart_probe(id integer primary key); insert into public.__aria_restart_probe values (1);' \
  >/dev/null

for restart in 1 2; do
  docker restart "$parent_container" >/dev/null
  wait_ready
  psql_tcp -Atqc 'select count(*) from public.__aria_restart_probe' \
    | grep -qx '1'
  printf 'restart_%s=pass\n' "$restart"
done

# Interactive operator shells can treat the volume root as the postgres home.
# Benign history artifacts must never brick the next database restart.
docker exec "$parent_container" sh -c \
  'printf "test history\n" > /var/lib/postgresql/.psql_history; printf "test history\n" > /var/lib/postgresql/.bash_history; printf "test history\n" > /var/lib/postgresql/.lesshst'
docker restart "$parent_container" >/dev/null
wait_ready
docker exec "$parent_container" sh -c \
  'test ! -e /var/lib/postgresql/.psql_history; test ! -e /var/lib/postgresql/.bash_history; test ! -e /var/lib/postgresql/.lesshst'
printf 'operator_history_restart=pass\n'
assert_logs_exclude_canaries

# A history pathname must never become a generic deletion primitive. Only a
# regular file is disposable; symlinks and directories remain layout errors.
docker rm -f "$parent_container" >/dev/null
volume_shell "$parent_volume" \
  'ln -s data/.aria-init-complete /var/lib/postgresql/.psql_history'
start_layout_probe "$parent_container" "$parent_volume"
expect_failure "$parent_container" 78 \
  'PostgreSQL operator history entry is not a regular file: .psql_history'
docker rm "$parent_container" >/dev/null
volume_shell "$parent_volume" 'rm /var/lib/postgresql/.psql_history'
printf 'operator_history_symlink=blocked\n'

volume_shell "$parent_volume" 'mkdir /var/lib/postgresql/.bash_history'
start_layout_probe "$parent_container" "$parent_volume"
expect_failure "$parent_container" 78 \
  'PostgreSQL operator history entry is not a regular file: .bash_history'
docker rm "$parent_container" >/dev/null
volume_shell "$parent_volume" 'rmdir /var/lib/postgresql/.bash_history'
printf 'operator_history_directory=blocked\n'

# Fly removes the first-init database secrets after the owner reconciliation.
# Recreate the Machine-equivalent container from the same durable volume with
# no init credential environment variables, then prove the initialized cluster,
# persisted data, and externally authenticated roles still work.
docker rm -f "$parent_container" >/dev/null 2>&1 || true
docker run --detach \
  --name "$parent_container" \
  --network "$network" \
  --network-alias db \
  --volume "$parent_volume:/var/lib/postgresql" \
  "$image" >/dev/null
wait_ready 0
if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$parent_container" \
  | grep -Eq '^(POSTGRES_PASSWORD|SUPABASE_ADMIN_TARGET_PASSWORD|POSTGRES_TARGET_PASSWORD|SUPABASE_AUTH_ADMIN_TARGET_PASSWORD|AUTHENTICATOR_TARGET_PASSWORD|JWT_SECRET)='; then
  printf 'Recreated database container unexpectedly retained an init secret.\n' >&2
  exit 1
fi
if docker logs "$parent_container" 2>&1 | grep -Fq 'PostgreSQL init process complete'; then
  printf 'Recreated database container unexpectedly initialized the durable cluster again.\n' >&2
  exit 1
fi
psql_tcp -Atqc 'select count(*) from public.__aria_restart_probe' \
  | grep -qx '1'
for role in postgres authenticator supabase_auth_admin supabase_admin; do
  psql_external "$role" -Atqc 'select 1' | grep -qx '1'
done
assert_logs_exclude_canaries
printf 'recreate_without_init_secrets=pass\n'

docker exec "$parent_container" test -s /var/lib/postgresql/data/PG_VERSION
docker exec "$parent_container" grep -qx 'aria-db-init-v1' /var/lib/postgresql/data/.aria-init-complete
docker exec "$parent_container" test ! -e /var/lib/postgresql/PG_VERSION
docker exec "$parent_container" test -d /var/lib/postgresql/lost+found
printf 'RESULT fly-db-volume: unsafe_root_mount=failed pgdata_only=failed legacy_no_approval=blocked legacy_wrong_approval=blocked legacy_cutover=pass legacy_real_cluster=pass legacy_recreate=pass partial_resume=pass child_overwrite=blocked ambiguous_layout=blocked unexpected_layout=blocked wrong_major=blocked partial_init=blocked parent_mount=ready operator_history_environment=pass restart_1=pass restart_2=pass operator_history_restart=pass operator_history_symlink=blocked operator_history_directory=blocked recreate_without_init_secrets=pass\n'
