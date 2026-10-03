---
project: MSourcing / ARIA
shift: 236
agent: cursor-cloud
updated: 2026-10-03T02:15Z
status: hermes-orphan-clear-fly-stale
---

# Handoff — Shift 236

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ `580d0c3`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **N-agent local:** Hermes computerId cleared when fleet shows orphan-only / absent (non-empty poll); durable campaignSeats null clears Hermes twin
- **Fly live:** build `21a42e7…`, `agentFrameworks:false`
- **Tip CI:** pending/churn

## Done this shift

1. `fleetHermesComputerPatches` clears orphan/absent Hermes twins (empty poll fail-soft)
2. Campaign Agents durable merge: null `computerId` clears Hermes
3. fleet-hermes-sync 12/12; floor 78/78; tsc clean

## Blockers

1. No Fly deploy token
2. Operator Take→login→Release after tip deploy

## Next steps

1. Owner Fly redeploy tip + `ARIA_JINA_API_KEY` secret
2. Operator LI login; prove sessionHealthy on Floor + Campaign Agents
3. Confirm tip Quality when CI runners pick up tip

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Hermes must not keep login-wall computerId when fleet only has __orphan__ / absent
- Empty fleet poll does not mass-clear Hermes (ambiguous)
- Floor 2D/3D/rollup share overlay truth

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
