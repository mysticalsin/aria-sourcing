# ARIA Enterprise Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ARIA an enterprise-production sourcing application whose frontend, backend, APIs, agents, tenant boundaries, provider side effects, operations, and release evidence work as one verified system.

**Architecture:** ARIA remains the identity, policy, data, audit, and delivery control plane. Supabase owns live authority and normalized operational records; browser workspace state is never trusted for roles or external side effects. Flowise is a private authoring sidecar, while every execution and send passes ARIA's stored AgentSpec, server policy, durable outbox, and release gates.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Supabase Auth/Postgres/PostgREST, Zod, Playwright, Vercel, Docker Compose, Flowise sidecar, Gmail/Microsoft Graph, Meta WhatsApp Cloud API.

## Global Constraints

- Preserve the `vercel-demo` branch and all concurrent work. Never discard untracked files.
- Use test-first changes for every behavior change. Record the failing result before implementation.
- Keep SMS disabled until it has consent, opt-out, DNC, frequency, and durable delivery policy equal to email and WhatsApp.
- Keep LinkedIn assisted and draft-only unless an approved official integration is implemented.
- Public demo mode is synthetic and dry-run for every irreversible external side effect.
- Never expose provider keys, OAuth tokens, candidate PII, or message bodies in logs or evidence.
- Every live write is tenant-scoped and role-scoped at both API and database layers.
- Every release claim names the exact commit, environment, migration version, command, exit code, and skipped external checks.
- Required local gate: `npx tsc --noEmit && npm test`, run bare with no output pipe.
- Required release gates also include lint, production build, high-severity dependency audit, database isolation, browser E2E, accessibility, live-provider smoke, monitoring, rollback, and restore.

---

## Verified baseline at plan creation

Local commit `14f76f1` on 2026-07-09:

- `npx tsc --noEmit && npm test`: exit 0, 67 chained suites, zero reported failures.
- `npm run build`: exit 0, 57 routes generated.
- `npm run lint`: exit 0.
- `git diff --check`: exit 0.
- `npm audit --omit=dev --audit-level=high`: exit 0, two moderate PostCSS findings and no safe non-breaking automatic fix.
- Local Docker services are running, but the database exposes only the first nine application tables. Migrations `0007` through `0015` are not applied to that persistent volume.
- GitHub CI and CodeQL for the exact SHA did not start because the account Actions budget blocked all jobs. This is an external release blocker, not a passing or failing code result.
- Production Flowise, Meta WhatsApp, production migration, monitoring, restore, two-user isolation, real admin metrics, and final acceptance evidence are absent or unverified.
- `ELEVENLABS_API_KEY` must be rotated because it appeared in an internal tool result during this audit.

## Release definition of done

All boxes below must be checked against one exact release SHA:

- [ ] Two users, one admin and one regular, authenticate through the production identity path.
- [ ] Each user creates a different stored AgentSpec and can read or change only authorized specs.
- [ ] Each user runs a full planner to sourcer to screener to outreach to reporter cycle from the stored spec.
- [ ] Concurrent runs remain tenant and owner isolated at API, RLS, and UI layers.
- [ ] A real email reaches a Tony-controlled inbox with working unsubscribe, receives a reply, and records the reply.
- [ ] A real official-API WhatsApp message reaches a Tony-controlled number and delivery state reconciles.
- [ ] An in-policy reply follows canary and approval policy; an out-of-policy reply stays in human review.
- [ ] No AI status, tool output, hidden reasoning, JSON, placeholder, or duplicate reaches a provider.
- [ ] Admin metrics are computed from real user, run, event, message, and outcome rows.
- [ ] Flowise authoring is private, workspace-bound, and cannot bypass ARIA execution or provider policy.
- [ ] CI, CodeQL, secret scan, dependency scan, SBOM, build, database checks, browser E2E, and accessibility pass for the exact SHA.
- [ ] Monitoring, alert delivery, rollback, backup, and restore are tested in the target environment.
- [ ] Tony records the manual acceptance result and release decision.

## Phase 0: Freeze false claims and close exposed credentials

### Task 1: Rotate the exposed ElevenLabs credential

**Files:**

- Modify outside git: ElevenLabs account key and local `.env.local`
- Verify: deployment secret inventory and local key name only

**Interfaces:**

