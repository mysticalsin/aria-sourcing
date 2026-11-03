---
project: ARIA / MSourcing
agent: claude-code (Opus 5, 1M)
updated: 2026-07-25
status: SPEC — designed, adversarially UNREVIEWED, not implemented
scope: the sourcing provider-egress chokepoint, and migration 0049 for two swarm defects
depends_on: _relay/2026-07-24-state-of-the-union.md
---

# Spec: sourcing egress chokepoint + swarm 0049

## Why this is a spec and not a commit

Both designs below were produced by a deep read of the code and each cites file:line. **Neither
survived a critique pass** — all three adversarial reviewers died on a session limit, and the
swarm test-suite designer died mid-stream. Two further reasons not to implement blind:

1. The egress work is a **15-site refactor across 7 modules** that changes the signature of every
   adapter reaching a paid provider. Unreviewed, that is how a sourcing run stops working.
2. The 0049 work replaces three PL/pgSQL functions inside a 2121-line **production-applied**
   migration, and its own proof — `tests/swarm-orchestration-db.sh` — does not exist yet. Shipping
   the fix before the suite would repeat the pattern this project has been bitten by repeatedly.

What WAS implemented this shift, because it is small and self-verifying: the third swarm defect
(`1c4c544`, the same-origin JSON boundary on the three swarm mutations, plus the swarm plane's
first test).

---

# Part 1 — the sourcing prohibited-criteria bypass is worse than the audit said

## The escalated finding

The audit reported "the direct Apify adapter bypasses the central policy". The real picture, read
at source:

- The policy is **one pure function**, `validateSourcingQuery`
  (`src/lib/sourcing/query-policy.ts:22-56`). Its rejection set is a single regex `SENSITIVE_PROXY`
  (`:5-6`) covering age, gender, race, ethnicity, religion, disability, pregnancy, marital status,
  nationality, and university/college/graduation.
- It is called from **exactly two places**: `src/lib/ai/sourcing-tools.ts:114` (guarding the GitHub
  call at `:126` and Tavily at `:136`), and `src/app/api/sourcing-agent/route.ts:511` to filter
  promoted lessons.
- **Every other provider-reaching path skips it.** The direct Apify actor run
  (`src/app/api/source/apify/start/route.ts:85`) is paid, and its schema at `:21-51` accepts
  `searchQuery`, `schools`, `firstNames`, `lastNames` — and **carries no `campaignId` at all**.
  Apollo people search (`src/app/api/source/apollo/search/route.ts:152`) *does* have `campaignId`
  and still never calls the policy. Also unguarded: Seamless
  (`src/app/api/source/seamless/search/route.ts:73`), the demo-mode GitHub and web-search calls
  (`src/app/api/source/route.ts:153`, `:164`), and **four enrichment runners**
  (`src/lib/enrichment/runners.ts:103, 167, 234, 313`).
