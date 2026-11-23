#!/usr/bin/env bash
# Sweep 0 on the integration branch.
# Headed Playwright under xvfb, then the stress cases.
# Artifacts: e2e-artifacts/<timestamp>/summary.json
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ART="${ROOT}/e2e-artifacts/${STAMP}"
mkdir -p "$ART/screenshots" "$ART/logs"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
APP_PID=""
cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if docker info >/dev/null 2>&1; then D=docker; else D="sudo env APP_PORT=3010 docker"; fi

# The packaged app listens here. Port 3000 stays free for the synthetic demo
# the click journey drives. The packaged image redirects that journey to login.
# sudo drops the variable unless it is passed on the command.
export APP_PORT=3010

# This VM's legacy filter can drop forwarded bridge packets. The rule runs
# only in CI or a VM sandbox, and never on a developer Mac.
BRIDGE="$(sh "$ROOT/scripts/sandbox-bridge.sh" || true)"
echo "bridge=$BRIDGE"
if [ "$BRIDGE" = "apply" ] && command -v iptables-legacy >/dev/null 2>&1; then
  sudo iptables-legacy -P FORWARD ACCEPT || true
  sudo iptables-legacy -C FORWARD -s 172.16.0.0/12 -d 172.16.0.0/12 -j ACCEPT 2>/dev/null \
    || sudo iptables-legacy -I FORWARD -s 172.16.0.0/12 -d 172.16.0.0/12 -j ACCEPT || true
else
  echo "bridge-skip: $BRIDGE"
fi

{
  echo "head=$HEAD_SHA"
  $D compose -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" config >/dev/null
  echo "compose-config=ok"
} >"$ART/logs/compose-config.log" 2>&1 || echo "compose-config=fail" >>"$ART/logs/compose-config.log"

# Bring the packaged stack up. A failure is recorded; it does not hide the UI run.
# macOS /bin/bash 3.2 rejects Bash 4 lowercase expansion. The helper
# fills the project name when the environment did not set one, so set -u
# does not stop the sweep on the next use.
# shellcheck source=scripts/e2e-compose-project.sh
. "$ROOT/scripts/e2e-compose-project.sh"
COMPOSE_PROJECT="$(e2e_compose_project "$STAMP")"
set +e
$D compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" up -d --build >"$ART/logs/compose-up.log" 2>&1
COMPOSE_EXIT=$?
set -e
$D compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" ps >"$ART/logs/compose-ps.log" 2>&1 || true

# The click path needs the synthetic demo, which answers 200 on /campaigns/new.
# A 307 to /login is the packaged app and is not this journey.
# ARIA_E2E opens the demo role control. The journey uses it to act as admin.
export ARIA_E2E=1
export ARIA_INGEST_URL="http://127.0.0.1:8091/v1/cv"
demo_ready() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:3000/campaigns/new || true)" = "200" ]
}
if ! demo_ready; then
  start_demo() {
    (cd "$ROOT" && ARIA_E2E=1 ARIA_INGEST_URL="http://127.0.0.1:8091/v1/cv" npx next dev --hostname 127.0.0.1 --port 3000 >>"$ART/logs/next.log" 2>&1) &
    APP_PID=$!
  }
  start_demo
  retried=0
  for _ in $(seq 1 90); do
    if demo_ready; then break; fi
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "next-exited" >>"$ART/logs/next.log"
      if [ "$retried" = 1 ]; then break; fi
      retried=1
      start_demo
    fi
    sleep 2
  done
fi

INGEST_OK=0
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8091/health; then
    INGEST_OK=1
    break
  fi
  sleep 2
done
echo "ingest-health=$INGEST_OK" | tee -a "$ART/logs/compose-ps.log"

ODOO_URL=""
for _ in $(seq 1 180); do
  if curl -sf -o /dev/null --max-time 3 http://127.0.0.1:8069/aria/pipeline; then
    ODOO_URL="http://127.0.0.1:8069/aria/pipeline"
    break
  fi
  sleep 2
done
export ARTIFACT_DIR="$ART" APP_URL="http://127.0.0.1:3000" ODOO_URL="$ODOO_URL"
set +e
if command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a npx playwright test -c "$ROOT/e2e/integration/playwright.config.ts" >"$ART/logs/playwright.log" 2>&1
else
  npx playwright test -c "$ROOT/e2e/integration/playwright.config.ts" >"$ART/logs/playwright.log" 2>&1
fi
PW_EXIT=$?
set -e
$D compose -p "$COMPOSE_PROJECT" logs --no-color >"$ART/logs/compose.log" 2>&1 || true
$D compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" down -v --remove-orphans >>"$ART/logs/compose-up.log" 2>&1 || true

export ARTIFACT_DIR="$ART/stress"
export STRESS_SOAK_SECONDS="${STRESS_SOAK_SECONDS:-600}"
bash "$ROOT/stress/run.sh" >"$ART/stress-stdout.json"

python3 "$ROOT/scripts/e2e-summary.py" "$ART" "$HEAD_SHA" "$COMPOSE_EXIT" "$PW_EXIT"
echo "summary=$ART/summary.json"
