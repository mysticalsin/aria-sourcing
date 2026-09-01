---
project: MSourcing / ARIA
shift: 458
agent: cursor-cloud
updated: 2026-08-31T20:38Z
status: pr-open-coding-gates
---

# Handoff — Shift 458

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** (not merged)
- Leftover **PR #53 OPEN**. Do not touch. Do not merge
- Coding-gate tip: **`8cc8c23`** — planned LinkedIn+Apify harvest repairs quoted Skill (Must); keyed shortlist tests
- Fly restore is **Devon on the laptop**. Do not wait on `FLY_API_TOKEN`. Do not ask for it. Do not deploy from this VM
- Calypso is a client **need**, not a product name
- Local gate green on `8cc8c23`: `npm run typecheck && npm run typecheck:tests && npm test`
- READY TO MERGE stays **no** until a keyed LinkedIn+Apify shortlist

## Done this shift

1. Stopped Fly restore from this VM (Tony: Devon owns it)
2. `plannedSourcingSearches` runs `repairLinkedinBoolean` before LinkedIn/Apify steps
3. Tests: unkeyed fail-loud; keyed Apify without OAuth; Tavily is not a people source; Apify name-only drops; empty harvest invents nobody; floor 60 + CV citation

## Blockers

- Official LinkedIn partner search is not wired. Do not complete OAuth from a VM. Do not invent candidates
- Keyed live shortlist still requires a real Apify/LinkedIn key (operator Settings). Do not upgrade Apify from here

## Next steps

```bash
# This VM: coding gates only on PR 54 (LinkedIn+Apify shortlist honesty, tests)
# Devon: Fly restore of PR 54 onto aria-mantu-app (laptop). Do not wait here
# Do not merge PR 53. Do not merge PR 54
# READY TO MERGE: no until a keyed LinkedIn+Apify shortlist
# Do not touch Vercel. Do not complete LinkedIn OAuth from a VM
# Do not invent candidates
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One coding PR (#54). Leftover #53 stays open and unmerged
- Devon owns Fly restore. This agent does not deploy and does not ask for `FLY_API_TOKEN`
- READY TO MERGE stays no until a keyed LinkedIn+Apify shortlist
- Quality is the gate. Historic CI red matches main
- Do not put FLY_API_TOKEN on Quality
- GitHub `language:` and LinkedIn boolean use Skill (Must) tokens separately
- Tavily is web search, not LinkedIn Sourcing
- Outreach dry-run until Tony approves a send

## Watch out

- Do not invent Fly tokens or ask for them
- Do not invent candidates
- Do not complete OAuth from this VM
- Do not touch Vercel, Polo, or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
- `applyLiveEngineGate` is server-only (`live-shortlist.ts`)
