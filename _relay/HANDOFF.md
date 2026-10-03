---
project: MSourcing / ARIA
shift: 230
agent: cursor-cloud
updated: 2026-10-03T01:25Z
status: n-agent-campaign-seats-fly-stale
---

# Handoff — Shift 230

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d` @ tip
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **N-agent:** singleton + durable probe restore + Fleet GET `campaignSeats` from `assigned_campaign_ids` (Campaign Agents syncs Hermes from DB)
- **Agent Reach:** slices 1–3.5 shipped; slice 4 Fly+LI blocked
- **Fly live:** build `21a42e7…`, `agentFrameworks:false`, computers 401; no deploy token

## Done this shift

1. Fleet GET selects `assigned_campaign_ids`; returns `campaignSeats` when `?campaignId=` set
2. Campaign Agents prefers durable campaign bindings over Hermes-only attach
3. computer-supervisor contract tests 108/108; tsc clean

## Blockers

1. No Fly deploy token — cannot complete N-agent production goal
2. Operator Take→login→Release after tip deploy

## Next steps

1. Owner Fly redeploy tip until `/api/ready` build == tip SHA + `agentFrameworks:true`
2. Operator LI login on N desks; prove sessionHealthy within TTL on Floor + Campaign Agents
3. Confirm tip Quality on latest tip

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Durable DB campaign↔seat bindings are authority for Campaign Agents scope
- Process Maps are cache; OpenBot host + durable probe receipts (TTL) are multi-instance truth

## Watch out

- Do not mark N-agent goal complete until Fly tip SHA + LI healthy verified
