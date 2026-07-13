# ARIA enterprise refinement execution plan

**Prepared:** 2026-07-12 23:59 EDT  
**Current verified source baseline:** `1450f858d50e0f53cdd323a730ec6b058b152899`
**Local `origin/main` tracking ref:** `bc4633663c9a7ba3b3b4d52b7f3654384e471cb6`
**Production verdict:** NO-GO  
**Purpose:** Executable handoff for Claude Code, Codex, security reviewers, and QA.

## Objective

Make ARIA understandable to a senior engineer, keep each sourcing agent
independent, remove misleading or dead structure, reduce code coupling, and
prove the exact release through source, database, browser, recovery, and live
campaign evidence.

Completion is not a source-only claim. It requires:

- maintainable code and current documentation;
- exact workspace, owner, AgentSpec, memory, and conversation isolation;
- protected release evidence for the exact SHA;
- recovered and persistent database/Auth services;
- two-user browser acceptance;
- controlled real-channel acceptance;
- zero unauthorized or duplicate candidate contact.

## Verified baseline

### Source

- The verified source baseline is three local commits ahead of the local
  `origin/main` tracking ref:
  - `316aecb`: React-free store contracts, hook characterization, and source
    dependency-cycle gates.
  - `8775096`: Wave 1A Relay and audit handoff.
  - `1450f85`: campaign/intake action factory, exact runtime projection,
    viewer denial, fail-closed results, and multi-role launch aggregation.
- The tracking ref advanced to `bc46336` through a push recorded locally at
  2026-07-13 00:24 EDT. The actor and credential used are unknown. Do not treat
  this as credential-rotation evidence or resume authenticated release work.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: passed all 136 chained commands.
- `tests/store-contracts.mts`: passed 10/10, covering the 124-action parity,
  provider-bound hook behavior, outside-provider rejection, static cycles,
  runtime cycles, dynamic imports, and positive cycle fixtures.
- `tests/store-campaign-actions.mts`: passed 22/22, covering permission and
  commit rejection, exact editable-field projection, JD validation and secret
  stripping, re-score behavior, query behavior, caller failure handling, and
  complete-versus-partial launch aggregation.
- `npm run build`: passed, 59/59 static pages generated.
- `docker compose config --quiet`: passed after the app and GoTrue default
  port were aligned at 3000.
- The separate `build:isolated` attempt stalled in its fresh `npm ci` for
  more than five minutes and was interrupted. The direct production build in
  this unsynced worktree passed. Do not claim a fresh isolated-build execution.

### Documentation and repository structure

- Current guides now exist:
  - `docs/ARCHITECTURE.md`
  - `docs/TESTING.md`
  - `CONTRIBUTING.md`
  - `SECURITY.md`
  - `production-readiness/README.md`
  - `docs/operations/FLY_SIZING.md`
- `tests/docs-truth.mts` now derives test counts, migration tip, Compose port,
  architecture/index presence, and authority language from source.
- The obsolete root relay body is archived at
  `_relay/archive/2026-06-27-claude-relay-baton.md`; the root file is a short
  compatibility pointer.
- Machine-local `graphify-out/.graphify_python` was removed and generated
  Graphify output is ignored.
- All 117 current Markdown files passed internal relative-link validation.

### Production and release

- Candidate `c3e94b2b5694825c613e127a69c811f7935a1dd8` is pushed on
  `codex/deploy-release-sync-20260713`.
- Exact candidate CI run `29221158898` and CodeQL run `29221158901` failed
  before meaningful execution. Exact job annotations remain unknown.
- Protected release branch remains `128b036`; it was not advanced.
- GitHub default branch remains `vercel-demo`, where the Fly workflow is
  absent.
- Live readiness returned 200 in three probes but reported build `d2040b...`
  and migration `0023`, not the reviewed source through `0025`.
- The Fly DB volume test remains blocked at Alpine package-index download.
- GitHub CLI and Fly credentials previously exposed during diagnostics require
  rotation. Never reuse them.

## Fable-style adversarial requirement matrix

