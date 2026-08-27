#!/usr/bin/env bash
# sync-fly-e2e-tmp-secrets.sh — refresh agent-local /tmp E2E helpers from Fly.
#
# Syncs non-Azure operational secrets the agent is allowed to manage:
#   EMAIL_INBOUND_WEBHOOK_SECRET → /tmp/aria-e2e-webhook-secret
#   CRON_SECRET                  → /tmp/aria-e2e-cron-secret
#   SUPABASE_SERVICE_ROLE_KEY    → /tmp/aria-e2e-service-role
# Does NOT touch MICROSOFT_* / GOTRUE_EXTERNAL_AZURE_* (owner-only).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN required" >&2; exit 1; }
command -v flyctl >/dev/null 2>&1 || command -v fly >/dev/null 2>&1 || {
  echo "flyctl required" >&2
  exit 1
}
FLYBIN="$(command -v flyctl || command -v fly)"

pull_env() {
  local name="$1" out="$2"
  local raw val
  raw="$($FLYBIN ssh console -a aria-mantu-app -C "printenv $name" 2>/dev/null || true)"
  # Prefer JWT lines (service role), else longest secret-looking token.
  val="$(printf '%s\n' "$raw" | tr -d '\r' | awk '
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ { print; found=1 }
    END { if (!found) exit 1 }
  ' 2>/dev/null || true)"
  if [ -z "$val" ]; then
    val="$(printf '%s\n' "$raw" | tr -d '\r' | awk '
      /^[A-Za-z0-9+/=_-]{16,}$/ { if (length($0) > bestlen) { best=$0; bestlen=length($0) } }
      END { if (bestlen >= 16) print best }
    ')"
  fi
  if [ -z "$val" ]; then
    echo "WARN: could not read $name from aria-mantu-app" >&2
    return 1
  fi
  umask 077
  printf '%s' "$val" > "$out"
  chmod 600 "$out"
  echo "synced $name → $out (len=${#val})"
}

pull_env EMAIL_INBOUND_WEBHOOK_SECRET /tmp/aria-e2e-webhook-secret || true
pull_env CRON_SECRET /tmp/aria-e2e-cron-secret || true
pull_env SUPABASE_SERVICE_ROLE_KEY /tmp/aria-e2e-service-role || true

echo "Done. Admin credentials remain in /tmp/aria-e2e-admin-email|password (not overwritten)."
echo "Microsoft/Entra secrets are owner-only — use /tmp/owner-microsoft.env."
