---
id: agent-actions
kind: agent
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - scripts/sourcing-loop-worker.mjs
  - src/lib/langchain/recruiting-graph.ts
---

# Action model

How the autonomous loop acts, stage by stage.

## Stage chain

```
webhook inbound
  → requisition_parse (server LLM + heuristic fallback)
  → campaign_create
  → sourcing_batch (multi-provider + workspace Apify/Tavily)
  → shortlist_build (top 10)
  → draft_generate (Mantu voice + quality pipeline)
  → human approve / send (quality re-checked)
  → calendar book (claim → Graph/Teams → reconcile)
```

## Side-effect rules

- **Ids-only job payloads** for parse (inboundId). Bodies are read from durable storage.
- **Dry-run by default** for email and calendar unless `confirmLive` + live seat.
- **Quality blocked drafts never approve/send** (`outreachQualityGate`).
- **Kill switch** `ARIA_LOOP_KILL_SWITCH` can idle the loop without deleting wiki notes.

## Modification guide

| Change | Edit |
| --- | --- |
| New loop stage | `scripts/sourcing-loop-worker.mjs` HANDLERS + transitions |
| Graph nodes | `src/lib/langchain/recruiting-graph.ts` |
| Quality critics | `src/lib/outreach-quality-pipeline.ts` |
| Document the change | Add/compact a lesson under `lessons/` and update `INDEX.md` |
