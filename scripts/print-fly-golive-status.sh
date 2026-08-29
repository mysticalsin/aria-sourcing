#!/usr/bin/env bash
# print-fly-golive-status.sh — tip vs live Fly vs deploy-confirm match (no secrets printed).
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

TIP="$(git rev-parse HEAD)"
TIP_MIG="$(ls -1 "$repo/supabase/migrations/"*.sql 2>/dev/null | sort | tail -1 | xargs -I{} basename {} || true)"
APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
ready="$(curl -sS -m 20 "$APP_URL/api/ready" 2>/dev/null || echo '{}')"
LIVE="$(echo "$ready" | jq -r '.build // empty' 2>/dev/null || true)"
LIVE_MIG="$(echo "$ready" | jq -r '.migration // empty' 2>/dev/null || true)"
READY_OK="$(echo "$ready" | jq -r '.ok // false' 2>/dev/null || echo false)"

load_confirm() {
  local path="$1"
  [ -r "$path" ] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}
load_confirm "/tmp/owner-deploy-confirm.env"
load_confirm "$repo/production-readiness/.owner-deploy-confirm.env"

CONFIRM_FILE_PRESENT="no"
if [ -r "/tmp/owner-deploy-confirm.env" ] || [ -r "$repo/production-readiness/.owner-deploy-confirm.env" ]; then
  CONFIRM_FILE_PRESENT="yes"
fi

CONFIRM_SHA="${ARIA_RELEASE_SHA:-}"
CONFIRM_MATCH="no"
CONFIRM_STALE="no"
if [ -n "${ARIA_PROD_DEPLOY_CONFIRM:-}" ] && [[ "${ARIA_PROD_DEPLOY_CONFIRM}" == *":${TIP}:"* ]]; then
  CONFIRM_MATCH="yes"
fi
if [ -n "$CONFIRM_SHA" ] && [ "$CONFIRM_SHA" != "$TIP" ]; then
  CONFIRM_STALE="yes"
fi

M365_MISSING="unknown"
if [ -n "${FLY_API_TOKEN:-}" ] || [ -r "$repo/production-readiness/.fly-token.env" ]; then
  M365_MISSING="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -c '^MISSING' || true)"
fi

LLM_AUTH="unknown"
LLM_OUT="$(bash "$repo/scripts/probe-fly-llm-auth.sh" 2>/dev/null || true)"
if echo "$LLM_OUT" | grep -q 'RESULT: llm_auth_ok'; then
  LLM_AUTH="ok"
elif echo "$LLM_OUT" | grep -q 'RESULT: llm_auth_dead'; then
  LLM_AUTH="dead"
elif echo "$LLM_OUT" | grep -qE 'RESULT: llm_(auth_absent|keys_absent)'; then
  LLM_AUTH="absent"
fi

echo "tip_sha=${TIP}"
echo "tip_migration=${TIP_MIG:-unknown}"
echo "live_sha=${LIVE:-unknown}"
echo "live_migration=${LIVE_MIG:-unknown}"
echo "live_ready_ok=${READY_OK}"
echo "confirm_sha=${CONFIRM_SHA:-unset}"
echo "confirm_file_present=${CONFIRM_FILE_PRESENT}"
echo "confirm_matches_tip=${CONFIRM_MATCH}"
echo "confirm_stale_for_tip=${CONFIRM_STALE}"
echo "m365_secrets_missing=${M365_MISSING}"
echo "llm_auth=${LLM_AUTH}"

# Classify tip vs live without secrets.
# - tip_live: SHAs match
# - tip_ahead_docs: live is ancestor of tip AND tip..live has no Fly-image-affecting paths
#   (relay/docs/tests/ops scripts only — no src/, migrations, workers, package, fly.toml)
# - tip_ahead_app: live is ancestor but tip has app/image changes (deploy required)
# - confirm_ready_run_golive: owner confirm matches tip; run golive
# - stale_owner_remint_required: otherwise
deploy_status="stale_owner_remint_required"
if [ -n "$LIVE" ] && [[ "$LIVE" == "$TIP"* || "$TIP" == "$LIVE"* ]]; then
  deploy_status="tip_live"
elif [ -n "$LIVE" ] && git cat-file -e "${LIVE}^{commit}" 2>/dev/null \
  && git merge-base --is-ancestor "$LIVE" "$TIP" 2>/dev/null; then
  changed="$(git diff --name-only "$LIVE" "$TIP" 2>/dev/null || true)"
  # Paths that land in the Fly app image / runtime workers (require redeploy).
  # e2e-workflow-test.sh runs from the agent checkout against live Fly — not an image path.
  if printf '%s\n' "$changed" | grep -qE '^(src/|supabase/migrations/|public/|package(-lock)?\.json$|fly\.|Dockerfile|next\.config|scripts/sourcing-loop-worker|scripts/.*worker\.|scripts/fly-deploy|scripts/fly-enterprise)'; then
    deploy_status="tip_ahead_app"
  else
    deploy_status="tip_ahead_docs"
  fi
elif [ "$CONFIRM_MATCH" = "yes" ]; then
  deploy_status="confirm_ready_run_golive"
fi
echo "deploy_status=${deploy_status}"
