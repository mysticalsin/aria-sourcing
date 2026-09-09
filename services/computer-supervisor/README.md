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

## Local live Chromium fleet (dev / proof)

Aria ships an OpenBot-compatible Playwright supervisor you can run on a workstation
with Google Chrome (no Docker required):

```bash
DISPLAY=:1 OPENBOT_HEADED=1 OPENBOT_MAX_COMPUTERS=10 \
  SUPERVISOR_TOKEN=aria-supervisor-dev COMPUTER_TOKEN=aria-computer-dev \
  OPENBOT_PUBLIC_BASE=http://127.0.0.1:18765 \
  node scripts/openbot-chromium-supervisor.mjs

# Prove 10 agents open LinkedIn + Take control:
node scripts/prove-openbot-chromium-fleet.mjs
```

### Windows portable package

For headed Chromium on a Windows PC (Campaign Agents / Fleet Take control):

```bash
# From repo tip — builds dist/aria-openbot-chromium-windows-portable.zip
node scripts/pack-windows-openbot-chromium.mjs

# Smoke the packaged supervisor on this machine (Linux/macOS/Windows):
node scripts/test-windows-openbot-package.mjs
```

On Windows: unzip → `Install.bat` → edit `.env.cmd` → `Start-OpenBot.bat`.
See `packages/windows-openbot-chromium/README.md`.

Point Aria at it:

```bash
COMPUTER_SUPERVISOR_URL=http://127.0.0.1:18765
COMPUTER_SUPERVISOR_TOKEN=aria-supervisor-dev
COMPUTER_TOKEN=aria-computer-dev
```

Each `ensure` returns:

- `url` — agent-computer base (`/c/:botId`) for navigate/snapshot/click
- `viewUrl` — live operator page (`/view/:botId`) for Fleet **Open sandbox viewport** / Take control

Fleet lists every seat’s computer; operators can Take control any of the N VMs independently.

## Same LLM API key as Aria (for OpenBot agents)

OpenBot LangGraph/Mastra bots must use **Aria’s own provider API key** — not a separate OpenBot model key. Point them at Aria’s OpenAI-compatible proxy and pass the same key Aria spends:

```bash
# On the OpenBot agent / compose service:
OPENAI_BASE_URL=https://<your-aria-host>/api/openbot/v1
# Use the SAME secret Aria has in PROVIDER_ENV (Fly today: KIMI_API_KEY).
OPENAI_API_KEY=<same value as Aria KIMI_API_KEY or OPENAI_API_KEY>
```

Aria side (Fly secrets / env — same keys the rest of Aria uses):

```bash
KIMI_API_KEY=sk-kimi-...             # production Aria default (or OPENAI_API_KEY / etc.)
KIMI_BASE_URL=https://api.kimi.com/coding/v1
OPENBOT_LLM_PROVIDER=kimi            # optional; else first configured PROVIDER_ENV key
OPENBOT_LLM_MODEL=moonshot-v1-8k     # optional override
# Optional alternate service auth (still spends Aria’s PROVIDER_ENV key upstream):
# OPENBOT_LLM_PROXY_TOKEN=...
```

Routes:

- `POST /api/openbot/v1/chat/completions`
- `GET  /api/openbot/v1/models`

**E2E gates:** `tests/openbot-e2e.mts`, `tests/openbot-llm-auth.mts`, and (when `/tmp/aria-e2e/kimi.key` is present) `tests/openbot-live-same-key.mts` — OpenBot Bearer must equal Aria’s key and upstream `Authorization` must be that same key.

## Fly-only A→Z workflow (never Vercel)

Production host: **https://aria-mantu-app.fly.dev** (`fly.app.toml`).  
Chromium supervisor: **https://aria-mantu-computers.fly.dev** (`fly.computers.toml`).  
The public Vercel demo (`aria-sourcing-demo.vercel.app`) is **not** LinkedIn/OpenBot production — do not set `COMPUTER_SUPERVISOR_*` on Vercel.

```
Apify LinkedIn harvest
  → score + minScoreToContact (default 80) + compliance
  → allocateBatch prefers LinkedIn Browser Computer seats
  → 1 seat = 1 OpenBot Chromium computer (stable computer_id)
  → Campaign Agents tab OR Fleet → Start / Observe / Take control → LinkedIn login per seat
  → Automatic send: navigate profile → Message → type → Send
  → OpenBot LLM (optional) via https://aria-mantu-app.fly.dev/api/openbot/v1
     with the SAME Aria PROVIDER_ENV key (Kimi / DeepSeek / Cloudflare Workers AI)
```

### Deploy Chromium supervisor (Fly)

```bash
# One-time app + secrets (tokens never committed):
fly apps create aria-mantu-computers -o personal
openssl rand -hex 32   # SUPERVISOR_TOKEN
openssl rand -hex 32   # COMPUTER_TOKEN
fly secrets set -a aria-mantu-computers SUPERVISOR_TOKEN=... COMPUTER_TOKEN=...
fly deploy --config fly.computers.toml --remote-only

# Point Aria web at the supervisor (URL is public env; tokens are secrets):
fly secrets set -a aria-mantu-app \
  COMPUTER_SUPERVISOR_TOKEN=... \
  COMPUTER_TOKEN=... \
  OPENBOT_COMPUTER_TOKEN=...
# COMPUTER_SUPERVISOR_URL is in fly.app.toml [env] → https://aria-mantu-computers.fly.dev
fly deploy --config fly.app.toml --remote-only
```

Gate: `tests/openbot-fly-workflow-e2e.mts` (10 concurrent ensure + send).
Campaign Agents E2E: `scripts/record-campaign-agents-vm-e2e.mjs`.

## Connect OpenBot to Aria

1. Run CopilotKit OpenBot supervisor + agent-computer (isolated Chromium seats / VMs).
2. In Aria → API keys, save the supervisor bearer token under provider **Computer Supervisor**.
3. In Settings → LinkedIn credentials, paste the supervisor base URL and attach that vault key.
4. Set `COMPUTER_TOKEN` / `OPENBOT_COMPUTER_TOKEN` on Aria to the same secret OpenBot injects into computers (needed to drive `/navigate` etc. after ensure).
5. In LinkedIn connections, click **Create OpenBot Browser Computer seat**.
6. Open Fleet → Computers → Observe / Take control and complete LinkedIn login / 2FA inside the sandbox.
7. Keep Delivery mode on **Automatic** — approved LinkedIn messages ensure the seat’s computer and send via the agent-computer.
8. Point OpenBot agent `OPENAI_BASE_URL` at Aria’s `/api/openbot/v1` and set `OPENAI_API_KEY` to the **same** Aria LLM key (e.g. `OPENAI_API_KEY`).

Env fallback (optional; Settings vault is preferred for the supervisor token):

```bash
COMPUTER_SUPERVISOR_URL=https://computers.your-openbot-host.example
COMPUTER_SUPERVISOR_TOKEN=...          # SUPERVISOR_TOKEN
COMPUTER_TOKEN=...                     # or OPENBOT_COMPUTER_TOKEN — agent-computer secret
COMPUTER_SUPERVISOR_MOCK_SEND=1        # local tests only — never on production
OPENAI_API_KEY=...                     # same key OpenBot presents to /api/openbot/v1
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