- **There is no egress chokepoint at all** — 15 raw `fetch(` sites across 7 modules:
  `github.ts:41`; `source/route.ts:214, 241` (which bypass even github.ts's own wrapper);
  `apify.ts:336`; `apollo.ts:110, 139, 187`; `seamless.ts:124, 153, 246`; `sillage.ts:88`;
  `web-tools.ts:164, 198`.
- **No test proves absence of egress.** `tests/sourcing-query-policy.mts` imports only the pure
  function. `tests/sourcing-agent-route-authority.mts:256-283` mocks away
  `src/lib/ai/sourcing-tools.ts` wholesale, so the real policy never runs in the one route that
  enforces it. `tests/apify-sourcing.mts:148-167` stubs `globalThis.fetch` to assert the actor path
  **is** hit.
- The word "prohibited" appears **nowhere** in `src/`. The doc says "discrimination-proxy filter"
  (`docs/SOURCING.md:445`), the code says `SENSITIVE_PROXY`, the test says "sensitive-proxy" —
  three names, no shared vocabulary to assert against.

**Root cause is a seam, not carelessness.** The policy's signature is
`(platform, query: string, campaign)`. A route with no campaign in scope *cannot* call it, and a
route with structured array criteria has no single string to pass. Apify sends eight arrays;
Apollo sends five. Neither could call it as written even if the author wanted to.

**`docs/SOURCING.md:445` is therefore currently false** — it claims queries referencing
age/gender/race/religion are rejected. They are rejected on one of nine paths.

## The design, in dependency order

**1. Name the rule once, widen the entry point from a string to a field map.**
Rename `SENSITIVE_PROXY` → `PROHIBITED_CRITERIA` and export it, keeping the pattern
**byte-identical** — widening the regex is a separate decision with its own false-positive
surface. Keep `validateSourcingQuery` exactly as-is so its two callers and
`tests/sourcing-query-policy.mts` are untouched, but re-implement its body on the new primitives so
there is one implementation. Add:
- `prohibitedCriteriaViolation(value): 'control_chars' | 'too_long' | 'injection' | 'protected_proxy' | null`
  — the per-value scalar check factored out of `query-policy.ts:28-33`.
- `validateSourcingCriteria(platform, criteria: Record<string, string | string[]>, campaign)` —
  flattens every field, runs the scalar check on each, then applies the existing role-binding rule
  (`:35-46`) over the **union** of all values' tokens, so a role-bound `currentJobTitles`
  legitimately authorizes a companion `locations` filter. Then the GitHub `language:` allowlist
  (`:47-54`) when platform is GitHub.

**2. One egress chokepoint: a branded clearance only the policy can mint.**
New `src/lib/sourcing/provider-egress.ts`, first line `import "server-only";` (matching
`learning-authority.ts:1`). Exports:
- `SOURCING_PROVIDER_HOSTS` — frozen provider→hostname map taken verbatim from the existing
  constants (`github.ts:14`, `apify.ts:24`, `apollo.ts:17`, `seamless.ts:20`, `sillage.ts:22`,
  `web-tools.ts:198`, `:250`).
- An **opaque branded** `ProviderClearance` keyed on a module-private `declare const CLEARANCE:
  unique symbol`. Because the brand key is module-private, no code outside the file can construct a
  conforming object without an explicit `as` cast — and item 7's scanner forbids that cast.
- `clearDiscoveryCriteria(...)` — the only minting path for `kind: 'discovery'`, delegating to
  `validateSourcingCriteria`.
- `sourcingFetch(clearance, ...)` — the only way to reach a provider socket.

Fixing the three known bypasses leaves the next adapter free to add a sixteenth. The chokepoint has
to own the socket, and obtaining permission has to require the campaign context the policy needs —
that is what makes `apify/start/route.ts:85` *structurally unable* to repeat its behaviour rather
than merely patched.

**3. Route all 15 fetch sites through it**, mechanically, one module at a time, with no behaviour
change beyond the added parameter. `apolloRequest` is a wrapper that module never had (route `:110`,
`:139`, `:187` through it, preserving the exact error-text shapes at `:118`/`:151` that callers
pattern-match). Delete the two inline fetches at `source/route.ts:214, 241` and express both probes
as github.ts adapters taking a probe clearance. **Leave `web-tools.ts` structurally alone** — it
already takes an injected SSRF-guarded `fetchImpl` and has its own security-group suites.

**4. Give the two vendor-API routes the campaign context the policy requires** and gate them on a
minted clearance. Apify's route has no `campaignId` today; that is the blocking change.

**5. Classify enrichment identity-resolution as its own clearance kind** (`'identity'`) so the fix
does not refuse lawful enrichment — resolving a known person is not a discovery query.

**6. The negative-egress proof: a provider mock whose invocation count IS the assertion.** Never a
status code. A 422 does not prove the call was not made.

**7. The structural anti-regression proof:** a directory-enumerating scanner asserting every module
that reaches a provider goes through `sourcingFetch`, and that no `as ProviderClearance` cast exists
outside `provider-egress.ts`. A new adapter cannot be added without failing the suite.

**8. Correct `docs/SOURCING.md:445` and pin it with a `docs-truth` assertion.**

## Open questions — resolve before implementing

- **Owner decision:** `/api/source/route.ts:150-175` is reachable only when `!supabaseEnabled` — the
  demo and public-demo deployments (`:57-61`, `:129-138`). Does demo mode mint a clearance, or is
  demo discovery refused?
- **Owner decision (policy):** the regex is preserved byte-identical. Whether `university|college|
  graduat(e|ed|ion)` should remain a prohibited proxy is a real compliance question — it blocks
  legitimate "graduate scheme" sourcing. Not changed unilaterally.
- Four route paths in the egress inventory were **inferred, not read**:
  `src/app/api/source/apify/status/route.ts` and three siblings. Confirm before relying on the count
  of 15.
- Does `failSourcingRun`'s error-code parameter hit a CHECK-constrained column in
  `0027_sourcing_learning_authority.sql` or `0044`? A new violation code may need a migration.
- `tests/sourcing-agent-route-authority.mts:256-283` mocks `sourcing-tools.ts` wholesale, so the
  repo's most thorough sourcing route test never exercises the real policy. That mock should be
  narrowed as part of this work, or the suite keeps passing while the policy is bypassed.
- `tests/apify-sourcing.mts:148` replaces `globalThis.fetch`, and `sourcingFetch` calls
  `globalThis.fetch` as its final step, so that suite should keep passing untouched. Verify.

---

# Part 2 — migration 0049 for two swarm defects

**0048 is the tip.** One new file, `supabase/migrations/0049_swarm_liveness_authority.sql`, carries
both sections — both replace `answer_swarm_escalation`, so they cannot be split into two migrations.
Never edit 0046: it is applied in production and its ledger sha is reconciled by
`scripts/prod-apply-swarm-fixes.sh:36,73`. No table is added, so `scripts/backup.sh:74-81` and
`docker/bootstrap/legacy-table-inventory.txt` stay untouched.

## §A — a cancelled dependency must escalate, not deadlock

**Root cause, one sentence:** the DAG gate in `dispatch_ready_swarm_assignments`
(`0046:1047-1055`) handles a permanently-unsatisfiable dependency with the same
`skipped := skipped + 1; continue;` it uses for one that is merely still running, so a dependent of
a cancelled assignment is skipped on every tick forever with no escalation.

Evidence chain: the greenlight `reject` branch of `answer_swarm_escalation` (`0046:1668-1676`)
cancels one assignment and never looks at anything's `depends_on`; `'cancelled'` is terminal —
the requeue branch accepts only `'needs_input','blocked'` (`:1685`) and `mark_stale_swarm_assignments`
only touches `'dispatched','executing'` (`:1470`); and `swarm_recompute_mission_status`
(`:544-563`) counts `'blocked','needs_input'` as attention and `'done'+'cancelled'` as completion,
so a `'queued'` dependent is neither and the mission parks in `'executing'`.
`cancel_swarm_mission` is **not** a source of this bug — it cancels every assignment (`:1749-1752`).

**Fix A1** — `create or replace dispatch_ready_swarm_assignments`: copy `0046:1010-1125` verbatim,
then insert a new branch *immediately before* the existing DAG gate, leaving that gate
byte-identical underneath. The branch aggregates dependencies that are absent or `'cancelled'`, and
when any exist: sets the assignment `'blocked'`, inserts a `'blocked'` escalation with
`detail->>'reason' = 'dependency_cancelled'`, emits a `loop_events` row (ids only, no PII),
recomputes the mission, and continues. Return value gains `dead_dependency_blocked` — purely
additive; keep all three existing keys, which `scripts/swarm-orchestrator-worker.mjs:373-374,411`
reads. **Do not relax the surviving gate**: a dependency still `'queued'`/`'executing'` must still
be skipped, not blocked.

Reuse of the existing `'blocked'` kind is deliberate — it is already in the `swarm_escalations` kind
CHECK (`0046:291`), already in the requeue whitelist (`:1678`), and already counted by
`get_swarm_runtime.open_escalations` (`:1575-1577`). A new kind value would require altering the
CHECK plus the whitelist plus the route enum for no inbox benefit.

**Fix A2** — in the `reject` branch of `answer_swarm_escalation`, propagate to dependents that would
otherwise deadlock immediately: for each `'queued'` dependent, set `'blocked'` and insert the same
escalation with `detail` naming the cancelled assignment. Restricted to `'queued'` on purpose:
dispatch only releases work whose dependencies are all `'done'`, and reject refuses to cancel a
`'done'` assignment (`:1673`), so a dependent of a freshly-cancelled assignment can only be
pre-dispatch.

## §B — bound the continuations

**Root cause:** `record_swarm_checkpoint` mints a continuation job per `in_progress`/`handoff` turn
keyed on the *predecessor* job id (`0046:1327`) and never increments `attempt_count`, so the only
existing bound — `attempt_count < 3` in `mark_stale_swarm_assignments` (`:1483`) — can never trip.
Each turn is one paid LLM call (`scripts/swarm-executor-server.mjs:18-20`).

**Fix:** a per-assignment continuation budget with escalation on exhaustion and resume only by
explicit operator grant. Two new columns. **The numbers are policy, not mechanism** — the design
proposes default 12 turns, +12 per operator grant, hard ceiling 200. **Owner should confirm the
default against real mission shapes.**

## §C — the swarm DB suite (`tests/swarm-orchestration-db.sh`)

This is the proof for §A and §B and the first executed proof of *any* swarm authority. **Its design
agent died mid-stream, so it must be designed fresh.** From the surviving fragments plus the audit,
it must cover: roster and enablement (a disabled agent cannot be assigned); greenlight gating; DAG
readiness including the cancelled-dependency path from §A; per-agent `max_concurrent` under
concurrent claims using the `SKIP LOCKED` race pattern `tests/loop-jobs-db.sh` already uses;
lease-bound checkpoints (a checkpoint from a caller not holding the lease is rejected); the
append-only proof ledger (UPDATE/DELETE must fail); escalation creation and resolution authority;
the continuation budget from §B; and **the plan-time refusal of the `external-send` category**,
which is the load-bearing safety property.

Follow the existing convention: role-switched temp values passed across roles via a **GUC and
`current_setting`**, not cross-role temp tables — a prior shift lost time to "permission denied for
pg_temp table" (`.rocket-fuel/IMPROVE.md`).

Register in the `database` group. That group **is** digest-frozen
(`tests/test-manifest-contract.mts:185`), so recompute its count and digest by hashing the resolved
group directly rather than iterating the contract.

## Open questions

- Migrations 0047 and 0048 were **not read** by the designer (it could not list the directory).
  Confirm neither already touches these functions before writing 0049.
- Does any client call `/api/swarm/*` with a JSON body and no explicit `content-type`? Such a caller
  now gets 415 from `1c4c544`. Nothing in `src/` appears to, but a non-browser caller would not be
  visible here.
- None of this executes in production until the swarm gets a scheduler — blocker #10. `swarm_enabled`
  stays FALSE everywhere except the disposable test database. 0049 adds no send path, no table, and
  no runtime dependency.
