#!/bin/sh
# One-shot bootstrap for the self-contained Supabase backend.
#   1. wait for Postgres
#   2. hand the auth schema to supabase_auth_admin (the supabase/postgres image creates
#      it owned by postgres, which crash-loops GoTrue with "must be owner of function uid")
#   3. wait for GoTrue to recover + finish its migrations (auth:9999/health)
#   4. apply the app's migrations 0001..0006 in order (idempotent)
#   5. seed the offline login user admin@hermes.local via the GoTrue admin API
#   6. promote that user to an admin profile in the app schema
# All steps are idempotent, so re-running on every `docker compose up` is safe.
set -eu

DB="${ADMIN_DB_URL:?ADMIN_DB_URL required}"
ADMIN_EMAIL="admin@hermes.local"
ADMIN_PW="${DEMO_ADMIN_PASSWORD:-admindemo123}"

echo "[bootstrap] waiting for Postgres (db:5432)..."
until pg_isready -h db -U postgres -q; do sleep 2; done

echo "[bootstrap] handing the auth schema to supabase_auth_admin (unblocks GoTrue)..."
psql "$DB" -v ON_ERROR_STOP=1 -q -f /auth-owner.sql

echo "[bootstrap] waiting for GoTrue HTTP (auth:9999/health) to recover..."
i=0
until curl -fsS -o /dev/null "http://auth:9999/health"; do
  i=$((i + 1)); [ "$i" -gt 90 ] && { echo "[bootstrap] timed out waiting for GoTrue HTTP"; exit 1; }
  sleep 2
done

echo "[bootstrap] applying app migrations..."
for f in /migrations/0*.sql; do
  echo "[bootstrap]   -> $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "[bootstrap] seeding login user $ADMIN_EMAIL via GoTrue admin API..."
code=$(curl -s -o /tmp/seed.json -w "%{http_code}" -X POST "http://auth:9999/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY required}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\",\"email_confirm\":true}")
echo "[bootstrap]   GoTrue /admin/users -> HTTP $code"
case "$code" in
  200|201) echo "[bootstrap]   admin user created." ;;
  422)     echo "[bootstrap]   admin user already exists (ok)." ;;
  *)       echo "[bootstrap]   ERROR seeding user; body:"; cat /tmp/seed.json 2>/dev/null; exit 1 ;;
esac

echo "[bootstrap] promoting $ADMIN_EMAIL to an admin profile..."
psql "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.workspaces (name, allowed_domain)
  values ('Hermes Workspace', 'hermes.local')
  on conflict (allowed_domain) do nothing;

insert into public.profiles (id, email, full_name, workspace_id, role)
  select u.id, u.email, 'Admin', w.id, 'admin'
  from auth.users u
  join public.workspaces w on w.allowed_domain = 'hermes.local'
  where u.email = 'admin@hermes.local'
  on conflict (id) do update
    set role = 'admin', workspace_id = excluded.workspace_id, email = excluded.email;
SQL

# PostgREST cached its schema before our migrations created the tables; tell it to reload
# so the app's /rest/v1 calls see public.* immediately (otherwise: PGRST205 table-not-found).
echo "[bootstrap] reloading the PostgREST schema cache..."
psql "$DB" -v ON_ERROR_STOP=1 -q -c "notify pgrst, 'reload schema';"

echo "[bootstrap] done — Supabase backend is migrated and seeded."
