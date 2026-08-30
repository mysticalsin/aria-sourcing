#!/usr/bin/env bash
# run-enterprise-e2e-partial.sh — Fly enterprise E2E with honest PARTIAL flags.
#
# Default (owner Microsoft deferred): ARIA_ALLOW_PARTIAL_M365_E2E=1 only.
# Runs live drafts + multi-agent critics/approve. Do NOT auto-skip approve or
# soft-fail LLM just because Fly *env* LLM keys are dead — workspace vault /
# Hermes cloud failover still powers /api/hermes/chat and critics.
#
# Opt-in (explicit):
#   ARIA_ALLOW_SKIP_APPROVE_E2E=1   — skip steps 4–5 (short path)
#   ARIA_ALLOW_PARTIAL_LLM_E2E=1    — critics soft-fail
#   ARIA_ALLOW_CANNED_DRAFT_E2E=1   — canned outreach drafts
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
llm_auth="$(echo "$golive_out" | awk -F= '/^llm_auth=/{print $2}')"
echo

eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export)"

# Owner-deferred Microsoft only. Approve/critics stay strict by default.
flags=(ARIA_ALLOW_PARTIAL_M365_E2E=1)

if [ "${ARIA_ALLOW_SKIP_APPROVE_E2E:-}" = "1" ]; then
  flags+=(ARIA_ALLOW_SKIP_APPROVE_E2E=1)
  echo "NOTE: ARIA_ALLOW_SKIP_APPROVE_E2E=1 — skipping approve/send (explicit opt-in)"
fi

# Never auto-soften LLM from Fly env probe alone (vault/failover may still work).
if [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ] || [ "${ARIA_ALLOW_CANNED_DRAFT_E2E:-}" = "1" ]; then
  [ "${ARIA_ALLOW_PARTIAL_LLM_E2E:-}" = "1" ] && flags+=(ARIA_ALLOW_PARTIAL_LLM_E2E=1)
  [ "${ARIA_ALLOW_CANNED_DRAFT_E2E:-}" = "1" ] && flags+=(ARIA_ALLOW_CANNED_DRAFT_E2E=1)
  echo "NOTE: explicit LLM soft-fail/canned flags requested"
elif [ "$llm_auth" = "dead" ] || [ "$llm_auth" = "absent" ]; then
  echo "NOTE: Fly env llm_auth=${llm_auth} — still attempting live drafts/critics via vault/failover"
  echo "      (set ARIA_ALLOW_PARTIAL_LLM_E2E=1 ARIA_ALLOW_CANNED_DRAFT_E2E=1 only if that path regresses)"
fi

case "$deploy_status" in
  tip_live|tip_ahead_docs)
    # tip_ahead_docs: app SHA on Fly matches last app commit; only _relay/docs tip-ahead — not stale.
    if [ "$deploy_status" = "tip_ahead_docs" ]; then
      echo "NOTE: tip_ahead_docs — Fly app matches live app tip; docs/_relay tip-ahead does not need redeploy"
    fi
    ;;
  tip_ahead_app)
    flags+=(ARIA_ALLOW_STALE_FLY_E2E=1)
    echo "NOTE: tip_ahead_app — live Fly lags tip on app/migration changes; remint + deploy:"
    echo "      bash scripts/print-fly-deploy-confirm.sh → /tmp/owner-deploy-confirm.env"
    if [ -n "$live_mig" ] && [ -n "$tip_mig" ] && [ "$live_mig" != "$tip_mig" ]; then
      echo "      migration pending: live ${live_mig} → tip ${tip_mig}"
    fi
    echo "      bash scripts/fly-enterprise-golive-when-ready.sh"
    ;;
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

if [ "$deploy_status" != "tip_live" ] && [ "$deploy_status" != "tip_ahead_docs" ]; then
  echo
  echo "After owner golive (deploy_status=tip_live): rerun this script — drop stale flag; step 3c should PASS with provenance=live."
fi
exit "$rc"
