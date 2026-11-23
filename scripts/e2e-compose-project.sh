#!/usr/bin/env bash
# Compose project name for the integration sweep.
# macOS /bin/bash 3.2 has no Bash 4 case-modification. An unset or empty
# COMPOSE_PROJECT becomes aria-int-<lowercase stamp>. A value already
# set is kept. The ${COMPOSE_PROJECT:-} form is safe under set -u.
e2e_compose_project() {
  if [ -n "${COMPOSE_PROJECT:-}" ]; then
    printf '%s\n' "$COMPOSE_PROJECT"
    return 0
  fi
  printf 'aria-int-%s\n' "$(printf '%s' "${1:-}" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
}
