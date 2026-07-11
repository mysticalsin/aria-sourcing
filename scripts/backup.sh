#!/usr/bin/env bash
# Create and self-verify one consistent local custom-format archive. The archive
# may contain PII and secrets; it is private local evidence, never source code.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/local-db-container.sh
source scripts/lib/local-db-container.sh
# shellcheck source=scripts/lib/db-manifest.sh
source scripts/lib/db-manifest.sh
# shellcheck source=scripts/lib/safe-exit-traps.sh
source scripts/lib/safe-exit-traps.sh

CID="$(resolve_local_db_container "${BACKUP_DB_CONTAINER:-}")"
BACKUP_DIR="${BACKUP_DIR:-backups}"
[ ! -L "$BACKUP_DIR" ] || { echo "BACKUP_DIR must not be a symlink." >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

BACKUP_ID="$(date +%Y%m%d_%H%M%S)_$$_${RANDOM}"
ARCHIVE="$BACKUP_DIR/hermes_${BACKUP_ID}.dump"
MANIFEST="$BACKUP_DIR/hermes_${BACKUP_ID}.manifest"
LOCK_PATH="$BACKUP_DIR/.backup.lock"
STAGE_DIR="$BACKUP_DIR/.backup-stage-${BACKUP_ID}"
TMP_ARCHIVE="$STAGE_DIR/archive.tmp"
TMP_ARCHIVE_MANIFEST="$STAGE_DIR/archive.manifest.tmp"
TMP_LATEST="$STAGE_DIR/latest.tmp"
SCRATCH="aria_backup_verify_$$_${RANDOM}"
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
  rm -f "$TMP_ARCHIVE" "$TMP_ARCHIVE_MANIFEST" "$TMP_LATEST"
  if [ -d "$STAGE_DIR" ] && ! rmdir "$STAGE_DIR" 2>/dev/null; then exit_status=1; fi
  if [ -L "$LOCK_PATH" ] && [ "$(readlink "$LOCK_PATH")" = "$$" ]; then
    rm -f "$LOCK_PATH" || exit_status=1
  fi
  exit "$exit_status"
}
install_safe_exit_traps cleanup_on_exit

if ! ln -s "$$" "$LOCK_PATH"; then
  echo "Another backup is already running." >&2
  exit 1
fi
mkdir "$STAGE_DIR"

[ ! -e "$ARCHIVE" ] && [ ! -e "$MANIFEST" ] || { echo "Backup id collision." >&2; exit 1; }

REQUIRED_TABLES=(
  agent_events agent_runs agent_seats agent_specs api_keys aria_schema_migrations databricks_connection_events
  databricks_connections dust_connection_events dust_connections email_connections
  messages_inbound messages_outbound outbound_content_cache outreach_approvals
  outreach_ledger profiles suppression_list whatsapp_contacts
  whatsapp_conversation_windows whatsapp_delivery_events whatsapp_senders
  whatsapp_templates workspace_state workspaces
)
EXPECTED_TABLES="$(printf '%s\n' "${REQUIRED_TABLES[@]}" | LC_ALL=C sort | tr '\n' ',' | sed 's/,$//')"
ACTUAL_TABLES="$(dex -d postgres -tA -c "select coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables where schemaname = 'public';" | tr -d '[:space:]')"
[ "$ACTUAL_TABLES" = "$EXPECTED_TABLES" ] || { echo "Source public table set does not match this checkout." >&2; exit 1; }

DISABLED_RLS="$(dex -d postgres -tA -c "select coalesce(string_agg(tablename, ',' order by tablename), '') from pg_tables where schemaname = 'public' and rowsecurity = false;" | tr -d '[:space:]')"
[ -z "$DISABLED_RLS" ] || { echo "Source public tables without RLS: $DISABLED_RLS" >&2; exit 1; }

EXPECTED_MIGRATION_IDENTITIES="$(expected_aria_migration_identities supabase/migrations)"
HAS_MIGRATION_LEDGER="$(dex -d postgres -tA -c "select to_regclass('public.aria_schema_migrations') is not null;" | tr -d '[:space:]')"
[ "$HAS_MIGRATION_LEDGER" = "t" ] || { echo "Source database has no migration ledger." >&2; exit 1; }
ACTUAL_MIGRATION_IDENTITIES="$(dex -d postgres -tA -c "select coalesce(string_agg(filename || ':' || sha256, ',' order by filename), '') from public.aria_schema_migrations;" | tr -d '[:space:]')"
[ "$ACTUAL_MIGRATION_IDENTITIES" = "$EXPECTED_MIGRATION_IDENTITIES" ] || { echo "Source ARIA migration identities do not match this checkout." >&2; exit 1; }

FINGERPRINT="$(dex -d postgres -tA -c "select to_regprocedure('public.finalize_whatsapp_provider_failure(uuid,uuid,text)') is not null;" | tr -d '[:space:]')"
[ "$FINGERPRINT" = "t" ] || { echo "Source database lacks the latest schema fingerprint." >&2; exit 1; }

echo "Creating one consistent custom-format archive..."
docker exec "$CID" pg_dump -U supabase_admin -Fc --no-owner postgres > "$TMP_ARCHIVE"
docker exec -i "$CID" pg_restore --list < "$TMP_ARCHIVE" >/dev/null
ARCHIVE_SHA="$(sha256_file "$TMP_ARCHIVE")"

echo "Self-verifying the archive in an isolated database..."
SCRATCH_CLEANUP_ARMED=1
dex_owner -d postgres -c "create database \"${SCRATCH}\" owner postgres;" >/dev/null
docker exec -i "$CID" pg_restore --exit-on-error --no-owner -U supabase_admin -d "$SCRATCH" < "$TMP_ARCHIVE" >/dev/null
write_db_manifest "$CID" "$SCRATCH" "$BACKUP_ID" "$ARCHIVE_SHA" "$TMP_ARCHIVE_MANIFEST"
cleanup_scratch

mv "$TMP_ARCHIVE" "$ARCHIVE"
mv "$TMP_ARCHIVE_MANIFEST" "$MANIFEST"
printf '%s\n' "$BACKUP_ID" > "$TMP_LATEST"
mv "$TMP_LATEST" "$BACKUP_DIR/.latest"
rmdir "$STAGE_DIR"
rm -f "$LOCK_PATH"
trap - EXIT INT TERM
echo "Backup archive restored and manifest-recorded: ${BACKUP_ID}"
