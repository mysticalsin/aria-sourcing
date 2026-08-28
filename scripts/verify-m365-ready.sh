#!/usr/bin/env bash
# verify-m365-ready.sh — after owner applies M365 secrets + Connect Outlook.
#
# Checks Fly secret inventory, live microsoftOAuth, Graph live seat + webhook,
# then runs strict enterprise E2E with NO partial flags.
#
# Usage (after secrets + Settings → Connect Outlook → Enable webhook):
#   bash scripts/verify-m365-ready.sh
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
KONG_URL="${KONG_URL:-https://aria-mantu-kong.fly.dev}"

echo "=== 1) Fly secret inventory (names only) ==="
missing=0
for name in MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI MICROSOFT_TENANT_ID DATA_ENCRYPTION_KEY; do
  if flyctl secrets list -a aria-mantu-app 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
    echo "  OK  aria-mantu-app $name"
  else
    echo "  MISSING aria-mantu-app $name"
    missing=1
  fi
done
for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
  if flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
    echo "  OK  aria-mantu-auth $name"
  else
    echo "  MISSING aria-mantu-auth $name"
    missing=1
  fi
done
if [ "$missing" = "1" ]; then
  echo "ERROR: apply secrets first — see _relay/M365-OWNER-UNBLOCK.md" >&2
  echo "  bash scripts/print-m365-owner-portal-checklist.sh" >&2
  echo "  bash scripts/probe-m365-unblock.sh --apply  # when drop-zone or env exports ready" >&2
  exit 2
fi

echo
echo "=== 2) Live ready ==="
curl -fsS "$APP_URL/api/ready" | jq '{ok,build,migration}'

echo
echo "=== 3) microsoftOAuth + live Graph seat (admin session) ==="
# Load E2E admin/anon without printing secrets.
eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export)"
: "${ADMIN_EMAIL:?ADMIN_EMAIL required (e.g. /tmp/aria-e2e-admin-email)}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD required (e.g. /tmp/aria-e2e-admin-password)}"
: "${ANON_KEY:?ANON_KEY required (FLY_SUPABASE_ANON_KEY in .fly-secrets.env)}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/verify-m365.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

LOGIN_CODE="$(
  curl -sS -o "$WORK/sess.json" -w '%{http_code}' \
    -X POST "$KONG_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')"
)"
if [ "$LOGIN_CODE" != "200" ]; then
  echo "ERROR: GoTrue admin login failed HTTP $LOGIN_CODE" >&2
  jq -rc '{error:.error,error_description:.error_description,msg:.msg}' "$WORK/sess.json" 2>/dev/null || true
  exit 3
fi

# Match e2e-workflow-test.sh cookie construction (sb-auth-token / chunked).
COOKIE_VALUE="$(
  node - "$WORK/sess.json" <<'NODE'
const fs = require("node:fs");
const raw = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const session = {
  access_token: raw.access_token,
  token_type: raw.token_type || "bearer",
  expires_in: raw.expires_in,
  expires_at: raw.expires_at,
  refresh_token: raw.refresh_token,
  user: raw.user,
};
const json = JSON.stringify(session);
const b64 = Buffer.from(json, "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");
process.stdout.write("base64-" + b64);
NODE
)"
COOKIE_HDR=""
# Chunk at 3180 chars like @supabase/ssr
if [ "${#COOKIE_VALUE}" -le 3180 ]; then
  COOKIE_HDR="sb-auth-token=$COOKIE_VALUE"
else
  idx=0
  rest="$COOKIE_VALUE"
  while [ -n "$rest" ]; do
    part="${rest:0:3180}"
    rest="${rest:3180}"
    if [ -z "$COOKIE_HDR" ]; then COOKIE_HDR="sb-auth-token.${idx}=${part}"
    else COOKIE_HDR="${COOKIE_HDR}; sb-auth-token.${idx}=${part}"; fi
    idx=$((idx + 1))
  done
fi

HTTP="$(
  curl -sS -o "$WORK/conn.json" -w '%{http_code}' \
    -H "Cookie: $COOKIE_HDR" \
    -H "Accept: application/json" \
    "$APP_URL/api/email/connections"
)"
if [ "$HTTP" != "200" ]; then
  echo "ERROR: GET /api/email/connections HTTP $HTTP" >&2
  head -c 300 "$WORK/conn.json" >&2 || true
  exit 3
