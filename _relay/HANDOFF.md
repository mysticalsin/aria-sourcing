---
project: MSourcing / ARIA
shift: 306
agent: cursor-cloud
updated: 2026-10-03T15:15Z
status: tip-n-agent-closed-fly-blocks-goal
---

# Handoff — Shift 306

## Current state

- **Deploy-land:** `cursor/fly-deploy-land-n-agent-b91d` — PR https://github.com/mysticalsin/aria-sourcing/pull/150 → `deploy/fly-github-actions`
- **#150:** `MERGEABLE`, squash auto-merge on, blocked on **`REVIEW_REQUIRED`**
- **Tip residual:** viewport/fleet Take now pass campaignId when attached; Attention/Settings ingest durable bindings
- **Fly:** still `21a42e7…` / `0084` / `agentFrameworks:false`
- **Dispatch runbook:** `_relay/evidence/2026-10-03-fly-owner-dispatch-runbook.md`
- **Goal:** **open** until Fly tip SHA + LI desks healthy

## Done this shift

1. Viewport + Fleet page: pass campaignId on Take/Start when desk attached / scoped
2. Attention panel + Settings: ingestDurableBrowserBindings on fleet poll
3. tsc clean

## Blockers

1. Owner: approve #150 → auto-merge → dispatch + LI healthy

## Next steps

1. Owner approve #150 + dispatch + LI healthy — **do not UpdateGoal complete**
2. After deploy: prove `/api/ready` build==deploy tip && agentFrameworks && migration≥0087

## Decisions (don't relitigate)

- Tip N-agent class closed; remaining gap is production deploy
- Never invent sessionHealthy=true
- Ignore Vercel-only CI when Quality/Release pass
- Protected deploy: `deploy/fly-github-actions`

## Watch out

- No agent review/approve / FLY_API_TOKEN
- Docs pushes cancel CI; re-verify green before owner relies on tip SHA
