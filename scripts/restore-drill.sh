#!/usr/bin/env bash
# LOCAL LOGICAL RESTORE DRILL. Proves only that one published local archive is
# exactly restorable into this checkout's compatible isolated Compose database.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/local-db-container.sh
source scripts/lib/local-db-container.sh
# shellcheck source=scripts/lib/db-manifest.sh
source scripts/lib/db-manifest.sh
# shellcheck source=scripts/lib/safe-exit-traps.sh
source scripts/lib/safe-exit-traps.sh

CID="$(resolve_local_db_container "${RESTORE_DRILL_DB_CONTAINER:-}")"
BACKUP_DIR="${BACKUP_DIR:-backups}"
[ ! -L "$BACKUP_DIR" ] || { echo "BACKUP_DIR must not be a symlink." >&2; exit 1; }
BACKUP_ID="$(tr -d '[:space:]' < "$BACKUP_DIR/.latest" 2>/dev/null)" || {
  echo "No backup pointer found. Run scripts/backup.sh first." >&2
  exit 1
}
[[ "$BACKUP_ID" =~ ^[0-9]{8}_[0-9]{6}_[0-9]+_[0-9]+$ ]] || { echo "Invalid backup pointer." >&2; exit 1; }

ARCHIVE="$BACKUP_DIR/hermes_${BACKUP_ID}.dump"
MANIFEST="$BACKUP_DIR/hermes_${BACKUP_ID}.manifest"
[ -f "$ARCHIVE" ] && [ -f "$MANIFEST" ] || { echo "Backup archive or manifest is missing." >&2; exit 1; }

EXPECTED_SHA="$(awk -F= '$1 == "archive_sha256" { print $2 }' "$MANIFEST")"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "Backup manifest has no valid archive digest." >&2; exit 1; }
ACTUAL_SHA="$(sha256_file "$ARCHIVE")"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || { echo "Backup archive digest mismatch." >&2; exit 1; }
docker exec -i "$CID" pg_restore --list < "$ARCHIVE" >/dev/null

SCRATCH="aria_restore_drill_$$_${RANDOM}"
ACTUAL_MANIFEST=""
SCRATCH_CLEANUP_ARMED=0

dex() {
  docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U postgres "$@"
}

dex_owner() {
  docker exec -i "$CID" psql -X -v ON_ERROR_STOP=1 -U supabase_admin "$@"
}

cleanup_scratch() {
  [ "$SCRATCH_CLEANUP_ARMED" -eq 1 ] || return 0
  local exists
  exists="$(dex_owner -d postgres -tA -c "select exists (select 1 from pg_database where datname = '${SCRATCH}');" | tr -d '[:space:]')" || return 1
  if [ "$exists" != "t" ]; then
    SCRATCH_CLEANUP_ARMED=0
    return 0
  fi
  dex_owner -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${SCRATCH}' and pid <> pg_backend_pid();" >/dev/null 2>&1 || return 1
  dex_owner -d postgres -c "drop database \"${SCRATCH}\";" >/dev/null 2>&1 || return 1
  SCRATCH_CLEANUP_ARMED=0
}

cleanup_on_exit() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [ "$SCRATCH_CLEANUP_ARMED" -eq 1 ] && ! cleanup_scratch; then exit_status=1; fi
  if [ -n "$ACTUAL_MANIFEST" ]; then rm -f "$ACTUAL_MANIFEST"; fi
  exit "$exit_status"
}
install_safe_exit_traps cleanup_on_exit
ACTUAL_MANIFEST="$(mktemp "${TMPDIR:-/tmp}/aria-restore-manifest.XXXXXX")"

echo "Creating isolated scratch database..."
SCRATCH_CLEANUP_ARMED=1
dex_owner -d postgres -c "create database \"${SCRATCH}\" owner postgres;" >/dev/null
echo "Restoring archive ${BACKUP_ID}..."
docker exec -i "$CID" pg_restore --exit-on-error --no-owner -U supabase_admin -d "$SCRATCH" < "$ARCHIVE" >/dev/null

REQUIRED_TABLES=()
while IFS= read -r table; do
  [ -z "$table" ] || REQUIRED_TABLES+=("$table")
done < docker/bootstrap/legacy-table-inventory.txt
REQUIRED_TABLES+=(aria_schema_migrations)
EXPECTED_TABLES="$(printf '%s\n' "${REQUIRED_TABLES[@]}" | LC_ALL=C sort | tr '\n' ',' | sed 's/,$//')"
ACTUAL_TABLES="$(dex_owner -d "$SCRATCH" -tA -c "select coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables where schemaname = 'public';" | tr -d '[:space:]')"
[ "$ACTUAL_TABLES" = "$EXPECTED_TABLES" ] || { echo "Restored public table set is not exact." >&2; exit 1; }

DISABLED_RLS="$(dex_owner -d "$SCRATCH" -tA -c "select coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables where schemaname = 'public' and rowsecurity = false;" | tr -d '[:space:]')"
[ -z "$DISABLED_RLS" ] || { echo "Restored public tables without RLS: $DISABLED_RLS" >&2; exit 1; }

EXPECTED_MIGRATION_IDENTITIES="$(expected_aria_migration_identities supabase/migrations)"
HAS_MIGRATION_LEDGER="$(dex_owner -d "$SCRATCH" -tA -c "select to_regclass('public.aria_schema_migrations') is not null;" | tr -d '[:space:]')"
[ "$HAS_MIGRATION_LEDGER" = "t" ] || { echo "Restored database has no migration ledger." >&2; exit 1; }
ACTUAL_MIGRATION_IDENTITIES="$(dex_owner -d "$SCRATCH" -tA -c "select coalesce(string_agg(filename || ':' || sha256, ',' order by filename), '') from public.aria_schema_migrations;" | tr -d '[:space:]')"
[ "$ACTUAL_MIGRATION_IDENTITIES" = "$EXPECTED_MIGRATION_IDENTITIES" ] || { echo "Restored ARIA migration identities do not match this checkout." >&2; exit 1; }

FINGERPRINT="$(dex_owner -d "$SCRATCH" -tA -c "select to_regprocedure('public.finalize_whatsapp_provider_failure(uuid,uuid,text)') is not null;" | tr -d '[:space:]')"
[ "$FINGERPRINT" = "t" ] || { echo "Latest schema fingerprint is missing." >&2; exit 1; }

write_db_manifest "$CID" "$SCRATCH" "$BACKUP_ID" "$ACTUAL_SHA" "$ACTUAL_MANIFEST"
cmp -s "$MANIFEST" "$ACTUAL_MANIFEST" || { echo "Restored schema, policy, function, migration, or row-count manifest differs." >&2; exit 1; }

cleanup_scratch
rm -f "$ACTUAL_MANIFEST"
trap - EXIT INT TERM
echo "RESTORE DRILL PASSED -- archive digest and exact restored manifest match ${BACKUP_ID}."
