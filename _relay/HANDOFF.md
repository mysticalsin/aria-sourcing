---
project: MSourcing / ARIA
shift: 461
agent: cursor-cloud
updated: 2026-09-01T15:10Z
status: pr-open-coding-gates
---

# Handoff — Shift 461

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip: **`ee5e7d0`** — recall-capable keyed people-first harvest (DESIGN `9ddf822`, harvest `95efc3e`, lesson-type fix `ee5e7d0`)
- Local gate green on `ee5e7d0`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys this tip and pings SHA when live harvest is not 0-or-toast
- Polo parked. Calypso is a **need**, not a product name. No OAuth. No send. No merge

## Done this shift

1. DESIGN.md: keyed people-first harvest is the product. Query shape `Calypso Linux Python`. Apify first. Full evidence. Floor 60 / cap 20. Keyed 0 is a harvest bug, not an Access & Keys toast
2. `plannedSourcingSearches`: people-first emits Apify first via `apifyHarvestQueryFromBrief` (platform + two skills). Does not require a LinkedIn boolean. Software path unchanged
3. `/api/sourcing-agent`: people-first budget 90s; Apify sorted first; Tavily LinkedIn no longer burns the budget before harvestapi
4. `search_candidates`: harvestapi **Full**, wait `APIFY_HARVEST_WAIT_MS` 75s (cap 90s). Short mode cannot prove ≥60 skill-match
5. `mapApifyCandidates`: never stamps JD title; positions are skill evidence
6. `applyLiveEngineGate`: JD-title stamp is not evidence; name-only / empty still FAIL; cap 20
7. `resolveStoredApifyKey` matches `Apify (sourcing)` via `providerIsApify`
8. Keyed empty harvest toast has no Access & Keys reconnect CTA
9. Extended existing suites only: `mantu-intake`, `sourcing-engine`, `apify-sourcing`, `sourcing-agent-route-authority`, `sourcing-agent-contract`, `integrations-honesty`

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth from a VM. Do not invent candidates
- This VM does not deploy Fly. Live proof is Devon's Path-B deploy of `ee5e7d0`
- Fly may still be on `b6bc50f` or older until Devon deploys

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip ee5e7d0 onto aria-mantu-app. Ping SHA when harvest is not 0-or-toast
# Ultron: re-walk Calypso Application Support Source next batch after that SHA
# This VM: coding gates only. Do not merge PR 53. Do not merge PR 54
# READY TO MERGE: no until keyed harvest on Fly is not 0-or-toast
# Do not touch Vercel. Do not complete LinkedIn or Microsoft OAuth from a VM
# Do not invent candidates. Never auto-send
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open and unmerged
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- Access & Keys is the source of truth for Apify harvest. Do not ask to reconnect a valid key
- Keyed 0 harvest is a harvest bug. Do not toast Access & Keys as the fix
- Unkeyed people-first is Connect + fixture dry-run, not a `MISSING_PLUGIN` wall
- Official LinkedIn search is concept/honest. Fleet OAuth is identity/messaging, not partner search
- People-first harvest is Apify harvestapi Full with a recall-capable keyword query. Tavily LinkedIn is not the harvest
- Outlook send is Fleet Graph + Verify domain. Inbox SMTP is ingest
- HeyReach is LinkedIn send key for drafts, not a fake Live/Connected send account
- Send stays dry-run until channel-connect **and** Tony approves that send
- Devon owns Fly. This agent does not deploy and does not ask for `FLY_API_TOKEN`
- READY TO MERGE stays no until a keyed harvest is proven on Fly

## Watch out

- Do not invent Fly tokens or ask for them
- Do not invent candidates
- Do not complete OAuth from this VM
- Do not touch Vercel, Polo, or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
- Do not put `@fixture.example` in `sourcing-actions.ts`
- `applyLiveEngineGate` is server-only (`live-shortlist.ts`)
- Manifest freeze: extend existing suites, do not add new suite files
- Hooks before early return in Source via Apify stays
- Learning-lesson `platform` is not typed as Apify — do not compare lesson.platform === "Apify"
