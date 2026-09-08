# Fly A→Z OpenBot workflow (2026-09-08)

**Production = Fly only** — https://aria-mantu-app.fly.dev  
**Not Vercel** — `aria-sourcing-demo.vercel.app` is demo-only.

## Live Fly tip (probed)

```
GET https://aria-mantu-app.fly.dev/api/health → 200 healthy
App: aria-mantu-app (cdg), web machine passing checks
```

`/api/openbot/v1` still **404** on tip build `911634d` until this branch deploys via protected `deploy-aria-mantu.yml`.

## Workflow gate: `tests/openbot-fly-workflow-e2e.mts` — 21/20+ passed

Receipt from run:

```
FLY WORKFLOW RECEIPT
  host=https://aria-mantu-app.fly.dev
  agents=10 computers=10 sends_ok=10
  openbot_bots_ensured=10
```

Steps proven:

1. Production origin resolves to Fly (not `vercel.app`)
2. Source LinkedIn-shaped profiles
3. Validate score floor (≥80) + compliance
4. Allocate to **10** LinkedIn Browser Computer seats
5. Ensure **10** distinct OpenBot computers (`1 seat = 1 VM`)
6. Concurrent `linkedin_send` — message asks if open to opportunities
7. Same-seat job serialization (no interleaved Chromium actions)

Chromium OpenBot was HTTP-mocked in the agent VM (no Docker). Aria orchestration matches Fly production code paths.

## Operator A→Z on Fly (after deploy + OpenBot host)

1. Deploy this branch through protected Fly workflow (never Vercel)
2. Set Fly/Settings: `COMPUTER_SUPERVISOR_URL` + Computer Supervisor vault token + `COMPUTER_TOKEN`
3. Set Aria LLM key (DeepSeek/Kimi) used by `/api/openbot/v1`
4. Create up to N OpenBot Browser Computer seats (each gets `computer_id`)
5. Fleet → Start / Open view / Take control → LinkedIn login **per seat**
6. Source candidates (Apify LinkedIn) → score → approve → Automatic send
7. Each seat’s VM contacts its allocated candidate independently