| Requirement | Current proof | Verdict | Evidence still required |
|---|---|---|---|
| Independent agents | Local graph, policy, persistence, and pause contracts | Partial | Deployed two-user concurrent creation/run and negative cross-read proof |
| Separate memory | Disposable Postgres owner/spec isolation and receipts | Local only | Deployed application-API proof for two owners/specs |
| Separate conversations | Migration and 30 local contracts | Partial | Overlapping candidate address/thread E2E with no cross-binding |
| Candidate safety | Disclosure and salary boundary suites | Partial | Real provider round trip and wire-level no-leak evidence |
| Usability | Static motion and UI contracts | Unproven | Playwright, keyboard, mobile viewport, axe, and degraded-session acceptance |
| Maintainability | Typecheck, lint, build, repository contracts | Partial | Store decomposition, route access boundary, coverage thresholds |
| Security | Strong local negative and database contracts | Partial | Green exact-SHA CI/CodeQL, credential rotation, deployed tenant negatives |
| Documentation | Current architecture, testing, security, and authority indexes | Improved | Clean-clone reproduction and later historical archive move |
| Infrastructure | Static release/recovery contracts | Unproven live | Recovery receipt, exact digests, migration through 0025, two restarts |
| Real campaign | Mock acceptance harness | Unproven | Controlled email and official WhatsApp send/reply acceptance |

## Non-negotiable architecture rules

1. Browser state never grants server authority.
2. `workspace_state` is collaboration state, not integration, secret,
   Agent-owner, approval, or delivery authority.
3. Agent execution memory is exact workspace + owner + AgentSpec scope.
4. Missing or ambiguous candidate conversation identity enters triage.
5. Agent graph drafts remain in run history with no delivery authority.
6. Inbound candidate replies require named human review.
7. HTTP 408 and server failures are ambiguous delivery outcomes and cannot
   release duplicate protection.
8. Unknown stored authority fails closed.
9. LinkedIn remains assisted-manual unless an official signed integration
   exists.
10. Source, release, and live evidence remain separate claims.

## Workstream 0: credential and release containment

**Owners:** Project Manager, Cybersecurity Director, repository owner.

1. Revoke and rotate the exposed GitHub CLI credential.
2. Review GitHub account/repository audit history from 2026-07-13 03:11 UTC.
3. Revoke and rotate the exposed Fly credential.
4. Record issuer, rotation time, actor, scope, and affected environments only.
5. With fresh GitHub authentication, verify remote `main` is still
   `bc46336...`, review `origin/main..main`, and push normally.
6. Open CI run `29221158898` and CodeQL run `29221158901`; capture the exact
   top-level and job annotations.
7. Repair only the proven account, policy, workflow-start, or action-resolution
   cause and rerun the exact candidate.

**Exit evidence**

- Old credentials revoked.
- Audit review recorded without secret values.
- Local and remote main equal.
- Exact candidate CI and CodeQL green.

## Workstream 1: store decomposition

**Owners:** Senior Full-Stack Developer, independent validator, QA.

Current evidence after Wave 1A:

- `src/lib/store.ts` is 6,525 lines.
- `src/lib/store/contracts.ts` is 449 lines and React-free.
- `HermesActions` exposes 124 operations.
- About 92 source files import the store.
- Hydration, persistence, actions, chat, memory, selectors, and React context
  share one module and one context update surface.

### Wave 1A: contracts without behavior change

**Status:** completed in `316aecb` on 2026-07-13.

1. Add behavior tests for the current public store hooks and action signatures.
2. Move `HermesActions` and state-context types to
   `src/lib/store/contracts.ts`.
3. Keep `src/lib/store.ts` as the compatibility entry point.
4. Add a dependency-cycle check for `src/`.

**Exit evidence:** no caller import changes required; typecheck, store-focused
tests, full suite, and build green. Independent senior full-stack, security,
QA, validator, and Fable-style reviews returned GO. The final exact snapshot
passed `npx tsc --noEmit && npm test`, lint, and a 59/59 production build.

### Wave 1B: action factories

Extract one domain per commit:

1. campaign and intake: completed in `1450f85` on 2026-07-13;
2. sourcing and enrichment;
3. outreach and compliance;
4. fleet and integrations;
5. chat, sessions, and shared UI memory.

