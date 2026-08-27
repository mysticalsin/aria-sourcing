#!/usr/bin/env bash
# fly-enterprise-golive-when-ready.sh — one-shot unblock once owner secrets exist.
#
# Safe to run on a timer. Does NOT invent Azure credentials or deploy confirm.
#
# Steps:
#   1) If owner-microsoft drop-zone/env present → fly-apply-owner-microsoft-secrets.sh
#   2) If ARIA_PROD_DEPLOY_CONFIRM already exported → fly-deploy-now.sh
#   3) Else print missing inventory + deploy confirm template + stop
#   4) After tip deploy (caller re-runs): probe ready + Graph; print E2E one-liner
#
# Usage:
#   bash scripts/fly-enterprise-golive-when-ready.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
TIP="$(git rev-parse HEAD)"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi

has_drop=0
for f in /tmp/owner-microsoft.env "$repo/production-readiness/.owner-microsoft.env"; do
  if [ -r "$f" ]; then
    has_drop=1
    break
  fi
done

if [ "$has_drop" = "1" ] || { [ -n "${MICROSOFT_CLIENT_ID:-}" ] && [ -n "${MICROSOFT_CLIENT_SECRET:-}" ]; }; then
  echo "=== Applying owner Microsoft / Entra secrets ==="
  bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
else
  echo "=== No owner Microsoft drop-zone / env yet ==="
  echo "    Fill /tmp/owner-microsoft.env from production-readiness/.owner-microsoft.env.example"
fi

echo
bash "$repo/scripts/print-fly-missing-secrets.sh" || true
echo

if [ -n "${ARIA_PROD_DEPLOY_CONFIRM:-}" ]; then
  echo "=== ARIA_PROD_DEPLOY_CONFIRM present — deploying tip $TIP ==="
  export ARIA_RELEASE_SHA="${ARIA_RELEASE_SHA:-$TIP}"
  bash "$repo/scripts/fly-deploy-now.sh"
else
  echo "=== Deploy confirm unset — not deploying (will not invent confirm) ==="
  bash "$repo/scripts/print-fly-deploy-confirm.sh"
fi

echo
echo "=== Live probes ==="
ready="$(curl -sS -m 25 "$APP_URL/api/ready" || echo '{}')"
echo "$ready" | jq -c '{ok,status,build,migration}' 2>/dev/null || echo "$ready"
graph_code="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "$APP_URL/api/webhooks/microsoft-graph?validationToken=ping" || echo 000)"
echo "Graph validationToken HTTP=$graph_code (want 200)"

ok="$(echo "$ready" | jq -r '.ok // false' 2>/dev/null || echo false)"
mig="$(echo "$ready" | jq -r '.migration // empty' 2>/dev/null || true)"
build="$(echo "$ready" | jq -r '.build // empty' 2>/dev/null || true)"
mig_ok=0
case "$mig" in
  0066_*|006[7-9]_*|00[7-9][0-9]_*|0[1-9][0-9][0-9]_*) mig_ok=1 ;;
esac

if [ "$ok" = "true" ] && [ "$mig_ok" = "1" ] && [[ "$build" == "$TIP"* ]] && [ "$graph_code" = "200" ]; then
  echo
  echo "=== Tip live — run E2E ==="
  echo "eval \"\$(bash scripts/print-fly-e2e-env.sh --export)\""
  echo "bash e2e-workflow-test.sh"
  exit 0
fi

echo
echo "Still blocked for live E2E PASS (need secrets + confirm + Outlook webhook after tip)."
exit 1
