---
project: MSourcing / ARIA
shift: 158
agent: cursor-cloud
updated: 2026-09-11T07:56Z
status: floor-3d-vm-ids-on-fly
---

# Handoff — Shift 158

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `6a690a7` (`6a690a73031e6c9c12ce2dd7020d1e268cbadd89`)
- **Fly:** https://aria-mantu-app.fly.dev build matches tip
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/new/cursor/openbot-desktop-vm-b91d → `integration/sourcing-enrichment-on-main`
- **Computers:** max 5
- **Policy:** every improvement on Fly

## Done this shift

1. 3D floor subtitles append `…last8` of `computerId` for LinkedIn Browser Computer seats (session state + VM id visible without drawer)
2. Floor tests 31 green
3. Prior: drawer VM/session meta, ownership isolation, unique computer_id 0084, refuse refuse fake ready, seatId allocate→send, go-live all healthy, hydrate, 2d/3d honesty, attach awaits PATCH

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. /api/ready agentFrameworks:false (Deerflow/Flowise contract — not campaign VM path)
4. Operator prove Deploy→login→Release→floor shows distinct VM ids
5. Apply migration 0084 on prod (ready still reports 0082)
6. PR create ACL

## Next steps

1. Human opens PR
2. Operator prove ≤5 seats; confirm 3D labels + drawer show distinct VM ids
3. Apply 0084; plan host raise/shard for 16 concurrent VMs
