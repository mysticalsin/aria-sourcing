#!/usr/bin/env bash
# Offline checks for the Mac E2E harness. No Docker, no Go install.
# macOS /bin/bash 3.2 safe.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
status=0

fail() {
  echo "FAIL: $*" >&2
  status=1
}

scan() {
  if [ ! -f "$1" ]; then
    fail "missing $1"
    return 0
  fi
  if grep -nE '\$\{[^}]*(\^\^|,,)' "$1"; then
    fail "Bash 4 case-mod in $1"
  fi
  if grep -nE 'declare[[:space:]]+-A' "$1"; then
    fail "associative array in $1"
  fi
}

scan "$ROOT/scripts/integration-e2e.sh"
scan "$ROOT/scripts/integration-e2e-mac.sh"
scan "$ROOT/scripts/e2e-compose-project.sh"
scan "$ROOT/scripts/e2e-go.sh"
scan "$ROOT/stress/run.sh"

if [ -f "$ROOT/scripts/e2e-go.sh" ]; then
  # shellcheck disable=SC1091
  . "$ROOT/scripts/e2e-go.sh"
  isolated="$(mktemp -d)"
  mkdir -p "$isolated/bin"
  printf '%s\n' '#!/bin/sh' 'echo go-version-synthetic' > "$isolated/bin/go"
  chmod +x "$isolated/bin/go"
  found="$(PATH="$isolated/empty" e2e_find_go "$isolated/bin/go" || true)"
  if [ "$found" != "$isolated/bin/go" ]; then
    fail "did not discover go off PATH at [$found]"
  fi
  if PATH="$isolated/empty" e2e_find_go "$isolated/missing/go" >/dev/null 2>&1; then
    fail "missing go was treated as present"
  fi
  repro="$(e2e_go_skip_repro)"
  case "$repro" in
    *'not a product failure'*) ;;
    *) fail "skip text does not say this is not a product failure: $repro" ;;
  esac
  case "$repro" in
    *'does not install'*) ;;
    *) fail "skip text does not say the harness does not install Go: $repro" ;;
  esac
  rm -rf "$isolated"
fi

if ! grep -q 'e2e_find_go' "$ROOT/stress/run.sh"; then
  fail "stress/run.sh does not discover go"
fi
if ! grep -q 'e2e_go_skip_repro' "$ROOT/stress/run.sh"; then
  fail "stress/run.sh does not record the harness skip"
fi
if ! grep -q 'SKIP' "$ROOT/stress/run.sh"; then
  fail "stress/run.sh has no SKIP status for a missing toolchain"
fi
if ! grep -q 'e2e_find_go' "$ROOT/scripts/integration-e2e-mac.sh"; then
  fail "Mac entrypoint does not discover go"
fi
if ! grep -q 'e2e-summary.py' "$ROOT/scripts/integration-e2e.sh"; then
  fail "integration harness does not build the summary with e2e-summary.py"
fi
if ! grep -q 'function persist' "$ROOT/e2e/integration/journeys.spec.ts"; then
  fail "journeys are written only at the end of the Playwright test"
fi

if [ -f "$ROOT/scripts/e2e-summary.py" ]; then
  art="$(mktemp -d)"
  mkdir -p "$art/logs"
  printf '%s\n' 'Error: browserType.launch: Executable does not exist' > "$art/logs/playwright.log"
  python3 "$ROOT/scripts/e2e-summary.py" "$art" '94164d39921a346fceeefce7b934be10c760732f' 0 1 >/dev/null
  python3 - "$art/summary.json" << 'PY'
import json, sys
summary = json.load(open(sys.argv[1]))
assert summary["journeys"] == [], summary["journeys"]
assert summary["playwrightExit"] == 1
note = summary.get("journeysNote", "")
assert "not a product pass" in note, note
assert "journey-matrix.json was not written" in note, note
assert "Executable does not exist" in note, note
print("empty-journeys-note=ok")
PY
  printf '%s\n' '{"steps":[{"id":"create-need","status":"pass","detail":"synthetic","screenshot":""}]}' > "$art/journey-matrix.json"
  python3 "$ROOT/scripts/e2e-summary.py" "$art" '94164d39921a346fceeefce7b934be10c760732f' 0 1 >/dev/null
  python3 - "$art/summary.json" << 'PY'
import json, sys
summary = json.load(open(sys.argv[1]))
assert [step["id"] for step in summary["journeys"]] == ["create-need"], summary["journeys"]
assert "journeysNote" not in summary, summary.get("journeysNote")
print("recorded-journeys=ok")
PY
  rm -rf "$art"
fi

exit "$status"