- Consumes: current ElevenLabs project access
- Produces: a new key unavailable in chat, logs, git, screenshots, or evidence

- [ ] Revoke the exposed ElevenLabs key in the ElevenLabs console.
- [ ] Create a replacement with the minimum required TTS permission and an owner.
- [ ] Replace the local and deployment secret without printing it.
- [ ] Call the authenticated TTS smoke test once, then confirm the old key fails.
- [ ] Record only rotation time, owner, and PASS/FAIL in the release evidence.

### Task 2: Replace stale readiness claims with a live matrix

**Files:**

- Modify: `production-readiness/PRODUCTION_READINESS_REPORT.md`
- Modify: `production-readiness/RELEASE_GATE_MATRIX.md`
- Modify: `production-readiness/EVIDENCE_INDEX.md`
- Test: `tests/readiness-doc-drift.mts`

**Interfaces:**

- Consumes: current package, routes, migrations, git remote, and gate output
- Produces: one current matrix with `verified`, `failed`, `blocked`, and `unknown` evidence states

- [ ] Write a failing doc-drift test that checks branch, framework major, test-suite count, migration count, and remote state.
- [ ] Run `npx tsx tests/readiness-doc-drift.mts` and capture the expected stale-claim failures.
- [ ] Rewrite the summary from current evidence without converting unknown deployment facts into passes.
- [ ] Add the test to `npm test`.
- [ ] Run the targeted test and the full gate.

## Phase 1: Authority and irreversible-side-effect boundaries

### Task 3: Make public demo mode dry-run at the server boundary

**Files:**

- Modify: `src/app/api/outreach/send/route.ts`
- Modify: `src/app/api/outreach/approve/route.ts`
- Modify: `src/app/api/calendar/event/route.ts`
- Audit: all provider-touching routes under `src/app/api/`
- Test: `tests/demo-live-side-effects.mts`

**Interfaces:**

- Consumes: `demoLoginEnabled`, authenticated Supabase session, `confirmLive`
- Produces: a server-side decision that forbids irreversible provider calls on public demo deployments

- [ ] Write failing tests for Supabase-enabled production with `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`, a valid admin session, a live seat, and `confirmLive=true`.
- [ ] Prove email, WhatsApp, calendar, mailbox, and other irreversible provider paths currently lack one shared demo-side-effect denial.
- [ ] Add a server-only helper returning a dry-run or forbidden result for public demo deployments.
- [ ] Apply it before approvals, provider calls, claims, calendar creation, and live mailbox mutation.
- [ ] Verify the normal authenticated tenant path is unchanged.

### Task 4: Authenticate the paid TTS endpoint

**Files:**

- Modify: `src/app/api/voice/tts/route.ts`
- Create or modify: `src/lib/api/authenticated-principal.ts`
- Test: `tests/voice-tts-auth.mts`

**Interfaces:**

- Consumes: Supabase user session or signed demo session
- Produces: authenticated principal before the ElevenLabs key or API is touched

- [ ] Write a failing test that an anonymous production request cannot reach the injected ElevenLabs fetch.
- [ ] Write a passing-case contract for a Supabase user and signed public-demo session.
- [ ] Put authentication before the environment-key check and rate-limit by principal plus IP.
- [ ] Keep the existing browser speech fallback for 204, 401, 429, and upstream failures.
- [ ] Verify request text and provider errors never reach logs.

### Task 5: Bind UI authority to `profiles.role`

**Files:**

- Modify: `src/lib/supabase/workspace.ts`
- Modify: `src/lib/store.ts`
- Modify: `src/components/settings/roles-panel.tsx`
- Modify: `src/lib/types.ts`
- Test: `tests/live-role-authority.mts`

**Interfaces:**

- Consumes: `current_profile_role()` for the signed-in user
- Produces: a live `CurrentUser.role` and UI permission state that cannot be changed through workspace JSON

- [ ] Write a failing two-role test proving seed or shared-state `currentRole: admin` overrides a viewer profile.
- [ ] Load the profile role with the current user and make it authoritative after hydration.
- [ ] Ignore or strip `workspace_state.currentRole` in live mode.
- [ ] Remove the live role switcher. Keep an explicitly labelled preview switcher only in backend-free demo mode.
- [ ] Verify admin controls disappear for viewer and member sessions even when the shared JSON says admin.

