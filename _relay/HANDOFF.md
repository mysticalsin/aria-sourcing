---
project: MSourcing / ARIA
shift: 467
agent: cursor-cloud
updated: 2026-09-01T15:56Z
status: pr-open-coding-gates
---

# Handoff — Shift 467

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`3cb0c08`** — people-first 4xx/5xx toast + `source-next-batch-error` banner
- Prior tips: `f594f25` product-host Origin; `b0f557b` Mock is not a live key
- Local gate green on `3cb0c08`: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Same Ultron 15:31:59Z click on live `2e298e5`: footer `aria 2e298e58c8ae`, silent none. No toast, no `PEOPLE_FIRST_HARVEST_MOCK`, no CORS copy, no audit row, Calypso still 0. Client swallowed the 403
2. `sourceRejectedToast` is never null. handleSource / Source next batch (campaign, Command Center, candidates, fleet, launch, intake, agent-run-stream) always toast people-first 4xx/5xx including `CROSS_ORIGIN_REQUEST`
3. Error toasts are `role="alert"` / `aria-live="assertive"`. Durable `source-next-batch-error` banner stays on screen
4. Non-JSON 403 maps to `Sourcing request failed (HTTP 403). Do not treat this as 0 people.` — never the old unavailable swallow
5. Same-site product-host Origin (`f594f25`) is unchanged. Product-host click must still reach `request_entry`

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly. This VM cannot re-walk live Calypso

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include 3cb0c08) onto aria-mantu-app
# Grep WEB 48e441ea927078 for aria_harvest / [aria-harvest]
# Product-host click must reach request_entry with query + apifyKeyPresent
# CROSS_ORIGIN_REQUEST on https://aria-mantu-app.fly.dev is FAIL
# A rejected POST must toast + banner — silent 0 is FAIL
# Then Mock fail-loud or people skill-match ≥60 cap ≤20
# Ultron: one Source next batch. Silent no-op is FAIL
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
