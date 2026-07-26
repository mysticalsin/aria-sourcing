# 0068 Online Index Foundation and 0069 Candidate Outreach Eligibility Authority

Status: READY TO BUILD: YES on 2026-07-26. The exact design snapshot at
SHA-256 `239781e8b828dfc6129f3ff8e6305a5027434f9da11d8dff12f4799a2a5003b1`
received independent schema-feasibility, adversarial, and RED-plan PASS
verdicts. The committed RED boundary remains honest, but it now has two stages:
missing 0068 online-index foundation after exact 0067, then missing 0069
eligibility authority after exact 0068. The harness correction is the first
build step; production SQL still waits for its immediate explicit RED proof.

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

The answer must also remain bounded on populated production tables. That
requires a reviewed concurrent-index foundation and a strict relational
projection of the canonical workspace candidate document. The existing
`public.candidates` mirror cannot provide that authority.

### 2. Who is the primary reader?

Tony Walteur is the product owner. The immediate execution readers are Codex
Root and the next Claude reviewer. They need exact object names, failure
semantics, lock order, proof commands, and scope boundaries without relying on
conversation history.

### 3. What action should the reader take?

Execute the tasks below in dependency order. First amend the existing harness
so it fails on the missing exact 0068 online-index foundation after exact 0067.
After 0068 is green, the same harness must reach a second RED boundary because
the 0069 projection, attestation table, and both public RPCs are absent. Do not
write either production slice until its immediate RED boundary has been
observed and committed.

### 4. Which assumptions are falsifiable?

1. Exact 0067 is the accepted predecessor and retains the hashes recorded in
   this plan.
2. `workspace_state.state->'candidates'` remains the canonical candidate
   document. A new owner-only projection is an exact transactionally maintained
   read model for eligibility; `public.candidates` remains best effort and is
   never read by 0069.
3. Existing provenance tables contain the required evidence, but the default-
   VOLATILE `resolve_candidate_list_evidence` function cannot support the
   one-statement snapshot claim. The evaluator must inline its bounded union.
4. A purpose-bound recipient HMAC is sufficient for eligibility equality. No
   stored recipient plaintext or ciphertext is needed because later egress
   must resolve the live canonical recipient again.
5. Current ledger uniqueness means every `claimed`, `sent`, or `ambiguous`
   row remains blocking regardless of age until a separate ledger-policy
   migration changes that invariant.
6. A separate normalized plaintext projection is the minimum bounded design
   for existing suppression checks. It stores only normalized email, domain,
   and LinkedIn identity; the attestation store remains HMAC-only.
7. 0068 and 0069 remain no-egress. If a caller needs a reusable send token, contact
   export, or provider action from this slice, stop and re-plan.

Each assumption has a direct database test. A failed assumption reopens the
design before implementation continues.

### 5. What is the strongest counter-narrative?

An eligibility table can become compliance theatre if the real send paths do
not enforce it. That criticism is correct for the current product: 0063 still
resolves recipients from `public.candidates`, and the synchronous email route
does not consume this future authority. Therefore 0069 is deliberately a
read-only assessment plus evidence lifecycle, never a claim that Gmail,
Microsoft 365, or HeyReach is safe. The master plan keeps egress integration
and authorized provider canaries as later required gates.

### 6. What is explicitly out of scope?

- contact export, CSV, or returning an email or LinkedIn URL;
- campaign creation, enrollment, scheduling, task mutation, or approvals;
- message composition, queue insertion, provider calls, or provider receipts;
- Gmail, Microsoft, HeyReach, LinkedIn, Flowise, DeerFlow, or Graphify runtime
  changes;
- changing the 0067 membership revision when identity projection or eligibility
  evidence changes;
- changing the permanent outreach-ledger uniqueness policy;
- UI, HTTP routes, shared API quota, or production activation.

## Locked assumptions

- Exact 0067 predecessor forward SHA-256:
  `ae101d72145094b21e44694c3c00b37b3b0824c9ab1bb9780f65d9608ff1d4dd`.
- Exact 0067 predecessor rollback SHA-256:
  `ef77b9aae9cb5252d3e09adc9ffa4937ba2ef40d8387388c1ad5f3d1bf2ccdc7`.
- Channels are exactly `Email` and `LinkedIn`. HeyReach is a transport, not a
  channel or an entitlement.
- Existing rows are never backfilled into eligibility evidence. Derived
  identity projection rows require an explicit resumable backfill before the
  runtime readiness gate can pass.
- Recipient plaintext and ciphertext are absent from the attestation table,
  operation receipts, responses, errors, logs, and Relay evidence. The private
  projection stores only normalized email, normalized domain, and canonical
  LinkedIn URL because the existing suppression table is plaintext.
- Every attested fact is bound to an immutable list `member_id`, channel, and
  exact canonical recipient HMAC.
- Public evaluation is a current, non-authorizing page snapshot. It mints no
  reusable token and takes no long-lived candidate locks.
- No outreach-ledger row and `skipped`-only history are safe. A present
  unsupported status fails closed.
- An active legal hold alone is not a do-not-contact rule. An erasure request
  blocked by that hold remains an outreach denial.

READY TO BUILD: NO, pending the two required re-reviews below.

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
  0069 does not reuse it. The minimized projection is plaintext, owner-only,
  forced-RLS, derived, and governed by the existing erasure authority.
- `public.candidates` catches projection errors, collapses duplicate canonical
  keys with `DISTINCT ON`, and has writers and consumers outside list
  authority. It remains non-authoritative.
- The Fly migration runner currently wraps every numbered migration in one
  transaction under a transaction-scoped advisory lock. It cannot execute
  `CREATE INDEX CONCURRENTLY` without an explicit session-locked split.

## Artifacts

- `supabase/migrations/0068_candidate_outreach_eligibility_online_indexes.sql`
  with exact first-line marker
  `-- aria:migration-mode=nontransactional-concurrent-index-v1`;
- `supabase/rollbacks/0068_candidate_outreach_eligibility_online_indexes.sql`
  with exact first-line marker
  `-- aria:rollback-mode=nontransactional-concurrent-index-v1`;
- `supabase/migrations/0069_candidate_outreach_eligibility_authority.sql`;
- `supabase/rollbacks/0069_candidate_outreach_eligibility_authority.sql`;
- `supabase/rollbacks/0067_candidate_list_set_preview_authority.sql` for the
  full/partial 0068-and-later refusal guard;
