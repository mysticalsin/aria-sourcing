---
project: MSourcing / ARIA
shift: 475
agent: cursor-cloud
updated: 2026-09-01T20:18Z
status: pr-open-coding-gates
---

# Handoff — Shift 475

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`6dbb72e`** — items=0 auto-starts next harvest; clip 1270 overflow
- Ultron walked Fly `d99e772` v212: FAIL (banner-only next-search + scrollWidth 1313/1270)
- Harvest first query stays **`Calypso Business Analyst`** / App Support **`Calypso Linux Python`**
- Local gate green on `6dbb72e`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip** later
- Polo parked. Overlay/Métis out of scope. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Root cause of 0-and-stop: one shared 90s `AbortController` across the plan. First `SUCCEEDED items=0` consumed the budget; harvest 2 never started. Banner said "Engine continues" anyway
2. Fresh 90s per attempt (`PEOPLE_FIRST_ATTEMPT_WAIT_MS`). Total budget / client wait / `maxDuration` = 360s. Log `next_search_start` before harvest 2+. Same POST, no second click
3. Last-resort `PEOPLE_FIRST_HARVEST_EMPTY` copy no longer claims the engine continues. Title is **Empty harvest is not a result**, not Next search required
4. Overflow: `cc-activity-outcome` wraps; orbital in `overflow-hidden [contain:paint]` (no `-right-24`); grid/audit column `min-w-0`. No html/body overflow-x hide
5. Tests: empty first query starts ≥2 Apify harvests in one POST; 1270 pill+orbital model; DESIGN never-0 + 360s pins. `command-center-firstrun` 50; `sourcing-agent-route-authority` 40

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso or measure 1270 `scrollWidth` in a browser

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 6dbb72e) onto aria-mantu-app
# Ultron: one Source. request_entry query=Calypso Business Analyst plannedHarvests>=2
# If harvest 1 SUCCEEDED items=0: next_search_start + a second harvestapi run. No second click
# Real shortlist: email + phone + LinkedIn, skill-match >=60, cap <=20
# At 1270: scrollWidth ~= clientWidth (activity outcome + orbital must not expand)
# H1 stays Your next move is ready.
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
- Devon owns Fly. READY TO MERGE stays no

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, Overlay/Métis, or PR #53
- Do not regress harvest first query or leftover-GitHub strip
- Do not send the LinkedIn boolean as harvestapi `searchQuery`
- Do not Path-B or Fly-deploy from this VM
- Do not share one 90s abort across planned harvests
- Route-authority continue fixture must set `lastContactedAt: null`
