#!/bin/sh
# Local one-shot bootstrap. The same direct owner boundary used in production
# rotates split credentials, secures default ACLs, reconciles Auth ownership,
# and writes JWT settings before migrations or demo seeding run as postgres.
set -eu
umask 077

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}"
export PGCONNECT_TIMEOUT

cleanup() {
  unset \
    OWNER_PASSWORD \
    SUPABASE_ADMIN_CURRENT_PASSWORD \
    SUPABASE_ADMIN_TARGET_PASSWORD \
    POSTGRES_TARGET_PASSWORD \
    SUPABASE_AUTH_ADMIN_TARGET_PASSWORD \
    AUTHENTICATOR_TARGET_PASSWORD \
    JWT_SECRET \
    JWT_EXP 2>/dev/null || :
}
trap cleanup EXIT HUP INT TERM

: "${SUPABASE_ADMIN_CURRENT_PASSWORD:?SUPABASE_ADMIN_CURRENT_PASSWORD required}"
: "${SUPABASE_ADMIN_TARGET_PASSWORD:?SUPABASE_ADMIN_TARGET_PASSWORD required}"
: "${POSTGRES_TARGET_PASSWORD:?POSTGRES_TARGET_PASSWORD required}"
: "${SUPABASE_AUTH_ADMIN_TARGET_PASSWORD:?SUPABASE_AUTH_ADMIN_TARGET_PASSWORD required}"
: "${AUTHENTICATOR_TARGET_PASSWORD:?AUTHENTICATOR_TARGET_PASSWORD required}"
: "${JWT_SECRET:?JWT_SECRET required}"
: "${JWT_EXP:?JWT_EXP required}"

ADMIN_EMAIL="admin@hermes.local"
ADMIN_PW="${DEMO_ADMIN_PASSWORD:-admindemo123}"
OWNER_SQL="/opt/aria/supabase-admin-reconciliation.sql"

psql_postgres() {
  PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 "$@"
}

echo "[bootstrap] waiting for Postgres ($DB_HOST:$DB_PORT)..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -q; do sleep 2; done

OWNER_PASSWORD=""
if PGPASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD" \
  psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; then
  OWNER_PASSWORD="$SUPABASE_ADMIN_CURRENT_PASSWORD"
elif PGPASSWORD="$SUPABASE_ADMIN_TARGET_PASSWORD" \
  psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -qc 'select 1' >/dev/null 2>&1; then
  OWNER_PASSWORD="$SUPABASE_ADMIN_TARGET_PASSWORD"
else
  echo "[bootstrap] ERROR: no direct supabase_admin credential works" >&2
  exit 1
fi

echo "[bootstrap] reconciling owner ACLs, split credentials, Auth ownership, and JWT settings..."
PGPASSWORD="$OWNER_PASSWORD" \
  psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U supabase_admin -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -q -f "$OWNER_SQL"
unset OWNER_PASSWORD

echo "[bootstrap] proving the rotated postgres credential..."
psql_postgres -qc 'select 1' >/dev/null

echo "[bootstrap] waiting for GoTrue HTTP (auth:9999/health) to recover..."
i=0
until curl -fsS -o /dev/null "http://auth:9999/health"; do
  i=$((i + 1))
  [ "$i" -le 90 ] || { echo "[bootstrap] timed out waiting for GoTrue HTTP" >&2; exit 1; }
  sleep 2
done

echo "[bootstrap] applying app migrations..."
ARIA_BOOTSTRAP_PHASE=migrations /usr/local/bin/run.fly.sh

echo "[bootstrap] seeding login user $ADMIN_EMAIL via GoTrue admin API..."
code="$(curl -s -o /tmp/seed.json -w "%{http_code}" -X POST "http://auth:9999/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY required}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\",\"email_confirm\":true}")"
echo "[bootstrap]   GoTrue /admin/users -> HTTP $code"
case "$code" in
  200|201) echo "[bootstrap]   admin user created." ;;
  422) echo "[bootstrap]   admin user already exists (ok)." ;;
  *) echo "[bootstrap]   ERROR seeding user; body:" >&2; sed -n '1,20p' /tmp/seed.json >&2; exit 1 ;;
esac

echo "[bootstrap] promoting $ADMIN_EMAIL to an admin profile..."
psql_postgres -q <<'SQL'
insert into public.workspaces (name, allowed_domain)
  values ('Hermes Workspace', 'hermes.local')
  on conflict (allowed_domain) do nothing;

insert into public.profiles (id, email, full_name, workspace_id, role)
  select u.id, u.email, 'Admin', w.id, 'admin'
    from auth.users u
    join public.workspaces w on w.allowed_domain = 'hermes.local'
   where u.email = 'admin@hermes.local'
  on conflict (id) do update
    set role = 'admin',
        workspace_id = excluded.workspace_id,
        email = excluded.email;
SQL

echo "[bootstrap] reloading the PostgREST schema cache..."
psql_postgres -q -c "notify pgrst, 'reload schema';"

echo "[bootstrap] done: Supabase backend is migrated and seeded."
