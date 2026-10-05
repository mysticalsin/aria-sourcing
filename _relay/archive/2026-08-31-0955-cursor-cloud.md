---
project: MSourcing / ARIA
shift: 451
agent: cursor-cloud
updated: 2026-08-31T09:46Z
status: pr-open
---

# Handoff — Shift 451

## Current state

- Branch `cursor/sourcing-engine-94b1` → **PR #54 OPEN** against `main` (not merged)
- Tip: **`81f7ac7`** — every Source surface fail-louds `MISSING_PLUGIN` / Connect LinkedIn and Apify for an unkeyed people-first need
- Live Fly v166 / `b8a79d2` still has the old generic invalid-response + GitHub Live-unconfigured lie. Devon Path B of `81f7ac7+` on `https://aria-mantu-app.fly.dev/` is the re-walk
- READY TO MERGE stays **no** until that Fly walk PASSes
- Historic CI still red as on main. Quality is the gate. Do not chase historic
- This VM has no `FLY_API_TOKEN`. Did not fake a Fly deploy. Did not invent candidates. Did not complete OAuth. Did not touch Vercel. No aria-sourcing-demo.vercel.app

## Done this shift

1. Campaign, Candidates, Fleet Source next batch toast **Connect LinkedIn and Apify** / `MISSING_PLUGIN` before the agent when plugins are unkeyed
2. Intake and Launch no longer swallow people-first failures as “Sourcing couldn't start” / silent `sourcingComplete: false`
3. Prior Live honesty still holds: GitHub is not Live on a Calypso or unloaded need while LinkedIn+Apify are unkeyed (`2d64538`)

## Blockers

- Protected Fly release must land `81f7ac7+` before Ultron can re-walk Command Center Source + Settings Live
- Official LinkedIn partner search is not wired; Apify is the people source that unblocks the gate
- No Fly token here

## Next steps

```bash
# Devon: Path B protected Fly release of cursor/sourcing-engine-94b1 (81f7ac7+) → aria-mantu-app
# Ultron: walk Calypso Application Support on the new SHA at https://aria-mantu-app.fly.dev/
#   Command Center Source next batch, LinkedIn+Apify unkeyed:
#     toast title Connect LinkedIn and Apify
#     description contains MISSING_PLUGIN
#     must not say invalid-response
#     must not be silent GitHub 0×3
#   Settings: GitHub Sourcing must not badge Live while LinkedIn+Apify are unkeyed
# Do not merge PR 54
# Do not touch Vercel
# Do not fake flyctl deploy
# Do not complete LinkedIn OAuth from a VM
```

## Decisions made (don't relitigate)

- Product name is Aria. Calypso is a client **need**
- One PR (#54). READY TO MERGE stays no until Fly walk PASS
- Fly only: `https://aria-mantu-app.fly.dev/`. No Vercel. No demo deploys
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
