---
project: MSourcing / ARIA
shift: 468
agent: cursor-cloud
updated: 2026-09-01T16:06Z
status: pr-open-coding-gates
---

# Handoff — Shift 468

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`c68c04f`** — named 503 gates + `SOURCING_AGENT_UNAVAILABLE` toast + people-first projection no longer dies on stale LLM settings
- Prior tips: `3cb0c08` fail-loud 4xx/5xx; `f594f25` product-host Origin
- Local gate green on `c68c04f`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Ultron 15:47:42Z on live `029291c`: Origin passed. `request_received` then `request_exit` `SOURCING_AGENT_UNAVAILABLE`. No `request_entry`. Silent none
2. After Origin, the generic 503 hid the gate. `request_exit` now names `prod_fail_closed`, `supabase_disabled`, `session_null`, `workspace_read_error`, `campaign_invalid_state`, `unhandled`
3. People-first projection no longer 503s on a stale cloud-model settings blob. Product-host click with invalid LLM settings still prints `request_entry` + query + `apifyKeyPresent`
4. `SOURCING_AGENT_UNAVAILABLE` maps to `SOURCING_AGENT_UNAVAILABLE_TOAST` — never silent 0, not remapped to Mock

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include c68c04f) onto aria-mantu-app
# Grep WEB 48e441ea927078 for aria_harvest / [aria-harvest]
# If still 503: toast unavailable + named request_exit reason
# Else request_entry with query + apifyKeyPresent
# Then Mock fail-loud PEOPLE_FIRST_HARVEST_MOCK or people ≥60 ≤20
# Ultron: one Source next batch. Silent 0 is FAIL
# CROSS_ORIGIN_REQUEST on the product host is FAIL
# This VM: coding gates only. Do not merge PR 53 or 54
# READY TO MERGE: no
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open
- Shortlist is skill-match, not name match. Floor 60. Cap 20
- People-first harvest is Apify harvestapi Full. Tavily LinkedIn is not the harvest
- Connected+Mock is not ready. `apifyKeyPresent` must not be true for Mock
- Same-site Origin is the public product host, not the Fly bind address
- A rejected people-first POST must toast. Silent 0 on 4xx/5xx is FAIL
- A generic `SOURCING_AGENT_UNAVAILABLE` must toast unavailable, not Mock
- People-first must not die on LLM settings before `request_entry`
- Send stays dry-run until channel-connect **and** Tony approves
- Devon owns Fly. READY TO MERGE stays no until live harvest is proven

## Watch out

- Do not invent Fly tokens, candidates, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Learning DB still cannot store platform=Apify (constraint)
- Manifest freeze: extend existing suites
- Do not auto-flip the Apify card from Mock to Live because a key exists
- Prefer Host over X-Forwarded-Host unless Host is a wildcard bind
- Do not start a second slice
