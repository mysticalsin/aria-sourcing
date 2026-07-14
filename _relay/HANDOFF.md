---
project: MSourcing / ARIA
shift: 41
agent: codex-gpt-5
updated: 2026-07-14 18:34 EDT
status: source-verified-local-commit-and-codeql-reconciliation-next
---

# Handoff - shift 40 is source-verified; release remains NO-GO

## Current state

- Worktree: `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: local `main`; shift-40 base commit is
  `7658d65c168a127b2f79b27b53cf10d3305476ab`. The full reviewed shift is still
  uncommitted when this snapshot is written. Preserve every dirty file.
- Migration tip is `0033_candidate_erasure_authority.sql`. The reviewed legacy
  public-schema digest is
  `3e1d5f6c2aea60ef7b47f3ce27f1e5dec8afed2a4731e11417dd65332f4561cd`.
- Source gates are green on this exact working tree:
  - `npx tsc --noEmit && npm test` exited 0. `npm test` currently executes 169
    top-level lifecycle commands: 36 pretest, 132 application, and 1 posttest.
  - `npm run lint` and `npm run test:security` exited 0.
  - `npm run build:isolated` compiled successfully and generated 62 static pages.
  - `npm audit --offline --audit-level=moderate` found 0 vulnerabilities.
  - `gitleaks dir . --no-banner --redact --verbose` found no leaks.
  - `git diff --check` exited 0.
  - `npx tsx tests/docs-truth.mts` passed 39/39; the OpenAPI contract parsed all
    7 documented routes and 314 internal references.
  - `node --test infra/agent-frameworks/fly/deployment.test.mjs` passed 15/15,
    including executable no-redirect and no-proxy private-readiness tests.
  - The complete disposable database sequence exited 0: privileges,
    cross-channel capacity, agent memory, 0032 fallback behavior, candidate
    erasure and both concurrency orders, Apollo, sourcing learning,
    conversation authority, framework plus provisioning, owner recovery, and
    Fly database volume/restart behavior.
  - `npm run test:graphify-learning` passed all 10 worker tests with network
    disabled and emitted the bounded receipt.
- Independent application/QA, security, and docs/release reviews all returned
  ready-to-commit after the fixes below. This is local source evidence only.
- The protected release workflow truth is 7 scanned images, 5 locally built and
  attested images, and 6 deployed service images. Graphify has a pre-publication
  container test plus immutable scan/attestation/promotion evidence; there is no
  post-promotion Graphify execution receipt.
- PR 3's current GitHub checks were green when inspected. The failures pasted by
  Tony were historical. Commit
  `ee0cee9344086011a5bd85bd85c7e745e7286b1a` contains the existing CodeQL fixes
  for exactly ten files and is not yet reconciled into this local branch.

## Done this shift

- Added migration 0032 operational authority: exact workspace/seat bindings,
  normalized AgentSpec memory management, bounded framework-memory egress,
  quarantine evidence, replay-safe proposal reports, and disposable fallback
  behavior.
- Added migration 0033 candidate-erasure authority: tenant-bound idempotent
  requests, legal holds, HMAC tombstones, bounded provider obligations,
  content-free receipts, all covered contact-path reimport guards, and shared
  transaction advisory locks. Real two-session tests prove writer-first and
  erasure-first orderings.
- Made the memory API fail closed on authentication or AgentSpec dependency
  failure, added stable keyset pagination, and covered all route methods with
  adversarial dependency tests.
- Made candidate erasure UI authority candidate-scoped and abortable, preserved
  typed 423 legal holds, masked local PII before hydration, and made anonymized
  tombstones immutable and non-restorable.
- Moved the state-changing erasure queue read to same-origin JSON `PATCH
  {action:"list"}`; `GET` is side-effect free and returns 405.
- Preserved full framework idempotent responses, including the bounded public
  report summary, and made missing, malformed, or changed replay reports fail
  closed.
- Aligned Fly private adapter/model-gateway URLs and configuration digests across
  operator, ARIA, and heartbeat. Private readiness now rejects both redirects
  and inherited proxy configuration before any authority can leave the exact
  `FLY_PRIVATE_IP`.
- Corrected OpenAPI legal-hold schemas, route-specific throttling text, API error
  policy, full CI database-gate documentation, release image counts, canonical
  table-inventory references, and the eight-active/two-disabled framework
  topology. Derived docs tests now prevent the release-count drift.
- Clarified that the 0032 SQL fallback is source-tested but production-prohibited
  until a protected apply job and append-only, ledger-safe forward migration
  exist.
- Wrote Sonnet-executable repository-organization plans in `_relay/plans/` for
  CodeQL reconciliation, import boundaries/navigation, declarative test
  manifests, TypeScript/docs truth, one bounded store extraction, synthetic
  Playwright smoke, four review lanes, and exact-SHA release readback.
- Recorded each correctness, security, spec, and test-gap finding in
  `_relay/codex-findings.md`.

## Blockers

- **Push and production release are not authorized.** GitHub, Fly, and
  ElevenLabs credentials were previously exposed. Rotation, access-history
  review, and proof that the current operator has least-privilege release
  authority have not been provided. `gh auth status` alone is not rotation proof.
- The live deployment previously reported build
  `d2040b534177f5bd2abb28f22de19af57b58dc3a` and migration
  `0023_conversation_identity.sql`; it is not evidence for this source tree or
  migrations 0024-0033. No exact-SHA protected deploy or current live readback
  has been completed.
- Candidate erasure is not production-acceptable until run/framework/memory
  payloads have explicit candidate provenance and erasure receipts, an
  independently retained restore-replay journal exists, provider deletion
  evidence is verified independently, and the path above 100 obligations is
  supported.
- The 0032 application-surface fallback has no protected production apply job or
  ledger-safe forward migration. Do not apply
  `supabase/rollbacks/0032_agent_operational_authority.sql` in production.
- DeerFlow/Flowise activation still lacks promoted immutable upstream-base
  evidence, live private Fly deployment, constrained-egress proof, Flowise
  bootstrap proof, PostgreSQL HA and timed restore evidence, eight active-role
  identity/readiness results, two disabled-role absence proofs, and a real
  approved campaign E2E. The last reviewed Kimi authority returned HTTP 402;
  provider funding/entitlement and exact model approval remain external.
- The verified shift-40 baseline is not yet committed. The separate CodeQL fix
  commit and the repository-organization plans are also not yet integrated.

## Next steps

1. Confirm `git status --short`, `git diff --check`, branch `main`, and that no
   test/build process is still active. Stage the complete reviewed shift-40 file
   set explicitly. Do not use reset, clean, checkout, or stash.
2. Commit the verified baseline as one honest shift-40 integration commit. Read
   back `git status`, `git show --stat --oneline HEAD`, and the commit SHA.
3. Inspect `git show ee0cee9344086011a5bd85bd85c7e745e7286b1a`, then reconcile
   that existing CodeQL commit separately. Its intended scope is exactly:
   `src/app/winlog/page.tsx`, `src/lib/ai/web-tools.ts`, `src/lib/utils.ts`,
   `tests/channels.mts`, `tests/mcp-query-auth.mts`,
   `tests/obscura-integration.mts`, `tests/safe-exit-traps.mts`,
   `tests/web-tavily-key.mts`, `tests/web-tools.mts`, and `tests/winlog.mts`.
   Run those focused tests, typecheck, lint, security, and diff checks; commit it
   without unrelated edits.
4. Execute `_relay/plans/00-aria-structure-orchestrator.md` through
   `_relay/plans/04-store-extraction-and-release-proof.md` in the documented
   order from an isolated `codex/aria-structure-hygiene-20260714` worktree.
   Preserve small commits and permanent manifest/CI registration for every new
   regression. Remove the temporary `test:shift40` name when its commands are
   represented by durable groups.
5. Integrate the organization commits back into local `main`, rerun the full
   source, security, build, database, recovery, Graphify, and four-review-lane
   gate on one SHA, then archive/rewrite this baton again.
6. Push only after Tony supplies evidence that the exposed credentials were
   rotated and that the current identity has approved least-privilege release
   authority. After a successful push, read back the remote SHA and inspect
   exact-SHA CI, CodeQL, annotations, and open alerts with `gh`.
7. Dispatch production only through the protected workflow after every external
   blocker above is closed. Prove migration 0033, immutable digests, backup and
   restore, restarts, auth, provider/model readiness, zero-send controls, and a
   real approved campaign before allowing real candidate use.

## Decisions made (don't relitigate)

- Local source commits are allowed; push and deploy remain prohibited until
  credential rotation and release authority are proven.
- Current GitHub PR checks, not the pasted historical run list, are the CI source
  of truth. Reuse the already-reviewed `ee0cee9` CodeQL fix; do not reimplement it.
- Candidate erasure never claims provider deletion from local scrubbing or an
  administrator-entered hash. Provider evidence remains in the approved privacy
  system and completion stays non-final until every obligation is proven.
- The 0032 SQL fallback is a disposable-test artifact, not a production runbook
  action, until protected reverse/forward machinery exists.
- DeerFlow stays memory-only and tracing-disabled. Flowise owns the only active
  framework PostgreSQL/Redis pair. Ten signed roles mean eight active apps plus
  two release-disabled DeerFlow persistence provenance roles.
- HTTP is permitted only for credential-free `.internal` Fly 6PN authorities.
  Redirects, environment proxies, queries, fragments, public origins, and URL
  credentials fail closed.
- Migrations are append-only. Fly production uses only the protected bootstrap
  ledger; never use `supabase db push` or SQL Editor against Fly production.
- Graphify receives only reviewed aggregate, content-free sourcing evidence. No
  candidate PII or free text enters the lesson worker.
- Do not claim production readiness from local tests, local containers, a green
  shell page, or an older live deployment.

## Watch out

- Claude and Codex share this worktree. Every uncommitted file is real work.
  Never discard or overwrite it because it is not yet in `HEAD`.
- OneDrive can break or slow direct Next builds. Use `npm run build:isolated`
  for the source checkout.
- The CodeQL commit can conflict with the large shift-40 baseline. Resolve only
  within its ten-file scope and compare the resulting diff to `git show ee0cee9`.
- Database tests create Docker projects and volumes. If interrupted, inspect
  named `aria-*` resources and clean only resources created by the interrupted
  test; never remove unrelated volumes.
- Never put credentials, provider references, candidate data, decrypted memory,
  or private evidence into Relay, logs, commits, test fixtures, or chat.
- Keep production effect flags and the framework kill switch off while external
  evidence remains incomplete.
