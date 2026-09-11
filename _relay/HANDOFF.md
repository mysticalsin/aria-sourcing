---
project: MSourcing / ARIA
shift: 173
agent: cursor-cloud
updated: 2026-09-11T17:45Z
status: reclaim-before-mint-all-boot-paths
---

# Handoff — Shift 173

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (commit after this push)
- **Fly:** https://aria-mantu-app.fly.dev — still on older build `8ea3370…` (`agentFrameworks:false`); tip **not live**
- **PR:** #126 → `integration/sourcing-enrichment-on-main` (update after push)
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5`

## Done this shift

1. **`resolveDurableComputerId`** in `src/lib/boot-browser-computer.ts` — always probes `reclaim_healthy_orphan` before minting; never invents `sessionHealthy=true`
2. **Fleet Deploy, Fleet Add agent, Campaign Attach, Settings Login** all use the shared helper (store pre-minted blank ids no longer skip reclaim)
3. Floor subtitle null-safety; `typecheck:tests` green (demo-candidate-persistence + openbot-llm-auth casts)
4. Tests: boot-browser-computer 8, floor 44, computer-supervisor 62; `npm run typecheck` + `typecheck:tests` green

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
- **Login must not trust Hermes-only computerId over empty API/DB seat**
- Floor/Settings must sync Hermes computerId from fleet GET
- **All boot paths (Deploy/Add/Attach/Login) reclaim-before-mint via shared helper**
- Unique `(workspace_id, computer_id)` in DB (0084)

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` often login-wall twin — reclaim prefers UUID durable after probe
- Production deploy is owner/protected — do not bypass release guards
