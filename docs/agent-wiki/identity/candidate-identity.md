---
id: id-model
kind: identity
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/rules.ts
  - src/lib/sourcing/providers/merge.ts
  - supabase/migrations/0037_person_identity_model.sql
  - src/lib/agent-wiki/identity.ts
---

# Candidate identity

## Principle

**A display name is never a person key.** Two "Alex Chen" records are different
people unless a durable key matches.

## Durable key priority (strongest first)

1. LinkedIn `/in/...` URL (canonicalized, lowercased) → may map to `person_id`
2. Email (lowercased, trimmed)
3. GitHub profile URL (lowercased)
4. Provider `sourceExternalId` / `externalIds` for that platform
5. Generic `sourceUrl` (last resort among URLs)

Name + current company is **batch-merge only** (transient) and must never become
a durable person identity alone.

## Campaign candidacy vs person

- `Candidate.id` = candidacy within a campaign (`genId("cand")` or Apollo UUID)
- `person_id` (when linked) = durable person across campaigns (LinkedIn-backed)
- Wiki / second-brain fingerprints use `src/lib/agent-wiki/identity.ts`

## Audit checklist

When reviewing a merge or wiki projection:

- [ ] Did we match on a durable key, not name?
- [ ] If LinkedIn missing, did we refuse silent person-link?
- [ ] Are similar-name candidates kept as separate fingerprints?
