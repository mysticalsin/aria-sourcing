---
project: MSourcing / ARIA
shift: 57
agent: codex
updated: 2026-07-26 03:44 America/Toronto
status: shortlist-human-approval-door-local-focused-green-full-gate-blocked-by-sandbox
---

# Handoff - Shift 57

## Current state

- Branch: `integration/sourcing-enrichment-on-main`.
- No git commit was created in this shift.
- Graphify remains unavailable in this checkout:
  - `graphify query "MSourcing shortlist approval draft_generate PIPELINE_STAGE_TRANSITIONS sourcing_loop_stage_enabled enqueue_aria_job"` failed with:
    `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.
- The shortlist gate now has a human approval door:
  - `POST /api/shortlist/approve` accepts only same-origin JSON.
  - It requires `requireAdmin`.
  - It resolves `current_workspace_id` and actor server-side.
  - It trusts only request candidate ids, then validates each candidate against `public.candidates` in the resolved workspace before enqueueing.
  - It calls `enqueue_aria_job` for `draft_generate`, so `sourcing_loop_stage_enabled` and idempotency still govern the enqueue.
- `sequences_enabled` remains false in product paths. No send path was added or enabled.
- The existing hash-keyed `outreach_approvals` gate before sending was not changed.
- No provider egress path was changed or added.
- No public SQL function was added or changed in this shift. Only comments were restored in `0051`.

## Done this shift

- Added `src/app/api/shortlist/approve/route.ts`.
  - Human admin approval route for shortlisted candidates.
  - Request boundary runs before auth, parsing, service client access, or mutation.
  - Body schema is `{ candidateIds: string[] }`; no workspace id or campaign id is accepted from the client.
  - Candidate rows are resolved from `public.candidates` by server-resolved workspace.
  - Each valid approval enqueues one `draft_generate` job with idempotency key `draft:<campaign_id>:<candidate_id>`.
  - Payload contains `campaignId`, `candidateId`, `approvedBy`, and `approvalSource: "human"` only.
- Updated `scripts/sourcing-loop-worker.mjs`.
  - Added `PIPELINE_STAGE_TRANSITION_PRODUCERS`.
  - Added `assertDeclaredTransitionProducers`.
  - Added real producer paths for the declared edges that were still dead:
    - `requisition_parse -> campaign_create`
    - `enrich_candidate -> shortlist_build` when an enriched candidate record is present
    - `delivery_reconcile -> outcome_feedback`
  - Kept `shortlist_build` itself from auto-enqueueing `draft_generate`; the new human route is the producer for that edge.
- Added `tests/shortlist-approval-route.mts`.
  - Proves authenticated approval writes exactly one fake `aria_jobs` row per approved candidate.
  - Proves duplicate submission replays without adding rows.
  - Proves no row for unauthenticated caller, other-workspace candidate, cross-origin request, and disabled `draft_generate` switchboard.
- Updated `tests/sourcing-loop-worker.mts`.
  - Structural assertion now fails if a declared transition lacks a producer.
  - Negative assertion simulates a future declared edge with no producer.
  - Added handler proof for `campaign_create`, `shortlist_build` via enrichment, and `outcome_feedback` successors.
- Registered `shortlist-approval-route` in `tests/test-manifest.mjs` and updated the additive manifest fingerprint in `tests/test-manifest-contract.mts`.
- Restored security-relevant comments in `supabase/migrations/0051_metered_provider_run_authority.sql` around `claim_enrichment_budget` idempotency drift.
- Archived previous baton:
  - `_relay/archive/2026-07-26-0344-codex.md`

## Verification

Passed:

- `graphify query "MSourcing shortlist approval draft_generate PIPELINE_STAGE_TRANSITIONS sourcing_loop_stage_enabled enqueue_aria_job"` attempted first; blocked because graph file is absent.
- `node --experimental-test-module-mocks --import tsx --test tests/shortlist-approval-route.mts` -> 5 passed, 0 failed.
- `node --import tsx --test tests/sourcing-loop-worker.mts` -> 15 passed, 0 failed.
- `node --check scripts/sourcing-loop-worker.mjs` -> exit 0.
- `node --import tsx tests/test-manifest-contract.mts` -> 7 passed, 0 failed, 1 skipped.
- `./node_modules/.bin/tsc --noEmit --incremental false` -> exit 0.
- `./node_modules/.bin/tsc -p tsconfig.tests.json --pretty false --incremental false` -> exit 0.
- `npm run typecheck` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `git diff --check` -> exit 0.

Blocked by local sandbox:

- `npm run test:manifest` failed before tests with:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/70059.pipe`
- `npm run test:all` failed in `tests/apollo-cleanup-worker.mts` with:
  `error: 'listen EPERM: operation not permitted 127.0.0.1'`
- `npm run test:database` failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `npm run build` failed with:
  `TurbopackInternalError: [project]/src/styles/globals.css [app-client] (css)`
  caused by:
  `creating new process`
  `binding to a port`
  `Operation not permitted (os error 1)`

## Blockers

1. Full lifecycle tests that open loopback listeners cannot complete in this sandbox.
2. Database tests cannot execute locally because Docker/Colima socket access is denied.
3. `npm run test:manifest` cannot complete through the `tsx` CLI because its IPC pipe listener is denied, although `node --import tsx tests/test-manifest-contract.mts` passes.
4. `npm run build` cannot complete because Turbopack attempts a denied process or port operation.

## Next steps

1. Visionary should run:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Visionary should inspect the route contract for the human gate:
   - same-origin JSON boundary first,
   - `requireAdmin`,
   - server-resolved `current_workspace_id`,
   - no client workspace or campaign id,
   - `enqueue_aria_job` for `draft_generate`.
3. Visionary should run database-backed approval proof if desired by seeding `public.candidates`, approving through `/api/shortlist/approve`, and reading back `public.aria_jobs`.
4. Commit intended files only.

## Decisions made (don't relitigate)

- `shortlist_build` remains a human gate and still does not auto-advance to drafts.
- `POST /api/shortlist/approve` is the code path that fires `shortlist_build -> draft_generate`.
- `enqueue_aria_job` remains the enqueue authority for switchboard and idempotency.
- The route does not accept workspace id or campaign id from the client.
- `approvedBy` is a server-resolved authenticated user id, not a system actor.
- `sequences_enabled` stays false and no delivery path is added.

## Watch out

- Do not treat the local Docker, TSX IPC, loopback, or Turbopack sandbox failures as code proof failures without rerunning in the Visionary environment.
- Do not add a second provider egress path in scripts.
- Do not log candidate PII from approval or draft payloads.
- Do not enable sequence send paths while working this rock.
