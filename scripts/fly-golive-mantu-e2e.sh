#!/usr/bin/env bash
# fly-golive-mantu-e2e.sh — OWNER-RUN checklist for the enterprise Mantu recruiting loop.
#
# Read-only probes + printed activation steps. Does NOT deploy, mutate secrets,
# or apply migrations.
#
# Target loop:
#   webhook need email → requisition_parse → source → top 10 → outreach
#   → quality → approve → Teams/Outlook book
#
# Usage:
#   bash scripts/fly-golive-mantu-e2e.sh [release_sha]
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
KONG_URL="${KONG_URL:-https://aria-mantu-kong.fly.dev}"
RELEASE_SHA="${1:-$(git rev-parse HEAD)}"
# Floor: Teams meeting_url (0066). Tip may be newer (e.g. 0067 allowlist grants).
MIN_MIGRATION_PREFIX="0066_"

migration_meets_floor() {
  case "${1:-}" in
    0066_*|006[7-9]_*|00[7-9][0-9]_*|0[1-9][0-9][0-9]_*) return 0 ;;
    *) return 1 ;;
  esac
}

die(){ echo "ERROR: $*" >&2; exit 1; }
need_cmd(){ command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "release_sha must be a 40-char lowercase Git SHA"
need_cmd curl
need_cmd node
need_cmd jq

echo "=== Fly Mantu enterprise E2E preflight ==="
echo "  production URL : ${APP_URL}"
echo "  release SHA    : $RELEASE_SHA"
echo "  min migration  : ${MIN_MIGRATION_PREFIX}* (tip may be newer)"
echo

probe_code(){ curl -sS -m 25 -o /dev/null -w '%{http_code}' "$@"; }

login_code="$(probe_code "${APP_URL}/login?redirect=%2F")"
health_code="$(probe_code "${APP_URL}/api/health")"
demo_code="$(probe_code -X POST "${APP_URL}/api/auth/demo-login" -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}')"
webhook_code="$(probe_code -X POST "${APP_URL}/api/webhooks/email-inbound" -H 'content-type: application/json' -d '{}')"
graph_code="$(probe_code "${APP_URL}/api/webhooks/microsoft-graph?validationToken=golive-graph-check")"
email_conn_code="$(probe_code "${APP_URL}/api/email/connections")"
ready_json="$(curl -sS -m 25 "${APP_URL}/api/ready" 2>/dev/null || echo '{}')"

echo "Live probes:"
echo "  GET  /login                  -> $login_code (expect 200)"
echo "  GET  /api/health             -> $health_code (expect 200)"
echo "  POST /api/auth/demo-login    -> $demo_code (expect 404/403 — demo OFF)"
echo "  POST /api/webhooks/email-inbound -> $webhook_code (expect 401 without signature; 404 = old build)"
echo "  GET  /api/webhooks/microsoft-graph?validationToken=… -> $graph_code (expect 200; 404 = old build)"
echo "  GET  /api/email/connections  -> $email_conn_code (expect 401 without session)"

node -e '
  const j = JSON.parse(process.argv[1] || "{}");
  const c = j.components || {};
  console.log(`  GET  /api/ready ok=${j.ok} status=${j.status}`);
  console.log(`       build=${j.build ?? "unknown"}`);
  console.log(`       migration=${j.migration ?? "unknown"}`);
  console.log(`       database=${c.database} auth=${c.auth} queue=${c.queue} agentFrameworks=${c.agentFrameworks}`);
' "$ready_json"

IFS=$'\t' read -r latest_file _ migration_count ledger_sha < <(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const dir = "supabase/migrations";
  const files = fs.readdirSync(dir).filter((n) => /^0[0-9]{3}_.+\.sql$/.test(n)).sort();
  const entries = files.map((filename) => ({
    filename,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, filename))).digest("hex"),
  }));
  const latest = entries.at(-1);
  const ledgerSha = crypto.createHash("sha256")
    .update(entries.map((e) => `${e.filename}:${e.sha256}\n`).join(""))
    .digest("hex");
  process.stdout.write(`${latest.filename}\t${latest.sha256}\t${entries.length}\t${ledgerSha}\n`);
')

echo
echo "Source migration ledger:"
echo "  latest file  : $latest_file"
echo "  migration #  : $migration_count"
echo "  ledger sha256: $ledger_sha"
echo

if [ "$demo_code" = "200" ]; then
  die "demo login is enabled on Fly — refuse enterprise golive on an open demo tenant"
