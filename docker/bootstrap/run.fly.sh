#!/bin/sh
# One-shot production bootstrap with explicit authority boundaries:
#   recovery-preflight read-only proof for a restored pre-ledger or complete-ledger schema
#   legacy-preflight   compatibility alias for verified-pre-ledger recovery
#   legacy-baseline  explicit ledger adoption, without credential rotation
#   owner            direct supabase_admin credentials, ACL, Auth, and JWT policy
#   migrations       direct target-postgres ledger and application migrations
# `all` is intended for local verification. Production may activate the newly
# rotated runtime credentials between the two independently idempotent phases.
set -eu
umask 077

PHASE="${ARIA_BOOTSTRAP_PHASE:-all}"
case "$PHASE" in
  recovery-preflight|legacy-preflight|legacy-baseline|owner|migrations|all) ;;
  *) echo "[bootstrap] ERROR: invalid ARIA_BOOTSTRAP_PHASE" >&2; exit 1 ;;
esac

DB_HOST="${DB_HOST:-aria-mantu-db.internal}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}"
export PGCONNECT_TIMEOUT
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
RECONCILIATION_DIR="${RECONCILIATION_DIR:-/opt/aria}"
OWNER_RECONCILIATION_FILE="${OWNER_RECONCILIATION_FILE:-$RECONCILIATION_DIR/supabase-admin-reconciliation.sql}"
LEGACY_BASELINE_INVARIANTS_FILE="${LEGACY_BASELINE_INVARIANTS_FILE:-$RECONCILIATION_DIR/legacy-baseline-invariants.sql}"
LEGACY_BASELINE_EXPECTED_SCHEMA_SHA256_FILE="${LEGACY_BASELINE_EXPECTED_SCHEMA_SHA256_FILE:-$RECONCILIATION_DIR/legacy-baseline-public-schema.sha256}"
RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE="${RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE:-$RECONCILIATION_DIR/recovery-empty-public-schema.sha256}"
LEGACY_TABLE_INVENTORY_FILE="${LEGACY_TABLE_INVENTORY_FILE:-$RECONCILIATION_DIR/legacy-table-inventory.txt}"

case "$MIGRATIONS_DIR:$OWNER_RECONCILIATION_FILE:$LEGACY_BASELINE_INVARIANTS_FILE:$LEGACY_BASELINE_EXPECTED_SCHEMA_SHA256_FILE:$RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE:$LEGACY_TABLE_INVENTORY_FILE" in
  *[!A-Za-z0-9_./:-]*) echo "[bootstrap] ERROR: unsafe reconciliation path" >&2; exit 1 ;;
esac

OWNER_PLAN=""
MIGRATION_PLAN=""
AGENT_MEMORY_BOUNDARY_PLAN=""
LEGACY_PREFLIGHT_PLAN=""
LEGACY_BASELINE_PLAN=""
LEGACY_MIGRATION_MANIFEST=""
LEGACY_ROW_MANIFEST=""
RECOVERY_LEDGER_MANIFEST=""
LEGACY_SCHEMA_DUMP=""
LEGACY_SCHEMA_NORMALIZED=""
RECOVERY_SNAPSHOT_DIR=""
RECOVERY_SNAPSHOT_PID=""
RECOVERY_SNAPSHOT_ID=""
cleanup() {
  if [ -n "$RECOVERY_SNAPSHOT_PID" ]; then
    kill "$RECOVERY_SNAPSHOT_PID" >/dev/null 2>&1 || :
    wait "$RECOVERY_SNAPSHOT_PID" >/dev/null 2>&1 || :
  fi
  [ -z "$RECOVERY_SNAPSHOT_DIR" ] || rm -rf "$RECOVERY_SNAPSHOT_DIR"
  [ -z "$OWNER_PLAN" ] || rm -f "$OWNER_PLAN"
  [ -z "$MIGRATION_PLAN" ] || rm -f "$MIGRATION_PLAN"
  [ -z "$AGENT_MEMORY_BOUNDARY_PLAN" ] || rm -f "$AGENT_MEMORY_BOUNDARY_PLAN"
  [ -z "$LEGACY_PREFLIGHT_PLAN" ] || rm -f "$LEGACY_PREFLIGHT_PLAN"
  [ -z "$LEGACY_BASELINE_PLAN" ] || rm -f "$LEGACY_BASELINE_PLAN"
  [ -z "$LEGACY_MIGRATION_MANIFEST" ] || rm -f "$LEGACY_MIGRATION_MANIFEST"
  [ -z "$LEGACY_ROW_MANIFEST" ] || rm -f "$LEGACY_ROW_MANIFEST"
  [ -z "$RECOVERY_LEDGER_MANIFEST" ] || rm -f "$RECOVERY_LEDGER_MANIFEST"
  [ -z "$LEGACY_SCHEMA_DUMP" ] || rm -f "$LEGACY_SCHEMA_DUMP"
  [ -z "$LEGACY_SCHEMA_NORMALIZED" ] || rm -f "$LEGACY_SCHEMA_NORMALIZED"
  unset \
    OWNER_PASSWORD \
    SUPABASE_ADMIN_CURRENT_PASSWORD \
    SUPABASE_ADMIN_TARGET_PASSWORD \
    POSTGRES_TARGET_PASSWORD \
    SUPABASE_AUTH_ADMIN_TARGET_PASSWORD \
    AUTHENTICATOR_TARGET_PASSWORD \
    JWT_SECRET \
    JWT_EXP \
    ARIA_LEGACY_APPROVED_SCHEMA_SHA256 \
    ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256 \
    ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256 \
    ARIA_LEGACY_BASELINE_APPROVAL_SHA256 \
    ARIA_RECOVERY_MIGRATION_STATE 2>/dev/null || :
}
trap cleanup EXIT HUP INT TERM

