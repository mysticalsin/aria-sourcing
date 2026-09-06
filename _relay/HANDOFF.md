---
project: MSourcing / ARIA
shift: 106
agent: cursor-cloud
updated: 2026-09-06T00:50Z
status: openbot-same-aria-api-key
---

# Handoff — Shift 106

## Current state

- **Branch:** `cursor/linkedin-auto-vm-fleet-b91d` (PR to reopen/create onto `integration/sourcing-enrichment-on-main`)
- **Product direction (locked):** Automatic LinkedIn = OpenBot Browser Computer; OpenBot LLM = Aria `/api/openbot/v1` using **the same Aria PROVIDER_ENV API key**
- **E2E status:** openbot-llm-auth 9/9, openbot-e2e 28/28, tsc clean

## Done this shift

1. OpenBot LLM proxy auth now accepts Aria’s configured provider API key (e.g. `OPENAI_API_KEY`) as Bearer — same key spent upstream
2. Shared helper `src/lib/openbot/llm-auth.ts`; chat + models routes + element picker use it
3. README documents `OPENAI_API_KEY=<same as Aria OPENAI_API_KEY>` (optional `OPENBOT_LLM_PROXY_TOKEN` still spends Aria’s key)
4. Tests assert same-key auth + upstream Authorization header

## Blockers (live Fly smoke)

1. Real OpenBot supervisor URL/token + `COMPUTER_TOKEN` on Fly / Settings
2. Admin seat create + Fleet Observe LinkedIn login/2FA
3. Point OpenBot agent at Aria with **same** Aria LLM key
4. Do not set `COMPUTER_SUPERVISOR_MOCK_SEND=1` on production

## Next steps

1. Deploy/configure Fly secrets; smoke one Automatic LinkedIn send against live OpenBot
2. Set OpenBot `OPENAI_BASE_URL=https://<aria>/api/openbot/v1` and `OPENAI_API_KEY=<Aria OPENAI_API_KEY>`
3. Mark PR ready after live smoke

## Decisions made (don't relitigate)

- Production = Fly only
- Automatic send = OpenBot Browser Computer
- OpenBot reuses Aria’s **same** LLM API key (not a separate model key / not proxy-token-as-model-key)
- Login inside OpenBot sandbox (Fleet Observe)

## Watch out

- Agent-computer URL from ensure must be reachable from Aria process network
- Never commit supervisor / computer / LLM secrets
- Optional `OPENBOT_LLM_PROXY_TOKEN` is service auth only; upstream still uses Aria PROVIDER_ENV keys
