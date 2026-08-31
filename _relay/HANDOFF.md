---
project: MSourcing / ARIA
shift: 447
agent: cursor-cloud
updated: 2026-08-31T09:18Z
status: pr-open
---

# Handoff — Shift 447

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Tip: **`7f657b4`** — fail-loud toast names LinkedIn and Apify and says connect. Local gate green: `./node_modules/.bin/tsc --noEmit && npm run typecheck:tests && npm test`
- Live Fly v166 / `b8a79d2` second click toasted “Sourcing failed — The sourcing agent returned an invalid response.” Still 0 candidates. GitHub Sourcing Live while unconfigured. This tip is the fix. Same PR. Do not merge
- Historic CI still red as on main. Quality is the gate. Do not chase historic
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not invent candidates. Did not complete OAuth

## Done this shift

1. People-first Source next batch fails **before** claiming a run when Apify is unkeyed (`503` / `MISSING_PLUGIN`)
2. Client preflight: LinkedIn+Apify unconfigured (GitHub Live does not count) never calls the agent — no “invalid response” toast
3. Toast title **Connect LinkedIn and Apify**; description `MISSING_PLUGIN: Connect LinkedIn and Apify in Settings. GitHub Sourcing cannot fill this role, even when toggled Live.`
4. Generic agent errors (“invalid response”, “invalid result”, unconfigured) remap to that toast when those plugins are missing
5. GitHub-only empty batch is fail-loud and is not persisted
6. Tests extended in existing suites. No new suite files

## Blockers

- Protected Fly release must land `7f657b4+` before Ultron can re-walk Source next batch
- Official LinkedIn partner search is not wired; Apify is the people source that unblocks the gate
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 (7f657b4+) → aria-mantu-app
# Ultron: walk Calypso Application Support on the new SHA
#   Source next batch with LinkedIn+Apify unconfigured (GitHub may be Live):
#     error toast title Connect LinkedIn and Apify
#     description contains MISSING_PLUGIN and connect
#     must not say invalid response
#     no GitHub 0×3 success
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
- GitHub Sourcing Live while unconfigured is not a people source
- Outreach dry-run until Tony approves a send. Never auto-send. Never identify as AI
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
