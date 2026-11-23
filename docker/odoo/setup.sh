#!/usr/bin/env bash
# Local Odoo for developing the ARIA <-> Odoo integration (docs/odoo.md).
#
#   bash docker/odoo/setup.sh
#
# Starts docker/odoo/docker-compose.yml, creates the database "aria" with the
# Recruitment and Skills apps and Odoo's demo data, and writes an API key
# (scope rpc, user admin, 80 days) to docker/odoo/.odoo-api-key (gitignored).
# Then, in ARIA: Settings > Odoo, address http://host.docker.internal:8069
# (the app container) or http://localhost:8069 (next dev), database "aria".
# The ARIA server needs ODOO_ALLOW_HTTP=true for plain http. Development only.
set -Eeuo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -f "$here/docker-compose.yml")
key_file="$here/.odoo-api-key"

"${compose[@]}" up -d odoo-db
if ! "${compose[@]}" exec -T odoo-db psql -U odoo -d postgres -tAc "select 1 from pg_database where datname = 'aria'" | grep -q 1; then
  echo "Creating the Odoo database 'aria' (Recruitment, Skills, demo data)..."
  "${compose[@]}" run --rm odoo odoo -d aria -i hr_recruitment,hr_skills --with-demo --stop-after-init >/dev/null
fi
"${compose[@]}" up -d odoo

for _ in $(seq 1 60); do
  curl -sf http://localhost:8069/web/version >/dev/null && break
  sleep 2
done

if [ ! -s "$key_file" ]; then
  "${compose[@]}" exec -T odoo bash -c '
    cat > /tmp/aria_key.py <<"PY"
import datetime
admin = env.ref("base.user_admin")
key = env["res.users.apikeys"].with_user(admin)._generate("rpc", "ARIA dev", datetime.datetime.now() + datetime.timedelta(days=80))
env.cr.commit()
open("/var/lib/odoo/aria-dev-key.txt", "w").write(key)
PY
    odoo shell -d aria --no-http --db_host "$HOST" --db_user "$USER" --db_password "$PASSWORD" < /tmp/aria_key.py >/dev/null 2>&1
    cat /var/lib/odoo/aria-dev-key.txt
    rm -f /var/lib/odoo/aria-dev-key.txt /tmp/aria_key.py' > "$key_file"
  chmod 600 "$key_file"
fi

echo "Odoo $(curl -s http://localhost:8069/web/version | sed -E 's/.*"version": "([^"]+)".*/\1/') is up on http://localhost:8069 (admin / admin)."
echo "API key for ARIA written to $key_file"
