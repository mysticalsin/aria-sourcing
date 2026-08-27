#!/usr/bin/env bash
# fly-wait-entra-and-golive.sh — poll for Entra unlock, then apply + golive.
#
# Safe to run in tmux for hours. Never invents Azure secrets or deploy confirm.
#
# Unblock triggers (any one):
#   - az account show succeeds (owner completed device-code MFA)
#   - /tmp/owner-microsoft.env or production-readiness/.owner-microsoft.env exists
#     without PLACEHOLDER values
#
# After Microsoft secrets are applied, deploys only if ARIA_PROD_DEPLOY_CONFIRM
# is already exported or present in /tmp/owner-deploy-confirm.env.
#
# Usage:
#   bash scripts/fly-wait-entra-and-golive.sh
#   ARIA_WAIT_MAX_MINUTES=180 bash scripts/fly-wait-entra-and-golive.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

MAX_MIN="${ARIA_WAIT_MAX_MINUTES:-240}"
SLEEP_SEC="${ARIA_WAIT_POLL_SECONDS:-30}"
LOG="${ARIA_WAIT_LOG:-/tmp/fly-wait-entra.log}"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

has_microsoft_drop() {
  local f
  for f in /tmp/owner-microsoft.env "$repo/production-readiness/.owner-microsoft.env"; do
    if [ -r "$f" ] && ! grep -q 'PLACEHOLDER' "$f" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

refresh_device_code_if_needed() {
  command -v az >/dev/null 2>&1 || return 0
  az account show >/dev/null 2>&1 && return 0
  local age=99999
  if [ -f /tmp/az-device.log ]; then
    age=$(( $(date +%s) - $(stat -c %Y /tmp/az-device.log 2>/dev/null || echo 0) ))
  fi
  # Refresh ~every 12 minutes so owner always has a usable code.
  if [ "$age" -lt 720 ] && grep -q 'enter the code' /tmp/az-device.log 2>/dev/null; then
    return 0
  fi
  log "Refreshing Azure device-code login…"
  # Best-effort: if tmux session exists, drive it; else start foreground backgrounded login.
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
  if [ -f /tmp/az-device.log ] && grep -q 'enter the code' /tmp/az-device.log 2>/dev/null; then
    log "Device login: $(grep -oE 'https://login.microsoft.com/device|code [A-Z0-9]+' /tmp/az-device.log | tr '\n' ' ')"
  fi
}

deadline=$(( $(date +%s) + MAX_MIN * 60 ))
log "Waiting up to ${MAX_MIN}m for Entra unlock (az login or owner-microsoft.env)…"
refresh_device_code_if_needed
print_device_code

while [ "$(date +%s)" -lt "$deadline" ]; do
  if az account show >/dev/null 2>&1; then
    log "az login OK — minting Graph app + applying Fly secrets"
    bash "$repo/scripts/az-create-mantu-graph-app.sh" --apply
    bash "$repo/scripts/fly-enterprise-golive-when-ready.sh" && exit 0
    log "Golive incomplete (likely deploy confirm still unset). Waiting for /tmp/owner-deploy-confirm.env…"
  elif has_microsoft_drop; then
    log "owner-microsoft drop-zone present — applying + golive"
    bash "$repo/scripts/fly-enterprise-golive-when-ready.sh" && exit 0
    log "Golive incomplete after drop-zone apply; will retry."
  else
    refresh_device_code_if_needed
    if [ $(( $(date +%s) % 300 )) -lt "$SLEEP_SEC" ]; then
      print_device_code
      bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -E 'MISSING|missing' | tee -a "$LOG" || true
    fi
  fi
  sleep "$SLEEP_SEC"
done

log "Timed out after ${MAX_MIN}m still blocked on Entra / deploy confirm."
bash "$repo/scripts/fly-enterprise-golive-when-ready.sh" || true
exit 1
