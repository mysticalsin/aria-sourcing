---
project: MSourcing / ARIA
shift: 160
agent: cursor-cloud
updated: 2026-09-11T09:25Z
status: n-seat-vm-isolation-on-fly
---

# Handoff — Shift 160

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `949fb74` (`949fb7447a3afa5910d029d264172e9c6e455e0b`)
- **Fly:** https://aria-mantu-app.fly.dev `/api/ready` build matches tip
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/113 → `integration/sourcing-enrichment-on-main` (draft)
- **Computers:** max 5 · https://aria-mantu-computers.fly.dev
- **Policy:** every improvement on Fly

## Done this shift

1. Fleet GET no longer stamps `campaignId` onto every seat (was collapsing N-agent audits onto last-polled campaign)
2. Campaign agents panel: never ensure with `seat.id` as computerId; match live VMs by `seatId`
3. Fleet Deploy / add-agent / campaign attach: mint `comp_${uuid}` — never invent from `seat.id`
4. Fleet refresh skips ensure when computerId missing
5. Floor hints carry `computerId`; 3D subtitle + drawer prefer API-bound id
6. Settings / LinkedIn connect copy: "seat created" not "ready" until session probe
7. Tests: computer-supervisor 38, floor 31, campaign-go-live 11; typecheck green
8. Deployed Fly; `/api/ready` build matches tip

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator prove Deploy→login→Release→floor shows distinct VM ids + session healthy for N seats
5. Apply migration 0084 on prod (ready still reports 0082) — needs bootstrap secrets

## Next steps

1. Operator prove ≤5 seats with distinct `comp_*` ids on floor/drawer/campaign panel after login/Release
2. Apply 0084 via bootstrap migrations phase when secrets available; plan host raise/shard for 16 VMs
3. Mark PR ready when operator E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- `ensure` ≠ boot; go-live requires all attached seats `sessionHealthy === true`
- Send path fail-closed on unverified session

## Watch out

- Mock send still allows send without probe — production must not set it
- `fly secrets set ARIA_RELEASE_SHA` rolls machines; verify `/api/ready` after
- Bootstrap app has no image until first bootstrap deploy — 0084 apply needs owner secrets
