---
project: MSourcing / ARIA
shift: 174
agent: cursor-cloud
updated: 2026-09-11T18:23Z
status: create-null-computerId-seat-ownership
---

# Handoff — Shift 174

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit after this push)
- **Fly:** https://aria-mantu-app.fly.dev — still on older build `8ea3370…` (`agentFrameworks:false`); tip **not live**
- **PR:** recreate after push (prior #126 closed) → `integration/sourcing-enrichment-on-main`
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5`

## Done this shift

1. **Create-null:** store `addSeat`, `POST /api/fleet/seats`, LinkedIn `ensure_connect`, Settings demo connect leave `computerId` null until Deploy/Login reclaim-or-mint
2. **Seat ownership:** go-live `computerForSeat`, campaign agents filter/lookup, fleet naming — seatId first; computerId fallback only if unbound/same seat
3. **Settings:** fleet `sessionHealthy: null` no longer falls through to stale local green
4. **fleet-seats:** trusts DB `computer_id` null over Hermes
5. Tests: campaign-go-live 13 (incl. bleed + email-seat), fleet-seats-assign 5; typecheck + typecheck:tests green

## Blockers (goal incomplete)

1. Tip not deployed to Fly
2. LinkedIn checkpoint may need one human Take control
3. OPENBOT_MAX_COMPUTERS=5
4. `/api/ready` agentFrameworks:false
5. Operator Deploy→login→Release→floor prove still outstanding

## Next steps

1. Deploy tip to Fly — confirm `/api/ready` build SHA matches tip
2. Settings → Login on Tony — expect reclaim + Hermes/DB computerId → UUID durable
3. Leave Floor/Fleet open — Hermes must stay synced, no twin thrash
4. Operator N-seat floor prove (distinct computerIds, no cross-desk bleed); mark PR ready when E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint on GET/list/poll
- Never remint blank computerId when durable/healthy profile exists
- Unhealthy stored id → probe orphans → reclaim (not mint)
- Reclaim must persist `agent_seats.computer_id` in the same request
- Poll paths GET+sync only (no ensure with Hermes computerId)
- ensure must not reclaim orphan onto seat with existing durable binding
- Login must not trust Hermes-only computerId over empty API/DB seat
- Floor/Settings must sync Hermes computerId from fleet GET
- All boot paths reclaim-before-mint via shared helper
- **Seat create must not pre-mint blank computerId**
- **computerId fallback must not cross seat ownership**
- Unique `(workspace_id, computer_id)` in DB (0084)

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` often login-wall twin — reclaim prefers UUID durable after probe
- Production deploy is owner/protected — do not bypass release guards
- Prior PRs on this branch often get closed — recreate after push
