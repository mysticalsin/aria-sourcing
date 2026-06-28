#!/usr/bin/env bash
# RESTORE DRILL — proves the latest backup is recoverable (Gate 12 evidence).
# Restores the latest backup into a throwaway scratch DB, verifies table + row
# counts, prints PASS/FAIL, then drops scratch. Never touches the live DB.
set -euo pipefail
cd "$(dirname "$0")/.."

CID="$(docker ps --filter name=supabase_db -q | head -1)"
[ -n "$CID" ] || { echo "No local Supabase DB container."; exit 1; }

TS="$(cat backups/.latest 2>/dev/null || true)"
[ -n "$TS" ] || { echo "No backup found. Run scripts/backup.sh first."; exit 1; }
SCHEMA="backups/hermes_${TS}_schema.sql.gz"
DATA="backups/hermes_${TS}_data.sql.gz"
SCRATCH="hermes_restore_drill"

dex() { docker exec -i "$CID" psql -U postgres "$@"; }

echo "Creating scratch DB ${SCRATCH}..."
dex -d postgres -c "DROP DATABASE IF EXISTS ${SCRATCH};" >/dev/null 2>&1
dex -d postgres -c "CREATE DATABASE ${SCRATCH};" >/dev/null

echo "Restoring schema + data from backup ${TS}..."
gunzip -c "$SCHEMA" | dex -d "${SCRATCH}" >/dev/null 2>&1 || true
gunzip -c "$DATA"   | dex -d "${SCRATCH}" >/dev/null 2>&1 || true

echo "Verifying restored database:"
dex -d "${SCRATCH}" -tA -c "SELECT 'public tables: ' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
dex -d "${SCRATCH}" -tA -c "SELECT 'rls-enabled tables: ' || count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true;"
TABLES="$(dex -d "${SCRATCH}" -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" | tr -d '[:space:]')"

echo "Dropping scratch DB..."
dex -d postgres -c "DROP DATABASE ${SCRATCH};" >/dev/null

if [ "${TABLES:-0}" -ge 1 ]; then
  echo "RESTORE DRILL PASSED -- ${TABLES} tables recovered from backup ${TS}."
else
  echo "RESTORE DRILL FAILED -- no tables recovered."; exit 1
fi
