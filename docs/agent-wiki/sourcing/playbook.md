---
id: source-playbook
kind: sourcing
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/sourcing/orchestrator.ts
  - docs/operations/SOURCING_LEARNING.md
---

# Sourcing playbook

## Goal

Find real candidates for a ready campaign job analysis, score them, dedupe, and
surface a top-10 shortlist — with provenance on every record.

## Order of work

1. Confirm campaign readiness (title, skills, location, injection-safe brief).
2. Claim sourcing run (`begin_sourcing_run`) before provider spend.
3. Fan out providers (GitHub, LinkedIn profiles when Apify key present, web/Tavily).
4. Merge + dedupe by durable identity keys (not display name alone).
5. Score with campaign weights; keep receipts for learning feedback.
6. Shortlist top 10; enqueue drafts only when entitled.

## Self-improvement

Useful / dead_end / corrected feedback on query receipts feeds DB lessons and
proposes wiki lesson patches via `src/lib/agent-wiki/feedback.ts`. Promoted
lessons influence later matching roles — never invent queries from vibes.