Each factory receives explicit dependencies and returns the existing action
shape. No factory imports React context.

Campaign/intake exit evidence:

- `src/lib/store/campaign-actions.ts` owns four actions behind explicit
  dependencies and authoritative mutation checks.
- `src/lib/store/campaign-launch.ts` makes partial launch results explicit.
- Campaign updates project only canonical status, previous status, JD, and
  scoring-weight fields; unknown or malformed data never reaches shared state.
- Create returns `null`, while update and query return `false`, when authority,
  state, identity, validation, or commit application fails.
- Senior full-stack, QA, and cybersecurity reviewers returned GO after closing
  false-success, undefined-field, opaque-JD, and partial-launch findings.
- Exact final snapshot passed 22/22 focused tests, 10/10 store-contract tests,
  all 136 chained commands, zero-warning lint, and a 59/59 production build.

**Exit evidence:** each wave reduces `store.ts`, preserves serialized state,
and passes before/after behavior fixtures.

### Wave 1C: persistence adapter

1. Move hydration, optimistic save, conflict reload, and retry state into a
   tested workspace-persistence adapter.
2. Preserve unsaved state on transport failure.
3. Add explicit canonical resynchronization after normalized server mutations.
4. Instrument provider rerenders before deciding whether to split context or
   adopt selector-backed subscriptions.

**Exit evidence:** failed or conflicted projection saves are visible and
recoverable; no silent fallback to demo or stale UI authority.

## Workstream 2: outreach authority and projection

**Owners:** Senior Full-Stack Developer, Cybersecurity Analyst, QA.

Current risk: normalized approvals/outbox/ledger own delivery authority while
the browser independently updates the `workspace_state` projection.

1. Define the canonical response for approve, revoke, claim, send, and
   reconciliation mutations.
2. Return persisted normalized records from server routes.
3. Reconcile the browser projection from those records.
4. Add a durable resync path when projection save fails after provider
   acceptance.
5. Keep ambiguous provider outcomes non-retryable.
6. Split `outreach/send/route.ts` into route orchestration, policy/claim
   service, and provider dispatch only after behavior coverage exists.

**Required tests**

- Provider accepted, projection save failed, later resync recovers exact state.
- Duplicate retry remains blocked.
- Revoked approval cannot race a claim.
- Cross-channel cap remains serialized.
- No browser status can manufacture delivery authority.

## Workstream 3: identity and memory vocabulary

**Owners:** Product Manager, Senior Full-Stack Developer, Security.

Current identities:

- `AgentSeat`: sender/provider/persona capacity.
- `AgentSpec`: owner-bound runtime definition.
- seat-keyed browser chat/memory: shared workspace document feature.
- agent execution memory: encrypted workspace/owner/spec records.
- agent conversation: spec/candidate/channel/provider-thread binding.

1. Inventory every UI label and code path using `memory`, `seat`, `agent`,
   and `conversation`.
2. Decide whether seat-keyed browser memory is workspace notes or persona
   context.
3. Rename it without changing persisted fields first, or migrate it through
   store-version compatibility if the persisted shape changes.
4. Never feed seat-keyed shared memory into Agent execution.
5. Document and test the allowed mapping among seat, owner, spec, run, memory,
   and conversation.

**Exit evidence:** a developer cannot confuse shared UI context with execution
memory; two-user negative tests cover every boundary.

## Workstream 4: server access boundary

**Owners:** Senior Full-Stack Developer, Cybersecurity Analyst, validator.

Current evidence: many API routes independently repeat `auth.getUser()`, role,
workspace, domain, permission, and rate-limit ordering.

1. Extend the existing server principal resolver or introduce
   `requireWorkspaceAccess(request, permission)`.
2. Return typed user, workspace, role, and Supabase context.
3. Keep route-specific object ownership and provider policy separate.
4. Migrate one route family per commit, starting with read-only routes.
5. Add negative tests before each migration:
   - unauthenticated;
   - wrong domain;
   - wrong workspace;
   - wrong owner;
   - insufficient role;
   - unavailable RPC;
   - public demo side-effect attempt.

**Exit evidence:** each migrated route has fewer local auth branches and equal
or stricter failure behavior.