export LC_ALL=C
if [ ! -r "$LEGACY_TABLE_INVENTORY_FILE" ]; then
  echo "[bootstrap] ERROR: legacy table inventory is unavailable" >&2
  exit 1
fi
if ! LEGACY_TABLES="$(awk '
  BEGIN { previous = ""; count = 0 }
  !/^[a-z][a-z0-9_]*$/ { exit 2 }
  previous != "" && $0 <= previous { exit 3 }
  { values = values (count ? " " : "") $0; previous = $0; count += 1 }
  END { if (count == 0) exit 4; print values }
' "$LEGACY_TABLE_INVENTORY_FILE")"; then
  echo "[bootstrap] ERROR: legacy table inventory is invalid" >&2
  exit 1
fi
LEGACY_PREFLIGHT_APPROVAL_SHA256=""
LEGACY_ACTUAL_SCHEMA_SHA256=""
LEGACY_ACTUAL_ROW_FINGERPRINT_SHA256=""
LEGACY_ACTUAL_MIGRATION_MANIFEST_SHA256=""
RECOVERY_MIGRATION_STATE=""

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "[legacy] ERROR: no SHA-256 utility is available" >&2
    exit 1
  fi
}

require_sha256() {
  value="$1"
  label="$2"
  if [ "${#value}" -ne 64 ] || ! printf '%s\n' "$value" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "[legacy] ERROR: $label must be exactly 64 lowercase hexadecimal characters" >&2
    exit 1
  fi
  unset value label
}

wait_for_current_owner() {
  : "${SUPABASE_ADMIN_CURRENT_PASSWORD:?SUPABASE_ADMIN_CURRENT_PASSWORD required}"
  i=0
  echo "[legacy] waiting for the current direct supabase_admin credential (up to 3 minutes)..."
  until PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 60 ] || {
      echo "[legacy] ERROR: current direct supabase_admin credential never became ready" >&2
      exit 1
    }
    sleep 3
  done
}

open_recovery_snapshot() {
  RECOVERY_SNAPSHOT_DIR="$(mktemp -d /tmp/aria-recovery-snapshot.XXXXXX)"
  snapshot_input="$RECOVERY_SNAPSHOT_DIR/input"
  snapshot_output="$RECOVERY_SNAPSHOT_DIR/output"
  mkfifo "$snapshot_input" "$snapshot_output"
  PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" -qAt \
      < "$snapshot_input" > "$snapshot_output" &
  RECOVERY_SNAPSHOT_PID=$!
  exec 9>"$snapshot_input"
  exec 8<"$snapshot_output"
  printf '%s\n' \
    '\set ON_ERROR_STOP on' \
    'begin transaction isolation level serializable read only;' \
    'select pg_export_snapshot();' >&9
  if ! IFS= read -r RECOVERY_SNAPSHOT_ID <&8; then
    echo "[recovery] ERROR: failed to export a database snapshot" >&2
    exit 1
  fi
  case "$RECOVERY_SNAPSHOT_ID" in
    *[!0-9A-Fa-f-]*|""|-*|*-) echo "[recovery] ERROR: database returned an invalid exported snapshot" >&2; exit 1 ;;
  esac
  unset snapshot_input snapshot_output
}

close_recovery_snapshot() {
  printf '%s\n' 'rollback;' '\q' >&9 || :
  exec 9>&-
  exec 8<&-
  wait "$RECOVERY_SNAPSHOT_PID"
  RECOVERY_SNAPSHOT_PID=""
  RECOVERY_SNAPSHOT_ID=""
  rm -rf "$RECOVERY_SNAPSHOT_DIR"
  RECOVERY_SNAPSHOT_DIR=""
}

build_legacy_migration_manifest() {
  LEGACY_MIGRATION_MANIFEST="$(mktemp /tmp/aria-legacy-migrations.XXXXXX)"
  found=0
  for file in "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
    [ -f "$file" ] || continue
    found=1
    filename="$(basename "$file")"
    sha256="$(sha256_file "$file")"
    case "$filename:$sha256" in
      *[!A-Za-z0-9_.:-]*) echo "[legacy] ERROR: invalid migration identity" >&2; exit 1 ;;
    esac
    printf '%s=%s\n' "$filename" "$sha256" >> "$LEGACY_MIGRATION_MANIFEST"
  done
  [ "$found" -eq 1 ] || { echo "[legacy] ERROR: no numbered migrations found" >&2; exit 1; }
  LEGACY_ACTUAL_MIGRATION_MANIFEST_SHA256="$(sha256_file "$LEGACY_MIGRATION_MANIFEST")"
  unset found filename sha256
}