fi
if [ "$login_code" != "200" ] || [ "$health_code" != "200" ]; then
  die "Fly app is not reachable at ${APP_URL}"
fi

current_migration="$(node -e 'const j=JSON.parse(process.argv[1]||"{}"); process.stdout.write(String(j.migration||""))' "$ready_json")"
if ! migration_meets_floor "$current_migration"; then
  echo "BLOCKER: live migration is '$current_migration' (need >= ${MIN_MIGRATION_PREFIX}*)."
  echo "         Apply migrations through tip via bootstrap, then redeploy $RELEASE_SHA."
  echo
fi
if [ "$webhook_code" = "404" ]; then
  echo "BLOCKER: email inbound webhook route missing on live image — deploy $RELEASE_SHA."
  echo
fi

# Read-only Fly secrets inventory when flyctl + token are available.
if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n' < "$repo/production-readiness/.fly-token.env")"
fi

audit_fly_secret() {
  local app="$1" name="$2" listed="$3"
  if printf '%s\n' "$listed" | grep -qx "$name"; then
    echo "  [$app] $name: deployed"
  else
    echo "  [$app] $name: MISSING"
  fi
}

if command -v flyctl >/dev/null 2>&1 && [ -n "${FLY_API_TOKEN:-}" ]; then
  echo "Fly secrets inventory (read-only):"
  app_secrets="$(flyctl secrets list -a aria-mantu-app 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"
  auth_secrets="$(flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"
  for name in EMAIL_INBOUND_WEBHOOK_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI CRON_SECRET SUPABASE_SERVICE_ROLE_KEY; do
    audit_fly_secret aria-mantu-app "$name" "$app_secrets"
  done
  for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
    audit_fly_secret aria-mantu-auth "$name" "$auth_secrets"
  done
  azure_login="$(flyctl config env -a aria-mantu-app 2>/dev/null | awk -F'│' '/NEXT_PUBLIC_ENABLE_AZURE_LOGIN/ {gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3; exit}' || true)"
  if [ "$azure_login" = "true" ]; then
    echo "  [aria-mantu-app] NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true"
  else
    echo "  [aria-mantu-app] NEXT_PUBLIC_ENABLE_AZURE_LOGIN: ${azure_login:-false/missing} (need true for Entra SSO)"
  fi
  echo
else
  echo "Fly secrets inventory: skipped (flyctl or FLY_API_TOKEN unavailable)"
  echo
fi

echo "=== Owner activation path (Fly ONLY — never Vercel) ==="
echo "Branch: cursor/enterprise-autopilot-b91d · PR #32 (supersedes closed #29–#31)"
echo "0. Read-only checklist: bash scripts/fly-enterprise-activate.sh $RELEASE_SHA"
echo "1. Restore GitHub Actions (billing/spending limit) so CI + CodeQL can run on $RELEASE_SHA."
echo "2. Fill production-readiness/.fly-secrets.env from .fly-secrets.example (PG + service role)."
echo "3. Deploy + migrate on Fly only (do NOT run vercel --prod / do NOT merge to vercel-demo for this):"
echo "     bash scripts/print-fly-deploy-confirm.sh   # emits exact SHA + ARIA_PROD_DEPLOY_CONFIRM"
echo "     # run the printed export lines, then:"
echo "     bash scripts/fly-deploy-now.sh"
echo "4. Set Fly app secrets (reviewed path):"
echo "     EMAIL_INBOUND_WEBHOOK_SECRET=<32+ chars>"
echo "     MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI"
echo "     NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true (+ GoTrue Azure provider on auth)"
echo "     ARIA_WEB_INTERNAL_URL=http://aria-mantu-app.internal:3000  (loop worker parse route)"
echo "5. Prove:"
echo "     curl -fsS ${APP_URL}/api/health"
echo "     curl -fsS ${APP_URL}/api/ready | jq .migration,.build,.ok"
echo "     ADMIN_EMAIL=… ADMIN_PASSWORD=… ANON_KEY=… EMAIL_INBOUND_WEBHOOK_SECRET=… \\"
echo "       bash e2e-workflow-test.sh"
echo "     # or: bash scripts/print-fly-e2e-env.sh  (loads ANON_KEY from .fly-secrets.env)"
echo
echo "Note: agentFrameworks=false on /api/ready is Track C (Flowise) and does not block the"
echo "      recruiting loop; readiness cannot opt out of it in production by design."
echo
echo "Preflight complete. No production mutation was performed."
