#!/usr/bin/env bash
# az-configure-existing-graph-app.sh — configure an EXISTING Entra app for Fly Mantu
# Graph (Outlook/Teams) + GoTrue Azure SSO, then write /tmp/owner-microsoft.env.
#
# Use when the signed-in account cannot create app registrations but CAN update an
# app the owner created in Azure Portal (or owns).
#
# Usage:
#   az login --use-device-code
#   export ARIA_AZURE_APP_ID='<app-client-id-from-portal>'
#   bash scripts/az-configure-existing-graph-app.sh
#   bash scripts/az-configure-existing-graph-app.sh --apply
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APPLY=0
OUT="${OWNER_MICROSOFT_ENV:-/tmp/owner-microsoft.env}"
APP_ID="${ARIA_AZURE_APP_ID:-}"
APP_REDIRECT="${MICROSOFT_REDIRECT_URI:-https://aria-mantu-app.fly.dev/auth/microsoft/callback}"
GOTRUE_REDIRECT="${GOTRUE_AZURE_REDIRECT_URI:-https://aria-mantu-kong.fly.dev/auth/v1/callback}"

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --out=*) OUT="${arg#--out=}" ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

command -v az >/dev/null 2>&1 || { echo "az CLI required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }
# shellcheck source=scripts/lib/az-mantu-graph-permissions.sh
source "$repo/scripts/lib/az-mantu-graph-permissions.sh"

if ! az account show >/dev/null 2>&1; then
  echo "ERROR: az is not logged in. Run: az login --use-device-code" >&2
  exit 1
fi

if [ -z "$APP_ID" ]; then
  echo "ERROR: set ARIA_AZURE_APP_ID to an existing Entra application (client) id." >&2
  echo "       Create one in Azure Portal → App registrations, then re-run." >&2
  exit 1
fi

TENANT_ID="$(az account show --query tenantId -o tsv)"
ACCOUNT_UPN="$(az account show --query user.name -o tsv 2>/dev/null || echo unknown)"
DISPLAY_NAME="$(az ad app show --id "$APP_ID" --query displayName -o tsv 2>/dev/null || true)"
if [ -z "$DISPLAY_NAME" ] || [ "$DISPLAY_NAME" = "null" ]; then
  echo "ERROR: ARIA_AZURE_APP_ID=$APP_ID not found or not readable in tenant $TENANT_ID" >&2
  exit 1
fi

echo "Azure tenant=$TENANT_ID account=$ACCOUNT_UPN"
echo "Configuring existing app: $DISPLAY_NAME ($APP_ID)"
echo "  Web redirects: $APP_REDIRECT"
echo "                 $GOTRUE_REDIRECT"

if ! az ad app update --id "$APP_ID" \
  --web-redirect-uris "$APP_REDIRECT" "$GOTRUE_REDIRECT" \
  --enable-id-token-issuance true \
  >/dev/null 2>&1; then
  echo "ERROR: cannot update app $APP_ID (need Application.ReadWrite.OwnedBy or admin on this app)." >&2
  exit 3
fi

apply_mantu_graph_delegated_permissions "$APP_ID"

echo "Creating client secret (append; written only to drop-zone)…"
set +e
SECRET_JSON="$(az ad app credential reset --id "$APP_ID" --append --display-name "aria-fly-$(date -u +%Y%m%d)" --years 1 -o json 2>&1)"
SECRET_RC=$?
set -e
if [ "$SECRET_RC" -ne 0 ]; then
  printf '%s\n' "$SECRET_JSON" >&2
  echo "ERROR: cannot mint client secret on app $APP_ID — paste MICROSOFT_CLIENT_SECRET into /tmp/owner-microsoft.env manually." >&2
  exit 4
fi
CLIENT_SECRET="$(printf '%s' "$SECRET_JSON" | jq -r .password)"
if [ -z "$CLIENT_SECRET" ] || [ "$CLIENT_SECRET" = "null" ]; then
  echo "ERROR: Azure did not return a client secret" >&2
  exit 1
fi

write_owner_microsoft_env "$OUT" "$TENANT_ID" "$ACCOUNT_UPN" "$APP_ID" "$CLIENT_SECRET" "$APP_REDIRECT"
rm -f /tmp/az-create-mantu-graph-app.noperm
echo "Wrote drop-zone $OUT (mode 600; values not printed)"
echo "  MICROSOFT_CLIENT_ID=$APP_ID"
echo "  GOTRUE_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/${TENANT_ID}/v2.0"

if [ "$APPLY" = "1" ]; then
  echo "Applying to Fly…"
  bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
fi

echo
echo "Next:"
echo "  bash scripts/fly-apply-owner-microsoft-secrets.sh   # if not --apply"
echo "  bash scripts/print-fly-deploy-confirm.sh"
echo "  bash scripts/fly-enterprise-golive-when-ready.sh"
