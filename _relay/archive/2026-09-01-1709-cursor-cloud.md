---
project: MSourcing / ARIA
shift: 469
agent: cursor-cloud
updated: 2026-09-01T16:52Z
status: pr-open-coding-gates
---

# Handoff — Shift 469

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`775ceba`** — campaign_invalid_state is CAMPAIGN_NOT_READY, not Access & Keys; people-first projection coerces a reviewed Calypso brief
- Prior tips: `0c72a35` contact gate people-first only; `9c2dfc8` invalid_state mapping; `2f0ec26` email+phone+LinkedIn; `a61ebe0` Concept+valid key is harvest; `0d3361b` Mock toast; `c68c04f` named 503 gates
- Local gate green on `775ceba`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Ultron 16:32:52Z on live `a61ebe0`: `request_received` then `request_exit` `SOURCING_AGENT_UNAVAILABLE:campaign_invalid_state`. Never `request_entry`. Toast unavailable + Open Access & Keys. Valid stored Apify key (last-4 only)
2. Projection now coerces a reviewed Calypso brief (VSS Consulting / Senior (7-10 years), missing optional shape fields, leftover GitHub / example.com rows). Do not drop the campaign. Do not invent people
3. Remaining un-coerceable state is `409 CAMPAIGN_NOT_READY` + `request_exit campaign_invalid_state codes=…` (zod codes only, no PII, no key). Toast Complete and review the campaign brief. Never Open Access & Keys
4. People-first rows still require email + phone + LinkedIn (`2f0ec26`). Incomplete harvest is `PEOPLE_FIRST_HARVEST_INCOMPLETE_CONTACTS` with query + run-id. Software Apify maps are not held to that contact bar (`0c72a35`)

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 775ceba) onto aria-mantu-app
# Grep WEB 48e441ea927078 for aria_harvest / [aria-harvest]
# Gate: request_entry + apifyKeyPresent true + run-id
# Then real-contact people (email+phone+LinkedIn, ≥60, ≤20)
#   or one evidenced empty/incomplete fail with query+run-id
# Access & Keys toast on campaign_invalid_state is FAIL
# Leftover GitHub / @example.com / name-only is FAIL
# Ultron: one Source next batch. Silent 0 is FAIL
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
- `campaign_invalid_state` is CAMPAIGN_NOT_READY, never SOURCING_AGENT_UNAVAILABLE / Access & Keys
- People-first must not die on LLM settings or leftover GitHub rows before `request_entry`
- Do not invent contact fields. Incomplete harvest fails loud with query + run-id
- Send stays dry-run until channel-connect **and** Tony approves
- Devon owns Fly. READY TO MERGE stays no until live harvest is proven

## Watch out

- Do not invent Fly tokens, candidates, emails, phones, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Learning DB still cannot store platform=Apify (constraint)
- Manifest freeze: extend existing suites
- Do not auto-flip a real operator Mock card to Live because a key exists
- Prefer Host over X-Forwarded-Host unless Host is a wildcard bind
- Do not start a second slice
- Do not print the stored Apify key