- `tests/candidate-outreach-eligibility-db.sh`
- `tests/bootstrap-contract.mts`; the focused PostgreSQL 17 online-index
  crash/retry proof remains inside
  `tests/candidate-outreach-eligibility-db.sh`;
- `docker/bootstrap/run.fly.sh` for the exact session-locked online segment and
  one-workspace-per-transaction projection backfill;
- `src/lib/readiness.ts`, `src/app/api/ready/route.ts`, and
  `tests/readiness.mts` so production readiness includes the service-safe
  projection boolean;
- `scripts/sourcing-activation-gate.mjs` and
  `tests/sourcing-activation-gate.mts` for the new readiness component;
- `tests/db/function-privileges.sql`,
  `docker/bootstrap/legacy-table-inventory.txt`,
  `docker/bootstrap/legacy-baseline-invariants.sql`,
  `docker/bootstrap/legacy-baseline-public-schema.sha256`, and
  `tests/recovery-schema-allowlists.mts` for exact privilege, recovery, and
  schema identity;
- canonical test-manifest registration;
- function privilege, legacy inventory, schema digest, and Fly migration
  preflight updates required by the new surface;
- `_relay/codex-findings.md`, Relay archive, and fresh handoff evidence.

## 0068 nontransactional online-index foundation

0068 is a prerequisite, not eligibility authority. It contains exactly five
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` statements:

```sql
create unique index concurrently if not exists
  candidate_list_members_workspace_member_key
  on public.candidate_list_members (workspace_id, member_id);

create index concurrently if not exists
  suppression_list_email_domain_normalized_lookup_idx
  on public.suppression_list (
    workspace_id,
    type collate pg_catalog."C",
    (pg_catalog.lower(pg_catalog.btrim(value))) collate pg_catalog."C",
    expires_at desc nulls first,
    id
  ) where type in ('email','domain');

create index concurrently if not exists
  suppression_list_linkedin_normalized_lookup_idx
  on public.suppression_list (
    workspace_id,
    (public.normalize_linkedin_profile_url(value)) collate pg_catalog."C",
    expires_at desc nulls first,
    id
  ) where type = 'linkedin';

create index concurrently if not exists
  outreach_ledger_candidate_status_lookup_idx
  on public.outreach_ledger (
    workspace_id,
    candidate_id collate pg_catalog."C",
    status collate pg_catalog."C",
    at desc,
    id
  );

create index concurrently if not exists
  outreach_ledger_candidate_unknown_status_lookup_idx
  on public.outreach_ledger (
    workspace_id,
    candidate_id collate pg_catalog."C",
    id
  ) where status is null
       or status not in ('claimed','sent','ambiguous','skipped');
```

`IF NOT EXISTS` is never trusted by name. Exact catalog preflight and postflight
pin table OID, owner, ordinary btree access method, uniqueness, key count and
order, expression tree, C collations, opclasses, direction/null bits,
predicate, no INCLUDE columns, and `indisvalid`, `indisready`, and `indislive`.
The LinkedIn normalizer is pinned as owner-only, immutable, strict, invoker,
and exact-body before its expression index is accepted.

The Fly runner keeps one restricted-postgres session and changes the shared
schema lock to session scope. The exact phases are:

1. T1 applies and ledgers 0001 through 0067, then commits.
2. Autocommit executes the five statements in only the exact marked 0068 file.
3. T2 locks, performs exact postflight, writes the 0068 completion receipt,
   and commits immediately.
4. T3 applies and ledgers 0069 and later files, then commits and notifies.

One session advisory lock spans all four phases and is explicitly released
after T3. The runner rejects either marker on another filename, either exact
filename without its byte-exact first-line marker or with a BOM/leading byte,
multiple marked files, a noncanonical ledger filename, hash drift, or
0069-or-later without exact 0068.

Unledgered states are exactly: all five absent; any mixture of absent and exact
valid artifacts; or one inactive exact-invalid artifact left by an interrupted
build. The last state may be dropped concurrently only when it is live, has no
constraint or other dependency, and has no matching
`pg_stat_progress_create_index` row. An incompatible shape, active build,
dependency, non-live dropping artifact, or ledgered drift refuses without
mutation. No row count or guessed SQL statement timeout is used.

The migration ledger row is a completion receipt, not a claim that all five
DDL statements were atomic. While the session lock remains held, a short final
transaction first locks `public.aria_schema_migrations` in `SHARE` mode, which
conflicts with the `ROW EXCLUSIVE` mode taken by an ordinary ledger insert.
It then locks the three indexed tables in canonical order with
`SHARE UPDATE EXCLUSIVE`, repeats the exact catalog and ledger postflight, and
inserts the exact filename and SHA with no conflict fallback. A crash before
the receipt leaves adoptable exact artifacts; a crash in the receipt
transaction rolls back only the row; a crash after the receipt leaves a safe
foundation. Every retry revalidates exact state.

The 0068 reverse contract is ledgerless-disposable only and runs only after
ledgerless exact 0069 rollback removes every dependency. It refuses before
mutation if the 0068 or any later ledger row exists. It drops the
unknown-status, general-ledger, LinkedIn suppression, email/domain suppression,
and member unique indexes concurrently in that order and verifies exact
absence. It never deletes migration history and never runs inside
`--single-transaction`. Production reversal requires a new reviewed forward
migration.

## Schema contract

### Tenant-bound member generation

0068 creates the exact unique index:

```sql
candidate_list_members_workspace_member_key
  on public.candidate_list_members (workspace_id, member_id)
```

This binds evidence to one immutable membership generation. Removing and
re-adding the same campaign/candidate creates a different `member_id`; stale
eligibility evidence cannot attach to the new generation.

PostgreSQL 17 permits the future composite FK to reference this unique index
directly. Do not attach it to a unique constraint because dropping that
constraint would also drop the index and make a clean 0069-to-0068 rollback
impossible.

### Strict canonical identity projection

0069 adds two owner-only, forced-RLS tables. Runtime roles receive no table or
sequence rights.

```text
public.candidate_outreach_identity_projection_state
  workspace_id uuid primary key
  projection_version text = candidate_outreach_identity_v1
  source_updated_at timestamptz not null
  candidate_shape text in (array, missing, invalid)
  source_element_count integer not null check >= 0
  projected_key_count integer not null check >= 0
  invalid_element_count integer not null check >= 0
  projected_at timestamptz not null
