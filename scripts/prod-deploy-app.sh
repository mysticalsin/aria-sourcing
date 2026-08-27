#!/bin/bash
# prod-deploy-app.sh — OWNER-RUN. Deploy JUST the app (stage 4 of the prod fix),
# from a LOCAL mirror so the Fly build context upload never stalls reading the
# OneDrive working tree (which hung the combined script's rsync).
#
# FLY ONLY (aria-mantu-app). Never Vercel. Never other Fly apps.
#
# The DB migrations are already applied + verified live; this ships the app-code
# fixes (synchronous send + rfc_message_id stamp, cron constant-time compare,
# email-delivery replay horizon, worker receipt-GC, swarm worker/executor/routes).
#
# It builds a local mirror of only the app-relevant paths (src, scripts, public,
# root configs) — far smaller than the full repo, no node_modules/.next/.git —
# then deploys from it. Idempotent.
#
# Usage (repo root, YOUR terminal). The app build is multi-minute; let it finish:
#   SHA=$(git rev-parse HEAD)
#   ARIA_RELEASE_SHA=$SHA \
#   ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:prod-deploy-app:$SHA:aria-mantu-app \
#     bash scripts/prod-deploy-app.sh
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "${ARIA_DEPLOY_TARGET:-fly}" in
  fly|FLY|aria-mantu-app) ;;
  *)
    echo "ERROR: prod-deploy-app.sh mutates Fly aria-mantu-app only." >&2
    exit 1
    ;;
esac
source "$repo/scripts/lib/prod-release-guard.sh"
aria_require_reviewed_production_release prod-deploy-app aria-mantu-app
export FLY_API_TOKEN="$(cat "$repo/production-readiness/.fly-token.env")"
export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a; source "$repo/production-readiness/.fly-secrets.env"; set +a

mirror="${TMPDIR:-/tmp}/aria-app-mirror"
echo "=== 1/2 build local app mirror at $mirror (excludes node_modules/.next/.git) ==="
mkdir -p "$mirror"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude '_agent_state' --exclude '_relay' --exclude 'graphify-out' \
  --exclude 'production-readiness/e2e-*' --exclude '.claude' --exclude '.playwright-mcp' \
  --exclude '.env*' \
  "$repo/src/" "$mirror/src/"
rsync -a --delete "$repo/scripts/" "$mirror/scripts/"
rsync -a --delete "$repo/public/" "$mirror/public/" 2>/dev/null || true
# Root files fly build needs (configs, lockfile, next/ts config, etc.)
for f in package.json package-lock.json pnpm-lock.yaml next.config.js next.config.mjs next.config.ts tsconfig.json fly.app.toml Dockerfile .dockerignore server.js middleware.ts postcss.config.js postcss.config.mjs tailwind.config.js tailwind.config.ts components.json; do
  [ -f "$repo/$f" ] && cp "$repo/$f" "$mirror/$f"
done
[ -f "$mirror/fly.app.toml" ] || { echo "FATAL: fly.app.toml missing from mirror"; exit 1; }
[ -f "$mirror/package.json" ] || { echo "FATAL: package.json missing from mirror"; exit 1; }
echo "  mirror ready: $(du -sh "$mirror" | awk '{print $1}')"

echo "=== 2/2 deploy the app from the local mirror ==="
( cd "$mirror" && flyctl deploy --config fly.app.toml --remote-only \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY" )

echo
echo "================ APP DEPLOYED ================"
echo " App: https://aria-mantu-app.fly.dev  (verify /api/health returns 200)"
