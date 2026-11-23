#!/usr/bin/env bash
# Locate a Go toolchain that is already installed.
# macOS /bin/bash 3.2 has no Bash 4 case-modification and no associative arrays.
# This file never downloads or installs Go.
e2e_go_skip_repro() {
  printf '%s\n' "harness: go was not found via command -v or in /usr/local/go/bin/go, /opt/homebrew/bin/go, /usr/local/bin/go, ~/sdk/go/bin/go, ~/go/bin/go. This skip is not a product failure. The harness does not install Go."
}

e2e_find_go() {
  local candidate
  if command -v go >/dev/null 2>&1; then
    command -v go
    return 0
  fi
  if [ "$#" -eq 0 ]; then
    set -- \
      /usr/local/go/bin/go \
      /opt/homebrew/bin/go \
      /usr/local/bin/go \
      "${HOME:-}/sdk/go/bin/go" \
      "${HOME:-}/go/bin/go"
  fi
  for candidate in "$@"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}
