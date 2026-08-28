#!/usr/bin/env bash
# probe-fly-llm-auth.sh — verify cloud LLM env keys on aria-mantu-app actually authenticate.
#
# print-fly-missing-secrets.sh only checks secret *presence*. A present but expired
# KIMI_API_KEY still yields critics_required on strict E2E. This probe hits /models.
#
# Usage:
#   bash scripts/probe-fly-llm-auth.sh
# Exit 0 when at least one preferred provider authenticates; 1 when all fail / none set.
set -euo pipefail

APP="${ARIA_FLY_APP:-aria-mantu-app}"

if [ -z "${FLY_API_TOKEN:-}" ] && [ -r "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/production-readiness/.fly-token.env" ]; then
  export FLY_API_TOKEN="$(tr -d '\n\r ' < "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/production-readiness/.fly-token.env")"
fi

command -v flyctl >/dev/null 2>&1 || { echo "flyctl required" >&2; exit 1; }

echo "=== Fly LLM auth probe ($APP) ==="

OUT="$(flyctl ssh console -a "$APP" -C 'node -e "
(async () => {
  async function probe(name, key, url, extraHeaders) {
    if (!key || !String(key).trim()) {
      console.log(\"  \" + name + \"=absent\");
      return null;
    }
    try {
      const headers = Object.assign({ Authorization: \"Bearer \" + key }, extraHeaders || {});
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      const status = r.status;
      const authOk = status === 200 || status === 404;
      const label = status === 401 || status === 403 ? \"auth_dead\" : (authOk ? \"ok\" : \"http_\" + status);
      console.log(\"  \" + name + \"=\" + label + \" (HTTP \" + status + \")\");
      return label === \"ok\" ? name : (label === \"auth_dead\" || label.startsWith(\"http_\") || label === \"error\" ? false : false);
    } catch (e) {
      console.log(\"  \" + name + \"=error (\" + (e && e.message ? e.message : \"fail\") + \")\");
      return false;
    }
  }
  const kimiBase = (process.env.KIMI_BASE_URL || \"https://api.moonshot.ai/v1\").replace(/\\/+$/,\"\");
  const deepseekBase = (process.env.DEEPSEEK_BASE_URL || \"https://api.deepseek.com\").replace(/\\/+$/,\"\");
  let ok = 0;
  let attempted = 0;
  let firstLive = null;
  const results = [];
  results.push(await probe(\"kimi\", process.env.KIMI_API_KEY, kimiBase + \"/models\"));
  results.push(await probe(\"anthropic\", process.env.ANTHROPIC_API_KEY, \"https://api.anthropic.com/v1/models\", { \"x-api-key\": process.env.ANTHROPIC_API_KEY || \"\", \"anthropic-version\": \"2023-06-01\" }));
  results.push(await probe(\"openai\", process.env.OPENAI_API_KEY, \"https://api.openai.com/v1/models\"));
  results.push(await probe(\"deepseek\", process.env.DEEPSEEK_API_KEY, deepseekBase + \"/models\"));
  for (const r of results) {
    if (r === null) continue;
    attempted += 1;
    if (typeof r === \"string\") {
      ok += 1;
      if (!firstLive) firstLive = r;
    }
  }
  if (firstLive) console.log(\"FIRST_LIVE_PROVIDER=\" + firstLive);
  console.log(\"RESULT: \" + (ok > 0 ? \"llm_auth_ok\" : (attempted === 0 ? \"llm_keys_absent\" : \"llm_auth_dead\")));
  process.exit(ok > 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
"' 2>&1)" || true

# Strip flyctl connection noise; keep probe lines.
printf '%s\n' "$OUT" | grep -E '^[[:space:]]*(kimi|anthropic|openai|deepseek)=|^FIRST_LIVE_PROVIDER=|^RESULT:|^===|^Connecting' || printf '%s\n' "$OUT"

provider_cache="/tmp/aria-e2e-agent-provider"
if printf '%s\n' "$OUT" | grep -q 'RESULT: llm_auth_ok'; then
  first="$(printf '%s\n' "$OUT" | sed -n 's/^FIRST_LIVE_PROVIDER=//p' | head -1 | tr -d '\r')"
  if [ -n "$first" ]; then
    printf '%s\n' "$first" > "$provider_cache"
  fi
  exit 0
fi
rm -f "$provider_cache"
exit 1
