#!/usr/bin/env bash
# Run the aria_recruitment suite on Odoo 19 Community and Postgres 16.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="${ROOT}/odoo_addons/aria_recruitment/ci/docker-compose.yml"

cd "${ROOT}"
docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
set +e
docker compose -f "${COMPOSE_FILE}" up --abort-on-container-exit --exit-code-from odoo
code=$?
set -e
docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
exit "${code}"
