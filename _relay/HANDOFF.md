---
project: MSourcing / ARIA
shift: 155
agent: cursor-cloud
updated: 2026-09-11T06:25Z
status: seat-vm-binding-on-fly
---

# Handoff — Shift 155

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `79bab51`
- **Fly:** https://aria-mantu-app.fly.dev build `79bab5164f208fd762ff1ff6d045f77ce3325c6c` (match tip)
- **PR:** agent token cannot create/reopen (closed #110); open https://github.com/mysticalsin/aria-sourcing/pull/new/cursor/openbot-desktop-vm-b91d → base `integration/sourcing-enrichment-on-main`
- **Computers:** max 5
- **Policy:** every improvement on Fly

## Done this shift

1. Allocate→send seatId binding + LinkedIn channel for Browser Computer
2. Go-live: explicit attach; all seats sessionHealthy (no computers[0])
3. Hydrate: absent host bot → stopped
4. Floor rollup/3D/2D: ready+sessionHealthy only
5. Deploy refuse at host full; Settings host max clamp
6. Campaign attach awaits seat PATCH before VM boot
7. Tests: floor / campaign-go-live / computer-supervisor green

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. /api/ready agentFrameworks:false
4. Operator prove Deploy→login→Release→floor probe
5. PR create ACL for agent token

## Next steps

1. Human opens PR from branch URL
2. Operator prove ≤5 seats end-to-end
3. Raise/shard host for 16 concurrent VMs
