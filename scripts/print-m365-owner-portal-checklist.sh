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
SUB_NAME=""
if command -v az >/dev/null 2>&1 && az account show >/dev/null 2>&1; then
  # Prefer Mantu Group Sandbox when available (correct Entra tenant for Fly Mantu).
  if az account list --query "[?tenantId=='ce57ebe3-a63d-4708-b5cf-c274b48bd26c'].id | [0]" -o tsv 2>/dev/null | grep -q .; then
    az account set --subscription "$(az account list --query "[?tenantId=='ce57ebe3-a63d-4708-b5cf-c274b48bd26c'].id | [0]" -o tsv)" >/dev/null 2>&1 || true
  fi
  TENANT_ID="${TENANT_ID:-$(az account show --query tenantId -o tsv)}"
  ACCOUNT="$(az account show --query user.name -o tsv 2>/dev/null || true)"
  SUB_NAME="$(az account show --query name -o tsv 2>/dev/null || true)"
fi
# Canonical Mantu Entra tenant for Fly production (do not use BAW SAS by accident).
TENANT_ID="${TENANT_ID:-ce57ebe3-a63d-4708-b5cf-c274b48bd26c}"
APP_REDIRECT="https://aria-mantu-app.fly.dev/auth/microsoft/callback"
GOTRUE_REDIRECT="https://aria-mantu-kong.fly.dev/auth/v1/callback"
PORTAL_APPS="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
PORTAL_NEW="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false"
PORTAL_NEW_TENANT="https://portal.azure.com/${TENANT_ID}/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false"

cat <<EOF
# M365 owner unblock — Fly production (aria-mantu-app.fly.dev)

Tenant: ${TENANT_ID}  (Mantu Group Sandbox — NOT BAW SAS)
Subscription: ${SUB_NAME:-'(unknown)'}
Signed-in az account: ${ACCOUNT:-'(az not logged in)'}

## Why this is needed

Graph secrets required for E2E PASS (Outlook connect + Graph webhook + confirmLive Teams):
  aria-mantu-app: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID
  (REDIRECT_URI + DATA_ENCRYPTION_KEY + EMAIL_INBOUND_WEBHOOK_SECRET usually already set)

Entra SSO (GOTRUE_EXTERNAL_AZURE_* on aria-mantu-auth) is OPTIONAL for Graph E2E PASS.
Fly-env LLM keys are OPTIONAL (Hermes/vault may already green drafts/critics).

Without Graph secrets: no Outlook connect, no Graph push intake, no confirmLive Teams book.
Without Entra: Graph Connect Outlook still works; /login Microsoft SSO CTA stays off.

Agent can READ Entra apps in this tenant but cannot CREATE (Insufficient privileges).
Tenant scan: 1339 apps, zero with aria-mantu-*.fly.dev redirect URIs — owner must create one.

GOTRUE_EXTERNAL_AZURE_URL (only if enabling SSO):
  https://login.microsoftonline.com/${TENANT_ID}/v2.0

## Portal steps (Option A — create app)

1. Open (tenant-scoped): ${PORTAL_NEW_TENANT}
   Fallback: ${PORTAL_NEW}
2. Name: ARIA Mantu Graph (Fly)
3. Supported account types: Single tenant
4. Redirect URI (Web):
   - ${APP_REDIRECT}
   - ${GOTRUE_REDIRECT}
5. Register → copy **Application (client) ID**
6. Certificates & secrets → New client secret → copy value once
7. API permissions → Microsoft Graph **Delegated**:
   - Mail.Read, Mail.Send, Calendars.ReadWrite, OnlineMeetings.ReadWrite, User.Read, offline_access
   Grant admin consent.
8. Copy Application (client) ID + tenant ID (${TENANT_ID}) + client secret

## Agent/owner commands (after portal)

export ARIA_AZURE_APP_ID='<paste-client-id>'
bash scripts/az-configure-existing-graph-app.sh --apply
# writes /tmp/owner-microsoft.env and applies Fly secrets → post-m365-secrets-golive

## Option B — paste env file

cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
# fill MICROSOFT_CLIENT_ID/SECRET/TENANT_ID=${TENANT_ID} (Graph-minimum)
# GOTRUE_EXTERNAL_AZURE_* optional — leave CLIENT_ID+SECRET PLACEHOLDER to skip Entra SSO
# (Azure URL alone may derive TENANT; apply will not hard-error as partial Entra)
bash scripts/fly-apply-owner-microsoft-secrets.sh
# (apply already runs post-m365-secrets-golive; re-run only if seat wait needed)

## Verify on Fly

curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# Settings → Connect Outlook (mode=live) → Enable Graph webhook
bash scripts/verify-m365-ready.sh
# → RESULT: PASS (confirmLive Teams joinUrl)

Existing apps portal: ${PORTAL_APPS}

EOF
