#!/usr/bin/env bash
set -Eeuo pipefail

project="aria-db-privileges-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-0}"
export DB_HOST_PORT=0
owner_reconciliation="docker/bootstrap/supabase-admin-reconciliation.sql"
client_image="supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00"
network="${project}_default"
secret_prefix="aria-db-owner-secret-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
bootstrap_password="local_owner_current_password_00000000000000000"
postgres_current_password="${secret_prefix}-current-postgres"
owner_current_password="${secret_prefix}-current-supabase-admin"
auth_admin_current_password="${secret_prefix}-current-auth-admin"
authenticator_current_password="${secret_prefix}-current-authenticator"
postgres_target_password="${secret_prefix}-target-postgres"
owner_target_password="${secret_prefix}-target-supabase-admin"
auth_admin_target_password="${secret_prefix}-target-auth-admin"
authenticator_target_password="${secret_prefix}-target-authenticator"
owner_forbidden_password="${secret_prefix}-forbidden-supabase-admin"
postgres_forbidden_password="${secret_prefix}-forbidden-postgres"
auth_admin_forbidden_password="${secret_prefix}-forbidden-auth-admin"
authenticator_forbidden_password="${secret_prefix}-forbidden-authenticator"
jwt_secret="${secret_prefix}-jwt-secret"
owner_log="$(mktemp /tmp/aria-owner-reconciliation.XXXXXX)"
database_log="$(mktemp /tmp/aria-owner-database.XXXXXX)"
legacy_log="$(mktemp /tmp/aria-legacy-preflight.XXXXXX)"
legacy_migration_manifest="$(mktemp /tmp/aria-legacy-migrations.XXXXXX)"
legacy_row_manifest="$(mktemp /tmp/aria-legacy-rows.XXXXXX)"
legacy_schema_before="$(mktemp /tmp/aria-legacy-schema-before.XXXXXX)"
legacy_schema_after="$(mktemp /tmp/aria-legacy-schema-after.XXXXXX)"
recovery_complete_log="$(mktemp /tmp/aria-recovery-complete.XXXXXX)"
recovery_empty_log="$(mktemp /tmp/aria-recovery-empty.XXXXXX)"
empty_schema_before="$(mktemp /tmp/aria-empty-schema-before.XXXXXX)"
empty_schema_after="$(mktemp /tmp/aria-empty-schema-after.XXXXXX)"

cleanup() {
  docker compose -p "$project" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f \
    "$owner_log" "$database_log" "$legacy_log" "$legacy_migration_manifest" \
    "$legacy_row_manifest" "$legacy_schema_before" "$legacy_schema_after" \
    "$recovery_complete_log" "$recovery_empty_log" \
    "$empty_schema_before" "$empty_schema_after"
}
trap cleanup EXIT

docker info >/dev/null
test -f "$owner_reconciliation"
docker compose -p "$project" up -d --wait db
container_id="$(docker compose -p "$project" ps -q db)"
test -n "$container_id"

psql_external() {
  local role="$1" password="$2"
  shift 2
  docker run --rm \
    --network "$network" \
    --env PGPASSWORD="$password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "$role" -d postgres "$@"
}

