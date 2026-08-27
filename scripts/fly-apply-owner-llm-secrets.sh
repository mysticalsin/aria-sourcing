#!/usr/bin/env bash
# fly-apply-owner-llm-secrets.sh — apply owner-supplied LLM keys to Fly.
#
# Does NOT invent credentials. Reads from (in order):
#   1) /tmp/owner-llm.env
#   2) production-readiness/.owner-llm.env
#   3) already-exported shell environment
# Refuses empty / PLACEHOLDER_* values.
#
# Accepts any one of:
#   KIMI_API_KEY (+ optional KIMI_BASE_URL)
#   OPENAI_API_KEY
#   ANTHROPIC_API_KEY
#
# Usage:
#   cp production-readiness/.owner-llm.env.example /tmp/owner-llm.env
#   # edit real values
#   bash scripts/fly-apply-owner-llm-secrets.sh
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

load_owner_env_file() {
  local path="$1"
  [ -r "$path" ] || return 0
  echo "Loading owner secrets from $path (values not printed)"
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
}

load_owner_env_file "/tmp/owner-llm.env"
load_owner_env_file "$repo/production-readiness/.owner-llm.env"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$repo/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$repo/production-readiness/.fly-token.env")"
fi
[ -n "${FLY_API_TOKEN:-}" ] || { echo "FLY_API_TOKEN or .fly-token.env required" >&2; exit 1; }
command -v flyctl >/dev/null 2>&1 || { echo "flyctl required" >&2; exit 1; }

is_placeholder() {
  local v="$1"
  case "$v" in
    ""|PLACEHOLDER*|placeholder*|your-*|YOUR-*|changeme|CHANGEME) return 0 ;;
    *) return 1 ;;
  esac
}

APP_ARGS=()
if ! is_placeholder "${KIMI_API_KEY:-}"; then
  APP_ARGS+=("KIMI_API_KEY=${KIMI_API_KEY}")
  if ! is_placeholder "${KIMI_BASE_URL:-}"; then
    APP_ARGS+=("KIMI_BASE_URL=${KIMI_BASE_URL}")
  fi
fi
if ! is_placeholder "${OPENAI_API_KEY:-}"; then
  APP_ARGS+=("OPENAI_API_KEY=${OPENAI_API_KEY}")
fi
if ! is_placeholder "${ANTHROPIC_API_KEY:-}"; then
  APP_ARGS+=("ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}")
fi

if [ "${#APP_ARGS[@]}" -eq 0 ]; then
  echo "ERROR: need a real KIMI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY (drop /tmp/owner-llm.env)." >&2
  exit 1
fi

echo "Setting LLM secret(s) on aria-mantu-app (values not printed)…"
flyctl secrets set -a aria-mantu-app "${APP_ARGS[@]}"
echo "OK — LLM secrets applied. Re-probe intake after machines recycle."
echo "  curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'"