build_legacy_preflight_plan() {
  LEGACY_PREFLIGHT_PLAN="$(mktemp /tmp/aria-legacy-preflight.sql.XXXXXX)"
  cat > "$LEGACY_PREFLIGHT_PLAN" <<SQL
-- ARIA_LEGACY_PREFLIGHT
\set ON_ERROR_STOP on
begin transaction isolation level repeatable read read only;
set transaction snapshot '$RECOVERY_SNAPSHOT_ID';
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local intervalstyle = 'iso_8601';
set local extra_float_digits = 3;
set local bytea_output = 'hex';
do \$aria_legacy_owner_identity\$
declare
  owner_is_superuser boolean;
begin
  select rolsuper into owner_is_superuser from pg_roles where rolname = current_user;
  if session_user <> 'supabase_admin'
     or current_user <> 'supabase_admin'
     or owner_is_superuser is not true then
    raise exception 'direct supabase_admin superuser session required'
      using errcode = '42501';
  end if;
end
\$aria_legacy_owner_identity\$;
SQL
  case "$RECOVERY_MIGRATION_STATE" in
    verified-empty)
      cat >> "$LEGACY_PREFLIGHT_PLAN" <<'SQL'
do $aria_verified_empty$
begin
  if current_setting('server_version_num')::integer / 10000 <> 17 then
    raise exception 'verified-empty recovery requires PostgreSQL major version 17'
      using errcode = '55000';
  end if;
  if to_regclass('public.aria_schema_migrations') is not null then
    raise exception 'verified-empty recovery requires no ARIA migration ledger'
      using errcode = '55000';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public') then
    raise exception 'verified-empty recovery requires no public tables'
      using errcode = '55000';
  end if;
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ) then
    raise exception 'verified-empty recovery requires no public functions'
      using errcode = '55000';
  end if;
end
$aria_verified_empty$;
SQL
      ;;
    verified-pre-ledger)
      cat >> "$LEGACY_PREFLIGHT_PLAN" <<'SQL'
do $aria_verified_pre_ledger$
declare
  ledger_has_rows boolean := false;
begin
  if to_regclass('public.aria_schema_migrations') is not null then
    execute 'select exists (select 1 from public.aria_schema_migrations)'
      into ledger_has_rows;
  end if;
  if ledger_has_rows then
    raise exception 'verified-pre-ledger recovery cannot contain ARIA ledger rows'
      using errcode = '55000';
  end if;
end
$aria_verified_pre_ledger$;
SQL
      ;;
    complete-ledger)
      cat >> "$LEGACY_PREFLIGHT_PLAN" <<'SQL'
do $aria_complete_ledger$
begin
  if to_regclass('public.aria_schema_migrations') is null then
    raise exception 'complete-ledger recovery requires the ARIA migration ledger'
      using errcode = '55000';
  end if;
end
$aria_complete_ledger$;
SQL
      ;;
  esac
  if [ "$RECOVERY_MIGRATION_STATE" != verified-empty ]; then
    printf '\\ir %s\n' "$LEGACY_BASELINE_INVARIANTS_FILE" >> "$LEGACY_PREFLIGHT_PLAN"
    for table_name in $LEGACY_TABLES; do
      cat >> "$LEGACY_PREFLIGHT_PLAN" <<SQL
select 'public.$table_name=' || count(*)::text || ':' ||
       encode(digest(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'sha256'), 'hex')
  from (
    select encode(digest(row_to_json(source_row)::text, 'sha256'), 'hex') as row_hash
      from public.$table_name as source_row
  ) as hashed_rows;
SQL
    done
  fi
  if [ "$RECOVERY_MIGRATION_STATE" = complete-ledger ]; then
    cat >> "$LEGACY_PREFLIGHT_PLAN" <<SQL
-- ARIA_COMPLETE_LEDGER_EXPECTED=$LEGACY_ACTUAL_MIGRATION_MANIFEST_SHA256
do \$aria_complete_ledger_identity\$
declare
  actual_manifest_sha256 text;
begin
  select encode(
           digest(
             coalesce(string_agg(filename || '=' || sha256 || E'\\n', '' order by filename), ''),
             'sha256'
           ),
           'hex'
         )
    into actual_manifest_sha256
    from public.aria_schema_migrations;
  if actual_manifest_sha256 <> '$LEGACY_ACTUAL_MIGRATION_MANIFEST_SHA256' then
    raise exception 'complete ARIA ledger differs from the reviewed migration manifest'
      using errcode = '55000';
  end if;
end
\$aria_complete_ledger_identity\$;
SQL
  fi
  cat >> "$LEGACY_PREFLIGHT_PLAN" <<'SQL'
commit;
SQL
}

read_legacy_schema_fingerprint() {
  if [ "$RECOVERY_MIGRATION_STATE" = verified-empty ]; then
    expected_schema_file="$RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE"
  else
    expected_schema_file="$LEGACY_BASELINE_EXPECTED_SCHEMA_SHA256_FILE"
  fi
  expected_schema_sha="$(tr -d '[:space:]' < "$expected_schema_file")"
  require_sha256 "$expected_schema_sha" "reviewed public-schema SHA-256"
  LEGACY_SCHEMA_DUMP="$(mktemp /tmp/aria-legacy-schema.sql.XXXXXX)"
  LEGACY_SCHEMA_NORMALIZED="$(mktemp /tmp/aria-legacy-schema-normalized.sql.XXXXXX)"
  PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
    pg_dump -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
      --snapshot="$RECOVERY_SNAPSHOT_ID" \
      --schema-only --no-owner --no-privileges --schema=public \
      --exclude-table=public.aria_schema_migrations > "$LEGACY_SCHEMA_DUMP"
  sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
      -e '/^-- Dumped from /d' -e '/^-- Dumped by /d' \
      "$LEGACY_SCHEMA_DUMP" > "$LEGACY_SCHEMA_NORMALIZED"
  LEGACY_ACTUAL_SCHEMA_SHA256="$(sha256_file "$LEGACY_SCHEMA_NORMALIZED")"
  [ "$LEGACY_ACTUAL_SCHEMA_SHA256" = "$expected_schema_sha" ] || {
    echo "[recovery] ERROR: live public schema does not match the reviewed state fingerprint" >&2
    exit 1
  }
  unset expected_schema_file expected_schema_sha
}

