#!/usr/bin/env bash
# probe-m365-unblock.sh — reprobe M365 blocker; auto-apply when drop-zone or env exports ready.
#
# Usage:
#   bash scripts/probe-m365-unblock.sh           # status only
#   bash scripts/probe-m365-unblock.sh --apply   # apply to Fly when credentials present
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/owner-microsoft-credentials.sh
source "$repo/scripts/lib/owner-microsoft-credentials.sh"

echo "=== M365 unblock probe ==="
if owner_ms_has_drop_file; then
  echo "  credentials=drop-file"
elif owner_ms_has_env_exports; then
  echo "  credentials=env-exports"
elif owner_ms_has_azure_app_id; then
  echo "  credentials=azure-app-id"
  echo "  aria_azure_app_id=$(owner_ms_read_azure_app_id)"
else
  echo "  credentials=none"
fi

# Graph-only readiness (Entra/LLM are WARN in print-fly-missing-secrets).
inv="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null || true)"
graph_missing="$(printf '%s\n' "$inv" | sed -n 's/^graph_secrets_missing=//p' | tail -1)"
entra_missing="$(printf '%s\n' "$inv" | sed -n 's/^entra_secrets_missing=//p' | tail -1)"
llm_missing="$(printf '%s\n' "$inv" | sed -n 's/^llm_env_missing=//p' | tail -1)"
graph_missing="${graph_missing:-unknown}"
entra_missing="${entra_missing:-unknown}"
llm_missing="${llm_missing:-unknown}"
echo "  fly_graph_secrets_missing=${graph_missing}"
echo "  fly_entra_secrets_missing=${entra_missing}"
echo "  fly_llm_env_missing=${llm_missing}"
# Compat alias: m365 = Graph bucket only (E2E PASS / verify-m365-ready).
echo "  fly_m365_missing=${graph_missing}"

# Name inventory alone is not enough: synthetic demo UUIDs can set secret NAMES while
# microsoftOAuth stays false (readiness rejects). Prefer live connections check.
probe_microsoft_oauth() {
  local app_url kong_url work login_code cookie_hdr cookie_value len max_chunk chunks idx start part ms_oauth
  app_url="${APP_URL:-https://aria-mantu-app.fly.dev}"
  kong_url="${KONG_URL:-https://aria-mantu-kong.fly.dev}"
  if ! eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export 2>/dev/null)"; then
    echo "unknown"
    return 0
  fi
  if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ] || [ -z "${ANON_KEY:-}" ]; then
    echo "unknown"
    return 0
  fi
  work="$(mktemp -d "${TMPDIR:-/tmp}/probe-m365-oauth.XXXXXX")"
  login_code="$(
    curl -sS -o "$work/sess.json" -w '%{http_code}' \
      -X POST "$kong_url/auth/v1/token?grant_type=password" \
      -H "apikey: $ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')" \
      2>/dev/null || echo "000"
  )"
  if [ "$login_code" != "200" ]; then
    rm -rf "$work"
    echo "unknown"
    return 0
  fi
  cookie_value="$(jq -r '.access_token // empty' "$work/sess.json")"
  len=${#cookie_value}
  max_chunk=3180
  cookie_hdr=""
  if [ "$len" -le "$max_chunk" ]; then
    cookie_hdr="sb-auth-token=$cookie_value"
  else
    chunks=$(( (len + max_chunk - 1) / max_chunk ))
    idx=0
    while [ "$idx" -lt "$chunks" ]; do
      start=$((idx * max_chunk))
      part="${cookie_value:$start:$max_chunk}"
      if [ -z "$cookie_hdr" ]; then cookie_hdr="sb-auth-token.${idx}=${part}"
      else cookie_hdr="${cookie_hdr}; sb-auth-token.${idx}=${part}"; fi
      idx=$((idx + 1))
    done
  fi
  curl -sS -o "$work/conn.json" -H "Cookie: $cookie_hdr" "$app_url/api/email/connections" >/dev/null 2>&1 || true
  ms_oauth="$(jq -r '.providers.microsoftOAuth // empty' "$work/conn.json" 2>/dev/null || true)"
  rm -rf "$work"
  case "$ms_oauth" in
    true|false) echo "$ms_oauth" ;;
    *) echo "unknown" ;;
  esac
}

