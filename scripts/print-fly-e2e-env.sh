#!/usr/bin/env bash
# print-fly-e2e-env.sh — emit env exports for bash e2e-workflow-test.sh after Fly deploy.
#
# Reads FLY_SUPABASE_ANON_KEY from production-readiness/.fly-secrets.env when present.
# Does NOT print ADMIN_EMAIL/PASSWORD (owner-only). Never commits or logs secret values
# beyond stdout for the invoking shell.
#
# Usage:
#   bash scripts/print-fly-e2e-env.sh           # human checklist + export lines
#   eval "$(bash scripts/print-fly-e2e-env.sh --export)"  # ANON_KEY only
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
secrets="$repo/production-readiness/.fly-secrets.env"
mode="${1:-}"

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

if [ "$mode" = "--export" ]; then
  [ -n "$anon_key" ] && printf 'export ANON_KEY=%q\n' "$anon_key"
  exit 0
fi

cat <<'EOF'
# Fly enterprise E2E — run after:
#   bash scripts/fly-golive-mantu-e2e.sh $(git rev-parse HEAD)
# Owner must supply admin credentials (never commit).
EOF

if [ -n "$anon_key" ]; then
  printf "export ANON_KEY=%q\n" "$anon_key"
else
  echo "# ANON_KEY unset — populate FLY_SUPABASE_ANON_KEY in production-readiness/.fly-secrets.env"
fi

cat <<'EOF'
export ADMIN_EMAIL='your-admin@example.com'
export ADMIN_PASSWORD='your-admin-password'
# required for Fly enterprise E2E (webhook → requisition_parse):
export EMAIL_INBOUND_WEBHOOK_SECRET='your-32-char-webhook-secret'
# Fly currently ships KIMI_API_KEY — hermes outreach drafts must match:
export AGENT_PROVIDER=kimi
export AGENT_MODEL=moonshot-v1-8k
# optional but recommended: authenticates draft-cron fail-closed probe
# export CRON_SECRET='same-as-fly-aria-mantu-app-CRON_SECRET'
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
