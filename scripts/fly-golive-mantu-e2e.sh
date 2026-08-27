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
TARGET_MIGRATION="0063_loop_append_outreach.sql"

die(){ echo "ERROR: $*" >&2; exit 1; }
need_cmd(){ command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "release_sha must be a 40-char lowercase Git SHA"
need_cmd curl
need_cmd node
need_cmd jq

echo "=== Fly Mantu enterprise E2E preflight ==="
echo "  production URL : ${APP_URL}"
echo "  release SHA    : $RELEASE_SHA"
echo "  target migr.   : $TARGET_MIGRATION"
echo

probe_code(){ curl -sS -m 25 -o /dev/null -w '%{http_code}' "$@"; }

login_code="$(probe_code "${APP_URL}/login?redirect=%2F")"
health_code="$(probe_code "${APP_URL}/api/health")"
demo_code="$(probe_code -X POST "${APP_URL}/api/auth/demo-login" -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}')"
webhook_code="$(probe_code -X POST "${APP_URL}/api/webhooks/email-inbound" -H 'content-type: application/json' -d '{}')"
email_conn_code="$(probe_code "${APP_URL}/api/email/connections")"
ready_json="$(curl -sS -m 25 "${APP_URL}/api/ready" 2>/dev/null || echo '{}')"

echo "Live probes:"
echo "  GET  /login                  -> $login_code (expect 200)"
echo "  GET  /api/health             -> $health_code (expect 200)"
echo "  POST /api/auth/demo-login    -> $demo_code (expect 404/403 — demo OFF)"
echo "  POST /api/webhooks/email-inbound -> $webhook_code (expect 401 without signature; 404 = old build)"
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
if [ "$current_migration" != "$TARGET_MIGRATION" ]; then
  echo "BLOCKER: live migration is '$current_migration' (need $TARGET_MIGRATION)."
  echo "         Apply 0061–0063 via bootstrap, then redeploy $RELEASE_SHA."
  echo
fi
if [ "$webhook_code" = "404" ]; then
  echo "BLOCKER: email inbound webhook route missing on live image — deploy $RELEASE_SHA."
  echo
fi

echo "=== Owner activation path ==="
echo "1. Restore GitHub Actions (billing/spending limit) so CI + CodeQL can run on $RELEASE_SHA."
echo "2. Fill production-readiness/.fly-secrets.env from .fly-secrets.example (PG + service role)."
echo "3. Deploy + migrate via protected workflow or:"
echo "     ARIA_RELEASE_SHA=$RELEASE_SHA \\"
echo "     ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:aria-mantu-bootstrap:aria-mantu-app:$RELEASE_SHA \\"
echo "       bash scripts/fly-deploy-now.sh"
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
echo
echo "Note: agentFrameworks=false on /api/ready is Track C (Flowise) and does not block the"
echo "      recruiting loop; readiness cannot opt out of it in production by design."
echo
echo "Preflight complete. No production mutation was performed."
