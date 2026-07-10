---
project: MSourcing / ARIA
shift: 19
agent: codex
updated: 2026-07-10 12:00
status: r3-docs-truth-tsc-clean
---

# Handoff - R3 Docs Truth + Deploy Story

## Current state
- Release Rock R3 docs consolidation is implemented in the working tree.
- `README.md` is now the truthful front door: Next `^16.2.6`, React `^19.2.7`, Node `22.x`, 97 `npm test` suite commands, current shipped surfaces, correct root-level `supabase/migrations/` and `tests/` architecture map, local Supabase startup, canonical deploy pointer, and MSourcing / ARIA / Hermes naming note.
- Root `DEPLOYMENT.md` is now only a short pointer to `production-readiness/DEPLOYMENT_RUNBOOK.md`, the `vercel-demo` variant, env examples, and `STATUS.md`.
- `production-readiness/DEPLOYMENT_RUNBOOK.md` is the only annotated migration list; it documents `0001` through `0018` and the deliberate missing `0016`.
- `SUPABASE_SETUP.md`, `production-readiness/DEPLOY_CHECKLIST.md`, and `production-readiness/LOCAL_SETUP.md` now say to apply every file in `supabase/migrations/` in order instead of freezing old ranges.
- `.env.local.example` and `.env.production.example` were regenerated around the env vars read under `src/`, plus provider-map keys such as `KIMI_API_KEY`; missing Tavily, Kimi, demo-session, encryption, cron, unsubscribe, and Google OAuth vars are included with purpose comments and no real secrets.
- `production-readiness/STATUS.md` exists and is dated 2026-07-10. It supersedes the old 2026-06-27 due-diligence snapshot.
- Historical production-readiness reports now carry a top supersession banner pointing to `STATUS.md` for current release posture.
- Added `tests/docs-truth.mts` with grep-based docs assertions.

## Done this shift
- Replaced stale README claims about Next 14 / React 18 and mock-only future APIs.
- Consolidated deploy docs around the canonical runbook and current status page.
- Removed stale migration-range guidance from current setup/checklist docs.
- Added the single current status page requested by Rock R3.
- Added supersession banners to old due-diligence report files instead of deleting evidence.
- Ran a Visionary-style README truth review with a subagent; it reported no README truth issues and did not edit files.
- Archived previous baton to `_relay/archive/2026-07-10-1200-codex.md`.

## Blockers
- No code blockers.
- `npm run lint` exits 0 but reports one warning in `src/lib/store.ts:4546` about an unnecessary `useCallback` dependency. This R3 task did not change code.
- `npm test` was not run in full this shift; R3 proof required the docs truth test plus TypeScript. The 97 count was verified from `package.json` (`pretest` 3 commands + `test` 94 commands).

## Verification
- `graphify query "MSourcing release Rock R3 docs README deployment env migrations status Next React tests Supabase" --budget 1500` failed because `graphify-out/graph.json` is absent.
- `graphify-out/wiki/index.md` is absent; raw files were used after graph/wiki miss.
- `node --import tsx tests/docs-truth.mts` passed: `RESULT docs-truth: 11 passed, 0 failed`.
- `npx tsc --noEmit` passed with exit 0.
- `npm run lint` passed with exit 0 and one warning in `src/lib/store.ts:4546`.
- `git diff --check` passed with exit 0.
- Targeted grep found no `Next.js 14`, `React 18`, `through 0005`, `through 0012`, or partial-apply migration claims in current docs: `README.md`, `DEPLOYMENT.md`, `SUPABASE_SETUP.md`, `DEPLOYMENT_RUNBOOK.md`, `DEPLOY_CHECKLIST.md`, `LOCAL_SETUP.md`, `STATUS.md`, and env examples.
- Visionary README review found no issues: versions, route surfaces, migration list, env examples, and deployment claims aligned with source files.

## Next steps
1. Commit R3 docs separately from unrelated existing untracked `.rocket-fuel/`, `Aria/`, `_agent_state/`, and `graphify-out/` content.
2. If desired, run full `npm test` outside the sandbox/with enough time before release sign-off.
3. Leave old due-diligence reports in place as historical evidence; use `STATUS.md` for current posture.

## Decisions made (don't relitigate)
- `production-readiness/DEPLOYMENT_RUNBOOK.md` is the canonical deployment runbook.
- `production-readiness/STATUS.md` is the dated current posture page for 2026-07-10.
- Historical due-diligence files are superseded, not deleted.
- Migration guidance outside the runbook must be directory-based: apply every file in `supabase/migrations/` in order.
- `0016` is intentionally absent; do not create or renumber it as a docs fix.

## Watch out
- Many production-readiness files changed only by a 3-line supersession banner.
- Existing unrelated untracked files remain:
  - `.rocket-fuel/`
  - `Aria/`
  - `_agent_state/`
  - `_relay/archive/2026-07-10-1138-codex.md`
  - `_relay/archive/2026-07-10-1146-codex.md`
  - `graphify-out/`
