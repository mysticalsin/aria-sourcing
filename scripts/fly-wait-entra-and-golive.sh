#!/usr/bin/env bash
# fly-wait-entra-and-golive.sh — poll for unlock signals, then apply + golive.
#
# Safe to run in tmux for hours. Never invents Azure secrets or deploy confirm.
#
# Unblock triggers (any one):
#   - az account show succeeds (owner completed device-code MFA)
#   - /tmp/owner-azure-app-id or ARIA_AZURE_APP_ID (agent configures + mints secret)
#   - /tmp/owner-microsoft.env Graph-minimum (Entra PLACEHOLDER OK)
#   - /tmp/owner-deploy-confirm.env (or production-readiness/.owner-deploy-confirm.env)
#     with a real ARIA_PROD_DEPLOY_CONFIRM (tip deploy for Graph/ready even if
#     Microsoft secrets are still pending — E2E still fail-closes on OAuth)
#
# Usage:
#   bash scripts/fly-wait-entra-and-golive.sh
#   ARIA_SKIP_AZ_DEVICE_REFRESH=1 ARIA_WAIT_MAX_MINUTES=360 bash scripts/fly-wait-entra-and-golive.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

MAX_MIN="${ARIA_WAIT_MAX_MINUTES:-240}"
SLEEP_SEC="${ARIA_WAIT_POLL_SECONDS:-30}"
LOG="${ARIA_WAIT_LOG:-/tmp/fly-wait-entra.log}"
SKIP_DEVICE_REFRESH="${ARIA_SKIP_AZ_DEVICE_REFRESH:-0}"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

# shellcheck source=scripts/lib/owner-microsoft-credentials.sh
source "$repo/scripts/lib/owner-microsoft-credentials.sh"

has_microsoft_drop() {
  # Graph-minimum: MICROSOFT_CLIENT_ID/SECRET (+ TENANT) via drop-zone or exports.
  # Entra PLACEHOLDER lines are OK (owner_ms_has_credentials / Graph-only PASS).
  owner_ms_has_credentials
}

has_azure_app_id_drop() {
  owner_ms_has_azure_app_id
}

has_deploy_confirm_drop() {
  local f
  for f in /tmp/owner-deploy-confirm.env "$repo/production-readiness/.owner-deploy-confirm.env"; do
    if [ -r "$f" ] && grep -q 'ARIA_PROD_DEPLOY_CONFIRM=' "$f" 2>/dev/null \
      && ! grep -q 'PLACEHOLDER' "$f" 2>/dev/null; then
      return 0
    fi
  done
  [ -n "${ARIA_PROD_DEPLOY_CONFIRM:-}" ] && [[ "${ARIA_PROD_DEPLOY_CONFIRM}" != PLACEHOLDER* ]]
}

refresh_device_code_if_needed() {
  [ "$SKIP_DEVICE_REFRESH" = "1" ] && return 0
  command -v az >/dev/null 2>&1 || return 0
  az account show >/dev/null 2>&1 && return 0
  local age=99999
  if [ -f /tmp/az-device.log ]; then
    age=$(( $(date +%s) - $(stat -c %Y /tmp/az-device.log 2>/dev/null || echo 0) ))
  fi
  if [ "$age" -lt 720 ] && grep -q 'enter the code' /tmp/az-device.log 2>/dev/null; then
    return 0
  fi
  log "Refreshing Azure device-code login…"
  if tmux -f /exec-daemon/tmux.portal.conf has-session -t "=az-device-login" 2>/dev/null \
    || tmux has-session -t az-device-login 2>/dev/null; then
    tmux -f /exec-daemon/tmux.portal.conf send-keys -t az-device-login C-c 2>/dev/null || true
    sleep 1
    rm -f /tmp/az-device.ok /tmp/az-device.log
    tmux -f /exec-daemon/tmux.portal.conf send-keys -t az-device-login \
      'az logout 2>/dev/null; if az login --use-device-code --allow-no-subscriptions 2>&1 | tee /tmp/az-device.log; then echo EXIT:0 | tee -a /tmp/az-device.log; touch /tmp/az-device.ok; else echo EXIT:$? | tee -a /tmp/az-device.log; rm -f /tmp/az-device.ok; fi' C-m \
      2>/dev/null || true
  fi
}

print_device_code() {
  [ "$SKIP_DEVICE_REFRESH" = "1" ] && return 0
  if [ -f /tmp/az-device.log ] && grep -q 'enter the code' /tmp/az-device.log 2>/dev/null; then
    log "Device login: $(grep -oE 'https://login.microsoft.com/device|code [A-Z0-9]+' /tmp/az-device.log | tr '\n' ' ')"
  fi
}

