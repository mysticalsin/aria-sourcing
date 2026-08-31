---
project: MSourcing / ARIA
shift: 446
agent: cursor-cloud
updated: 2026-08-31T09:08Z
status: pr-open
---

# Handoff — Shift 446

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Tip: **`b95f56a`** — fail-loud no longer treats Tavily as LinkedIn. Quality gate green locally: `./node_modules/.bin/tsc --noEmit && npm run typecheck:tests && npm test`
- Live Fly v166 / `b8a79d2` walked: skill chips + Load Mantu **PASS**; Source next batch still silent (GitHub 0×3, no `MISSING_PLUGIN` toast) because a Tavily key skipped fail-loud
- This tip is the fix for that walk. Same PR. Do not merge. Do not invent candidates. Do not complete OAuth from the VM
- Historic CI still red as on main. Quality is the gate. Do not chase historic
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy

## Done this shift

1. People-first Source next batch fails `503` / `MISSING_PLUGIN` when Apify is unkeyed. Tavily does **not** count as LinkedIn Sourcing
2. Client toast keeps the `MISSING_PLUGIN` string (no longer remapped to a generic unconfigured message)
3. Promoted GitHub lessons are skipped on people-first roles (no GitHub 0×3 fall-through)
4. Tests extended in `tests/sourcing-agent-route-authority.mts` and `tests/sourcing-agent-contract.mts`. No new suite files
5. `docs/sourcing-engine/DESIGN.md` updated: Tavily is not LinkedIn

## Blockers

- Protected Fly release must land this tip before Ultron can re-walk Source next batch
- LinkedIn official partner search is not wired; Apify is the only people source that unblocks the gate
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 (b95f56a+) → aria-mantu-app
# Ultron: walk Calypso Application Support on the new SHA
#   Footer SHA matches the new tip
#   Source next batch with LinkedIn+Apify unkeyed: error toast contains MISSING_PLUGIN
#   Learning panel must not record GitHub 0×3 as a successful batch
#   Skill chips and Load Mantu stay as on v166 (already PASS)
# Do not merge PR 54
# Do not fake flyctl deploy
# Do not complete LinkedIn OAuth from a VM
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One PR (#54). READY TO MERGE stays no
- Shortlist floor 60, cap 20, name-only fail, per-row citations
- LinkedIn is primary, not exclusive; Apify + keyed sources still required
- Tavily is web search, not LinkedIn Sourcing
- Outreach dry-run until Tony approves a send. Never auto-send. Never identify as AI
- HeyReach 0-account HOLD is not a skip — sequences are in-product
- Quality stays green; do not put FLY_API_TOKEN on Quality
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
