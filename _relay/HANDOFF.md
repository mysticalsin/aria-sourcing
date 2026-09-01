---
project: MSourcing / ARIA
shift: 465
agent: cursor-cloud
updated: 2026-09-01T15:30Z
status: pr-open-coding-gates
---

# Handoff — Shift 465

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`b0f557b`** — Mock Apify is not a live harvest key (`PEOPLE_FIRST_HARVEST_MOCK`)
- Prior silent-no-op ship: `8eda953` (still in history). Do not open a second PR
- Local gate green: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip** (must include this Mock ship) and pings SHA
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Ultron 14:56:22Z addendum: Settings showed Apify Connected + MOCK; Source next batch was a silent no-op (0 sourced, no toast). `request_received` had `query: ""`; no `request_entry`
2. Mock card is not a live key. `hasLiveApifyHarvest` is false when `int_apify.mode === "mock"`. `apifyKeyPresent` is false on Mock. Do not decrypt a Mock key
3. `request_entry` logs **before** Tavily / vault hang, with the brief query (`Calypso Linux Python`) and `apifyKeyPresent` boolean. `request_received` no longer prints empty `query: ""`. Apify key resolve is bounded to 8s
4. People-first + Mock → `PEOPLE_FIRST_HARVEST_MOCK` + Connect Apify toast. `started:false` is visible. Client `Promise.race` 90s abort backup. `handleSource` try/finally; people-first 0 is an **error** toast
5. Live key still starts harvestapi Full, skill-match ≥60, cap ≤20

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly
- Live Fly may still be `86ae4a6` / `8eda953` until Devon deploys this tip

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include b0f557b) onto aria-mantu-app
# Grep the WEB process for aria_harvest / [aria-harvest] JSON on stdout
# Expect request_entry with a real query and apifyKeyPresent:false on Mock, then request_exit PEOPLE_FIRST_HARVEST_MOCK
# If a real Live key is present: request_entry apifyKeyPresent:true, then harvestapi Full
# Ultron: one Source next batch on Calypso Application Support — must toast Mock / Connect Apify, never silent 0
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- People-first harvest is Apify harvestapi Full. Tavily LinkedIn is not the harvest
- Connected+Mock is not ready. `apifyKeyPresent` must not be true for Mock
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
- Do not auto-flip the Apify card from Mock to Live because a key exists
