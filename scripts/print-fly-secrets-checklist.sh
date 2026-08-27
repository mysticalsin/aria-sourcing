#!/usr/bin/env bash
# print-fly-secrets-checklist.sh — exact flyctl secrets the owner must set
# before tip deploy for the Mantu enterprise E2E loop.
#
# Does NOT set secrets (no values available to the agent). Prints copy-paste
# templates only. Never prints secret values.
#
# Usage:
#   bash scripts/print-fly-secrets-checklist.sh
set -euo pipefail

cat <<'EOF'
# === aria-mantu-app (Outlook / Graph / webhook) ===
# Replace PLACEHOLDER values, then run each block once.

flyctl secrets set -a aria-mantu-app \
  EMAIL_INBOUND_WEBHOOK_SECRET='PLACEHOLDER_32+_CHAR_WEBHOOK_SECRET' \
  MICROSOFT_CLIENT_ID='PLACEHOLDER_AZURE_APP_CLIENT_ID' \
  MICROSOFT_CLIENT_SECRET='PLACEHOLDER_AZURE_APP_CLIENT_SECRET' \
  MICROSOFT_REDIRECT_URI='https://aria-mantu-app.fly.dev/auth/microsoft/callback'

# Optional but recommended for authenticated draft-cron E2E probe:
# flyctl secrets set -a aria-mantu-app CRON_SECRET='PLACEHOLDER_SAME_AS_FLY_CRON_SECRET'

# === aria-mantu-auth (Entra SSO / GoTrue Azure) ===
# Required so fly-deploy-now.sh flips NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true.

flyctl secrets set -a aria-mantu-auth \
  GOTRUE_EXTERNAL_AZURE_ENABLED='true' \
  GOTRUE_EXTERNAL_AZURE_CLIENT_ID='PLACEHOLDER_AZURE_APP_CLIENT_ID' \
  GOTRUE_EXTERNAL_AZURE_SECRET='PLACEHOLDER_AZURE_APP_CLIENT_SECRET' \
  GOTRUE_EXTERNAL_AZURE_URL='https://login.microsoftonline.com/PLACEHOLDER_TENANT_ID/v2.0'

# === then deploy tip ===
bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)
bash scripts/print-fly-deploy-confirm.sh
# export ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM from that output
bash scripts/fly-deploy-now.sh
bash scripts/print-fly-e2e-env.sh
# export ADMIN_EMAIL ADMIN_PASSWORD EMAIL_INBOUND_WEBHOOK_SECRET (+ CRON_SECRET)
bash e2e-workflow-test.sh
EOF