read_legacy_row_fingerprint() {
  [ -n "$LEGACY_ROW_MANIFEST" ] && [ -f "$LEGACY_ROW_MANIFEST" ] || {
    echo "[legacy] ERROR: recovery data fingerprint manifest is missing" >&2
    exit 1
  }
  if [ "$RECOVERY_MIGRATION_STATE" != verified-empty ] &&
     ! awk -F '[=:]' '
       NF != 3 || $1 !~ /^public\.[a-z0-9_]+$/ || $2 !~ /^[0-9]+$/ || $3 !~ /^[0-9a-f]{64}$/ { exit 1 }
       END { if (NR == 0) exit 1 }
     ' "$LEGACY_ROW_MANIFEST"; then
    echo "[legacy] ERROR: recovery data fingerprint manifest is invalid" >&2
    exit 1
  fi
  LEGACY_ACTUAL_ROW_FINGERPRINT_SHA256="$(sha256_file "$LEGACY_ROW_MANIFEST")"
}

require_approved_legacy_fingerprints() {
  if [ -z "${ARIA_LEGACY_APPROVED_SCHEMA_SHA256:-}" ] \
     || [ -z "${ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256:-}" ] \
     || [ -z "${ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256:-}" ]; then
    echo "[recovery] ERROR: all approved recovery fingerprints are required" >&2
    exit 64
  fi
  require_sha256 "$ARIA_LEGACY_APPROVED_SCHEMA_SHA256" "approved schema fingerprint"
  require_sha256 "$ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256" "approved row fingerprint"
  require_sha256 "$ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256" "approved migration manifest"
}

perform_legacy_preflight() {
  RECOVERY_MIGRATION_STATE="$1"
  case "$RECOVERY_MIGRATION_STATE" in
    verified-empty|verified-pre-ledger|complete-ledger) ;;
    *) echo "[recovery] ERROR: unsupported ARIA_RECOVERY_MIGRATION_STATE" >&2; exit 1 ;;
  esac
  if [ "$RECOVERY_MIGRATION_STATE" = verified-empty ]; then
    [ -f "$RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE" ] || { echo "[recovery] ERROR: empty schema fingerprint is missing" >&2; exit 1; }
  else
    [ -f "$LEGACY_BASELINE_INVARIANTS_FILE" ] || { echo "[legacy] ERROR: invariant SQL is missing" >&2; exit 1; }
    [ -f "$LEGACY_BASELINE_EXPECTED_SCHEMA_SHA256_FILE" ] || { echo "[legacy] ERROR: reviewed schema fingerprint is missing" >&2; exit 1; }
  fi
  require_approved_legacy_fingerprints
  build_legacy_migration_manifest
  [ "$LEGACY_ACTUAL_MIGRATION_MANIFEST_SHA256" = "$ARIA_LEGACY_APPROVED_MIGRATION_MANIFEST_SHA256" ] || {
    echo "[legacy] ERROR: migration manifest differs from the approved recovery receipt" >&2
    exit 1
  }
  wait_for_current_owner
  LEGACY_ROW_MANIFEST="$(mktemp /tmp/aria-legacy-rows.XXXXXX)"
  open_recovery_snapshot
  build_legacy_preflight_plan
  read_legacy_schema_fingerprint
  PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -qAt -f "$LEGACY_PREFLIGHT_PLAN" > "$LEGACY_ROW_MANIFEST"
  close_recovery_snapshot
  read_legacy_row_fingerprint
  [ "$LEGACY_ACTUAL_SCHEMA_SHA256" = "$ARIA_LEGACY_APPROVED_SCHEMA_SHA256" ] || {
    echo "[legacy] ERROR: live schema fingerprint differs from the approved recovery receipt" >&2
    exit 1
  }
  [ "$LEGACY_ACTUAL_ROW_FINGERPRINT_SHA256" = "$ARIA_LEGACY_APPROVED_ROW_FINGERPRINT_SHA256" ] || {
    echo "[legacy] ERROR: live row fingerprint differs from the approved recovery receipt" >&2
    exit 1
  }
  if [ "$RECOVERY_MIGRATION_STATE" = verified-empty ]; then
    invariant_sha256="$(sha256_file "$RECOVERY_EMPTY_EXPECTED_SCHEMA_SHA256_FILE")"
  else
    invariant_sha256="$(sha256_file "$LEGACY_BASELINE_INVARIANTS_FILE")"
  fi
  approval_material="$(mktemp /tmp/aria-legacy-approval.XXXXXX)"
  printf 'migration_state=%s\nschema=%s\nrow=%s\nmigration_manifest=%s\ninvariants=%s\n' \
    "$RECOVERY_MIGRATION_STATE" \
    "$LEGACY_ACTUAL_SCHEMA_SHA256" \
    "$LEGACY_ACTUAL_ROW_FINGERPRINT_SHA256" \
    "$LEGACY_ACTUAL_MIGRATION_MANIFEST_SHA256" \
    "$invariant_sha256" > "$approval_material"
  LEGACY_PREFLIGHT_APPROVAL_SHA256="$(sha256_file "$approval_material")"
  rm -f "$approval_material"
  unset approval_material invariant_sha256
}