psql_external_stdin() {
  local role="$1" password="$2"
  shift 2
  docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$password" \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U "$role" -d postgres "$@"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

canonical_public_schema() {
  local output="$1" password="${2:-$owner_target_password}"
  PGPASSWORD="$password" docker run --rm \
    --network "$network" \
    --env PGPASSWORD \
    --entrypoint pg_dump \
    "$client_image" \
    -w -h db -U supabase_admin -d postgres \
    --schema-only --no-owner --no-privileges --schema=public \
    --exclude-table=public.aria_schema_migrations \
    | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
        -e '/^-- Dumped from /d' -e '/^-- Dumped by /d' > "$output"
}

build_legacy_row_manifest() {
  : > "$legacy_row_manifest"
  while IFS= read -r table_name; do
    [[ "$table_name" =~ ^[a-z][a-z0-9_]*$ ]]
    row_state="$(psql_external supabase_admin "$owner_target_password" -Atqc "
      set timezone = 'UTC';
      set datestyle = 'ISO, YMD';
      set intervalstyle = 'iso_8601';
      set extra_float_digits = 3;
      set bytea_output = 'hex';
      select count(*)::text || ':' ||
             encode(digest(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'sha256'), 'hex')
        from (
          select encode(digest(row_to_json(source_row)::text, 'sha256'), 'hex') as row_hash
            from public.$table_name as source_row
        ) as hashed_rows;
    ")"
    [[ "$row_state" =~ ^[0-9]+:[0-9a-f]{64}$ ]]
    printf 'public.%s=%s\n' "$table_name" "$row_state" >> "$legacy_row_manifest"
  done < docker/bootstrap/legacy-table-inventory.txt
}

run_fly_bootstrap_phase() {
  local phase="$1" include_approval="${2:-no}"
  local -a environment=(
    --env ARIA_BOOTSTRAP_PHASE="$phase"
    --env DB_HOST=db
    --env DB_PORT=5432
    --env DB_NAME=postgres
    --env SUPABASE_ADMIN_CURRENT_PASSWORD
    --env POSTGRES_TARGET_PASSWORD
    --env ARIA_LEGACY_APPROVED_SCHEMA_SHA256
    --env ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256
    --env ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256
    --env ARIA_RECOVERY_MIGRATION_STATE
  )
  if [ "$include_approval" = yes ]; then
    environment+=(--env ARIA_LEGACY_BASELINE_APPROVAL_SHA256)
  fi
  docker run --rm \
    --network "$network" \
    "${environment[@]}" \
    --volume "$PWD/docker/bootstrap/run.fly.sh:/usr/local/bin/run.fly.sh:ro" \
    --volume "$PWD/docker/bootstrap/legacy-baseline-invariants.sql:/opt/aria/legacy-baseline-invariants.sql:ro" \
    --volume "$PWD/docker/bootstrap/legacy-table-inventory.txt:/opt/aria/legacy-table-inventory.txt:ro" \
    --volume "$PWD/docker/bootstrap/legacy-baseline-public-schema.sha256:/opt/aria/legacy-baseline-public-schema.sha256:ro" \
    --volume "$PWD/docker/bootstrap/recovery-empty-public-schema.sha256:/opt/aria/recovery-empty-public-schema.sha256:ro" \
    --volume "$PWD/supabase/migrations:/migrations:ro" \
    --entrypoint /bin/sh \
    "$client_image" \
    /usr/local/bin/run.fly.sh
}

run_owner_reconciliation() {
  local current_password="$1" postgres_password="$2" owner_password="$3"
  local auth_admin_password="$4" authenticator_password="$5"
  if ! docker run --rm -i \
    --network "$network" \
    --env PGPASSWORD="$current_password" \
    --env POSTGRES_TARGET_PASSWORD="$postgres_password" \
    --env SUPABASE_ADMIN_TARGET_PASSWORD="$owner_password" \
    --env SUPABASE_AUTH_ADMIN_TARGET_PASSWORD="$auth_admin_password" \
    --env AUTHENTICATOR_TARGET_PASSWORD="$authenticator_password" \
    --env JWT_SECRET="$jwt_secret" \
    --env JWT_EXP=3600 \
    --entrypoint psql \
    "$client_image" \
    -X -v ON_ERROR_STOP=1 -h db -U supabase_admin -d postgres \
    >>"$owner_log" 2>&1 < "$owner_reconciliation"; then
    echo "supabase_admin reconciliation failed" >&2
    exit 1
  fi
}

assert_external_connection() {
  local role="$1" password="$2" expected="$3"
  if psql_external "$role" "$password" -Atqc 'select current_user' \
    >>"$owner_log" 2>&1; then
    if [ "$expected" != allowed ]; then
      echo "retired database password still authenticates" >&2
      exit 1
    fi
  elif [ "$expected" = allowed ]; then
    echo "current database password does not authenticate" >&2
    exit 1
  fi
}

# A valid, untouched PostgreSQL 17 cluster is a recovery state of its own. It
# must pass read-only proof before any credential rotation or ARIA DDL, but it
# must never receive a legacy-baseline approval.
: > "$legacy_migration_manifest"
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  printf '%s=%s\n' "$(basename "$migration")" "$(sha256_file "$migration")" \
    >> "$legacy_migration_manifest"
done
canonical_public_schema "$empty_schema_before" "$bootstrap_password"
ARIA_LEGACY_APPROVED_SCHEMA_SHA256="$(sha256_file "$empty_schema_before")"
test -f docker/bootstrap/recovery-empty-public-schema.sha256
empty_reviewed_schema_sha256="$(tr -d '[:space:]' < docker/bootstrap/recovery-empty-public-schema.sha256)"
[ "$ARIA_LEGACY_APPROVED_SCHEMA_SHA256" = "$empty_reviewed_schema_sha256" ]
: > "$legacy_row_manifest"
ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256="$(sha256_file "$legacy_row_manifest")"
ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256="$(sha256_file "$legacy_migration_manifest")"
SUPABASE_ADMIN_CURRENT_PASSWORD="$bootstrap_password"
POSTGRES_TARGET_PASSWORD="$postgres_target_password"
ARIA_RECOVERY_MIGRATION_STATE=verified-empty
export \
  SUPABASE_ADMIN_CURRENT_PASSWORD \
  POSTGRES_TARGET_PASSWORD \
  ARIA_RECOVERY_MIGRATION_STATE \
  ARIA_LEGACY_APPROVED_SCHEMA_SHA256 \
  ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256 \
  ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256
if ! run_fly_bootstrap_phase recovery-preflight > "$recovery_empty_log" 2>&1; then
  echo "verified-empty recovery preflight failed" >&2
  tail -n 40 "$recovery_empty_log" >&2
  exit 1
fi
grep -Eq '^ARIA_RECOVERY_PREFLIGHT_SHA256=[0-9a-f]{64}$' "$recovery_empty_log"
if grep -q '^ARIA_LEGACY_BASELINE_APPROVAL_SHA256=' "$recovery_empty_log"; then
  echo "verified-empty recovery incorrectly emitted a baseline approval" >&2
  exit 1
fi
canonical_public_schema "$empty_schema_after" "$bootstrap_password"
cmp -s "$empty_schema_before" "$empty_schema_after"
psql_external supabase_admin "$bootstrap_password" -Atqc \
  "select count(*) from pg_tables where schemaname='public'" | grep -qx '0'
psql_external supabase_admin "$bootstrap_password" -Atqc \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'" \
  | grep -qx '0'
psql_external supabase_admin "$bootstrap_password" -Atqc \
  "select to_regclass('public.aria_schema_migrations') is null" | grep -qx 't'
echo "[test] verified-empty PostgreSQL 17 recovery preflight passed read-only" >&2

# The owner reconciliation must reject a postgres session before changing any
# password or default ACL. A static contract separately proves the guard is the
# reason for this failure rather than an incidental SQL error.
if docker run --rm -i \
  --network "$network" \
  --env PGPASSWORD="$bootstrap_password" \
  --env POSTGRES_TARGET_PASSWORD="$postgres_forbidden_password" \
  --env SUPABASE_ADMIN_TARGET_PASSWORD="$owner_forbidden_password" \
  --env SUPABASE_AUTH_ADMIN_TARGET_PASSWORD="$auth_admin_forbidden_password" \
  --env AUTHENTICATOR_TARGET_PASSWORD="$authenticator_forbidden_password" \
  --env JWT_SECRET="$jwt_secret" \
  --env JWT_EXP=3600 \
  --entrypoint psql \
  "$client_image" \
  -X -v ON_ERROR_STOP=1 -h db -U postgres -d postgres \
  >>"$owner_log" 2>&1 < "$owner_reconciliation"; then
  echo "postgres unexpectedly ran supabase_admin reconciliation" >&2
  exit 1
fi

# Rotate from the image bootstrap password, rotate again, then reconcile the
# same target a second time. This proves current/target recovery, password
# retirement, and idempotence through direct supabase_admin TCP sessions.
run_owner_reconciliation \
  "$bootstrap_password" \
  "$postgres_current_password" \
  "$owner_current_password" \
  "$auth_admin_current_password" \
  "$authenticator_current_password"
for role in postgres supabase_admin supabase_auth_admin authenticator; do
  assert_external_connection "$role" "$bootstrap_password" denied
done
assert_external_connection postgres "$postgres_current_password" allowed
assert_external_connection supabase_admin "$owner_current_password" allowed
assert_external_connection supabase_auth_admin "$auth_admin_current_password" allowed
assert_external_connection authenticator "$authenticator_current_password" allowed
assert_external_connection pgbouncer "$bootstrap_password" denied
assert_external_connection supabase_storage_admin "$bootstrap_password" denied

run_owner_reconciliation \
  "$owner_current_password" \
  "$postgres_target_password" \
  "$owner_target_password" \
  "$auth_admin_target_password" \
  "$authenticator_target_password"
assert_external_connection postgres "$postgres_current_password" denied
assert_external_connection supabase_admin "$owner_current_password" denied
assert_external_connection supabase_auth_admin "$auth_admin_current_password" denied
assert_external_connection authenticator "$authenticator_current_password" denied
assert_external_connection postgres "$postgres_target_password" allowed
assert_external_connection supabase_admin "$owner_target_password" allowed
assert_external_connection supabase_auth_admin "$auth_admin_target_password" allowed
assert_external_connection authenticator "$authenticator_target_password" allowed

run_owner_reconciliation \
  "$owner_target_password" \
  "$postgres_target_password" \
  "$owner_target_password" \
  "$auth_admin_target_password" \
  "$authenticator_target_password"
assert_external_connection postgres "$postgres_target_password" allowed
assert_external_connection supabase_admin "$owner_target_password" allowed
psql_external supabase_admin "$owner_target_password" -Atqc "
  select count(*)
    from pg_authid
   where rolname in ('pgbouncer', 'supabase_storage_admin', 'supabase_functions_admin')
     and (rolcanlogin or rolpassword is not null)
" | grep -qx '0'

psql_external supabase_admin "$owner_target_password" -Atqc "
  select rolsuper::text || '|' || rolcreatedb::text || '|' || rolcreaterole::text || '|' ||
         rolreplication::text || '|' || rolbypassrls::text
    from pg_roles
   where rolname = 'postgres'
" | grep -qx 'false|false|false|false|false'
psql_external supabase_admin "$owner_target_password" -Atqc "
  select count(*)
    from pg_auth_members membership
    join pg_roles member_role on member_role.oid = membership.member
   where member_role.rolname = 'postgres'
" | grep -qx '0'

# Numbered migrations always run as a separate direct postgres session. In
# particular, 0019 must not try to mutate supabase_admin-owned default ACLs.
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql_external_stdin postgres "$postgres_target_password" < "$migration"
done
echo "[test] restricted postgres applied every numbered migration" >&2

psql_external supabase_admin "$owner_target_password" -Atqc "
  select
    has_schema_privilege('service_role', 'public', 'USAGE')
    and has_table_privilege('service_role', 'public.workspaces', 'SELECT')
    and has_table_privilege('service_role', 'public.workspaces', 'INSERT')
    and has_table_privilege('service_role', 'public.workspaces', 'DELETE')
    and has_table_privilege('service_role', 'public.profiles', 'SELECT')
    and has_table_privilege('service_role', 'public.profiles', 'INSERT')
    and has_table_privilege('service_role', 'public.workspace_state', 'SELECT')
    and has_table_privilege('service_role', 'public.outreach_ledger', 'SELECT')
    and has_table_privilege('service_role', 'public.messages_outbound', 'SELECT')
" | grep -qx 't'
echo "[test] service role has the exact ephemeral acceptance setup and cleanup authority" >&2

recovery_probe_workspace_id="00000000-0000-4000-8000-000000000019"
psql_external supabase_admin "$owner_target_password" -v ON_ERROR_STOP=1 -qc "
  insert into public.workspaces (id, name, allowed_domain)
  values ('$recovery_probe_workspace_id', 'approved recovery content', 'recovery-probe.example');
"

# A pre-ledger database must be adopted only through a no-mutation preflight
# bound to the approved recovery receipt, followed by an exact digest approval.
: > "$legacy_migration_manifest"
for migration in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  printf '%s=%s\n' "$(basename "$migration")" "$(sha256_file "$migration")" \
    >> "$legacy_migration_manifest"
done
canonical_public_schema "$legacy_schema_before"
echo "[test] canonical legacy public schema captured" >&2
ARIA_LEGACY_APPROVED_SCHEMA_SHA256="$(sha256_file "$legacy_schema_before")"
reviewed_schema_sha256="$(tr -d '[:space:]' < docker/bootstrap/legacy-baseline-public-schema.sha256)"
if [ "$ARIA_LEGACY_APPROVED_SCHEMA_SHA256" != "$reviewed_schema_sha256" ]; then
  echo "reviewed schema fingerprint mismatch: actual=$ARIA_LEGACY_APPROVED_SCHEMA_SHA256 expected=$reviewed_schema_sha256" >&2
  exit 1
fi
build_legacy_row_manifest
echo "[test] bounded legacy row fingerprint captured" >&2
ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256="$(sha256_file "$legacy_row_manifest")"
ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256="$(sha256_file "$legacy_migration_manifest")"
SUPABASE_ADMIN_CURRENT_PASSWORD="$owner_target_password"
POSTGRES_TARGET_PASSWORD="$postgres_target_password"
export \
  SUPABASE_ADMIN_CURRENT_PASSWORD \
  POSTGRES_TARGET_PASSWORD \
  ARIA_LEGACY_APPROVED_SCHEMA_SHA256 \
  ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256 \
  ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256
ARIA_RECOVERY_MIGRATION_STATE=verified-pre-ledger
export ARIA_RECOVERY_MIGRATION_STATE

psql_external supabase_admin "$owner_target_password" -Atqc \
  "select to_regclass('public.aria_schema_migrations') is null" | grep -qx 't'
if ! run_fly_bootstrap_phase recovery-preflight > "$legacy_log" 2>&1; then
  echo "legacy preflight failed" >&2
  tail -n 40 "$legacy_log" >&2
  exit 1
fi
echo "[test] read-only legacy preflight passed" >&2
ARIA_LEGACY_BASELINE_APPROVAL_SHA256="$(
  sed -n 's/^ARIA_LEGACY_BASELINE_APPROVAL_SHA256=//p' "$legacy_log"
)"
[[ "$ARIA_LEGACY_BASELINE_APPROVAL_SHA256" =~ ^[0-9a-f]{64}$ ]]
canonical_public_schema "$legacy_schema_after"
cmp -s "$legacy_schema_before" "$legacy_schema_after"
build_legacy_row_manifest
[ "$(sha256_file "$legacy_row_manifest")" = "$ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256" ]
psql_external supabase_admin "$owner_target_password" -Atqc \
  "select to_regclass('public.aria_schema_migrations') is null" | grep -qx 't'

