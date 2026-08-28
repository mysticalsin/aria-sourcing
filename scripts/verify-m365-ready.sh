#!/usr/bin/env bash
# verify-m365-ready.sh — after owner applies M365 secrets + Connect Outlook.
#
# Checks Fly secret inventory, live microsoftOAuth, Graph seat, then runs
# strict enterprise E2E with NO partial flags.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

echo "=== 1) Fly secret inventory (names only) ==="
missing=0
for name in MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI DATA_ENCRYPTION_KEY; do
  if flyctl secrets list -a aria-mantu-app 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
    echo "  OK  aria-mantu-app $name"
  else
    echo "  MISSING aria-mantu-app $name"
    missing=1
  fi
done
for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
  if flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
    echo "  OK  aria-mantu-auth $name"
  else
    echo "  MISSING aria-mantu-auth $name"
    missing=1
  fi
done
if [ "$missing" = "1" ]; then
  echo "ERROR: apply secrets first — see _relay/M365-OWNER-UNBLOCK.md" >&2
  exit 2
fi

echo
echo "=== 2) Live ready ==="
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'

echo
echo "=== 3) Strict enterprise E2E (no partial flags) ==="
echo "NOTE: Connect Outlook (mode=live) + Enable webhook must already be done in Settings."
eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export)"
unset ARIA_ALLOW_PARTIAL_M365_E2E ARIA_ALLOW_SKIP_APPROVE_E2E ARIA_ALLOW_STALE_FLY_E2E || true
bash "$repo/e2e-workflow-test.sh"
