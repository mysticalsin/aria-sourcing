#!/usr/bin/env bash
# post-m365-secrets-golive.sh — after Fly has MICROSOFT_* (+ optional Entra),
# wait for microsoftOAuth, remint for Entra SSO flag when confirm present,
# then either run verify-m365-ready (if live seat exists) or print Connect Outlook steps.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APP_URL="${APP_URL:-https://aria-mantu-app.fly.dev}"
KONG_URL="${KONG_URL:-https://aria-mantu-kong.fly.dev}"
WAIT_OAUTH_SEC="${ARIA_WAIT_OAUTH_SECONDS:-180}"
WAIT_SEAT_SEC="${ARIA_WAIT_LIVE_SEAT_SECONDS:-0}" # 0 = do not wait; print Connect Outlook

echo "=== 1) Secret inventory ==="
missing=0
for name in MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI MICROSOFT_TENANT_ID DATA_ENCRYPTION_KEY; do
  if flyctl secrets list -a aria-mantu-app 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
    echo "  OK  aria-mantu-app $name"
  else
    echo "  MISSING aria-mantu-app $name"
    missing=1
  fi
done
entra_ok=1
for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
  if flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$name"; then
    echo "  OK  aria-mantu-auth $name"
  else
    echo "  MISSING aria-mantu-auth $name"
    entra_ok=0
  fi
done
if [ "$missing" = "1" ]; then
  echo "ERROR: Graph secrets incomplete — see _relay/M365-OWNER-UNBLOCK.md" >&2
  exit 2
fi

echo
echo "=== 2) Tip remint for Entra SSO build flag (when confirm matches tip) ==="
if [ "$entra_ok" = "1" ]; then
  if [ -r /tmp/owner-deploy-confirm.env ]; then
    set -a
    # shellcheck disable=SC1091
    source /tmp/owner-deploy-confirm.env
    set +a
  fi
  TIP="$(git rev-parse HEAD)"
  if [ "${ARIA_RELEASE_SHA:-}" = "$TIP" ] \
    && [ "${ARIA_PROD_DEPLOY_CONFIRM:-}" = "aria-production-release-v1:fly-deploy-now:${TIP}:aria-mantu-bootstrap,aria-mantu-app" ]; then
    echo "Confirm matches tip — app-only remint (NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true expected)"
    bash "$repo/scripts/fly-remint-app-only.sh" || {
      echo "WARN: remint failed (lease race?) — retry: bash scripts/fly-remint-app-only.sh" >&2
    }
  else
    echo "Deploy confirm stale/missing — print tip confirm then remint manually:"
    bash "$repo/scripts/print-fly-deploy-confirm.sh"
  fi
else
  echo "Entra incomplete — skip SSO remint (Graph Connect Outlook still works after secrets restart)."
fi

echo
echo "=== 3) Wait for microsoftOAuth on live connections (rolling restart) ==="
eval "$(bash "$repo/scripts/print-fly-e2e-env.sh" --export)"
: "${ADMIN_EMAIL:?}"
: "${ADMIN_PASSWORD:?}"
: "${ANON_KEY:?}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/post-m365.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

login_cookie() {
  local code
  code="$(
    curl -sS -o "$WORK/sess.json" -w '%{http_code}' \
      -X POST "$KONG_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $ANON_KEY" \
      -H "Content-Type: application/json" \
      -d "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')"
  )"
  [ "$code" = "200" ] || return 1
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
const b64 = Buffer.from(JSON.stringify(session), "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");
process.stdout.write("base64-" + b64);
NODE
  )"
  if [ "${#COOKIE_VALUE}" -le 3180 ]; then
    COOKIE_HDR="sb-auth-token=$COOKIE_VALUE"
  else
    COOKIE_HDR=""
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
}

login_cookie || { echo "ERROR: admin login failed" >&2; exit 3; }

deadline=$(( $(date +%s) + WAIT_OAUTH_SEC ))
MS_OAUTH=false
while [ "$(date +%s)" -lt "$deadline" ]; do
  HTTP="$(
    curl -sS -o "$WORK/conn.json" -w '%{http_code}' \
      -H "Cookie: $COOKIE_HDR" -H "Accept: application/json" \
      "$APP_URL/api/email/connections"
  )"
  if [ "$HTTP" = "200" ]; then
    MS_OAUTH="$(jq -r '.providers.microsoftOAuth // false' "$WORK/conn.json")"
    ENC="$(jq -r '.providers.encryptionReady // false' "$WORK/conn.json")"
    echo "  microsoftOAuth=$MS_OAUTH encryptionReady=$ENC"
    if [ "$MS_OAUTH" = "true" ] && [ "$ENC" = "true" ]; then
      break
    fi
  else
    echo "  connections HTTP $HTTP — retry"
  fi
  sleep 5
done
if [ "$MS_OAUTH" != "true" ]; then
  echo "ERROR: microsoftOAuth still false after ${WAIT_OAUTH_SEC}s — check Fly secrets + machine restart" >&2
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
            and ((.scope // "") | test("Calendars[.]ReadWrite|calendars[.]readwrite"; "i"))
            and ((.scope // "") | test("OnlineMeetings[.]ReadWrite|onlinemeetings[.]readwrite"; "i"))
          )
        | .seatId as $sid
        | select(
            ($seats | map(select((.id // "") == $sid and (.mode // "") == "live")) | length) > 0
          )
        | $sid
      ]
    | .[0] // empty
  ' "$WORK/conn.json"
)"

if [ -n "$LIVE_SEAT" ]; then
  echo "Live Graph seat ready: $LIVE_SEAT (webhook + Calendars + OnlineMeetings + mode=live)"
  echo
  echo "=== 4) Strict verify-m365-ready ==="
  bash "$repo/scripts/verify-m365-ready.sh"
  exit $?
fi

if [ "${WAIT_SEAT_SEC}" -gt 0 ]; then
  echo "Waiting up to ${WAIT_SEAT_SEC}s for Connect Outlook + webhook + Calendars/OnlineMeetings scopes…"
  seat_deadline=$(( $(date +%s) + WAIT_SEAT_SEC ))
  while [ "$(date +%s)" -lt "$seat_deadline" ]; do
    login_cookie || true
    curl -sS -o "$WORK/conn.json" -H "Cookie: $COOKIE_HDR" "$APP_URL/api/email/connections" >/dev/null || true
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
                and ((.scope // "") | test("Calendars[.]ReadWrite|calendars[.]readwrite"; "i"))
                and ((.scope // "") | test("OnlineMeetings[.]ReadWrite|onlinemeetings[.]readwrite"; "i"))
              )
            | .seatId as $sid
            | select(($seats | map(select(.id == $sid and .mode == "live")) | length) > 0)
            | $sid
          ]
        | .[0] // empty
      ' "$WORK/conn.json" 2>/dev/null || true
    )"
    if [ -n "$LIVE_SEAT" ]; then
      echo "Live seat appeared: $LIVE_SEAT (webhook + Calendars + OnlineMeetings + mode=live)"
      bash "$repo/scripts/verify-m365-ready.sh"
      exit $?
    fi
    sleep 15
  done
fi

echo
echo "=== Connect Outlook required (interactive) ==="
echo "  1) Open: ${APP_URL}/settings"
echo "  2) Connect Outlook (mode=live) → Enable Graph webhook"
echo "  3) bash scripts/verify-m365-ready.sh"
echo "microsoftOAuth is ready; only the live seat + webhook remain for E2E 6b / full PASS."
exit 5
