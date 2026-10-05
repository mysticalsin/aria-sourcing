---
project: MSourcing / ARIA
shift: 474
agent: cursor-cloud
updated: 2026-09-01T19:43Z
status: pr-open-coding-gates
---

# Handoff — Shift 474

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`d4e700b`** — never-0 next-search + wrap pills + pipeline=shortlist + persist-skip pin
- Prior feature commits: `9a33068` (continue past empty first harvest), `2dd3657` (never 0-and-stop + wrap pills)
- Harvest first query stays **`Calypso Business Analyst`** / App Support **`Calypso Linux Python`**
- Local gate green on `d4e700b`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip** later
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. DESIGN section **Never 0 people (product law)**: items=0 is not a product result; 0-and-stop is FAIL; empty harvest must next-search until a real shortlist
2. `peopleFirstHarvestAttempts` keeps first query, then `searchQuery=Calypso` + `currentJobTitles=["Business Analyst"]`, then broadeners (`Calypso Business Analysis`, `Calypso`). Cap 4. Route runs all Apify plan steps (no `.slice(0, 1)`). Logs `empty_next_search`
3. Last-resort after every planned search still 0 is `PEOPLE_FIRST_HARVEST_EMPTY`. Do not invent people. Leftover GitHub / name-only / `@example.com` still fail (`PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS`)
4. Topbar pills: `cc-integration-pills` is `flex-wrap min-w-0 max-w-full`. No html/body `overflow-x: hidden`. Test models 1270 `scrollWidth ≈ clientWidth`
5. Pipeline sourced for this campaign = visible contact-complete shortlist (`metricsRealigned`). Persist skip only when leftover strip and metrics realign are both no-ops
6. Tests extended in existing suites: empty first query continues (`sourcing-agent-route-authority` 40); leftover gate still INCOMPLETE; overflow pills (`command-center-firstrun` 47); live-role persist pin (`live-role-authority` 23)

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso or measure 1270 `scrollWidth` in a browser

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include d4e700b) onto aria-mantu-app
# Ultron Source: first request_entry query=Calypso Business Analyst
# If that harvest is SUCCEEDED items=0, engine MUST next-search (not banner-stop)
# Real shortlist: email + phone + LinkedIn, skill-match >=60, cap <=20
# Pipeline count must match the visible shortlist, not stale 8
# At 1270: Command Center pills scrollWidth ~= clientWidth; no html/body overflow-x hide
# H1 stays Your next move is ready.
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- Returning Command Center H1 is Aria-shaped. Acting on {title} is chip/subtitle
- Aria can never find 0 people. items=0 is next-search, not a result
- First query stays `Calypso Business Analyst`. Engine continues after that 0
- Do not hide overflow-x on html/body
- Leftover GitHub / `@example.com` are not LinkedIn people
- Do not invent people to fill a 0
- Devon owns Fly. READY TO MERGE stays no

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, Overlay/Métis, or PR #53
- Do not regress harvest first query or leftover-GitHub strip
- Do not send the LinkedIn boolean as harvestapi `searchQuery`
- Do not Path-B or Fly-deploy from this VM
- Route-authority continue fixture must set `lastContactedAt: null` or dedupe drops the next-search person
