---
project: MSourcing / ARIA
shift: 466
agent: cursor-cloud
updated: 2026-09-01T15:45Z
status: pr-open-coding-gates
---

# Handoff — Shift 466

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Feature tip (this shift): **`f594f25`** — Fly product-host Origin is same-site, not `CROSS_ORIGIN_REQUEST`
- Prior tips: `b0f557b` Mock is not a live key; `8eda953` silent-no-op
- Local gate green: `npx tsc --noEmit && npx tsc -p tsconfig.tests.json --pretty false && npm test`
- READY TO MERGE stays **no**. Devon Path-B deploys PR 54 **tip**
- Polo parked. Calypso is a **need**. No OAuth. No send. No merge. No Vercel. No Fly from this VM

## Done this shift

1. Ultron 15:31:59Z on live `2e298e5`: POST happened. Web `48e441ea927078` logged `request_received` then `request_exit` `CROSS_ORIGIN_REQUEST`. No `request_entry`. HOSTNAME is `::`. Product URL is `https://aria-mantu-app.fly.dev/`
2. Hypothesis confirmed: `handlePost` compared Origin to `req.nextUrl.origin` (`http://[::]:3000`)
3. Same-site now uses Host / `X-Forwarded-Proto` + `X-Forwarded-Host`. Wildcard bind (`::`, `0.0.0.0`) is not the product host
4. True cross-origin fails loud (`CROSS_ORIGIN_SOURCING_TOAST`) — never silent 0. Mock still not a live key

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth. Do not invent candidates
- This VM does not deploy Fly

## Next steps

```bash
# Devon: Path B deploy of PR 54 tip (must include f594f25) onto aria-mantu-app
# Grep WEB 48e441ea927078 for aria_harvest / [aria-harvest]
# Product-host click must reach request_entry with query + apifyKeyPresent
# CROSS_ORIGIN_REQUEST on https://aria-mantu-app.fly.dev is FAIL
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
- Send stays dry-run until channel-connect **and** Tony approves
- Devon owns Fly. READY TO MERGE stays no until live harvest is proven

## Watch out

- Do not invent Fly tokens, candidates, or OAuth
- Do not touch Vercel, Polo, or PR #53
- Learning DB still cannot store platform=Apify (constraint)
- Manifest freeze: extend existing suites
- Do not auto-flip the Apify card from Mock to Live because a key exists
- Prefer Host over X-Forwarded-Host unless Host is a wildcard bind
