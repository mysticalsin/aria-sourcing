#!/bin/bash
# deploy-fly-2.sh — RESUME the Aria Mantu deploy. Skips already-staged secrets and the
# already-deployed auth+rest; stages the missing app secrets and finishes db/kong/bootstrap/app
# with heavy retries + the tiny build context. Idempotent. Run from a real terminal on hotspot.
set -uo pipefail
cd "$(dirname "$0")"
export FLY_API_TOKEN="$(cat production-readiness/.fly-token.env)"
export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a; source production-readiness/.fly-secrets.env; set +a
gv(){ grep -E "^$1=" .env.local 2>/dev/null | head -1 | cut -d= -f2-; }
TAVILY_API_KEY="$(gv TAVILY_API_KEY)"; GITHUB_TOKEN="$(gv GITHUB_TOKEN)"; KIMI_API_KEY="$(gv KIMI_API_KEY)"; KIMI_BASE_URL="$(gv KIMI_BASE_URL)"
log(){ echo; echo "=== [$(date +%H:%M:%S)] $* ==="; }
fast(){ local t="$1"; shift; "$@" & local p=$!; ( sleep "$t"; kill -KILL "$p" 2>/dev/null ) & local w=$!
  wait "$p" 2>/dev/null; local rc=$?; kill -KILL "$w" 2>/dev/null; wait "$w" 2>/dev/null; return $rc; }
rs(){ local n="$1" cap="$2" d="$3"; shift 3; local i=1 rc; while [ "$i" -le "$n" ]; do echo "   -> $d (try $i/$n)"; fast "$cap" "$@"; rc=$?
  [ "$rc" = 0 ] && { echo "   OK $d"; return 0; }; i=$((i+1)); sleep 2; done; echo "   [GAVEUP] $d"; return 1; }
rd(){ local n="$1" d="$2"; shift 2; local i=1 rc; while [ "$i" -le "$n" ]; do echo "   -> deploy $d (try $i/$n)"; fast 900 "$@"; rc=$?
  [ "$rc" = 0 ] && { echo "   OK deploy $d"; return 0; }; i=$((i+1)); echo "   deploy $d rc=$rc; wait 5s"; sleep 5; done; echo "   [GAVEUP] deploy $d"; return 1; }

log "A. app secrets (the one secret set that never landed)"
declare -a A=(SUPABASE_SERVICE_ROLE_KEY="$FLY_SUPABASE_SERVICE_KEY" DATA_ENCRYPTION_KEY="$FLY_DATA_ENCRYPTION_KEY" CRON_SECRET="$FLY_CRON_SECRET")
for k in TAVILY_API_KEY GITHUB_TOKEN KIMI_API_KEY KIMI_BASE_URL; do v="${!k:-}"; [ -n "$v" ] && A+=("$k=$v") && echo "  + $k"; done
rs 50 40 "app secrets" fly secrets set --app aria-mantu-app --stage "${A[@]}"

log "B. deploy Postgres (tiny context now — this is the critical one)"
rd 12 "db" fly deploy --config fly.db.toml --remote-only

log "C. deploy Kong + public IPs"
rd 12 "kong" fly deploy --config fly.kong.toml --remote-only
rs 8 40 "kong v4" fly ips allocate-v4 --shared --app aria-mantu-kong || true
rs 8 40 "kong v6" fly ips allocate-v6 --app aria-mantu-kong || true

log "D. data-plane smoke"
sm(){ curl -s -m 25 -o /tmp/sm.out -w "%{http_code}" "$@"; }
for i in $(seq 8); do c=$(sm https://aria-mantu-kong.fly.dev/healthz); echo "  /healthz -> $c"; [ "$c" = "200" ] && break; sleep 10; done
for i in $(seq 8); do c=$(sm -H "apikey: $FLY_SUPABASE_ANON_KEY" -H "Authorization: Bearer $FLY_SUPABASE_ANON_KEY" https://aria-mantu-kong.fly.dev/rest/v1/); echo "  /rest/v1/ -> $c  $(head -c 80 /tmp/sm.out)"; { [ "$c" != "000" ] && [ "$c" != "502" ] && [ "$c" != "401" ]; } && break; sleep 10; done

log "E. build + apply migrations"
rd 8 "bootstrap" fly deploy --config fly.bootstrap.toml --build-only --push --image-label latest
rs 5 300 "migrations" fly machine run "registry.fly.io/aria-mantu-bootstrap:latest" --app aria-mantu-bootstrap --region cdg --rm -e ADMIN_DB_URL="postgres://postgres:$FLY_PG_PASSWORD@aria-mantu-db.internal:5432/postgres"

log "F. deploy the app + public IPs"
rd 12 "app" fly deploy --config fly.app.toml --remote-only --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY"
rs 8 40 "app v4" fly ips allocate-v4 --shared --app aria-mantu-app || true
rs 8 40 "app v6" fly ips allocate-v6 --app aria-mantu-app || true

log "G. acceptance"
for i in $(seq 10); do c=$(sm https://aria-mantu-app.fly.dev/api/health); echo "  app /api/health -> $c  $(head -c 80 /tmp/sm.out)"; [ "$c" = "200" ] && break; sleep 12; done
echo; echo "================ done ================"
echo " App:  https://aria-mantu-app.fly.dev"
echo " Kong: https://aria-mantu-kong.fly.dev"
echo " Tell Claude 'done' — it creates the admin + runs the E2E test."
echo "====================================="