psql_external supabase_admin "$owner_target_password" -v ON_ERROR_STOP=1 -qc "
  update public.workspaces
     set name = 'same count but unapproved content'
   where id = '$recovery_probe_workspace_id';
"
if run_fly_bootstrap_phase recovery-preflight >> "$legacy_log" 2>&1; then
  echo "recovery preflight accepted same-cardinality data corruption" >&2
  exit 1
fi
psql_external supabase_admin "$owner_target_password" -v ON_ERROR_STOP=1 -qc "
  update public.workspaces
     set name = 'approved recovery content'
   where id = '$recovery_probe_workspace_id';
"
echo "[test] same-cardinality data drift was rejected" >&2

if run_fly_bootstrap_phase legacy-baseline >> "$legacy_log" 2>&1; then
  echo "legacy baseline unexpectedly accepted missing approval" >&2
  exit 1
fi
psql_external supabase_admin "$owner_target_password" -Atqc \
  "select to_regclass('public.aria_schema_migrations') is null" | grep -qx 't'
ARIA_LEGACY_BASELINE_APPROVAL_SHA256="$(printf '0%.0s' {1..64})"
export ARIA_LEGACY_BASELINE_APPROVAL_SHA256
if run_fly_bootstrap_phase legacy-baseline yes >> "$legacy_log" 2>&1; then
  echo "legacy baseline unexpectedly accepted a foreign approval" >&2
  exit 1
