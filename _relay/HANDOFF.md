---
project: MSourcing / ARIA
shift: 454
agent: cursor-cloud
updated: 2026-08-31T10:45Z
status: pr-open
---

# Handoff — Shift 454

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Tip: **`bc8f765`** — hide stale GitHub 0-row learning residue on people-first / unkeyed LinkedIn+Apify
- Ultron Fly walk of v170 / `604d100` PASSed fail-loud toast + skills + Calypso identity. Leftover FAIL was GitHub 0-rows in the learning panel. This tip is that fix
- Local gate green: `npm run typecheck && npm run typecheck:tests && npm test`
- Historic CI still red as on main. Quality is the gate. Do not chase historic
- READY TO MERGE stays **no** until a keyed shortlist (Tony lock)
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not invent candidates. Did not complete OAuth. Did not touch Vercel

## Done this shift

1. `visiblePeopleFirstLearningReceipts` drops GitHub receipts on a people-first need while LinkedIn+Apify are unkeyed, and drops GitHub 0-count rows even if cards look connected
2. Campaign Private role learning panel renders only those visible receipts
3. `listPendingSourcingFeedback` and Source next batch return the same filtered set so stale Fly GitHub 0×N rows do not reappear

## Blockers

- Devon Path B of **`bc8f765`** onto `https://aria-mantu-app.fly.dev/` before Ultron re-walks the learning panel
- Official LinkedIn partner search is not wired; Apify is the people source that unblocks a keyed shortlist
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 (bc8f765) → aria-mantu-app
# Ultron: walk Calypso Application Support on bc8f765 at https://aria-mantu-app.fly.dev/
#   Learning panel must not show GitHub 0 real candidates / 0-query residue
#   Fail-loud toast still Connect LinkedIn and Apify / MISSING_PLUGIN
#   GitHub Sourcing must not badge Live while LinkedIn+Apify are unkeyed
# Do not merge PR 54
# READY TO MERGE: no until a keyed shortlist
# Do not touch Vercel
# Do not complete LinkedIn OAuth from a VM
# Do not invent candidates
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One PR (#54). READY TO MERGE stays no until a keyed shortlist
- Fly only: `https://aria-mantu-app.fly.dev/`. No Vercel. No demo deploys. No second implementer
- Quality is the gate. Historic CI red matches main
- Shortlist floor 60, cap 20, name-only fail, per-row citations
- LinkedIn is primary, not exclusive; Apify + keyed sources still required
- Tavily is web search, not LinkedIn Sourcing
- GitHub Sourcing Live while unconfigured is not a people source
- Outreach dry-run until Tony approves a send. Never auto-send. Never identify as AI
- Do not put FLY_API_TOKEN on Quality
- Do not add Apify to the SQL learning platform check without a migration
- Load Mantu need is the Calypso Application Support VSS, not the Murex sample

## Watch out

- Do not invent Fly tokens
- Do not invent candidates
- Do not complete OAuth from this VM
- Do not touch Vercel or Polo or PR #53
- `campaign-actions.ts` runtime imports stay `import {` + `evaluateNeedReadiness` only
- Engine must not import `@/lib/utils`
- Do not import `src/lib/sourcing/engine.ts` from client `sourcing-actions.ts` or `sourcing-helpers.ts`
- `applyLiveEngineGate` is server-only (`live-shortlist.ts`)
