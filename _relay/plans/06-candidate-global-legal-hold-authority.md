# 0066 Candidate-Global Legal-Hold Authority

Status: accepted in source commit `6bf97a6`; independent security and
concurrency review report no P0/P1. Production remains blocked.

## Problem and required outcome

`request_candidate_erasure` removes one candidate ID across the workspace, but
the 0033 hold checks are scoped to `(workspace, campaign, candidate)`. A hold in
campaign A can therefore fail to stop an erasure request in campaign B for the
same workspace candidate ID. Release also changes a campaign-local request out
of `blocked_legal_hold` before checking for another hold. Multiple AFTER UPDATE
cleanup triggers treat that transition as destructive authority.

0066 must make the hold decision candidate-global within one workspace while
preserving the campaign on each case record. One active hold for candidate X in
any campaign must block every non-completed erasure request and provider
obligation for candidate X in that workspace. A different workspace or
candidate must remain independent.

## Fixed boundaries

- Add one forward migration and one rollback file that unconditionally refuses
  with SQLSTATE 55000; do not rewrite 0033. Reverting to the known destructive
  bypass requires a separately reviewed forward migration, never downgrade.
- Preserve public RPC signatures and response shapes.
- Runtime execution remains service-role-only with an exact workspace admin.
- Retain each hold's campaign, reason, case reference, actor, and timestamps.
- Never downgrade a completed obligation or completed request.
- Never report provider deletion from manual or inferred evidence.
- Never let a release or expiry create a transient non-blocked status while any
  other active hold remains.
- A request blocked before local scrub stays blocked after the final hold ends
  until the exact request is replayed and performs the governed scrub.
- A request blocked after local scrub may return to truthful manual provider
  work after the final hold ends.
- Candidate-global hold authority also protects expired autonomous-web evidence
  for the same workspace candidate ID across campaigns.

## Canonical lock protocol

Every changed path must acquire compatible locks in this order:

1. Validate service role, bounded arguments, and exact workspace administrator.
2. Lock the workspace-state row. Erasure uses `FOR UPDATE`; hold placement,
   release, refresh, provider read/reconcile, and retention use `FOR SHARE`.
3. Acquire the two-key advisory lock
   `pg_advisory_xact_lock(1095911745,
   candidate_legal_hold_lock_key(workspace,candidate))`. The fixed int32 value
   is hexadecimal ASCII `ARIA`; PostgreSQL's two-int advisory namespace cannot
   overlap the existing one-bigint erasure identity locks. It must not reuse
   `candidate_erasure_identity_lock_key`: the retained erasure and reimport
   paths acquire a larger identity set in sorted hash order, so prelocking only
   candidate ID would invert that order.
4. Lock candidate-global hold rows in deterministic `id` order.
5. Lock open candidate-global erasure requests in deterministic `id` order.
6. Lock their obligations in deterministic `(request_id, id)` order.
7. Only then change a hold/request/obligation or invoke retained pre-0066 logic.

The common reconciler must acquire steps 2-6 itself. The erasure wrapper must
take the stronger workspace lock before calling it so it never upgrades a
shared workspace lock while another request is doing the same. After the legal
hold decision, the retained erasure routine remains responsible for acquiring
its complete candidate/email/phone/source identity lock set in canonical sorted
order.

## Function strategy

Rename only the exact definitions that need delegation to owner-only
`*_pre0066` predecessors, then create wrappers under the original signatures.
This preserves the exact evidence-bound implementation behind the new lock and
hold decision without copying stale function bodies. Functions that are fully
reimplemented do not need a callable predecessor.

The affected public surface is:

- `refresh_candidate_erasure_legal_hold_state(uuid)`
- `request_candidate_erasure(uuid,uuid,text,text,uuid)`
- `place_candidate_legal_hold(uuid,uuid,text,text,text,text,timestamptz)`
- `release_candidate_legal_hold(uuid,uuid,uuid,text)`
- `read_candidate_erasure_obligation_authority(uuid,uuid,uuid)`
- `reconcile_candidate_erasure_obligation(uuid,uuid,uuid,integer,text,text,text,text)`
- `cleanup_autonomous_web_sourcing_retention(integer)`

Add one owner-only helper:

- `reconcile_candidate_erasure_legal_hold_scope(uuid,text) returns boolean`
- `candidate_legal_hold_lock_key(uuid,text) returns integer`, a deterministic
  immutable helper over `(workspace_id, candidate_id)` in a namespace distinct
  from erasure identity locks

The helper expires every elapsed hold for the workspace candidate using one
captured transaction time. If any active hold remains, it sets every open
request and non-completed obligation to `blocked_legal_hold`. If none remains,
it unblocks only locally scrubbed requests and their non-completed obligations;
pre-scrub requests remain blocked for exact replay.

### Request wrapper

- Validate and lock before consulting holds.
- Verify the exact `(campaign, candidate)` exists once in canonical workspace
  state before creating any request.
- Under an active hold, preserve exact request-key conflict/replay semantics and
  insert a content-free blocked request only when no request exists.
- Without an active hold, call the owner-only predecessor while every global
  scope lock remains held. Its later lock acquisitions are then re-entrant.

### Placement wrapper

- Lock canonical state and candidate identity before the predecessor can insert.
- Reconcile before and after the predecessor call.
- The post-call reconciliation must block requests and obligations in every
  campaign for the workspace candidate.

### Release wrapper

- Do not call the 0033 predecessor: it can transiently unblock campaign-local
  requests and fire cleanup triggers while another hold remains.
- Reimplement the small release state machine directly under global locks.
- Preserve exact released replay, conflict, expired, and not-found responses.
- Reconcile only after the target hold is released; unblock only when the last
  active candidate-global hold is gone.