```

`workspace_id` references `workspace_state(workspace_id) on delete cascade`.

```text
public.candidate_outreach_identity_projection
  workspace_id uuid not null
  campaign_id text collate "C" not null
  candidate_id text collate "C" not null
  occurrence_count integer not null check > 0
  email_normalization_version text = email_lower_trim_ascii_v1
  email_normalized text
  email_domain_normalized text
  linkedin_normalization_version text = canonical_v2
  linkedin_normalized text
  primary key (workspace_id, campaign_id, candidate_id)
```

The projection row references its projection-state workspace with
`on delete cascade`. It also has
`(workspace_id,candidate_id,campaign_id)` for candidate-global erasure. It has
no reverse email or LinkedIn index because 0069 has no reverse-identity query.

Row checks require the governed campaign/candidate grammar. A single canonical
occurrence stores only normalized email, its normalized domain, and canonical
LinkedIn URL. Invalid identities normalize to null. Multiple occurrences retain
`occurrence_count > 1` and null every recipient field. Stored recipients must
round-trip through the exact normalizers, and domain is null exactly when email
is null. Names, phones, raw JSON, provider payloads, evidence, and source
metadata are forbidden.

An ordinary owner-only replacement helper groups the canonical candidate array
before insertion. Missing or non-array candidate shape is recorded in the
head. Invalid elements are counted and skipped without hiding duplicate valid
keys. A nonblocked or completed candidate erasure subject is excluded so stale
workspace JSON cannot rehydrate contact PII. The helper never reads or writes
`public.candidates`.

The strict trigger is exactly
`workspace_state_candidate_outreach_projection_sync`, `AFTER INSERT OR UPDATE`
on `workspace_state`, row-level, always enabled, and without a `WHEN` filter.
Its lexical order is after the existing candidate-list authority guard. If
candidates changed or the head is absent, it replaces the workspace projection;
otherwise it advances the head timestamp. It writes the head last, never catches
an exception, and aborts the complete workspace write with SQLSTATE 55000 on
projection infrastructure failure.

Exact private routines are:

```sql
public.replace_candidate_outreach_identity_projection(
  uuid, jsonb, timestamptz
) returns jsonb
public.candidate_outreach_identity_projection_lock_key(uuid) returns bigint
public.sync_candidate_outreach_identity_projection() returns trigger
public.backfill_candidate_outreach_identity_projection(uuid) returns jsonb
public.candidate_outreach_identity_projection_ready() returns boolean
```

Only the final readiness function is granted to `service_role`; it returns one
boolean and no workspace, candidate, or recipient material. It is
PostgreSQL-owned, SQL, `STABLE`, `SECURITY DEFINER`, and has the exact search
path `pg_catalog, public, pg_temp`. Revoke EXECUTE from `public`, `anon`,
`authenticated`, `authenticator`, `service_role`, and inherited custom roles
before granting it only to `service_role`.

The replacement, lock-key, trigger, and backfill routines remain owner-only.
The sync trigger function is PostgreSQL-owned `SECURITY DEFINER` with exact
secure search path `pg_catalog, public, extensions, pg_temp`; all
public/runtime EXECUTE grants are revoked. Exact `pg_proc`, owner, ACL,
language, volatility, security, search-path, trigger events, enablement, and
function-body fingerprints are migration and rollback postflight requirements.
Forced-RLS owner policies permit only `postgres` and `supabase_admin`.

The shared projection transaction lock is exactly
`pg_advisory_xact_lock(candidate_outreach_identity_projection_lock_key(workspace_id))`.
The key is the signed bigint from
`hashtextextended('candidate-outreach-identity-projection-v1:' ||
workspace_id::text, 0)`. Sync and backfill take it after locking the exact
workspace-state row and before reading erasure state or replacing projection
rows. Erasure/hold replay takes it after the accepted candidate-global legal-
hold and identity locks and before deleting projection/evidence. No projection
path acquires a candidate lock after this projection lock, which prevents a
reverse cycle.

The projection is usable only when the evaluator's single statement proves
the same workspace, exact projection version, and
`source_updated_at IS NOT DISTINCT FROM workspace_state.updated_at`. A missing,
stale, missing-shape, or invalid-shape head makes attestation return
`authority_unavailable` without a receipt and makes evaluation return
`identity_authority_unavailable`, no items, no cursor, and
`restart_required=true`.

Existing workspaces are backfilled outside the migration transaction in small
committed batches. The Fly runner selects one missing/stale workspace in UUID
order, calls the exact owner-only backfill routine in its own transaction, and
repeats until none remain. The routine locks that workspace state `FOR SHARE`,
takes the exact shared projection transaction lock, re-reads erasure state,
replaces rows, and
writes the head last. A failed workspace rolls back its call and is never
marked complete or silently skipped. A later protected retry resumes from
current heads. Runtime readiness stays false until every workspace has a
current head and every current candidate-list member resolves to one projection
key. A workspace without an array may have a current head, but a list in that
workspace cannot evaluate.

`/api/ready` adds `components.candidateIdentityProjection`. Production requires
it to be true. The route invokes only the service-granted boolean readiness
function; a false value, RPC error, malformed response, missing function, stale
head, or uncovered list member keeps readiness false. The sourcing activation
gate and readiness contract tests require the new component before release.
Barrier tests cover both race orders between backfill/sync and hold release or
erasure cleanup. A snapshot taken while a hold is blocked can never commit
rehydrated recipient PII after the release cleanup commits.

### New append-only table

Create:

```sql
public.candidate_outreach_eligibility_attestations
```

Required columns:

- `id bigint generated always as identity primary key`;
- `attestation_ref uuid not null default gen_random_uuid()`;
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
- `supersedes_ref uuid`.

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

- direct tenant FK `workspace_id` to `workspaces(id) on delete cascade`;
- tenant-bound FK `(workspace_id,member_id)` to
  `candidate_list_members(workspace_id,member_id) on delete no action`;
- tenant-bound recorder FK `(workspace_id,recorded_by)` to profiles with
  `on delete no action`;
- unique public-handle key `(workspace_id,attestation_ref)`;
- unique referenced key
  `(workspace_id,member_id,channel,attestation_kind,attestation_ref)`;
- self-FK
  `(workspace_id,member_id,channel,attestation_kind,supersedes_ref)` to that
  exact key with `on delete no action`;
- one root per member/channel/kind;
- one child per predecessor;
- descending current-leaf lookup
  `(workspace_id,member_id,channel,attestation_kind,id desc)` including the
  decision and evidence fields required by evaluation;
- erasure lookup `(workspace_id,member_id,id)`;
- member erasure lookup
  `candidate_list_members(workspace_id,candidate_id,member_id)`;
- roots must be attested; a revoke must supersede an attested current leaf;
- every successor has later `observed_at` and a greater `id` than its
  predecessor;
- context, recorder, evidence digest, and recipient binding are immutable.

The current leaf is always `order by id desc limit 1` for one exact scope. The
one-root, one-child, and increasing-ID invariants make this bounded row the only
possible leaf. History traversal and `NOT EXISTS(successor)` are forbidden.

Append-only guards reject update, ungoverned delete, and truncate. Delete
is allowed only for an enclosing workspace deletion or one exact nonblocked
governed erasure request carried by the established transaction-local cleanup
settings. Direct member deletion and list cascade are refused while evidence
exists. 0069 adds no ordinary list/member deletion API; erasure deletes
eligibility before members.

Exact lifecycle routines/triggers are:

```text
enforce_candidate_outreach_eligibility_insert()
  <- candidate_outreach_eligibility_before_insert