build_legacy_baseline_plan() {
  LEGACY_BASELINE_PLAN="$(mktemp /tmp/aria-legacy-baseline.sql.XXXXXX)"
  cat > "$LEGACY_BASELINE_PLAN" <<SQL
-- ARIA_LEGACY_BASELINE_WRITE
\set ON_ERROR_STOP on
-- READ COMMITTED is deliberate: the advisory-lock and relation-lock waits must
-- finish before each guard takes its statement snapshot. A fixed snapshot taken
-- before those waits could approve data superseded by a concurrent writer.
begin transaction isolation level read committed;
select pg_advisory_xact_lock(hashtextextended('aria-schema-migrations', 0));
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local intervalstyle = 'iso_8601';
set local extra_float_digits = 3;
set local bytea_output = 'hex';
SQL
  first_table=1
  for table_name in $LEGACY_TABLES; do
    if [ "$first_table" -eq 1 ]; then
      printf 'lock table public.%s' "$table_name" >> "$LEGACY_BASELINE_PLAN"
      first_table=0
    else
      printf ', public.%s' "$table_name" >> "$LEGACY_BASELINE_PLAN"
    fi
  done
  printf ' in share mode;\n' >> "$LEGACY_BASELINE_PLAN"
  cat >> "$LEGACY_BASELINE_PLAN" <<SQL
\ir $LEGACY_BASELINE_INVARIANTS_FILE
do \$aria_legacy_write_guard\$
declare
  ledger_has_rows boolean := false;
begin
  if to_regclass('public.aria_schema_migrations') is not null then
    execute 'select exists (select 1 from public.aria_schema_migrations)'
      into ledger_has_rows;
  end if;
  if ledger_has_rows then
    raise exception 'legacy baseline refuses a populated ARIA migration ledger'
      using errcode = '55000';
  end if;
end
\$aria_legacy_write_guard\$;
SQL
  while IFS='=' read -r table_ref expected_state; do
    table_name="${table_ref#public.}"
    row_count="${expected_state%%:*}"
    row_sha256="${expected_state#*:}"
    case "$table_name:$row_count:$row_sha256" in
      *[!A-Za-z0-9_:]*) echo "[legacy] ERROR: invalid data baseline" >&2; exit 1 ;;
    esac
    require_sha256 "$row_sha256" "approved $table_name data fingerprint"
    cat >> "$LEGACY_BASELINE_PLAN" <<SQL
do \$aria_legacy_data_guard\$
declare
  actual_count bigint;
  actual_sha256 text;
begin
  select count(*),
         encode(digest(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'sha256'), 'hex')
    into actual_count, actual_sha256
    from (
      select encode(digest(row_to_json(source_row)::text, 'sha256'), 'hex') as row_hash
        from public.$table_name as source_row
    ) as hashed_rows;
  if actual_count <> $row_count or actual_sha256 <> '$row_sha256' then
    raise exception 'legacy data fingerprint changed after preflight'
      using errcode = '55000';
  end if;
end
\$aria_legacy_data_guard\$;
SQL
  done < "$LEGACY_ROW_MANIFEST"
  cat >> "$LEGACY_BASELINE_PLAN" <<'SQL'
create table if not exists public.aria_schema_migrations (
  filename text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
lock table public.aria_schema_migrations in share mode;
do $aria_legacy_locked_ledger_guard$
begin
  if exists (select 1 from public.aria_schema_migrations) then
    raise exception 'legacy baseline refuses a populated ARIA migration ledger'
      using errcode = '55000';
  end if;
end
$aria_legacy_locked_ledger_guard$;
alter table public.aria_schema_migrations enable row level security;
revoke all on public.aria_schema_migrations from public, anon, authenticated, authenticator;
grant select on public.aria_schema_migrations to service_role;
grant select, insert on public.aria_schema_migrations to postgres;
drop policy if exists aria_schema_migrations_migrator_select on public.aria_schema_migrations;
drop policy if exists aria_schema_migrations_migrator_insert on public.aria_schema_migrations;
create policy aria_schema_migrations_migrator_select
  on public.aria_schema_migrations for select to postgres using (true);
create policy aria_schema_migrations_migrator_insert
  on public.aria_schema_migrations for insert to postgres with check (true);
SQL
  while IFS='=' read -r filename sha256; do
    case "$filename:$sha256" in
      *[!A-Za-z0-9_.:-]*) echo "[legacy] ERROR: invalid migration identity" >&2; exit 1 ;;
    esac
    printf "insert into public.aria_schema_migrations (filename, sha256) values ('%s', '%s');\n" \
      "$filename" "$sha256" >> "$LEGACY_BASELINE_PLAN"
  done < "$LEGACY_MIGRATION_MANIFEST"
  printf 'commit;\n' >> "$LEGACY_BASELINE_PLAN"
  unset first_table table_ref table_name expected_state row_count row_sha256 filename sha256
}

run_legacy_preflight_phase() {
  perform_legacy_preflight verified-pre-ledger
  echo "[legacy] read-only schema, row, and migration fingerprints match the approved recovery receipt"
  printf 'ARIA_LEGACY_BASELINE_APPROVAL_SHA256=%s\n' "$LEGACY_PREFLIGHT_APPROVAL_SHA256"
}

