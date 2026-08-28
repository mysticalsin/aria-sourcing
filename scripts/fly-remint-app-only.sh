#!/usr/bin/env bash
# One-shot app-only remint when live migration already matches tip (0071).
# Requires /tmp/owner-deploy-confirm.env matching tip SHA.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

if [ -r /tmp/owner-deploy-confirm.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /tmp/owner-deploy-confirm.env
  set +a
fi

source "$repo/scripts/lib/prod-release-guard.sh"
aria_require_reviewed_production_release fly-deploy-now aria-mantu-bootstrap aria-mantu-app

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a
# shellcheck disable=SC1091
source "$repo/production-readiness/.fly-secrets.env"
set +a

echo "=== App-only remint (bootstrap skipped — migration already tip-aligned) ==="
IFS=$'\t' read -r EXPECTED_MIGRATION_FILE EXPECTED_MIGRATION_SHA EXPECTED_MIGRATION_COUNT EXPECTED_LEDGER_SHA < <(node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const dir = "supabase/migrations";
  const files = fs.readdirSync(dir).filter((name) => /^0[0-9]{3}_.+\.sql$/.test(name)).sort();
  const entries = files.map((filename) => ({
    filename,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, filename))).digest("hex"),
  }));
  const latest = entries.at(-1);
  const ledgerSha = crypto.createHash("sha256")
    .update(entries.map((entry) => `${entry.filename}:${entry.sha256}\n`).join(""))
    .digest("hex");
  process.stdout.write(`${[latest.filename, latest.sha256, String(entries.length), ledgerSha].join("\t")}\n`);
')
echo "Release identity: migration=$EXPECTED_MIGRATION_FILE count=$EXPECTED_MIGRATION_COUNT sha=${ARIA_RELEASE_SHA:0:12}"

# Entra SSO stays false until GoTrue Azure secrets exist.
AZURE_LOGIN_ARG="false"
auth_secrets="$(flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"
azure_ready=1
for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
  if ! printf '%s\n' "$auth_secrets" | grep -qx "$name"; then
    azure_ready=0
    break
  fi
done
if [ "$azure_ready" = "1" ]; then
  AZURE_LOGIN_ARG="true"
fi
echo "NEXT_PUBLIC_ENABLE_AZURE_LOGIN=$AZURE_LOGIN_ARG"

flyctl secrets set -a aria-mantu-app --stage \
  "ARIA_RELEASE_SHA=${ARIA_RELEASE_SHA}" \
  "ARIA_EXPECTED_MIGRATION=${EXPECTED_MIGRATION_FILE}" \
  "ARIA_EXPECTED_MIGRATION_SHA=${EXPECTED_MIGRATION_SHA}" \
  "ARIA_EXPECTED_MIGRATION_COUNT=${EXPECTED_MIGRATION_COUNT}" \
  "ARIA_EXPECTED_LEDGER_SHA=${EXPECTED_LEDGER_SHA}" \
  "AGENT_FRAMEWORKS_REQUIRED=false"

flyctl deploy --config fly.app.toml --remote-only \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://aria-mantu-kong.fly.dev \
  --build-arg NEXT_PUBLIC_SITE_URL=https://aria-mantu-app.fly.dev \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false \
  --build-arg NEXT_PUBLIC_ENABLE_AZURE_LOGIN="$AZURE_LOGIN_ARG" \
  --env "ARIA_RELEASE_SHA=${ARIA_RELEASE_SHA}" \
  --env "ARIA_EXPECTED_MIGRATION=${EXPECTED_MIGRATION_FILE}" \
  --env "ARIA_EXPECTED_MIGRATION_SHA=${EXPECTED_MIGRATION_SHA}" \
  --env "ARIA_EXPECTED_MIGRATION_COUNT=${EXPECTED_MIGRATION_COUNT}" \
  --env "ARIA_EXPECTED_LEDGER_SHA=${EXPECTED_LEDGER_SHA}" \
  --env "AGENT_FRAMEWORKS_REQUIRED=false"

echo
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
echo "DEPLOY_OK tip=${ARIA_RELEASE_SHA}"
