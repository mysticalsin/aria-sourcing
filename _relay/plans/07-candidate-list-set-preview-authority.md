# 0067 Candidate-List Set Preview Authority

Status: approved for RED-first implementation. This slice is read-only and
does not authorize export, contact eligibility, campaign enrollment, provider
egress, or outreach.

## Problem and required outcome

The 0064 and 0065 foundations can create lists, admit evidence-bound members,
and read one list page. They do not provide a coherent way to compare two list
generations. Reusing the ordinary member reader for client-side union,
intersection, difference, or exclusion would mix pages if membership changes
between requests and would force the browser to own a security-sensitive set
calculation.

0067 must add a bounded, tenant-bound, read-only preview over two exact list
revisions. A preview returns candidate identity and derived set annotations
only. It must not expose contact data, evidence material, lawful-basis claims,
eligibility conclusions, provider pointers, or workspace-state candidate JSON.

## Scope boundary

In scope:

- one monotonic membership generation on each list;
- exact once-per-statement revision advancement for member insert and delete;
- revision-bound union, intersection, left difference, and exclusion preview;
- bytewise deterministic bounded traversal capped at 100 examined driver rows;
- tenant/RBAC/ACL, concurrency, rollback, retry, and bounded-plan proof.

Explicitly out of scope:

- member removal RPC;
- result-list materialization or bulk mutation;
- eligibility, lawful basis, notice, suppression, recent-contact, or active
  enrollment decisions;
- CSV or contact export;
- shared API quota, HTTP routes, UI, or campaign enrollment;
- provider calls, model calls, candidate sourcing, or outbound contact.

Contact-bearing export remains in P3.6 after P1.3 eligibility and shared quota.
No P1.2 response may be treated as contact or outreach authority.

## Artifacts

- `supabase/migrations/0067_candidate_list_set_preview_authority.sql`
- `supabase/rollbacks/0067_candidate_list_set_preview_authority.sql`
- `tests/candidate-list-set-preview-db.sh`
- one canonical database-manifest registration;
- function-privilege and schema/digest contract updates required by the new
  function surface;
- Relay findings, exact hashes, commits, and verification evidence.

## Schema contract

Add to `public.candidate_lists`:

```sql
membership_revision bigint not null default 0
  check (membership_revision >= 0)
```

Revision zero is the accepted baseline for every pre-0067 list, including a
non-empty list. The value is a freshness generation, not a row count and not a
historical snapshot. A caller holding an older revision must restart; 0067 does
not reconstruct older membership.

Add an index beginning with:

```sql
(workspace_id, list_id, campaign_id collate "C", candidate_id collate "C")
```

The checked-in migration builds this index transactionally because the current
release candidate introduces 0064 through 0067 together and therefore creates
it on an empty list-membership table. Before deployment, the migration
readback must prove 0064 is not already live or a measured row count and lock
duration fit an explicitly accepted maintenance budget. Otherwise deployment
blocks and the index moves to a separately reviewed online
`CREATE INDEX CONCURRENTLY` phase before RPC activation; the release must never
silently take an unmeasured write-blocking index build on a populated table.

Candidate set identity remains exactly `(campaign_id, candidate_id)`. The same
candidate ID in two campaigns is two set members and must never collapse to a
candidate-global identity.

Forward retry validates the exact column, default, non-negative constraint,
index order/collations, trigger definitions, function owner/configuration, and
ACL. It must not reset an existing revision or silently repair incompatible
objects.

The column comment is the explicit rollback-order marker
`aria:candidate-list-set-preview-authority:0067`. Any later migration that
depends on or evolves this authority must replace the numeric suffix. The 0067
rollback refuses before mutation unless the present marker is exactly 0067;
the harness uses a synthetic 0068 marker to prove this path.

## Revision advancement

Install statement-level `AFTER INSERT` and `AFTER DELETE` triggers on
`public.candidate_list_members`, each using a transition table.

