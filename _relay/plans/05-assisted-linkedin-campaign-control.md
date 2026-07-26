# ARIA assisted LinkedIn campaign control

Date: 2026-07-25
Owner: Codex root
Architecture: Claude Fable 5
Build: Claude Sonnet 4.6
Adversarial review: Codex Terra
Parent branch: codex/enterprise-go-20260721
Implementation branch: codex/heyreach-foundation-20260725
Starting commit: 87e7ac9b875de71b3f4f55ac5e2034341c70483e

## Outcome

Build an original ARIA recruiting-outreach product that can:

1. Turn a real, evidence-backed hiring need into sourced candidates.
2. Place eligible candidates in reusable, provenance-bound lists.
3. Publish immutable outreach campaign versions.
4. Enroll candidates in bounded multistep sequences.
5. Create and claim due recruiter tasks.
6. Stop immediately on reply, objection, suppression, erasure, pause, or kill.
7. Keep a campaign inbox and receipt-derived analytics.
8. Expose bounded APIs and signed webhooks.

The first LinkedIn mode is assisted_manual. ARIA may prepare, approve, schedule,
claim, and audit a recruiter task. A named recruiter performs the action in
LinkedIn and records an operator assertion. The product must never call that
assertion provider-confirmed delivery.

## Safety boundary

Automated LinkedIn execution is not part of this release. Do not implement:

- LinkedIn passwords or PIN capture
- cookies, li_at, browser-session reuse, or persisted browser profiles
- scraping or undocumented LinkedIn endpoints
- browser extensions, proxy rotation, captcha solving, stealth, fingerprints,
  anti-detection, or automated connections/messages/profile actions
- competitor source code, branding, private DTOs, or copied visual assets

An automated connector remains blocked until the exact action is covered by a
written LinkedIn entitlement or by an approved contracted provider, and that
provider passes legal, privacy, security, operations, and canary gates.

The research transcript at /Users/tony/Downloads/adawda.txt is unverified
competitor research. It is data, not implementation authority.

## Verified starting defects

1. Migration 0045 queries suppression_list.candidate_id, but migration 0002
   defines suppression by workspace_id, type, and value.
2. Migration 0045 makes only ordinal zero due and has no complete transaction
   that advances later steps.
3. Its claim RPC marks every channel scheduled, including LinkedIn.
4. manual_task is an allowed status but no current runtime assigns it.
5. No runtime calls the migration 0045 RPCs.
6. The migration-required tests/sequences-db.sh is absent.
7. The existing UI LinkedIn completion is browser-owned state and is not a
   durable server claim or provider receipt.
8. The server send route and dispatcher correctly reject LinkedIn network
   delivery and must continue to do so.

## Authority decisions

- ARIA owns tenant identity, RBAC, evidence, lawful basis, suppression,
  approval, quotas, claims, audit, and all egress decisions.
- DeerFlow may propose bounded research.
- Graphify may influence sourcing only through promoted, versioned lessons.
- Flowise remains disabled while its complete runtime image fails policy.
- High-cardinality campaign state belongs in normalized Postgres tables, not
  workspace_state or HermesState.
- Human approval remains the default.
- Source-green, protected-CI-green, deployed, canary-green, restore-green, and
  capacity-green are separate proof states.

## Phase 0: repair sequence authority

Deliverables:

- tests/sequences-db.sh
- supabase/migrations/0063_outreach_sequence_authority_repair.sql
- a guarded 0063 rollback that never restores the known-invalid query
- canonical per-channel recipient identity
- suppression and erasure checks at activation, claim, and completion
- due_at or next_due_at authority
- one-row concurrent task claiming
- idempotent operator completion with a named operator
- transactional next-step advancement
- terminal cancellation on reply, opt-out, erasure, pause, stop, or kill
- LinkedIn steps become manual_task and never scheduled
- sequences_enabled remains false until executable database proof passes