run_recovery_preflight_phase() {
  if [ -z "${ARIA_RECOVERY_MIGRATION_STATE:-}" ]; then
    echo "[recovery] ERROR: ARIA_RECOVERY_MIGRATION_STATE is required" >&2
    exit 64
  fi
  perform_legacy_preflight "$ARIA_RECOVERY_MIGRATION_STATE"
  echo "[recovery] read-only schema, row, migration manifest, and ledger state match the approved receipt"
  printf 'ARIA_RECOVERY_PREFLIGHT_SHA256=%s\n' "$LEGACY_PREFLIGHT_APPROVAL_SHA256"
  if [ "$RECOVERY_MIGRATION_STATE" = verified-pre-ledger ]; then
    printf 'ARIA_LEGACY_BASELINE_APPROVAL_SHA256=%s\n' "$LEGACY_PREFLIGHT_APPROVAL_SHA256"
  fi
}

run_legacy_baseline_phase() {
  if [ -z "${ARIA_LEGACY_BASELINE_APPROVAL_SHA256:-}" ]; then
    echo "[legacy] ERROR: ARIA_LEGACY_BASELINE_APPROVAL_SHA256 is required" >&2
    exit 64
  fi
  require_sha256 "$ARIA_LEGACY_BASELINE_APPROVAL_SHA256" "legacy baseline approval"
  perform_legacy_preflight verified-pre-ledger
  [ "$ARIA_LEGACY_BASELINE_APPROVAL_SHA256" = "$LEGACY_PREFLIGHT_APPROVAL_SHA256" ] || {
    echo "[legacy] ERROR: explicit baseline approval does not match this preflight" >&2
    exit 1
  }
  build_legacy_baseline_plan
  PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -q -f "$LEGACY_BASELINE_PLAN"
  echo "[legacy] owner-approved migration ledger baseline complete"
}

require_distinct_active_passwords() {
  owner="$SUPABASE_ADMIN_TARGET_PASSWORD"
  postgres="$POSTGRES_TARGET_PASSWORD"
  auth="$SUPABASE_AUTH_ADMIN_TARGET_PASSWORD"
  rest="$AUTHENTICATOR_TARGET_PASSWORD"

  if [ "$owner" = "$postgres" ] \
     || [ "$owner" = "$auth" ] \
     || [ "$owner" = "$rest" ] \
     || [ "$postgres" = "$auth" ] \
     || [ "$postgres" = "$rest" ] \
     || [ "$auth" = "$rest" ]; then
    echo "[owner] ERROR: active database roles require distinct target passwords" >&2
    exit 1
  fi
  unset owner postgres auth rest
}

wait_for_owner() {
  OWNER_PASSWORD=""
  i=0

  echo "[owner] waiting for a direct supabase_admin connection (up to 3 minutes)..."
  while [ -z "$OWNER_PASSWORD" ]; do
    if PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
      psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; then
      OWNER_PASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD"
    elif [ "$SUPABASE_ADMIN_TARGET_PASSWORD" != "$SUPABASE_ADMIN_CURRENT_PASSWORD" ] \
      && PGPASSWORD="$SUPABASE_ADMIN_TARGET_PASSWORD" \
        psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; then
      OWNER_PASSWORD="$SUPABASE_ADMIN_TARGET_PASSWORD"
    fi

    [ -z "$OWNER_PASSWORD" ] || continue
    i=$((i + 1))
    [ "$i" -le 60 ] || {
      echo "[owner] ERROR: no direct supabase_admin connection became ready" >&2
      exit 1
    }
    sleep 3
  done

}

wait_for_target_postgres() {
  : "${POSTGRES_TARGET_PASSWORD:?POSTGRES_TARGET_PASSWORD required}"
  POSTGRES_READY=""
  i=0

  echo "[migrate] waiting for the rotated postgres credential (up to 3 minutes)..."
  while [ -z "$POSTGRES_READY" ]; do
    if PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
      psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; then
      POSTGRES_READY=1
    fi

    [ -z "$POSTGRES_READY" ] || continue
    i=$((i + 1))
    [ "$i" -le 60 ] || {
      echo "[migrate] ERROR: rotated postgres credential never became ready" >&2
      exit 1
    }
    sleep 3
  done
}

preflight_candidate_list_set_preview_0067() {
  echo "[migrate] checking the 0067 candidate-list index-build boundary..."
  PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -q <<'SQL'
\set ON_ERROR_STOP on
begin transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';
do $aria_candidate_list_set_preview_0067_preflight$
declare
  migration_0064_is_ledgered boolean := false;
  migration_0067_is_ledgered boolean := false;
  noncanonical_ledger_filename_exists boolean := false;
  ledgered_0067_or_later boolean := false;
  candidate_list_members_exist boolean := false;
begin
  if to_regclass('public.aria_schema_migrations') is not null then
    execute $query$
      select
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename =
             '0064_candidate_lists_authority.sql'
        ),
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename =
             '0067_candidate_list_set_preview_authority.sql'
        ),
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename is null
              or migration.filename !~
                 '^[0-9]{4}_[a-z0-9]+(_[a-z0-9]+)*[.]sql$'
        ),
        exists (
          select 1
            from public.aria_schema_migrations migration
           where migration.filename ~
                 '^[0-9]{4}_[a-z0-9]+(_[a-z0-9]+)*[.]sql$'
             and substring(migration.filename from 1 for 4)::integer >= 67
        )
    $query$
      into migration_0064_is_ledgered,
           migration_0067_is_ledgered,
           noncanonical_ledger_filename_exists,
           ledgered_0067_or_later;
  end if;

  if noncanonical_ledger_filename_exists then
    raise exception
      '0067 preflight refuses a noncanonical migration-ledger filename'
      using errcode = '55000';
  end if;

  if ledgered_0067_or_later and not migration_0067_is_ledgered then
    raise exception
      '0067 preflight found a 0067-or-later ledger entry without the exact 0067 migration'
      using errcode = '55000';
  end if;

  -- A current-release install creates 0064 through 0067 inside the serialized
  -- migration transaction. An already-applied 0067 has no index work left.
  if not migration_0064_is_ledgered or migration_0067_is_ledgered then
    return;
  end if;

  if to_regclass('public.candidate_list_members') is null then
    return;
  end if;

  select exists (
    select 1
      from public.candidate_list_members
     limit 1
  ) into candidate_list_members_exist;

  if not candidate_list_members_exist then
    return;
  end if;

  raise exception
    '0067 would build a transactional candidate-list preview index over live rows; release requires a separately reviewed CREATE INDEX CONCURRENTLY phase or an explicitly ratified measured maintenance window'
    using errcode = '55000';
