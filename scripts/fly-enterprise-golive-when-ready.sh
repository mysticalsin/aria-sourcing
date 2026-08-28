#!/usr/bin/env bash
# fly-enterprise-golive-when-ready.sh — one-shot unblock once owner secrets exist.
#
# Safe to run on a timer. Does NOT invent Azure credentials or deploy confirm.
#
# Steps:
#   1) If az logged in and no drop-zone → az-create-mantu-graph-app.sh (mint + write drop-zone)
#   2) If owner-microsoft drop-zone/env present → fly-apply-owner-microsoft-secrets.sh
#   3) If ARIA_PROD_DEPLOY_CONFIRM already exported → fly-deploy-now.sh
#   4) Else print missing inventory + deploy confirm template + stop
#   5) After tip deploy (caller re-runs): probe ready + Graph; print E2E one-liner
#
# Also: bash scripts/fly-wait-entra-and-golive.sh  # long-poll Entra then golive
# Usage:
#   bash scripts/fly-enterprise-golive-when-ready.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
TIP="$(git rev-parse HEAD)"

echo "=== Golive status (tip vs live vs confirm) ==="
bash "$repo/scripts/print-fly-golive-status.sh"
echo

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi

# Optional owner drop-zone for deploy confirm (never invent; never commit).
# File may contain ARIA_PROD_DEPLOY_CONFIRM=... and optional ARIA_RELEASE_SHA=...
load_deploy_confirm_drop() {
  local path="$1"
  [ -r "$path" ] || return 0
  echo "Loading deploy confirm from $path (value not printed)"
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}
load_deploy_confirm_drop "/tmp/owner-deploy-confirm.env"
load_deploy_confirm_drop "$repo/production-readiness/.owner-deploy-confirm.env"

has_drop=0
for f in /tmp/owner-microsoft.env "$repo/production-readiness/.owner-microsoft.env"; do
  if [ -r "$f" ] && ! grep -q 'PLACEHOLDER' "$f" 2>/dev/null; then
    has_drop=1
    break
  fi
done

# If Azure CLI is authenticated and drop-zone is absent, mint the Entra app
# (requires owner device-login; never invents client secrets locally).
if [ "$has_drop" = "0" ] && command -v az >/dev/null 2>&1 && az account show >/dev/null 2>&1; then
  echo "=== az logged in — creating/reusing Mantu Graph Entra app → drop-zone ==="
  bash "$repo/scripts/az-create-mantu-graph-app.sh" || {
    echo "WARN: az-create-mantu-graph-app.sh failed (need app-registration rights)." >&2
  }
  if [ -r /tmp/owner-microsoft.env ] && ! grep -q 'PLACEHOLDER' /tmp/owner-microsoft.env 2>/dev/null; then
    has_drop=1
  fi
fi

if [ "$has_drop" = "1" ] || { [ -n "${MICROSOFT_CLIENT_ID:-}" ] && [ -n "${MICROSOFT_CLIENT_SECRET:-}" ]; }; then
  echo "=== Applying owner Microsoft / Entra secrets ==="
  bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
else
  echo "=== No owner Microsoft drop-zone / env yet ==="
  echo "    Option A: az login --use-device-code  then re-run this script"
  echo "    Option B: fill /tmp/owner-microsoft.env from production-readiness/.owner-microsoft.env.example"
fi

echo
bash "$repo/scripts/print-fly-missing-secrets.sh" || true
echo

if [ -n "${ARIA_PROD_DEPLOY_CONFIRM:-}" ]; then
  case "${ARIA_PROD_DEPLOY_CONFIRM}" in
    ""|PLACEHOLDER*|placeholder*)
      echo "=== Deploy confirm is PLACEHOLDER — refusing (will not invent) ==="
      bash "$repo/scripts/print-fly-deploy-confirm.sh"
      ;;
    *)
      # Always deploy the checked-out tip. A stale ARIA_RELEASE_SHA from the
      # shell/Cursor secrets (e.g. an unrelated prior commit) must not pin deploy.
      export ARIA_RELEASE_SHA="$TIP"
      if [[ "${ARIA_PROD_DEPLOY_CONFIRM}" != *":${TIP}:"* ]]; then
        echo "=== Deploy confirm does not encode tip $TIP — refusing ==="
        echo "    Re-print with: bash scripts/print-fly-deploy-confirm.sh"
        bash "$repo/scripts/print-fly-deploy-confirm.sh"
      else
        echo "=== ARIA_PROD_DEPLOY_CONFIRM present — deploying tip $TIP ==="
        bash "$repo/scripts/fly-deploy-now.sh"
      fi
      ;;
  esac
else
  echo "=== Deploy confirm unset — not deploying (will not invent confirm) ==="
  echo "    Option: write /tmp/owner-deploy-confirm.env from print-fly-deploy-confirm.sh output"
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
  echo "=== Tip live — next ==="
  echo "# 1) Settings → Connect Outlook (mode=live) → Enable Graph webhook"
  echo "# 2) Strict full PASS (secrets + live seat + webhook preflight, no partial flags):"
  echo "bash scripts/verify-m365-ready.sh"
  echo "# Honest PARTIAL only while Outlook seat still missing:"
  echo "bash scripts/run-enterprise-e2e-partial.sh"
  exit 0
fi

echo
echo "Still blocked for live E2E PASS (need secrets + confirm + Outlook webhook after tip)."
bash "$repo/scripts/print-fly-golive-status.sh"
exit 1
