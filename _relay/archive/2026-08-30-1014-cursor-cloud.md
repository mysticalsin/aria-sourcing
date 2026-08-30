---
project: MSourcing / ARIA
shift: 62
agent: codex
updated: 2026-07-29 13:37 America/Toronto
status: rock-7-linkedin-adapter-source-proof-green-db-build-blocked
---

# Handoff - Shift 62

## Current state

- Rock 7 LinkedIn channel source work is implemented in the working tree.
- `sequences_enabled` remains false by default. No switchboard enablement was changed.
- Existing Email and WhatsApp never-auto-send trigger migrations were not edited:
  - `supabase/migrations/0013_outreach_approval_race_safety.sql`
  - `supabase/migrations/0039_email_channel_durability.sql`
  - `supabase/migrations/0011_outreach_approval_lifecycle.sql`
- New migration is additive: `supabase/migrations/0054_linkedin_channel_adapter_authority.sql`.
- No new public tables or columns were added.
- New public functions added:
  - `public.enforce_active_linkedin_approval()`
  - `public.claim_linkedin_outbound_queued(uuid)`
  - `public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text)`
- New runtime module: `src/lib/linkedin-channel.ts`.
- `AgentSeat` provider labels now include `LinkedIn Assisted Manual` and `LinkedIn Vendor API`.
- Graphify remained unavailable:
  - `graphify query "MSourcing Rock 7 LinkedIn adapter approval dispatch outbound ledger cross-channel cap" --budget 1500` failed with `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.

## Done this shift

- Added one LinkedIn adapter interface with two backends:
  - `assisted-manual`: returns an approved draft/profile deep-link outcome for operator copy/paste/send.
  - `vendor-api`: wired to env credentials and fails closed while `LINKEDIN_VENDOR_API_URL` / `LINKEDIN_VENDOR_API_KEY` are absent.
- Patched `src/lib/dispatch-outbound.ts` so LinkedIn:
  - clears existing loop controls, approval hash, human-likeness, disclosure, and injection gates before channel handling.
  - resolves a LinkedIn adapter from the live seat provider.
  - blocks vendor-api as `linkedin-provider-unconfigured` before claim or transport when credentials are absent.
  - calls `claim_linkedin_outbound_queued` before any backend delivery.
  - records accepted assisted-manual/vendor outcomes through `record_linkedin_delivery_outcome`.
- Added `0054` LinkedIn authority:
  - separate `enforce_active_linkedin_approval()` trigger, channel-guarded to LinkedIn only.
  - service-only `claim_linkedin_outbound_queued(uuid)` that rechecks exact human approval, LinkedIn scope hash, suppression, 90-day contact window, active seat cap, ledger insert, and queued -> dispatching.
  - service-only `record_linkedin_delivery_outcome(...)` that reconciles the shared ledger.
- Extended cross-channel cap DB harness:
  - added LinkedIn claim helper.
  - asserts an existing Email contact blocks LinkedIn recontact.
  - asserts an Email-consumed seat cap blocks a different LinkedIn candidate on the same seat.
  - extends claim privilege checks to LinkedIn.
- Added/updated source tests:
  - `tests/linkedin-channel-contract.mts`
  - `tests/dispatch-outbound.mts`
  - `tests/email-durability-contract.mts`
  - `tests/cross-channel-cap-postgres.sh`
  - `tests/db/function-privileges.sql`
  - `tests/test-manifest.mjs`
  - `tests/test-manifest-contract.mts`
  - `docker/bootstrap/legacy-baseline-invariants.sql`
- Updated provider maps:
  - `src/lib/types.ts`
  - `src/lib/fleet.ts`
  - `src/components/fleet/seat-card.tsx`
- Added project-local learning to `_agent_state/codex/memory.json`.

## Verification

Passed:

- `npm run typecheck` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `./node_modules/.bin/tsc --noEmit --incremental false` -> exit 0.
- `./node_modules/.bin/tsc -p tsconfig.tests.json --pretty false --incremental false` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `node --import tsx tests/linkedin-channel-contract.mts` -> `RESULT linkedin-channel-contract: 14 passed, 0 failed`.
- `node --import tsx tests/dispatch-outbound.mts` -> `RESULT dispatch-outbound: 106 passed, 0 failed`.
- `node --import tsx tests/email-durability-contract.mts` -> `RESULT email-durability-contract: 33 passed, 0 failed`.
- `node --import tsx tests/test-manifest-contract.mts` -> 8 subtests, 7 pass, 1 npm-lifecycle skip, 0 fail.
- `node --import tsx tests/function-privileges-contract.mts` -> `RESULT function-privileges-contract: 21 passed, 0 failed`.
- `node --import tsx tests/cross-channel-cap-contract.mts` -> `RESULT cross-channel-cap-contract: 14 passed, 0 failed`.
- `node --import tsx tests/fleet.mts` -> `RESULT fleet: 43 passed, 0 failed`.
- `git diff --check` -> exit 0.
- `git diff --name-only -- supabase/migrations/0013_outreach_approval_race_safety.sql supabase/migrations/0039_email_channel_durability.sql supabase/migrations/0011_outreach_approval_lifecycle.sql` -> no output.

Blocked by local sandbox:

- `npm run test:all` failed in `tests/apollo-cleanup-worker.mts` with:
  `listen EPERM: operation not permitted 127.0.0.1`
- `npm run test:database` failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `bash tests/cross-channel-cap-postgres.sh` failed with:
  `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`
- `npm run test:manifest` failed with:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/58454.pipe`
- `./node_modules/.bin/tsx tests/linkedin-channel-contract.mts` and `./node_modules/.bin/tsx tests/dispatch-outbound.mts` failed with the same TSX IPC class:
  `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/<pipe>.pipe`