### Task 6: Tighten RLS and table grants for agent and message tables

**Files:**

- Create: `supabase/migrations/0016_authority_boundaries.sql`
- Modify: server routes that require service-role writes after grant removal
- Test: `tests/authority-boundaries.mts`
- Create: `scripts/verify-tenant-isolation.sql`

**Interfaces:**

- Consumes: `current_workspace_id()`, `current_profile_role()`, `auth.uid()`
- Produces: owner and role constraints that apply even when PostgREST is called directly

- [ ] Write failing migration tests showing a viewer can currently insert or update agent specs, runs, inbound messages, and outbound ledger rows.
- [ ] Restrict AgentSpec writes to owner or admin and regular-user reads to owner unless an explicit share exists.
- [ ] Make agent run and event writes service-owned, or enforce server-equivalent role and ownership predicates.
- [ ] Revoke authenticated direct writes to inbound and outbound message ledgers. Route all writes through checked server APIs or narrow database functions.
- [ ] Add cross-table checks so `agent_runs.spec_id`, run workspace, and spec workspace cannot diverge.
- [ ] Run the SQL verification inside a rollback transaction for admin, member, viewer, anonymous, and foreign-workspace claims.

### Task 7: Make manual suppression server-confirmed

**Files:**

- Modify: `src/components/fleet/suppression-panel.tsx`
- Modify: `src/lib/store.ts`
- Modify: `src/app/api/compliance/suppress/route.ts`
- Test: `tests/manual-suppression-sync.mts`

**Interfaces:**

- Consumes: email, domain, phone, or LinkedIn suppression request
- Produces: one normalized enforcement-table record before the UI claims success

- [ ] Write a failing test proving `addSuppression` currently changes only workspace JSON and displays a permanent-success message.
- [ ] Extend the endpoint to every supported suppression type with explicit normalization rules.
- [ ] Await server confirmation before committing live-mode UI state or success toast.
- [ ] On failure, leave the local list unchanged and show a recovery message.
- [ ] Apply the same rule to removal so a local restore cannot silently leave server DNC active.

## Phase 2: Delivery concurrency and reconciliation

### Task 8: Prevent dispatch workers from overwriting each other

**Files:**

- Modify: `src/lib/dispatch-outbound.ts`
- Create: `supabase/migrations/0017_dispatch_concurrency.sql`
- Test: `tests/dispatch-concurrency.mts`

**Interfaces:**

- Consumes: queued outbox row and atomic claim result
- Produces: one worker-owned attempt whose state cannot be downgraded by a losing worker

- [ ] Write a failing two-worker test where both workers read one queued WhatsApp row.
- [ ] Make the losing claim a no-op when the row is already `dispatching` or `sent`.
- [ ] Add compare-and-set conditions to every finish transition.
- [ ] Keep ambiguous provider acceptance in reconciliation, never `blocked`, `failed`, or retryable.
- [ ] Verify one provider call, one ledger record, one provider message ID, and one final state.

### Task 9: Make email acceptance ambiguity non-retryable

**Files:**

- Modify: `src/app/api/outreach/send/route.ts`
- Modify: provider result types in `src/lib/providers.ts` and OAuth send helpers
- Create: migration or reconciliation table if provider IDs are available
- Test: `tests/email-reconciliation.mts`

**Interfaces:**

- Consumes: provider response, timeout, request identity, approval identity
- Produces: `sent`, `reconciliation-required`, or proven pre-send failure

- [ ] Write a failing test for provider acceptance followed by response timeout.
- [ ] Stop converting ambiguous network errors into `skipped` and releasing the dedupe claim.
- [ ] Persist provider request identity and message ID where supported.
- [ ] Require human or provider reconciliation before retry.
- [ ] Verify a repeated request cannot send the same approved message twice.

### Task 10: Make daily caps atomic

**Files:**

- Create: `supabase/migrations/0018_atomic_capacity.sql`
- Test: `tests/daily-cap-concurrency.mts`

**Interfaces:**

- Consumes: seat, current date, cap, candidate, channel
- Produces: a serialized reservation below the cap

- [ ] Reproduce two concurrent claims at cap minus one.
- [ ] Lock the seat or a per-seat daily counter before count and insert.
- [ ] Verify exactly one claim succeeds and the other returns `daily-cap`.
- [ ] Verify rollback releases a failed reservation without reducing an accepted count.

