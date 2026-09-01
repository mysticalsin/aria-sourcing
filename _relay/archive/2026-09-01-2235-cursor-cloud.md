---
project: MSourcing / ARIA
shift: 476
agent: cursor-cloud
updated: 2026-09-01T21:17Z
status: pr-open-coding-gates
---

# Handoff — Shift 476

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`a6785c2`** — people-first queue ≥2; items=0 starts harvest 2
- Ultron walked Fly **`a05cf5a`**: Overflow PASS, H1 PASS, Sourcing FAIL 0-and-stop. One run `Etz5JWFCQGm1605KE` query=`Calypso Business Analyst` SUCCEEDED items=0. Banner “Every planned search was tried” on a one-item plan
- Harvest first query stays **`Calypso Business Analyst`** / App Support **`Calypso Linux Python`**
- Local gate green on `a6785c2`: `npm run typecheck && npm run typecheck:tests && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip** later
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Hypothesis confirmed: route iterated `plannedSourcingSearches` Apify slice and treated a one-item / fingerprint-drift stop as exhausted. Banner copy said every search was tried anyway
2. Plan: `peopleFirstHarvestQueue` / `peopleFirstHarvestAttempts` always ≥2. Next actor-input is `searchQuery=Calypso` + `currentJobTitles=["Business Analyst"]` (App Support titles stay off the keyword query so it remains `Calypso Linux Python`)
3. Enqueue: one Source POST runs `peopleFirstHarvestQueue`, appends `nextPeopleFirstHarvest` after `SUCCEEDED items=0`, fresh 90s per attempt, 360s budget. `peopleFirstContinueAuthority` does not abort harvest 2 on leftover-strip fingerprint drift
4. Banner “Every planned search was tried” only when `startedSearches >= 2`. One started harvest is `PEOPLE_FIRST_HARVEST_NOT_STARTED`, not EMPTY
5. Tests: BA items=0 starts a second harvestapi run with a new run id; runner-level empty first harvest starts run-2; banner pin. Do not invent people

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include a6785c2) onto aria-mantu-app
# Ultron: one Source on camp_1788068519249 query=Calypso Business Analyst
# request_entry plannedHarvests>=2
# If harvest 1 SUCCEEDED items=0: next_search_start + a second harvestapi run id
# (broader query and/or currentJobTitles). No second click
# Banner "every planned search was tried" only if ≥2 distinct searches actually ran
# Real shortlist: email + phone + LinkedIn, skill-match >=60, cap <=20
# H1 stays Your next move is ready. Overflow already PASS on a05cf5a
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- Returning Command Center H1 is Aria-shaped. Acting on {title} is chip/subtitle
- Aria can never find 0 people. items=0 is next-search, not a result
- Copy is not next-search. The loop must start harvest 2
- First query stays `Calypso Business Analyst`
- Do not hide overflow-x on html/body
- Leftover GitHub / `@example.com` are not LinkedIn people
- Do not invent people to fill a 0
- Banner “every planned search was tried” requires ≥2 distinct harvests that ran
- Devon owns Fly. READY TO MERGE stays no

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, Overlay/Métis, or PR #53
- Do not regress harvest first query or leftover-GitHub strip
- Do not send the LinkedIn boolean as harvestapi `searchQuery`
- Do not Path-B or Fly-deploy from this VM
- Do not share one 90s abort across planned harvests
- Do not put Application Support into the harvestapi keyword query
- Route-authority continue fixture must set `lastContactedAt: null`
