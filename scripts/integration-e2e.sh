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

if docker info >/dev/null 2>&1; then D=docker; else D="sudo docker"; fi

{
  echo "head=$HEAD_SHA"
  $D compose -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" config >/dev/null
  echo "compose-config=ok"
} >"$ART/logs/compose-config.log" 2>&1 || echo "compose-config=fail" >>"$ART/logs/compose-config.log"

# Bring the packaged stack up. A failure is recorded; it does not hide the UI run.
COMPOSE_PROJECT="aria-int-${STAMP,,}"
set +e
$D compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" up -d --build >"$ART/logs/compose-up.log" 2>&1
COMPOSE_EXIT=$?
set -e
$D compose -p "$COMPOSE_PROJECT" -f "$ROOT/docker-compose.yml" -f "$ROOT/e2e/integration/compose.overlay.yml" ps >"$ART/logs/compose-ps.log" 2>&1 || true

# Hosted Next on loopback for the click path when the app container is not serving yet.
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:3000/; then
  (cd "$ROOT" && npx next dev --hostname 127.0.0.1 --port 3000 >"$ART/logs/next.log" 2>&1) &
  APP_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:3000/; then break; fi
    sleep 2
  done
fi

export ARTIFACT_DIR="$ART" APP_URL="http://127.0.0.1:3000"
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
bash "$ROOT/stress/run.sh" >"$ART/stress-stdout.json"

python3 - "$ART" "$HEAD_SHA" "$COMPOSE_EXIT" "$PW_EXIT" << 'PY'
import hashlib, json, os, sys
from pathlib import Path
art, sha, compose_exit, pw_exit = sys.argv[1:]
root = Path(art)
files = sorted(p for p in root.rglob("*") if p.is_file() and p.name != "summary.json" and p.name != "SHA256SUMS")
lines = []
for path in files:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    lines.append(f"{digest}  {path.relative_to(root)}")
(root / "SHA256SUMS").write_text("\n".join(lines) + ("\n" if lines else ""))
matrix = []
matrix_path = root / "journey-matrix.json"
if matrix_path.exists():
    matrix = json.loads(matrix_path.read_text()).get("steps", [])
cases = []
cases_path = root / "stress" / "cases.json"
if cases_path.exists():
    cases = json.loads(cases_path.read_text())
summary = {
    "head": sha,
    "composeExit": int(compose_exit),
    "playwrightExit": int(pw_exit),
    "journeys": matrix,
    "stress": cases,
}
(root / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(art)
PY
echo "summary=$ART/summary.json"