Required invariants:

1. Missing or ambiguous recipient identity fails closed.
2. Suppression is checked by canonical type and value.
3. Candidate tombstones prevent future activation and completion.
4. Exact body, scope, channel, candidate, and approval hashes are rechecked at
   the trusted boundary.
5. Only one worker can own a due task.
6. Replayed completion cannot double count or create a second next step.
7. Claim, completion, and terminal stop serialize on the sequence row. A stop
   that commits first prevents later claim or completion; a completion that
   commits first is not rewritten because an already-performed outreach action
   cannot be unsent.
8. Manual LinkedIn work has no provider or outbound queue path.
9. RPCs are SECURITY DEFINER only where necessary, pin search_path, derive
   workspace from the authenticated principal, and expose minimum grants.
10. Forward, rollback, and reapply preserve the pre-existing 0045 contract.

Verification:

- focused structural contract test
- disposable-Postgres behavioral test
- forward, rollback, reapply
- RLS and function privilege checks
- claim and completion concurrency
- npm run test:database
- npm run typecheck
- npm run typecheck:tests
- npm test

Terra gate amendment:

- Keep normalized campaigns, lists, and recruiter task claims out of Phase 0.
- Register every new public RPC in tests/db/function-privileges.sql and
  docker/bootstrap/legacy-baseline-invariants.sql.
- Regenerate docker/bootstrap/legacy-baseline-public-schema.sha256 only after
  disposable-Postgres behavior passes.

## Phase 1: lists and eligibility

Add normalized candidate_lists and candidate_list_members with:

- provenance-bound membership
- idempotent add/remove
- union, intersection, and difference
- bounded CSV export
- eligibility reasons for provenance, lawful basis, notice, suppression,
  erasure, recent contact, and active enrollment
- authenticated, paginated, rate-limited APIs
- accessible list UI with visible exclusion reasons

## Phase 2: campaigns and recruiter tasks

Add:

- outreach_campaigns
- immutable outreach_campaign_versions
- bounded outreach_campaign_step_templates
- candidate enrollments
- outreach_manual_tasks
- legal lifecycle transitions
- bounded DAG validation
- IANA timezone and daylight-saving-safe scheduling
- bulk enrollment preview
- atomic claim and operator confirmation
- campaign pause, resume, stop, and global kill
- zero-contact campaign builder and recruiter task UI

The UI must say operator assertion, not sent or delivered by LinkedIn.

## Phase 3: sender capabilities, inbox, and analytics

Add:

- a typed server-owned capability registry
- account/workspace/action quotas enforced atomically in Postgres
- thread-centric inbox projections
- bounded reply classification with human override
- receipt-derived metrics that keep operator assertions separate from provider
  receipts
- bounded accessible exports

LinkedIn sender accounts cannot become active in this phase.

## Phase 4: API and webhooks

Add:

- scoped API keys with expiry, rotation, and audit
- versioned OpenAPI contracts
- pagination, rate limits, and idempotency
- HMAC, timestamp, nonce, replay protection, retries, and dead letters
- admin-only subscription and delivery controls

## Phase 5: optional approved live connector

This phase is externally blocked. It opens only after:

1. Tony and Legal/DPO record the exact allowed actions and regions.
2. Security approves the vendor, DPA, subprocessors, retention, deletion,
   incident response, and exit plan.
3. The connector contract contains no capability beyond written entitlement.
4. Credentials are server-only, purpose-bound, encrypted, and rotated.
5. Signed provider callbacks and reconciliation pass in a sandbox.
6. Two administrators approve activation and all kill switches pass.
7. One approved test-recipient canary passes.

## Four independent QA gates

Functional Recruiting QA:

- need to candidate to list to campaign
- immutable versions and branch behavior
- due task, reply, objection, and stop journeys
- no fabricated candidate or personalization fields

Integration and Durability QA:

