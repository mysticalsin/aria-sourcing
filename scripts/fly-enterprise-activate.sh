#!/usr/bin/env bash
# fly-enterprise-activate.sh — read-only owner checklist for Mantu enterprise golive.
#
# Runs preflight probes, prints deploy + E2E one-liners, exits 1 when blockers remain.
# Does NOT deploy, mutate Fly secrets, or run live E2E.
#
# Usage:
#   bash scripts/fly-enterprise-activate.sh [release_sha]
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
RELEASE_SHA="${1:-$(git rev-parse HEAD)}"
blockers=0

note_blocker() {
  echo "BLOCKER: $*"
  blockers=$((blockers + 1))
}

echo "=== Mantu enterprise activation (read-only) ==="
echo "  release SHA: $RELEASE_SHA"
echo

bash "$repo/scripts/fly-golive-mantu-e2e.sh" "$RELEASE_SHA" || blockers=$((blockers + 1))

echo "=== Deploy one-liner ==="
bash "$repo/scripts/print-fly-deploy-confirm.sh"
echo

echo "=== E2E env template ==="
bash "$repo/scripts/print-fly-e2e-env.sh"
echo

if [ -z "${ARIA_PROD_DEPLOY_CONFIRM:-}" ]; then
  note_blocker "ARIA_PROD_DEPLOY_CONFIRM unset in this shell — owner must export before fly-deploy-now.sh"
fi

if [ "$blockers" -gt 0 ]; then
  echo
  echo "Activation incomplete ($blockers blocker(s)). Fix items above, then re-run."
  exit 1
fi

echo "Preflight green in this shell — proceed with deploy + live E2E."
exit 0
