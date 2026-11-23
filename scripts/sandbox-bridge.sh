#!/bin/sh
# Decide whether the sweep may change the bridge filter.
# A developer Mac is never changed. A plain developer host is never changed.
# Prints "apply" or "skip: <reason>" and exits 0. It does not run iptables.
set -u
os="${SANDBOX_UNAME:-$(uname -s)}"
if [ "$os" = "Darwin" ]; then
  echo "skip: host firewall is not changed on macOS"
  exit 0
fi
if [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ] || [ -n "${CURSOR_AGENT:-}" ] || [ "${ARIA_SANDBOX:-}" = "1" ]; then
  echo "apply"
  exit 0
fi
echo "skip: bridge rule runs only in CI or a VM sandbox"
exit 0
