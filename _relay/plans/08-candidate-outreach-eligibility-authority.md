# 0068 Candidate Outreach Eligibility Authority

Status: design gate locked on 2026-07-26. Implementation has not started. The
first executable change is a separately committed RED database contract.

This slice is source-only and provider-free. It does not export contact data,
enroll a candidate, enqueue a message, call Gmail, call Microsoft Graph, call
HeyReach, or authorize any existing send path. A later egress integration must
re-evaluate the same authority at campaign activation, work claim, and the
immediate pre-provider check.

## Socratic build gate

### 1. What underlying need does this serve?

ARIA needs a database-owned answer to one narrow question: for each current
member of an exact candidate-list generation, is outreach on one channel
allowed by the evidence and blocking state visible now? A compliance badge or
browser-side filter is insufficient because current provenance, recipient
identity, lawful basis, notice, suppression, erasure, contact history, and live
enrollment can change independently.

### 2. Who is the primary reader?

Tony Walteur is the product owner. The immediate execution readers are Codex
Root and the next Claude reviewer. They need exact object names, failure
semantics, lock order, proof commands, and scope boundaries without relying on
conversation history.

### 3. What action should the reader take?

Execute the tasks below in dependency order. Begin with a test that fails only
because the 0068 table and both public RPCs are absent after exact 0067. Do not
write production SQL until that RED boundary has been observed and committed.

### 4. Which assumptions are falsifiable?

1. Exact 0067 is the accepted predecessor and retains the hashes recorded in
   this plan.
2. `workspace_state.state->'candidates'` is the only canonical candidate
   document for this slice; `public.candidates` is a best-effort mirror.
3. Existing list provenance can be resolved by
   `resolve_candidate_list_evidence`, but it does not prove contact identity,
   lawful basis, or privacy notice.
4. A purpose-bound recipient HMAC is sufficient for eligibility equality. No
   stored recipient plaintext or ciphertext is needed because later egress
   must resolve the live canonical recipient again.
5. Current ledger uniqueness means every `claimed`, `sent`, or `ambiguous`
   row remains blocking regardless of age until a separate ledger-policy
   migration changes that invariant.
6. 0068 remains no-egress. If a caller needs a reusable send token, contact
   export, or provider action from this slice, stop and re-plan.

Each assumption has a direct database test. A failed assumption reopens the
design before implementation continues.

### 5. What is the strongest counter-narrative?

An eligibility table can become compliance theatre if the real send paths do
not enforce it. That criticism is correct for the current product: 0063 still
resolves recipients from `public.candidates`, and the synchronous email route
does not consume this future authority. Therefore 0068 is deliberately a
read-only assessment plus evidence lifecycle, never a claim that Gmail,
Microsoft 365, or HeyReach is safe. The master plan keeps egress integration
and authorized provider canaries as later required gates.

### 6. What is explicitly out of scope?

- contact export, CSV, or returning an email or LinkedIn URL;
- campaign creation, enrollment, scheduling, task mutation, or approvals;
- message composition, queue insertion, provider calls, or provider receipts;
- Gmail, Microsoft, HeyReach, LinkedIn, Flowise, DeerFlow, or Graphify runtime
  changes;
- changing the 0067 membership revision when eligibility evidence changes;
- changing the permanent outreach-ledger uniqueness policy;
- UI, HTTP routes, shared API quota, or production activation.

## Locked assumptions

- Exact predecessor forward SHA-256:
  `ae101d72145094b21e44694c3c00b37b3b0824c9ab1bb9780f65d9608ff1d4dd`.
- Exact predecessor rollback SHA-256:
  `ef77b9aae9cb5252d3e09adc9ffa4937ba2ef40d8387388c1ad5f3d1bf2ccdc7`.
- Channels are exactly `Email` and `LinkedIn`. HeyReach is a transport, not a
  channel or an entitlement.
- Existing rows are never backfilled into eligibility.
- Recipient plaintext and ciphertext are absent from the new table, receipts,
  responses, errors, and Relay evidence.
- Every attested fact is bound to an immutable list `member_id`, channel, and
  exact canonical recipient HMAC.
- Public evaluation is a current, non-authorizing page snapshot. It mints no
  reusable token and takes no long-lived candidate locks.
- Unknown outreach-ledger status fails closed.
- An active legal hold alone is not a do-not-contact rule. An erasure request
  blocked by that hold remains an outreach denial.

