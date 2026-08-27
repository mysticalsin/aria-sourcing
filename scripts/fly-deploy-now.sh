#!/usr/bin/env bash
# fly-deploy-now.sh — owner/agent deploy once Fly auth is available.
#
# FLY ONLY. Never invokes Vercel, never mutates vercel-demo / main demo hosts.
# Targets: aria-mantu-bootstrap (migrations) + aria-mantu-app (image).
#
# Accepts credentials from:
#   FLY_API_TOKEN env, or the local Fly token file under the readiness dir
#   local Fly secrets env file (required for anon key + service role)
#
# Applies pending migrations via bootstrap, then deploys the app image.
#
# Usage:
#   export FLY_API_TOKEN=...   # or flyctl auth login first
#   SHA=$(git rev-parse HEAD)
#   ARIA_RELEASE_SHA=$SHA \
#   ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:$SHA:aria-mantu-bootstrap,aria-mantu-app \
#     bash scripts/fly-deploy-now.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

# Refuse accidental Vercel / wrong-host pushes from this script.
if command -v vercel >/dev/null 2>&1 && [ "${ARIA_ALLOW_VERCEL_SIDE_EFFECT:-}" != "1" ]; then
  export VERCEL_ORG_ID= VERCEL_PROJECT_ID=
fi
case "${ARIA_DEPLOY_TARGET:-fly}" in
  fly|FLY|aria-mantu-app) ;;
  *)
    echo "ERROR: this script deploys to Fly only (got ARIA_DEPLOY_TARGET=${ARIA_DEPLOY_TARGET:-})." >&2
    exit 1
    ;;
esac

source "$repo/scripts/lib/prod-release-guard.sh"
aria_require_reviewed_production_release fly-deploy-now aria-mantu-bootstrap aria-mantu-app

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n' < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN required (flyctl auth login or .fly-token.env)" >&2; exit 1; }
[ -r "$repo/production-readiness/.fly-secrets.env" ] || {
  echo "missing production-readiness/.fly-secrets.env (copy from .fly-secrets.example)" >&2
  exit 1
}

export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a; source "$repo/production-readiness/.fly-secrets.env"; set +a

echo "=== 1/3 bootstrap image (migrations through 0065) ==="
flyctl deploy --config fly.bootstrap.toml --build-only --push --image-label latest --remote-only

echo "=== 2/3 apply migrations on prod DB ==="
flyctl machine run "registry.fly.io/aria-mantu-bootstrap:latest" \
  --app aria-mantu-bootstrap --region cdg --rm \
  --env ARIA_BOOTSTRAP_PHASE=migrations \
  --env DB_HOST=aria-mantu-db.internal

echo "=== 3/3 deploy app (LinkedIn routes + build $ARIA_RELEASE_SHA) ==="
flyctl deploy --config fly.app.toml --remote-only \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY" \
  --env ARIA_RELEASE_SHA="$ARIA_RELEASE_SHA"

echo
echo "Verify:"
echo "  curl -fsS https://aria-mantu-app.fly.dev/api/health"
echo "  curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq .build,.migration"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://aria-mantu-app.fly.dev/api/linkedin/connections"
