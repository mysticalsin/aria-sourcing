# OpenBot ↔ Aria same-API-key E2E (2026-09-07)

## Latest Aria

- Integration tip: `d46a3d2` (`feat(linkedin): LinkedIn as a real channel…`)
- This branch is ahead with OpenBot Browser Computer + same-key LLM proxy + connect-path fixes
- Live Fly tip still on build `911634d` (pre-`/api/openbot/v1`)

## What was verified

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `tests/openbot-llm-auth.mts` | 9/9 |
| `tests/openbot-e2e.mts` | 30/30 |
| `tests/openbot-live-same-key.mts` | 19/19 |
| `tests/computer-supervisor.mts` | 10/10 |
| `tests/linkedin-credentials.mts` | 16/16 |
| `tests/linkedin-channel-contract.mts` | 17/17 |
| `tests/sourcing-automatic-deliver.mts` | 7/7 |

### Same-key + LinkedIn connect contract

1. OpenBot Bearer = Aria Fly `KIMI_API_KEY` → accepted; upstream Authorization identical
2. LinkedIn Browser Computer: ensure → navigate → LLM-assisted Message → type → Send
3. Connect path fixes: stable `computer_id`, Fleet binds Settings supervisor creds, Start/Open view/Take control start OpenBot, URL+token required

### Live Fly

- `/api/health` 200; `/api/ready` not_ready (`agentFrameworks: false`)
- `/api/openbot/v1/*` **404** until PR deploy
- `/api/fleet/computers`, `/api/linkedin/connections` exist (401 without auth)
- `KIMI_API_KEY` on Fly still **401** at Kimi upstream — rotate before live LLM
- No `COMPUTER_SUPERVISOR_*` secrets on Fly yet

## How you connect LinkedIn with OpenBot (after deploy)

1. Settings → Integrations → LinkedIn: set OpenBot supervisor URL + Computer Supervisor vault token
2. Create OpenBot Browser Computer seat
3. Fleet → Computers → Start / Open view / Take control → log into LinkedIn in the sandbox
4. OpenBot agent: `OPENAI_BASE_URL=https://aria-mantu-app.fly.dev/api/openbot/v1` and `OPENAI_API_KEY=<same KIMI_API_KEY>`
5. Keep Delivery mode Automatic
