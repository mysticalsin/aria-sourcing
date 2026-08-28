#!/usr/bin/env bash
# run-enterprise-e2e-partial.sh — Fly enterprise E2E with honest PARTIAL flags.
#
# Loads env from print-fly-e2e-env.sh, adds owner-ordered partial flags, and
# auto-includes ARIA_ALLOW_STALE_FLY_E2E=1 while live Fly lags tip SHA.
#
# Usage:
#   bash scripts/run-enterprise-e2e-partial.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

echo "=== Golive status ==="
deploy_status="$(bash "$repo/scripts/print-fly-golive-status.sh" | awk -F= '/^deploy_status=/{print $2}')"
echo

eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export)"

flags=(ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1)
case "$deploy_status" in
  tip_live) ;;
  *)
    flags+=(ARIA_ALLOW_STALE_FLY_E2E=1)
    echo "NOTE: live Fly lags tip — including ARIA_ALLOW_STALE_FLY_E2E=1 (provenance stamp pending golive)."
    ;;
esac

echo "Running: ${flags[*]} bash e2e-workflow-test.sh"
echo
exec env "${flags[@]}" bash "$repo/e2e-workflow-test.sh"