fi

MS_OAUTH="$(jq -r '.providers.microsoftOAuth // false' "$WORK/conn.json")"
ENC_READY="$(jq -r '.providers.encryptionReady // false' "$WORK/conn.json")"
echo "  microsoftOAuth=$MS_OAUTH encryptionReady=$ENC_READY"
if [ "$MS_OAUTH" != "true" ] || [ "$ENC_READY" != "true" ]; then
  echo "ERROR: Graph OAuth not live after secrets — remint tip deploy (fly-deploy-now.sh) so MICROSOFT_CLIENT_* is in the running release." >&2
  exit 4
fi

LIVE_SEAT="$(
  jq -r '
    (.connections // []) as $conns
    | (.seats // []) as $seats
    | [
        $conns[]
        | select(
            (.provider // "") == "Microsoft Graph"
            and (.hasRefreshToken == true)
            and ((.graphSubscription.active // false) == true)
            and ((.seatId // "") | length) > 0
          )
        | .seatId as $sid
        | select(
            ($seats
              | map(select(
                  (.id // "") == $sid
                  and (.mode // "") == "live"
                  and ((.status // "active") == "active")
                ))
              | length) > 0
          )
        | $sid
      ]
    | .[0] // empty
  ' "$WORK/conn.json"
)"
CONNECTED_N="$(
  jq -r '
    [(.connections // [])[]
      | select((.provider // "") == "Microsoft Graph" and (.hasRefreshToken == true))
    ] | length
  ' "$WORK/conn.json"
)"
SUB_N="$(
  jq -r '
    [(.connections // [])[]
      | select(
          (.provider // "") == "Microsoft Graph"
          and ((.graphSubscription.active // false) == true)
        )
    ] | length
  ' "$WORK/conn.json"
)"
echo "  connectedGraph=$CONNECTED_N activeWebhook=$SUB_N liveSeat=${LIVE_SEAT:-'(none)'}"

if [ -z "$LIVE_SEAT" ]; then
  echo "ERROR: no mode=live Graph seat with active webhook." >&2
  echo "  Settings → Connect Outlook (mode=live) → Enable Graph webhook, then re-run." >&2
  if [ "${CONNECTED_N:-0}" -gt 0 ] && [ "${SUB_N:-0}" -eq 0 ]; then
    echo "  Hint: mailbox connected but graphSubscription.active=false — Enable webhook." >&2
  elif [ "${CONNECTED_N:-0}" -eq 0 ]; then
    echo "  Hint: no Outlook mailbox connected yet." >&2
  fi
  exit 5
fi
echo "  OK live Graph seat $LIVE_SEAT (webhook + mode=live)"

echo
echo "=== 3b) Entra SSO login surface (after GoTrue Azure + app remint) ==="
LOGIN_HTML="$(curl -fsS "$APP_URL/login" 2>/dev/null || true)"
if printf '%s' "$LOGIN_HTML" | grep -q 'Sign in with Microsoft'; then
  echo "  OK  /login exposes Sign in with Microsoft (NEXT_PUBLIC_ENABLE_AZURE_LOGIN baked)"
else
  echo "ERROR: GoTrue Azure secrets present but /login missing Sign in with Microsoft." >&2
  echo "  Remint app tip so NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true (bash scripts/fly-remint-app-only.sh after confirm refresh)." >&2
  exit 6
fi

echo
echo "=== 3c) Live LLM auth (presence ≠ usable — reject auth-dead keys) ==="
if ! bash "$repo/scripts/probe-fly-llm-auth.sh"; then
  echo "ERROR: Fly LLM auth dead or absent — rotate Kimi/OpenAI/Anthropic/DeepSeek before strict E2E." >&2
  exit 7
fi

echo
echo "=== 4) Strict enterprise E2E (no partial flags) ==="
unset ARIA_ALLOW_PARTIAL_M365_E2E ARIA_ALLOW_PARTIAL_LLM_E2E ARIA_ALLOW_SKIP_APPROVE_E2E ARIA_ALLOW_STALE_FLY_E2E ARIA_ALLOW_SKIP_LIVE_CALENDAR || true
export APP_URL KONG_URL
bash "$repo/e2e-workflow-test.sh"
