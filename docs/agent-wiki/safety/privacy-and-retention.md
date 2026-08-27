---
id: safety-privacy
kind: safety
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/agent-wiki/notes.ts
---

# Privacy and retention

## Tracked (`docs/agent-wiki/`)

Allowed: aggregate lessons, query patterns, provider names, hashed fingerprints,
process docs, action models.

Forbidden: candidate legal names, emails, phones, raw LinkedIn/GitHub URLs,
message bodies, salary figures tied to a person.

## Untracked (`var/agent-wiki/`)

Optional local projections for operators/agents. Must remain gitignored. Subject
to the same erasure obligations as workspace candidate data.

## Retention

- Canonical wiki notes: retain until superseded, then keep superseded stubs ≥ 90 days.
- Proposed notes rejected: retain ≥ 30 days for audit, then delete.
- Align candidate erasure with DB erasure RPCs — wiping a person must not leave
  raw PII in `var/agent-wiki/`.
