#!/usr/bin/env bash
# print-fly-missing-secrets.sh — live inventory of MISSING enterprise secrets.
# Uses production-readiness/.fly-token.env when FLY_API_TOKEN is unset/unauthorized.
# Does not print secret values.
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

missing=0
check() {
  local scope="$1" name="$2" list="$3"
  if ! printf '%s\n' "$list" | grep -qx "$name"; then
    echo "MISSING  $scope/$name"
    missing=$((missing + 1))
  else
    echo "present  $scope/$name"
  fi
}

echo "=== aria-mantu-app ==="
for name in EMAIL_INBOUND_WEBHOOK_SECRET MICROSOFT_CLIENT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI MICROSOFT_TENANT_ID ARIA_LOOP_KILL_SWITCH; do
  check aria-mantu-app "$name" "$app"
done
if printf '%s\n' "$app" | grep -Eqx 'KIMI_API_KEY|DEEPSEEK_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY'; then
  echo "present  aria-mantu-app/(KIMI|DEEPSEEK|ANTHROPIC|OPENAI)_API_KEY"
else
  echo "MISSING  aria-mantu-app/(KIMI|DEEPSEEK|ANTHROPIC|OPENAI)_API_KEY"
  missing=$((missing + 1))
fi

echo "=== aria-mantu-auth ==="
for name in GOTRUE_EXTERNAL_AZURE_ENABLED GOTRUE_EXTERNAL_AZURE_CLIENT_ID GOTRUE_EXTERNAL_AZURE_SECRET GOTRUE_EXTERNAL_AZURE_URL; do
  check aria-mantu-auth "$name" "$auth"
done

echo
if [ "$missing" -gt 0 ]; then
  echo "$missing missing — templates: bash scripts/print-fly-secrets-checklist.sh"
  exit 1
fi
echo "All enterprise secrets present."
exit 0
