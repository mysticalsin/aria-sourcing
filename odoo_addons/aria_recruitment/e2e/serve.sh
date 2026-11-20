#!/bin/sh
# Install Community aria_recruitment with demo data off, seed synthetic
# applicants, then serve the web client. The database is created empty by
# this container and removed with the compose project.
set -eu
DB="${ARIA_E2E_DB:-aria_e2e}"
odoo \
  --workers=0 \
  --max-cron-threads=0 \
  --http-port=8069 \
  -d "$DB" \
  -i aria_recruitment \
  --without-demo=all \
  --stop-after-init
odoo shell --no-http --stop-after-init -d "$DB" < /opt/e2e/bootstrap.py
exec odoo --workers=0 --max-cron-threads=0 --http-port=8069 -d "$DB"