READY TO BUILD: YES

## Verified predecessor facts

- `candidate_list_members` has primary identity
  `(workspace_id,list_id,campaign_id,candidate_id)` and globally unique
  `member_id`, but no tenant-bound `(workspace_id,member_id)` key.
- `resolve_candidate_list_evidence(uuid,text,text,timestamptz)` returns current
  admission-provenance states and pointers. It is owner-only.
- Email normalization is currently repeated `lower(btrim(value))`; there is no
  shared validating email canonicalizer.
- LinkedIn has `normalize_linkedin_profile_url(text)` and canonical-v2 erasure
  HMAC support.
- `suppression_list` stores mutable raw values and has no normalized expression
  indexes.
- `outreach_ledger.status` has no check constraint. Proven safe terminal state
  is `skipped`; `claimed`, `sent`, and `ambiguous` own the permanent partial
  unique slot.
- Live sequence states are exactly `drafting`, `pending_approval`, `active`,
  and `paused_ambiguous`, candidate-global within a workspace.
- Candidate-global legal-hold locking uses advisory namespace `1095911745`
  before the governed erasure identity locks.
- Candidate-list erasure cleanup does not automatically include a future
  eligibility table or erasure receipt store.
- The only database encryption helper is purpose-specific to provider erasure.
  0068 does not reuse it and does not create a second recipient copy.

## Artifacts

- `supabase/migrations/0068_candidate_outreach_eligibility_authority.sql`
- `supabase/rollbacks/0068_candidate_outreach_eligibility_authority.sql`
- `tests/candidate-outreach-eligibility-db.sh`
- canonical test-manifest registration;
- function privilege, legacy inventory, schema digest, and Fly migration
  preflight updates required by the new surface;
- `_relay/codex-findings.md`, Relay archive, and fresh handoff evidence.

## Schema contract

### Tenant-bound member generation

Add the exact unique constraint:

```sql
candidate_list_members_workspace_member_key
  unique (workspace_id, member_id)
```

This binds evidence to one immutable membership generation. Removing and
re-adding the same campaign/candidate creates a different `member_id`; stale
eligibility evidence cannot attach to the new generation.

The Fly preflight must refuse a transactional index build if 0064 is already
live with any member row and this key is absent. That state requires a separate
reviewed online index migration before 0068. It is never silently built over an
unmeasured populated table.

### New append-only table

Create only:

```sql
public.candidate_outreach_eligibility_attestations
```

Required columns:

- `id bigint generated always as identity primary key`;
- `workspace_id uuid not null`;
- `member_id uuid not null`;
- `channel text not null`;
- `attestation_kind text not null`;
- `decision text not null`;
- `value_code text`;
- `recipient_identifier_kind text not null`;
- `recipient_normalization_version text not null`;
- `recipient_hmac_sha256 text not null`;
- `source_evidence_sha256 text not null`;
- `record_hmac_sha256 text not null`;
- `observed_at timestamptz not null`;
- `recorded_at timestamptz not null default clock_timestamp()`;
- `recorded_by uuid not null`;
- `supersedes_id bigint`.

Exact domains:

- `channel`: `Email`, `LinkedIn`;
- `attestation_kind`: `contact_identity`, `lawful_basis`, `privacy_notice`;
- `decision`: `attested`, `revoked`;
- attested contact value: `verified`;
- attested lawful-basis value: `consent`, `legitimate_interest`;
- attested notice value: `preprovided`;
- revoked value: null;
- email identity: `email` plus `email_lower_trim_ascii_v1`;
- LinkedIn identity: `linkedin` plus `canonical_v2`;
- every HMAC/digest: exact lowercase 64-character hexadecimal.

Recipient HMAC fields are present for every lifecycle row, not only contact
identity. Lawful basis and notice must remain bound to the exact recipient
identity to which the administrator attested them. A revocation copies the
predecessor recipient binding. A later re-attestation may bind a changed
canonical recipient only after superseding the current leaf.

No `recipient`, `email`, `linkedin_url`, `plaintext`, `ciphertext`, `payload`,
or free-text evidence column is permitted.

Required relationships and indexes:

- tenant-bound FK `(workspace_id,member_id)` to
  `candidate_list_members(workspace_id,member_id) on delete cascade`;
- tenant-bound recorder FK `(workspace_id,recorded_by)` to profiles;
- one full-scope self-FK over
  `(workspace_id,member_id,channel,attestation_kind,supersedes_id)`;
