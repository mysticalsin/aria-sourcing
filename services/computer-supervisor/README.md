# Computer supervisor (OpenBot sandbox / VM)

In-process adapter: `src/lib/computer-supervisor.ts`  
OpenBot HTTP clients: `src/lib/openbot/`  
Driven by:

- `LinkedIn Browser Computer` seats via `src/lib/linkedin-channel.ts`
- Fleet UI: Observe / Take control (closed by default)
- API: `GET/POST /api/fleet/computers`

**Product default:** Automatic LinkedIn outreach uses this OpenBot path — not LinkedIn OIDC and not Vendor API. Operators log into LinkedIn inside the sandbox via Fleet → Computers → Observe / Take control.

Upstream project: [CopilotKit/openbot](https://github.com/CopilotKit/openbot)

## Contract

- **1 seat = 1 Chromium computer** (persistent `profileVolume`)
- **decide → audit → act**; bot actions **refuse** while `control === "human"`
- Login/2FA raises `help_requested` — operator opens Observe / Take control
- Contact permission is **never** decided here — Postgres `claim_contact` is sole authority

## OpenBot remote API (what Aria calls)

Supervisor (Bearer `SUPERVISOR_TOKEN` / Aria vault **Computer Supervisor**):

- `POST /computers/:botId/ensure` → `{ botId, status, port?, url? }`
- `POST /computers/:botId/stop`
- `POST /computers/:botId/reset`
- `GET /computers`

Agent-computer (Bearer / `x-openbot-computer-token` = `COMPUTER_TOKEN`):

- `POST /navigate` `{ url }`
- `POST /snapshot`
- `POST /click` `{ ref, snapshotId }`
- `POST /type` `{ ref, snapshotId, text }`
- `POST /control/take` / `POST /control/release`

Aria maps each seat’s `computerId` to an OpenBot bot id (`src/lib/openbot/bot-id.ts`), ensures the computer, then runs LinkedIn send against the agent-computer URL (`src/lib/openbot/linkedin-send.ts`).

## Same LLM API as Aria (for OpenBot agents)

OpenBot LangGraph/Mastra bots should **not** get their own model keys. Point them at Aria’s OpenAI-compatible proxy:

```bash
# On the OpenBot agent / compose service:
OPENAI_BASE_URL=https://<your-aria-host>/api/openbot/v1
OPENAI_API_KEY=<same value as Aria OPENBOT_LLM_PROXY_TOKEN>
```

Aria side:

```bash
OPENBOT_LLM_PROXY_TOKEN=...          # shared secret OpenBot presents as OPENAI_API_KEY
OPENBOT_LLM_PROVIDER=openai          # optional; else first configured PROVIDER_ENV key
OPENBOT_LLM_MODEL=gpt-4o-mini        # optional override
# Plus the normal Aria LLM keys, e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY / vault
```

Routes:

- `POST /api/openbot/v1/chat/completions`
- `GET  /api/openbot/v1/models`

## Connect OpenBot to Aria

1. Run CopilotKit OpenBot supervisor + agent-computer (isolated Chromium seats / VMs).
2. In Aria → API keys, save the supervisor bearer token under provider **Computer Supervisor**.
3. In Settings → LinkedIn credentials, paste the supervisor base URL and attach that vault key.
4. Set `COMPUTER_TOKEN` / `OPENBOT_COMPUTER_TOKEN` on Aria to the same secret OpenBot injects into computers (needed to drive `/navigate` etc. after ensure).
5. In LinkedIn connections, click **Create OpenBot Browser Computer seat**.
6. Open Fleet → Computers → Observe / Take control and complete LinkedIn login / 2FA inside the sandbox.
7. Keep Delivery mode on **Automatic** — approved LinkedIn messages ensure the seat’s computer and send via the agent-computer.
8. (Optional) Point OpenBot agent `OPENAI_BASE_URL` at Aria’s `/api/openbot/v1` so bots use Aria’s LLM vault/env.

Env fallback (optional; Settings vault is preferred for the supervisor token):

```bash
COMPUTER_SUPERVISOR_URL=https://computers.your-openbot-host.example
COMPUTER_SUPERVISOR_TOKEN=...          # SUPERVISOR_TOKEN
COMPUTER_TOKEN=...                     # or OPENBOT_COMPUTER_TOKEN — agent-computer secret
COMPUTER_SUPERVISOR_MOCK_SEND=1        # local tests only — never on production
OPENBOT_LLM_PROXY_TOKEN=...            # Aria ↔ OpenBot LLM proxy
```

When `COMPUTER_SUPERVISOR_URL` is unset, jobs queue locally and automatic send
fails closed unless `COMPUTER_SUPERVISOR_MOCK_SEND=1`.

## Scale notes (N computers)

| Concurrent computers | Rough RAM |
| --- | --- |
| 2–5 | ~2–8 Gi |
| 20 | ~20–40 Gi |
| 100 | ~100–200 Gi (plan gVisor / dedicated pool) |

Start with N=2–5 on Fly/Docker; do not share one browser across seats.
