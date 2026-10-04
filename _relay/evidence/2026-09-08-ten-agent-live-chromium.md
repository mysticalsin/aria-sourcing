# 10-agent live Chromium Take control (2026-09-08)

## Runtime

- Supervisor: `scripts/openbot-chromium-supervisor.mjs` (OpenBot-compatible)
- Host: `http://127.0.0.1:18765` (headed Google Chrome via Playwright)
- Aria: `http://localhost:3010` with `COMPUTER_SUPERVISOR_URL/TOKEN` + `COMPUTER_TOKEN`

## Proof

| Check | Result |
| --- | --- |
| Ensure 10 computers | ok (`agent_01`…`agent_10`) |
| Navigate each to LinkedIn | 10/10 — title `LinkedIn: Log In or Sign Up` |
| Screenshots per agent | `/tmp/aria-e2e/chromium-fleet/agent_XX-linkedin.jpg` |
| Aria Fleet lists 10 ready computers with `viewUrl` | ok |
| Take control `agent_03` → `control=human` | ok |
| Operator navigate LinkedIn ↔ example.com while human | ok |
| Second agent `agent_05` live LinkedIn view | ok |

## How to re-run

```bash
DISPLAY=:1 OPENBOT_HEADED=1 OPENBOT_MAX_COMPUTERS=10 \
  SUPERVISOR_TOKEN=aria-supervisor-dev COMPUTER_TOKEN=aria-computer-dev \
  node scripts/openbot-chromium-supervisor.mjs

node scripts/prove-openbot-chromium-fleet.mjs
```

Wire Aria `.env.local`:

```
COMPUTER_SUPERVISOR_URL=http://127.0.0.1:18765
COMPUTER_SUPERVISOR_TOKEN=aria-supervisor-dev
COMPUTER_TOKEN=aria-computer-dev
```

## Artifacts

- Video: `/opt/cursor/artifacts/aria-10-agent-live-chromium-take-control.mp4`
- Receipt: `/opt/cursor/artifacts/chromium-fleet-receipt.json`
