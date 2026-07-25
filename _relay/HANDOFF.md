---
project: MSourcing / ARIA
shift: 53
agent: codex
updated: 2026-07-25 19:10 America/Toronto
status: rock-2-structural-defects-fixed-local-proof-green-full-gate-blocked-by-sandbox
---

# Handoff - Shift 53

## Current state

- Branch: `integration/sourcing-enrichment-on-main`.
- No git commit was created in this shift.
- `sequences_enabled` was not changed and no send path was added.
- Candidate PII was not added to logs or prompts.
- Migrations were not touched.
- Graphify remains unavailable in this checkout:
  - `graphify query "Rock 2 sourcing provider egress module boundaries client-to-server server-only import cycle" --budget 1200` failed with:
    `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.
- `tests/module-boundaries.mts` now passes `2/2`.
- The repo's `client-to-server` boundary rule is transitive already:
  `findBoundaryViolations` builds `runtimeGraph` with `includeTypeOnly: false`, walks `reachableFrom(runtimeGraph, clientFile)`, and checks every reachable file with `isServerOnlyModule`.

## Done this shift

- Split Rock 2 transport from Rock 2 policy.
  - Added `src/lib/sourcing/provider-transport.ts` as the server-only leaf.
  - `provider-transport.ts` owns `import "server-only"`, `SOURCING_PROVIDER_HOSTS`, the `CLEARANCE` unique symbol, `ProviderClearance`, `mintProviderClearance`, and `sourcingFetch`.
  - Provider adapters now import only `provider-transport.ts` for `sourcingFetch` and `ProviderClearance`.
  - `src/lib/sourcing/provider-egress.ts` now keeps only the policy entry points: `clearDiscoveryCriteria`, `clearIdentityResolution`, and `clearProviderProbe`.
  - Structural test now allows `mintProviderClearance` to be imported only by `provider-egress.ts` and still rejects `as ProviderClearance` outside `provider-transport.ts`.
- Removed the client-to-server value edge from the store.
  - Added `src/lib/sourcing/github-identity.ts` for `GITHUB_USERNAME_RE` and the `GithubUser` type.
  - `src/lib/store/sourcing-actions.ts` imports from `github-identity.ts`, not from the provider-backed `github.ts`.
  - `src/lib/sourcing/github.ts` re-exports the identity surface for server-side compatibility.
- Fixed criteria classification without changing the prohibited regex.
  - `PROHIBITED_CRITERIA` remains byte-identical and was measured at 167 bytes.
  - Discovery fields keep the full protected-proxy check:
    `query`, `searchQuery`, `locations`, `currentJobTitles`, `pastJobTitles`, `currentCompanies`, `pastCompanies`, `schools`.
  - Name fields `firstNames` and `lastNames` are checked for control chars, injection, and length only.
  - Unknown fields fail into the stricter discovery treatment.
  - `clearIdentityResolution` now rejects `too_long`, closing the unbounded identity-value gap.
- Added Apify route regression proof.
  - `lastNames: ["Young"]` with role-bound `searchQuery: "language:Go"` is allowed.
  - `schools: ["Stanford University"]` with role-bound `searchQuery: "language:Go"` is refused with `Search query requires policy review.`
  - The provider mock remains uninvoked on the refused discovery-field case.
- Updated affected server-side tests to mock `server-only` before importing server-only chains.
  - `tests/hermes-runtime-isolation.mts`
  - `tests/enrichment-orchestrator.mts`
  - `tests/web-tavily-key.mts`
  - `tests/sourcing-agent.mts`
- Updated manifest command lines and frozen baselines for the suites that now require `--experimental-test-module-mocks`.

## Verification

Passed:

- `npm run typecheck` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `node --import tsx tests/module-boundaries.mts` -> 2 passed, 0 failed.
- `node --import tsx tests/sourcing-query-policy.mts` -> 2 passed, 0 failed.
- `node --experimental-test-module-mocks --import tsx --test tests/sourcing-provider-egress.mts` -> 1 passed, 0 failed.
- `node --import tsx tests/sourcing-provider-egress-structure.mts` -> 3 passed, 0 failed.
- `node --import tsx tests/test-manifest-contract.mts` -> 7 passed, 0 failed, 1 skipped.
- `node --experimental-test-module-mocks --import tsx tests/source-apify-auth.mts` -> `RESULT source-apify-auth: 16 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/hermes-runtime-isolation.mts` -> `RESULT hermes-runtime-isolation: 23 passed, 0 failed`.
- `node --import tsx tests/memory-soul.mts` -> `RESULT memory-soul: 39 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/enrichment-orchestrator.mts` -> `RESULT enrichment-orchestrator: 56 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/web-tavily-key.mts` -> `RESULT web-tavily-key: 24 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/sourcing-agent.mts` -> `RESULT sourcing-agent: 20 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/sourcing.mts` -> `RESULT sourcing: 51 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/apify-sourcing.mts` -> `RESULT apify-sourcing: 66 passed, 0 failed`.
- `node --import tsx tests/docs-truth.mts` -> `RESULT docs-truth: 46 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/source-demo-auth.mts` -> `RESULT source-demo-auth: 4 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/source-live-campaign-authority.mts` -> `RESULT source-live-campaign-authority: 5 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/apollo-enrichment-authority.mts` -> `RESULT apollo-enrichment-authority: 47 passed, 0 failed`.
- Regex invariant:
  `/\b(age|young|old|gender|male|female|race|ethnicity|religion|disabled|disability|pregnan|marital|nationality|native[- ]born|university|college|graduat(?:e|ed|ion))\b/i`
  measured at `167`.
- `git diff --check` -> exit 0.

Blocked by local sandbox:

- `npm run test:all` -> failed in `tests/apollo-cleanup-worker.mts` with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:database` -> failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `npm run test:manifest` -> failed before tests with:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/45993.pipe`
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

1. Visionary should run the full locked gate in an environment with loopback, Docker, tsx IPC, and Turbopack process permissions:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run build`.
2. If the full gate passes, review the intended Rock 2 diff and commit it.
3. Keep an eye on future provider adapter additions: they must import transport only and must not import `provider-egress.ts`.

## Decisions made (don't relitigate)

- `import "server-only"` stays on the provider transport module.
- The prohibited regex stays byte-identical at 167 bytes.
- `validateSourcingQuery` keeps its signature and behavior.
- `ProviderClearance` stays branded; structural tests reject clearance casts outside transport and reject mint-helper imports outside policy egress.
- `sourcingFetch` remains the only provider socket path inside the scanned provider surface.
- `schools` remains a strict discovery field and continues to refuse `University`.
- `sequences_enabled` stays false and no send path was added.

## Watch out

- `provider-transport.ts` intentionally exports `mintProviderClearance` so `provider-egress.ts` can mint after policy checks without reintroducing the import cycle. The structural scanner makes `provider-egress.ts` the only allowed importer of that helper.
- `memory-soul` no longer needs a `server-only` mock after the `github-identity.ts` split.
- Server-side suites that import route/tool/orchestrator chains need Node module mock mode:
  `node --experimental-test-module-mocks --import tsx ...`.