- one root per member/channel/kind;
- one child per predecessor;
- a current-leaf lookup beginning
  `(workspace_id,member_id,channel,attestation_kind,supersedes_id)`;
- erasure lookup `(workspace_id,member_id,id)`;
- roots must be attested; a revoke must supersede an attested current leaf;
- every successor `observed_at` is later than its predecessor;
- context, recorder, evidence digest, and recipient binding are immutable.

An append-only trigger rejects update, ungoverned delete, and truncate. Delete
is allowed only for an enclosing workspace deletion or one exact governed
erasure request carried by the established transaction-local cleanup settings.

## Normalization and HMAC contract

Add owner-only helpers with no runtime grant:

```sql
public.normalize_candidate_outreach_email(text) returns text
public.candidate_outreach_recipient_hmac(uuid,text,text) returns text
```

The email helper is a conservative ASCII v1 normalizer. It lowercases and
trims, rejects control characters and whitespace, requires exactly one `@`,
enforces local-part and domain byte bounds, validates domain label boundaries,
and returns null for an invalid address. It does not claim full RFC mailbox
equivalence.

The recipient HMAC helper composes the existing workspace HMAC secret with a
purpose-separated domain containing `candidate-outreach-recipient-v1`, the
channel, normalization version, and canonical recipient. LinkedIn first calls
the existing canonical profile normalizer. It never returns or stores the
canonical plaintext.

There is no encryption helper in 0068. Adding one would create an unnecessary
second PII store, key-rotation contract, and erasure surface. Later egress must
resolve the canonical recipient fresh and compare this HMAC immediately before
contact.

## Idempotency receipt contract

Reuse `candidate_list_operation_receipts`. Extend its exact operation and
subject constraints with `attest_eligibility`; do not add a second receipt
table.

- `list_id` is the member's exact list.
- `candidate_subject_hmac` remains the existing campaign/candidate erasure
  subject so identity-global cleanup removes the new receipt.
- The request HMAC includes actor, workspace, member generation, list,
  campaign, candidate, channel, kind, decision, value, recipient HMAC,
  observed instant, source digest, predecessor, and idempotency key.
- Erasure and canonical candidate checks happen before replay.
- Exact replay returns the original success result.
- Same key with changed normalized input returns `idempotency_conflict`.
- Only successful attestation or revocation is receipted. Missing authority,
  stale predecessor, and validation denials create no receipt.
- The result contains only status and decimal-string attestation ID.

## Admin attestation RPC

Add exactly:

```sql
public.attest_candidate_outreach_eligibility(
  p_member_id uuid,
  p_channel text,
  p_attestation_kind text,
  p_decision text,
  p_value_code text,
  p_recipient text,
  p_observed_at timestamptz,
  p_source_evidence_sha256 text,
  p_supersedes_id bigint,
  p_idempotency_key uuid
) returns jsonb
```

Authority and behavior:

- require `auth.role() = authenticated`, active identity, active workspace,
  and exact profile role `admin`;
- derive actor and workspace from the principal, never arguments;
- resolve the globally unique member without disclosing a foreign member;
- lock `workspace_state FOR SHARE` and require exactly one canonical candidate
  matching the member campaign and candidate;
- normalize the supplied recipient and require exact equality with the current
  canonical channel identity;
- never infer any eligibility fact from candidate JSON, list provenance,
  provider payload, model output, or `public.candidates`;
- accept only `preprovided` for privacy notice;
- reject an observation more than five minutes in the future;
- preserve predecessor evidence and recipient binding on revocation;
- return `candidate_not_found` for absent, erased, foreign, or canonical-missing
  identity without disclosing which check failed;
- return `predecessor_conflict` for a stale or invalid lifecycle predecessor;
- never return recipient, HMAC, source digest, recorder, or canonical candidate
  material.

Mutation lock order:

1. idempotency advisory key;
2. exact workspace-state row `FOR SHARE`;
3. candidate-global legal-hold advisory namespace `1095911745`;
4. sorted erasure identity advisory keys for candidate ID and current channel
   recipient;
5. existing campaign/candidate contact-evidence advisory key;
6. exact member row `FOR KEY SHARE`;
7. one member/channel eligibility advisory key shared by all three kinds;
8. current predecessor `FOR NO KEY UPDATE`;
9. existing receipt row `FOR UPDATE`.

