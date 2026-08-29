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

# Graph-only readiness (Entra/LLM are WARN in print-fly-missing-secrets).
inv="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null || true)"
graph_missing="$(printf '%s\n' "$inv" | sed -n 's/^graph_secrets_missing=//p' | tail -1)"
entra_missing="$(printf '%s\n' "$inv" | sed -n 's/^entra_secrets_missing=//p' | tail -1)"
llm_missing="$(printf '%s\n' "$inv" | sed -n 's/^llm_env_missing=//p' | tail -1)"
graph_missing="${graph_missing:-unknown}"
entra_missing="${entra_missing:-unknown}"
llm_missing="${llm_missing:-unknown}"
echo "  fly_graph_secrets_missing=${graph_missing}"
echo "  fly_entra_secrets_missing=${entra_missing}"
echo "  fly_llm_env_missing=${llm_missing}"
# Compat alias: m365 = Graph bucket only (E2E PASS / verify-m365-ready).
echo "  fly_m365_missing=${graph_missing}"

if [ "$graph_missing" = "0" ]; then
  echo "RESULT: fly-secrets-ready"
  if [ "${entra_missing:-0}" != "0" ] || [ "${llm_missing:-0}" != "0" ]; then
    echo "  note: Entra/LLM optional WARNs remain — Graph E2E PASS does not require them"
  fi
  exit 0
fi

if owner_ms_has_credentials; then
  if [ "$APPLY" = "1" ]; then
    if owner_ms_has_env_exports && ! owner_ms_has_drop_file; then
      echo "Syncing env exports to /tmp/owner-microsoft.env (values not printed)…"
      owner_ms_sync_env_to_dropzone
    fi
    echo "Applying owner Microsoft secrets to Fly…"
    bash "$repo/scripts/fly-apply-owner-microsoft-secrets.sh"
    inv_after="$(bash "$repo/scripts/print-fly-missing-secrets.sh" 2>/dev/null || true)"
    missing_after="$(printf '%s\n' "$inv_after" | sed -n 's/^graph_secrets_missing=//p' | tail -1)"
    missing_after="${missing_after:-unknown}"
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