## Phase 3: Stored AgentSpec to real execution

### Task 11: Bind agent runs to stored specs

**Files:**

- Modify: `src/app/api/agents/run/route.ts`
- Modify: `src/lib/agents/graph.ts`
- Modify: `src/app/api/agents/specs/route.ts`
- Test: `tests/agent-run-service.mts`
- Test: `tests/agent-run-route.mts`

**Interfaces:**

- Consumes: `specId`, bounded run inputs, authenticated user
- Produces: persisted run based on server-loaded role brief, channels, owner, status, and guardrails

- [ ] Write a failing test that client campaign JSON currently overrides the stored spec and `specId` may be omitted in live mode.
- [ ] Require `specId` in live mode and load it through owner or admin authorization.
- [ ] Reject paused, archived, foreign-owner, foreign-workspace, or missing specs.
- [ ] Build graph state from the stored role brief and allowed channels.
- [ ] Treat run-row, step-state, and event persistence errors as explicit failure or resumable pause.
- [ ] Preserve stateless execution only for the labelled synthetic demo.

### Task 12: Add run and recovery controls to Agent Studio

**Files:**

- Modify: `src/app/studio/page.tsx`
- Create: focused components under `src/components/studio/`
- Create: run status endpoint if required
- Test: `tests/agent-studio-state.mts`
- Browser test: `e2e/agent-studio.spec.ts`

**Interfaces:**

- Consumes: stored spec and persisted run status
- Produces: create, edit, run, pause, resume, inspect events, and review drafts

- [ ] Disable SMS selection with an explicit policy explanation.
- [ ] Add run action, progress states, persisted run ID, retry-safe resume, and error recovery.
- [ ] Display which data is stored, which provider is used, and whether the result is demo or live.
- [ ] Show gate-held drafts separately from review-ready drafts.
- [ ] Verify two users can run concurrently without seeing each other's specs, runs, events, or drafts.

### Task 13: Normalize live sender-seat management

**Files:**

- Create or modify: server API for `agent_seats`
- Modify: fleet and settings seat controls in `src/lib/store.ts` and `src/components/fleet/`
- Test: `tests/normalized-seats.mts`

**Interfaces:**

- Consumes: authenticated admin seat configuration and OAuth connection
- Produces: normalized `agent_seats` rows used by send, domain verification, OAuth, and UI

- [ ] Write a failing test proving UI-created live seats exist only in workspace JSON.
- [ ] Make the normalized table authoritative in live mode.
- [ ] Require admin authority, verified provider binding, and explicit live activation.
- [ ] Reflect normalized status back into the UI without silently falling back to mock.
- [ ] Verify the same seat ID is used by AgentSpec, OAuth connection, domain verification, outbox, and ledger.

## Phase 4: Flowise and admin operations

### Task 14: Provision Flowise as a private tenant-bound authoring sidecar

**Files:**

- Add: deploy configuration for the selected host
- Modify: `src/app/api/flowise/[...path]/route.ts`
- Modify: `src/app/studio/page.tsx`
- Add: Flowise operations runbook and network policy evidence
- Test: Flowise contract and tenant-isolation E2E

**Interfaces:**

- Consumes: authenticated ARIA user, authorized AgentSpec, workspace-bound flow ID
- Produces: versioned authoring changes translated into ARIA-approved AgentSpec revisions

- [ ] Provision dedicated PostgreSQL, stable encryption key, backups, secrets, and private network path.
- [ ] Decide single-tenant instance per workspace or a proven isolation layer before enabling authoring.
- [ ] Disable unneeded nodes, arbitrary network access, and credential exposure.
- [ ] Map saved flow versions to AgentSpec revisions with approval and rollback.
- [ ] Prove Flowise cannot call email, WhatsApp, LinkedIn, or ARIA tables directly.

### Task 15: Build real admin metrics

**Files:**

- Create: admin metrics API and query layer
- Create: admin dashboard route or replace the current synthetic management surface
- Test: `tests/admin-metrics.mts`
- Browser test: `e2e/admin-dashboard.spec.ts`

**Interfaces:**

