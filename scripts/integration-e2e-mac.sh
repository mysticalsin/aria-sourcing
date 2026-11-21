#!/usr/bin/env bash
# Mac run of the integration sweep.
# Node 22, Docker Desktop, browsers already installed. This script does not
# download a browser. The stack is capped at 6 GiB by the compose overlay.
# Artifacts: e2e-artifacts/<timestamp>/summary.json
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.x is required." >&2
  exit 1
fi
NODE_MAJOR="$(node -v | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
if [ "$NODE_MAJOR" != "22" ]; then
  echo "Node.js 22.x is required. This machine has $(node -v)." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop, then run this script again." >&2
  exit 1
fi
AVAIL_KB="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
if [ "${AVAIL_KB:-0}" -lt $((6 * 1024 * 1024)) ]; then
  echo "This run needs at least 6 GiB free on the filesystem that holds the repo." >&2
  exit 1
fi
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="${HOME}/qa-tools/playwright/browsers"
fi
if ! find "$PLAYWRIGHT_BROWSERS_PATH" -maxdepth 3 -type d -name 'chromium-1255' | grep -q .; then
  echo "Chromium build chromium-1255 is not under PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}." >&2
  echo "This script does not download browsers." >&2
  exit 1
fi
export STRESS_SOAK_SECONDS="${STRESS_SOAK_SECONDS:-1800}"
bash "$ROOT/scripts/integration-e2e.sh"
