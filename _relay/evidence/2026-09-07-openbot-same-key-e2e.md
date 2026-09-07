# OpenBot ↔ Aria same-API-key E2E (2026-09-07)

## What was verified

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `tests/openbot-llm-auth.mts` | 9/9 |
| `tests/openbot-e2e.mts` | 30/30 |
| `tests/openbot-live-same-key.mts` | 19/19 |
| `tests/computer-supervisor.mts` | 8/8 |
| `tests/sourcing-automatic-deliver.mts` | 7/7 |
| `tests/linkedin-channel-contract.mts` | 17/17 |
| `tests/linkedin-credentials.mts` | 15/15 |

### Same-key contract (proven)

1. OpenBot presents Aria’s Fly `KIMI_API_KEY` bytes as `Authorization: Bearer …` to `/api/openbot/v1`.
2. Aria accepts that Bearer (`auth: aria_api_key`).
3. Upstream chat request uses **the identical** `Authorization: Bearer <same key>`.
4. LinkedIn Browser Computer path: ensure → navigate → LLM-assisted Message click → type → Send succeeds against mock OpenBot supervisor/agent-computer while LLM assist spends the same Aria key.

### Live Fly observations

- `https://aria-mantu-app.fly.dev/api/health` → 200
- `/api/openbot/v1/models` → **404** (OpenBot proxy not deployed yet; tip is still pre-OpenBot build `911634d…`)
- `/api/fleet/computers` → 401 No workspace (route exists; auth required)
- Fly secrets include `KIMI_API_KEY` + `KIMI_BASE_URL=https://api.kimi.com/coding/v1`
- Direct calls to that Kimi base with the deployed key → **401 invalid/expired** (ops must rotate `KIMI_API_KEY` before live LLM smoke)
- No `COMPUTER_SUPERVISOR_URL` / `COMPUTER_TOKEN` on Fly yet → live Chromium OpenBot LinkedIn login not configured

## Operator next steps

1. Rotate/fix Fly `KIMI_API_KEY` so Moonshot/Kimi accepts it.
2. Merge + deploy this branch so `/api/openbot/v1` exists on Fly.
3. Set OpenBot agent: `OPENAI_BASE_URL=https://aria-mantu-app.fly.dev/api/openbot/v1` and `OPENAI_API_KEY=<same KIMI_API_KEY>`.
4. Set `COMPUTER_SUPERVISOR_URL` + supervisor/computer tokens; Fleet → Observe → LinkedIn login.
