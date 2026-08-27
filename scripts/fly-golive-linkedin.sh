#!/usr/bin/env bash
# fly-golive-linkedin.sh — OWNER-RUN checklist to ship LinkedIn HeyReach parity
# to the real Fly tenant: https://aria-mantu-app.fly.dev/login
#
# This is NOT a deploy script. It validates preflight state, prints the exact
# protected-workflow dispatch, and runs read-only probes against live Fly.
#
# Prerequisites (local):
#   production-readiness/.fly-token.env   (read-only probes only; deploy uses GH secrets)
#   production-readiness/.fly-secrets.env (for post-deploy RPC probes)
#
# Usage:
#   bash scripts/fly-golive-linkedin.sh [release_sha]
#
# release_sha defaults to HEAD when omitted; must be a 40-char lowercase Git SHA
# that passed CI + CodeQL on deploy/fly-github-actions.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
KONG_URL="${KONG_URL:-https://aria-mantu-kong.fly.dev}"
RELEASE_SHA="${1:-$(git rev-parse HEAD)}"

die(){ echo "ERROR: $*" >&2; exit 1; }
need_cmd(){ command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "release_sha must be a 40-char lowercase Git SHA"

need_cmd curl
need_cmd node

echo "=== Fly LinkedIn golive preflight ==="
echo "  production URL : ${APP_URL}/login?redirect=%2F"
echo "  release SHA    : $RELEASE_SHA"
echo

# --- read-only live probes (no credentials required) ---
probe_code(){ curl -sS -m 25 -o /dev/null -w '%{http_code}' "$@"; }

login_code="$(probe_code "${APP_URL}/login?redirect=%2F")"
health_code="$(probe_code "${APP_URL}/api/health")"
demo_code="$(probe_code -X POST "${APP_URL}/api/auth/demo-login" -H 'content-type: application/json' -d '{"username":"admin","password":"admin"}')"
li_conn_code="$(probe_code "${APP_URL}/api/linkedin/connections")"
li_sim_code="$(probe_code -X POST "${APP_URL}/api/linkedin/simulate" -H 'content-type: application/json' -d '{}')"
ready_json="$(curl -sS -m 25 "${APP_URL}/api/ready" 2>/dev/null || echo '{}')"

echo "Live probes:"
echo "  GET  /login?redirect=%2F     -> $login_code (expect 200)"
echo "  GET  /api/health             -> $health_code (expect 200)"
echo "  POST /api/auth/demo-login    -> $demo_code (expect 404/403 — demo OFF)"
echo "  GET  /api/linkedin/connections -> $li_conn_code (expect 401 after deploy; 404 = old build)"
echo "  POST /api/linkedin/simulate  -> $li_sim_code (expect 401 after deploy; 404 = old build)"

node -e '
  const raw = process.argv[1];
  let j;
  try { j = JSON.parse(raw); } catch { j = {}; }
  const build = j.build ?? "unknown";
  const migration = j.migration ?? "unknown";
  console.log(`  GET  /api/ready build=${build}`);
  console.log(`       migration=${migration} (target: 0062_requisition_parse_inbound_id.sql)`);
' "$ready_json"

echo
if [ "$demo_code" = "200" ]; then
  die "demo login is enabled on Fly — refuse to golive LinkedIn on an open demo tenant"
fi
if [ "$login_code" != "200" ] || [ "$health_code" != "200" ]; then
  die "Fly app is not reachable at ${APP_URL}"
fi

# --- migration ledger expectation ---
IFS=$'\t' read -r latest_file latest_sha migration_count ledger_sha < <(node -e '
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

echo "Source migration ledger:"
echo "  latest file  : $latest_file"
echo "  migration #  : $migration_count"
echo "  ledger sha256: $ledger_sha"
echo

if [ "$li_conn_code" = "404" ] || [ "$li_sim_code" = "404" ]; then
  echo "BLOCKER: LinkedIn API routes are absent on the live Fly build."
  echo "         Deploy $RELEASE_SHA (or newer) via the protected workflow below."
  echo
fi

echo "=== Owner deploy path (sanctioned) ==="
echo "1. Fast-forward deploy/fly-github-actions to a green tip that includes LinkedIn + migrations 0047–0059."
echo "   Tip candidate on this branch: $RELEASE_SHA"
echo "2. Restore GitHub Actions budget; wait for ci.yml + codeql.yml success on that SHA."
echo "3. Dispatch from GitHub → Actions → Deploy Aria Mantu (Fly):"
echo "     ref: deploy/fly-github-actions"
echo "     release_sha: $RELEASE_SHA"
echo "     recovery_receipt_sha256: <sha256 of reviewed volume-recovery-receipt.json>"
echo "4. After deploy, set optional Fly app secret if using signed LinkedIn webhooks:"
echo "     LINKEDIN_INBOUND_WEBHOOK_SECRET=<32+ chars> on app aria-mantu-app (via reviewed secrets path)"
echo "5. Prove login + LinkedIn (real auth, not demo):"
echo "     curl -fsS ${APP_URL}/api/health"
echo "     curl -fsS ${APP_URL}/api/ready | jq .migration,.build"
echo "     curl -sS -o /dev/null -w '%{http_code}\\n' ${APP_URL}/api/linkedin/connections   # 401 without session"
echo "     ADMIN_EMAIL=... ADMIN_PASSWORD=... ANON_KEY=... bash e2e-workflow-test.sh"
echo
echo "=== Faster app-only path (migrations already at 0059) ==="
echo "If the DB ledger is current but the app image is stale, owner may run:"
echo "  ARIA_RELEASE_SHA=$RELEASE_SHA ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:prod-deploy-app:aria-mantu-app:$RELEASE_SHA \\"
echo "    bash scripts/prod-deploy-app.sh"
echo "(Still requires .fly-token.env + .fly-secrets.env; does NOT apply migrations.)"
echo
echo "Preflight complete. No production mutation was performed."
