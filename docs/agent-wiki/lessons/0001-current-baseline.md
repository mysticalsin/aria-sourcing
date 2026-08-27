---
id: lesson-0001
kind: lesson
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - docs/operations/SOURCING_LEARNING.md
  - docs/agent-wiki/agent/action-model.md
roleFingerprint: null
identityFingerprint: null
---

# Baseline operating lessons

## Rules

1. Prefer Graph webhook intake; emergency sync is break-glass only.
2. Never treat display name as identity — require LinkedIn/email/GitHub/external id.
3. Quality-blocked outreach cannot be approved or sent.
4. Calendar success requires durable reconciliation after Graph/Teams create.
5. Adaptive sourcing lessons promote only after independent evidence + admin review.
6. Tracked wiki notes stay PII-free; compact instead of appending forever.
7. Feedback stages proposed wiki lessons under `var/agent-wiki/proposed/`; humans promote into `docs/agent-wiki/lessons/`.
8. Graph Inbox subscriptions must be renewed (loop worker cron) — they expire in ~2 days.
9. After INTERESTED replies, enqueue `calendar_book` to propose Teams/Outlook interview (human confirmLive).

## Counterexamples

- Do not skip quality gates for "urgent" campaigns.
- Do not merge two candidates because their names match.
- Do not mark a calendar booking created if reconcile failed.
- Do not auto-mark proposed wiki lessons as canonical.
- Do not treat inbound mailbox route as proof of an active Graph subscription.
- Do not ship autonomous drafts when the live LLM was unavailable (fail closed / retry).