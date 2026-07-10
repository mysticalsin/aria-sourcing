---
project: MSourcing / ARIA
shift: 21
agent: claude-opus-4-8
updated: 2026-07-10 13:06 EDT
status: w5-gate-closed-full-gate-green-engagement-complete
---

# Handoff — W5 closeout (Claude, shift 21)

## Closeout this session
- Closed the last open rock, **Rock W5 (Gate + wiring)**. The `tests/docs-truth.mts`
  suite was orphaned: present on disk but untracked and absent from the `npm test`
  chain, so it enforced nothing.
- Wired `docs-truth.mts` into the chain as the 98th suite command and committed the
  config/docs it asserts (`.env.local.example` gained `TAVILY_API_KEY`; `STATUS.md`
  is now tracked). Bumped the suite count 97→98 in both `STATUS.md` and the
  docs-truth assertion so they stay coupled.
- Full gate green, verified in this session (not diff-read):
  - `npx tsc --noEmit` → No errors.
  - Full `npm test` chain (pretest+test), run with the sandbox `tsx`→`node --import tsx`
    rewrite → 98 suite commands, every `RESULT … 0 failed`, chain exit 0
    (`docs-truth: 11 passed, 0 failed`).
  - `npx eslint .` → No issues found.
- Committed on `main` (matching the whole engagement; not pushed):
  - `05f50f4` test: gate-enforce docs/config truth via docs-truth.mts (closes W5)
  - `f4203e5` chore: release-ops hygiene — ignore fly secrets, add Vercel go-live doc
  - plus this receipts commit (briefs r1–r4, codex logs, relay archive + this baton).
- Left unstaged as unrelated scratch: `Aria/` (brand PNGs), `_agent_state/`,
  `graphify-out/`, and the `.claude/scheduled_tasks.lock` deletion.

## Note on the sandbox
- Bare `tsx <file>` still fails here with `listen EPERM … tsx-501/<pid>.pipe`
  (tsx IPC server blocked by the sandbox). `node --import tsx <file>` is the
  equivalent that runs. `package.json` keeps the bare-`tsx` form because the owner
  environment runs it fine; only local verification used the rewrite.

---

# (Prior baton) Handoff - R4 Store Split

## Current state
- Release Rock R4 store split is implemented in the working tree.
- `src/lib/store.ts` still owns `HermesActions`, `HermesProvider`, the 132 `useCallback` actions, context, and hooks.
- Four React-free modules now exist under `src/lib/store/`:
  - `booking-slot.ts`
  - `migrations.ts`
  - `sourcing-helpers.ts`
  - `winlog-derive.ts`
- `src/lib/store.ts` imports from those modules and re-exports moved public symbols from the store barrel:
  - `appendWinRecord`
  - `deriveWinRecord`
  - `WIN_RECORD_LIMIT`
  - `migrateToCurrentVersion`
  - `normalizeHermesState`
  - `defaultSlot`
  - `interviewerIsBusy`
  - `resolveBookingSlot`
- Consumer import paths were not changed.
- Baseline `src/lib/store.ts` line count before R4: 6,959.
- Current `src/lib/store.ts` line count after R4: 6,555.

## Done this shift
- Ran mandatory graphify navigation first. It failed because `graphify-out/graph.json` is absent.
- Checked `graphify-out/wiki/index.md`. It is absent, so raw source inspection was used after graph/wiki miss.
- Confirmed tests import moved public symbols through `../src/lib/store` or `../src/lib/store.ts`, not direct submodules:
  - `tests/winlog.mts`
  - `tests/memory-soul.mts`
- Extracted sourcing helpers:
  - `baseWebQuery`
  - `parseSillageIdentifier`
  - `mapSillageCandidates`
- Extracted winlog derivation:
  - `WIN_RECORD_LIMIT`
  - `deriveWinRecord`
  - `appendWinRecord`
- Extracted migration/load helpers:
  - `migrateToCurrentVersion`
  - `normalizeHermesState`
  - `loadState`
- Extracted booking solver:
  - `defaultSlot`
  - `interviewerIsBusy`
  - `resolveBookingSlot`
- Skipped `HermesActions` contract and hooks extraction for cycle-safety. They remain in `store.ts` beside `HermesContext` and `HermesProvider`.
- Archived previous baton to `_relay/archive/2026-07-10-1228-codex.md`.

## Blockers
- Literal `npm test` cannot run in this sandbox because the `tsx` CLI fails before executing tests:
  - `Error: listen EPERM: operation not permitted .../tsx-501/<pid>.pipe`
- Retrying with `TMPDIR=/private/tmp` produced the same `listen EPERM` pipe failure.
- This is a sandbox IPC/socket restriction, not a test assertion failure.

## Verification
- `npx tsc --noEmit` passed with exit 0.
- `npm test` attempted twice and failed before tests ran due to `tsx` IPC pipe `listen EPERM`.
- Equivalent full package gate passed by executing the same `pretest` + `test` command list with `node --import tsx` for commands that were `tsx <file>` and leaving existing `node --experimental-test-module-mocks --import tsx` commands unchanged:
  - `RESULT rewritten-full-test-gate: 97 commands passed`
  - `tests/winlog.mts`: `RESULT winlog: 22 passed, 0 failed`
  - `tests/memory-soul.mts`: `RESULT memory-soul: 39 passed, 0 failed`
  - `tests/audit-fixes.mts`: `RESULT audit-fixes: 46 passed, 0 failed`
- `git diff --check` passed with exit 0.
- `wc -l src/lib/store.ts src/lib/store/*.ts`:
  - `src/lib/store.ts`: 6,555
  - `src/lib/store/booking-slot.ts`: 87
  - `src/lib/store/migrations.ts`: 120
  - `src/lib/store/sourcing-helpers.ts`: 113
  - `src/lib/store/winlog-derive.ts`: 106

## Next steps
1. If running outside this sandbox, run literal `npm test` to confirm the `tsx` CLI path in the owner environment.
2. Commit only the R4 files and relay archive/handoff; leave unrelated pre-existing changes alone.

## Decisions made (don't relitigate)
- Keep all consumer imports on `@/lib/store` or existing relative store imports.
- Do not extract the 132 `useCallback` actions.
- Do not extract hooks or `HermesActions` in R4 because the cycle risk is not worth it.
- This rock is pure move plus re-export; no behavior changes or new tests.

## Watch out
- There are unrelated existing working-tree changes outside this R4 split, including env examples, `.rocket-fuel/`, `.agent_state/`, previous `_relay/archive/` files, `graphify-out/`, `production-readiness/STATUS.md`, and `tests/docs-truth.mts`.
- `git diff --name-only` only shows tracked changes; remember `src/lib/store/` is untracked until added.
