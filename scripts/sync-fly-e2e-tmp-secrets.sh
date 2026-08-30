#!/usr/bin/env bash
# sync-fly-e2e-tmp-secrets.sh — refresh agent-local /tmp E2E helpers from Fly.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d "\n\r " < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN required" >&2; exit 1; }
FLYBIN="$(command -v flyctl || command -v fly)"
[ -n "$FLYBIN" ] || { echo "flyctl required" >&2; exit 1; }

pull_env() {
  local name="$1" out="$2" raw val
  raw="$($FLYBIN ssh console -a aria-mantu-app -C "printenv $name" 2>/dev/null || true)"
  val="$(printf "%s\n" "$raw" | tr -d "\r" | grep -E "^eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$" | tail -1 || true)"
  if [ -z "$val" ]; then
    val="$(printf "%s\n" "$raw" | tr -d "\r" | grep -E "^[0-9a-fA-F]{32,}$" | tail -1 || true)"
  fi
  if [ -z "$val" ]; then
    echo "WARN: could not read $name from aria-mantu-app" >&2
    return 1
  fi
  umask 077
  printf "%s" "$val" > "$out"
  chmod 600 "$out"
  echo "synced $name -> $out (len=${#val})"
}

pull_env EMAIL_INBOUND_WEBHOOK_SECRET /tmp/aria-e2e-webhook-secret || true
pull_env CRON_SECRET /tmp/aria-e2e-cron-secret || true
pull_env SUPABASE_SERVICE_ROLE_KEY /tmp/aria-e2e-service-role || true
echo "Done. Microsoft/Entra secrets remain owner-only (/tmp/owner-microsoft.env)."