fi
psql_external supabase_admin "$owner_target_password" -Atqc \
  "select to_regclass('public.aria_schema_migrations') is null" | grep -qx 't'
ARIA_LEGACY_BASELINE_APPROVAL_SHA256="$(
  sed -n 's/^ARIA_LEGACY_BASELINE_APPROVAL_SHA256=//p' "$legacy_log" | head -n 1
)"
export ARIA_LEGACY_BASELINE_APPROVAL_SHA256
run_fly_bootstrap_phase legacy-baseline yes >> "$legacy_log" 2>&1
echo "[test] explicitly approved legacy baseline passed" >&2

expected_ledger_identities="$(sed 's/=/:/' "$legacy_migration_manifest" | paste -sd, -)"
actual_ledger_identities="$(psql_external supabase_admin "$owner_target_password" -Atqc \
  "select string_agg(filename || ':' || sha256, ',' order by filename) from public.aria_schema_migrations")"
if [ "$actual_ledger_identities" != "$expected_ledger_identities" ]; then
  echo "legacy ledger identities differ from the migration manifest" >&2
  exit 1
fi
psql_external supabase_admin "$owner_target_password" -Atqc \
  "select rowsecurity from pg_tables where schemaname='public' and tablename='aria_schema_migrations'" \
  | grep -qx 't'
