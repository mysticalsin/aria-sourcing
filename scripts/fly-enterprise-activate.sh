#!/usr/bin/env bash
# fly-enterprise-activate.sh — read-only owner checklist for Mantu enterprise golive.
#
# Runs preflight probes, prints deploy + E2E one-liners, exits 1 when blockers remain.
# Does NOT deploy, mutate Fly secrets, or run live E2E.
#
# Usage:
#   bash scripts/fly-enterprise-activate.sh [release_sha]
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
RELEASE_SHA="${1:-$(git rev-parse HEAD)}"
TARGET_MIGRATION="0066_calendar_meeting_url.sql"
APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
blockers=0

note_blocker() {
  echo "BLOCKER: $*"
  blockers=$((blockers + 1))
}

echo "=== Mantu enterprise activation (read-only) ==="
echo "  release SHA: $RELEASE_SHA"
echo

bash "$repo/scripts/fly-golive-mantu-e2e.sh" "$RELEASE_SHA"

ready_json="$(curl -sS -m 25 "${APP_URL}/api/ready" 2>/dev/null || echo '{}')"
current_migration="$(node -e 'const j=JSON.parse(process.argv[1]||"{}"); process.stdout.write(String(j.migration||""));' "$ready_json")"
live_build="$(node -e 'const j=JSON.parse(process.argv[1]||"{}"); process.stdout.write(String(j.build||""));' "$ready_json")"

if [ "$current_migration" != "$TARGET_MIGRATION" ]; then
  blockers=$((blockers + 1))
fi
if [ -n "$live_build" ] && [[ "$live_build" != "$RELEASE_SHA"* ]]; then
  blockers=$((blockers + 1))
fi

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
if command -v flyctl >/dev/null 2>&1 && [ -n "${FLY_API_TOKEN:-}" ]; then
  app_secrets="$(flyctl secrets list -a aria-mantu-app 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"
  for name in EMAIL_INBOUND_WEBHOOK_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI ARIA_LOOP_KILL_SWITCH; do
    if ! printf '%s\n' "$app_secrets" | grep -qx "$name"; then
      note_blocker "Fly secret aria-mantu-app/$name not deployed"
    fi
  done
  if ! printf '%s\n' "$app_secrets" | grep -qx "ANTHROPIC_API_KEY" \
    && ! printf '%s\n' "$app_secrets" | grep -qx "OPENAI_API_KEY"; then
    note_blocker "Fly secret aria-mantu-app needs ANTHROPIC_API_KEY or OPENAI_API_KEY (parse/draft/critics)"
  fi
  auth_secrets="$(flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"
  for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
    if ! printf '%s\n' "$auth_secrets" | grep -qx "$name"; then
      note_blocker "Fly secret aria-mantu-auth/$name not deployed"
    fi
  done
else
  note_blocker "flyctl + FLY_API_TOKEN (or production-readiness/.fly-token.env) required to inventory secrets"
fi

graph_valid_code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "${APP_URL}/api/webhooks/microsoft-graph?validationToken=activate-graph-check" || echo 000)"
if [ "$graph_valid_code" != "200" ]; then
  note_blocker "Graph webhook /api/webhooks/microsoft-graph validationToken returned HTTP $graph_valid_code (need tip deploy with Graph route)"
fi

echo "=== Secrets checklist (copy-paste templates, no values) ==="
bash "$repo/scripts/print-fly-secrets-checklist.sh"
echo

echo "=== Deploy one-liner ==="
bash "$repo/scripts/print-fly-deploy-confirm.sh"
echo

echo "=== E2E env template ==="
bash "$repo/scripts/print-fly-e2e-env.sh"
echo

if [ -z "${ARIA_PROD_DEPLOY_CONFIRM:-}" ]; then
  note_blocker "ARIA_PROD_DEPLOY_CONFIRM unset in this shell — owner must export before fly-deploy-now.sh"
fi

if [ "$blockers" -gt 0 ]; then
  echo
  echo "Activation incomplete ($blockers blocker(s)). Fix items above, then re-run."
  exit 1
fi

echo "Preflight green in this shell — proceed with deploy + live E2E."
exit 0
