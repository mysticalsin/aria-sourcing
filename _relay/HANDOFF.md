---
project: MSourcing / ARIA
shift: 156
agent: cursor-cloud
updated: 2026-09-11T07:04Z
status: seat-vm-isolation-on-fly
---

# Handoff — Shift 156

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `b03fc63` (`b03fc630d08ca2d0ff25e2c7da66b0f6e3a11cac`)
- **Fly:** https://aria-mantu-app.fly.dev build matches tip
- **PR:** agent cannot create (closed #110); open https://github.com/mysticalsin/aria-sourcing/pull/new/cursor/openbot-desktop-vm-b91d → base `integration/sourcing-enrichment-on-main`
- **Computers:** max 5
- **Policy:** every improvement on Fly

## Done this shift

1. `ensureComputer` throws on cross-seat/workspace `computerId` (no shared Chromium)
2. Fleet list remints + persists on ownership mismatch
3. `start` without OpenBot refuses `ready` unless `COMPUTER_SUPERVISOR_MOCK_SEND=1`
4. Migration `0084_agent_seats_computer_id_unique.sql` — unique `(workspace_id, computer_id)`
5. Tests: computer-supervisor 33 pass
6. Prior: seatId allocate→send, go-live all healthy, hydrate absent→stopped, floor 2d/3d honesty, deploy host-full refuse, attach awaits PATCH

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. /api/ready agentFrameworks:false
4. Operator prove Deploy→login→Release→floor probe
5. PR create ACL

## Next steps

1. Human opens PR from branch URL
2. Apply migration 0084 on prod if not auto
3. Operator prove ≤5 seats E2E
4. Raise/shard host for 16 concurrent VMs
