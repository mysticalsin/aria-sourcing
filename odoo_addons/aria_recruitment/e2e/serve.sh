#!/bin/sh
# Install Community aria_recruitment with demo data off, seed synthetic
# applicants, then serve the web client. The database is created empty by
# this container and removed with the compose project.
set -eu
DB="${ARIA_E2E_DB:-aria_e2e}"
COMMON="--workers=0 --max-cron-threads=0 --http-port=8069 --limit-memory-soft=2147483648 --limit-memory-hard=2684354560 --db_host=${HOST} --db_port=${PORT} --db_user=${USER} --db_password=${PASSWORD}"
# shellcheck disable=SC2086
odoo $COMMON -d "$DB" -i aria_recruitment --without-demo=all --stop-after-init
# shellcheck disable=SC2086
odoo shell $COMMON --no-http --stop-after-init -d "$DB" < /opt/e2e/bootstrap.py
# shellcheck disable=SC2086
exec odoo $COMMON -d "$DB"