echo "[test] filename-plus-SHA ledger is exact and RLS protected" >&2
ARIA_RECOVERY_MIGRATION_STATE=complete-ledger
export ARIA_RECOVERY_MIGRATION_STATE
if ! run_fly_bootstrap_phase recovery-preflight > "$recovery_complete_log" 2>&1; then
  echo "complete-ledger recovery preflight failed" >&2
  tail -n 40 "$recovery_complete_log" >&2
  exit 1
fi
grep -Eq '^ARIA_RECOVERY_PREFLIGHT_SHA256=[0-9a-f]{64}$' "$recovery_complete_log"
if grep -q '^ARIA_LEGACY_BASELINE_APPROVAL_SHA256=' "$recovery_complete_log"; then
  echo "complete-ledger recovery incorrectly emitted a baseline approval" >&2
  exit 1
fi
echo "[test] complete-ledger recovery preflight passed read-only" >&2
if ! run_fly_bootstrap_phase migrations >> "$legacy_log" 2>&1; then
  echo "restricted migration phase failed after baselining" >&2
  tail -n 60 "$legacy_log" >&2
  exit 1
fi
echo "[test] restricted migration phase accepted the exact baseline" >&2

# Create future-object probes through the actual owner connection. SET ROLE in
# a postgres session is not accepted as evidence of owner-local default ACLs.
psql_external supabase_admin "$owner_target_password" -qc '
  create table public.__aria_supabase_admin_default_acl_table_probe(id bigint);
  create sequence public.__aria_supabase_admin_default_acl_sequence_probe;
  create function public.__aria_supabase_admin_default_acl_function_probe()
  returns integer language sql as $$select 1$$;
