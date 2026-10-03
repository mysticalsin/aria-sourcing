# E2E tangibility audit — 2026-09-11

Ponytail lens: wire real seat↔VM↔floor paths; no new frameworks.

## What works now

1. **Deploy N Browser Computer seats** (`deployAgents`) creates real `LinkedIn Browser Computer` seats with `computerId` in demo + live (persisted via `/api/fleet/seats`).
2. **Fleet Computers** `ensure` boots/binds one Chromium VM per seat (`computerId`).
3. **Floor activity** prefers `assignedCampaignIds` (Campaign Agents), not a global hash lottery.
4. **3D pulses** prefer `event.seatId` when present (`pickResponderIndex`).
5. **Allocate** prefers seats assigned to the campaign; batch + single allocate emit `seatId` when known; successful live send emits `seatId`.
6. **3D floor** polls `/api/fleet/computers` and overlays VM status (`help_requested` → Needs Take control, `busy`/`starting` → working, unhealthy session → error).

## Hard gaps (honest)

| Gap | Why it matters | Fix path |
|---|---|---|
| **Host VM cap ≠ fleet maxAgents** | Fly `OPENBOT_MAX_COMPUTERS=5` while UI allows hundreds of seats. Deploying 16 seats does **not** guarantee 16 live VMs. | Raise Fly cap / multi-host OR show ensure failures in Fleet toast after deploy. Default deploy is now 5. |
| **Login is still human** | LinkedIn 2FA/captcha cannot be automated. | Operator Take control → login → Release per seat. |
| **3D render cap** | `MAX_3D_AGENTS` (high≈64 / low≈22) drops extras from the canvas. | 2D floor + Fleet roster remain the full-fleet surfaces. |
| **Source emits lack seatId** | Sourcing is campaign-scoped, not always seat-scoped. | Emit seatId when a Browser Computer seat actually performed the search. |
| **Approve emits "send" without seat** | Hybrid model: approve ≠ delivery. | Live `sendApprovedOutreach` now emits with `seatId`; approve pulse stays theatrical. |
| **Swarm / multi-tab orchestration UX** | Some swarm APIs exist but aren't the primary Fleet↔Floor loop. | Keep Fleet Computers + Floor hints as the tangible path. |

## Prove 16 agents end-to-end

1. Raise `OPENBOT_MAX_COMPUTERS` ≥ 16 on the computers host (or split hosts).
2. Fleet → Deploy 16 → wait for Computers panel to show 16 rows.
3. Assign seats to a campaign (`assignedCampaignIds`).
4. Take control each seat → LinkedIn login → Release.
5. Open `/floor` 3D — 16 agents; help_requested seats show error state.
6. Allocate + send — pulse targets the emitting `seatId`.

## Decisions (don't relitigate)

- N seats = N Chromium profiles / VMs (not one shared profile).
- Recruiter via Take control (no auto InMail).
- Floor activity from real assignments + live computer status, not theatre-only.