## Workstream 5: browser and two-user QA

**Owners:** Four QA specialists with security review.

Build one exact-SHA Playwright suite against a disposable live Supabase stack:

1. Admin and member sign in.
2. Each creates a separate AgentSpec.
3. Both runs execute concurrently.
4. Assert owner isolation for specs, runs, events, memory, and conversation.
5. Reuse one synthetic candidate address and conflicting provider thread;
   assert no cross-binding.
6. Pause one spec mid-run and prove the next step stops.
7. Expire one session and prove a blocking recovery state.
8. Run desktop and mobile viewports.
9. Run keyboard-only and axe checks on login, Studio, campaigns, candidates,
   outreach, and settings.
10. Verify admin metrics are derived from real events, not seeded state.

**Exit evidence:** videos/screenshots are CI artifacts, not committed image
files; test data is synthetic and deleted after the run.

## Workstream 6: controlled channel acceptance

**Owners:** Tony, Security Director, QA lead.

1. Use dedicated test mailboxes and Meta test numbers.
2. Run one approved email send and reply.
3. Run one official WhatsApp template or open-window send and reply.
4. Capture provider request/receipt identity with secrets removed.
5. Prove named review reasons, suppression, duplicate protection, and
   conversation binding.
6. Prove no AI status text, tool output, JSON, or internal memory appears.
7. Reconcile any ambiguous outcome manually before another attempt.

**Exit evidence:** exact run IDs, message IDs, approvals, provider receipts,
conversation IDs, and zero unexpected sends.

## Workstream 7: protected production release

1. Verify branch and Production environment protection with no administrator
   bypass and an independent reviewer.
2. Remove repository-level `ARIA_DEPLOY_BUNDLE`; verify split Production
   secret names without reading values.
3. Rerun `npm run test:fly-db-volume` where Alpine indexes are reachable.
4. Preserve and inspect a disposable `aria_db_data` clone.
5. Produce the recovery receipt bound to the exact release and recovery target.
6. Advance `deploy/fly-github-actions` only after candidate checks are green.
7. Run the protected workflow for the exact SHA.
8. Verify all running digests, SBOMs, attestations, and migration identity
   through `0025`.
9. Restart DB and Auth twice and prove persistence.
10. Provision and verify the first admin.
11. Run the zero-send synthetic campaign acceptance.

## Workstream 8: remaining repository cleanup

Execute only after current links and developer guides remain green:

1. Move the 51 superseded 2026-06-27 audit files under a dated archive in one
   docs-only commit with mechanical link rewrites.
2. Decide whether to retain or remove unreferenced `Aria/` images. One file is
   byte-identical to the canonical public asset; the other is unique.
3. Move historical screenshots out of the main Git path or into release
   artifacts. Do not rewrite git history.
4. Move or delete unreferenced `floor-verify.mjs` after confirming no operator
   workflow uses it.
5. Remove confirmed zero-reference exports in one focused cleanup with
   typecheck, tests, and build.
6. Add coverage instrumentation and thresholds for security-sensitive routes
   and store modules.

## Commit sequence

1. Documentation and onboarding: complete at `f52813f`.
2. Delivery classifier and replay model: complete at `5a6beda`.
3. Live candidate mapper boundary: complete at `e7136a2`.
4. Store contracts.
5. Store action factory waves.
6. Persistence/canonical projection.
7. Typed server workspace access.
8. Two-user Playwright acceptance.
9. Historical documentation and asset cleanup.
10. Protected exact-SHA release.

Never mix release-setting mutations, production data operations, and source
refactors in one commit.

## Definition of done

ARIA is enterprise-ready only when:

- current local and remote source are equal and clean;
- every mandatory source, security, database, build, browser, and docs gate is
  green for the exact SHA;
- independent agents are proven with two concurrent users and overlapping
  candidate/thread cases;
- memory, conversation, and delivery authority cannot cross owners or specs;
- real email and official WhatsApp acceptance pass with synthetic test data;
- protected release, recovery, digest, migration, restart, login, and campaign
  receipts are retained;
- current documentation reproduces the system from a clean checkout;
- no open high-severity security, correctness, spec, or test-gap finding
  remains.