Both call the owner-only
`public.advance_candidate_list_membership_revisions() returns trigger`, which
is `LANGUAGE plpgsql VOLATILE SECURITY DEFINER`, owned by `postgres`, uses
`search_path = pg_catalog, public, pg_temp`, and is executable by no non-owner
role. A `BEFORE TRUNCATE` statement trigger calls the independently owner-only
`public.reject_candidate_list_member_truncate() returns trigger` with the same
language, volatility, security, owner, search-path, and ACL contract.

A `BEFORE UPDATE OF membership_revision` row trigger calls owner-only
`public.guard_candidate_list_membership_revision() returns trigger` with that
same function contract. It rejects direct revision changes with SQLSTATE 55000
unless invoked inside a nested trigger-driven list update. PostgreSQL trigger
depth cannot cryptographically identify the parent trigger, so this is
defense-in-depth against accidental owner maintenance, backed by forced RLS,
zero untrusted table `UPDATE`, and owner-only transition helpers. No
caller-supplied column value or session setting is accepted as authority.

- Advance every affected surviving `(workspace_id, list_id)` once per SQL
  statement, regardless of the number of member rows.
- Lock affected list rows in ascending `(workspace_id, list_id)` order before
  updating revisions.
- An insert whose every row loses `ON CONFLICT DO NOTHING` advances nothing.
- A zero-row delete advances nothing.
- Governed candidate-global erasure advances every surviving affected list
  exactly once.
- List and workspace cascades continue successfully when the parent list no
  longer survives.
- Member updates remain prohibited by the existing immutable-member contract.
- `TRUNCATE public.candidate_list_members` is refused by an owner-only
  statement trigger so privileged maintenance cannot preserve stale list
  revisions.
- Runtime roles retain no direct table write authority. Revision advancement
  is database-owned and cannot be caller supplied.

## Preview RPC

Add only this authenticated function:

```sql
public.preview_candidate_list_set(
  p_left_list_id uuid,
  p_left_revision bigint,
  p_right_list_id uuid,
  p_right_revision bigint,
  p_operation text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_limit integer
) returns jsonb
```

Add one owner-only planning helper:

```sql
public.candidate_list_set_preview_window(
  p_workspace_id uuid,
  p_left_list_id uuid,
  p_right_list_id uuid,
  p_operation text,
  p_after_campaign_id text,
  p_after_candidate_id text,
  p_consume_limit integer
) returns table (
  campaign_id text,
  candidate_id text,
  relation text,
  disposition text,
  emit boolean,
  is_lookahead boolean
)
```

The helper is `LANGUAGE sql STABLE SECURITY INVOKER`, owned by `postgres`, has
no function `SET` configuration, and fully schema-qualifies every relation,
function, operator, and collation it uses. This permits PostgreSQL to expose
the exact inlined membership plan to `EXPLAIN` without giving up name-resolution
safety. It has no `EXECUTE` grant for `PUBLIC`, `anon`, `authenticated`,
`service_role`, `authenticator`, or any other non-owner role. The authenticated
security-definer RPC is its only runtime caller. The helper returns the bounded
traversal window, including non-emitting intersection/difference rows so the
RPC can advance its cursor.

Consumed rows have `is_lookahead=false` and an exact classification. At most
one final row has `is_lookahead=true`, `emit=false`, and null relation and
disposition; it proves more source remains without performing a right-side
probe or consuming that identity. Rows are always returned in ascending
`(campaign_id COLLATE pg_catalog."C", candidate_id COLLATE pg_catalog."C")`
order.

Allowed operations:

- `union`: every distinct identity, annotated `left`, `right`, or `both`;
- `intersection`: identities present in both lists;
- `difference`: identities present only in the left list;
- `exclusion`: every left identity, annotated `retained` or `would_exclude`;
  it changes neither list.

The response schemas are closed and exact:

- success has exactly `status="ok"`, `operation`, decimal-string
  `left_revision` and `right_revision`, `items`, `has_more`, `next_cursor`, and
  `restart_required=false`;
- every item has exactly `campaign_id`, `candidate_id`, `relation`, and
  `disposition`;
- union uses relation `left`, `right`, or `both` and disposition `included`;
- intersection uses relation `both` and disposition `included`;
- difference uses relation `left` and disposition `included`;
- exclusion uses relation `left` or `both` and disposition `retained` or
  `would_exclude` respectively;