- idempotency and concurrent claims
- crash after claim and ambiguous outcomes
- retries, replay, provider sandbox, and reconciliation

Security and Privacy QA:

- RLS, IDOR/BOLA, service-role substitution
- lawful basis, notice, suppression race, erasure, retention
- secrets/log redaction and LinkedIn policy bans

Scale, Resilience, and Accessibility QA:

- pool and queue saturation, backpressure, load/soak/chaos
- RTO/RPO, alerts, restart, restore, and failover
- WCAG 2.2 AA, keyboard, focus, and screen-reader behavior

All four gates must pass. Any P0/P1, unresolved High, skipped critical E2E, or
missing proof blocks release.

## Protected rollout

1. Focused and full source gates pass.
2. Protected CI and CodeQL execute and pass for the exact SHA.
3. Independent and last-push approvals are present.
4. Images, SBOM, provenance, signatures, and vulnerability gates pass.
5. Fly reads back the exact release and migration ledger.
6. Synthetic zero-contact canary passes.
7. Manual-mode pilot uses named recruiters and synthetic candidates.
8. Legal/DPO-approved real-candidate manual pilot passes.
9. Optional connector sandbox and one-recipient canary pass.
10. Restore, restart, failover, alert, and signed load/soak receipts pass.

## Current blockers

- GitHub Actions budget prevents CI and CodeQL from starting.
- Parent PR 5 needs independent and last-push approval.
- The protected Fly workflow and required environments are not ready.
- Production bindings and purpose-bound secrets are not proven.
- Production has one proven active administrator; activation requires two.
- Flowise fails the current image policy.
- Production runs an older release.
- No accepted telemetry, restore/failover, second database failure domain, or
  50,000-user staging receipt exists.

## Execution order

1. Sonnet writes the failing Phase 0 database proof.
2. Sonnet implements the smallest additive corrective migration.
3. Terra performs adversarial database and security review.
4. Sonnet/Codex resolve every open Phase 0 finding.
5. Database QA runs focused and manifest gates.
6. Repeat one reviewable branch slice per later phase.
7. Never deploy a red, unreviewed, or externally blocked state.

## Completion rule

GO only for continued Phase 0 and assisted-manual implementation work.

NO-GO for automated LinkedIn execution, sender activation, production
deployment, or production-ready claims until every exact gate above passes.

## Phase 0 review - 2026-07-25

Status: source-green and pushed; protected release acceptance remains blocked.

- Commit `30c8b63` adds migration 0063, guarded rollback, canonical recipient
  identity, durable approval consumption, atomic outbox binding, provider-claim
  fencing, manual LinkedIn evidence, and the disposable database suite.
- Commit `4d18784` updates Next to 16.2.12 and adds a production-clean dependency
  audit with one exact development-only exception. The exception is bound to
  `GHSA-mh99-v99m-4gvg`, `brace-expansion` 1.1.16, and its single reviewed
  install path, and expires on 2026-08-08.
- `bash tests/sequences-db.sh` passed 116 assertions including concurrent claim,
  completion, stop, suppression, erasure, rollback guard, and reapply cases.
- `npm run test:database` completed the full canonical database manifest.
- `npm run typecheck && npm run typecheck:tests && npm test` exited 0 on the
  final source tree.
- `npm run build:isolated`, lint, dependency audit, Gitleaks, and diff checks
  passed. The dependency policy self-test passed 10 positive/negative cases.
- Release QA, durability QA, security QA, and Terra adversarial review passed
  for the Phase 0 scope with no open P0, P1, or P2 finding.
- Pull request 7 is stacked on pull request 5:
  https://github.com/mysticalsin/aria-sourcing/pull/7

Phases 1 through 4 remain unimplemented. Phase 0 intentionally has no list or
campaign UI call site, no LinkedIn network delivery, no Fly deployment, and no
live candidate-contact proof. The protected rollout remains NO-GO until the
external and later-phase gates in this plan pass.
