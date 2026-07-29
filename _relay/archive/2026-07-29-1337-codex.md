---
project: MSourcing / ARIA
shift: 61
agent: codex
updated: 2026-07-28 20:35 America/Toronto
status: 0053-correlate-outcome-restored-sandbox-db-proof-blocked
---

# Handoff - Shift 61

## Current state

- Branch/worktree contains uncommitted sequence-engine authority migration `supabase/migrations/0053_sequence_engine_real_authority.sql` plus prior uncommitted Rock 5/Rock 6 support files.
- This shift restored the reply outcome recording that `0053` had dropped from `public.correlate_inbound_email(uuid,text)`.
- `sequences_enabled` remains false by default. No send path was added.
- Existing committed migration files stayed byte-identical in this shift. `0053` is still untracked/uncommitted.
- Graphify remains unavailable in this checkout:
  - `graphify query "MSourcing 0053 correlate_inbound_email outcome_recorded reply_received sequence linkage claim_and_record"` failed with `error: graph file not found: /Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/Chief of Staff/Apps Source/MSourcing/graphify-out/graph.json`
  - `graphify-out/wiki/index.md` is absent.

## Done this shift

- Patched `supabase/migrations/0053_sequence_engine_real_authority.sql` in place.
  - Added `outcome_result json`.
  - Restored the `public.record_candidate_outcome(inbound.workspace_id, ledger.candidate_id, 'reply_received', 'reply:' || inbound.id::text, inbound.id)` call before stamping the inbound.
  - Restored the `candidate-erased` branch so erased candidates are not stamped onto `messages_inbound`.
  - Kept `0053` sequence linkage on the normal correlated update: `sequence_id = ledger.sequence_id`, `sequence_step_id = ledger.sequence_step_id`.
  - Kept `0053` linkage and `campaign_id` in the returned JSON, and added `outcome_recorded`.
- Patched `tests/email-outcomes-db.sh`.
  - Left existing `correlate-records-reply-outcome` expectation as `true:true:1`.
  - Added `correlate-replay-does-not-duplicate-reply-outcome`, proving the same inbound re-correlation returns `already-processed` and keeps one `reply_received`.
- Patched `tests/sequence-engine-db.sh`.
  - Added `unified-inbox-populates-sequence-linkage`, proving both returned JSON and `messages_inbound` carry `sequence_id` and `sequence_step_id`.
- Compared replaced functions in `0053` against earlier authority migrations:
  - `claim_and_record`: latest prior definition in `0024_cross_channel_claim_serialization.sql`; inherited suppression, current workspace, seat lock, warmup cap, duplicate handling, and result vocabulary preserved. `0053` adds locked release of elapsed active rows before the existing recontact check.
  - `correlate_inbound_email`: latest prior definition in `0041_email_outcomes.sql`; inherited service gate, row lock, fail-closed no-header/no-match/ambiguous paths, already-processed early return, candidate-erased branch, and outcome recording now restored. `0053` additions retained.
  - `create_outreach_sequence`: prior definition in `0045_outreach_sequence_authority.sql`; service gate, step count bounds, max_touches clamp, step insertion, and response shape preserved; `0053` adds DAG metadata and validation.
  - `claim_sequence_step_for_schedule`: prior definition in `0045`; service gate, due-step lock, active-sequence check, sequence switchboard gate, live approval check, suppression refusal, scheduled transition, and returned scheduling payload preserved while `0053` adds identity suppression, exclusions, recontact release, seat controls, credits, refusal receipts, and daily caps.
  - `bind_sequence_step_outbound`: prior definition in `0045`; service gate, scheduled-step binding, `bound`/`not-bindable` result preserved while `0053` adds outbound and ledger sequence linkage.
  - `record_sequence_step_sent`, `promote_due_sequence_steps`, and `release_elapsed_outreach_contact_window` are new in `0053`, not replacements.

## Verification

Passed:

- `./node_modules/.bin/tsc --noEmit --incremental false` -> exit 0.
- `./node_modules/.bin/tsc -p tsconfig.tests.json --pretty false --incremental false` -> exit 0.
- `npm run typecheck` -> exit 0.
- `npm run typecheck:tests` -> exit 0.
- `npm run lint` -> exit 0 with 4 existing warnings in `src/components/floor3d/retro/objects/AgentModel.tsx`.
- `node --import tsx tests/email-outcomes-contract.mts && node --import tsx tests/loop-authority-contract.mts && node --import tsx tests/test-manifest-contract.mts` -> exit 0.
- `git diff --check` -> exit 0.
- `git diff --name-only -- supabase/migrations ':!supabase/migrations/0053_sequence_engine_real_authority.sql'` -> no output.
- `git ls-files --error-unmatch supabase/migrations/0053_sequence_engine_real_authority.sql` confirmed `0053` is not tracked.
- `find supabase/migrations -maxdepth 1 -name '0054*.sql' -print` -> no output.

Blocked by local sandbox:

- `npm run test:all` failed in `tests/apollo-cleanup-worker.mts` with `listen EPERM: operation not permitted 127.0.0.1`.
- `npm run test:database` failed with `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`.
- `npm run test:manifest` failed with `Error: listen EPERM: operation not permitted /var/folders/5m/c_klcrrj4yj_jxhf4t6vhb080000gn/T/tsx-501/81207.pipe`.
- `npm run build` failed with `Error [TurbopackInternalError]: [project]/src/styles/globals.css [app-client] (css)` caused by `creating new process`, `binding to a port`, `Operation not permitted (os error 1)`.
- `bash tests/email-outcomes-db.sh` failed with `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`.
- `bash tests/sequence-engine-db.sh` failed with `permission denied while trying to connect to the docker API at unix:///Users/tony/.colima/default/docker.sock`.

## Blockers

1. Docker/Colima socket access is denied, so the focused SQL proof for `true:true:1`, replay idempotency, and sequence linkage could not execute in this sandbox.
2. Loopback listeners are denied, so the full all-group test manifest stops at the Apollo cleanup worker redirect test.
3. `tsx` CLI IPC pipe listeners are denied, so `npm run test:manifest` cannot run here. The direct `node --import tsx` manifest contract passed.
4. Turbopack process/port creation is denied, so `npm run build` cannot complete here.

## Next steps

1. In the Docker-enabled environment, run:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Specifically confirm `tests/email-outcomes-db.sh` passes with:
   - `correlate-records-reply-outcome` = `true:true:1`.
   - `correlate-replay-does-not-duplicate-reply-outcome` = `true:already-processed:1`.
3. Specifically confirm `tests/sequence-engine-db.sh` passes with:
   - `unified-inbox-correlates-to-sequence-step`.
   - `unified-inbox-populates-sequence-linkage`.
4. Commit intended files only after Docker/live proof passes.

## Decisions made (don't relitigate)

- Fix uncommitted migration `0053` in place; do not add `0054`.
- Do not change committed migration bytes.
- Keep sequence linkage in `correlate_inbound_email` update and returned JSON.
- Keep `already-processed` early return before outcome recording.
- Keep outcome recording idempotent through `record_candidate_outcome` idempotency key `reply:<inbound_id>` plus early return on processed inbound.
- Keep `sequences_enabled` false and add no send path.

## Watch out

- Do not adjust `tests/email-outcomes-db.sh` expected `true:true:1`; it is the regression guard.
- Do not treat Docker, TSX IPC, loopback, or Turbopack sandbox errors as database/code failures without rerunning in the Docker-enabled environment.
- Before claiming DB proof, inspect the exact SQL assertion outputs because `concat_ws` skips nulls.
