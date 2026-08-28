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
# Required together for Entra SSO on aria-mantu-auth (all or none):
#   GOTRUE_EXTERNAL_AZURE_CLIENT_ID
#   GOTRUE_EXTERNAL_AZURE_SECRET
#   GOTRUE_EXTERNAL_AZURE_URL
# Optional:
#   GOTRUE_EXTERNAL_AZURE_ENABLED  (default: true when applying Entra block)
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

load_owner_env_file() {
  local path="$1"
  [ -r "$path" ] || return 0
  echo "Loading owner secrets from $path (values not printed)"
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}

# Drop-zone first, then gitignored local file. Shell exports already present win
# only if drop files do not override — source after so file wins for intentional drops.
load_owner_env_file "/tmp/owner-microsoft.env"
load_owner_env_file "$repo/production-readiness/.owner-microsoft.env"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN or .fly-token.env required" >&2; exit 1; }
command -v flyctl >/dev/null 2>&1 || { echo "flyctl required" >&2; exit 1; }

is_placeholder() {
  local v="$1"
  case "$v" in
    ""|PLACEHOLDER*|placeholder*|your-*|YOUR-*|changeme|CHANGEME) return 0 ;;
    *) return 1 ;;
  esac
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

entra_any=0
entra_all=1
for v in "$ENTRA_ID" "$ENTRA_SECRET" "$ENTRA_URL"; do
  if [ -n "$v" ]; then entra_any=1; fi
done
for name_val in \
  "GOTRUE_EXTERNAL_AZURE_CLIENT_ID:$ENTRA_ID" \
  "GOTRUE_EXTERNAL_AZURE_SECRET:$ENTRA_SECRET" \
  "GOTRUE_EXTERNAL_AZURE_URL:$ENTRA_URL"; do
  n="${name_val%%:*}"
  v="${name_val#*:}"
  if is_placeholder "$v"; then
    entra_all=0
    if [ "$entra_any" = "1" ]; then
      echo "ERROR: partial Entra env — set all of CLIENT_ID, SECRET, and URL (got empty/placeholder $n)." >&2
      exit 1
    fi
  fi
done

if [ "$entra_all" = "1" ]; then
  echo "=== Applying Entra / GoTrue Azure secrets to aria-mantu-auth ==="
  require_real GOTRUE_EXTERNAL_AZURE_ENABLED "$ENTRA_ENABLED"
  flyctl secrets set -a aria-mantu-auth \
    "GOTRUE_EXTERNAL_AZURE_ENABLED=${ENTRA_ENABLED}" \
    "GOTRUE_EXTERNAL_AZURE_CLIENT_ID=${ENTRA_ID}" \
    "GOTRUE_EXTERNAL_AZURE_SECRET=${ENTRA_SECRET}" \
    "GOTRUE_EXTERNAL_AZURE_URL=${ENTRA_URL}"
else
  echo "=== Skipping Entra (GOTRUE_EXTERNAL_AZURE_* not fully exported) ==="
  echo "    Tip deploy will keep NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false until Entra is set."
fi

echo
echo "=== Live inventory ==="
bash "$repo/scripts/print-fly-missing-secrets.sh" || true
echo
echo "=== Next: tip deploy ==="
bash "$repo/scripts/print-fly-deploy-confirm.sh"
echo
echo "# Then: export ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM from above, and run:"
echo "bash scripts/fly-deploy-now.sh"
