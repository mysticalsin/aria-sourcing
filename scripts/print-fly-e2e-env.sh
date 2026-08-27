#!/usr/bin/env bash
# print-fly-e2e-env.sh — emit env exports for bash e2e-workflow-test.sh after Fly deploy.
#
# Reads FLY_SUPABASE_ANON_KEY from production-readiness/.fly-secrets.env when present.
# Does NOT print ADMIN_EMAIL/PASSWORD (owner-only). Never commits or logs secret values
# beyond stdout for the invoking shell.
#
# Usage:
#   bash scripts/print-fly-e2e-env.sh           # human checklist + export lines
#   eval "$(bash scripts/print-fly-e2e-env.sh --export)"  # ANON_KEY (+ webhook from /tmp)
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
secrets="$repo/production-readiness/.fly-secrets.env"
mode="${1:-}"
webhook_tmp="/tmp/aria-e2e-webhook-secret"

read_fly_secret() {
  node - "$1" "$secrets" <<'NODE'
const fs = require("node:fs");
const key = process.argv[2];
const path = process.argv[3];
if (!fs.existsSync(path)) process.exit(0);
for (const line of fs.readFileSync(path, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const name = trimmed.slice(0, eq);
  if (name !== key) continue;
  process.stdout.write(trimmed.slice(eq + 1));
  process.exit(0);
}
NODE
}

anon_key="$(read_fly_secret FLY_SUPABASE_ANON_KEY || true)"
webhook_key=""
if [ -r "$webhook_tmp" ]; then
  webhook_key="$(tr -d '\n\r' < "$webhook_tmp")"
fi
cron_tmp="/tmp/aria-e2e-cron-secret"
cron_key=""
if [ -r "$cron_tmp" ]; then
  cron_key="$(tr -d '\n\r' < "$cron_tmp")"
fi
admin_email_tmp="/tmp/aria-e2e-admin-email"
admin_password_tmp="/tmp/aria-e2e-admin-password"
admin_email=""
admin_password=""
if [ -r "$admin_email_tmp" ]; then
  admin_email="$(tr -d '\n\r' < "$admin_email_tmp")"
fi
if [ -r "$admin_password_tmp" ]; then
  admin_password="$(tr -d '\n\r' < "$admin_password_tmp")"
fi

if [ "$mode" = "--export" ]; then
  [ -n "$anon_key" ] && printf 'export ANON_KEY=%q\n' "$anon_key"
  [ -n "$webhook_key" ] && printf 'export EMAIL_INBOUND_WEBHOOK_SECRET=%q\n' "$webhook_key"
  [ -n "$cron_key" ] && printf 'export CRON_SECRET=%q\n' "$cron_key"
  [ -n "$admin_email" ] && printf 'export ADMIN_EMAIL=%q\n' "$admin_email"
  [ -n "$admin_password" ] && printf 'export ADMIN_PASSWORD=%q\n' "$admin_password"
  exit 0
fi

cat <<'EOF'
# Fly enterprise E2E — run after:
#   bash scripts/fly-golive-mantu-e2e.sh $(git rev-parse HEAD)
# Owner must supply admin credentials (never commit).
# Human mode redacts secret values — use --export to emit real exports for eval.
EOF

if [ -n "$anon_key" ]; then
  echo "export ANON_KEY='…(set, len=${#anon_key}; use --export)'"
else
  echo "# ANON_KEY unset — populate FLY_SUPABASE_ANON_KEY in production-readiness/.fly-secrets.env"
fi

if [ -n "$admin_email" ] && [ -n "$admin_password" ]; then
  printf "export ADMIN_EMAIL=%q\n" "$admin_email"
  echo "export ADMIN_PASSWORD='…(loaded from $admin_password_tmp; use --export)'"
  echo "# loaded from $admin_email_tmp + $admin_password_tmp"
else
  cat <<'EOF'
export ADMIN_EMAIL='your-admin@example.com'
export ADMIN_PASSWORD='your-admin-password'
# e2e-workflow-test.sh also auto-loads /tmp/aria-e2e-admin-email|password when unset
EOF
fi

if [ -n "$webhook_key" ]; then
  echo "export EMAIL_INBOUND_WEBHOOK_SECRET='…(set, len=${#webhook_key}; use --export)'"
  echo "# loaded from $webhook_tmp (agent-owned Fly webhook secret)"
else
  cat <<'EOF'
# required for Fly enterprise E2E (webhook → requisition_parse):
export EMAIL_INBOUND_WEBHOOK_SECRET='your-32-char-webhook-secret'
# e2e-workflow-test.sh also auto-loads /tmp/aria-e2e-webhook-secret when unset
EOF
fi

if [ -n "$cron_key" ]; then
  echo "export CRON_SECRET='…(set, len=${#cron_key}; use --export)'"
  echo "# loaded from $cron_tmp (agent-owned Fly cron secret)"
else
  cat <<'EOF'
# required on Fly for authenticated draft/graph-stage cron probes:
# export CRON_SECRET='same-as-fly-aria-mantu-app-CRON_SECRET'
# e2e-workflow-test.sh also auto-loads /tmp/aria-e2e-cron-secret when unset
EOF
fi

cat <<'EOF'
# Fly currently ships KIMI_API_KEY — hermes outreach drafts must match:
export AGENT_PROVIDER=kimi
export AGENT_MODEL=moonshot-v1-8k
# optional: override webhook mailbox (defaults to connected Outlook or talent@mantu.com)
# export E2E_INBOUND_MAILBOX='connected-outlook@yourdomain.com'
# optional: skip live Teams book if Outlook seat not connected yet
# export ARIA_ALLOW_SKIP_LIVE_CALENDAR=1
# Loop worker must be armed for webhook→campaign materialization poll:
#   fly secrets: ARIA_LOOP_KILL_SWITCH='false'
#   workspace switchboard: E2E calls set_sourcing_loop_controls after admin login
#   (or Settings → Arm enterprise loop)
# LLM on aria-mantu-app: KIMI_API_KEY (preferred) and/or ANTHROPIC_API_KEY / OPENAI_API_KEY
# If Fly secrets are still missing, print templates first:
#   bash scripts/print-fly-secrets-checklist.sh
bash e2e-workflow-test.sh
EOF
