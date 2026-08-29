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
  # Graph/Outlook secrets are enough to remint microsoftOAuth (Entra SSO lines may
  # still be PLACEHOLDER). Reject only when required Graph fields are missing/placeholder.
  local f
  for f in /tmp/owner-microsoft.env "$owner_ms_repo/production-readiness/.owner-microsoft.env"; do
    [ -r "$f" ] || continue
    if (
      set -a
      # shellcheck disable=SC1090
      source "$f"
      set +a
      owner_ms_is_placeholder "${MICROSOFT_CLIENT_ID:-}" && exit 1
      owner_ms_is_placeholder "${MICROSOFT_CLIENT_SECRET:-}" && exit 1
      if owner_ms_is_placeholder "${MICROSOFT_TENANT_ID:-}"; then
        owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_URL:-}" && exit 1
      fi
      exit 0
    ); then
      return 0
    fi
  done
  return 1
}

owner_ms_has_env_exports() {
  # Match fly-apply Graph requirements (tenant or Azure URL). Entra SSO is optional.
  owner_ms_is_placeholder "${MICROSOFT_CLIENT_ID:-}" && return 1
  owner_ms_is_placeholder "${MICROSOFT_CLIENT_SECRET:-}" && return 1
  if owner_ms_is_placeholder "${MICROSOFT_TENANT_ID:-}"; then
    owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_URL:-}" && return 1
  fi
  return 0
}

owner_ms_has_credentials() {
  owner_ms_has_drop_file || owner_ms_has_env_exports
}

# Persist env exports to drop-zone (mode 600) so watcher/remint survive shell restarts.
owner_ms_sync_env_to_dropzone() {
  local out="${OWNER_MICROSOFT_ENV:-/tmp/owner-microsoft.env}"
  owner_ms_has_env_exports || return 1
  if [ -r "$out" ] && (
    set -a
    # shellcheck disable=SC1090
    source "$out"
    set +a
    owner_ms_is_placeholder "${MICROSOFT_CLIENT_ID:-}" && exit 1
    owner_ms_is_placeholder "${MICROSOFT_CLIENT_SECRET:-}" && exit 1
    if owner_ms_is_placeholder "${MICROSOFT_TENANT_ID:-}"; then
      owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_URL:-}" && exit 1
    fi
    exit 0
  ); then
    return 0
  fi
  local tenant="${MICROSOFT_TENANT_ID:-}"
  if owner_ms_is_placeholder "$tenant"; then
    tenant="$(
      node -e '
        const u = process.argv[1] || "";
        try {
          const path = new URL(u).pathname.replace(/^\/+|\/+$/g, "");
          const t = (path.split("/")[0] || "").toLowerCase();
          if (/^[0-9a-f-]{36}$/i.test(t)) process.stdout.write(t);
        } catch {}
      ' "${GOTRUE_EXTERNAL_AZURE_URL:-}"
    )"
  fi
  owner_ms_is_placeholder "$tenant" && return 1
  local enabled="${GOTRUE_EXTERNAL_AZURE_ENABLED:-true}"
  owner_ms_is_placeholder "$enabled" && enabled="true"
  umask 077
  {
    echo "# Synced from env exports by probe-m365-unblock — NEVER commit"
    echo "MICROSOFT_CLIENT_ID=${MICROSOFT_CLIENT_ID}"
    echo "MICROSOFT_CLIENT_SECRET=${MICROSOFT_CLIENT_SECRET}"
    echo "MICROSOFT_REDIRECT_URI=${MICROSOFT_REDIRECT_URI:-https://aria-mantu-app.fly.dev/auth/microsoft/callback}"
    echo "MICROSOFT_TENANT_ID=${tenant}"
    if ! owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_CLIENT_ID:-}" \
      && ! owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_SECRET:-}" \
      && ! owner_ms_is_placeholder "${GOTRUE_EXTERNAL_AZURE_URL:-}"; then
      echo "GOTRUE_EXTERNAL_AZURE_ENABLED=${enabled}"
      echo "GOTRUE_EXTERNAL_AZURE_CLIENT_ID=${GOTRUE_EXTERNAL_AZURE_CLIENT_ID}"
      echo "GOTRUE_EXTERNAL_AZURE_SECRET=${GOTRUE_EXTERNAL_AZURE_SECRET}"
      echo "GOTRUE_EXTERNAL_AZURE_URL=${GOTRUE_EXTERNAL_AZURE_URL}"
    fi
  } > "$out"
  chmod 600 "$out"
}
