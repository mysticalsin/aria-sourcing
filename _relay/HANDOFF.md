---
project: MSourcing / ARIA
shift: 236
agent: cursor-cloud
updated: 2026-10-03T01:52Z
status: hermes-reclaim-drift-gap-open-fly-stale
---

# Handoff — Shift 236

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ tip (post-235 warming)
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **N-agent local:** Floor 2D/3D/rollup share `agentActivityWithComputers`; busy/starting → warming
- **Next tip gap (open):** Hermes `computerId` reclaim drift — `fleet-hermes-sync.ts:48` keeps orphan/absent ids
- **Fly live:** build `21a42e7…`, `agentFrameworks:false` (no deploy this shift)

## Done this shift

1. Audited tip-owned FE↔BE honesty gaps (HUD/packetFX, Hermes reclaim, jobs durability)
2. Logged open finding: Hermes orphan/null durable does not clear `seat.computerId` → Deploy re-binds login-wall twin
3. Skipped already-done items (supervisor TTL, campaignSeats, floor honesty, booking trail, Jina)

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy

## Next steps

1. Fix `fleetHermesComputerPatches` to clear when fleet owner missing/`__orphan__`
2. Campaign Agents durable merge: null durable → clear Hermes `computerId`
3. Flip `tests/fleet-hermes-sync.mts` orphan-keep case; add Deploy/reclaim integration case
4. Owner Fly redeploy tip + `ARIA_JINA_API_KEY`; prove sessionHealthy (never invent)

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Bound computerId ≠ live/healthy
- Floor rollup + 2D + 3D must share overlay truth when computers map present
- busy/starting → warming (not working, not silent idle mismatch with rollup)
- Hermes must not retain orphan/foreign computerId after fleet poll

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
- Pulse→working on ready+healthy is FX-only; rollup stays non-pulse (secondary, not this gap)