The sorted multi-identity step must match governed erasure ordering. It prevents
candidate-ID-first and recipient-first operations from deadlocking.

## Revision-bound evaluation RPC

Add exactly:

```sql
public.evaluate_candidate_list_outreach_eligibility(
  p_list_id uuid,
  p_expected_revision bigint,
  p_channel text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_limit integer
) returns jsonb
```

Only active authenticated `member` and `admin` roles may execute it. Viewer,
anonymous, service role, authenticator, inactive identity, and inherited custom
roles fail with SQLSTATE 42501. A missing or foreign list returns the same
`{"status":"list_not_found"}` envelope.

First-page protocol matches 0067: expected revision and both cursor components
may all be null. Later pages require the exact decimal list revision and both
cursor components. Limit is 1 through 100. Ordering is ascending bytewise
`(campaign_id COLLATE "C", candidate_id COLLATE "C")`.

Success has only:

```json
{
  "status": "ok",
  "list_id": "uuid",
  "membership_revision": "decimal-string",
  "channel": "Email",
  "evaluated_at": "instant",
  "items": [
    {
      "member_id": "uuid",
      "campaign_id": "opaque-id",
      "candidate_id": "opaque-id",
      "eligible": false,
      "reasons": [
        {
          "code": "lawful_basis_missing",
          "authority_kind": "candidate_list_member",
          "authority_id": "uuid-or-decimal-string"
        }
      ]
    }
  ],
  "has_more": false,
  "next_cursor": null,
  "restart_required": false
}
```

Revision conflict returns no items, the current decimal revision,
`restart_required=true`, and no list content. Every reason contains a non-null
typed authority identifier. Missing evidence points to the member. Existing
attestation, suppression, erasure, ledger, tombstone, and sequence reasons use
their real opaque row IDs. Responses contain no recipient, HMAC, digest,
recorder, provider pointer, source payload, lawful-basis narrative, or evidence
timestamp.

The evaluator is a current page snapshot, not a stable eligibility generation.
Eligibility evidence can change without advancing membership revision. It
computes list revision, at most `p_limit + 1` members, and all reasons in one
materialized SQL statement using one captured instant. It takes no advisory or
row locks and performs no write because it mints no send authority. A later
send integration must recheck under its own candidate mutation locks.

## Eligibility decision contract

The evaluator requires all of the following for each item:

1. exactly one canonical workspace-state candidate for member campaign and ID;
2. no open erasure request and no candidate or recipient tombstone;
3. current resolved provenance exactly matching the member's immutable kind,
   pointer, SHA-256, recorded time, and expiry;
4. one current attested contact-identity leaf matching the current recipient;
5. one current attested lawful-basis leaf matching that recipient;
6. one current attested preprovided-notice leaf matching that recipient;
7. no live recipient or domain suppression;
8. no blocking or unknown candidate-global outreach-ledger row;
9. no candidate-global live outreach sequence.

Deterministic reason precedence is:

1. `canonical_candidate_missing`
2. `canonical_candidate_ambiguous`
3. `erasure_authority_unavailable`
4. `erasure_requested`
5. `erasure_tombstoned`
6. `provenance_missing`
7. `provenance_revoked`
8. `provenance_expired`
9. `provenance_ambiguous`
10. `provenance_mismatch`
11. `contact_identity_missing`
12. `contact_identity_revoked`
13. `contact_identity_ambiguous`
14. `contact_identity_mismatch`
15. `lawful_basis_missing`
16. `lawful_basis_revoked`
17. `lawful_basis_ambiguous`
18. `privacy_notice_missing`
19. `privacy_notice_revoked`
20. `privacy_notice_ambiguous`
21. `recipient_suppressed`
22. `recipient_domain_suppressed`
23. `contact_claim_active`
24. `contact_outcome_ambiguous`
25. `recently_contacted`
26. `contact_history_locked`
27. `contact_ledger_unknown`
28. `active_enrollment`

Ledger mapping:

- `claimed`, any age: `contact_claim_active`;
- `ambiguous`, any age: `contact_outcome_ambiguous`;
- `sent` at most 90 days old: `recently_contacted`;
- older `sent`: `contact_history_locked` because the permanent unique index
  still blocks a new claim;
- `skipped`: not a denial by itself;
- null or any other status: `contact_ledger_unknown`.

All applicable reasons are returned in the fixed order, then by authority ID.
Eligibility is true only when the reason array is empty.

