---
id: fb-contract
kind: feedback
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/app/api/sourcing-learning/feedback/route.ts
  - src/lib/agent-wiki/feedback.ts
---

# Feedback contract

## Inputs (allowed)

| Field | Meaning |
| --- | --- |
| `receiptId` | Server-issued opaque sourcing receipt UUID |
| `verdict` | `useful` \| `dead_end` \| `corrected` |

No candidate PII in the feedback body. No client-supplied query text as truth.

## Outputs

1. Durable DB update via learning authority RPCs
2. Best-effort **proposed** wiki lesson under `var/agent-wiki/proposed/`
   (`status: proposed`) — never auto-canonical into `docs/agent-wiki/lessons/`
3. Disable staging with `ARIA_AGENT_WIKI_AUTO_PROPOSE=0`

## Self-improvement loop

```
receipt → recruiter verdict → DB lesson evidence
                           → tryStageWikiLessonFromFeedback() → var/agent-wiki/proposed/
                           → human review / compact → docs/agent-wiki/lessons/
                           → INDEX.md update
                           → later sourcing prioritization (DB)
```
