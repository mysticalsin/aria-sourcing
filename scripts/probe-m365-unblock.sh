#!/usr/bin/env bash
# probe-m365-unblock.sh — reprobe M365 blocker; auto-apply when drop-zone or env exports ready.
#
# Usage:
#   bash scripts/probe-m365-unblock.sh           # status only
#   bash scripts/probe-m365-unblock.sh --apply   # apply to Fly when credentials present
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/lib/owner-microsoft-credentials.sh
source "$repo/scripts/lib/owner-microsoft-credentials.sh"

echo "=== M365 unblock probe ==="
if owner_ms_has_drop_file; then
  echo "  credentials=drop-file"
elif owner_ms_has_env_exports; then
  echo "  credentials=env-exports"
else
  echo "  credentials=none"
fi

missing="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -c '^MISSING' || true)"
echo "  fly_m365_missing=${missing}"

if [ "$missing" = "0" ]; then
  echo "RESULT: fly-secrets-ready"
  exit 0
fi

if owner_ms_has_credentials; then
  if [ "$APPLY" = "1" ]; then
    echo "Applying owner Microsoft secrets to Fly…"
    bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
    missing_after="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null | grep -c '^MISSING' || true)"
    if [ "$missing_after" = "0" ]; then
      echo "RESULT: applied-ok"
      exit 0
    fi
    echo "RESULT: apply-ran-still-missing=${missing_after}" >&2
    exit 3
  fi
  echo "RESULT: credentials-present-not-applied (run with --apply)"
  exit 2
fi

echo "RESULT: owner-blocked"
echo "  bash scripts/print-m365-owner-portal-checklist.sh"
exit 1