## Suppression and bounded-plan contract

Email evaluates exact normalized recipient and extracted domain. LinkedIn uses
canonical-v2 normalization. Expired suppression rows are ignored.

The current raw suppression index cannot prove bounded normalized lookup. 0068
therefore requires expression indexes for lower-trim email/domain and canonical
LinkedIn values. The Fly preflight must refuse transactional creation when
`suppression_list` is non-empty and those indexes are absent. That state moves
the indexes to a separate reviewed online migration; 0068 does not take an
unmeasured production write lock.

With at least 10,000 list members, `EXPLAIN (ANALYZE, FORMAT JSON)` must prove:

- the member driver consumes at most `p_limit + 1` rows;
- no sequential scan of `candidate_list_members`;
- each canonical candidate, head attestation, suppression, erasure, ledger,
  tombstone, and live-sequence branch is an indexed bounded probe;
- actual work multiplies rows by loops;
- every sort, hash, aggregate, or materialization consumes an already bounded
  source;
- output cardinality alone is never accepted as bounded traversal evidence.

## RLS, ACL, erasure, and rollback

- Enable and force RLS on the new table.
- Install owner access only for `postgres` and `supabase_admin`.
- Revoke table and identity-sequence rights from public, anon, authenticated,
  service_role, authenticator, and inherited custom roles.
- Revoke every private helper from all runtime roles.
- Grant only the two public RPCs to authenticated; enforce their different
  member/admin versus admin-only roles inside the functions.
- Register every function in the exact privilege matrix and legacy inventory.
- Extend the candidate-erasure receipt store allowlist with
  `candidate_outreach_eligibility_attestations`.
- Replace the exact candidate-list erasure cleanup with a retained predecessor
  wrapper that deletes and counts eligibility rows before member deletion.
- `blocked_legal_hold` preserves rows but remains ineligible through
  `erasure_requested`.
- Hold release and erasure replay delete rows and create one exact scrub count.
- Candidate-global erasure removes eligibility across every campaign carrying
  that candidate ID while preserving other workspace and tenant data.
- Eligibility changes never advance `membership_revision`.

Rollback acquires the shared schema lock and refuses with SQLSTATE 55000 before
mutation if any 0068 attestation or `attest_eligibility` receipt exists. Empty
rollback restores the exact 0067 schema, data, cleanup function, erasure receipt
constraint, candidate-list receipt constraints, ACLs, policies, triggers, and
inventory. It refuses partial or later authority including first table, index,
function, constraint, trigger, marker, overload, custom ACL, disabled trigger,
false trigger qualification, or function-body drift. A second clean rollback
is idempotent. Reapply restores one exact 0068 fingerprint.

0067 rollback must also refuse while any full or partial 0068 authority exists.

## RED-first test contract

Create only `tests/candidate-outreach-eligibility-db.sh` first. It applies exact
history through 0067, verifies the accepted list/evidence/hold/revision/preview
foundation, and confirms all three 0068 objects are absent:

- `public.candidate_outreach_eligibility_attestations`;
- `public.attest_candidate_outreach_eligibility(uuid,text,text,text,text,text,timestamptz,text,bigint,uuid)`;
- `public.evaluate_candidate_list_outreach_eligibility(uuid,bigint,text,text,text,integer)`.

With no exact 0068 migration and all objects absent, it exits 1 with exactly:

```text
candidate-outreach-eligibility-db RED: eligibility attestation and revision-bound evaluation authority are absent after exact 0067
```

Any partial object without the exact migration is an inconsistent failure, not
accepted RED. A migration without exact rollback fails before apply. Future
green assertions remain below this boundary in the same file.

The manifest registration is added in the RED commit:

- command after `candidate-list-set-preview-db`;
- one `pretest` group entry;
- one `database` group entry;
- one `expectedDatabaseIds` entry in `tests/test-manifest-contract.mts`.

No new package script is added.

Required green phases:

1. exact catalog, no backfill, forward retry, unchanged predecessor data;
2. admin-only lifecycle, normalization, HMAC separation, replay/conflict;
3. root, successor, revoke, re-attest, stale predecessor, fork races;
4. revision protocol, no disclosure, provenance exact match;
5. every individual reason, combined fixed ordering, fully eligible case;
6. exact email, domain, LinkedIn suppression and expiry;
7. tombstone, missing-secret, open erasure, hold, release, global cleanup;
8. claimed, sent, ambiguous, skipped, null, and unknown ledger states;
9. all four live sequence states and terminal sequence controls;
10. deterministic attestation-versus-erasure and idempotency races;
11. bounded 10,000-member EXPLAIN proof;
12. zero changes to messages, outbox, ledger, sequences, jobs, provider
    attempts, provider receipts, and sourcing data;
