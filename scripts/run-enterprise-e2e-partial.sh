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
  confirm_ready_run_golive)
    flags+=(ARIA_ALLOW_STALE_FLY_E2E=1)
    echo "NOTE: deploy confirm matches tip but Fly is not live yet — run:"
    echo "      bash scripts/fly-enterprise-golive-when-ready.sh"
    echo "      (including ARIA_ALLOW_STALE_FLY_E2E=1 until /api/ready build = tip)"
    ;;
  *)
    flags+=(ARIA_ALLOW_STALE_FLY_E2E=1)
    echo "NOTE: live Fly lags tip — owner remint required:"
    echo "      bash scripts/print-fly-deploy-confirm.sh → /tmp/owner-deploy-confirm.env"
    ;;
esac

echo "Running: ${flags[*]} bash e2e-workflow-test.sh"
echo
exec env "${flags[@]}" bash "$repo/e2e-workflow-test.sh"
