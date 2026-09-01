---
project: MSourcing / ARIA
shift: 471
agent: cursor-cloud
updated: 2026-09-01T17:18Z
status: pr-open-coding-gates
---

# Handoff — Shift 471

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`1a8ae40`** — people-first Sourced/health use visible harvest people; Mock/unkeyed empty shows Connect Apify without a second Source click
- Prior tips: `664b302` leftover strip on hydrate/conflict; `470154d` audit notes with stdout codes; `775ceba` invalid_state / Calypso coerce
- Local gate green on `1a8ae40`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM
- Apify stays Mock until Tony switches Access & Keys to Live. Ultron is holding Source. No second click

## Done this shift

1. Ultron confirmed live `camp_1788068519249_senior-calypso-business-analyst` people are leftover GitHub / `@example.com`, not LinkedIn
2. Hydrate + conflict already strip leftover GitHub / example.com / fixture.example (`664b302`). Do not invent LinkedIn profiles
3. Campaign page Sourced and health now use **visible** people-first harvest rows only — leftover GitHub does not inflate Sourced (`1a8ae40`)
4. Mock / unkeyed empty people-first campaigns fail loud **Connect Apify / switch to Live** without Source next batch. Ultron can hold Source
5. Durable audit row still keeps `PEOPLE_FIRST_HARVEST_MOCK` / `SOURCING_AGENT_UNAVAILABLE` plus the toast

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso
- Operator Mock stays Mock until Tony flips Access & Keys to Live. READY TO MERGE no until a Live key starts harvestapi Full

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 1a8ae40) onto aria-mantu-app
# Leftover GitHub / @example.com on the people list or in Sourced is FAIL
# Mock empty campaign must show Connect Apify without a second Source click
# After toast is gone: activity still has PEOPLE_FIRST_HARVEST_MOCK or SOURCING_AGENT_UNAVAILABLE
# Gate when Tony flips Live: request_entry + apifyKeyPresent true + run-id
# Then real-contact people (email+phone+LinkedIn, ≥60, ≤20)
#   or one evidenced empty/incomplete fail with query+run-id
# Ultron: holding Source. No second click until Live. Silent 0 is FAIL
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- People-first harvest is Apify harvestapi Full. Tavily LinkedIn is not the harvest
- Connected+Mock is not ready. `apifyKeyPresent` must not be true for Mock
- Concept / missing Live + valid stored key is harvest. Operator Mock stays Mock
- Leftover GitHub / `@example.com` / `@fixture.example` are not LinkedIn people. Do not invent replacements
- People-first Sourced is visible harvest people only
- Mock / unkeyed empty fails loud Connect Apify without a second Source click
- Mock / unavailable must keep a campaign activity audit row (code + toast)
- `campaign_invalid_state` is CAMPAIGN_NOT_READY, never Access & Keys
- Devon owns Fly. READY TO MERGE stays no until a Live key starts harvestapi Full

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Learning DB still cannot store platform=Apify (constraint)
- Manifest freeze: extend existing suites
- Do not auto-flip a real operator Mock card to Live because a key exists
- Do not start a second slice
- Do not print the stored Apify key
- Do not Path-B or Fly-deploy from this VM
- Do not click Source for Ultron