- a non-null cursor has exactly `campaign_id` and `candidate_id`;
- revision conflict has exactly `status="revision_conflict"`, `operation`,
  both current decimal-string revisions, `items=[]`, `has_more=false`,
  `next_cursor=null`, and `restart_required=true`;
- missing or foreign list authority returns exactly
  `{"status":"list_not_found"}` for every left/right/both combination and
  exposes no accessible counterpart revision.

The RPC returns no total count. `p_limit` is the maximum number of logical
source identities consumed from the merged union or left-driver window, not
merely an output limit, and is accepted only from 1 through 100. It emits at
most `p_limit` items. The operation-specific physical source-read caps remain
`p_limit + 1` for the left-driven operations and
`2 * (p_limit + 1)` for union.

## Revision and cursor protocol

- Authenticate first, validate syntax second, resolve both lists without
  disclosing either one third, and only then compare revisions. Revision or
  list state must never precede the authority check.
- Both list IDs are required. Validate operation byte length before comparing
  its exact lowercase value: it must contain 1 through 16 bytes and equal one
  of the four allowed values. Validate cursor byte lengths before applying the
  exact 0065 ASCII identity grammar
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$`.
- PostgreSQL coerces UUID, bigint, and integer arguments before entering the
  function. Auth-first and SQLSTATE 22023 guarantees apply only after successful
  type coercion. Invalid UUID or numeric wire values retain PostgreSQL's native
  input error, and padding erased by coercion is not observable. Inside the
  RPC, null list IDs, negative revisions, and null or out-of-range semantic
  limits are rejected with SQLSTATE 22023.
- On the first page only, both expected revisions may be null when both cursor
  components are null. The RPC binds and returns the current two revisions.
- A caller may also provide both exact expected revisions on the first page.
- Later pages require both exact revisions and both cursor components.
- One null revision, one null cursor component, negative revisions, malformed
  identity cursor values, an unknown operation, or an out-of-range limit raises
  SQLSTATE 22023 before list data is returned.
- A stale expected revision returns `revision_conflict`, zero items, both
  current revisions, and `restart_required=true`.
- Missing and foreign-workspace list IDs return the same non-disclosing
  `list_not_found` response.
- Ordering and keyset comparison are ascending
  `(campaign_id COLLATE "C", candidate_id COLLATE "C")`.

When `has_more=true`, `next_cursor` is the last consumed/examined identity and
may not appear in `items`. When `has_more=false`, `next_cursor` is null even if
the terminal call consumed non-emitting identities. `has_more` means
unconsumed source identities remain, not that a later page is guaranteed to
emit a result. A sparse intersection or high-overlap difference may therefore
return `items=[]`, `has_more=true`, and a strictly advancing non-null cursor. A
terminal empty window returns `items=[]`, `has_more=false`, and
`next_cursor=null`. The lookahead identity is never consumed or emitted until
the next call.

For intersection, difference, and exclusion, the left list is the driver. The
helper reads at most `p_limit + 1` left identities, classifies only the first
`p_limit`, and performs at most one exact indexed right-side probe per
classified identity. The extra left identity is lookahead only. For union, the
helper reads at most `p_limit + 1` identities from each list, merges and
deduplicates those bounded prefixes, consumes at most the first `p_limit`, and
uses the next merged identity only as lookahead. Union therefore examines at
most `2 * (p_limit + 1)` source rows. No operation may perform a global member
scan, hash materialization, or unbounded sort to produce a sparse page.

Same-list behavior is defined: union and intersection return the list;
difference is empty; exclusion marks every member `would_exclude`.

## Transaction and security contract

- The function is `STABLE SECURITY DEFINER`, owned by `postgres`, with a fixed
  `search_path = pg_catalog, public, pg_temp`.
- Derive active identity and workspace from the authenticated principal. The
  function accepts no workspace or actor argument.
- Same-tenant viewer, member, and admin may preview. Anonymous, service role,
  authenticator, inactive identities, foreign tenants, and malformed authority
  fail closed. Anonymous, service-role, authenticator, and inactive-identity
  calls raise SQLSTATE 42501. Authenticated same-tenant callers receive the
  exact non-disclosing `list_not_found` envelope for foreign or missing IDs.
- Revoke EXECUTE from `PUBLIC`, `anon`, `service_role`, and `authenticator`;
  grant only to `authenticated`.
- Preserve forced RLS and zero direct runtime privileges on all list tables.
- Use one PostgreSQL statement snapshot for revision checks and membership
  reads. The preview takes no advisory lock, creates no receipt or temp table,
  and performs no dynamic SQL.
- A concurrent committed mutation is therefore wholly before or after the
  preview statement. A next page using the old revision returns a conflict
  instead of mixing generations.
- Direct authenticated PostgREST execution remains a source-only capability.
  Production activation is blocked until the later shared quota and gateway
  controls prove this RPC cannot be used as an unmetered database-work bypass.

## Migration and rollback discipline

The forward migration and rollback acquire the shared schema-migration
advisory lock and drain existing writers before their first schema mutation in
the established order: operation receipts, candidate lists, then list members.
They refuse incompatible partial state before changing data. A lock timeout or
failed validation must leave identical schema and data fingerprints.

The checked-in 0067 rollback is for ledgerless disposable proof only. It must:

- take the same schema advisory lock;
- refuse with SQLSTATE 55000 before mutation when the append-only ledger
  contains 0067 or later;
- no-op when every 0067 artifact is absent; if any artifact remains, require
  the exact 0067 column marker before mutation and refuse a later marker;
- remove only the 0067 RPC, SQL window helper, revision guard, transition
  helper, truncate-refusal helper, their four triggers, index, constraint, and
  column;
- preserve every 0064-0066 row, evidence chain, receipt, hold, and erasure fact;
- be idempotent on a clean already-rolled-back disposable database.

0064 and 0065 rollbacks already refuse beneath 0066 markers; 0066 itself has
no enabled downgrade. Do not weaken those protections for 0067 testing.

## RED-first verification matrix

Commit the harness before implementation and prove it fails for the exact
missing 0067 column/function boundary. The accepted implementation must prove:

The harness installs the production-shaped GoTrue ownership/ACL bridge, applies
exactly 0001 through 0066 with `psql --single-transaction`, asserts an exact
0066 marker, seeds a non-empty pre-0067 list, and records public-schema plus
0064-0066 data fingerprints. After the exact RED boundary is satisfied by the
implementation, it requires exactly one fixed 0067 forward and rollback
filename before applying either with `--single-transaction`. The RED commit
must terminate on the named absent column and RPC, never on a fixture,
boolean-format, Docker, or transaction warning.

The exact 0066 baseline is the checked-in migration SHA-256
`f1db1fcdf0c10216f34799dc40c868c859ad06929d959641f44dc833f31240e4`
plus the catalog sentinels
`public.candidate_legal_hold_lock_key(uuid,text)` and
`public.candidate_legal_holds_active_candidate_idx`. Fingerprints comprise a
normalized `pg_dump --schema-only --schema=public` and deterministic,
primary-key-ordered hashes for `candidate_lists`, `candidate_list_members`,
`candidate_contact_attestations`, `candidate_list_operation_receipts`,
`candidate_legal_holds`, `candidate_erasure_requests`, and
`candidate_erasure_receipts`. PostgreSQL 17 random `\\restrict` and
`\\unrestrict` tokens are removed before hashing.

1. Exact column type/default/check, C-collation index, revision/transition and
   truncate triggers, helper/RPC signature, owner, language, volatility,
   security mode, RPC search path, helper `proconfig is null`, ACL, and no
   tenant-parameter RPC overload. Catalog assertions use `pg_attribute`,
   `pg_constraint`, `pg_index.indcollation`, and `pg_trigger` transition
   metadata, not definition regex alone. The accepted normalized
   `pg_get_functiondef` SHA for the fully qualified SQL helper is recorded and
   frozen after implementation.
2. Anonymous, service-role, inactive, and foreign-tenant denial; same-tenant
   viewer/member/admin success; missing and foreign IDs remain byte-identical.
3. After successful PostgreSQL type coercion and authentication, SQLSTATE 22023
   for null list IDs, semantic null/negative/out-of-range numeric arguments,
   and every malformed, overlong, padded, or half-null text operation/cursor
   before list/result disclosure. Native UUID/numeric input errors are tested
   separately and make no auth-order claim. Both lists resolve before revision
   comparison.
4. Exact closed JSON key sets and exact union, intersection, left-difference,
   and exclusion semantics over overlapping fixtures.
5. The same candidate ID in different campaigns remains two identities.
6. Defined same-list and empty-list results, including bound revisions on an
   empty page.
7. C-order traversal across case and punctuation has no duplicate or omission
   and never returns more than 100 items. With `p_limit=1`, empty intermediate
   pages strictly advance in no more than the seeded driver or union
   cardinality plus one calls. The lookahead row is first eligible on the next
   call, never the current one. A final sparse page that consumes only
   non-emitting rows returns `has_more=false` and `next_cursor=null`.
8. A 10,000-row disjoint intersection and identical-list difference prove
   empty nonterminal windows, last-examined cursors, at most 101 left driver
   rows, and at most 100 one-row indexed probes. A 10,000-row interleaved union
   proves at most 202 source rows. A recursive JSON plan walker sums
   `Actual Rows * Actual Loops`, rejects `Seq Scan` on
   `candidate_list_members`, requires right-side exact index-probe loops no
   greater than 100, and permits `Sort` or `Hash` only beneath a bounded
   `Limit` whose member-table descendants respect these caps. Tests run
   `ANALYZE` first and never disable sequential scans.
9. Pre-0067 non-empty lists start at revision zero. One multi-row insert
   advances once; one statement spanning multiple lists advances each once;
   two statements advance twice; mixed conflict/new advances once;
   conflict-only insert and zero-row delete advance zero; failed or rolled-back
   writes advance zero; two concurrent commits advance twice without loss.
   Opposite multi-list input ordering proves sorted `(workspace_id, list_id)`
   locking; truncate, immutable updates, direct revision writes, and bigint
   overflow fail atomically.
10. Governed candidate-global erasure across campaigns/lists advances every
    surviving affected list once while preserving erasure and legal-hold
    contracts. A blocked hold changes no revision; release plus replay advances.
11. List and workspace cascade deletion remain successful.
12. Page one followed by a committed add makes page two with the old revisions
    return `revision_conflict` and no mixed items.
13. A preview concurrent with an uncommitted mutation observes one coherent
    generation only and never deadlocks.
14. Repeated previews leave lists, revisions, members, receipts, attestations,
    legal holds, and erasure state unchanged.
15. Serialized sentinel scans prove no evidence hash, lawful-basis value,
    provider attempt, actor/member ID, list name, workspace candidate JSON,
    contact field, or other non-contract value escapes.
16. Forward retry is an exact no-op and refuses poisoned partial columns,
    constraints, collations, indexes, disabled/wrong triggers, functions,
    overloads, or arbitrary custom-role ACLs before mutation. Ledgerless
    rollback/reapply preserves all 0064-0066 state; clean rollback is
    idempotent; ledger rows for 0067 or later refuse atomically with SQLSTATE
    55000; a defined later marker also refuses. Similar-named independent
    objects survive.
17. A paused real add concurrent with rollback proves receipts-lists-members
    lock order, no deadlock, and no partial change on timeout; rollback succeeds
    only after the writer commits.
18. Deployment preflight proves the target table is not live yet or its exact
    row count and measured index-build lock fit a ratified maintenance budget;
    otherwise release blocks pending a separately reviewed concurrent-index
    phase.
19. Candidate-list, evidence, erasure, candidate-global hold, privilege,
    recovery, manifest, TypeScript, secret-scan, and full repository gates stay
    green.

## Acceptance and handoff

0067 is source-accepted only after the separately committed RED proof, focused
PostgreSQL suite, all listed regressions, deterministic plan evidence, two
independent database/security reviews, exact artifact hashes, atomic commits,
Relay update, push, and remote-SHA verification.

Protected CI, merge, Fly deployment, real sourcing, email activation, HeyReach
activation, and any candidate contact remain separate blocked gates.
