#!/usr/bin/env bash
# print-m365-owner-portal-checklist.sh — Fly M365 owner steps when az cannot create apps.
#
# Prints tenant-specific Azure Portal URLs and exact redirect URIs for
# aria-mantu-app.fly.dev. Does NOT print or invent secrets.
#
# Usage:
#   bash scripts/print-m365-owner-portal-checklist.sh
#   export ARIA_AZURE_APP_ID='<client-id-from-portal>'
#   bash scripts/az-configure-existing-graph-app.sh --apply
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TENANT_ID="${AZURE_TENANT_ID:-}"
ACCOUNT=""
if command -v az >/dev/null 2>&1 && az account show >/dev/null 2>&1; then
  TENANT_ID="${TENANT_ID:-$(az account show --query tenantId -o tsv)}"
  ACCOUNT="$(az account show --query user.name -o tsv 2>/dev/null || true)"
fi
TENANT_ID="${TENANT_ID:-PLACEHOLDER_TENANT_ID}"
APP_REDIRECT="https://aria-mantu-app.fly.dev/auth/microsoft/callback"
GOTRUE_REDIRECT="https://aria-mantu-kong.fly.dev/auth/v1/callback"
PORTAL_APPS="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
PORTAL_NEW="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false"

cat <<EOF
# M365 owner unblock — Fly production (aria-mantu-app.fly.dev)

Tenant: ${TENANT_ID}
Signed-in az account: ${ACCOUNT:-'(az not logged in)'}

## Why this is needed

Fly is missing 6 secrets:
  aria-mantu-app: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
  aria-mantu-auth: GOTRUE_EXTERNAL_AZURE_* (4)

Without them: no Outlook connect, no Graph push intake, no Entra SSO, no confirmLive Teams book.

The cloud agent account cannot create app registrations (Insufficient privileges).
Owner must create OR designate an existing app, then run configure + apply scripts.

## Portal steps (Option A — create app)

1. Open: ${PORTAL_NEW}
2. Name: ARIA Mantu Graph (Fly)
3. Supported account types: Single tenant
4. Redirect URI (Web):
   - ${APP_REDIRECT}
   - ${GOTRUE_REDIRECT}
5. Register → copy **Application (client) ID**
6. Certificates & secrets → New client secret → copy value once
7. API permissions → Add Microsoft Graph **Application** permissions (admin consent):
   - Mail.Read (or Mail.ReadWrite if using shared mailbox)
   - Mail.Send
   - Calendars.ReadWrite
   - OnlineMeetings.ReadWrite
   - User.Read.All (if resolving mailboxes)
   Plus **Delegated** if users sign in via OAuth connect flow:
   - Mail.Read, Mail.Send, Calendars.ReadWrite, offline_access, openid, profile
8. Grant admin consent for the tenant

## Agent/owner commands (after portal)

export ARIA_AZURE_APP_ID='<paste-client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
# writes /tmp/owner-microsoft.env and runs fly-apply-owner-microsoft-secrets.sh

## Option B — paste env file

cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# fill MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_* 
bash scripts/fly-apply-owner-microsoft-secrets.sh

## Redeploy (Entra SSO build flag)

bash scripts/print-fly-deploy-confirm.sh
# export ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM
bash scripts/fly-deploy-now.sh

## Verify on Fly

curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
bash scripts/print-fly-missing-secrets.sh   # expect 0 MISSING for MICROSOFT_* + GOTRUE_EXTERNAL_AZURE_*
# Settings → Connect Outlook (mode=live) → Enable Graph webhook
bash scripts/verify-m365-ready.sh
# → RESULT: PASS (no ARIA_ALLOW_PARTIAL_*); proves confirmLive Teams joinUrl

Existing apps portal: ${PORTAL_APPS}

EOF