'

psql_external_stdin postgres "$postgres_target_password" < tests/db/function-privileges.sql
psql_external_stdin supabase_admin "$owner_target_password" < tests/db/ensure-workspace-authority.sql
psql_external_stdin supabase_admin "$owner_target_password" < tests/db/databricks-authority.sql
psql_external_stdin supabase_admin "$owner_target_password" < tests/db/dust-authority.sql

# Test credentials are synthetic, but their presence in psql or database logs
# would prove the production path can disclose real rotation material.
docker logs "$container_id" >"$database_log" 2>&1
if grep -Fq -- "$secret_prefix" "$owner_log" \
   || grep -Fq -- "$secret_prefix" "$database_log" \
   || grep -Fq -- "$secret_prefix" "$legacy_log" \
   || grep -Fq -- "$secret_prefix" "$recovery_complete_log" \
   || grep -Fq -- "$secret_prefix" "$recovery_empty_log"; then
  echo "database owner reconciliation exposed a password marker" >&2
  exit 1
fi

printf 'RESULT db-owner-sessions: postgres=restricted-direct supabase_admin=direct cross_owner=denied rotation=pass idempotence=pass empty_preflight=read-only legacy_preflight=read-only complete_preflight=read-only legacy_baseline=approved ledger=filename-sha secret_leak=none\n'
