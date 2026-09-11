---
project: MSourcing / ARIA
shift: 168
agent: cursor-cloud
updated: 2026-09-11T15:12Z
status: probe-reclaim-orphan-shipped
---

# Handoff — Shift 168

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `8112232` (+ HANDOFF fix commit)
- **Fly:** https://aria-mantu-app.fly.dev — redeploy tip for orphan import + `reclaim_healthy_orphan` (`/api/ready` still 503 / agent frameworks until deploy)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/122 → `integration/sourcing-enrichment-on-main` (draft)
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5` (cookies on computers volume)
- **Gap closed in code:** unhealthy seat `computerId` (e.g. `comp_tony_01`) can reclaim a probed-healthy host orphan on Login — no remint, no invented `sessionHealthy`

## Done this shift

1. `hydrateFromHost` imports unmatched running host bots as `HOST_ORPHAN_SEAT_ID` (`__orphan__`) orphans (`sessionHealthy` null until probe)
2. `reclaimHealthyOrphan` + POST `reclaim_healthy_orphan` — probe stored id, else probe orphans, claim first healthy
3. GET `/api/fleet/computers` lists orphans — still never mints
4. Settings Login: empty id reclaim-before-mint; after unhealthy probe → reclaim → persist `computerId` → ensure/start
5. Tests: import orphan + reclaim path green (`tests/computer-supervisor.mts` 57 passed); `npm run typecheck` green

## Blockers (goal incomplete)

1. LinkedIn remember-me / checkpoint may need one human Take control
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agent frameworks still false / 503 until tip is live
4. Operator prove Deploy→login→Release→floor distinct VMs + healthy still outstanding
5. Seat DB may still point at `comp_tony_01` until Login reclaim runs post-deploy

## Next steps

1. Deploy tip `8112232+` to Fly (protected workflow / image digest)
2. Settings → Login on Tony seat — expect reclaim to UUID durable bot if probe healthy; else Take control once, confirm feed, Release
3. Operator N-seat floor prove (distinct computerIds + sessionHealthy from probe only)
4. Mark PR #122 ready when operator E2E + stable session evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint on GET/list/poll
- **Never remint a blank computerId when a durable/healthy profile already exists**
- Unhealthy stored id → probe orphans → reclaim (not mint)
- Unique `(workspace_id, computer_id)` in DB (0084)
- Host-full → refuse new Browser Computer seats
- Mock send disabled on Fly unless explicitly allowed

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` is often a login-wall twin — reclaim prefers the UUID durable bot after probe
