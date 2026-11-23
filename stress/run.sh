#!/usr/bin/env bash
# Run stress cases A1-A8. Synthetic data, loopback only.
# Prints a JSON object on stdout. Logs land in $ARTIFACT_DIR.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART="${ARTIFACT_DIR:-${ROOT}/e2e-artifacts/stress}"
mkdir -p "$ART"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
SOAK="${STRESS_SOAK_SECONDS:-1800}"
PG_NAME="${STRESS_PG_NAME:-aria-stress-pg}"
results="$ART/cases.json"
printf '[]' > "$results"

record() {
  local id="$1" status="$2" repro="$3"
  python3 - "$results" "$id" "$status" "$repro" "$HEAD_SHA" << 'PY'
import json, sys
path, case, status, repro, sha = sys.argv[1:]
rows = json.load(open(path))
rows.append({"id": case, "status": status, "head": sha, "repro": repro})
json.dump(rows, open(path, "w"), indent=2)
PY
}

docker_bin() {
  if docker info >/dev/null 2>&1; then echo docker; else echo "sudo docker"; fi
}
D="$(docker_bin)"

link_channels() {
  ln -sfn "$ROOT/stress/channels_stress_test.go" "$ROOT/services/channels/zz_stress_test.go"
  ln -sfn "$ROOT/stress/hiregate_test.go" "$ROOT/services/internal/recruit/zz_stress_hire_test.go"
}
unlink_channels() {
  rm -f "$ROOT/services/channels/zz_stress_test.go" "$ROOT/services/internal/recruit/zz_stress_hire_test.go"
}
trap unlink_channels EXIT
link_channels

run_go() {
  local id="$1" dir="$2" pkg="$3" pattern="$4" limit="$5"
  local log="$ART/${id}.log"
  if (cd "$dir" && go test -count=1 -timeout "$limit" -run "$pattern" "$pkg") >"$log" 2>&1; then
    record "$id" PASS "$(tail -n 5 "$log" | tr '\n' ' ')"
  else
    record "$id" FAIL "$(tail -n 20 "$log" | tr '\n' ' ')"
  fi
}

# A1 persistent Postgres cap, then the in-process per-channel cap.
$D rm -f "$PG_NAME" >/dev/null 2>&1 || true
if $D run -d --name "$PG_NAME" --network host -e POSTGRES_PASSWORD=synthetic -e POSTGRES_USER=aria -e POSTGRES_DB=aria --memory=256m --memory-swap=256m postgres:16-alpine >"$ART/pg.cid" 2>"$ART/a1-pg.log"; then
  ready=0
  for _ in $(seq 1 40); do
    if $D exec "$PG_NAME" pg_isready -U aria -d aria >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" = 1 ] && $D exec -i "$PG_NAME" psql -U aria -d aria -v ON_ERROR_STOP=1 < "$ROOT/stress/sql/daily-cap.sql" >>"$ART/a1-pg.log" 2>&1; then
    if DOCKER_CMD="$D" STRESS_PG_NAME="$PG_NAME" python3 - << 'PY' >>"$ART/a1-pg.log" 2>&1
import json, os, subprocess
N=50
attempts=10*N
name=os.environ["STRESS_PG_NAME"]
docker=os.environ["DOCKER_CMD"].split()
ws="00000000-0000-4000-8000-0000000000a1"
def one(_):
    sql=f"select public.consume_outreach_channel_daily_cap('{ws}'::uuid, 'Email', {N});"
    out=subprocess.check_output(docker+["exec","-i",name,"psql","-U","aria","-d","aria","-tA","-c",sql], text=True).strip()
    row=json.loads(out)
    return bool(row["allowed"]), row["reason"]
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(20) as pool:
    rows=list(pool.map(one, range(attempts)))
sent=sum(1 for ok,_ in rows if ok)
refused=sum(1 for ok,reason in rows if (not ok) and reason=="channel-cap")
print(f"postgres sent={sent} refused={refused}")
if sent!=N or refused!=attempts-N:
    raise SystemExit(1)
PY
    then record A1-postgres PASS "N=50 workers=20 attempts=500 sent=50 reason=channel-cap"
    else record A1-postgres FAIL "see $ART/a1-pg.log"
    fi
  else
    record A1-postgres FAIL "postgres did not become ready"
  fi
else
  record A1-postgres FAIL "could not start postgres"
fi
$D rm -f "$PG_NAME" >/dev/null 2>&1 || true

run_go A1-channel "$ROOT/services/channels" . 'TestStressA1Caps' 90s
run_go A2 "$ROOT/services/channels" . 'TestStressA2KillSwitch' 90s
run_go A3 "$ROOT/services/channels" . 'TestStressA3AutoPause' 90s
run_go A4 "$ROOT/services/channels" . 'TestStressA4ApprovalReplay' 90s
run_go A5 "$ROOT/services" ./internal/recruit/ 'TestStressA5HiredGate' 180s
run_go A6 "$ROOT/services/channels" . 'TestStressA6ChannelBurst' 60s

if (cd "$ROOT" && node --import tsx --test stress/a7-token.mts) >"$ART/A7.log" 2>&1; then
  record A7 PASS "expire refused, revoke stops sends, 20 deliveries, fixture token absent from the log"
else
  record A7 FAIL "$(tail -n 20 "$ART/A7.log" | tr '\n' ' ')"
fi

if [ "$SOAK" != 0 ]; then
  if (cd "$ROOT/services/channels" && STRESS_SOAK_SECONDS="$SOAK" go test -count=1 -timeout "$((SOAK + 120))s" -run TestStressA8Soak .) >"$ART/A8.log" 2>&1; then
    record A8 PASS "$(tail -n 3 "$ART/A8.log" | tr '\n' ' ')"
  else
    record A8 FAIL "$(tail -n 20 "$ART/A8.log" | tr '\n' ' ')"
  fi
fi

python3 - "$results" "$HEAD_SHA" << 'PY'
import json, sys
rows=json.load(open(sys.argv[1]))
print(json.dumps({"head": sys.argv[2], "cases": rows}, indent=2))
PY
