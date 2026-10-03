---
project: MSourcing / ARIA
shift: 117
agent: cursor-cloud
updated: 2026-09-09T07:10Z
status: fly-campaign-agents-computers-live
---

# Handoff — Shift 117

## Current state

- **Branch:** `cursor/campaign-agent-vm-control-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/76
- **Fly web:** https://aria-mantu-app.fly.dev (deployed this shift with Campaign Agents)
- **Fly Chromium:** https://aria-mantu-computers.fly.dev (`fly.computers.toml`, health OK, max=5)
- **Wiring:** `COMPUTER_SUPERVISOR_URL=https://aria-mantu-computers.fly.dev` on app; tokens via Fly secrets
- **Evidence:** `_relay/evidence/2026-09-09-fly-campaign-agents-live.md`
- **Vercel:** not used for this path — do not touch

## Done this shift

1. Created/deployed `aria-mantu-computers` OpenBot supervisor on Fly
2. Set Aria app secrets + `fly.app.toml` env to Fly supervisor URL
3. Redeployed `aria-mantu-app` with Agents tab + CSP frame-src for computers host
4. Proved ensure + LinkedIn navigate + view=200 on Fly

## Blockers

1. None for Fly live supervisor health. Tenant login still required for full UI Take control on production (demo login off).

## Next steps

1. Merge PR #76 when ready
2. Optional: persistent volume for `/data/profiles` on computers app
3. Scale `OPENBOT_MAX_COMPUTERS` / VM size if >5 concurrent seats

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = **Fly only** (never Vercel)
- 1 seat = 1 Chromium; Take-controllable from Campaign Agents + Fleet
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod
- Brain = LLM wiki on disk; wiki ≠ contact lease

## Watch out

- Do not commit supervisor/computer tokens
- Computers machine uses `--restart always`; keep `auto_stop_machines=off`
- Prefer `fly deploy --config fly.computers.toml` / `fly.app.toml` — not Vercel
