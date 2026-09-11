---
project: MSourcing / ARIA
shift: 153
agent: cursor-cloud
updated: 2026-09-11T06:12Z
status: seat-vm-binding-on-fly
---

# Handoff — Shift 153

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `047fd50`
- **PR:** creating/updating (prior #110 closed)
- **Fly app:** https://aria-mantu-app.fly.dev (deploy tip next)
- **Fly computers:** max 5 — https://aria-mantu-computers.fly.dev
- **Policy:** every improvement pushed to Fly

## Done this shift

1. **Allocate → send seat binding:** `OutreachMessage.seatId` stamped at allocate; LinkedIn Browser Computer drafts use LinkedIn channel; send prefers `msg.seatId` via `pickLiveLinkedInSendSeat(..., preferredSeatId)`.
2. **Go-live honesty:** only explicitly assigned Browser seats count; every attached seat must be live+active and `sessionHealthy === true` (no `computers[0]` fallback).
3. **Hydrate truth:** successful host list with missing bot → `stopped` + clear `sessionHealthy`/URLs (no stale ready after cold start).
4. **Floor rollup:** with computer hints loaded, Browser seats count as working only when `ready && sessionHealthy === true`; pulse cannot force working without that.
5. **Deploy refuse:** when host capacity known and slots=0, Deploy stops (no seat theater without VM).
6. **Settings:** Max agents hint/clamp from `/api/fleet/computers` `hostCapacity.max`.
7. Tests: floor, campaign-go-live, computer-supervisor green.

## Blockers

1. Human Take control + LinkedIn 2FA per seat
2. `OPENBOT_MAX_COMPUTERS=5` (need raise/shard for 16 concurrent)
3. `/api/ready` agentFrameworks false

## Next steps

1. Fly deploy tip `047fd50`; verify `/api/health` build SHA
2. Operator prove: Deploy ≤5 → Take control → login → Release → floor healthy/unhealthy
3. Optional: await assign persistence before campaign attach boot toast

## Decisions (don't relitigate)

- Every improvement pushed to Fly before shift end
- Never invent `sessionHealthy=true` without `/session-probe`
- Ensure ≠ boot; Deploy/Take control must hit OpenBot
