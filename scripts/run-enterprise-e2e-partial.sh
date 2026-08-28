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
golive_out="$(bash "$repo/scripts/print-fly-golive-status.sh")"
echo "$golive_out"
deploy_status="$(echo "$golive_out" | awk -F= '/^deploy_status=/{print $2}')"
live_mig="$(echo "$golive_out" | awk -F= '/^live_migration=/{print $2}')"
tip_mig="$(echo "$golive_out" | awk -F= '/^tip_migration=/{print $2}')"
confirm_present="$(echo "$golive_out" | awk -F= '/^confirm_file_present=/{print $2}')"
confirm_sha="$(echo "$golive_out" | awk -F= '/^confirm_sha=/{print $2}')"
tip_sha="$(echo "$golive_out" | awk -F= '/^tip_sha=/{print $2}')"
echo

eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export)"

flags=(ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1)
# Split LLM soft-fails from M365: only soften critics_required when auth is dead.
if ! bash "$repo/scripts/probe-fly-llm-auth.sh" >/tmp/fly-llm-auth-partial.log 2>&1; then
  flags+=(ARIA_ALLOW_PARTIAL_LLM_E2E=1)
  echo "NOTE: Fly LLM auth dead/absent — ARIA_ALLOW_PARTIAL_LLM_E2E=1 (critics soft-fail only)"
  tail -n 8 /tmp/fly-llm-auth-partial.log || true
else
  echo "NOTE: Fly LLM auth ok — critics path stays strict under PARTIAL M365"
fi
case "$deploy_status" in
  tip_live) ;;
  confirm_ready_run_golive)
    flags+=(ARIA_ALLOW_STALE_FLY_E2E=1)
    echo "NOTE: deploy confirm matches tip but Fly is not live yet — run:"
    echo "      bash scripts/fly-enterprise-golive-when-ready.sh"
    if [ -n "$live_mig" ] && [ -n "$tip_mig" ] && [ "$live_mig" != "$tip_mig" ]; then
      echo "      migration pending: live ${live_mig} → tip ${tip_mig}"
    fi
    echo "      (keep ARIA_ALLOW_STALE_FLY_E2E=1 until /api/ready build = tip)"
    ;;
  *)
    flags+=(ARIA_ALLOW_STALE_FLY_E2E=1)
    if [ "$confirm_present" = "yes" ] && [ -n "$confirm_sha" ] && [ "$confirm_sha" != "$tip_sha" ]; then
      echo "NOTE: /tmp/owner-deploy-confirm.env pins ${confirm_sha:0:12} — remint for tip ${tip_sha:0:12}:"
    else
      echo "NOTE: live Fly lags tip — owner deploy confirm required:"
    fi
    echo "      bash scripts/print-fly-deploy-confirm.sh → /tmp/owner-deploy-confirm.env"
    if [ -n "$live_mig" ] && [ -n "$tip_mig" ] && [ "$live_mig" != "$tip_mig" ]; then
      echo "      migration pending: live ${live_mig} → tip ${tip_mig}"
    fi
    echo "      bash scripts/fly-enterprise-golive-when-ready.sh"
    ;;
esac

echo "Running: ${flags[*]} bash e2e-workflow-test.sh"
echo
env "${flags[@]}" bash "$repo/e2e-workflow-test.sh"
rc=$?

if [ "$deploy_status" != "tip_live" ]; then
  echo
  echo "After owner golive (deploy_status=tip_live): rerun this script — drop stale flag; step 3c should PASS with provenance=live."
fi
exit "$rc"