13. no network-capable SQL call, credential, or provider request;
14. empty rollback, reapply, non-empty refusal, partial/later refusal;
15. candidate-list, evidence, erasure, legal-hold, sequence, privilege,
    recovery, invariant, and 0067 regressions.

Tests use observed `pg_stat_activity` barriers, never sleeps, for concurrency.
Erasure proof uses a clean cloned accepted template rather than the large
performance fixture.

## Execution tasks

Every task is one reviewable slice of at most 90 focused minutes.

| ID | SDLC stage | Owner | Duration | Dependency | Checkable deliverable | Verification |
|---|---|---|---:|---|---|---|
| E0.1 | Think | Codex Root | 45 min | 0067 accepted | This locked design and source-handle audit | Placeholder scan zero; adversarial and schema preflight reconciled |
| E1.1 | Test | Dewey Test Architect | 90 min | E0.1 | RED harness plus exact manifest registration | Exact RED line after exact 0067; no earlier fixture or syntax failure |
| E1.2 | Review | Boyle Eligibility Adversary | 45 min | E1.1 | RED-boundary review in codex findings | Confirms table plus both RPCs are required and no placeholder can pass |
| E2.1 | Build | Banach Schema Preflight | 90 min | E1.2 | Table, tenant member key, constraints, RLS, and lifecycle guards | Catalog and direct-DML negatives pass |
| E2.2 | Build | Codex Root | 90 min | E2.1 | Email normalizer and recipient-HMAC helpers | Alias, invalid-input, workspace-separation, and no-plaintext tests pass |
| E2.3 | Build | Codex Root | 90 min | E2.2 | Admin attestation RPC and idempotency receipt extension | Role, replay, conflict, lifecycle, and erasure-before-replay tests pass |
| E2.4 | Build | Banach Schema Preflight | 90 min | E2.2 | Owner-only per-member evaluation relation | All 28 reason mappings and exact authority IDs pass |
| E2.5 | Build | Dewey Test Architect | 90 min | E2.4 | Revision-bound paginated public evaluator | Revision, cursor, role, non-disclosure, and page-bound tests pass |
| E2.6 | Build | Cicero Rollback QA | 90 min | E2.3 | Erasure wrapper, receipt allowlist, and guarded rollback | Hold, release, global cleanup, empty restore, and refusal tests pass |
| E2.7 | Release | Lagrange Database QA | 90 min | E2.1,E2.5 | Expression indexes, Fly preflight, privilege and legacy inventories | Live-table refusal, exact ACL, manifest, and digest contracts pass |
| E3.1 | Test | Dewey Test Architect | 90 min | E2.3 | Lifecycle and idempotency behavior phase | Sequential lifecycle matrix exits 0 |
| E3.2 | Test | Boyle Eligibility Adversary | 90 min | E2.5 | Eligibility and deterministic-reason phase | Every reason alone and combined order exits 0 |
| E3.3 | Test | Banach Schema Preflight | 90 min | E2.3,E2.6 | Concurrency and lock-order phase | Fork, replay, opposite identity, and erasure races have no deadlock |
| E3.4 | Test | Cicero Rollback QA | 90 min | E2.6,E2.7 | Rollback, retry, partial, and later-authority phase | Exact 0067 restore and atomic SQLSTATE 55000 refusals pass |
| E3.5 | Security | Noether Security QA | 90 min | E2.5,E2.7 | ACL, no-egress, PII, and bounded-plan phase | Zero runtime DML, zero sensitive response fields, zero side effects, bounded EXPLAIN |
| E4.1 | Test | Lagrange Database QA | 90 min | E3.1-E3.5 | Focused regressions and complete repository gate | Required predecessor suites and exact full gate exit 0 |
| E4.2 | Review | Boyle Eligibility Adversary | 60 min | E4.1 | Final adversarial review and resolved findings | Zero open correctness, security, spec, or test-gap finding for 0068 |
| E4.3 | Ship | Codex Root | 45 min | E4.2 | Atomic commits, pushed branch, updated PR, fresh Relay baton | Remote SHA readback and current `gh` check annotations recorded honestly |