- `npm run build` failed with:
  `Error [TurbopackInternalError]: [project]/src/styles/globals.css [app-client] (css)`
  caused by:
  `creating new process`
  `binding to a port`
  `Operation not permitted (os error 1)`

## Blockers

1. Docker/Colima socket access is denied, so the real Postgres migration proof and extended LinkedIn cross-channel cap assertions could not execute in this sandbox.
2. Loopback listeners are denied, so `npm run test:all` stops at the Apollo cleanup redirect test before reaching later groups.
3. TSX CLI IPC pipe listeners are denied, so `npm run test:manifest` and direct `./node_modules/.bin/tsx ...` invocations cannot run here. `node --import tsx ...` alternatives passed for focused tests.
4. Turbopack process/port creation is denied, so `npm run build` cannot complete here.

## Next steps

1. In a Docker-enabled environment, run:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Specifically confirm `tests/cross-channel-cap-postgres.sh` prints:
   `RESULT cross-channel-cap-postgres: concurrent_claims=1 active_claims=1 ambiguous=blocked linkedin=blocked deadlock=none privileges=service-only`
3. Dump-diff reviewed schema controls because new public functions were added:
   - `public.enforce_active_linkedin_approval()`
   - `public.claim_linkedin_outbound_queued(uuid)`
   - `public.record_linkedin_delivery_outcome(uuid, uuid, text, text, text)`
4. Commit intended files only after Docker/live proof passes or the Owner accepts the local sandbox blocker boundary.

## Decisions made (don't relitigate)

- Keep Email and WhatsApp trigger functions untouched; LinkedIn has its own separate channel-guarded trigger.
- Do not add a LinkedIn account fleet, captured session, proxy, scraper, or first-party LinkedIn automation.
- Vendor-api is wired but dark without credentials; no fallback to assisted-manual when vendor credentials are absent.
- Assisted-manual and vendor-api share one adapter interface and the same DB claim path before delivery.
- No new tables or columns were needed; `docker/bootstrap/legacy-table-inventory.txt` stays unchanged.
- `sequences_enabled` stays false.

## Watch out

- The `tsx` binary fails in this sandbox, but `node --import tsx` focused tests pass. Do not treat the TSX IPC error as an application failure without rerunning outside the sandbox.
- The extended cross-channel cap SQL has not executed here because Docker is denied.
- `tests/test-manifest-contract.mts` frozen counts changed only because one application test command was added: application 148 -> 149, all 201 -> 202.
- `src/lib/types.ts` provider additions require exhaustive maps to stay aligned.
