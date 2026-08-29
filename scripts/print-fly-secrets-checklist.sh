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
# Prefer the apply helper (reads owner-exported env or drop-zone; refuses PLACEHOLDER):
#   export MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
#   export GOTRUE_EXTERNAL_AZURE_CLIENT_ID=... GOTRUE_EXTERNAL_AZURE_SECRET=...
#   export GOTRUE_EXTERNAL_AZURE_URL='https://login.microsoftonline.com/<tenant>/v2.0'
#   bash scripts/fly-apply-owner-microsoft-secrets.sh
# If az login cannot CREATE app registrations (Insufficient privileges /
# allowedToCreateApps=false — Portal create also fails for non-admins):
#   # Entra admin registers ARIA Mantu Graph (Fly), then:
#   echo '<client-id>' > /tmp/owner-azure-app-id
#   bash scripts/probe-m365-unblock.sh --apply
#   # or:
#   export ARIA_AZURE_APP_ID='<client-id-from-azure-portal>'
#   bash scripts/az-configure-existing-graph-app.sh --apply
# Or drop KEY=value file (never commit):
#   cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
#   # edit real values, then run apply script
#
# Or set manually:

flyctl secrets set -a aria-mantu-app \
  EMAIL_INBOUND_WEBHOOK_SECRET='PLACEHOLDER_32+_CHAR_WEBHOOK_SECRET' \
  MICROSOFT_CLIENT_ID='PLACEHOLDER_AZURE_APP_CLIENT_ID' \
  MICROSOFT_CLIENT_SECRET='PLACEHOLDER_AZURE_APP_CLIENT_SECRET' \
  MICROSOFT_REDIRECT_URI='https://aria-mantu-app.fly.dev/auth/microsoft/callback' \
  MICROSOFT_TENANT_ID='PLACEHOLDER_AZURE_TENANT_ID'

# Vault/mailbox token encryption (required by verify-m365-ready.sh):
# flyctl secrets set -a aria-mantu-app DATA_ENCRYPTION_KEY='PLACEHOLDER_32+_CHAR_ENCRYPTION_KEY'
# (usually already present on aria-mantu-app — confirm via print-fly-missing-secrets.sh)

# Arm the loop worker process (required for webhook → campaign E2E materialization):
flyctl secrets set -a aria-mantu-app ARIA_LOOP_KILL_SWITCH='false'

# At least one cloud LLM key (parse / draft / critics fail-closed without it).
# Prefer the apply helper (reads /tmp/owner-llm.env; refuses PLACEHOLDER):
#   cp production-readiness/.owner-llm.env.example /tmp/owner-llm.env
#   # edit real KIMI_API_KEY (and optional KIMI_BASE_URL) and/or DEEPSEEK_API_KEY
#   # or OPENAI/ANTHROPIC
#   bash scripts/fly-apply-owner-llm-secrets.sh
# Prefer KIMI (preferred by serverGenerateText; auth 401/403 falls through to next key);
# DeepSeek is also on the preference list (env + vault); Anthropic/OpenAI work too:
# flyctl secrets set -a aria-mantu-app KIMI_API_KEY='PLACEHOLDER_KIMI_KEY'
# or: DEEPSEEK_API_KEY='PLACEHOLDER_DEEPSEEK_KEY'
# or: ANTHROPIC_API_KEY='PLACEHOLDER_ANTHROPIC_KEY'
# or: OPENAI_API_KEY='PLACEHOLDER_OPENAI_KEY'
# After deploy, E2E hermes drafts must match the key you set:
#   Kimi → export AGENT_PROVIDER=kimi AGENT_MODEL=moonshot-v1-8k
#   DeepSeek → export AGENT_PROVIDER=deepseek AGENT_MODEL=deepseek-chat
#   Anthropic → export AGENT_PROVIDER=anthropic

# Optional but recommended for authenticated draft-cron / graph-stage E2E probes:
# flyctl secrets set -a aria-mantu-app CRON_SECRET='PLACEHOLDER_SAME_AS_FLY_CRON_SECRET'

# === LinkedIn via HeyReach (REI autopilot LinkedIn send) ===
# Preferred: Settings → Integrations → LinkedIn stack → paste API key + campaign id
# (encrypted vault; no Fly CLI). Optional: Connect HeyReach MCP on the same panel.
# Fly secrets remain an optional override for shared deploy-level keys:
# flyctl secrets set -a aria-mantu-app \
#   HEYREACH_API_KEY='PLACEHOLDER_HEYREACH_PUBLIC_API_KEY' \
#   HEYREACH_CAMPAIGN_ID='PLACEHOLDER_ACTIVE_CAMPAIGN_ID'
# Optional: HEYREACH_ACCOUNT_ID='PLACEHOLDER_LINKEDIN_ACCOUNT_ID'
# Also needs migration 0076 + live HeyReach fleet seat (auto-created on Save/Connect).

# === aria-mantu-auth (Entra SSO / GoTrue Azure) — OPTIONAL for Graph E2E PASS ===
# Only needed for /login "Sign in with Microsoft". Graph Connect Outlook works
# without these. When set, fly-deploy-now.sh flips NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true.

flyctl secrets set -a aria-mantu-auth \
  GOTRUE_EXTERNAL_AZURE_ENABLED='true' \
  GOTRUE_EXTERNAL_AZURE_CLIENT_ID='PLACEHOLDER_AZURE_APP_CLIENT_ID' \
  GOTRUE_EXTERNAL_AZURE_SECRET='PLACEHOLDER_AZURE_APP_CLIENT_SECRET' \
  GOTRUE_EXTERNAL_AZURE_URL='https://login.microsoftonline.com/PLACEHOLDER_TENANT_ID/v2.0'

# === workspace switchboard (after first admin login) ===
# E2E arms this via set_sourcing_loop_controls automatically.
# Operators can also use Settings → Observability → Sourcing loop switchboard
# ("Arm enterprise loop"), or call the RPC manually.

# === then deploy tip ===
bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)
bash scripts/print-fly-deploy-confirm.sh
# export ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM from that output
bash scripts/fly-deploy-now.sh
bash scripts/print-fly-e2e-env.sh
# export ADMIN_EMAIL ADMIN_PASSWORD EMAIL_INBOUND_WEBHOOK_SECRET (+ CRON_SECRET)
# Optional: export E2E_INBOUND_MAILBOX='connected-outlook@yourdomain.com'
bash e2e-workflow-test.sh
EOF
