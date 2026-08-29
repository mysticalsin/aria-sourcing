#!/usr/bin/env bash
# owner-microsoft-credentials.sh — shared drop-zone / env detection (no secrets printed).
# Source from watcher, probe, and apply scripts.
set -euo pipefail

owner_ms_repo="${owner_ms_repo:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

owner_ms_is_placeholder() {
  local v="$1"
  case "$v" in
    ""|PLACEHOLDER*|placeholder*|your-*|YOUR-*|changeme|CHANGEME) return 0 ;;
  esac
  case "$v" in
    *PLACEHOLDER*|*placeholder*) return 0 ;;
  esac
  # Monotonous demo/fixture UUIDs are not real Entra app credentials.
  if printf '%s' "$v" | grep -Eqi '^([0-9a-f])\1{7}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
    return 0
  fi
  return 1
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

# Owner may only drop an Entra Application (client) ID; agent configures + mints secret.
owner_ms_read_azure_app_id() {
  local raw=""
  if [ -n "${ARIA_AZURE_APP_ID:-}" ]; then
    raw="${ARIA_AZURE_APP_ID}"
  elif [ -r /tmp/owner-azure-app-id ]; then
    raw="$(tr -d ' \t\r\n' </tmp/owner-azure-app-id | head -c 80)"
  fi
  raw="${raw#\{}"
  raw="${raw%\}}"
  if printf '%s' "$raw" | grep -Eqi '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
    if owner_ms_is_placeholder "$raw"; then
      return 1
    fi
    printf '%s' "$raw"
    return 0
  fi
  return 1
}

owner_ms_has_azure_app_id() {
  owner_ms_read_azure_app_id >/dev/null 2>&1
}

