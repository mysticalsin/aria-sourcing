#!/usr/bin/env bash
# fly-apply-owner-microsoft-secrets.sh — apply owner-supplied Azure secrets to Fly.
#
# Does NOT invent credentials. Reads values from (in order):
#   1) /tmp/owner-microsoft.env          (agent VM drop-zone; never commit)
#   2) production-readiness/.owner-microsoft.env  (gitignored local file)
#   3) already-exported shell environment
# Refuses empty / PLACEHOLDER_* values.
#
# Required for Graph/Outlook on aria-mantu-app:
#   MICROSOFT_CLIENT_ID
#   MICROSOFT_CLIENT_SECRET
#   MICROSOFT_TENANT_ID  (or derivable from GOTRUE_EXTERNAL_AZURE_URL)
# Optional (defaults to public Fly callback):
#   MICROSOFT_REDIRECT_URI
#
# Required together for Entra SSO on aria-mantu-auth (CLIENT_ID+SECRET+URL all real):
#   GOTRUE_EXTERNAL_AZURE_CLIENT_ID
#   GOTRUE_EXTERNAL_AZURE_SECRET
#   GOTRUE_EXTERNAL_AZURE_URL
# Optional:
#   GOTRUE_EXTERNAL_AZURE_ENABLED  (default: true when applying Entra block)
# Graph-minimum: leave CLIENT_ID+SECRET as PLACEHOLDER to skip SSO. A real
# GOTRUE_EXTERNAL_AZURE_URL alone may still derive MICROSOFT_TENANT_ID.
#
# Usage:
#   # Option A — export in shell
#   export MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
#   export GOTRUE_EXTERNAL_AZURE_CLIENT_ID=... GOTRUE_EXTERNAL_AZURE_SECRET=...
#   export GOTRUE_EXTERNAL_AZURE_URL='https://login.microsoftonline.com/<tenant>/v2.0'
#   bash scripts/fly-apply-owner-microsoft-secrets.sh
#
#   # Option B — drop a KEY=value file (never commit):
#   cp production-readiness/.owner-microsoft.env.example /tmp/owner-microsoft.env
#   # edit real values into /tmp/owner-microsoft.env
#   bash scripts/fly-apply-owner-microsoft-secrets.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

# shellcheck source=scripts/lib/owner-microsoft-credentials.sh
source "$repo/scripts/lib/owner-microsoft-credentials.sh"
# Busy exit 4 so concurrent waiters/probe do not race secret set + golive.
owner_ms_acquire_singleton_lock "${ARIA_APPLY_MICROSOFT_LOCK:-/tmp/aria-fly-apply-owner-microsoft.lock}" \
  "fly-apply-owner-microsoft-secrets" 4

load_owner_env_file() {
  local path="$1"
  [ -r "$path" ] || return 0
  echo "Loading owner secrets from $path (values not printed)"
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}

# Gitignored local file first, then VM drop-zone. /tmp wins so watcher/probe
# primary path cannot be clobbered by a stale production-readiness copy.
# Shell exports already present are overridden by whichever files exist.
load_owner_env_file "$repo/production-readiness/.owner-microsoft.env"
load_owner_env_file "/tmp/owner-microsoft.env"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN or .fly-token.env required" >&2; exit 1; }
command -v flyctl >/dev/null 2>&1 || { echo "flyctl required" >&2; exit 1; }

is_placeholder() {
  local v="$1"
  case "$v" in
    ""|PLACEHOLDER*|placeholder*|your-*|YOUR-*|changeme|CHANGEME) return 0 ;;
  esac
  # Embed tokens (e.g. Azure URL with PLACEHOLDER_TENANT_ID) also count as unset.
  case "$v" in
    *PLACEHOLDER*|*placeholder*) return 0 ;;
  esac
  # Monotonous demo/fixture UUIDs (11111111-1111-4111-8111-111111111111) look "set"
  # but break Connect Outlook authorize at Microsoft — refuse apply.
  if printf '%s' "$v" | grep -Eqi '^([0-9a-f])\1{7}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
    return 0
  fi
  return 1
}

require_real() {
  local name="$1" value="${2:-}"
  if is_placeholder "$value"; then
    echo "ERROR: $name is missing or still a PLACEHOLDER — export a real Azure value first." >&2
    exit 1
  fi
}

MS_ID="${MICROSOFT_CLIENT_ID:-}"
MS_SECRET="${MICROSOFT_CLIENT_SECRET:-}"
MS_REDIRECT="${MICROSOFT_REDIRECT_URI:-https://aria-mantu-app.fly.dev/auth/microsoft/callback}"
MS_TENANT="${MICROSOFT_TENANT_ID:-}"

require_real MICROSOFT_CLIENT_ID "$MS_ID"
require_real MICROSOFT_CLIENT_SECRET "$MS_SECRET"
require_real MICROSOFT_REDIRECT_URI "$MS_REDIRECT"

