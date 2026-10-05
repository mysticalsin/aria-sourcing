---
project: MSourcing / ARIA
shift: 472
agent: cursor-cloud
updated: 2026-09-01T17:58Z
status: pr-open-coding-gates
---

# Handoff — Shift 472

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`66fb905`** — BA harvest query is `Calypso Business Analyst`, not leftover `Calypso Business Analysis MySQL`
- Prior tips: `65a502a` leftover GitHub not Sourced; `664b302` leftover strip; `470154d` audit codes
- Local gate green on `66fb905`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Ultron one Source on live `65a502a` / `camp_1788068519249_senior-calypso-business-analyst`: `request_entry`, `apifyKeyPresent` true, run-id `MbM69EmZp0kK2WrTi`, harvestapi Full SUCCEEDED items=0. Query was `Calypso Business Analysis MySQL`. Not invalid_state, not a key problem, not Mock
2. Proven: `tokenizeMustHaveSkills("Calypso Business Analysis, MySQL")` → `["Calypso","Business Analysis","MySQL"]`. `apifyHarvestQueryFromBrief` took Calypso + first two extras → AND 0
3. Fix only `apifyHarvestQueryFromBrief`: skip VSS project-type `Business Analysis` and MySQL extras; BA-shaped title adds `Business Analyst`. Query is `Calypso Business Analyst`. App Support stays `Calypso Linux Python`. Scoring chips unchanged. Leftover-GitHub strip unchanged. Fail-loud on 0

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 66fb905) onto aria-mantu-app
# Ultron: one Source on Senior Calypso BA
# Gate: request_entry query=Calypso Business Analyst + run-id
# Then real-contact people (email+phone+LinkedIn, ≥60, ≤20)
#   or one evidenced empty fail with query+run-id
# Query Calypso Business Analysis MySQL is FAIL
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open
- harvestapi `searchQuery` is keywords AND, not the LinkedIn boolean
- BA harvest query is `Calypso Business Analyst`. Do not AND leftover Business Analysis / MySQL
- App Support harvest query stays `Calypso Linux Python`
- Scoring chips stay Calypso / Business Analysis / MySQL
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- Leftover GitHub / `@example.com` are not LinkedIn people
- Devon owns Fly. READY TO MERGE stays no until live harvest is proven with the fixed query

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Do not send the LinkedIn boolean as harvestapi searchQuery
- Do not send full title + six skills
- Do not weaken leftover-GitHub strip
- Do not start a second slice
- Do not Path-B or Fly-deploy from this VM