end
$aria_candidate_list_set_preview_0067_preflight$;
rollback;
SQL
}

run_owner_phase() {
  : "${SUPABASE_ADMIN_CURRENT_PASSWORD:?SUPABASE_ADMIN_CURRENT_PASSWORD required}"
  : "${SUPABASE_ADMIN_TARGET_PASSWORD:?SUPABASE_ADMIN_TARGET_PASSWORD required}"
  : "${POSTGRES_TARGET_PASSWORD:?POSTGRES_TARGET_PASSWORD required}"
  : "${SUPABASE_AUTH_ADMIN_TARGET_PASSWORD:?SUPABASE_AUTH_ADMIN_TARGET_PASSWORD required}"
  : "${AUTHENTICATOR_TARGET_PASSWORD:?AUTHENTICATOR_TARGET_PASSWORD required}"
  : "${JWT_SECRET:?JWT_SECRET required}"
  : "${JWT_EXP:?JWT_EXP required}"
  [ -f "$OWNER_RECONCILIATION_FILE" ] || {
    echo "[owner] ERROR: owner reconciliation SQL is missing" >&2
    exit 1
  }
  require_distinct_active_passwords
  wait_for_owner

  OWNER_PLAN="$(mktemp /tmp/aria-owner-reconciliation.sql.XXXXXX)"
  {
    echo '\set ON_ERROR_STOP on'
    printf '\\ir %s\n' "$OWNER_RECONCILIATION_FILE"
  } > "$OWNER_PLAN"

  echo "[owner] applying owner-local ACL, credential, and Auth ownership reconciliation..."
  PGPASSWORD="$OWNER_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -q -f "$OWNER_PLAN"
  unset OWNER_PASSWORD

  # The owner transaction retires the previous postgres credential. Prove the
  # target credential and direct-role identity before reporting owner success.
  wait_for_target_postgres
  echo "[owner] complete"
}

build_migration_plan() {
  MIGRATION_PLAN="$(mktemp /tmp/aria-migrations.sql.XXXXXX)"
  {
    cat <<SQL
\set ON_ERROR_STOP on
begin;
select pg_advisory_xact_lock(hashtextextended('aria-schema-migrations', 0));

do \$aria_migrator_identity\$
declare
  migrator_is_superuser boolean;
  migrator_can_create_database boolean;
  migrator_can_create_role boolean;
  migrator_can_replicate boolean;
  migrator_bypasses_rls boolean;
begin
  select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
    into migrator_is_superuser,
         migrator_can_create_database,
         migrator_can_create_role,
         migrator_can_replicate,
         migrator_bypasses_rls
    from pg_roles
   where rolname = current_user;

  if session_user <> 'postgres'
     or current_user <> 'postgres'
     or migrator_is_superuser is not false
     or migrator_can_create_database is not false
     or migrator_can_create_role is not false
     or migrator_can_replicate is not false
     or migrator_bypasses_rls is not false
     or exists (
       select 1
         from pg_auth_members membership
         join pg_roles member_role on member_role.oid = membership.member
        where member_role.rolname = 'postgres'
     ) then
    raise exception 'direct postgres migration session required'
      using errcode = '42501';
  end if;
end
\$aria_migrator_identity\$;

do \$aria_baseline_guard\$
declare
  app_schema_exists boolean := to_regclass('public.workspace_state') is not null;
  ledger_exists boolean := to_regclass('public.aria_schema_migrations') is not null;
  ledger_has_rows boolean := false;
begin
  if app_schema_exists then
    if not ledger_exists then
      raise exception 'existing ARIA schema has no migration ledger; audited baseline required';
    end if;

    execute 'select exists (select 1 from public.aria_schema_migrations)'
      into ledger_has_rows;
    if not ledger_has_rows then
      raise exception 'existing ARIA schema has an empty migration ledger; audited baseline required';
    end if;
  end if;
end
\$aria_baseline_guard\$;

select to_regclass('public.aria_schema_migrations') is null as create_aria_ledger \gset
\if :create_aria_ledger
create table public.aria_schema_migrations (
  filename text primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz not null default now()
);
alter table public.aria_schema_migrations enable row level security;
revoke all on public.aria_schema_migrations from public, anon, authenticated;
grant select on public.aria_schema_migrations to service_role;
create policy aria_schema_migrations_migrator_select
  on public.aria_schema_migrations for select to postgres using (true);
create policy aria_schema_migrations_migrator_insert
  on public.aria_schema_migrations for insert to postgres with check (true);
\endif

do \$aria_ledger_contract\$
begin
  if not exists (
    select 1
      from pg_tables
     where schemaname = 'public'
       and tablename = 'aria_schema_migrations'
       and rowsecurity
  ) then
    raise exception 'ARIA migration ledger must have RLS enabled'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from pg_class ledger
      cross join lateral aclexplode(coalesce(ledger.relacl, acldefault('r', ledger.relowner))) acl
      left join pg_roles grantee on grantee.oid = acl.grantee
     where ledger.oid = 'public.aria_schema_migrations'::regclass
       and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated', 'authenticator'))
  ) then
    raise exception 'ARIA migration ledger exposes runtime write or read authority'
      using errcode = '42501';
  end if;
end
\$aria_ledger_contract\$;

SQL

    for file in "$MIGRATIONS_DIR"/0*.sql; do
      [ -f "$file" ] || {
        echo "[migrate] ERROR: no numbered migrations found" >&2
        exit 1
      }
      filename="$(basename "$file")"
      sha256="$(sha256sum "$file" | awk '{print $1}')"
      case "$filename:$sha256" in
        *[!A-Za-z0-9_.:-]*) echo "[migrate] ERROR: invalid migration identity" >&2; exit 1 ;;
      esac
      cat <<SQL
