#!/bin/sh
# Apply app migrations and seed the local user after db-init reconciled roles
# and GoTrue initialized its own schema. This job needs no owner credential.
set -eu
umask 077

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-postgres}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}"
export PGCONNECT_TIMEOUT

ADMIN_EMAIL="admin@aria.local"
# Seeded before the product rename; an existing volume still has this account.
LEGACY_ADMIN_EMAIL="admin@hermes.local"
ADMIN_PW="${DEMO_ADMIN_PASSWORD:-admindemo123}"


psql_postgres() {
  PGPASSWORD="$POSTGRES_TARGET_PASSWORD" \
    psql -X -w -h "$DB_HOST" -p "$DB_PORT" -U postgres -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 "$@"
}

echo "[bootstrap] waiting for Postgres ($DB_HOST:$DB_PORT)..."
i=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U postgres -q; do
  i=$((i + 1))
  [ "$i" -le 90 ] || { echo "[bootstrap] Postgres did not become ready" >&2; exit 1; }
  sleep 2
done

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
/usr/local/bin/migrate.sh

echo "[bootstrap] renaming the pre-rename admin account if this volume has one..."
curl -fsS -o /tmp/users.json "http://auth:9999/admin/users?per_page=1000"   -H "Authorization: Bearer ${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY required}"
LEGACY_ID="$(jq -r --arg email "$LEGACY_ADMIN_EMAIL" '[.users[] | select(.email == $email) | .id][0] // empty' /tmp/users.json)"
CURRENT_ID="$(jq -r --arg email "$ADMIN_EMAIL" '[.users[] | select(.email == $email) | .id][0] // empty' /tmp/users.json)"
if [ -n "$LEGACY_ID" ] && [ -z "$CURRENT_ID" ]; then
  # Same user id: the profile, its workspace and every record keep pointing at it.
  code="$(curl -s -o /dev/null -w "%{http_code}" -X PUT "http://auth:9999/admin/users/$LEGACY_ID"     -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"     -H "Content-Type: application/json"     --data-binary "$(jq -cn --arg email "$ADMIN_EMAIL" '{email:$email,email_confirm:true}')")"
  case "$code" in
    200) echo "[bootstrap]   $LEGACY_ADMIN_EMAIL is now $ADMIN_EMAIL." ;;
    *) echo "[bootstrap] ERROR renaming the admin account (HTTP $code)." >&2; exit 1 ;;
  esac
fi
psql_postgres -q <<'SQL'
update public.workspaces
   set name = 'Aria Workspace', allowed_domain = 'aria.local'
 where id = '00000000-0000-4000-8000-000000000001' and allowed_domain = 'hermes.local';
SQL

echo "[bootstrap] seeding login user $ADMIN_EMAIL via GoTrue admin API..."
code="$(curl -s -o /tmp/seed.json -w "%{http_code}" -X POST "http://auth:9999/admin/users" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY required}" \
  -H "Content-Type: application/json" \
  --data-binary "$(jq -cn --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PW" '{email:$email,password:$password,email_confirm:true}')")"
echo "[bootstrap]   GoTrue /admin/users -> HTTP $code"
case "$code" in
  200|201) echo "[bootstrap]   admin user created." ;;
  422)
    echo "[bootstrap]   admin user already exists (ok)."
    curl -fsS -o /tmp/seed.json "http://auth:9999/admin/users?per_page=1000" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"
    ;;
  *) echo "[bootstrap]   ERROR seeding user (response body withheld)." >&2; exit 1 ;;
esac
# GoTrue response ordering is not an API contract. Match the exact email in
# either the created user or the users array returned on an idempotent restart.
ADMIN_ID="$(jq -er --arg email "$ADMIN_EMAIL" '
  (if .users then .users[] else . end) | select(.email == $email) | .id
' /tmp/seed.json | head -n 1)"
[ -n "$ADMIN_ID" ] || { echo "[bootstrap] ERROR: could not resolve the admin user id" >&2; exit 1; }

echo "[bootstrap] promoting $ADMIN_EMAIL to an admin profile..."
psql_postgres -q -v admin_id="$ADMIN_ID" -v admin_email="$ADMIN_EMAIL" <<'SQL'
-- Fixed id so docker-compose can point CAREERS_WORKSPACE_ID at it.
insert into public.workspaces (id, name, allowed_domain)
  values ('00000000-0000-4000-8000-000000000001', 'Aria Workspace', 'aria.local')
  on conflict (allowed_domain) do nothing;

insert into public.profiles (id, email, full_name, workspace_id, role)
  select :'admin_id'::uuid, :'admin_email', 'Admin', w.id, 'admin'
    from public.workspaces w
   where w.allowed_domain = 'aria.local'
  on conflict (id) do update
    set role = 'admin',
        workspace_id = excluded.workspace_id,
        email = excluded.email;
SQL

echo "[bootstrap] reloading the PostgREST schema cache..."
psql_postgres -q -c "notify pgrst, 'reload schema';"

echo "[bootstrap] checking the API gateway the browser and the app go through..."
/usr/local/bin/gateway-check.sh

echo "[bootstrap] done: Supabase backend is migrated and seeded."
