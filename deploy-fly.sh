#!/bin/bash
# deploy-fly.sh — finish the Aria Mantu Fly deploy end-to-end. Idempotent + fast-timeout
# hardened against Fly's flaky API. Apps + volume already exist; this stages secrets,
# deploys the Supabase stack + app, applies migrations, smoke-tests. Nothing is delivered.
#   run:  cd "<repo root>" && bash deploy-fly.sh
set -uo pipefail
cd "$(dirname "$0")"
export FLY_API_TOKEN="$(cat production-readiness/.fly-token.env)"
export FLY_NO_METRICS=1 DO_NOT_TRACK=1
set -a; source production-readiness/.fly-secrets.env; set +a
gv(){ grep -E "^$1=" .env.local 2>/dev/null | head -1 | cut -d= -f2-; }
TAVILY_API_KEY="$(gv TAVILY_API_KEY)"; GITHUB_TOKEN="$(gv GITHUB_TOKEN)"
KIMI_API_KEY="$(gv KIMI_API_KEY)"; KIMI_BASE_URL="$(gv KIMI_BASE_URL)"; ANTHROPIC_API_KEY="$(gv ANTHROPIC_API_KEY)"

log(){ echo; echo "=== [$(date +%H:%M:%S)] $* ==="; }
fast(){ local t="$1"; shift; "$@" & local p=$!
  ( sleep "$t"; kill -KILL "$p" 2>/dev/null ) & local w=$!
  wait "$p" 2>/dev/null; local rc=$?
  kill -KILL "$w" 2>/dev/null; wait "$w" 2>/dev/null; return $rc; }
# small idempotent calls: cap each attempt, cycle fast, show progress
rs(){ local n="$1" cap="$2" d="$3"; shift 3; local i=1 rc
  while [ "$i" -le "$n" ]; do echo "   -> $d (try $i/$n)"; fast "$cap" "$@"; rc=$?
    [ "$rc" = 0 ] && { echo "   OK $d"; return 0; }; i=$((i+1)); sleep 3; done
  echo "   [GAVEUP] $d"; return 1; }
# deploys: long cap (remote build takes minutes), stream output
rd(){ local n="$1" d="$2"; shift 2; local i=1 rc
  while [ "$i" -le "$n" ]; do echo "   -> deploy $d (try $i/$n)"; fast 900 "$@"; rc=$?
    [ "$rc" = 0 ] && { echo "   OK deploy $d"; return 0; }; i=$((i+1)); echo "   deploy $d rc=$rc; wait 8s"; sleep 8; done
  echo "   [GAVEUP] deploy $d"; return 1; }

log "1/9  stage infra secrets"
rs 30 45 "db secrets"   fly secrets set --app aria-mantu-db   --stage POSTGRES_PASSWORD="$FLY_PG_PASSWORD" JWT_SECRET="$FLY_JWT_SECRET"
rs 30 45 "auth secrets" fly secrets set --app aria-mantu-auth --stage GOTRUE_JWT_SECRET="$FLY_JWT_SECRET" GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$FLY_PG_PASSWORD@aria-mantu-db.internal:5432/postgres"
rs 30 45 "rest secrets" fly secrets set --app aria-mantu-rest --stage PGRST_JWT_SECRET="$FLY_JWT_SECRET" PGRST_APP_SETTINGS_JWT_SECRET="$FLY_JWT_SECRET" PGRST_DB_URI="postgres://authenticator:$FLY_PG_PASSWORD@aria-mantu-db.internal:5432/postgres"
rs 30 45 "kong secrets" fly secrets set --app aria-mantu-kong --stage SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY" SUPABASE_SERVICE_KEY="$FLY_SUPABASE_SERVICE_KEY"
declare -a A=(SUPABASE_SERVICE_ROLE_KEY="$FLY_SUPABASE_SERVICE_KEY" DATA_ENCRYPTION_KEY="$FLY_DATA_ENCRYPTION_KEY" CRON_SECRET="$FLY_CRON_SECRET")
for k in TAVILY_API_KEY GITHUB_TOKEN KIMI_API_KEY KIMI_BASE_URL ANTHROPIC_API_KEY; do v="${!k:-}"; [ -n "$v" ] && A+=("$k=$v") && echo "  + $k"; done
rs 30 45 "app secrets" fly secrets set --app aria-mantu-app --stage "${A[@]}"

log "2/9  deploy Postgres (first boot runs baked init: roles, jwt GUC, auth-owner)"
rd 5 "db" fly deploy --config fly.db.toml --remote-only

log "3/9  deploy GoTrue (auth) + PostgREST (rest)"
rd 5 "auth" fly deploy --config fly.auth.toml --remote-only
rd 5 "rest" fly deploy --config fly.rest.toml --remote-only

log "4/9  deploy Kong + public IPs"
rd 5 "kong" fly deploy --config fly.kong.toml --remote-only
rs 6 50 "kong v4" fly ips allocate-v4 --shared --app aria-mantu-kong || true
rs 6 50 "kong v6" fly ips allocate-v6 --app aria-mantu-kong || true

log "5/9  data-plane smoke (JWT chain proof)"
sm(){ curl -s -m 25 -o /tmp/sm.out -w "%{http_code}" "$@"; }
for i in $(seq 8); do c=$(sm https://aria-mantu-kong.fly.dev/healthz); echo "  /healthz -> $c"; [ "$c" = "200" ] && break; sleep 10; done
for i in $(seq 8); do c=$(sm -H "apikey: $FLY_SUPABASE_ANON_KEY" -H "Authorization: Bearer $FLY_SUPABASE_ANON_KEY" https://aria-mantu-kong.fly.dev/rest/v1/); echo "  /rest/v1/ -> $c  $(head -c 90 /tmp/sm.out)"; { [ "$c" != "000" ] && [ "$c" != "502" ] && [ "$c" != "401" ]; } && break; sleep 10; done
for i in $(seq 6); do c=$(sm -H "apikey: $FLY_SUPABASE_ANON_KEY" https://aria-mantu-kong.fly.dev/auth/v1/health); echo "  /auth/v1/health -> $c"; [ "$c" = "200" ] && break; sleep 10; done

log "6/9  build + push migrations image"
rd 5 "bootstrap" fly deploy --config fly.bootstrap.toml --build-only --push --image-label latest

log "7/9  apply migrations 0001..0018 (0016 absent)"
rs 4 300 "migrations" fly machine run "registry.fly.io/aria-mantu-bootstrap:latest" --app aria-mantu-bootstrap --region cdg --rm -e ADMIN_DB_URL="postgres://postgres:$FLY_PG_PASSWORD@aria-mantu-db.internal:5432/postgres"

log "8/9  deploy the app + public IPs"
rd 5 "app" fly deploy --config fly.app.toml --remote-only --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$FLY_SUPABASE_ANON_KEY"
rs 6 50 "app v4" fly ips allocate-v4 --shared --app aria-mantu-app || true
rs 6 50 "app v6" fly ips allocate-v6 --app aria-mantu-app || true

log "9/9  acceptance"
for i in $(seq 10); do c=$(sm https://aria-mantu-app.fly.dev/api/health); echo "  app /api/health -> $c  $(head -c 80 /tmp/sm.out)"; [ "$c" = "200" ] && break; sleep 12; done
echo; echo "================ Fly stack up ================"
echo " App:  https://aria-mantu-app.fly.dev"
echo " Kong: https://aria-mantu-kong.fly.dev"
echo " Then tell Claude 'done' — it creates the admin + runs the E2E test."
echo "============================================="