if [ "$graph_missing" = "0" ]; then
  ms_oauth="$(probe_microsoft_oauth)"
  echo "  microsoftOAuth=${ms_oauth}"
  if [ "$ms_oauth" = "false" ]; then
    echo "RESULT: fly-secrets-present-oauth-false"
    echo "  Graph secret NAMES are set but readiness rejected them (synthetic/PLACEHOLDER/tenant/redirect)."
    echo "  Unset fake MICROSOFT_CLIENT_* / TENANT or re-apply REAL values; do not Connect Outlook yet."
    exit 4
  fi
  if [ "$ms_oauth" = "true" ]; then
    echo "RESULT: fly-secrets-ready"
    if [ "${entra_missing:-0}" != "0" ] || [ "${llm_missing:-0}" != "0" ]; then
      echo "  note: Entra/LLM optional WARNs remain — Graph E2E PASS does not require them"
    fi
    exit 0
  fi
  echo "RESULT: fly-secrets-names-ready"
  echo "  note: could not verify microsoftOAuth (admin session); confirm via Settings / verify-m365-ready"
  if [ "${entra_missing:-0}" != "0" ] || [ "${llm_missing:-0}" != "0" ]; then
    echo "  note: Entra/LLM optional WARNs remain — Graph E2E PASS does not require them"
  fi
  exit 0
fi

if owner_ms_has_credentials; then
  if [ "$APPLY" = "1" ]; then
    if owner_ms_has_env_exports && ! owner_ms_has_drop_file; then
      echo "Syncing env exports to /tmp/owner-microsoft.env (values not printed)…"
      owner_ms_sync_env_to_dropzone
    fi
    echo "Applying owner Microsoft secrets to Fly…"
    bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
    inv_after="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null || true)"
    missing_after="$(printf '%s\n' "$inv_after" | sed -n 's/^graph_secrets_missing=//p' | tail -1)"
    missing_after="${missing_after:-unknown}"
    if [ "$missing_after" = "0" ]; then
      ms_oauth="$(probe_microsoft_oauth)"
      echo "  microsoftOAuth=${ms_oauth}"
      if [ "$ms_oauth" = "false" ]; then
        echo "RESULT: applied-but-oauth-false" >&2
        echo "  Secrets landed by name but microsoftOAuth=false — likely synthetic/PLACEHOLDER. Roll back." >&2
        exit 4
      fi
      if [ "$ms_oauth" = "true" ]; then
        echo "RESULT: applied-ok"
        exit 0
      fi
      echo "RESULT: applied-ok-oauth-unchecked"
      echo "  note: confirm microsoftOAuth=true before Connect Outlook"
      exit 0
    fi
    echo "RESULT: apply-ran-still-missing=${missing_after}" >&2
    exit 3
  fi
  echo "RESULT: credentials-present-not-applied (run with --apply)"
  exit 2
fi

# Owner created an Entra app but hasn't minted secrets yet — configure + apply.
# Also discover owned "ARIA Mantu Graph*" apps when dropzone file is missing.
if ! owner_ms_has_azure_app_id; then
  if msg="$(owner_ms_maybe_materialize_owned_app_id 2>/dev/null)"; then
    [ -n "$msg" ] && echo "  $msg"
  fi
fi
if owner_ms_has_azure_app_id; then
  if [ "$APPLY" = "1" ]; then
    echo "Configuring Entra app + minting secret via az-configure-existing-graph-app…"
    export ARIA_AZURE_APP_ID
    ARIA_AZURE_APP_ID="$(owner_ms_read_azure_app_id)"
    if owner_ms_export_skip_admin_consent_if_needed; then
      echo "  admin-consent Portal Grant path — ARIA_GRAPH_SKIP_ADMIN_CONSENT=1"
    fi
    bash "$repo/scripts/fly-m365-from-azure-app-id.sh"
    inv_after="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null || true)"
    missing_after="$(printf '%s\n' "$inv_after" | sed -n 's/^graph_secrets_missing=//p' | tail -1)"
    missing_after="${missing_after:-unknown}"
    ms_oauth="$(probe_microsoft_oauth)"
    echo "  microsoftOAuth=${ms_oauth}"
    if [ "$missing_after" = "0" ] && [ "$ms_oauth" = "true" ]; then
      echo "RESULT: applied-ok-from-azure-app-id"
      exit 0
    fi
    if [ "$ms_oauth" = "false" ]; then
      echo "RESULT: applied-but-oauth-false" >&2
      exit 4
    fi
    echo "RESULT: apply-ran-still-missing=${missing_after}" >&2
    exit 3
  fi
  echo "RESULT: azure-app-id-present-not-applied (run with --apply)"
  echo "  bash scripts/fly-m365-from-azure-app-id.sh"
  exit 2
fi

echo "RESULT: owner-blocked"
echo "  bash scripts/print-m365-owner-portal-checklist.sh"
echo "  Minimal: Entra admin registers ARIA Mantu Graph (Fly) → Owners Add twalteur@amaris.com →"
echo "    echo '<client-id>' > /tmp/owner-azure-app-id && bash scripts/probe-m365-unblock.sh --apply"
echo "  (Waiters also auto-discover owned ARIA Mantu Graph apps via Graph ownedObjects.)"
echo "  Or grant Application Developer to the az account (waiters re-probe create every ~5m)."
exit 1
