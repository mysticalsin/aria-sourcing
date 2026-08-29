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
Tenant policy: defaultUserRolePermissions.allowedToCreateApps=false.
Signed-in az account (${ACCOUNT:-unknown}) has no Application Developer / App Admin role —
Portal "New registration" fails for this user too (same policy). An Entra admin must act.
Tenant scan: still zero apps with aria-mantu-*.fly.dev redirect URIs.
(reject PLACEHOLDER_* and monotonous demo UUIDs like 11111111-…).

After REAL secrets + Connect Outlook (webhook + Calendars.ReadWrite + OnlineMeetings.ReadWrite):
  bash scripts/verify-m365-ready.sh
  # expects Graph Mail.Send push→hiring_need PASS + confirmLive Teams book + RESULT: PASS

GOTRUE_EXTERNAL_AZURE_URL (only if enabling SSO):
  https://login.microsoftonline.com/${TENANT_ID}/v2.0

## Portal steps (Option A — Entra admin registers; agent finishes the rest)

Who can register: Global Admin / Application Administrator / Application Developer
(or temporarily set allowedToCreateApps=true). NOT the current non-privileged az user.

Minimal path (recommended):
1. Entra admin opens (tenant-scoped): ${PORTAL_NEW_TENANT}
2. Name: ARIA Mantu Graph (Fly) · Single tenant · Register (redirects optional — agent adds them)
3. **Owners → Add** → ${ACCOUNT:-twalteur@amaris.com} (required — agent needs Application.ReadWrite.OwnedBy)
4. Copy Application (client) ID only into the agent VM:
   echo '<application-client-id>' > /tmp/owner-azure-app-id
   bash scripts/probe-m365-unblock.sh --apply
   # or: bash scripts/fly-m365-from-azure-app-id.sh
5. Agent configures redirects + Graph delegated perms, **admin-consent** (or Portal Grant), mints secret, applies Fly Graph secrets.
   If admin-consent CLI fails: Grant admin consent in Portal → API permissions, then:
     touch /tmp/az-graph-admin-consent.portal-granted
     # waiters retry with ARIA_GRAPH_SKIP_ADMIN_CONSENT=1 within ~60s, or:
     ARIA_GRAPH_SKIP_ADMIN_CONSENT=1 bash scripts/probe-m365-unblock.sh --apply
6. Recruiter: Settings → Connect Outlook (callback auto-wires webhook when scopes present)
7. bash scripts/verify-m365-ready.sh

Full manual portal path (if preferred):
1. Entra admin opens: ${PORTAL_NEW_TENANT}
2. Name: ARIA Mantu Graph (Fly) · Single tenant
3. Redirect URI (Web):
   - ${APP_REDIRECT}
   - ${GOTRUE_REDIRECT}
4. Register → copy Application (client) ID
5. **Owners → Add** → ${ACCOUNT:-twalteur@amaris.com}
6. Certificates & secrets → New client secret → copy value once
7. API permissions → Microsoft Graph Delegated:
   - Mail.Read, Mail.Send, Calendars.ReadWrite, OnlineMeetings.ReadWrite, User.Read, offline_access
   Grant admin consent.
8. Copy Application (client) ID + tenant ID (${TENANT_ID}) + client secret

## Agent/owner commands (after portal)

# Minimal (app id only):
echo '<paste-client-id>' > /tmp/owner-azure-app-id
bash scripts/probe-m365-unblock.sh --apply

# Or export:
export ARIA_AZURE_APP_ID='<paste-client-id>'
bash scripts/fly-m365-from-azure-app-id.sh
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

## Copy-paste for Entra admin (Teams / email)

Please register a single-tenant Entra app for ARIA Fly Graph (tenant ${TENANT_ID}):
1. ${PORTAL_NEW_TENANT}
2. Name: ARIA Mantu Graph (Fly) · Accounts in this organizational directory only
3. Owners → Add → ${ACCOUNT:-twalteur@amaris.com} (required so the agent can configure redirects + mint a secret)
4. Reply with the Application (client) ID only — agent configures redirects + Graph
   delegated perms (Mail.Read/Send, Calendars.ReadWrite, OnlineMeetings.ReadWrite,
   User.Read, offline_access), grants admin consent when possible, mints a secret,
   and applies Fly. If you are Global Admin, also click Grant admin consent on the app.
   After Grant (if agent is not GA): touch /tmp/az-graph-admin-consent.portal-granted on the agent VM.
5. Alternative: assign Application Developer to ${ACCOUNT:-twalteur@amaris.com}
   (agent waiters re-probe create every ~5 minutes).

EOF
