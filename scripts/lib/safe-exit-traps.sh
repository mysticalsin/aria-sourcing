#!/usr/bin/env bash

# Install signal handlers that cannot inherit a successful interrupted-command
# status on macOS Bash 3.2. `exit` then invokes the caller's EXIT cleanup trap.
install_safe_exit_traps() {
  local cleanup_function="$1"
  trap "$cleanup_function" EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}