- Consumes: profiles, specs, runs, events, outbound, inbound, approvals, delivery, and outcomes
- Produces: workspace user activity, run success, time, funnel, reply, approval, blocked-send, delivery, and efficiency metrics

- [ ] Define metric names, numerator, denominator, time window, source table, and missing-data behavior.
- [ ] Require admin at API and RLS layers.
- [ ] Use real event rows. Do not mix seed data into live metrics.
- [ ] Display freshness, filters, and partial-data warnings.
- [ ] Verify admin sees both test users while a regular user receives 403 and no aggregate data.

## Phase 5: Frontend truth, accessibility, and responsive operation

### Task 16: Stop live backend failures from becoming synthetic success

**Files:**

- Modify: `src/lib/supabase/workspace.ts`
- Modify: `src/lib/store.ts`
- Modify: `src/components/app/providers.tsx`
- Test: `tests/live-hydration-failure.mts`

**Interfaces:**

- Consumes: live load result with `loaded`, `empty`, `failed`, or `conflict`
- Produces: explicit loading, empty, degraded, conflict, and ready states

- [ ] Write a failing test for `ensure_workspace` and state-read failures.
- [ ] Keep a true new-workspace empty result separate from backend failure.
- [ ] Show a blocking degraded screen with retry and support detail on failure.
- [ ] Never call `buildSeedState()` for a Supabase-enabled failed load.
- [ ] Verify offline edits cannot be presented as persisted.

### Task 17: Make integration status honest

**Files:**

- Modify: `src/components/settings/integration-card.tsx`
- Modify: `src/lib/integrations.ts`
- Test: `tests/integration-status.mts`

**Interfaces:**

- Consumes: adapter capability and API-key save result
- Produces: connected only after server confirmation and a supported adapter path

- [ ] Reproduce a 403 or encryption-key failure and prove the UI currently toasts success.
- [ ] Await and inspect `saveApiKey` result before state mutation.
- [ ] Hide or label controls for concept-only integrations with no adapter.
- [ ] Add test and verify for connect, failure, retry, test, and disconnect.

### Task 18: Repair focus and responsive primary journeys

**Files:**

- Modify: `src/components/ui/modal.tsx`
- Modify: `src/components/ui/drawer.tsx`
- Modify: `src/app/chat/page.tsx`
- Modify: `src/components/app/topbar.tsx`
- Test: component state tests
- Browser test: `e2e/responsive-core.spec.ts`

**Interfaces:**

- Consumes: 320px through large desktop viewports, keyboard, pointer, and screen reader
- Produces: stable focus, reachable chat, reachable voice, and no clipped primary action

- [ ] Keep modal and drawer focus effects stable when parent callbacks change identity.
- [ ] Use a mobile master-detail chat pattern instead of three fixed panes.
- [ ] Provide a mobile and tablet path to the voice console.
- [ ] Test focus trap, return focus, Escape, scroll lock, virtual keyboard, and reduced motion.

### Task 19: Make careers CV handling factual

**Files:**

- Modify: `src/components/careers/chatbox.tsx`
- Create: server-side supported document parser or restrict accepted types to actual parsing capability
- Test: `tests/careers-cv-parsing.mts`

**Interfaces:**

- Consumes: supported CV text or document
- Produces: extracted fields with provenance, or explicit unsupported or parse-failed state

- [ ] Reproduce empty and binary PDF, DOC, and DOCX inputs.
- [ ] Remove inferred fallback skills presented as CV detections.
- [ ] Either parse each advertised format on the server with size and malware checks, or stop accepting that format.
- [ ] Show source and confidence for extracted values and require confirmation.

### Task 20: Complete accessibility and browser QA

**Files:**

- Create: `e2e/accessibility.spec.ts`
- Update: `production-readiness/ACCESSIBILITY_REPORT.md`
- Fix: issues found in routes and shared components

**Interfaces:**

- Consumes: every primary route and interactive state
- Produces: WCAG 2.2 AA evidence plus documented manual checks

- [ ] Run automated axe checks on login, command center, intake, Studio, candidates, outreach, replies, admin, settings, and careers.
- [ ] Run keyboard-only and VoiceOver smoke journeys.
- [ ] Test focus visibility, 200 percent zoom, reduced motion, high contrast, long content, empty, loading, error, and offline states.
- [ ] Test latest Chrome, Safari, Firefox, and Edge at phone, tablet, laptop, and large-monitor widths.
- [ ] Store defects with severity, route, reproduction, screenshot, and retest result.

