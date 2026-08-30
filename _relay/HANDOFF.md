---
project: MSourcing / ARIA
shift: 426
agent: cursor-cloud
updated: 2026-08-30T04:40Z
status: candidates-compliance-fix-live
---

# Handoff — Shift 426

## Current state

- **Live Fly tip:** `3d678886efd9d3e4732fb4427ed477b9b8dc2d10` (`/api/ready` ok) — candidate `complianceFlags` repair
- **PR:** [#42](https://github.com/mysticalsin/aria-sourcing/pull/42) `cursor/candidate-compliance-repair-b91d` → `integration/sourcing-enrichment-on-main` (ready for review)
- **Prior tip on main:** `e527604` (campaign metrics repair #41) — Fly advanced ahead of main via owner deploy of PR tip
- **Live E2E:** `/candidates` renders 26 candidates after hard refresh; home/campaigns/floor/intake/campaign detail PASS; sourcing CTA starts without error boundary
- **GHA:** Actions budget may block CI — ignore phantoms

## Done this shift

1. Root-caused `/candidates` "Something broke" as `TypeError … doNotContact` on sparse candidates missing `complianceFlags`
2. Added `repairCandidates`/`repairComplianceFlags` in `normalizeHermesState` + migrate; fail-soft UI/rules
3. Regression in `tests/campaign-repair.mts` (3 pass); typecheck + npm test green
4. Reminted deploy confirm; `fly-deploy-now` shipped tip; physical E2E on Fly PASS

## Blockers (owner)

1. Merge #42 into integration (then FF main) so git tip matches Fly tip `3d67888`
2. Graph/HeyReach dropzones empty → no live auto-send `sent>0` (HOLD)
3. Hard-refresh after deploys (cached JS briefly showed old error boundary)

## Next steps

```bash
# Owner: merge PR #42, FF main to tip, remint confirm if redeploying from main
gh pr merge 42 --merge  # or UI
git fetch origin && git checkout main && git merge --ff-only origin/integration/sourcing-enrichment-on-main
```

## Decisions made (don't relitigate)

- Shell fail-soft + repair for sparse campaigns (`metrics`) and candidates (`complianceFlags`)
- Fly may temporarily lead main when owner deploys reviewed PR tip SHA
- Goal complete only on auto-send `sent>0` (separate from shell crash fixes)

## Watch out

- Stale deploy confirm SHA fails `fly-deploy-now`
- Do not chase Entra when `/tmp/owner-azure-app-id` / microsoft / llm dropzones missing → HOLD
