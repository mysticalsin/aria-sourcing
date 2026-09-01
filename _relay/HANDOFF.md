---
project: MSourcing / ARIA
shift: 464
agent: cursor-cloud
updated: 2026-09-01T17:15Z
status: pr-open-coding-gates
---

# Handoff — Shift 464

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`8eda953`** — keyed Source next batch must not be a silent no-op
- Test pin: `d1f3211` (branch tip; includes `8eda953`)
- Local gate green on `d1f3211`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 tip (must include `8eda953`) and pings SHA when live harvest is not a silent no-op
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel

## Done this shift

1. Own finding vs Devon hypotheses: client could skip `/api/sourcing-agent` when local apiKeys/integrations looked unkeyed and run a fixture dry-run. That matches zero Fly lines even with a stored key. `console.info` also would not show on the loop JSON channel.
2. FITO 1: `aria_harvest` JSON on `process.stdout` — `request_received`, then `request_entry` with `apifyKeyPresent` (boolean, never the key), then actor/query/runId/status/items
3. FITO 2: client wait 90s; abort is `PEOPLE_FIRST_HARVEST_ABORTED`, fail loud, never silent 0
4. FITO 3: people-first always POSTs `/api/sourcing-agent`. Missing key → Connect Apify. Present key starts harvestapi Full
5. DESIGN.md harvest contract updated (90s, stdout, no silent fixture)

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly
- Live Fly may still be `d94535f` until Devon deploys

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 8eda953) onto aria-mantu-app
# Grep the WEB process for aria_harvest / [aria-harvest] JSON on stdout
# If there is no request_received line, the browser did not hit this process
# Ping Ultron with the SHA when Calypso Application Support Source next batch is not a silent no-op
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- People-first harvest is Apify harvestapi Full. Tavily LinkedIn is not the harvest
- Keyed silent 0 / 15 LinkedIn zeros is a harvest bug. Fail loud with evidence
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
- Do not infer a missing Apify key from integrations 1/7
