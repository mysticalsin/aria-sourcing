---
project: MSourcing / ARIA
shift: 55
agent: codex
updated: 2026-07-26 00:58 America/Toronto
status: rock-3-switchboard-ignition-worker-proof-local-focused-green-full-gate-blocked-by-sandbox
---

# Handoff - Shift 55

## Current state

- Branch: `integration/sourcing-enrichment-on-main`.
- No git commit was created in this shift.
- Graphify remains unavailable in this checkout:
  - `graphify query "MSourcing sourcing loop Rock 3 switchboard ignition loop jobs dispatch outbound worker"` failed with:
    `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.
- The Rock 3 implementation is in the working tree and is not pushed.
- `sequences_enabled` is not enabled by any product path. The disposable database harness explicitly enables stages only inside its local test setup so existing declared-kind assertions can still exercise every kind.
- Reviewed-schema SQL metadata changed in `docker/bootstrap/legacy-baseline-invariants.sql`; `docker/bootstrap/legacy-baseline-public-schema.sha256` was not regenerated because the local database proof path is blocked by Docker socket denial.

## Done this shift

- Added `supabase/migrations/0050_loop_switchboard_ignition_authority.sql`.
  - Centralized the kind-to-stage mapping in `public.sourcing_loop_stage_enabled(uuid,text)`.
  - Replaced `public.enqueue_aria_job(...)` so enqueue refuses missing controls, `kill_switch=true`, and false mapped stage columns before writing.
  - Replaced `public.claim_due_aria_jobs(...)` so claim skips jobs whose workspace controls are missing, killed, or false for the mapped stage.
  - Preserved the service-role gate and 30-day `p_run_at` bound.
  - Added `public.read_inbound_email_for_loop(uuid,uuid)` so the worker can classify stored inbound messages without putting reply text into job payloads.
  - New security-definer functions pin `search_path`, gate on `auth.role() = 'service_role'`, and revoke broad grants.
- Added `src/app/api/cron/ignite-sourcing-loop/route.ts`.
  - Uses the existing `CRON_SECRET` bearer and constant-time compare pattern.
  - Rejects missing or malformed credentials, browser cookie sessions, browser `Origin`, and disabled or killed workspaces.
  - Enqueues an idempotent root `email_sync` job for enabled workspaces.
- Updated `src/lib/dispatch-outbound.ts`.
  - `dispatchDue` now reads `sourcing_loop_controls` and reaches no transport when a workspace is killed, missing controls, unreadable, or has `sequences_enabled=false`.
  - The hash-keyed `outreach_approvals` gate and never-auto-send path were not weakened.
- Updated `scripts/sourcing-loop-worker.mjs`.
  - Added a pre-handler `sourcing_loop_stage_enabled` recheck to close the in-flight disable window.
  - A disabled in-flight job is durably failed as nonretryable `stage_disabled`; the handler is not called.
  - Threaded `modelClient` through `runSourcingLoopForever()` and `main()`.
  - Added an OpenAI-compatible runtime model client when `OPENAI_API_KEY` is configured; otherwise the deterministic fallback remains and is surfaced in tick results.
  - `inbound_classify` can now classify a stored inbound message from its `inboundId` and persist the classification.
- Added or updated proof files:
  - `tests/sourcing-loop-ignition-route.mts`
  - `tests/sourcing-loop-worker.mts`
  - `tests/dispatch-outbound.mts`
  - `tests/loop-jobs-db.sh`
  - `tests/test-manifest.mjs`
  - `tests/test-manifest-contract.mts`
  - `tests/db/function-privileges.sql`
  - `docker/bootstrap/legacy-baseline-invariants.sql`

## Verification

Passed:

- `node --import tsx tests/dispatch-outbound.mts` -> `RESULT dispatch-outbound: 95 passed, 0 failed`.
- `node --import tsx --test tests/sourcing-loop-worker.mts` -> 9 passed, 0 failed.
- `node --experimental-test-module-mocks --import tsx --test tests/sourcing-loop-ignition-route.mts` -> 5 passed, 0 failed.
- `node --import tsx tests/test-manifest-contract.mts` -> 7 passed, 0 failed, 1 skipped.
- `./node_modules/.bin/tsc --noEmit --incremental false` -> exit 0.
- `npm run typecheck` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `git diff --check` -> exit 0.

Red-first proof observed before fixes:

- New dispatch switchboard tests initially failed because transport was still reached under killed or sequence-disabled controls.
- New worker chain tests initially failed with `reply_text_required`, no `stage_disabled` refusal, and zero model-client calls through `runSourcingLoopForever`.
- New ignition route tests initially failed with `ERR_MODULE_NOT_FOUND` because the machine surface did not exist.
- `bash tests/loop-jobs-db.sh` could not reach the red/green database assertions because Docker socket access is denied locally.

Blocked by local sandbox:

- `npm test` failed in `tests/apollo-cleanup-worker.mts` with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:all` failed in `tests/apollo-cleanup-worker.mts` with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:database` failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `npm run test:manifest` failed before tests with:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/24015.pipe`
- `npm run build` failed with:
  `TurbopackInternalError: [project]/src/styles/globals.css [app-client] (css)`
  caused by:
  `creating new process`
  `binding to a port`
  `Operation not permitted (os error 1)`

## Blockers

1. Full application test groups that open loopback listeners cannot complete in this sandbox.
2. Database tests and schema hash regeneration cannot complete because Docker/Colima socket access is denied.
3. `npm run test:manifest` cannot complete through the `tsx` CLI because its IPC pipe listener is denied, although `node --import tsx tests/test-manifest-contract.mts` passes.
4. `npm run build` cannot complete because Turbopack attempts a denied process or port operation.

## Next steps

1. Visionary should run:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Visionary should regenerate and review `docker/bootstrap/legacy-baseline-public-schema.sha256` after applying migration `0050`.
3. Review the new SQL function inventory deltas:
   - `sourcing_loop_stage_enabled(uuid,text)`
   - `read_inbound_email_for_loop(uuid,uuid)`
   - replaced `enqueue_aria_job(...)`
   - replaced `claim_due_aria_jobs(integer,integer,timestamptz,text[])`
4. Commit the intended Rock 3 files plus this handoff archive.

## Decisions made (don't relitigate)

- The binding kind-to-column map is implemented in one SQL helper and consumed by both enqueue and claim.
- Missing or unreadable `sourcing_loop_controls` is fail-closed.
- `dispatchDue` fails closed at the workspace controls boundary before provider transport.
- Ignition is a machine credential path only; browser cookies and browser origins are refused.
- The root ignition job is `email_sync` and uses a deterministic idempotency key.
- In-flight jobs are rechecked immediately before handler execution.
- Model fallback remains allowed, but the runtime path now threads the model client and exposes fallback use.

## Watch out

- Do not treat the local sandbox failures as proof failures in code without rerunning in a Docker and loopback-capable environment.
- Do not enable `sequences_enabled` outside disposable database test setup.
- Do not put inbound reply body into `aria_jobs` payloads or loop logs.
- Do not relax the hash-keyed `outreach_approvals` gate when reviewing dispatch changes.
