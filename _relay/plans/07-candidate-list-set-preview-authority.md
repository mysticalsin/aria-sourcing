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
- bytewise deterministic keyset pagination capped at 100 rows;
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

Candidate set identity remains exactly `(campaign_id, candidate_id)`. The same
candidate ID in two campaigns is two set members and must never collapse to a
candidate-global identity.

Forward retry validates the exact column, default, non-negative constraint,
index order/collations, trigger definitions, function owner/configuration, and
ACL. It must not reset an existing revision or silently repair incompatible
objects.

## Revision advancement

Install statement-level `AFTER INSERT` and `AFTER DELETE` triggers on
`public.candidate_list_members`, each using a transition table.

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

Allowed operations:

- `union`: every distinct identity, annotated `left`, `right`, or `both`;
- `intersection`: identities present in both lists;
- `difference`: identities present only in the left list;
- `exclusion`: every left identity, annotated `retained` or `would_exclude`;
  it changes neither list.

The response shape is closed and contains:

- `status`;
- `operation`;
- `left_revision` and `right_revision` as decimal strings to avoid JavaScript
  bigint loss;
- at most 100 `items`, each containing only `campaign_id`, `candidate_id`,
  `relation`, and operation-appropriate `disposition`;
- `has_more` and a two-component `next_cursor`, or null;
- `restart_required=true` only for a revision conflict.

The RPC returns no total count. It fetches at most `p_limit + 1`, emits at most
`p_limit`, and accepts `p_limit` only from 1 through 100.

## Revision and cursor protocol

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

Same-list behavior is defined: union and intersection return the list;
difference is empty; exclusion marks every member `would_exclude`.

## Transaction and security contract

- The function is `STABLE SECURITY DEFINER`, owned by `postgres`, with a fixed
  `search_path = pg_catalog, public, pg_temp`.
- Derive active identity and workspace from the authenticated principal. The
  function accepts no workspace or actor argument.
- Same-tenant viewer, member, and admin may preview. Anonymous, service role,
  authenticator, inactive identities, foreign tenants, and malformed authority
  fail closed.
- Revoke EXECUTE from `PUBLIC`, `anon`, `service_role`, and `authenticator`;
  grant only to `authenticated`.
- Preserve forced RLS and zero direct runtime privileges on all list tables.
- Use one PostgreSQL statement snapshot for revision checks and membership
  reads. The preview takes no advisory lock, creates no receipt or temp table,
  and performs no dynamic SQL.
- A concurrent committed mutation is therefore wholly before or after the
  preview statement. A next page using the old revision returns a conflict
  instead of mixing generations.

## Migration and rollback discipline

The forward migration acquires the shared schema-migration advisory lock and
drains existing writers in their established order: operation receipts,
candidate lists, then list members. It refuses incompatible partial state
before changing data.

The checked-in 0067 rollback is for ledgerless disposable proof only. It must:

- take the same schema advisory lock;
- refuse with SQLSTATE 55000 before mutation when the append-only ledger
  contains 0067 or later;
- refuse before mutation if a later authority marker exists;
- remove only the 0067 RPC, triggers, helper, index, constraint, and column;
- preserve every 0064-0066 row, evidence chain, receipt, hold, and erasure fact;
- be idempotent on a clean already-rolled-back disposable database.

0064 and 0065 rollbacks already refuse beneath 0066 markers; 0066 itself has
no enabled downgrade. Do not weaken those protections for 0067 testing.

## RED-first verification matrix

Commit the harness before implementation and prove it fails for the exact
missing 0067 column/function boundary. The accepted implementation must prove:

1. Exact column type/default/check, C-collation index, transition triggers,
   helper/RPC owner, volatility, search path, ACL, and no tenant-parameter
   overload.
2. Anonymous, service-role, inactive, and foreign-tenant denial; same-tenant
   viewer/member/admin success; missing and foreign IDs remain indistinguishable.
3. SQLSTATE 22023 for every malformed operation, limit, revision, or half
   cursor before result disclosure.
4. Exact union, intersection, left-difference, and exclusion semantics over
   overlapping fixtures.
5. The same candidate ID in different campaigns remains two identities.
6. Defined same-list and empty-list results, including bound revisions on an
   empty page.
7. C-order keyset pagination across case, punctuation, and timestamp ties has
   no duplicate or omission and never returns more than 100 rows.
8. One multi-row insert advances once; two statements advance twice;
   conflict-only insert and zero-row delete advance zero.
9. Governed candidate-global erasure advances every surviving affected list
   once while preserving its erasure and legal-hold contracts.
10. List and workspace cascade deletion remain successful.
11. Page one followed by a committed add makes page two with the old revisions
    return `revision_conflict` and no mixed items.
12. A preview concurrent with an uncommitted mutation observes one coherent
    generation only and never deadlocks.
13. Repeated previews leave lists, revisions, members, receipts, attestations,
    legal holds, and erasure state unchanged.
14. A large-list `EXPLAIN (ANALYZE, BUFFERS)` fixture demonstrates a bounded,
    index-led plan for all four operations. No latency SLO is claimed until the
    production workload profile is ratified.
15. Forward retry is an exact no-op. Ledgerless rollback/reapply preserves all
    0064-0066 state; ledgered rollback refuses atomically with SQLSTATE 55000.
16. Candidate-list, evidence, erasure, candidate-global hold, privilege,
    recovery, manifest, TypeScript, secret-scan, and full repository gates stay
    green.

## Acceptance and handoff

0067 is source-accepted only after the separately committed RED proof, focused
PostgreSQL suite, all listed regressions, deterministic plan evidence, two
independent database/security reviews, exact artifact hashes, atomic commits,
Relay update, push, and remote-SHA verification.

Protected CI, merge, Fly deployment, real sourcing, email activation, HeyReach
activation, and any candidate contact remain separate blocked gates.
