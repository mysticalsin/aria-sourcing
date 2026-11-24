#!/usr/bin/env bash
# Synthetic sourcing-to-hired end-to-end run.
# Fixture data only: the app serves /demo/hire, and the spec reads that page.
# On Tony's Mac this uses the preinstalled Playwright browsers and does not download any.
# In CI (CI=true) it installs Chromium for the pinned @playwright/test version.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" != "22" ]]; then
  echo "Node 22.x is required. Found $(node -v)." >&2
  exit 1
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "This script requires Apple Silicon (arm64). Found $(uname -m)." >&2
    exit 1
  fi
  AVAIL_KB="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
  NEED_KB="$((6 * 1024 * 1024))"
  if [[ "$AVAIL_KB" -lt "$NEED_KB" ]]; then
    echo "Need at least 6 GiB free. Found $((AVAIL_KB / 1024 / 1024)) GiB." >&2
    exit 1
  fi
elif [[ "${CI:-}" != "true" ]]; then
  echo "Run this on macOS Apple Silicon, or set CI=true for the headless job." >&2
  exit 1
fi

if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="${HOME}/qa-tools/playwright/browsers"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$ROOT/e2e-artifacts/$STAMP"
mkdir -p "$LOG_DIR/screenshots" "$LOG_DIR/test-results" "$LOG_DIR/report"

free_port() {
  node -e 'const net=require("net"); const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{ console.log(server.address().port); server.close(); });'
}

PIDS=()
cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
print_log() {
  if [[ -n "${LOG_DIR:-}" ]]; then
    echo "$LOG_DIR"
  fi
}
trap 'cleanup; print_log' EXIT

echo "Installing local dependencies"
npm ci

if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ ! -d "$PLAYWRIGHT_BROWSERS_PATH" ]]; then
    echo "Playwright browsers were not found at $PLAYWRIGHT_BROWSERS_PATH. This script does not download them." >&2
    exit 1
  fi
else
  echo "CI browser install"
  npx playwright install --with-deps chromium
fi

APP_PORT="$(free_port)"
export NODE_ENV=test
export ARIA_E2E=1
export ARIA_E2E_BASE_URL="http://127.0.0.1:${APP_PORT}"
export ARIA_E2E_LOG_DIR="$LOG_DIR"
export ARIA_E2E_SHOT_DIR="$LOG_DIR/screenshots"
export PLAYWRIGHT_BROWSERS_PATH

# The page uses the in-repo fixture. Drop connector and login env so this
# process cannot reach a live ERP, LinkedIn, Azure, or Supabase.
unset ODOO_URL ODOO_DB ODOO_USERNAME ODOO_API_KEY ODOO_HIRED_STAGE_ID \
  SMART_URL SMART_TOKEN \
  HIRE_API_URL HIRE_API_TOKEN \
  HIRE_MCP_URL HIRE_MCP_TOKEN HIRE_MCP_TOOL HIRE_CONNECTOR \
  NEXT_PUBLIC_SUPABASE_URL SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
  NEXT_PUBLIC_ENABLE_AZURE_LOGIN AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_TENANT_ID \
  LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET || true

# Next may exit once to show an upgrade reminder. Start it again so the suite still runs.
npx next dev --hostname 127.0.0.1 --port "$APP_PORT" >"$LOG_DIR/server.log" 2>&1 &
APP_PID="$!"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if kill -0 "$APP_PID" 2>/dev/null; then
    sleep 1
  else
    npx next dev --hostname 127.0.0.1 --port "$APP_PORT" >"$LOG_DIR/server.log" 2>&1 &
    APP_PID="$!"
    break
  fi
done
PIDS+=("$APP_PID")

echo "Waiting for the app"
for _ in $(seq 1 180); do
  if curl --silent --fail --max-time 5 "$ARIA_E2E_BASE_URL/api/health" >/dev/null; then
    break
  fi
  sleep 2
done
curl --silent --fail --max-time 5 "$ARIA_E2E_BASE_URL/api/health" >/dev/null

set +e
npx playwright test e2e/synthetic-hire.spec.ts --retries=0 >"$LOG_DIR/playwright.log" 2>&1
PLAYWRIGHT_STATUS=$?
set -e
cat "$LOG_DIR/playwright.log"

node scripts/e2e-summary.mjs "$LOG_DIR" | tee "$LOG_DIR/summary.txt"

LEAKS="$(mktemp)"
if grep -R -E -l -a -- 'linkedin\.com|login\.microsoftonline\.com|azure\.com|odoo\.com' \
  "$LOG_DIR/server.log" \
  "$LOG_DIR/playwright.log" \
  "$LOG_DIR/summary.txt" \
  "$LOG_DIR/summary.json" \
  "$LOG_DIR/report" \
  "$LOG_DIR/test-results" \
  "$LOG_DIR/screenshots" >"$LEAKS" 2>/dev/null; then
  echo "A live host appeared in the synthetic hire log:" >&2
  sed 's/^/  /' "$LEAKS" >&2
  echo "$LOG_DIR"
  exit 1
fi

exit "$PLAYWRIGHT_STATUS"