## Dependency graph and parallel work

Critical path:

```text
E0.1 -> E1.1 -> E1.2 -> E2.1 -> E2.2 -> E2.3 -> E2.6 -> E2.7
                                                   \-> E3.1
                                  E2.4 -> E2.5 -> E3.2/E3.5
                                  E2.3 -> E3.3
                                  E2.6 -> E3.4
E3.1/E3.2/E3.3/E3.4/E3.5 -> E4.1 -> E4.2 -> E4.3
```

After E2.2, evaluation work and mutation work can proceed independently. After
the implementation converges, lifecycle, decision, concurrency, rollback, and
security proof can run in parallel in isolated disposable databases.

No single owner holds more than half of the tasks. The plan owner coordinates
dependencies and proof boundaries; each named QA owner owns a distinct verdict.

## Four-lane acceptance for this slice

1. Lagrange Database QA: schema, query plans, concurrency, regression, and
   PostgreSQL 17 behavior.
2. Noether Security QA: RLS, ACL inheritance, role substitution, tenant
   disclosure, PII absence, and no-egress proof.
3. Dewey Functional QA: lifecycle, pagination, revision conflict, reasons, and
   fully eligible behavior.
4. Cicero Recovery QA: erasure, legal hold, rollback, reapply, partial state,
   and later-authority refusal.

Each lane must return PASS. One skipped critical test, open high-severity
finding, deadlock, unbounded query branch, PII leak, or false authorization
keeps 0068 blocked.

## Spec coverage audit

- Provenance: resolver plus exact immutable member snapshot comparison.
- Lawful basis: explicit admin lifecycle, no inference.
- Privacy notice: explicit `preprovided` lifecycle only.
- Contact identity: canonical workspace-state equality plus purpose HMAC.
- Suppression: live email, domain, and canonical LinkedIn checks.
- Erasure: open request, candidate/recipient tombstone, legal-hold behavior,
  candidate-global cleanup, and exact receipt.
- Contact history: all active ledger states, 90-day reason distinction,
  indefinite unique-slot truth, and unknown-state denial.
- Enrollment: all four candidate-global live sequence states.
- Evidence identifier: every denial includes a typed opaque authority ID.
- Tenancy and RBAC: derived workspace, non-disclosing foreign state, admin-only
  writes, member/admin reads, forced RLS, exact ACL.
- Scale: 100-item cap, 10,000-member plan oracle, indexed per-item probes.
- Recovery: retry, rollback, reapply, partial/later refusal, old rollback guard.
- Side effects: no contact data, no queue, no provider, no send token.

Placeholder scan result: zero unresolved owner, deliverable, dependency, or
verification markers.

## Re-plan triggers

- Exact 0067 source or rollback hash changes.
- Live preflight finds candidate-list members before the tenant member key or
  normalized suppression indexes exist.
- Canonical workspace state cannot provide exactly one current channel identity.
- The permanent ledger unique index changes or a new terminal ledger state is
  governed by a checked database transition.
- Legal or DPO guidance requires a different lawful-basis or notice lifecycle.
- A caller asks 0068 to return contacts, authorize a send, or call a provider.
- Query-plan proof exceeds the fixed per-page bounds.
- Any race deadlocks or can commit both conflicting lifecycle successors.

## Executor walkthrough

- Boyle reviewed the eligibility threat model and found the present send paths
  do not consume this authority.
- Banach verified the exact predecessor functions, keys, indexes, ACL patterns,
  and erasure hooks, and identified the missing email normalizer and tenant
  member key.
- Dewey reviewed the existing database harnesses and fixed the RED boundary,
  manifest changes, false-positive traps, EXPLAIN method, and race barriers.
- Codex Root reconciled three disagreements: no ciphertext is stored, evaluation
  is revision-bound and paginated, and every denial keeps its typed evidence
  identifier.
- Claude Sonnet has not reviewed or executed this plan because the local Claude
  CLI is not authenticated. No Sonnet or Fable execution claim is made.
- Terra is reserved for the final product-wide validation after every roadmap
  phase and four-expert QA lane, not this intermediate slice.

## Plan verdict

GO for the 0068 RED contract and no-egress source implementation.

NO-GO for contact export, sequence integration, Gmail or Microsoft activation,
HeyReach execution, Fly deployment, real-candidate outreach, or enterprise-ready
claims from this slice alone.
