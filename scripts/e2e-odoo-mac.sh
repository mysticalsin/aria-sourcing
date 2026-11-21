#!/usr/bin/env bash
# Run the Aria hire-gate Playwright suite against a local Odoo 19 Community
# stack. From a detached clone:
#   bash scripts/e2e-odoo-mac.sh
# On a Mac this uses Node 22 and the browsers already in
# ~/qa-tools/playwright/browsers (or PLAYWRIGHT_BROWSERS_PATH). It does not
# download a browser. CI sets CI=true and installs Chromium itself.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="${ROOT}/odoo_addons/aria_recruitment/e2e"
COMPOSE_FILE="${E2E}/docker-compose.yml"
STAMP="$(date +%Y%m%d-%H%M%S)"
ART="${ROOT}/e2e-artifacts/${STAMP}"
PROJECT=""
SECRET_DIR=""
ARIA_E2E_PASSWORD="${ARIA_E2E_PASSWORD:-}"

mkdir -p "${ART}"

cleanup() {
  local status=$?
  if [ -n "${PROJECT}" ]; then
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" logs --no-color > "${ART}/docker.log" 2>&1 || true
    if [ -n "${ARIA_E2E_PASSWORD}" ] && [ -f "${ART}/docker.log" ]; then
      if grep -a -q -F "${ARIA_E2E_PASSWORD}" "${ART}/docker.log"; then
        echo "A test password was found in the container logs." >&2
        status=1
      fi
    fi
    if [ -n "${SECRET_DIR}" ] && [ -d "${SECRET_DIR}" ]; then
      local keyfile
      for keyfile in "${SECRET_DIR}"/*; do
        [ -f "${keyfile}" ] || continue
        if grep -a -R -q -F -f "${keyfile}" "${ART}" --exclude-dir="${SECRET_DIR}" 2>/dev/null; then
          echo "An API key was found in the E2E artifacts." >&2
          status=1
        fi
      done
      rm -rf "${SECRET_DIR}"
    fi
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  echo "E2E artifacts: ${ART}"
  exit "${status}"
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.x is required but node was not found on PATH." >&2
  exit 1
fi
NODE_VERSION="$(node -v)"
NODE_MAJOR="$(printf '%s' "${NODE_VERSION}" | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
if [ "${NODE_MAJOR}" != "22" ]; then
  echo "Node.js 22.x is required. This machine has ${NODE_VERSION}." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and wait until it is ready, then run this script again." >&2
  exit 1
fi

AVAIL_KB="$(df -Pk "${ROOT}" | awk 'NR==2 {print $4}')"
NEED_KB=$((6 * 1024 * 1024))
if [ "${AVAIL_KB}" -lt "${NEED_KB}" ]; then
  echo "This run needs at least 6 GiB free. This filesystem has $((AVAIL_KB / 1024 / 1024)) GiB free." >&2
  exit 1
fi

if [ -z "${CI:-}" ]; then
  if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    export PLAYWRIGHT_BROWSERS_PATH="${HOME}/qa-tools/playwright/browsers"
  fi
  if ! find "${PLAYWRIGHT_BROWSERS_PATH}" -maxdepth 3 -type d -name 'chromium-1255' | grep -q .; then
    echo "Chromium build chromium-1255 is not under PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}." >&2
    echo "This script does not download browsers. Install Playwright 1.65.1 chromium-1255 there first." >&2
    exit 1
  fi
fi

export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci --prefix "${E2E}"
INSTALLED="$(node -p "require('${E2E}/node_modules/@playwright/test/package.json').version")"
if [ "${INSTALLED}" != "1.65.1" ]; then
  echo "@playwright/test resolved to ${INSTALLED}, expected 1.65.1." >&2
  exit 1
fi
if [ -n "${CI:-}" ]; then
  (
    cd "${E2E}"
    unset PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
    npx playwright install --with-deps chromium
  )
fi

free_port() {
  local port=18080
  while [ "${port}" -lt 18280 ]; do
    if ! (echo >/dev/tcp/127.0.0.1/"${port}") >/dev/null 2>&1; then
      echo "${port}"
      return 0
    fi
    port=$((port + 1))
  done
  echo "No free TCP port between 18080 and 18279." >&2
  return 1
}

ODOO_PORT="$(free_port)"
export ODOO_PORT
if [ -z "${ARIA_E2E_PASSWORD}" ]; then
  ARIA_E2E_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  export ARIA_E2E_PASSWORD
fi
PROJECT="aria-e2e-${STAMP}-$$"
export HEAD_SHA="$(git -C "${ROOT}" rev-parse HEAD)"
export TREE_SHA="$(git -C "${ROOT}" rev-parse 'HEAD^{tree}')"
export ARTIFACT_DIR="${ART}"
export BASE_URL="http://127.0.0.1:${ODOO_PORT}"
export STATE_PATH=""
export SECRET_DIR=""
export SPEC_PATH="${ROOT}/odoo_addons/aria_recruitment/spec/pipeline_stages.json"
export CONTRACT_PDF="${E2E}/synthetic-contract.pdf"

echo "Compose project: ${PROJECT}"
echo "Odoo UI: ${BASE_URL}"
docker pull "$(awk '/image: postgres:16@sha256:/{print $2; exit}' "${COMPOSE_FILE}")"
docker pull "$(awk '/image: odoo:19@sha256:/{print $2; exit}' "${COMPOSE_FILE}")"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --wait --wait-timeout 1200

SECRET_DIR="$(mktemp -d)"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" cp odoo:/tmp/e2e-state/state.json "${SECRET_DIR}/state.json"
mkdir -p "${SECRET_DIR}/keys"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" cp odoo:/tmp/e2e-state/keys/. "${SECRET_DIR}/keys/"
export STATE_PATH="${SECRET_DIR}/state.json"
export SECRET_DIR="${SECRET_DIR}/keys"

set +e
(cd "${E2E}" && node run-suite.js)
code=$?
set -e
if [ "${code}" -ne 0 ]; then
  exit "${code}"
fi
