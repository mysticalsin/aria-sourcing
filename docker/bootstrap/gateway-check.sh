#!/bin/sh
# Prove the Caddy gateway keeps its contract, from inside the compose network.
# run.sh calls it on every `up` (the app never starts behind a broken gateway);
# `npm run demo:doctor` runs it again on a live stack. Prints one line per check
# and exits 1 on the first broken one, naming what is wrong.
set -eu

GATEWAY_URL="${GATEWAY_URL:-http://gateway:8000}"
ANON="${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY required}"
SERVICE="${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY required}"
BODY="$(mktemp /tmp/aria-gateway.XXXXXX)"
HEADERS="$(mktemp /tmp/aria-gateway.XXXXXX)"
trap 'rm -f "$BODY" "$HEADERS"' EXIT HUP INT TERM

# probe <path> [curl args...]: sets $code, the body in $BODY, the headers in $HEADERS.
probe() {
  path="$1"; shift
  # curl writes 000 itself when the connection fails.
  code="$(curl -s -o "$BODY" -D "$HEADERS" -w "%{http_code}" --max-time 10 "$@" "$GATEWAY_URL$path" || true)"
}
pass() { echo "[gateway] ok   $1 (HTTP $code)"; }
fail() {
  echo "[gateway] FAIL $1 (HTTP $code). Check: docker compose logs gateway auth rest" >&2
  exit 1
}
refused_by_gateway() { grep -q '"Invalid authentication credentials"' "$BODY"; }

i=0
until probe /gateway-health && [ "$code" = 200 ]; do
  i=$((i + 1))
  [ "$i" -le 30 ] || fail "gateway reachable at $GATEWAY_URL"
  sleep 2
done
pass "gateway reachable at $GATEWAY_URL"

probe /rest/v1/
{ [ "$code" = 401 ] && refused_by_gateway; } || fail "REST without a key is refused"
pass "REST without a key is refused"

probe /rest/v1/ -H "apikey: not-a-project-key"
{ [ "$code" = 401 ] && refused_by_gateway; } || fail "REST with an unknown key is refused"
pass "REST with an unknown key is refused"

# The anon role may be denied by PostgREST itself; reaching it is what counts.
probe /rest/v1/ -H "apikey: $ANON"
{ [ "$code" -ge 200 ] && [ "$code" -lt 500 ] && [ "$code" != 404 ] && ! refused_by_gateway; } || fail "REST with the anon key reaches PostgREST"
pass "REST with the anon key reaches PostgREST"

probe "/rest/v1/?apikey=$ANON"
{ [ "$code" -ge 200 ] && [ "$code" -lt 500 ] && [ "$code" != 404 ] && ! refused_by_gateway; } || fail "REST with the anon key in the query reaches PostgREST"
pass "REST with the anon key in the query reaches PostgREST"

probe /auth/v1/health -H "apikey: $ANON"
[ "$code" = 200 ] || fail "Auth health with the anon key"
pass "Auth health with the anon key"

probe /auth/v1/health
[ "$code" = 401 ] || fail "Auth without a key is refused"
pass "Auth without a key is refused"

# A bare key becomes the bearer: the service key alone opens the admin API.
probe "/auth/v1/admin/users?per_page=1" -H "apikey: $SERVICE"
[ "$code" = 200 ] || fail "a bare service key becomes the bearer"
pass "a bare service key becomes the bearer"

# A session bearer is passed through, never replaced by the key.
probe "/auth/v1/admin/users?per_page=1" -H "apikey: $ANON" -H "Authorization: Bearer $SERVICE"
[ "$code" = 200 ] || fail "a session bearer is kept"
pass "a session bearer is kept"

probe /auth/v1/.well-known/jwks.json
{ [ "$code" -ge 200 ] && [ "$code" -lt 500 ] && [ "$code" != 401 ]; } || fail "GoTrue JWKS is open without a key"
pass "GoTrue JWKS is open without a key"

probe /rest/v1/workspaces -X OPTIONS -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: apikey, authorization"
{ [ "$code" = 204 ] && grep -qi '^access-control-allow-origin: \*' "$HEADERS" \
  && grep -qi '^access-control-allow-headers: apikey, authorization' "$HEADERS"; } || fail "CORS preflight is answered"
pass "CORS preflight is answered"

probe /storage/v1/ -H "apikey: $ANON"
[ "$code" = 404 ] || fail "unrouted paths answer 404"
pass "unrouted paths answer 404"

echo "[gateway] contract holds."