# When Entra admin Registers ARIA Mantu Graph (Fly) and adds Tony as Owner but
# forgets the dropzone file, discover the app via Graph ownedObjects.
# Prints appId on stdout when found; prefers exact "ARIA Mantu Graph (Fly)".
# Throttle Graph calls to ARIA_OWNED_APP_DISCOVER_TTL_SECONDS (default 120).
owner_ms_discover_owned_aria_app_id() {
  command -v az >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1
  az account show >/dev/null 2>&1 || return 1

  local stamp now ttl age cached
  stamp="${ARIA_OWNED_APP_DISCOVER_STAMP:-/tmp/aria-owned-app-discover.stamp}"
  ttl="${ARIA_OWNED_APP_DISCOVER_TTL_SECONDS:-120}"
  case "$ttl" in
    ''|*[!0-9]*) ttl=120 ;;
  esac
  now="$(date +%s)"
  if [ -f "$stamp" ] && [ "${ARIA_OWNED_APP_DISCOVER_FORCE:-0}" != "1" ]; then
    age=$(( now - $(stat -c %Y "$stamp" 2>/dev/null || echo 0) ))
    if [ "$age" -lt "$ttl" ]; then
      if [ -r /tmp/aria-owned-app-discover.last ]; then
        cached="$(tr -d ' \t\r\n' </tmp/aria-owned-app-discover.last | head -c 80)"
        if printf '%s' "$cached" | grep -Eqi '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' \
          && ! owner_ms_is_placeholder "$cached"; then
          printf '%s' "$cached"
          return 0
        fi
      fi
      return 1
    fi
  fi
  touch "$stamp" 2>/dev/null || true

  local json app_id
  set +e
  json="$(az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/me/ownedObjects/microsoft.graph.application?\$select=appId,displayName" \
    -o json 2>/dev/null)"
  set -e
  [ -n "$json" ] || return 1

  # Accept {value:[...]} or a bare array (az/cli quirks).
  app_id="$(
    printf '%s' "$json" | jq -r '
      (if type == "array" then . else (.value // []) end) as $apps
      | [$apps[]?
          | select((.displayName // "") | test("^ARIA Mantu Graph \\(Fly\\)$"; "i"))
          | .appId]
      | .[0] // empty
    ' 2>/dev/null
  )"
  if [ -z "$app_id" ]; then
    app_id="$(
      printf '%s' "$json" | jq -r '
        (if type == "array" then . else (.value // []) end) as $apps
        | [$apps[]?
            | select((.displayName // "") | test("^ARIA Mantu Graph"; "i"))
            | .appId]
        | .[0] // empty
      ' 2>/dev/null
    )"
  fi
  if [ -z "$app_id" ]; then
    rm -f /tmp/aria-owned-app-discover.last 2>/dev/null || true
    return 1
  fi
  if owner_ms_is_placeholder "$app_id"; then
    return 1
  fi
  if ! printf '%s' "$app_id" | grep -Eqi '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
    return 1
  fi
  umask 077
  printf '%s\n' "$app_id" > /tmp/aria-owned-app-discover.last
  chmod 600 /tmp/aria-owned-app-discover.last 2>/dev/null || true
  printf '%s' "$app_id"
  return 0
}

# Materialize /tmp/owner-azure-app-id from owned ARIA app when dropzone absent.
# Returns 0 when a usable app id is now available via owner_ms_has_azure_app_id.
owner_ms_maybe_materialize_owned_app_id() {
  owner_ms_has_azure_app_id && return 0
  local app_id out
  app_id="$(owner_ms_discover_owned_aria_app_id 2>/dev/null)" || return 1
  [ -n "$app_id" ] || return 1
  if owner_ms_is_placeholder "$app_id"; then
    return 1
  fi
  out="${ARIA_OWNER_AZURE_APP_ID_PATH:-/tmp/owner-azure-app-id}"
  umask 077
  printf '%s\n' "$app_id" > "$out"
  chmod 600 "$out"
  printf 'discovered owned ARIA Graph appId=%s → %s\n' "$app_id" "$out"
  return 0
}

# Path of the Insufficient-privileges latch used by az-create-mantu-graph-app.sh.
owner_ms_noperm_latch_path() {
  printf '%s' "${ARIA_AZ_CREATE_NOPERM_LATCH:-/tmp/az-create-mantu-graph-app.noperm}"
}

# Expire the noperm latch so waiters re-attempt create after an admin grants
# Application Developer / flips allowedToCreateApps. Default TTL 5m.
# Prints one line to stdout when cleared (caller may log it). Returns 0 if cleared.
owner_ms_maybe_clear_stale_noperm() {
  local latch ttl age now
  latch="$(owner_ms_noperm_latch_path)"
  [ -f "$latch" ] || return 1
  ttl="${ARIA_NOPERM_LATCH_TTL_SECONDS:-300}"
  case "$ttl" in
    ''|*[!0-9]*) ttl=300 ;;
  esac
  now="$(date +%s)"
  age=$(( now - $(stat -c %Y "$latch" 2>/dev/null || echo "$now") ))
  if [ "$age" -ge "$ttl" ]; then
    rm -f "$latch"
    printf 'cleared stale noperm latch (age=%ss ttl=%ss) — will re-probe az create\n' "$age" "$ttl"
    return 0
  fi
  return 1
}

# Shared flock for Entra configure (redirects/perms/secret mint) + Fly Graph secret apply.
# Waiters, az-configure, and fly-apply must serialize on this path so two tmux
# sessions cannot mint competing client secrets or race peer secret appliers.
owner_ms_configure_apply_lock_path() {
  printf '%s' "${ARIA_M365_CONFIGURE_APPLY_LOCK:-/tmp/aria-m365-configure-apply.lock}"
}

# Exclusive flock so duplicate tmux/agent restarts cannot double-apply Fly secrets.
# Holds FD 9 for the remainder of the process (or until owner_ms_release_singleton_lock).
# Optional 3rd arg: exit code when lock busy (default 0 = idempotent no-op for waiters).
# Nested acquire of the same path is a no-op when ARIA_M365_LOCK_HELD=1 (az-configure --apply → fly-apply).
owner_ms_acquire_singleton_lock() {
  local lockfile="${1:?lockfile required}"
  local name="${2:-process}"
  local busy_exit="${3:-0}"
  if [ "${ARIA_M365_LOCK_HELD:-0}" = "1" ] && [ "${ARIA_M365_LOCK_PATH:-}" = "$lockfile" ]; then
    return 0
  fi
  # shellcheck disable=SC2329
  exec 9>"$lockfile"
  # Close-on-exec so sleep/flyctl children cannot strand the flock after parent exit.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import fcntl, os, sys; fcntl.fcntl(9, fcntl.F_SETFD, fcntl.FD_CLOEXEC)' 2>/dev/null || true
  fi
  if ! flock -n 9; then
    printf 'Another %s already running (%s) — exiting\n' "$name" "$lockfile" >&2
    exit "$busy_exit"
  fi
  export ARIA_M365_LOCK_HELD=1
  export ARIA_M365_LOCK_PATH="$lockfile"
}

# Release FD 9 flock so long seat-waits do not block peer configure/apply.
owner_ms_release_singleton_lock() {
  exec 9>&- 2>/dev/null || true
  unset ARIA_M365_LOCK_HELD ARIA_M365_LOCK_PATH 2>/dev/null || true
}

# True when admin-consent CLI failed and Portal Grant is still required (or SKIP path pending).
owner_ms_admin_consent_needed() {
  [ -f "${ARIA_GRAPH_ADMIN_CONSENT_NEEDED:-/tmp/az-graph-admin-consent.needed}" ]
}

owner_ms_admin_consent_portal_granted() {
  [ -f "${ARIA_GRAPH_ADMIN_CONSENT_PORTAL_GRANTED:-/tmp/az-graph-admin-consent.portal-granted}" ]
}

# After Portal Grant admin consent, non-GA accounts cannot re-run az admin-consent.
# Export SKIP so configure can mint + apply once scopes are on the app.
# Requires portal-granted marker OR aged needed latch (default 60s) so we do not
# mint on the same tick as the first CLI consent failure.
# Callers should log when this returns 0.
owner_ms_export_skip_admin_consent_if_needed() {
  local needed ttl age now
  needed="${ARIA_GRAPH_ADMIN_CONSENT_NEEDED:-/tmp/az-graph-admin-consent.needed}"
  owner_ms_admin_consent_needed || return 1
  if owner_ms_admin_consent_portal_granted; then
    export ARIA_GRAPH_SKIP_ADMIN_CONSENT=1
    return 0
  fi
  ttl="${ARIA_GRAPH_CONSENT_SKIP_TTL_SECONDS:-60}"
  case "$ttl" in
    ''|*[!0-9]*) ttl=60 ;;
  esac
  now="$(date +%s)"
  age=$(( now - $(stat -c %Y "$needed" 2>/dev/null || echo "$now") ))
  if [ "$age" -ge "$ttl" ]; then
    export ARIA_GRAPH_SKIP_ADMIN_CONSENT=1
    return 0
  fi
  return 1
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