do \$aria\$
begin
  if exists (
    select 1 from public.aria_schema_migrations
    where filename = '$filename' and sha256 <> '$sha256'
  ) then
    raise exception 'migration hash changed: $filename';
  end if;
end
\$aria\$;
select not exists (
  select 1 from public.aria_schema_migrations where filename = '$filename'
) as apply_migration \gset
\if :apply_migration
\echo applying $filename
\ir $file
insert into public.aria_schema_migrations (filename, sha256)
values ('$filename', '$sha256')
on conflict (filename) do nothing;
\else
\echo already applied $filename
\endif
SQL
    done

    cat <<'SQL'
notify pgrst, 'reload schema';
commit;
SQL
  } > "$MIGRATION_PLAN"
}

build_agent_memory_boundary_plan() {
  AGENT_MEMORY_BOUNDARY_PLAN="$(mktemp /tmp/aria-agent-memory-boundary.sql.XXXXXX)"
  cat > "$AGENT_MEMORY_BOUNDARY_PLAN" <<'SQL'
\set ON_ERROR_STOP on
begin transaction read only;
do $aria_agent_memory_provenance_boundary$
declare
  table_name text;
  function_signature text;
  function_oid regprocedure;
  function_owner text;
begin
  foreach table_name in array array[
    'public.agent_runs',
    'public.agent_events'
  ]
  loop
    if to_regclass(table_name) is null then
      raise exception 'agent memory provenance table is missing: %', table_name
        using errcode = '42P01';
    end if;
    if has_table_privilege('service_role', table_name, 'SELECT') is not true then
      raise exception 'service_role lacks required SELECT on %', table_name
        using errcode = '42501';
    end if;
    if has_table_privilege('service_role', table_name, 'INSERT') is true
       or has_table_privilege('service_role', table_name, 'UPDATE') is true
       or has_table_privilege('service_role', table_name, 'DELETE') is true then
      raise exception 'service_role has forbidden mutation privilege on %', table_name
        using errcode = '42501';
    end if;
  end loop;

  foreach function_signature in array array[
    'public.create_agent_memory_with_candidate_provenance(uuid,uuid,uuid,uuid,text,text,text,integer,boolean,timestamptz,text,jsonb)',
    'public.mutate_agent_memory_with_candidate_provenance(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,integer,boolean,boolean,timestamptz,boolean,text,jsonb)'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'agent memory provenance function is missing: %', function_signature
        using errcode = '42883';
    end if;
    select role.rolname
      into function_owner
      from pg_proc function_row
      join pg_roles role on role.oid = function_row.proowner
     where function_row.oid = function_oid;
    if function_owner is distinct from 'postgres' then
      raise exception 'agent memory provenance function has unexpected owner: %', function_signature
        using errcode = '42501';
    end if;
    if has_function_privilege('service_role', function_oid, 'EXECUTE') is not true then
      raise exception 'service_role lacks required EXECUTE on %', function_signature
        using errcode = '42501';
    end if;
  end loop;
end
$aria_agent_memory_provenance_boundary$;
rollback;
SQL
}

run_migrations_phase() {
  : "${POSTGRES_TARGET_PASSWORD:?POSTGRES_TARGET_PASSWORD required}"

  [ "${POSTGRES_READY:-}" = 1 ] || wait_for_target_postgres
  preflight_candidate_list_set_preview_0067
  build_migration_plan
  echo "[migrate] applying serialized numbered migrations..."
  PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -q -f "$MIGRATION_PLAN"
  build_agent_memory_boundary_plan
  echo "[migrate] verifying the agent-memory provenance authority boundary..."
  PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -q -f "$AGENT_MEMORY_BOUNDARY_PLAN"
  echo "[migrate] complete"
}

case "$PHASE" in
  recovery-preflight)
    run_recovery_preflight_phase
    ;;
  legacy-preflight)
    run_legacy_preflight_phase
    ;;
  legacy-baseline)
    run_legacy_baseline_phase
    ;;
  owner)
    run_owner_phase
    ;;
  migrations)
    run_migrations_phase
    ;;
  all)
    run_owner_phase
    run_migrations_phase
    ;;
esac