# Derive tenant from GoTrue Azure URL when not explicit (required for single-tenant Graph OAuth).
if is_placeholder "$MS_TENANT"; then
  ENTRA_URL_FOR_TENANT="${GOTRUE_EXTERNAL_AZURE_URL:-}"
  if ! is_placeholder "$ENTRA_URL_FOR_TENANT"; then
    MS_TENANT="$(
      node -e '
        const u = process.argv[1] || "";
        try {
          const path = new URL(u).pathname.replace(/^\/+|\/+$/g, "");
          const t = (path.split("/")[0] || "").toLowerCase();
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)) {
            process.stdout.write(t);
          }
        } catch {}
      ' "$ENTRA_URL_FOR_TENANT"
    )"
  fi
fi
if is_placeholder "$MS_TENANT"; then
  echo "ERROR: MICROSOFT_TENANT_ID missing — set it or GOTRUE_EXTERNAL_AZURE_URL with tenant GUID." >&2
  echo "       Single-tenant apps break with /common/ OAuth (AADSTS50194)." >&2
  exit 1
fi

case "$MS_REDIRECT" in
  https://aria-mantu-app.fly.dev/auth/microsoft/callback) ;;
  https://*) ;;
  *)
    echo "ERROR: MICROSOFT_REDIRECT_URI must be an https public callback URL." >&2
    exit 1
    ;;
esac

echo "=== Applying Microsoft Graph secrets to aria-mantu-app ==="
# Values passed via env to flyctl; not echoed.
flyctl secrets set -a aria-mantu-app \
  "MICROSOFT_CLIENT_ID=${MS_ID}" \
  "MICROSOFT_CLIENT_SECRET=${MS_SECRET}" \
  "MICROSOFT_REDIRECT_URI=${MS_REDIRECT}" \
  "MICROSOFT_TENANT_ID=${MS_TENANT}"

ENTRA_ID="${GOTRUE_EXTERNAL_AZURE_CLIENT_ID:-}"
ENTRA_SECRET="${GOTRUE_EXTERNAL_AZURE_SECRET:-}"
ENTRA_URL="${GOTRUE_EXTERNAL_AZURE_URL:-}"
ENTRA_ENABLED="${GOTRUE_EXTERNAL_AZURE_ENABLED:-true}"

# Entra SSO is all-or-nothing on CLIENT_ID + SECRET + URL.
# A real Azure URL alone is OK for MICROSOFT_TENANT_ID derivation above — it must
# NOT count as "partial Entra" when CLIENT_ID/SECRET stay PLACEHOLDER (Graph-minimum).
entra_id_real=0
entra_secret_real=0
entra_url_real=0
is_placeholder "$ENTRA_ID" || entra_id_real=1
is_placeholder "$ENTRA_SECRET" || entra_secret_real=1
is_placeholder "$ENTRA_URL" || entra_url_real=1

if [ "$entra_id_real" = "0" ] && [ "$entra_secret_real" = "0" ]; then
  echo "=== Skipping Entra (GOTRUE CLIENT_ID/SECRET PLACEHOLDER/empty — Graph-only OK for E2E PASS) ==="
  if [ "$entra_url_real" = "1" ]; then
    echo "    Note: GOTRUE_EXTERNAL_AZURE_URL was used only to derive MICROSOFT_TENANT_ID; SSO not applied."
  fi
  echo "    Tip deploy will keep NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false until Entra is set."
elif [ "$entra_id_real" = "1" ] && [ "$entra_secret_real" = "1" ] && [ "$entra_url_real" = "1" ]; then
  echo "=== Applying Entra / GoTrue Azure secrets to aria-mantu-auth ==="
  require_real GOTRUE_EXTERNAL_AZURE_ENABLED "$ENTRA_ENABLED"
  flyctl secrets set -a aria-mantu-auth \
    "GOTRUE_EXTERNAL_AZURE_ENABLED=${ENTRA_ENABLED}" \
    "GOTRUE_EXTERNAL_AZURE_CLIENT_ID=${ENTRA_ID}" \
    "GOTRUE_EXTERNAL_AZURE_SECRET=${ENTRA_SECRET}" \
    "GOTRUE_EXTERNAL_AZURE_URL=${ENTRA_URL}"
else
  echo "ERROR: partial Entra env — set all of CLIENT_ID, SECRET, and URL to real values, or leave CLIENT_ID+SECRET PLACEHOLDER/empty to skip SSO (URL alone may still derive tenant)." >&2
  exit 1
fi

echo
echo "=== Live inventory ==="
bash "$repo/scripts/print-fly-missing-secrets.sh" || true

echo
echo "=== Post-apply golive (OAuth probe + optional remint) ==="
TIP="$(git rev-parse HEAD)"
CONFIRM="aria-production-release-v1:fly-deploy-now:${TIP}:aria-mantu-bootstrap,aria-mantu-app"
umask 077
cat > /tmp/owner-deploy-confirm.env <<EOF
ARIA_RELEASE_SHA=${TIP}
ARIA_PROD_DEPLOY_CONFIRM=${CONFIRM}
EOF
chmod 600 /tmp/owner-deploy-confirm.env
bash "$repo/scripts/post-m365-secrets-golive.sh" || {
  rc=$?
  echo "NOTE: post-m365-secrets-golive exit $rc — secrets are on Fly; Connect Outlook (mode=live) + Enable webhook may still be required." >&2
  echo "  Then: bash scripts/verify-m365-ready.sh" >&2
}
