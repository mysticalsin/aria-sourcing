---
project: MSourcing / ARIA
shift: 169
agent: cursor-cloud
updated: 2026-09-11T15:50Z
status: floor-hint-isolation-shipped
---

# Handoff — Shift 169

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit after this push)
- **Fly:** https://aria-mantu-app.fly.dev — still on older build `8ea3370…` (`/api/ready` ok:false agentFrameworks); tip with orphan reclaim + floor isolation **not live yet**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/122 → `integration/sourcing-enrichment-on-main` (draft)
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5`

## Done this shift

1. Floor dual-key hint bleed fixed: `resolveComputerHint` + `seatId` on hints — poisoned/stale `computerId` cannot show another seat’s VM (status, suffix, activity, pulse, drawer)
2. Prior shift reclaim path still on tip: `hydrateFromHost` orphans + `reclaim_healthy_orphan` + Login reclaim-before-mint
3. Tests: `tests/floor.mts` 44 passed (bleed regression); `tests/computer-supervisor.mts` 57 passed; `npm run typecheck` green

## Blockers (goal incomplete)

1. Tip not deployed to Fly yet — operator Login reclaim / floor prove blocked on live digests
2. LinkedIn remember-me / checkpoint may need one human Take control
3. OPENBOT_MAX_COMPUTERS=5
4. `/api/ready` agentFrameworks:false
5. Operator Deploy→login→Release→floor distinct VMs + probe-backed healthy still outstanding

## Next steps

1. Deploy tip to Fly (protected workflow / image digest) — confirm `/api/ready` build SHA matches tip
2. Settings → Login on Tony seat — reclaim to UUID durable bot if probe healthy; else Take control once, feed, Release
3. Operator N-seat floor prove: distinct computerIds, no cross-desk VM bleed, sessionHealthy from probe only
4. Mark PR #122 ready when operator E2E + stable session evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint on GET/list/poll
- Never remint blank computerId when durable/healthy profile exists
- Unhealthy stored id → probe orphans → reclaim (not mint)
- Floor computerId fallback must not cross seat ownership (`hint.seatId` match)
- Unique `(workspace_id, computer_id)` in DB (0084)
- Host-full → refuse new Browser Computer seats

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` often login-wall twin — reclaim prefers UUID durable bot after probe