guard_candidate_outreach_eligibility_mutation()
  <- candidate_outreach_eligibility_mutation_guard (UPDATE OR DELETE, row)
  <- candidate_outreach_eligibility_truncate_guard (TRUNCATE, statement)
```

All are PostgreSQL-owned, owner-only, `SECURITY DEFINER` only where required,
and pinned by exact catalog/ACL/body postflight. The direct workspace cascade,
member/list refusal, unrelated nested cascade refusal, governed erasure, and
full workspace delete each have a real PostgreSQL test.

The bigint `id` is internal ordering only and is never returned or accepted by
a public RPC. Public lifecycle calls and receipts use `attestation_ref`, a
workspace-bound random UUID. The delete guard permits the direct workspace FK
cascade only at nested trigger depth when the parent workspace is absent in the
same statement; it does not treat unrelated cascades as workspace deletion.

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

The recipient HMAC is exactly
`sourcing_authority_hmac(workspace_id, jsonb_build_array(...)::text)` over:

```text
candidate_outreach_recipient_v1
workspace_id::text
channel
recipient_identifier_kind
recipient_normalization_version
canonical_recipient
```

LinkedIn first calls the existing canonical profile normalizer. The canonical
recipient appears only in this transient input. There is no encryption helper
in 0069. Later egress must resolve the canonical recipient fresh and compare
this HMAC immediately before contact.

Every timestamp entering a HMAC is rendered as fixed UTC with six fractional
digits using:

```sql
to_char(value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
```

The exact request payload is a JSON array in this order:

```text
candidate_outreach_eligibility_request_v1
workspace_id::text, actor_id::text, member_id::text, list_id::text
campaign_id, candidate_id, channel, attestation_kind, decision, value_code
recipient_identifier_kind, recipient_normalization_version
recipient_hmac_sha256, canonical_observed_at_text
source_evidence_sha256, supersedes_ref::text, idempotency_key::text
```

UUIDs and bigint values are JSON strings; SQL nulls are JSON null. Uppercase
digests are rejected. Raw `p_recipient` is not included, so canonically equal
aliases have one normalized request identity.

The `BEFORE INSERT` trigger computes the record HMAC after `id`, `recorded_at`,
and member-derived identity are populated. Its exact JSON array is:

```text
candidate_outreach_eligibility_record_v1
id::text, attestation_ref::text, workspace_id::text, recorded_by::text
member_id::text, list_id::text
campaign_id, candidate_id, channel, attestation_kind, decision, value_code
recipient_identifier_kind, recipient_normalization_version
recipient_hmac_sha256, source_evidence_sha256
canonical_observed_at_text, canonical_recorded_at_text, supersedes_ref::text
```

The stored HMAC is `sourcing_authority_hmac(workspace_id,payload::text)`. The
trigger derives list, campaign, and candidate from the locked member; callers
cannot supply them. Workspace HMAC secret update/deletion is refused while any
eligibility row or `attest_eligibility` receipt depends on it, except enclosing
workspace deletion. The first attestation may create the existing 32-byte
workspace secret under the accepted workspace lock order.

## Idempotency receipt contract

Reuse `candidate_list_operation_receipts`. Extend its exact operation and
subject constraints with `attest_eligibility`; do not add a second receipt
table.

- `list_id` is the member's exact list.
- `candidate_subject_hmac` remains the existing campaign/candidate erasure
  subject so identity-global cleanup removes the new receipt.
- `request_hmac_sha256` uses the exact normalized payload above.
- Erasure and canonical candidate checks happen before replay.
- Exact replay returns the original success result.
- Same key with changed normalized input returns `idempotency_conflict`.
- Replay lookup occurs only after erasure, projection freshness, canonical
  candidate, current leaf, and recipient-binding checks.
- Only successful attestation or revocation is receipted. Missing authority,
  stale predecessor, and validation denials create no receipt.
- The result contains only status and the workspace-bound UUID
  `attestation_ref`.

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
  p_supersedes_ref uuid,
  p_idempotency_key uuid
) returns jsonb
```

Authority and behavior:

- the function is PostgreSQL-owned, PL/pgSQL, `VOLATILE`,
  `SECURITY DEFINER`, and has exact search path
  `pg_catalog, public, extensions, pg_temp`;
- revoke EXECUTE from `public`, `anon`, `authenticated`, `service_role`,
  `authenticator`, and inherited custom roles before granting it only to
  `authenticated`;
- require `auth.role() = authenticated`, active identity, active workspace,
  and exact profile role `admin`;
- derive actor and workspace from the principal, never arguments;
- resolve the globally unique member without disclosing a foreign member;
- lock `workspace_state FOR SHARE`, require a current usable projection head,
  and require one unambiguous projection row matching member campaign and
  candidate;
- for `attested`, require `p_recipient`, normalize it, and require exact
  equality with the projected channel identity;
- for `revoked`, require `p_recipient IS NULL` and copy identifier kind,
  normalization version, and recipient HMAC from the locked predecessor;
- never infer any eligibility fact from candidate JSON, list provenance,
  provider payload, model output, or `public.candidates`;
- accept only `preprovided` for privacy notice;
- reject an observation more than five minutes in the future;
- record new revocation evidence while preserving only the predecessor
  recipient binding;
- return `candidate_not_found` for absent, erased, foreign, or canonical-missing
  identity without disclosing which check failed;
- return `predecessor_conflict` for a stale or invalid lifecycle predecessor;
- never return recipient, HMAC, source digest, recorder, or canonical candidate
  material.

The exact linear lifecycle is:

1. no leaf to `attested`: null predecessor, required current recipient;
2. `attested` to `revoked`: exact predecessor, null recipient, null value;
3. `revoked` to `attested`: exact predecessor, required current recipient;
4. every other transition: `predecessor_conflict` and no row or receipt.

Recipient drift makes old attestations ineligible but cannot strand revocation.
An admin revokes the old leaf without the old plaintext, then may re-attest
against the new projected recipient. Supplying a recipient on revocation is a
validation error.

Mutation lock order:

1. idempotency advisory key;
2. exact active auth identity and profile rows `FOR NO KEY UPDATE`, with role
   and workspace revalidated from those locked rows;
3. exact workspace-state row `FOR SHARE`;
4. candidate-global legal-hold advisory namespace `1095911745`;
5. sorted erasure identity advisory keys for candidate ID and, for attestation,
   the current channel recipient;
6. exact shared projection workspace advisory key;
7. existing campaign/candidate contact-evidence advisory key;
8. exact member row `FOR KEY SHARE`;
9. one member/channel eligibility advisory key shared by all three kinds;
10. current predecessor `FOR NO KEY UPDATE`;
11. existing receipt row `FOR UPDATE`.

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

The function is PostgreSQL-owned, PL/pgSQL, `STABLE`, `SECURITY DEFINER`, and
has exact search path `pg_catalog, public, extensions, pg_temp`. Revoke EXECUTE
from `public`, `anon`, `authenticated`, `service_role`, `authenticator`, and
inherited custom roles before granting it only to `authenticated`. Migration,
retry, and rollback postflight pin both public RPCs and the readiness bridge by
exact `pg_proc` signature, owner, language, volatility, `prosecdef`,
`proconfig`, ACL, and function-body fingerprint. No default invoker-mode copy
is accepted.

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
          "authority_ref": "64-lowercase-hex"
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
`restart_required=true`, and no list content. Missing or malformed workspace
HMAC authority returns top-level `authority_unavailable`; a missing or stale
projection head returns `identity_authority_unavailable`. Both return no items,
no cursor, and no fabricated references.

Every reason has a non-null privacy-safe `authority_ref`. It is the lowercase
HMAC over this exact array using the one captured workspace key:

```text
candidate_outreach_evidence_ref_v1
workspace_id::text, list_id::text, member_id::text, channel
reason_code, authority_kind, internal_source_key
```

`internal_source_key` is the member ID for missing authority, the chain scope
for ambiguity, or an authority-type-prefixed internal row ID for an existing
block. If multiple rows produce one reason, the deterministic lowest primary
key is selected. At most one entry per code is returned. No response returns a
raw attestation, suppression, erasure, tombstone, ledger, sequence, receipt, or
compliance-case ID, recipient, HMAC input, digest, recorder, provider pointer,
source payload, narrative, or evidence timestamp.

The evaluator is a current page snapshot, not a stable eligibility generation.
Eligibility evidence can change without advancing membership revision. It
computes list revision, at most `p_limit + 1` members, and all reasons in one
final SQL statement. Materialized CTEs capture one instant, one workspace key,
the authorized list/revision, the bounded member page, projection/head,
inlined provenance, leaves, suppression, erasure, tombstone, ledger, sequence,
reason references, and page JSON. Only the first `p_limit` members reach
eligibility branches.

The first materialized CTE derives `auth.uid()`, exact `auth.role()`, active
identity, current profile workspace and role, and authorized list from the live
authority tables. Every page and eligibility branch joins through that CTE.
Only argument shape/range validation may precede the final statement; no
principal, workspace, role, list, or disclosure decision may be cached from an
earlier statement.

The final statement must not invoke `resolve_candidate_list_evidence`,
`sourcing_authority_hmac`, or another table-reading PL/pgSQL helper. It inlines
the bounded provenance union, captures the key once, and uses pure pgcrypto
HMAC expressions. Pure normalizers with no table reads may be called. No second
query may enrich or rewrite its result. It takes no advisory or row locks and
performs no write.
Pages are current independently and must not be aggregated as one point-in-time
eligibility snapshot. Later send integration rechecks under mutation locks.

## Eligibility decision contract

The evaluator requires all of the following for each item:

1. one fresh projection row with `occurrence_count = 1` for member campaign and
   candidate;
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
3. `erasure_requested`
4. `erasure_tombstoned`
5. `provenance_missing`
6. `provenance_revoked`
7. `provenance_expired`
8. `provenance_ambiguous`
9. `provenance_mismatch`
10. `contact_identity_missing`
11. `contact_identity_revoked`
12. `contact_identity_ambiguous`
13. `contact_identity_mismatch`
14. `lawful_basis_missing`
15. `lawful_basis_revoked`
16. `lawful_basis_ambiguous`
17. `privacy_notice_missing`
18. `privacy_notice_revoked`
19. `privacy_notice_ambiguous`
20. `recipient_suppressed`
21. `recipient_domain_suppressed`
22. `contact_claim_active`
23. `contact_outcome_ambiguous`
24. `recently_contacted`
25. `contact_history_locked`
26. `contact_ledger_unknown`
27. `active_enrollment`

Ledger mapping:

- `claimed`, any age: `contact_claim_active`;
- `ambiguous`, any age: `contact_outcome_ambiguous`;
- `sent` at most 90 days old: `recently_contacted`;
- older `sent`: `contact_history_locked` because the permanent unique index
  still blocks a new claim;
- no row or only `skipped` rows: no ledger denial;
- a present row with another non-null status: `contact_ledger_unknown`.

`outreach_ledger.status` remains pinned `NOT NULL`. An outer-join null means
absence, not unknown. All applicable reasons are returned in fixed order, then
by internal source key before reference construction.
Eligibility is true only when the reason array is empty.

## Suppression and bounded-plan contract

Email evaluates exact normalized recipient and extracted domain. LinkedIn uses
canonical-v2 normalization. Expired suppression rows are ignored.

0068 supplies the normalized indexes. For each fixed literal type and identity,
the evaluator performs two separate ordered index-range probes: one for
`expires_at IS NULL LIMIT 1`, and one for
`expires_at > evaluated_at LIMIT 1`. It combines only those two at-most-one-row
results. One OR predicate, BitmapOr, parameterized suppression type, or scan of
expired aliases is forbidden.

With at least 10,000 list members,
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` must prove:

- the member driver consumes at most `p_limit + 1` rows;
- no sequential scan of `candidate_list_members`;
- each canonical candidate, head attestation, suppression, erasure, ledger,
  tombstone, and live-sequence branch is an indexed bounded probe;
- actual work multiplies rows by loops;
- every sort, hash, aggregate, or materialization consumes an already bounded
  source;
- output cardinality alone is never accepted as bounded traversal evidence.

Adversarial fixtures add 50,000 to 100,000 `skipped` ledger rows for one
candidate with no unknown status and 10,000 normalized expired suppression
aliases with no active row. The unknown partial index and the separate null and
future suppression ranges must consume zero qualifying tuples without work
proportional to history. Null-expiry and future-expiry hits consume at most one
row. A 50,000-candidate workspace also measures projection replacement and
backfill latency; source does not assume the live workspace count or duration.

## RLS, ACL, erasure, and rollback

- Enable and force RLS on all three new tables.
- Install owner access only for `postgres` and `supabase_admin`.
- Revoke table and identity-sequence rights from public, anon, authenticated,
  service_role, authenticator, and inherited custom roles.
- Revoke every private helper from all runtime roles.
- Grant only the readiness bridge to `service_role` and the two
  PostgreSQL-owned security-definer public RPCs to `authenticated`; enforce
  their different member/admin versus admin-only roles inside the functions.
- Register every function in the exact privilege matrix and legacy inventory.
- Extend the candidate-erasure receipt store allowlist with
  `candidate_outreach_identity_projection` and
  `candidate_outreach_eligibility_attestations`.
- Add owner-only function
  `public.cleanup_erased_candidate_outreach_authority()` and exact trigger
  `candidate_erasure_requests_0069_outreach_cleanup`, `AFTER INSERT OR UPDATE`
  on `candidate_erasure_requests`, row-level, always enabled, with exact
  qualification `WHEN (new.status <> 'blocked_legal_hold')`. Never call a
  retained trigger function as an ordinary function.
- The exact trigger name sorts before
  `candidate_erasure_requests_candidate_lists_cleanup`. Catalog and behavior
  tests require that order so 0069 evidence is deleted before the 0065 member
  delete reaches the NO ACTION FK.
- `blocked_legal_hold` preserves rows but remains ineligible through
  `erasure_requested`.
- Hold release and erasure replay use the same candidate-global order. The 0069
  trigger sets `aria.candidate_outreach_erasure_cleanup=on` and the exact
  request ID, takes the shared projection lock after accepted upstream legal-
  hold/identity locks, snapshots affected members through
  `(workspace_id,candidate_id,member_id)`, deletes eligibility rows, deletes
  projection rows, inserts exact scrub counts for both new stores, and clears
  its settings. The lexically later accepted 0065 trigger then derives subject
  HMACs, deletes every matching candidate-list operation receipt including
  `attest_eligibility`, deletes members and contact evidence, and records its
  existing counts. 0069 does not duplicate or call that trigger.
- The projection replacement helper excludes nonblocked and completed erasure
  subjects, so a later workspace-state scrub cannot rehydrate stale contact
  identity.
- Candidate-global erasure removes projection and eligibility across every
  campaign carrying that candidate ID while preserving other workspace and
  tenant data.
- Eligibility changes never advance `membership_revision`.

Rollback acquires the shared schema lock and refuses with SQLSTATE 55000 before
mutation if any eligibility attestation, `attest_eligibility` receipt, or
durable erasure receipt for either new store exists, including a zero-row scrub
after live data has gone. Derived projection rows/heads alone do not block.
It also refuses before mutation if the 0069 or any later migration is ledgered;
production reversal requires a new reviewed forward migration.
Empty 0069 rollback drops strict sync and erasure triggers, helpers, evidence,
and projection tables, then restores the exact 0068 schema, receipt constraints,
ACLs, policies, inventories, and functions. It refuses partial or later
authority including any reserved object, overload, custom ACL, disabled/false
trigger, dependency, or function-body drift. A second clean rollback is
idempotent in the ledgerless disposable fixture; reapply restores one exact
0069 fingerprint.

0067 rollback refuses while any full or partial 0068 or 0069 authority exists.
0068 reverse runs only after exact 0069 rollback as defined above.

## RED-first test contract

The committed harness is amended before production SQL and accepts only
`--prove-red R1`, `--prove-red R2`, or no argument. The no-argument manifest
mode keeps the canonical gate green: it returns zero with an explicit SKIP only
for a complete clean expected missing stage, fails every partial/unexpected
state, and runs the full green suite once 0069 exists. RED proof modes are
manual evidence commands and intentionally exit 1 only at their exact boundary.

Stage R1 applies exact history through 0067 and verifies the accepted
foundation. Its clean missing state requires: no forward or reverse source file
matching `0068_*.sql`; no 0068 ledger row; and all five reserved index names
absent. It does not require the split runner that E1.2 builds later.
`--prove-red R1` then exits 1 with exactly:

```text
candidate-outreach-eligibility-db RED: online index foundation is absent after exact 0067
```

Once both canonical 0068 files exist, the harness requires their exact
filenames and byte-exact markers, the session-locked runner mode, all online
catalog/retry/recovery assertions, and the exact 0068 SHA completion receipt.
Those 0068 assertions live between R1 and R2.

Stage R2 requires the complete exact 0068 catalog/fingerprint/receipt, no
forward or reverse source file matching `0069_*.sql`, no 0069 ledger row, and
absence of the complete reserved 0069 surface:

- `candidate_outreach_identity_projection_state`;
- `candidate_outreach_identity_projection`;
- `candidate_outreach_eligibility_attestations`;
- every sequence, constraint, index, policy, ACL, trigger, function, comment,
  and receipt-constraint change whose name/domain is reserved by this plan;
- every exact projection, HMAC, lifecycle, erasure, backfill, and readiness
  routine or trigger named above;
- `attest_candidate_outreach_eligibility(uuid,text,text,text,text,text,timestamptz,text,uuid,uuid)`;
- `evaluate_candidate_list_outreach_eligibility(uuid,bigint,text,text,text,integer)`.

`--prove-red R2` then exits 1 with exactly:

```text
candidate-outreach-eligibility-db RED: identity projection, eligibility attestation, and revision-bound evaluation authority are absent after exact 0068
```

Any partial object, source file, ledger row, wrong marker, transactional
concurrent-index attempt, or migration without exact reverse is an inconsistent
failure. Only 0069 green assertions live below R2.

Commit `474172e` is historical evidence for the superseded one-stage probe. It
is not accepted R1 or R2 evidence. The amended no-argument harness must exit 0
before its corrective commit, while both explicit proof modes are recorded with
their exact intentional RED exits at the appropriate stage.

The existing manifest registration remains exactly:

- command after `candidate-list-set-preview-db`;
- one `pretest` group entry;
- one `database` group entry;
- one `expectedDatabaseIds` entry in `tests/test-manifest-contract.mts`.

No new package script is added.
No-argument manifest execution is green or a verified clean-stage SKIP; it is
never the intentional RED command.

Required green phases:

1. 0068 exact marker/catalog, populated online build, crash/retry, hash receipt,
   writer liveness, no-op replay, ledgerless reverse, and ledgered refusal;
2. 0069 exact catalog, no evidence backfill, forward retry, unchanged
   predecessor data;
3. strict security-definer projection replacement, shared-lock erasure races,
   duplicates, invalid identities, resumable backfill, freshness, and no
   `public.candidates` dependency;
4. admin-only lifecycle, opaque references, normalization, exact HMAC fixtures,
   workspace deletion, replay/conflict;
5. root, successor, recipient drift, revoke, re-attest, stale predecessor, and
   fork races;
6. revision protocol, no disclosure, inlined live principal/provenance exact
   match, and one-statement snapshot;
7. every individual reason, combined fixed ordering, privacy-safe references,
   and fully eligible case;
8. exact email, domain, LinkedIn suppression and expiry;
9. tombstone, missing-secret, open erasure, trigger order, hold/release versus
   backfill race, global cleanup, and workspace deletion;
10. absent, claimed, sent, ambiguous, skipped-only, and unsupported ledger
    states;
11. all four live sequence states and terminal sequence controls;
12. deterministic attestation-versus-erasure and idempotency races;
13. bounded adversarial EXPLAIN proof for page, history, and suppression;
14. zero changes to messages, outbox, ledger, sequences, jobs, provider
    attempts, provider receipts, and sourcing data;
15. no network-capable SQL call, credential, or provider request;
16. empty rollback, reapply, durable-receipt refusal, partial/later refusal;
17. candidate-list, evidence, erasure, legal-hold, sequence, privilege,
    recovery, invariant, and 0067 regressions.

Tests use observed `pg_stat_activity` barriers, never sleeps, for concurrency.
Erasure proof uses a clean cloned accepted template rather than the large
performance fixture.

## Execution tasks

Every task is one reviewable slice of at most 90 focused minutes.

| ID | SDLC stage | Owner | Duration | Dependency | Checkable deliverable | Verification |
|---|---|---|---:|---|---|---|
| E0.1 | Think | Codex Root | 60 min | 0067 accepted | This amended projection, lifecycle, and online-release contract | Placeholder scan zero and every open finding mapped |
| E0.2 | Review | Banach Schema Preflight | 60 min | E0.1 | Independent schema/runner verdict | Explicit PASS before production SQL |
| E0.3 | Review | Boyle Eligibility Adversary | 60 min | E0.1 | Independent lifecycle/privacy verdict | Explicit PASS before production SQL |
| E1.1 | Test | Dewey Test Architect | 60 min | E0.2,E0.3 | Two-stage RED harness amendment | No-argument mode exits 0; explicit R1 reaches only its exact intentional RED line |
| E1.2 | Build | Codex Root | 90 min | E1.1 | Session-locked split runner and exact marker parser | Bootstrap contract proves one session, T1/T2/T3, and intervening autocommit DDL |
| E1.3 | Build | Lagrange Database QA | 90 min | E1.2 | 0068 five-index file and ledgerless reverse | Exact populated catalog; ledgered reverse refuses before mutation |
| E1.4 | Test | Cicero Recovery QA | 90 min | E1.3 | 0068 interruption, retry, drift, receipt, and reverse phase | Every fault point resumes or refuses without silent repair |
| E1.5 | Test | Dewey Test Architect | 30 min | E1.4 | R2 boundary reached and committed | Exact missing-0069 line after exact 0068 |
| E2.1 | Build | Banach Schema Preflight | 90 min | E1.5 | Projection tables, normalizer, strict replace helper | Catalog, duplicate, invalid, and direct-DML negatives pass |
| E2.2 | Build | Codex Root | 90 min | E2.1 | Security-definer sync, shared lock, resumable backfill, and readiness | Authenticated workspace writes succeed; backfill/release cannot rehydrate; stale head denies |
| E2.3 | Build | Codex Root | 90 min | E2.1 | Attestation table, opaque refs, chain guards, exact HMAC trigger | Catalog, tenant-safe handle, fixed digest, leaf, workspace delete, and immutable-DML pass |
| E2.4 | Build | Codex Root | 90 min | E2.2,E2.3 | Admin attestation RPC and receipt extension | Role, drift/revoke, replay, conflict, and erasure-before-replay pass |
| E2.5 | Build | Dewey Test Architect | 90 min | E2.2,E2.3 | One-statement evaluator with inlined principal/provenance | Revision, current role/workspace, cursor, reasons, references, and page bounds pass |
| E2.6 | Build | Cicero Recovery QA | 90 min | E2.4,E2.5 | Ordered erasure cleanup, guarded 0069/0067 rollbacks | Trigger order, hold race, global cleanup, residue, restore, and refusal pass |
| E2.7 | Release | Lagrange Database QA | 60 min | E2.5,E2.6 | Privilege, inventory, schema digest, and Fly readiness updates | Exact ACL and release contracts pass |
| E3.1 | Test | Dewey Functional QA | 90 min | E2.4,E2.5 | Lifecycle, pagination, reason, and eligible behavior | Focused functional matrix exits 0 |
| E3.2 | Test | Banach Database QA | 90 min | E2.2,E2.5 | Projection, plan, concurrency, and scale phase | No deadlock, stale read, or unbounded branch |
| E3.3 | Security | Noether Security QA | 90 min | E2.5,E2.7 | RLS, ACL, PII, evidence-reference, and no-egress phase | No runtime table DML, raw ID, sensitive output, or side effect |
| E3.4 | Recovery | Cicero Recovery QA | 90 min | E2.6,E2.7 | Rollback, reapply, partial, later, and durable-residue phase | Exact 0068 restore and atomic SQLSTATE 55000 refusals |
| E4.1 | Test | Lagrange Release QA | 90 min | E3.1-E3.4 | Focused regressions and complete repository gate | Predecessor suites and exact full gate exit 0 |
| E4.2 | Review | Boyle Eligibility Adversary | 60 min | E4.1 | Final adversarial verdict and findings reconciliation | Zero open 0068/0069 correctness, security, spec, or test-gap finding |
| E4.3 | Ship | Codex Root | 45 min | E4.2 | Atomic commits, pushed branch, updated PR, fresh Relay baton | Remote SHA readback and current `gh` annotations recorded honestly |

## Dependency graph and parallel work

Critical path:

```text
E0.1 -> E0.2/E0.3 -> E1.1 -> E1.2 -> E1.3 -> E1.4 -> E1.5
E1.5 -> E2.1 -> E2.2 -> E2.5
             \-> E2.3 -> E2.4
E2.4/E2.5 -> E2.6
E2.5/E2.6 -> E2.7
E2.4/E2.5/E2.6/E2.7 -> E3.1/E3.2/E3.3/E3.4
E3.1/E3.2/E3.3/E3.4 -> E4.1 -> E4.2 -> E4.3
```

After E1.5, projection and evidence schema work can proceed in bounded slices.
After E2.7, functional, database, security, and recovery proof run in parallel
against isolated disposable databases.

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
keeps 0068/0069 blocked.

## Spec coverage audit

- Provenance: inlined bounded relation plus exact immutable member snapshot
  comparison in one final statement.
- Lawful basis: explicit admin lifecycle, no inference.
- Privacy notice: explicit `preprovided` lifecycle only.
- Contact identity: fresh strict projection equality plus purpose HMAC; no
  reliance on `public.candidates`.
- Suppression: live email, domain, and canonical LinkedIn checks.
- Erasure: open request, candidate/recipient tombstone, legal-hold behavior,
  candidate-global cleanup, and exact receipt.
- Contact history: all active ledger states, 90-day reason distinction,
  indefinite unique-slot truth, and unknown-state denial.
- Enrollment: all four candidate-global live sequence states.
- Evidence identifier: every denial includes a typed purpose-bound HMAC
  reference and no raw internal ID.
- Tenancy and RBAC: derived workspace, non-disclosing foreign state, admin-only
  writes, member/admin reads, forced RLS, exact ACL.
- Scale: 100-item cap, 10,000-member page oracle, 50,000-candidate projection
  measurement, 100,000-row skipped history, 10,000 expired aliases, and indexed
  bounded probes.
- Recovery: retry, rollback, reapply, partial/later refusal, old rollback guard.
- Side effects: no contact export, queue, provider, or send token. The private
  derived projection is the sole minimized plaintext exception.

Placeholder scan result: zero unresolved owner, deliverable, dependency, or
verification markers.

## Re-plan triggers

- Exact 0067 source or rollback hash changes.
- 0068 catalog preflight finds an incompatible, active, dependent, or ledgered-
  drifted online-index artifact.
- Canonical workspace state cannot provide exactly one current channel identity.
- The permanent ledger unique index changes or a new terminal ledger state is
  governed by a checked database transition.
- Legal or DPO guidance requires a different lawful-basis or notice lifecycle.
- A caller asks 0068/0069 to return contacts, authorize a send, or call a
  provider.
- Query-plan proof exceeds the fixed per-page bounds.
- Any race deadlocks or can commit both conflicting lifecycle successors.

## Executor walkthrough

- Boyle reviewed the eligibility threat model and found the present send paths
  do not consume this authority.
- Banach verified the predecessor schema, rejected the impossible JSON-index
  claim, and required the separate strict projection, exact self-FK key,
  descending leaf lookup, and durable erasure-receipt refusal.
- Nash reviewed the Fly runner and required the exact marked 0068 concurrent-
  index segment, session lock, five exact indexes, completion receipt, and
  resumable crash states.
- Mencius rejected promotion of the best-effort `public.candidates` mirror and
  specified the minimized owner-only projection, strict trigger, backfill, and
  freshness gate.
- Dewey's first re-review rejected the one-stage registered RED probe,
  transaction count, incomplete reserved-surface scan, ledger deletion, and
  missing task ownership. This amendment now uses explicit proof modes while
  keeping the canonical manifest green.
- The first schema/adversarial re-reviews also rejected projection/erasure lock
  separation, invoker trigger authority, cached principal checks, undefined
  cleanup order, missing workspace cascade, and raw global lifecycle IDs. The
  shared lock, security-definer trigger, in-statement principal, ordered cleanup,
  direct workspace FK, and opaque UUID handles above are the corrections.
- The second exact-hash reviews found two remaining execution defects: the T2
  ledger lock did not conflict with ordinary inserts, and the readiness bridge
  plus both public RPCs lacked pinned definer authority after runtime table
  grants were revoked. The separate ledger `SHARE` lock and exact
  PostgreSQL-owned security-definer contracts above are the corrections.
- Banach, Boyle, and Dewey then read and passed all 1,238 lines of exact
  snapshot `239781e8b828dfc6129f3ff8e6305a5027434f9da11d8dff12f4799a2a5003b1`.
  Their verdicts cover schema feasibility, lifecycle/privacy/no-egress, and the
  two-stage RED/release contract. None edited the file under review.
- E1.1 produced harness SHA-256
  `2cd92ad0d9ec65265e29deb0bcef59cffba232d8250a0815e948a002bb675095`.
  Three independent reviews PASS its exact source, including duplicate 0067,
  later-source, malformed-ledger, BOM, NUL, CRLF, missing-LF, and premature-R2
  probes. No-argument mode exits 0 at verified clean R1, explicit R1 exits 1
  only at the pinned RED line, and the exact complete repository gate exits 0.
- Codex Root reconciled the reviews: normalized plaintext exists only in the
  strict projection, attestations remain HMAC-only, revocation survives
  recipient drift, and public denials expose only purpose-bound references.
- Claude Sonnet has not reviewed or executed this plan because the local Claude
  CLI is not authenticated. No Sonnet or Fable execution claim is made.
- Terra is reserved for the final product-wide validation after every roadmap
  phase and four-expert QA lane, not this intermediate slice.

## Plan verdict

The pushed one-stage RED contract at `474172e` is historical and superseded.
The two-stage, canonical-gate-green amendment must be observed and committed
before production SQL.

GO only for E1.1 and its ordered successors under the reviewed proof
boundaries. Before 0068 production SQL, no-argument manifest mode must be green
and explicit R1 must reach its exact intentional RED line. Before 0069, exact
0068 and explicit R2 must pass their pinned contracts. Contact export, sequence
integration, Gmail or Microsoft activation, HeyReach execution, Fly deployment,
real-candidate outreach, and enterprise-ready claims remain blocked.
