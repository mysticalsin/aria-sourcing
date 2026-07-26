---
project: MSourcing / ARIA
shift: 54
agent: codex
updated: 2026-07-25 23:42 America/Toronto
status: rock-1-loop-release-verifier-fixed-local-proof-green-full-gate-blocked-by-sandbox
---

# Handoff - Shift 54

## Current state

- Branch: `integration/sourcing-enrichment-on-main`.
- No git commit was created in this shift.
- `sequences_enabled` was not changed.
- No Fly schedule, cron, or `ARIA_LOOP_KILL_SWITCH` change was added.
- Migrations were not touched.
- Graphify remains unavailable in this checkout:
  - `graphify query "MSourcing apollo cleanup release verifier process groups loop machine digest rogue group docs sourcing discovery fields" --budget 1200` failed with:
    `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.
- Pre-existing untracked file before this shift remains untouched:
  `_relay/2026-07-25-enterprise-readiness-audit-f5f1e47.md`.

## Done this shift

- Fixed the protected release verifier to admit Rock 1's declared `loop` process group.
  - `scripts/verify-apollo-cleanup-release.mjs` now includes `loop` in `PROCESS_GROUPS`.
  - The `groups` bucket now includes `loop: []`.
  - The existing unknown-group refusal remains in place for undeclared groups.
  - The existing duplicate-machine-id, image digest, started-web, cleanup active/standby, and framework-heartbeat active/standby checks were not relaxed.
- Chosen loop state discipline:
  - The verifier requires the `loop` process group to exist and relies on the existing per-machine digest check to prove it is deployed at the accepted image.
  - It does not require cleanup/framework active/standby shape for `loop`, because `scripts/sourcing-loop-worker.mjs` fails closed unless `ARIA_LOOP_KILL_SWITCH` is exactly `"false"`, so a dark loop machine may be stopped, exited, or otherwise not active/standby paired.
  - The receipt shape still returns `cleanupMachineId` and `frameworkHeartbeatMachineId`; no existing key was renamed or removed.
- Added verifier proof in `tests/apollo-cleanup-worker.mts`.
  - A correctly digested `loop` machine is accepted.
  - A missing `loop` group is rejected with `loop process group has no machine`.
  - A `rogue` process group is rejected with `unexpected Fly application process group`.
- Updated `tests/deploy-contract.mts` fake Fly machine inventory to include the declared `loop` machine at the same digest.
- Corrected `docs/SOURCING.md` discrimination-proxy wording.
  - Discovery fields are described as protected-class screened.
  - Name fields are described as still screened for control characters, injection, and length.
  - The `ProviderClearance` and source-file pins remain.
- Updated `tests/docs-truth.mts` to pin the corrected docs wording while keeping both existing negative clauses.

## Verification

Passed:

- `npm run typecheck` -> exit 0.
- `./node_modules/.bin/tsc --noEmit --incremental false` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `node --import tsx --test --test-name-pattern "release acceptance binds one started cleanup process" tests/apollo-cleanup-worker.mts` -> 1 passed, 0 failed.
- `node --import tsx tests/deploy-contract.mts` -> `RESULT deploy-contract: 136 passed, 0 failed`.
- `node --import tsx tests/docs-truth.mts` -> `RESULT docs-truth: 46 passed, 0 failed`.
- `node --import tsx tests/test-manifest-contract.mts` -> 7 passed, 0 failed, 1 skipped.
- `git diff --check` -> exit 0.

Mutation proof:

- Temporarily removed the `!PROCESS_GROUPS.includes(group)` refusal and reran:
  `node --import tsx --test --test-name-pattern "release acceptance binds one started cleanup process" tests/apollo-cleanup-worker.mts`
- Expected failure was observed:
  `The input did not match the regular expression /unexpected Fly application process group/. Input: "TypeError: Cannot read properties of undefined (reading 'push')"`
- The refusal was restored and the named verifier test passed again.

Blocked by local sandbox:

- `node --import tsx tests/apollo-cleanup-worker.mts` -> failed in the existing redirect-listener test with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:all` -> failed in `tests/apollo-cleanup-worker.mts` with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:database` -> failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `npm run test:manifest` -> failed before tests with:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/89306.pipe`
- `npm run build` -> failed with:
  `TurbopackInternalError: [project]/src/styles/globals.css [app-client] (css)`
  caused by:
  `creating new process`
  `binding to a port`
  `Operation not permitted (os error 1)`

## Blockers

1. Full `test:all` cannot complete in this sandbox because loopback listeners are denied.
2. Full `test:database` cannot complete in this sandbox because Docker/Colima socket access is denied.
3. `npm run test:manifest` cannot complete through the `tsx` CLI in this sandbox because its IPC pipe listener is denied.
4. `npm run build` cannot complete in this sandbox because Turbopack tries to bind a port while processing `src/styles/globals.css`.

## Next steps

1. Visionary should run the full gate in an environment with loopback, Docker, tsx IPC, and Turbopack process permissions:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Review and commit the intended files:
   - `scripts/verify-apollo-cleanup-release.mjs`
   - `tests/apollo-cleanup-worker.mts`
   - `tests/deploy-contract.mts`
   - `docs/SOURCING.md`
   - `tests/docs-truth.mts`
   - `_relay/HANDOFF.md`
   - `_relay/archive/2026-07-25-2342-codex.md`
3. Decide separately whether and when to enable the loop worker by setting `ARIA_LOOP_KILL_SWITCH=false`. This shift intentionally kept it dark.

## Decisions made (don't relitigate)

- `loop` is a declared Fly process group and must be admitted by the release verifier.
- Unknown Fly process groups still fail with `unexpected Fly application process group`.
- Every machine in every admitted process group must still match the expected image digest.
- `cleanup` and `framework_heartbeat` keep the active/standby contract.
- `loop` only needs presence plus matching digest while the worker remains fail-closed by kill switch.
- The release receipt keeps `cleanupMachineId` and `frameworkHeartbeatMachineId` for `deploy-fly.sh`.
- Discovery fields, not name fields, receive protected-class proxy screening in the sourcing docs.

## Watch out

- Do not add `ARIA_LOOP_KILL_SWITCH=false`, a Fly cron, or a schedule as part of this verifier fix.
- Do not remove the `loop` bucket while keeping `loop` in `PROCESS_GROUPS`; that turns accepted loop machines into an undefined push failure.
- The pre-existing untracked relay audit file is not part of this shift's code changes.
