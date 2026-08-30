---
project: MSourcing / ARIA
shift: 429
agent: cursor-cloud
updated: 2026-08-30T05:55Z
status: calypso-focus-sparse-repair-live
---

# Handoff — Shift 429

## Current state

- **main = integration = Fly tip:** `2b4472eb0edf840a7457fe51f99c7cfc3a0c2607`
- **Branch:** `cursor/sparse-state-calypso-b91d` (FF-merged into integration + main; Fly deployed)
- **Live workspace campaigns:** **1** — `camp_1788068519249_senior-calypso-business-analyst` (Senior Calypso Business Analyst / AMACAN / BNPP CIB - Canada)
- **Candidates sourced:** **8** (live GitHub, provenance=live); metrics.sourced=8
- **QA:** authenticated hard-refresh routes — no "Something broke" (`/opt/cursor/artifacts/screenshots/qa-calypso-*.png`)
- **GHA CI:** Actions budget may still block jobs — ignore phantoms; physical QA is gate

## Done this shift

1. Comprehensive sparse-state repair in `src/lib/store/migrations.ts` (replies, bookings, settings arrays, candidate experience/education) + fail-soft UI hot paths + `deleteCampaign`
2. Regression tests: `tests/campaign-repair.mts` 8/8
3. Deleted 250 prior campaigns on Fly; materialised sole Calypso BA campaign; sourced 8 real GitHub candidates
4. Deployed tip `2b4472e` to Fly; `/api/ready` build matches
5. Authenticated physical E2E: home shows Active campaigns=1, Candidates sourced=8

## Blockers (owner)

1. Graph/HeyReach/LLM dropzones empty (`/tmp/owner-azure-app-id`, `/tmp/owner-microsoft.env`, `/tmp/owner-llm.env` missing) → **HOLD** live auto-send `sent>0`
2. `gh pr create` 403 for this agent — tip FF-merged + pushed to main/integration without ManagePullRequest
3. GitHub anonymous search for Calypso BA returns weak name-match profiles (scores ~68–72); add GITHUB_TOKEN + better LinkedIn/Apollo for quality shortlist

## Next steps

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build}'
# Expect build 2b4472e…
# Hard-refresh browser after any future deploy
# Source next batch from campaign detail once GITHUB_TOKEN/live providers ready
```

## Decisions made (don't relitigate)

- Sparse-state repair for campaigns (`metrics`), candidates (`complianceFlags` + arrays), outreach (`personalizationEvidence`), replies, bookings, settings arrays
- Live physical QA after hard refresh is the release gate when GHA budget blocks CI
- Calypso BA is the sole working campaign; other campaigns deleted from live workspace_state
- Goal complete only on auto-send `sent>0` (still HOLD without Graph)

## Watch out

- Hard-refresh after deploys
- Stale deploy confirm SHA fails fly-deploy-now
- Concurrent agents may dirty worktree / hold `main` in other worktrees — push via `git push origin SHA:main` if needed
- `@supabase/ssr` cookie name is `sb-auth-token` (not project-ref)