## Phase 6: Operations, data recovery, and release controls

### Task 21: Add readiness and operational signals

**Files:**

- Keep: `src/app/api/health/route.ts` as liveness
- Create: authenticated readiness endpoint
- Add: tracing, error, metric, and alert configuration
- Update: `production-readiness/OBSERVABILITY_REPORT.md`
- Update: `production-readiness/OPERATIONS_RUNBOOK.md`

**Interfaces:**

- Consumes: database, migration version, queue, provider and runtime state
- Produces: dashboards and actionable alerts without secrets or PII

- [ ] Instrument request count, latency, errors, queue age, blocked sends, reconciliation backlog, webhook signature failures, and provider failures.
- [ ] Add cost and quota signals for LLM, sourcing, email, TTS, and WhatsApp.
- [ ] Configure an external liveness check and authenticated readiness check.
- [ ] Deliver test alerts to named owner and backup owner.
- [ ] Define log retention, redaction, sampling, and incident evidence access.

### Task 22: Make backup and restore proof strict

**Files:**

- Modify: `scripts/backup.sh`
- Modify: `scripts/restore-drill.sh`
- Update: `production-readiness/DISASTER_RECOVERY_PLAN.md`
- Test: `tests/restore-drill-contract.mts`

**Interfaces:**

- Consumes: encrypted backup and isolated scratch database
- Produces: verified schema, RLS, required tables, row counts, and cleanup

- [ ] Write a failing test for the current `|| true` restore and one-table pass threshold.
- [ ] Fail immediately on schema or data restore errors.
- [ ] Verify every required table through migration `0018`, every RLS flag, and selected row counts or checksums.
- [ ] Encrypt backup artifacts and define retention and access.
- [ ] Run staging restore, application smoke, and measured RTO/RPO.

### Task 23: Repair incident and rollback runbooks

**Files:**

- Modify: `production-readiness/INCIDENT_RESPONSE_RUNBOOK.md`
- Modify: `production-readiness/OPERATIONS_RUNBOOK.md`
- Modify: `production-readiness/ROLLBACK_RUNBOOK.md`
- Test: `tests/runbook-schema-drift.mts`

**Interfaces:**

- Consumes: current migrations and operational schema
- Produces: executable read-only incident queries and roll-forward or rollback procedures for every migration

- [ ] Replace nonexistent ledger columns with current schema names and verified queries.
- [ ] Cover migrations `0001` through the latest migration.
- [ ] Prefer forward fixes. Mark destructive rollback steps and require backup evidence.
- [ ] Run every diagnostic query on staging or the disposable local stack.
- [ ] Run a tabletop for provider duplicate, DNC escape, tenant access, migration failure, and webhook replay.

