---
project: MSourcing / ARIA
shift: 470
agent: cursor-cloud
updated: 2026-09-01T17:12Z
status: pr-open-coding-gates
---

# Handoff — Shift 470

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`664b302`** — Mock/unavailable campaign activity keeps stdout codes; leftover GitHub / example.com stripped on hydrate and conflict
- Prior tips: `470154d` audit notes; `775ceba` invalid_state / Calypso coerce; `0c72a35` contact gate people-first only; `2f0ec26` email+phone+LinkedIn; `a61ebe0` Concept+valid key is harvest; `0d3361b` Mock toast
- Local gate green on `664b302`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM
- Apify stays Mock until Tony switches Access & Keys to Live. Ultron is holding Source. No second click

## Done this shift

1. Ultron late read-only on `3cb0c08`: toast gone, no `SOURCING_AGENT_UNAVAILABLE` text, no audit row
2. Campaign activity now persists Mock / unavailable with stdout code + toast: **Connect Apify** + `PEOPLE_FIRST_HARVEST_MOCK`, or **Sourcing failed** + `SOURCING_AGENT_UNAVAILABLE`. Same persist from `runSourcingAgent` and GitHub-only empty (`470154d`)
3. Tony/Ultron read of live `camp_1788068519249_senior-calypso-business-analyst`: people were leftover GitHub / `@example.com`, not LinkedIn. Hydrate + conflict reload now strip leftover GitHub / example.com / fixture.example, recompute metrics, persist Connect Apify audit (`664b302`). Do not invent LinkedIn profiles
4. Stdout still aligned with toast: Mock is `PEOPLE_FIRST_HARVEST_MOCK`, generic 503 is `SOURCING_AGENT_UNAVAILABLE`

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso
- Operator Mock stays Mock until Tony flips Access & Keys to Live. READY TO MERGE no until a Live key starts harvestapi Full

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 664b302) onto aria-mantu-app
# Grep WEB 48e441ea927078 for aria_harvest / [aria-harvest]
# After the toast is gone: campaign activity must still show
#   Connect Apify + PEOPLE_FIRST_HARVEST_MOCK
#   or Sourcing failed + SOURCING_AGENT_UNAVAILABLE
# Leftover GitHub / @example.com / name-only on the people list is FAIL
# Gate when Tony flips Live: request_entry + apifyKeyPresent true + run-id
# Then real-contact people (email+phone+LinkedIn, ≥60, ≤20)
#   or one evidenced empty/incomplete fail with query+run-id
# Access & Keys toast on campaign_invalid_state is FAIL
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
- Same-site Origin is the public product host, not the Fly bind address
- A rejected people-first POST must toast. Silent 0 on 4xx/5xx is FAIL
- Mock / unavailable must keep a campaign activity audit row (code + toast), not toast-only
- Leftover GitHub / `@example.com` / `@fixture.example` are not LinkedIn people. Do not invent replacements
- `campaign_invalid_state` is CAMPAIGN_NOT_READY, never SOURCING_AGENT_UNAVAILABLE / Access & Keys
- People-first must not die on LLM settings or leftover GitHub rows before `request_entry`
- Do not invent contact fields. Incomplete harvest fails loud with query + run-id
- Send stays dry-run until channel-connect **and** Tony approves
- Devon owns Fly. READY TO MERGE stays no until a Live key starts harvestapi Full

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Learning DB still cannot store platform=Apify (constraint)
- Manifest freeze: extend existing suites
- Do not auto-flip a real operator Mock card to Live because a key exists
- Prefer Host over X-Forwarded-Host unless Host is a wildcard bind
- Do not start a second slice
- Do not print the stored Apify key
- Do not Path-B or Fly-deploy from this VM
