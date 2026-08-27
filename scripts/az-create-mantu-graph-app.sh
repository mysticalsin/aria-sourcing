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
      echo "       Paste MICROSOFT_CLIENT_ID/SECRET (or /tmp/owner-microsoft.env), or grant" >&2
      echo "       Application.ReadWrite.All / cloud-app-admin and re-run." >&2
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

# Microsoft Graph application id
GRAPH_API="00000003-0000-0000-c000-000000000000"
# Delegated (Scope) permission IDs
# openid, email, profile, offline_access, User.Read, Mail.Read, Mail.Send, Calendars.ReadWrite
PERM_IDS=(
  "37f7f235-527c-4136-accd-4a02d197975b=Scope" # openid
  "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0=Scope" # email
  "14dad69e-099b-42c9-810b-d002981feec1=Scope" # profile
  "7427e0e9-2fdb-4417-809c-591378161370=Scope" # offline_access
  "e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope" # User.Read
  "570282fd-fa5c-430d-a7fd-fc8dc98a9dca=Scope" # Mail.Read
  "e383f46e-2787-4529-855e-0e479a3ffac0=Scope" # Mail.Send
  "1ec239c2-d7c9-4623-a91a-a9775856bb36=Scope" # Calendars.ReadWrite
)

echo "Ensuring Graph delegated permissions…"
# Clear+re-add is noisy; add is idempotent enough (duplicates ignored by Azure in many tenants).
az ad app permission add --id "$APP_ID" --api "$GRAPH_API" \
  --api-permissions "${PERM_IDS[@]}" >/dev/null 2>&1 || true

# Best-effort admin consent (may fail without Global Admin — owner can grant in portal).
if az ad app permission admin-consent --id "$APP_ID" >/dev/null 2>&1; then
  echo "Admin consent granted."
else
  echo "WARN: admin-consent failed (needs privileged Entra role). Grant in Azure Portal → API permissions."
fi

# Ensure a service principal exists (needed for consent in some tenants).
az ad sp create --id "$APP_ID" >/dev/null 2>&1 || true

echo "Creating client secret (shown once; written only to drop-zone)…"
SECRET_JSON="$(az ad app credential reset --id "$APP_ID" --append --display-name "aria-fly-$(date -u +%Y%m%d)" --years 1 -o json)"
CLIENT_SECRET="$(printf '%s' "$SECRET_JSON" | jq -r .password)"
if [ -z "$CLIENT_SECRET" ] || [ "$CLIENT_SECRET" = "null" ]; then
  echo "ERROR: Azure did not return a client secret" >&2
  exit 1
fi

umask 077
cat > "$OUT" <<EOF
# Generated by scripts/az-create-mantu-graph-app.sh — NEVER commit
# tenant=$TENANT_ID account=$ACCOUNT_UPN created=$(date -u +%Y-%m-%dT%H:%MZ)
MICROSOFT_CLIENT_ID=$APP_ID
MICROSOFT_CLIENT_SECRET=$CLIENT_SECRET
MICROSOFT_REDIRECT_URI=$APP_REDIRECT
GOTRUE_EXTERNAL_AZURE_ENABLED=true
GOTRUE_EXTERNAL_AZURE_CLIENT_ID=$APP_ID
GOTRUE_EXTERNAL_AZURE_SECRET=$CLIENT_SECRET
GOTRUE_EXTERNAL_AZURE_URL=https://login.microsoftonline.com/${TENANT_ID}/v2.0
EOF
chmod 600 "$OUT"
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
