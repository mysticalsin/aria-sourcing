#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Back up the LOCAL Supabase Postgres to a timestamped, gzipped SQL pair
# (schema + data) under ./backups. Encrypted at rest is the operator's job;
# these are local working backups for the restore drill + dev safety.
#
# Prereq: Docker + local Supabase up (scripts/local-supabase-up.sh).
# Run:    bash scripts/backup.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
CID="$(docker ps --filter name=supabase_db -q | head -1)"
[ -n "$CID" ] || { echo "✗ Local Supabase DB container not found. Run scripts/local-supabase-up.sh first."; exit 1; }

mkdir -p backups
TS="$(date +%Y%m%d_%H%M%S)"
SCHEMA="backups/hermes_${TS}_schema.sql"
DATA="backups/hermes_${TS}_data.sql"

echo "▸ Dumping schema → ${SCHEMA}.gz"
docker exec "$CID" pg_dump -U postgres --schema-only --no-owner postgres > "$SCHEMA"
echo "▸ Dumping data   → ${DATA}.gz"
docker exec "$CID" pg_dump -U postgres --data-only --no-owner postgres > "$DATA"

gzip -f "$SCHEMA" "$DATA"
echo "✓ Backup complete:"
ls -lh backups/ | grep "$TS"
echo "${TS}" > backups/.latest
