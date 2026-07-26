---
project: MSourcing / ARIA
shift: 56
agent: codex
updated: 2026-07-26 03:12 America/Toronto
status: rock-4-metered-apify-provider-run-local-focused-green-full-gate-blocked-by-sandbox
---

# Handoff - Shift 56

## Current state

- Branch: `integration/sourcing-enrichment-on-main`.
- No git commit was created in this shift.
- Graphify remains unavailable in this checkout:
  - `graphify query "MSourcing Rock 4 Apify persisted provider run sourcing caps enrichment budget shortlist_build"` failed with:
    `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.
- Rock 4 source work is in the working tree and not pushed.
- `sequences_enabled` remains false in product paths. No send path was added or enabled.
- The shortlist remains a human gate: `shortlist_build` now commits candidates but does not enqueue `draft_generate`.

## Done this shift

- Added `supabase/migrations/0051_metered_provider_run_authority.sql`.
  - Alters `sourcing_provider_runs` with nullable `dataset_id`.
  - Replaces `begin_provider_run(uuid,text,text,text)` so it:
    - resolves idempotent duplicates before quota consumption,
    - inserts and locks `sourcing_run_quota(workspace,current_date,'workspace')`,
    - refuses killed or `sourcing_enabled=false` workspaces,
    - counts current-day persisted provider runs only after the row lock,
    - refuses `sourcing_run_quota_exceeded`,
    - inserts the durable provider run and updates the quota counter.
  - Adds service-only `attach_provider_run(uuid,text,text)`.
  - Adds service-only `settle_provider_run_by_external(uuid,text,text,boolean)`.
  - Adds service-only `read_provider_run_for_loop(uuid,uuid)`.
  - Replaces `claim_enrichment_budget(uuid,text,text,integer,text)` to preserve the existing budget-row lock and also refuse killed or `enrichment_enabled=false` workspaces and daily `max_enrichment_units_per_day` overflow.
- Updated Apify start/status routes.
  - `/api/source/apify/start` now reserves a durable provider run before calling Apify, starts Apify through the existing clearance-bearing adapter, attaches the real `runId` and `datasetId`, enqueues `provider_poll`, and returns `providerRunId`.
  - If the durable run authority refuses, Apify is not called.
  - If Apify accepts but the loop poll job cannot be enqueued, the route fails visibly.
  - `/api/source/apify/status` settles the durable run by external run id on success or terminal failure.
- Added `src/app/api/cron/poll-provider-run/route.ts`.
  - Machine-only `CRON_SECRET` route, rejects browser cookies and origins.
  - Reads persisted provider run through `read_provider_run_for_loop`.
  - Polls Apify through `getRunStatus` and `fetchDatasetItems`, preserving `sourcingFetch` and policy clearance.
  - Maps dataset items to candidates and settles the provider run.
- Updated `scripts/sourcing-loop-worker.mjs`.
  - Adds provider poll URL wiring from `ARIA_WEB_INTERNAL_URL`.
  - `sourcing_batch` enqueues `shortlist_build` when candidate records exist.
  - `provider_poll` calls the cron poll route, retries while processing, completes failed terminal runs without successors, and enqueues `shortlist_build` on completed candidates.
  - `shortlist_build` no longer auto-enqueues `draft_generate`.
- Updated enrichment orchestration.
  - Claims enrichment budget before provider runner invocation.
  - Settles claims for `ok` and `no_data`.
  - Releases claims for error, not-configured, no-key-field, budget/time skips, and other non-success paths.
- Updated proof surfaces:
  - `tests/source-apify-auth.mts`
  - `tests/enrichment-orchestrator.mts`
  - `tests/sourcing-loop-worker.mts`
  - `tests/loop-jobs-db.sh`
  - `tests/db/function-privileges.sql`
  - `docker/bootstrap/legacy-baseline-invariants.sql`

## Verification

Passed:

- `next typegen` -> exit 0.
- `./node_modules/.bin/tsc --noEmit --incremental false` -> exit 0.
- `npm run typecheck` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `node --check scripts/sourcing-loop-worker.mjs` -> exit 0.
- `bash -n tests/loop-jobs-db.sh` -> exit 0.
- `node --experimental-test-module-mocks --import tsx tests/source-apify-auth.mts` -> `RESULT source-apify-auth: 20 passed, 0 failed`.
- `node --experimental-test-module-mocks --import tsx tests/enrichment-orchestrator.mts` -> `RESULT enrichment-orchestrator: 56 passed, 0 failed`.
- `node --import tsx --test tests/sourcing-loop-worker.mts` -> 11 passed, 0 failed.
- `node --import tsx --test tests/sourcing-provider-egress-structure.mts` -> 4 passed, 0 failed.
- `node --import tsx tests/test-manifest-contract.mts` -> 7 passed, 0 failed, 1 skipped.
- `git diff --check` -> exit 0.

Blocked by local sandbox:

- `npm run test:all` failed in `tests/apollo-cleanup-worker.mts` with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:database` failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `bash tests/loop-jobs-db.sh` failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `npm run test:manifest` failed before tests with:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/29870.pipe`
- `npm run build` failed with:
  `TurbopackInternalError: [project]/src/styles/globals.css [app-client] (css)`
  caused by:
  `creating new process`
  `binding to a port`
  `Operation not permitted (os error 1)`

## Blockers

1. Full application tests that open loopback listeners cannot complete in this sandbox.
2. Database tests and the disposable cap race assertions cannot execute locally because Docker/Colima socket access is denied.
3. `npm run test:manifest` cannot complete through the `tsx` CLI because its IPC pipe listener is denied, although `node --import tsx tests/test-manifest-contract.mts` passes.
4. `npm run build` cannot complete because Turbopack attempts a denied process or port operation.

## Next steps

1. Visionary should run:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Visionary should run `bash tests/loop-jobs-db.sh` in Docker-capable environment to prove:
   - provider run cap at limit refuses,
   - enrichment unit cap at limit refuses,
   - provider run cap cannot be raced one below limit,
   - enrichment unit cap cannot be raced one below limit.
3. Visionary should regenerate and review `docker/bootstrap/legacy-baseline-public-schema.sha256` after applying migration `0051`.
4. Review public schema deltas:
   - altered `begin_provider_run(uuid,text,text,text)`
   - altered `claim_enrichment_budget(uuid,text,text,integer,text)`
   - added `attach_provider_run(uuid,text,text)`
   - added `settle_provider_run_by_external(uuid,text,text,boolean)`
   - added `read_provider_run_for_loop(uuid,uuid)`
   - added nullable `sourcing_provider_runs.dataset_id`
5. Commit the intended Rock 4 files plus this handoff archive.

## Decisions made (don't relitigate)

- `sourcing_run_quota` is reused as the daily provider-run lock row because its shape already matches workspace/date/scope quota locking.
- The worker does not import TS provider adapters directly; production only copies the `.mjs` worker. Provider polling stays in the Next server through a cron-only route that uses the existing clearance-bearing adapter.
- `shortlist_build` is a human gate and must not auto-advance to drafts.
- `sequences_enabled` stays false and no delivery path is added.

## Watch out

- Do not treat the local Docker, TSX IPC, loopback, or Turbopack sandbox failures as code proof failures without rerunning in the Visionary environment.
- Do not add a second provider egress path in scripts.
- Do not log candidate PII from provider poll results.
- Do not enable sequence send paths while working this rock.
