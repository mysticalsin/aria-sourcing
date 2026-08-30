---
id: source-evidence
kind: sourcing
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/sourcing/learning-authority.ts
  - src/app/api/sourcing-learning/feedback/route.ts
---

# Query and evidence

Every successful provider execution should leave an aggregate receipt the
recruiter can mark useful / dead_end / corrected.

## Evidence hygiene

- Receipts are opaque IDs — never trust client-supplied candidate lists as proof.
- Graphify sees fingerprints and counts only (no PII).
- Wiki lessons cite `evidence:` frontmatter as receipt IDs or file paths — never
  paste candidate emails into tracked notes.

## Compaction tip

When multiple receipts agree on the same query pattern, compact into one lesson
with `supersedes:` listing the draft lesson notes. Keep the winning query text
and the count of independent campaigns that corroborated it.
