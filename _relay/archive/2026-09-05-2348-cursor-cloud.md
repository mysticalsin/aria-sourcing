---
project: MSourcing / ARIA
shift: 104
agent: cursor-cloud
updated: 2026-09-05T22:30Z
status: openbot-wired-to-aria-llm
---

# Handoff — Shift 104

## Current state

- **Branch:** `cursor/linkedin-auto-vm-fleet-b91d` (push + open/update PR onto `integration/sourcing-enrichment-on-main`)
- **Product direction (locked):** Automatic LinkedIn = **OpenBot Browser Computer**; LLM for OpenBot agents = **same Aria vault/env** via `/api/openbot/v1`
- Upstream: https://github.com/CopilotKit/openbot

## Done this shift

1. OpenBot HTTP clients in `src/lib/openbot/` (bot-id, supervisor ensure/stop/reset, agent-computer navigate/snapshot/click/type, LinkedIn send heuristics + optional Aria LLM pick)
2. `src/lib/computer-supervisor.ts` remote path calls real OpenBot `/computers/:botId/ensure|stop|reset`, then drives agent-computer with `COMPUTER_TOKEN` / `OPENBOT_COMPUTER_TOKEN`
3. Aria OpenAI-compatible LLM proxy: `POST /api/openbot/v1/chat/completions`, `GET /api/openbot/v1/models` (auth `OPENBOT_LLM_PROXY_TOKEN`; spends Aria `PROVIDER_ENV` keys)
4. Docs: `services/computer-supervisor/README.md` — OpenBot connect + LLM proxy env
5. Tests: `computer-supervisor` 8/8, `openbot-bot-id` 7/7; registered in `tests/test-manifest.mjs`; `tsc --noEmit` green

## Blockers

1. Operator must set live OpenBot supervisor URL + token (Settings vault or Fly `COMPUTER_SUPERVISOR_URL` / `COMPUTER_SUPERVISOR_TOKEN`)
2. Set `COMPUTER_TOKEN` (or `OPENBOT_COMPUTER_TOKEN`) on Aria to match OpenBot’s agent-computer secret
3. For OpenBot agents using Aria LLM: set `OPENBOT_LLM_PROXY_TOKEN` on Aria; point OpenBot `OPENAI_BASE_URL` at `https://<aria>/api/openbot/v1`
4. Admin: create Browser Computer seat → Fleet Observe → LinkedIn login/2FA
5. Do **not** set `COMPUTER_SUPERVISOR_MOCK_SEND=1` on production

## Next steps

1. Commit/push this branch; open or update PR
2. Configure Fly secrets: supervisor URL/token, computer token, optional LLM proxy token
3. Smoke Automatic LinkedIn send through OpenBot computer
4. Point OpenBot agent compose at Aria LLM proxy; confirm completions

## Decisions made (don't relitigate)

- Production = Fly only (`aria-mantu-app`)
- Automatic send path = OpenBot Browser Computer (primary)
- OpenBot must reuse Aria LLM API (proxy) — no separate OpenBot model keys
- Login for Automatic seats happens inside OpenBot sandbox (Fleet Observe)
- Postgres contact lease = only double-contact lock
- Aria vault primary; env fallback

## Watch out

- OpenBot ensure returns `url`/`port`; Aria needs reachable agent-computer URL from the Aria process network
- Header names: `x-openbot-computer-token`, `x-openbot-bot-id`
- Never commit supervisor / computer / LLM proxy secrets
- Provider string `LinkedIn Browser Computer`; vault provider `Computer Supervisor`
