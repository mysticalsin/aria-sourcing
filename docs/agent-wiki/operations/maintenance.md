---
id: ops-maintain
kind: ops
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/agent-wiki/index.ts
---

# Maintenance

## After any behavior change

1. Update the relevant note under `agent/` or `sourcing/`.
2. Add or compact a lesson under `lessons/`.
3. Refresh `INDEX.md` one-liner.
4. Run `npx tsc --noEmit && npm test` (or the suite covering `tests/agent-wiki.mts`).

## Compaction cadence

When `lessons/` exceeds ~25 canonical notes, compact clusters that share the
same `roleFingerprint` using `compactNotes`.

## Audit

An auditor should be able to answer from this tree alone:

- How does the agent source?
- How are similar-named candidates kept distinct?
- How does feedback improve future runs?
- Where is PII forbidden?
