#!/usr/bin/env bash
# owner-microsoft-credentials.sh — shared drop-zone / env detection (no secrets printed).
# Source from watcher, probe, and apply scripts.
set -euo pipefail

owner_ms_repo="${owner_ms_repo:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

owner_ms_is_placeholder() {
  local v="$1"
  case "$v" in
    ""|PLACEHOLDER*|placeholder*|your-*|YOUR-*|changeme|CHANGEME) return 0 ;;
    *) return 1 ;;
  esac
}

owner_ms_has_drop_file() {
  local f
  for f in /tmp/owner-microsoft.env "$owner_ms_repo/production-readiness/.owner-microsoft.env"; do
    if [ -r "$f" ] && ! grep -q 'PLACEHOLDER' "$f" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

owner_ms_has_env_exports() {
  owner_ms_is_placeholder "${MICROSOFT_CLIENT_ID:-}" && return 1
  owner_ms_is_placeholder "${MICROSOFT_CLIENT_SECRET:-}" && return 1
  if owner_ms_is_placeholder "${MICROSOFT_TENANT_ID:-}"; then
    owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_URL:-}" && return 1
  fi
  owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_CLIENT_ID:-}" && return 1
  owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_SECRET:-}" && return 1
  owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_URL:-}" && return 1
  if [ -n "${GOTRUE_EXTERNAL_AZURE_ENABLED:-}" ] \
    && owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_ENABLED}"; then
    return 1
  fi
  return 0
}

owner_ms_has_credentials() {
  owner_ms_has_drop_file || owner_ms_has_env_exports
}
