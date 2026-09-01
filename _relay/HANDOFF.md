---
project: MSourcing / ARIA
shift: 463
agent: cursor-cloud
updated: 2026-09-01T16:45Z
status: pr-open-coding-gates
---

# Handoff — Shift 463

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`7cfb52f`** — harvest `ok:false` reaches evidence codes
- Prior harvest ship: `c328724` (start/poll/one fail), tests `71d03fd` `29abeeb`
- Local gate green on `7cfb52f`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 tip (must include `7cfb52f`) and pings SHA when live harvest is not 0-or-15-zero-rows
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel

## Done this shift

1. Verified FITO 1+2+3 from prior commits. Own finding: harvest evidence was false-green. Production `search_candidates` returns `ok:false` when harvest did not start or is still RUNNING; the route returned `SOURCING_AGENT_UPSTREAM_FAILED` before reading harvest. Tests always returned `ok:true`.
2. People-first skips that generic early-return so `PEOPLE_FIRST_HARVEST_NOT_STARTED` / `STILL_RUNNING` / `EMPTY` are what the client shows.
3. Route-authority mock now returns `ok:false` unless harvest status is SUCCEEDED.
4. Contract pin: `!successfulQuery && !(peopleFirst && !frameworkAuthorization)`
5. DESIGN.md harvest contract unchanged this shift (already at `docs/sourcing-engine/DESIGN.md`)

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly
- Live Fly may still be `eb3d28c` until Devon deploys

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 7cfb52f) onto aria-mantu-app
# Grep the WEB process for [aria-harvest] (not loop claimed:0)
# Ping Ultron with the SHA when Calypso Application Support Source next batch is not 0-or-15-zero-rows
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- People-first harvest is Apify harvestapi Full. Tavily LinkedIn is not the harvest
- Keyed 0 / 15 LinkedIn zeros is a harvest bug. One evidenced fail with query + run-id + Source via Apify
- Send stays dry-run until channel-connect **and** Tony approves
- Devon owns Fly. READY TO MERGE stays no until live harvest is proven

## Watch out

- Do not invent Fly tokens, candidates, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Learning DB still cannot store platform=Apify (constraint). Success receipts remap Apify→LinkedIn only when candidateCount > 0
- Manifest freeze: extend existing suites
- Engine must not import `@/lib/utils`
- `applyLiveEngineGate` is server-only
- Loop `claimed:0` is the wrong log for Source next batch
