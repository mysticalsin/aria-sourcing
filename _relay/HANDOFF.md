---
project: MSourcing / ARIA
shift: 154
agent: cursor-cloud
updated: 2026-09-11T06:19Z
status: seat-vm-binding-on-fly
---

# Handoff — Shift 154

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `44b06a2` (`44b06a2a96b634a329a42b8a0f9221a725c6ae7d`)
- **PR:** blocked for this token (`gh pr create` → Resource not accessible); open via https://github.com/mysticalsin/aria-sourcing/pull/new/cursor/openbot-desktop-vm-b91d (base `integration/sourcing-enrichment-on-main`). Prior #110 closed.
- **Fly app:** https://aria-mantu-app.fly.dev — `/api/health` ok; `/api/ready` still `agentFrameworks:false` (known)
- **Fly computers:** max 5
- **Policy:** every improvement pushed to Fly

## Done this shift

1. Allocate stamps `seatId`; LinkedIn Browser Computer → LinkedIn drafts; send prefers `msg.seatId`
2. Go-live: explicit attach only; all attached seats must be live + `sessionHealthy`
3. Hydrate: missing host bot → stopped (clear stale ready/sessionHealthy)
4. Floor rollup + 3D pulse + **2D desks** require ready+sessionHealthy (no theatrical busy)
5. Deploy refuses when host slots known and zero; Settings clamps max agents to host max
6. Tests: floor 29, campaign-go-live 11, computer-supervisor 30
7. Fly deploy tip `44b06a2`

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5`
3. `/api/ready` agentFrameworks false
4. PR create permission denied for agent token — human/open URL above

## Next steps

1. Open/restore PR from branch URL above
2. Operator prove: Deploy ≤5 → Take control → login → Release → floor probe state
3. Raise/shard host if 16 concurrent VMs required
4. Optional: await server persist before attach boot toast; unique computerId constraint

## Decisions (don't relitigate)

- Every improvement to Fly before shift end
- Never invent sessionHealthy without /session-probe
- Ensure ≠ boot
