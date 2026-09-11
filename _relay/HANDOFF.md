---
project: MSourcing / ARIA
shift: 157
agent: cursor-cloud
updated: 2026-09-11T07:41Z
status: floor-vm-drawer-on-fly
---

# Handoff — Shift 157

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `f0ee99a` (`f0ee99a50d5c952ba5961aa3cd433976a17fd56e`)
- **Fly:** https://aria-mantu-app.fly.dev build matches tip
- **PR:** open https://github.com/mysticalsin/aria-sourcing/pull/new/cursor/openbot-desktop-vm-b91d → `integration/sourcing-enrichment-on-main`
- **Computers:** max 5 (8gb performance-4x — do not raise without capacity plan)
- **Policy:** every improvement on Fly

## Done this shift

1. Floor agent drawer shows Browser Computer id + live LinkedIn session badge/meta (uses `computerHints`, not theatrical activity alone)
2. Prior: seat VM ownership isolation, unique computer_id migration 0084, refuse refuse fake ready, seatId allocate→send, go-live all healthy, hydrate, floor 2d/3d honesty, attach awaits PATCH

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. /api/ready agentFrameworks:false
4. Operator prove Deploy→login→Release→floor probe
5. Apply migration 0084 on prod if not auto (ready still reports 0082)
6. PR create ACL

## Next steps

1. Human opens PR
2. Operator prove ≤5 seats; confirm drawer shows distinct VM ids
3. Apply 0084; plan host raise/shard for 16 concurrent VMs
