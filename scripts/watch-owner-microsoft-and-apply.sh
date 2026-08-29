#!/usr/bin/env bash
# watch-owner-microsoft-and-apply.sh — poll for owner M365 drop-zone, then apply.
#
# Respects /tmp/az-create-mantu-graph-app.noperm (does NOT spam az ad app create).
# Safe for long-running tmux. Never invents secrets.
#
# Unblock triggers (any one):
#   - /tmp/owner-microsoft.env or production-readiness/.owner-microsoft.env
#     with Graph MICROSOFT_* real (Entra GOTRUE_* optional / PLACEHOLDER OK)
#   - exported MICROSOFT_* Graph-minimum (GOTRUE_* optional; tenant required)
#   - /tmp/owner-azure-app-id or ARIA_AZURE_APP_ID → configure + mint + apply
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
owner_ms_acquire_singleton_lock "${ARIA_WATCH_MICROSOFT_LOCK:-/tmp/aria-watch-owner-microsoft.lock}" \
  "watch-owner-microsoft-and-apply"

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
  log "Secrets on Fly. Waiting for Settings → Connect Outlook (live) + Graph webhook, then strict verify…"

  # Remaining watch budget (at least 30m) for the interactive Connect Outlook step.
  local now remain_sec wait_seat
  now="$(date +%s)"
  remain_sec=$(( deadline - now ))
  if [ "$remain_sec" -lt 1800 ]; then
    remain_sec=1800
  fi
  wait_seat="${ARIA_WAIT_LIVE_SEAT_SECONDS:-$remain_sec}"
  log "ARIA_WAIT_LIVE_SEAT_SECONDS=${wait_seat} (poll until live Graph seat, then verify-m365-ready + strict E2E)"
  if ARIA_WAIT_LIVE_SEAT_SECONDS="$wait_seat" bash "$repo/scripts/post-m365-secrets-golive.sh"; then
    touch /tmp/owner-microsoft-strict-pass.ok
    log "RESULT: strict M365 golive PASS (verify + E2E)"
    exit 0
  fi
  rc=$?
  log "post-m365-secrets-golive after seat-wait exit $rc — Connect Outlook may still be pending"
  echo "  Open https://aria-mantu-app.fly.dev/settings → Connect Outlook → Enable webhook" | tee -a "$LOG"
  echo "  Then: bash scripts/verify-m365-ready.sh" | tee -a "$LOG"
  exit "$rc"
}

deadline=$(( $(date +%s) + MAX_MIN * 60 ))
log "Watching up to ${MAX_MIN}m for /tmp/owner-microsoft.env or /tmp/owner-azure-app-id (noperm-aware)…"

while [ "$(date +%s)" -lt "$deadline" ]; do
  if has_microsoft_drop; then
    rm -f /tmp/az-create-mantu-graph-app.noperm
    apply_and_exit
  fi

  if owner_ms_has_azure_app_id; then
    log "owner-azure-app-id / ARIA_AZURE_APP_ID present — configure + mint + apply"
    export ARIA_AZURE_APP_ID
    ARIA_AZURE_APP_ID="$(owner_ms_read_azure_app_id)"
    if bash "$repo/scripts/fly-m365-from-azure-app-id.sh"; then
      if has_microsoft_drop; then
        apply_and_exit
      fi
      # fly-m365 already applied; still wait for Connect Outlook via post-golive
      touch /tmp/owner-microsoft-applied.ok
      now="$(date +%s)"
      remain_sec=$(( deadline - now ))
      if [ "$remain_sec" -lt 1800 ]; then remain_sec=1800; fi
      wait_seat="${ARIA_WAIT_LIVE_SEAT_SECONDS:-$remain_sec}"
      log "ARIA_WAIT_LIVE_SEAT_SECONDS=${wait_seat} after azure-app-id apply"
      if ARIA_WAIT_LIVE_SEAT_SECONDS="$wait_seat" bash "$repo/scripts/post-m365-secrets-golive.sh"; then
        touch /tmp/owner-microsoft-strict-pass.ok
        log "RESULT: strict M365 golive PASS (verify + E2E)"
        exit 0
      fi
      rc=$?
      log "post-m365-secrets-golive exit $rc — Connect Outlook may still be pending"
      echo "  Open https://aria-mantu-app.fly.dev/settings → Connect Outlook → Enable webhook" | tee -a "$LOG"
      exit "$rc"
    else
      log "WARN: fly-m365-from-azure-app-id failed — will retry"
    fi
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

  # Expire stale noperm so Application Developer / allowedToCreateApps grants are detected.
  if msg="$(owner_ms_maybe_clear_stale_noperm 2>/dev/null)"; then
    [ -n "$msg" ] && log "$msg"
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
      log "Blocked: noperm latch set — Entra admin must register app (or grant Application Developer) → /tmp/owner-azure-app-id or /tmp/owner-microsoft.env"
    else
      log "Waiting for owner Microsoft drop-zone…"
    fi
    bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -E 'MISSING|missing' | tee -a "$LOG" || true
  fi

  sleep "$SLEEP_SEC"
done

log "Timed out after ${MAX_MIN}m — M365 still owner-blocked"
exit 1
