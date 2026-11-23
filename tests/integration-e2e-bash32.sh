#!/usr/bin/env bash
# Mac E2E harness must run on macOS /bin/bash 3.2.
# No Docker. Fails if Bash 4 case-modification or associative arrays
# show up in the harness, and checks COMPOSE_PROJECT is set under set -u
# when the environment leaves it unset.
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

helper="$ROOT/scripts/e2e-compose-project.sh"
harness="$ROOT/scripts/integration-e2e.sh"

if [ -f "$helper" ]; then
  got="$(
    # shellcheck disable=SC2016
    env -u COMPOSE_PROJECT bash -c '
      set -u
      # shellcheck disable=SC1090
      . "$1"
      e2e_compose_project "$2"
    ' _ "$helper" '20261123T155400Z'
  )"
  if [ "$got" != "aria-int-20261123t155400z" ]; then
    fail "unset COMPOSE_PROJECT produced [$got]"
  fi

  kept="$(
    # shellcheck disable=SC2016
    COMPOSE_PROJECT="aria-int-kept" bash -c '
      set -u
      . "$1"
      e2e_compose_project "$2"
    ' _ "$helper" '20261123T155400Z'
  )"
  if [ "$kept" != "aria-int-kept" ]; then
    fail "preset COMPOSE_PROJECT became [$kept]"
  fi
fi

if ! grep -q 'e2e_compose_project' "$harness"; then
  fail "integration-e2e.sh does not set COMPOSE_PROJECT via e2e_compose_project"
fi

# The helper assignment has to appear before any later use of the variable.
if [ -f "$harness" ]; then
  first_use="$(grep -n 'COMPOSE_PROJECT' "$harness" | head -n 1 || true)"
  case "$first_use" in
    *'e2e_compose_project'*) ;;
    *) fail "first COMPOSE_PROJECT use is not the defaulting assignment: $first_use" ;;
  esac
fi

exit "$status"