### Task 24: Restore CI and bind proof to the release SHA

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/codeql.yml`
- Add: deploy and post-deploy smoke workflow
- Add: SBOM and provenance output

**Interfaces:**

- Consumes: exact git SHA
- Produces: green typecheck, lint, tests, Obscura integration, build, audit, secret scan, CodeQL, SBOM, deploy, and smoke evidence

- [ ] Restore GitHub Actions budget so jobs can start.
- [ ] Align CI Node version with `package.json` engine 22.
- [ ] Pin third-party actions to reviewed commit SHAs and document update cadence.
- [ ] Make branch protection or rulesets require CI and CodeQL before merge.
- [ ] Add deployment approval, environment protection, migration check, and post-deploy smoke.
- [ ] Generate CycloneDX or SPDX SBOM and signed build provenance.
- [ ] Rerun exact SHA and attach run links and artifact hashes.

## Phase 7: Privacy, governance, performance, and final acceptance

### Task 25: Implement data lifecycle controls

**Files:**

- Add: privacy and data-subject endpoints and UI after DPO-approved wording and policy
- Add: retention enforcement job
- Add: export, erasure, workspace deletion, and provider-token revocation workflows
- Test: data lifecycle and audit tests

**Interfaces:**

- Consumes: approved purposes, retention periods, legal basis, processor register, and residency decisions
- Produces: explainable collection, retention, export, correction, suppression, and erasure evidence

- [ ] Obtain DPO and legal decisions for GDPR notice, Art. 14 outreach, ranking/profiling, AI Act scope, retention, and processors.
- [ ] Publish approved privacy information and link it from careers and outreach.
- [ ] Enforce retention by data class and legal hold.
- [ ] Verify export and erasure across workspace state, normalized tables, logs, backups, provider systems, and caches.
- [ ] Record human oversight and ranking explanation without exposing hidden model reasoning.

### Task 26: Establish performance and reliability targets

**Files:**

- Create: load and soak tests
- Update: `production-readiness/PERFORMANCE_REPORT.md`
- Update: `production-readiness/RELIABILITY_REPORT.md`

**Interfaces:**

- Consumes: approved traffic, data volume, latency, availability, RTO, and RPO targets
- Produces: measured capacity, timeout, retry, circuit, and scaling behavior

- [ ] Define target load and SLOs with Tony.
- [ ] Load test read paths, writes, agent runs, queue drain, webhooks, careers, and admin metrics with synthetic data.
- [ ] Add bounded retries only for proven pre-side-effect transient failures.
- [ ] Add circuit breaking and backpressure for providers and Flowise.
- [ ] Run soak, failover, and dependency-outage tests and record measured results.

### Task 27: Execute final production acceptance

**Files:**

- Create: `e2e/production-acceptance.spec.ts`
- Create: exact-SHA acceptance evidence under `production-readiness/evidence/`
- Update: `_relay/HANDOFF.md`
- Update: `_agent_state/mantu-goal/goal-2026-07-08-aria-enterprise-ready.json` only through the goal-owning workflow

**Interfaces:**

- Consumes: production URL, two test users, Tony-controlled inbox and phone, approved templates, Flowise, monitoring, and exact release SHA
- Produces: PASS or FAIL for the written outcome criterion

- [ ] Run clean deployment from documented steps with migrations and environment attestation.
- [ ] Execute two-user isolation, AgentSpec, concurrent run, email, reply, WhatsApp, approval queue, admin metrics, and Flowise scenarios.
- [ ] Run negative cases for viewer authority, cross-user access, DNC, duplicate, provider ambiguity, invalid webhook, missing secret, and expired consent.
- [ ] Verify dashboards, alerts, rollback, backup, and restore.
- [ ] Record Tony's manual result. Do not mark complete if any required step is skipped, failed, blocked, or unknown.

## Execution order and estimated effort

These are planning estimates, not verified delivery times or prices.

| Slice | Tasks | Assumed effort | Exit condition |
|---|---:|---:|---|
| Immediate release freeze | 1-2 | 0.5-1 day | credential rotated; evidence pack current |
| Authority and side effects | 3-7 | 2-4 days | demo dry-run, paid APIs authenticated, profile role authoritative, RLS and DNC proven |
| Delivery correctness | 8-10 | 2-4 days | concurrency, reconciliation, and caps proven under race tests |
| Agent product completion | 11-15 | 5-10 days | stored specs execute, seats normalized, Flowise isolated, real admin metrics |
| Frontend QA | 16-20 | 4-7 days | live failure truth, responsive journeys, CV truth, WCAG evidence |
| Operations and release | 21-24 | 4-8 days plus account access | monitoring, restore, runbooks, exact-SHA CI and deploy evidence |
| Governance and acceptance | 25-27 | 3-10 days plus DPO/provider lead time | lifecycle controls, performance proof, final outcome PASS |

Estimated remaining model usage for code and review: 120k-300k tokens. Estimated wall time with external access and approvals: 3-6 weeks. Provider approval, DPO decisions, GitHub budget restoration, and production access can extend the calendar independently of code progress.

## Plan self-review

- Spec coverage: frontend, backend, API, auth, tenancy, agents, messaging, Flowise, admin, security, privacy, accessibility, operations, recovery, CI, deployment, and acceptance are mapped to tasks.
- Placeholder scan: no implementation task uses `TBD`, `TODO`, or an unspecified generic test instruction.
- Type consistency: the plan uses existing names `agent_specs`, `agent_runs`, `agent_events`, `messages_outbound`, `messages_inbound`, `profiles.role`, `current_workspace_id()`, and `current_profile_role()`.
- Scope split: each task has an independently testable exit. External account and policy tasks are separated from code tasks and cannot be silently counted as complete.
