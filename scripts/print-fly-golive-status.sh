#!/usr/bin/env bash
# print-fly-golive-status.sh — tip vs live Fly vs deploy-confirm match (no secrets printed).
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

TIP="$(git rev-parse HEAD)"
APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
ready="$(curl -sS -m 20 "$APP_URL/api/ready" 2>/dev/null || echo '{}')"
LIVE="$(echo "$ready" | jq -r '.build // empty' 2>/dev/null || true)"
LIVE_MIG="$(echo "$ready" | jq -r '.migration // empty' 2>/dev/null || true)"
READY_OK="$(echo "$ready" | jq -r '.ok // false' 2>/dev/null || echo false)"

load_confirm() {
  local path="$1"
  [ -r "$path" ] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}
load_confirm "/tmp/owner-deploy-confirm.env"
load_confirm "$repo/production-readiness/.owner-deploy-confirm.env"

CONFIRM_SHA="${ARIA_RELEASE_SHA:-}"
CONFIRM_MATCH="no"
if [ -n "${ARIA_PROD_DEPLOY_CONFIRM:-}" ] && [[ "${ARIA_PROD_DEPLOY_CONFIRM}" == *":${TIP}:"* ]]; then
  CONFIRM_MATCH="yes"
fi

echo "tip_sha=${TIP}"
echo "live_sha=${LIVE:-unknown}"
echo "live_migration=${LIVE_MIG:-unknown}"
echo "live_ready_ok=${READY_OK}"
echo "confirm_sha=${CONFIRM_SHA:-unset}"
echo "confirm_matches_tip=${CONFIRM_MATCH}"
if [ -n "$LIVE" ] && [[ "$LIVE" == "$TIP"* ]]; then
  echo "deploy_status=tip_live"
elif [ "$CONFIRM_MATCH" = "yes" ]; then
  echo "deploy_status=confirm_ready_run_golive"
else
  echo "deploy_status=stale_owner_remint_required"
fi
