#!/usr/bin/env bash
# watch-owner-microsoft-and-apply.sh — poll for owner M365 drop-zone, then apply.
#
# Respects /tmp/az-create-mantu-graph-app.noperm (does NOT spam az ad app create).
# Safe for long-running tmux. Never invents secrets.
#
# Unblock triggers (any one):
#   - /tmp/owner-microsoft.env or production-readiness/.owner-microsoft.env
#     without PLACEHOLDER values
#   - exported MICROSOFT_* + GOTRUE_EXTERNAL_AZURE_* (non-PLACEHOLDER; tenant or URL)
#   - ARIA_AZURE_APP_ID set → az-configure-existing-graph-app.sh --apply
#
# Usage:
#   bash scripts/watch-owner-microsoft-and-apply.sh
#   ARIA_WAIT_MAX_MINUTES=720 ARIA_WAIT_POLL_SECONDS=30 bash scripts/watch-owner-microsoft-and-apply.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

MAX_MIN="${ARIA_WAIT_MAX_MINUTES:-720}"
SLEEP_SEC="${ARIA_WAIT_POLL_SECONDS:-30}"
LOG="${ARIA_WATCH_MICROSOFT_LOG:-/tmp/watch-owner-microsoft.log}"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

# shellcheck source=scripts/lib/owner-microsoft-credentials.sh
source "$repo/scripts/lib/owner-microsoft-credentials.sh"

has_microsoft_drop() {
  owner_ms_has_credentials
}

apply_and_exit() {
  log "Applying owner Microsoft / Entra secrets to Fly (includes post-m365 golive)…"
  bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh" || {
    log "fly-apply-owner-microsoft-secrets.sh exit $?"
    exit 1
  }
  touch /tmp/owner-microsoft-applied.ok
  exit 0
}

deadline=$(( $(date +%s) + MAX_MIN * 60 ))
log "Watching up to ${MAX_MIN}m for /tmp/owner-microsoft.env or ARIA_AZURE_APP_ID (noperm-aware)…"

while [ "$(date +%s)" -lt "$deadline" ]; do
  if has_microsoft_drop; then
    rm -f /tmp/az-create-mantu-graph-app.noperm
    apply_and_exit
  fi

  if [ -n "${ARIA_AZURE_APP_ID:-}" ] && [[ "${ARIA_AZURE_APP_ID}" != PLACEHOLDER* ]]; then
    log "ARIA_AZURE_APP_ID set — configuring existing Entra app"
    if bash "$repo/scripts/az-configure-existing-graph-app.sh" --apply; then
      if has_microsoft_drop; then
        apply_and_exit
      fi
    else
      log "WARN: az-configure-existing-graph-app.sh failed — will retry"
    fi
  fi

  # Only attempt az create when noperm latch is absent.
  if [ ! -f /tmp/az-create-mantu-graph-app.noperm ] \
    && command -v az >/dev/null 2>&1 \
    && az account show >/dev/null 2>&1; then
    log "az OK, no noperm — attempting az-create-mantu-graph-app.sh --apply"
    if bash "$repo/scripts/az-create-mantu-graph-app.sh" --apply; then
      if has_microsoft_drop; then
        apply_and_exit
      fi
    else
      log "az-create failed (see noperm marker if Insufficient privileges)"
    fi
  fi

  if [ $(( $(date +%s) % 300 )) -lt "$SLEEP_SEC" ]; then
    if [ -f /tmp/az-create-mantu-graph-app.noperm ]; then
      log "Blocked: noperm latch set — need portal app + /tmp/owner-microsoft.env or ARIA_AZURE_APP_ID"
    else
      log "Waiting for owner Microsoft drop-zone…"
    fi
    bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -E 'MISSING|missing' | tee -a "$LOG" || true
  fi

  sleep "$SLEEP_SEC"
done

log "Timed out after ${MAX_MIN}m — M365 still owner-blocked"
exit 1
