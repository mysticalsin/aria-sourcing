---
id: id-disambig
kind: identity
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/agent-wiki/identity.ts
---

# Disambiguation

## Failure mode we prevent

Treating "same first+last name" as the same candidate → wrong outreach, wrong
lawful basis, wrong booking.

## Algorithm (runtime)

`fingerprintCandidateIdentity(input)` returns:

```
{
  fingerprint: sha256 hex of strongest available durable key,
  strength: "linkedin" | "email" | "github" | "external" | "source_url" | "none",
  displayHint: non-identifying label for operators (e.g. "LI:…abcd" / "email:…wxyz")
}
```

Rules:

- If **no durable key**, strength is `none` — do not merge; do not write a
  person-scoped wiki note; keep campaign candidacy only.
- Fingerprints for tracked docs must be **hashes**, never raw emails/URLs.
- Tenant projections under `var/agent-wiki/` may resolve fingerprints → candidate
  ids locally; that tree is gitignored.

## Similar names, different people

| Signal | Same person? |
| --- | --- |
| Same name, different LinkedIn | No |
| Same name, different email | No |
| Same LinkedIn, different display name | Yes |
| Same name+company, no URLs | Insufficient — keep separate |
