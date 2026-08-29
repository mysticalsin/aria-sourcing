#!/usr/bin/env bash
# fly-m365-from-azure-app-id.sh — one-shot after owner creates an Entra app.
#
# Owner only needs to Register an empty single-tenant app and drop the client id:
#   echo '<application-client-id>' > /tmp/owner-azure-app-id
#   # or: export ARIA_AZURE_APP_ID='...'
#
# This script configures redirects + Graph delegated perms, mints a client secret,
# writes /tmp/owner-microsoft.env, applies Fly Graph secrets, and probes microsoftOAuth.
#
# Usage:
#   bash scripts/fly-m365-from-azure-app-id.sh
#   ARIA_AZURE_APP_ID=... bash scripts/fly-m365-from-azure-app-id.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

# shellcheck source=scripts/lib/owner-microsoft-credentials.sh
source "$repo/scripts/lib/owner-microsoft-credentials.sh"

APP_ID="${ARIA_AZURE_APP_ID:-}"
if [ -z "$APP_ID" ] && owner_ms_read_azure_app_id >/dev/null; then
  APP_ID="$(owner_ms_read_azure_app_id)"
fi
if [ -z "$APP_ID" ]; then
  echo "ERROR: set ARIA_AZURE_APP_ID or write a GUID to /tmp/owner-azure-app-id" >&2
  echo "  bash scripts/print-m365-owner-portal-checklist.sh" >&2
  exit 1
fi
if owner_ms_is_placeholder "$APP_ID"; then
  echo "ERROR: Azure app id looks synthetic/placeholder — refuse." >&2
  exit 4
fi

export ARIA_AZURE_APP_ID="$APP_ID"
echo "=== Configure existing Entra app + apply Graph secrets to Fly ==="
echo "  ARIA_AZURE_APP_ID=${APP_ID}"
bash "$repo/scripts/az-configure-existing-graph-app.sh" --apply

echo
echo "=== Probe microsoftOAuth honesty ==="
bash "$repo/scripts/probe-m365-unblock.sh"
echo
echo "Next (human): Settings → Connect Outlook (mode=live)"
echo "  Callback auto-wires Graph webhook when Calendars.ReadWrite + OnlineMeetings.ReadWrite are granted."
echo "Then: bash scripts/verify-m365-ready.sh"
echo "  (fly-apply already polls up to ARIA_WAIT_LIVE_SEAT_SECONDS=${ARIA_WAIT_LIVE_SEAT_SECONDS:-1800}s for the live seat)"
