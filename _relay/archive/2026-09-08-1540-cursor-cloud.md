---
project: MSourcing / ARIA
shift: 109
agent: cursor-cloud
updated: 2026-09-08T01:40Z
status: fly-workflow-10vm-e2e-green
---

# Handoff — Shift 109

## Current state

- **Branch:** `cursor/linkedin-auto-vm-fleet-b91d`
- **Production:** Fly `https://aria-mantu-app.fly.dev` only — never Vercel for LinkedIn/OpenBot
- **Workflow E2E:** `openbot-fly-workflow-e2e` 21/21 — 10 agents / 10 VMs concurrent contact
- **Evidence:** `_relay/evidence/2026-09-08-fly-openbot-workflow-e2e.md`
- **Live tip:** health 200; `/api/openbot/v1` still 404 until protected Fly deploy

## Done this shift

1. Confirmed Fly-only production (`fly.app.toml` / deploy-aria-mantu.yml); Vercel is demo-only
2. Per-computer job serialization (1 Chromium never runs two jobs interleaved)
3. Full A→Z gate: source → validate → allocate 10 seats → ensure 10 OpenBot bots → concurrent “open to opportunities” sends
4. README documents Fly A→Z + N-agent scale table

## Blockers (live Chromium on Fly)

1. Protected deploy of this branch to `aria-mantu-app`
2. Separate OpenBot supervisor host with RAM for N Chromiums (~10–20 Gi for N=10)
3. `COMPUTER_SUPERVISOR_*` + `COMPUTER_TOKEN` + valid Aria LLM key on Fly
4. Per-seat LinkedIn login via Fleet Take control

## Next steps

1. Owner: protected Fly deploy of this SHA
2. Stand up OpenBot supervisor for N=10
3. Create 10 seats → login each → Apify source → Automatic send smoke

## Decisions made (don't relitigate)

- Production = Fly only (never Vercel for this product)
- Automatic LinkedIn = OpenBot Browser Computer
- 1 agent seat = 1 OpenBot Chromium computer

## Watch out

- Do not `fly deploy` outside protected workflow
- Never set `COMPUTER_SUPERVISOR_MOCK_SEND=1` on production