run_golive() {
  bash "$repo/scripts/fly-enterprise-golive-when-ready.sh"
}

deadline=$(( $(date +%s) + MAX_MIN * 60 ))
log "Waiting up to ${MAX_MIN}m for Entra drop-zone and/or deploy-confirm drop-zone…"
refresh_device_code_if_needed
print_device_code

while [ "$(date +%s)" -lt "$deadline" ]; do
  # Owner-supplied Microsoft drop-zone / env always wins (and clears noperm latch).
  if has_microsoft_drop; then
    rm -f /tmp/az-create-mantu-graph-app.noperm
    log "owner-microsoft drop-zone/env present — applying + golive"
    if run_golive; then
      exit 0
    fi
    log "Golive incomplete after microsoft apply; will retry."
  elif has_azure_app_id_drop; then
    rm -f /tmp/az-create-mantu-graph-app.noperm
    log "owner-azure-app-id present — configure + mint + apply via probe --apply"
    if bash "$repo/scripts/probe-m365-unblock.sh" --apply; then
      if run_golive; then
        exit 0
      fi
      log "Graph secrets applied from app id; golive incomplete — Connect Outlook may still be needed."
    else
      log "WARN: probe --apply from azure-app-id failed; will retry."
    fi
  elif has_deploy_confirm_drop; then
    # Deploy-confirm alone does not unblock Graph. Only remint-deploy when tip_ahead_app.
    # tip_ahead_docs / tip_live → wait for owner-azure-app-id / owner-microsoft.env (no golive spam).
    status="$(bash "$repo/scripts/print-fly-golive-status.sh" 2>/dev/null || true)"
    if printf '%s\n' "$status" | grep -q 'deploy_status=tip_ahead_app'; then
      log "deploy-confirm present + tip_ahead_app — tip golive"
      if run_golive; then
        exit 0
      fi
      log "Golive incomplete with confirm present; will retry."
    elif [ $(( $(date +%s) % 300 )) -lt "$SLEEP_SEC" ]; then
      log "confirm present but no tip_ahead_app — waiting for /tmp/owner-azure-app-id or /tmp/owner-microsoft.env (Graph PASS blocker)"
    fi
  elif az account show >/dev/null 2>&1; then
    if msg="$(owner_ms_maybe_clear_stale_noperm 2>/dev/null)"; then
      [ -n "$msg" ] && log "$msg"
    fi
    if [ -f /tmp/az-create-mantu-graph-app.noperm ]; then
      if owner_ms_has_azure_app_id; then
        log "noperm but azure app id set — configuring existing Entra app"
        if bash "$repo/scripts/fly-m365-from-azure-app-id.sh"; then
          if run_golive; then exit 0; fi
        fi
      elif [ -n "${ARIA_AZURE_APP_ID:-}" ]; then
        log "noperm but ARIA_AZURE_APP_ID set — configuring existing Entra app"
        if bash "$repo/scripts/az-configure-existing-graph-app.sh" --apply; then
          if run_golive; then exit 0; fi
        fi
      fi
      if [ $(( $(date +%s) % 300 )) -lt "$SLEEP_SEC" ]; then
        log "az OK but cannot create apps (noperm) — Entra admin must register (or grant Application Developer) → /tmp/owner-azure-app-id or /tmp/owner-microsoft.env"
        bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -E 'MISSING|missing' | tee -a "$LOG" || true
        bash "$repo/scripts/print-fly-deploy-confirm.sh" 2>/dev/null | head -6 | tee -a "$LOG" || true
      fi
    else
      log "az login OK — minting Graph app + applying Fly secrets"
      if ! bash "$repo/scripts/az-create-mantu-graph-app.sh" --apply; then
        log "WARN: az-create failed (see /tmp/az-create-mantu-graph-app.noperm if privileges)"
      fi
      if run_golive; then
        exit 0
      fi
      log "Golive incomplete after az mint — need /tmp/owner-deploy-confirm.env?"
    fi
  else
    refresh_device_code_if_needed
    if [ $(( $(date +%s) % 300 )) -lt "$SLEEP_SEC" ]; then
      print_device_code
      bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -E 'MISSING|missing' | tee -a "$LOG" || true
      log "Waiting for /tmp/owner-azure-app-id and/or /tmp/owner-microsoft.env and/or deploy-confirm"
    fi
  fi
  sleep "$SLEEP_SEC"
done

log "Timed out after ${MAX_MIN}m still blocked."
run_golive || true
exit 1
