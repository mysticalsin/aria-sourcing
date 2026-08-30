#!/usr/bin/env bash
# az-create-mantu-graph-app.sh — create Entra app registration for Fly Mantu
# Graph (Outlook/Teams) + GoTrue Azure SSO, then write /tmp/owner-microsoft.env.
#
# Requires: `az login` already completed with an account that can create app
# registrations in the target tenant. Does NOT invent credentials; minting is
# done by Azure after authenticated owner login.
#
# Usage:
#   az login --use-device-code
#   bash scripts/az-create-mantu-graph-app.sh
#   # writes /tmp/owner-microsoft.env (mode 600; never commit)
#   bash scripts/az-create-mantu-graph-app.sh --apply   # also fly-apply-owner-microsoft-secrets.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APPLY=0
OUT="${OWNER_MICROSOFT_ENV:-/tmp/owner-microsoft.env}"
DISPLAY_NAME="${ARIA_AZURE_APP_NAME:-ARIA Mantu Graph (Fly)}"
APP_REDIRECT="${MICROSOFT_REDIRECT_URI:-https://aria-mantu-app.fly.dev/auth/microsoft/callback}"
GOTRUE_REDIRECT="${GOTRUE_AZURE_REDIRECT_URI:-https://aria-mantu-kong.fly.dev/auth/v1/callback}"

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --out=*) OUT="${arg#--out=}" ;;
    -h|--help)
      sed -n '2,16p' "$0"
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

if ! az account show >/dev/null 2>&1; then
  echo "ERROR: az is not logged in. Run: az login --use-device-code" >&2
  exit 1
fi

if [ -n "${ARIA_AZURE_APP_ID:-}" ]; then
  exec bash "$repo/scripts/az-configure-existing-graph-app.sh" "$@"
fi

# shellcheck source=scripts/lib/az-mantu-graph-permissions.sh
source "$repo/scripts/lib/az-mantu-graph-permissions.sh"

TENANT_ID="$(az account show --query tenantId -o tsv)"
ACCOUNT_UPN="$(az account show --query user.name -o tsv 2>/dev/null || echo unknown)"
echo "Azure tenant=$TENANT_ID account=$ACCOUNT_UPN"
echo "Creating app registration: $DISPLAY_NAME"
echo "  Web redirects: $APP_REDIRECT"
echo "                 $GOTRUE_REDIRECT"

# Reuse existing app with the same display name if present (idempotent-ish).
EXISTING_APP_ID="$(az ad app list --display-name "$DISPLAY_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)"
if [ -n "${EXISTING_APP_ID:-}" ] && [ "$EXISTING_APP_ID" != "null" ]; then
  echo "Reusing existing appId=$EXISTING_APP_ID"
  APP_ID="$EXISTING_APP_ID"
  OBJECT_ID="$(az ad app show --id "$APP_ID" --query id -o tsv)"
  az ad app update --id "$APP_ID" \
    --web-redirect-uris "$APP_REDIRECT" "$GOTRUE_REDIRECT" \
    --enable-id-token-issuance true \
    >/dev/null
else
  set +e
  CREATE_ERR="$(az ad app create \
    --display-name "$DISPLAY_NAME" \
    --sign-in-audience AzureADMyOrg \
    --web-redirect-uris "$APP_REDIRECT" "$GOTRUE_REDIRECT" \
    --enable-id-token-issuance true \
    -o json 2>&1)"
  CREATE_RC=$?
  set -e
  if [ "$CREATE_RC" -ne 0 ]; then
    printf '%s\n' "$CREATE_ERR" >&2
    if printf '%s' "$CREATE_ERR" | grep -qiE 'Insufficient privileges|Authorization_RequestDenied|Directory permission is needed'; then
      echo "ERROR: this Entra account cannot create app registrations." >&2
      echo "       Tenant policy allowedToCreateApps=false — Portal New registration fails for" >&2
      echo "       this non-privileged user too. An Entra admin must act:" >&2
      echo "       Option A: Entra admin registers ARIA Mantu Graph (Fly), then:" >&2
      echo "         echo '<client-id>' > /tmp/owner-azure-app-id" >&2
      echo "         bash scripts/probe-m365-unblock.sh --apply" >&2
      echo "       Option B: paste MICROSOFT_CLIENT_ID/SECRET into /tmp/owner-microsoft.env" >&2
      echo "       Option C: grant Application Developer (or App Admin) to this account; waiters" >&2
      echo "         expire noperm ~5m and re-run az-create automatically." >&2
      echo "       Checklist: bash scripts/print-m365-owner-portal-checklist.sh" >&2
      touch /tmp/az-create-mantu-graph-app.noperm
      exit 3
    fi
    exit 1
  fi
  APP_ID="$(printf '%s' "$CREATE_ERR" | jq -r .appId)"
  OBJECT_ID="$(printf '%s' "$CREATE_ERR" | jq -r .id)"
  echo "Created appId=$APP_ID objectId=$OBJECT_ID"
  rm -f /tmp/az-create-mantu-graph-app.noperm
fi

# Microsoft Graph application id — delegated permissions via shared helper
apply_mantu_graph_delegated_permissions "$APP_ID"

echo "Creating client secret (shown once; written only to drop-zone)…"
SECRET_JSON="$(az ad app credential reset --id "$APP_ID" --append --display-name "aria-fly-$(date -u +%Y%m%d)" --years 1 -o json)"
CLIENT_SECRET="$(printf '%s' "$SECRET_JSON" | jq -r .password)"
if [ -z "$CLIENT_SECRET" ] || [ "$CLIENT_SECRET" = "null" ]; then
  echo "ERROR: Azure did not return a client secret" >&2
  exit 1
fi

write_owner_microsoft_env "$OUT" "$TENANT_ID" "$ACCOUNT_UPN" "$APP_ID" "$CLIENT_SECRET" "$APP_REDIRECT"
echo "Wrote drop-zone $OUT (mode 600; values not printed)"
echo "  MICROSOFT_CLIENT_ID=$APP_ID"
echo "  GOTRUE_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/${TENANT_ID}/v2.0"

if [ "$APPLY" = "1" ]; then
  echo "Applying to Fly…"
  bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
fi

echo
echo "Next:"
echo "  bash scripts/print-fly-deploy-confirm.sh   # owner exports ARIA_PROD_DEPLOY_CONFIRM"
echo "  bash scripts/fly-enterprise-golive-when-ready.sh"