### Refresh/read/reconcile wrappers

- Derive the workspace candidate without exposing existence to unauthorized
  callers, acquire the full global scope, and reconcile once.
- Completed obligations preserve their existing idempotent/read behavior.
- A non-completed obligation returns `blocked_legal_hold` before decrypting a
  provider reference, incrementing an access counter, or accepting completion.
- When no hold is active, call the exact predecessor under already-held locks.

### Autonomous-web retention

- Change the evidence hold check from exact campaign to exact workspace and
  candidate ID.
- Serialize candidate evidence deletion with placement through the distinct
  candidate-legal-hold scope lock.
- If held evidence protects an egress attempt, do not remove its staged payload
  through the same retention call.
- Preserve bounded batch behavior and the existing service-role-only contract.

## Schema and privilege changes

- Add a partial active-hold lookup index beginning with
  `(workspace_id, candidate_id)`.
- Add a partial open-request lookup index beginning with
  `(workspace_id, candidate_id)`.
- Revoke every runtime grant from helper, lock-key, and predecessor functions.
- Preserve service-role EXECUTE only on the seven original public signatures.
- Keep every credential/reference table private and forced-RLS behavior intact.
- Register every new owner-only function in the privilege inventory.

## Rollback and predecessor safety

- `supabase/rollbacks/0066_candidate_global_legal_hold_authority.sql` always
  raises SQLSTATE 55000 before mutation. There is no empty-database exception.
- Harden the 0059 and 0060 rollback guards so an append-only migration ledger
  containing 0066 or later refuses before either older script changes a
  function or table.
- Existing disposable rollback/reapply harnesses have no production ledger;
  after they intentionally replay 0033, 0059, or 0060, they must explicitly
  reapply 0066 before asserting the current authority. This is test isolation,
  not an operational rollback procedure.
- A production reversal must be a new forward migration with its own data,
  trigger, privacy, and concurrency review.

## RED and regression matrix

The focused disposable PostgreSQL harness must fail before 0066 exists, then
prove all of the following on the forward migration:

1. Hold A blocks a new erasure request B before tombstone, receipt, local scrub,
   provider obligation, or list/evidence cleanup.
2. Hold A blocks an already locally scrubbed request B and every non-completed
   obligation without changing completed evidence.
3. Two holds in A/B keep all requests blocked when only one is released.
4. Releasing the final hold unblocks only locally scrubbed work; a pre-scrub
   request requires exact replay.
5. Expiry follows the same global rule and never fabricates a release actor or
   case reference.
6. Exact placement and release replays are idempotent; changed evidence returns
   conflict.
7. A late hold blocks provider authority read before ciphertext decryption or
   counter mutation and blocks provider completion before evidence consumption.
8. A completed obligation/request remains completed under a later hold.
9. Cross-workspace and different-candidate controls remain independent.
10. Viewer/member/anonymous/authenticator calls fail; service role plus a
    non-admin also fails.
11. Request-versus-place, release-versus-request, refresh-versus-reconcile,
    retention-versus-place, and legal-hold-versus-full-identity-reimport
    interleavings complete without deadlock or bypass in actual PostgreSQL
    sessions, including absence of SQLSTATE 40P01. Static proof must reject use
    of a lone canonical identity lock as the 0066 scope lock.
12. A hold in campaign A preserves expired autonomous-web evidence for the same
    workspace candidate in campaign B, while an unrelated expired row is
    removed.
13. Forward retry is idempotent and preserves unknown later controls. Known
    disposable 0033/0059/0060 replay tests explicitly restore 0066 afterward;
    production older rollbacks refuse when 0066 or later is ledgered.
14. The 0066 rollback refuses atomically with SQLSTATE 55000 regardless of row
    count or ledger presence; no test flag can enable the unsafe downgrade.
15. The refusal leaves every function, grant, index, row, and hold state
    byte-for-byte unchanged.

Run the existing candidate-erasure, autonomous-web, candidate-list evidence,
sourcing-batch, privilege, recovery, manifest, TypeScript, lint, dependency,
secret-scan, build, and complete npm lifecycle gates after the focused suite.

## Acceptance and handoff

0066 is accepted only when the RED contract is captured separately, the focused
PostgreSQL suite and every upstream regression are green, the 0059 and 0060
production rollback guards cannot clobber ledgered 0066 authority, an independent
database/concurrency reviewer and security/privacy reviewer report no P0/P1,
the exact migration/rollback/test hashes are written to `_relay/HANDOFF.md`, and
the source plus Relay commits are pushed and remote-SHA verified.

This slice authorizes no production deployment, secret provisioning, sourcing
activation, email send, LinkedIn action, or candidate contact.

## Completion review - 2026-07-26

- Forward migration SHA-256:
  `f1db1fcdf0c10216f34799dc40c868c859ad06929d959641f44dc833f31240e4`.
- Refusing rollback SHA-256:
  `ec686a4661e429093f920346404288c2ae3a20ec424610e7130452a9da13f723`.
- Focused harness SHA-256:
  `88706d52db009e2c76619d5363fa50e25da309651eacb4bb5be197ec6ee9a30b`.
- `bash tests/candidate-global-legal-hold-db.sh` passed 35 assertions.
- Candidate erasure, sourcing durability, autonomous web, candidate-list,
  sourcing-batch, function privilege, recovery allowlist, manifest, secret
  scan, both TypeScript checks, and the complete `npm test` lifecycle passed.
- Independent concurrency review returned PASS with no P0/P1. The final
  security finding on inherited custom-role ACLs is covered by dynamic
  non-owner revocation and a custom-role regression.
- Source commit: `6bf97a6`. This is source acceptance only. Push, protected CI,
  merge, deployment, canary, restore, and capacity are separate gates.
