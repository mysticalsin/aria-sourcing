#!/usr/bin/env bash
# print-fly-missing-secrets.sh — live inventory of enterprise secrets (names only).
#
# Buckets (match verify-m365-ready / E2E RESULT: PASS):
#   graph — required for Graph Outlook + Teams book (fail-closed)
#   entra — GoTrue Azure SSO (optional WARN)
#   llm   — Fly-env provider keys (optional WARN; Hermes/vault may already green E2E)
#   loop  — ARIA_LOOP_KILL_SWITCH (ops safety; not Graph PASS)
#
# Machine footer (stable for probes):
#   graph_secrets_missing=N
#   entra_secrets_missing=N
#   llm_env_missing=N
#   loop_secrets_missing=N
#
# Exit 1 iff graph_secrets_missing > 0. Uses production-readiness/.fly-token.env
# when FLY_API_TOKEN is unset. Does not print secret values.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN or .fly-token.env required" >&2; exit 1; }
command -v flyctl >/dev/null 2>&1 || { echo "flyctl required" >&2; exit 1; }

app="$(flyctl secrets list -a aria-mantu-app 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"
auth="$(flyctl secrets list -a aria-mantu-auth 2>/dev/null | awk 'NR>1 && $1 != "" && $1 != "NAME" {print $1}' || true)"

graph_missing=0
entra_missing=0
llm_missing=0
loop_missing=0

check() {
  local bucket="$1" scope="$2" name="$3" list="$4"
  if ! printf '%s\n' "$list" | grep -qx "$name"; then
    case "$bucket" in
      graph)
        echo "MISSING  $scope/$name  #graph"
        graph_missing=$((graph_missing + 1))
        ;;
      entra)
        echo "WARN     $scope/$name  #entra (optional for Graph E2E PASS)"
        entra_missing=$((entra_missing + 1))
        ;;
      loop)
        echo "WARN     $scope/$name  #loop (ops; not Graph E2E PASS)"
        loop_missing=$((loop_missing + 1))
        ;;
      *)
        echo "WARN     $scope/$name  #$bucket"
        ;;
    esac
  else
    echo "present  $scope/$name  #$bucket"
  fi
}

echo "=== Graph (required for E2E PASS / verify-m365-ready) ==="
for name in DATA_ENCRYPTION_KEY EMAIL_INBOUND_WEBHOOK_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI MICROSOFT_TENANT_ID; do
  check graph aria-mantu-app "$name" "$app"
done

echo "=== Loop safety (ops; not Graph E2E PASS) ==="
check loop aria-mantu-app ARIA_LOOP_KILL_SWITCH "$app"

echo "=== Fly-env LLM (optional — Hermes/vault may already green E2E) ==="
if printf '%s\n' "$app" | grep -Eqx 'KIMI_API_KEY|DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY'; then
  echo "present  aria-mantu-app/(KIMI|DEEPSEEK|ANTHROPIC|OPENAI)_API_KEY  #llm"
else
  echo "WARN     aria-mantu-app/(KIMI|DEEPSEEK|ANTHROPIC|OPENAI)_API_KEY  #llm (optional for Graph E2E PASS)"
  llm_missing=1
fi

echo "=== Entra SSO on aria-mantu-auth (optional for Graph E2E PASS) ==="
for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
  check entra aria-mantu-auth "$name" "$auth"
done

echo
echo "graph_secrets_missing=${graph_missing}"
echo "entra_secrets_missing=${entra_missing}"
echo "llm_env_missing=${llm_missing}"
echo "loop_secrets_missing=${loop_missing}"

if [ "$graph_missing" -gt 0 ]; then
  echo "$graph_missing Graph secret(s) missing — templates: bash scripts/print-fly-secrets-checklist.sh" >&2
  echo "  Entra/LLM WARNs do not block Graph E2E PASS / verify-m365-ready." >&2
  exit 1
fi
if [ "$entra_missing" -gt 0 ] || [ "$llm_missing" -gt 0 ] || [ "$loop_missing" -gt 0 ]; then
  echo "Graph secrets present. Optional WARNs remain (Entra SSO / Fly-env LLM / loop kill switch)."
  exit 0
fi
echo "All inventoried enterprise secrets present (Graph + Entra + LLM + loop)."
exit 0
