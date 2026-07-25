# ARIA enterprise remediation plan

**Status:** In progress. The local Phase 0/1 infrastructure slice is accepted; production recovery and the broader enterprise plan remain open.  
**Audit:** `_relay/2026-07-11-enterprise-audit.md`  
**Starting SHA:** `05cda612130d941f63512d503541c0410f1fc0fd`  
**Goal:** Turn ARIA into an enterprise sourcing platform in which every sourcing agent is a separately owned runtime identity with its own specification, memory, runs, candidate conversations, sender binding, policy state, and audit trail.

This plan supersedes unresolved tasks in `2026-07-09-aria-enterprise-production.md`. Completed fixes from that plan are retained and re-tested. No closed security control should be reverted to simplify later work.

## Review record, 2026-07-11 05:10 EDT

- Senior Full-Stack implementation, PM/Project Manager risk sequencing, Cybersecurity Analyst/Director review, QA, and an independent developer validation were run as separate roles.
- Local security, release-chain, and final exact-tree QA source verdicts: independently accepted. Production verdict: no-go.
- Focused verification is green for Databricks authority, connection-safe public egress, production-disabled remote MCP, database privilege contracts, and exact-image release promotion.
- Local release contracts: deploy 34/34, bootstrap 17/17, infrastructure 83/83, readiness 9/9, and Dust 32/32.
- Final QA: pretest 283/283, 97-group suite 2,430/2,430, security 495/495, isolated build 59/59 pages, shell 25/25, workflow YAML 3/3, and repository TOML 8/8.
- Open release gates: Fly token rotation and old-token rejection; backup, restore, rollback, and audited migration baseline; database exit-code-1 root cause; default-branch workflow activation; branch protection; exact-SHA online CI/CodeQL; live full-stack readiness.
- No deployment, commit, or push was performed. The unsafe remote workflow remains disabled.

## Estimate before implementation

These are planning estimates, not billing facts.

| Measure | Best case | Likely | Worst case | Assumptions |
| --- | ---: | ---: | ---: | --- |
| Focused agent execution time | 30 hours | 45 to 75 hours | 100 hours | Parallel audit/build agents, no large product rescope |
| Elapsed time | 3 days | 5 to 10 days | 3 weeks | External services and Tony-controlled acceptance endpoints are available |
| Model-token planning allowance | 1.5 million | 2 to 4 million | 6 million | Includes subagents, test output, browser work, and re-audits; the harness does not expose future token use |
| Tony or account-owner time | 1 hour | 3 to 6 hours | 12 hours | Credential rotation, provider console setup, test inbox/number, release approval |
| Direct monetary cost | Unknown | Unknown | Unknown | No model billing rate, Fly tier, Flowise host tier, email provider, or WhatsApp tariff is available in this environment |

Dollar cost must be calculated from the selected services and the account's actual rates. A truthful pre-build formula is:

```text
model cost = input tokens * input rate + output tokens * output rate
service cost = Fly/Postgres/Flowise monthly tiers + email and WhatsApp usage + monitoring/storage
```

The biggest schedule risks are production database recovery, provider credential access, Flowise tenancy constraints, OAuth consent, and real two-user/provider acceptance. Code-only work is not the long pole if those inputs are ready.

## Target architecture

ARIA remains the sole identity, policy, audit, and delivery control plane. Flowise may author versioned specifications, but it never receives provider credentials or sends messages.

### Stable authority chain

```text
Supabase identity
  -> workspace membership and profiles.role
     -> AgentSpec owner/admin authorization
        -> immutable AgentSpec revision captured by AgentRun
           -> durable job lease and bounded execution
              -> agent-scoped memory retrieval
              -> agent-scoped candidate conversation
                 -> policy and approval
                    -> durable outbox attempt
                       -> provider receipt or reconciliation
```

### Canonical records

- `agent_specs`: stable agent employee identity, owner, workspace, role, allowed channels, sender seat, status, budgets, schedule, and current revision.
- `agent_spec_revisions`: immutable versioned configuration from ARIA or Flowise.
- `agent_runs`: durable execution with revision, lease, checkpoint, status, budget, failure, and timestamps.
- `agent_memories`: workspace, owner, agent, memory kind, content, provenance, retention, and deletion state.
- `candidate_conversations`: workspace, agent, candidate, channel, sender identity, provider thread key, state, and last activity.
- `conversation_messages`: ordered inbound and outbound messages with provider IDs and reply references.
- `outbox_attempts`: idempotency key, approval identity, policy snapshot, provider request ID, state, and reconciliation status.
- `agent_events`: append-only operational events with no direct send path.

The existing `agent_specs`, `agent_runs`, `messages_inbound`, and `messages_outbound` tables should be migrated rather than replaced wholesale. New normalized records should use migration `0019` or later. The missing historical number `0016` must not be backfilled because deployed environments may already rely on filename order.

## Non-negotiable rules

- Use test-first changes for every behavior change. Record the expected failure before the fix.
- One logical risk per commit. Never combine repository cleanup with security or migration behavior.
- Never change or remove unrelated work in the shared worktree.
- No live deployment from a red exact SHA.
- Public demo mode remains synthetic and cannot create real external side effects.
- LinkedIn remains official-integration or assisted draft-only. No scraping or platform bypass.
- Candidate-bound text never receives hidden reasoning, tool output, internal status, raw JSON, or unsupported role facts.
- A provider timeout after possible acceptance is reconciliation, not retryable failure.
- A live backend failure is a degraded state, never demo data.
- Every authority check exists in both the server route and database policy where direct PostgREST access is possible.
- External provider tests use only Tony-controlled inboxes, phone numbers, and synthetic candidates.
- Before each release claim, run the full exact-SHA gate and update the evidence matrix.

## Phase 0: Contain release risk and establish one honest baseline

### Task 0.0: Contain the exposed credential and freeze automatic production release

**Modify:** Fly organization token, GitHub environment secrets, `.github/workflows/deploy-aria-mantu.yml`, `_relay/incidents/2026-07-11-fly-deploy-token-exposure.md`  
**Verify:** provider-side old-token rejection, replacement smoke, protected manual release behavior

- [ ] Rotate the exposed Fly credential with owner-level provider access, install a short-lived least-privilege replacement, then revoke the old token.
- [ ] Review provider activity from the disclosure time through revocation and record only non-secret metadata.
- [x] Disable push-triggered production deployment before any branch push. The provider reports `disabled_manually`; Production now requires a reviewer and the audited deploy branch.
- [ ] Mark production `DEGRADED` and prohibit operational or enterprise-ready claims until full readiness passes.
- [ ] Do not perform further authenticated Fly diagnosis with the exposed credential.

**Exit proof:** the old token is rejected, the replacement can perform only its intended action, and a branch push cannot deploy production.

### Task 0.1: Freeze false-green production claims

**Modify:** `_relay/HANDOFF.md`, `production-readiness/RELEASE_GATE_MATRIX.md`, `production-readiness/STATUS.md`  
**Create:** `tests/release-truth.mts`  
**Verify:** current live Auth, REST, database, migrations, and app build identity

- [ ] Write a failing release-truth test that distinguishes liveness, readiness, deployment, and acceptance.
- [ ] Mark production as degraded until Auth and REST probes pass.
- [ ] Replace stale test, migration, branch, host, and port counts with one generated facts block.
- [ ] Record current machine exit code 1 without guessing the root cause.
- [ ] State which host is canonical production and what Vercel represents before final release.

### Task 0.2: Repair the branch and review surface without rewriting history

**Inspect:** PR #3, `origin/vercel-demo`, `origin/main`, `deploy/fly-github-actions`  
**Create only after clean baseline:** `codex/aria-enterprise-remediation`

- [ ] Inventory the 56-commit/611-file PR delta and separate application work from generated receipts and binaries.
- [ ] Preserve every concurrent change and tag the current audited SHA.
- [ ] Establish a reviewable base branch through fast-forward or a new integration branch. Do not force-push or rewrite shared history without Tony's explicit approval.
- [ ] Require branch protection for exact-SHA CI, CodeQL, secret scan, and release gate.

**Exit proof:** a clean branch with an intelligible diff and no lost files.

### Task 0.3: Preserve production data and establish minimum recovery proof

**Create:** non-secret backup receipt and scratch-restore receipt  
**Verify:** snapshot or clone exists before destructive diagnosis; scratch restore is readable

- [ ] Preserve the sole production database volume through a provider snapshot, clone, or equivalent before any destructive operation.
- [ ] Restore the preserved data into a disposable target and verify named tables, migrations, policies, and bounded row-count fingerprints.
- [ ] Record rollback target, stop conditions, recovery owner, and an initial measured restore time.
- [ ] Keep full alerting, RPO/RTO, and failover work in Phase 7, but treat this minimum preservation and restore proof as a Phase 1 prerequisite.

### Task 0.4: Restore release-blocking dependency and secret gates

**Modify:** `package.json`, lockfile, provider adapters as required  
**Verify:** `npm audit --audit-level=high`, independent secret scan, SBOM, exact-SHA CI

- [x] Replace the bundled Dust SDK chain that brought the high `express-rate-limit` advisory with a bounded, schema-validated REST client.
- [x] Remove the `ip-address` high-advisory dependency chain without a breaking blind-force upgrade.
- [ ] Resolve the two moderate PostCSS findings when the stable Next.js line contains a non-breaking fix.
- [x] Remove the Node-20-only `@dust-tt/client` package and verify the replacement against the existing Dust contract suite.
- [x] Make secret scanning run independently even when dependency audit, typecheck, or tests fail.
- [ ] Complete outstanding provider-key rotations and record only owner, time, old-key rejection, and new-key smoke result.

**Exit proof:** all release-blocking supply-chain and secret gates report for the exact SHA, and the aggregate gate fails if any required result is red.

## Phase 1: Recover production and make deployment fail closed

### Task 1.1: Diagnose the database and Auth exit code 1

**Inspect:** `docker/db/Dockerfile.fly`, database entrypoint/init scripts, `fly.db.toml`, `fly.auth.toml`, Fly logs and machine events  
**Create:** `production-readiness/FLY_RECOVERY.md`  
**Test:** container entrypoint and persisted-volume upgrade in a disposable environment

- [ ] Begin only after Tasks 0.0 and 0.3 pass. Capture database and GoTrue startup logs without exposing secrets.
- [ ] Reproduce exit code 1 against a disposable volume.
- [ ] Identify whether the failure is image/entrypoint, permissions, incompatible persisted data, role bootstrap, secret, or network configuration.
- [ ] Fix the root cause and prove restart survival twice.
- [ ] Do not delete or recreate the production volume until backup and restore evidence exists.

### Task 1.2: Add real readiness

**Create:** `src/app/api/ready/route.ts`, `src/lib/readiness.ts`, `tests/readiness.mts`  
**Modify:** `src/app/api/health/route.ts`, Fly health configuration

- [x] Keep `/api/health` as process liveness only.
- [x] Add tightly redacted readiness for database connection through REST, complete migration-ledger identity, Auth route, and queue query.
- [x] Include a safe build SHA and migration version, never secrets or internal URLs.
- [x] Return non-200 when a required dependency is down.

### Task 1.3: Replace the deployment workflow

**Modify:** `.github/workflows/ci.yml`, `.github/workflows/deploy-aria-mantu.yml`, `deploy-fly.sh`  
**Create:** `tests/deploy-contract.mts`  
**Verify:** exact-SHA dry run and protected-environment deploy

- [x] Write contract tests for `set -euo pipefail`, required probe assertions, cleanup trap, and failure propagation.
- [x] Make dependency audit, secret scan, test, and build independent jobs with a final aggregate gate; require separate CodeQL success for the exact release SHA.
- [x] Build and scan the exact application image, emit a CycloneDX SBOM and HIGH/CRITICAL vulnerability report, promote the same digest, and retain partial evidence on failure. Online execution remains pending.
- [x] Deploy only the exact checked SHA through a protected environment and concurrency group.
- [ ] Merge the manual workflow definition to default branch `vercel-demo` or deliberately change the default branch so `workflow_dispatch` is available.
- [x] Pin actions by commit SHA. Install Fly once from a pinned release.
- [x] Scope secrets to the deploy step, avoid decoded secret archives, require private local credential-file modes, and clean temporary probe/registry state in a trap.
- [x] Require database, Auth, REST, complete migration ledger, app readiness, and build-ID assertions before success.
- [x] Stop printing success unless every required probe and release-identity check has passed.

**Exit proof:** deliberately failing Auth or REST makes the deploy job fail; a good stack passes and reports the exact SHA.

## Phase 2: Close the immediate security boundary failures

### Task 2.1: Normalize and admin-gate integration configuration

**Create:** `supabase/migrations/0019_agent_authority_and_integrations.sql`, `src/app/api/integrations/databricks/config/route.ts`  
**Modify:** Databricks needs route and settings UI  
**Test:** `tests/integration-authority.mts`, real-Postgres role tests

- [x] Move Databricks origin, auth mode, client ID, warehouse, query template, and secret binding out of `workspace_state`.
- [x] Allow only admins to create or change the integration origin and secret binding.
- [x] Bind each stored secret to one approved normalized origin and purpose.
- [x] Let members execute only the approved saved integration, not choose a host or secret ID.
- [x] Reject scheme, port, path, redirect, and origin changes at execution time.

Source and deterministic tests are complete. Real PostgreSQL execution and a restored-clone rehearsal remain release gates.

### Task 2.2: Replace outbound URL validation with connection-safe egress

**Modify:** `src/lib/api/url.ts`, web tools, MCP, Databricks and other configurable fetch clients  
**Create:** `src/lib/api/public-fetch.ts`  
**Test:** `tests/public-fetch.mts`, `tests/public-fetch-node-transport.mts`

- [x] Add failing cases for hexadecimal, integer, octal, IPv4-mapped IPv6, IPv6 compression, zone IDs, link-local, metadata, CGNAT, and redirect variants.
- [x] Add a DNS-rebinding test where validation resolves public and connection resolves private.
- [x] Use a Node transport that connects only to the validated IP while preserving the original TLS hostname and disabling pooled address reuse.
- [x] Deny redirects and protocol upgrades.
- [x] Set request, response, header, body, time, and decompression limits.

### Task 2.3: Lock database functions and direct table grants

**Modify:** migration `0019_agent_authority_and_integrations.sql`  
**Create:** `scripts/verify-database-privileges.sql`, `tests/database-privileges.mts`

- [x] Revoke `claim_and_record` from `PUBLIC`, `anon`, and `authenticated`; grant only the intended role.
- [x] Add internal service-role assertions to direct service RPCs. Keep the documented ACL-only exception for `claim_and_record`, which is called through an authenticated SECURITY DEFINER wrapper.
- [ ] Remove authenticated direct writes to run, event, inbound, outbound, and ledger tables unless a narrow user action requires them.
- [x] Assert the final routine and future-object privilege matrices after all migrations in the disposable PostgreSQL test script. Live execution remains pending because Docker was unavailable.

## Phase 3: Establish true agent ownership, runs, and memory

### Task 3.1: Make AgentSpec the stable employee identity

**Modify:** migration `0019`, `src/app/api/agents/specs/route.ts`  
**Test:** `tests/agent-owner-authority.mts`, real-Postgres two-user tests

- [ ] Owner can read and change own specs; admin can inspect and manage workspace specs; another member cannot.
- [ ] Owner cannot be changed through PATCH.
- [ ] Seat, provider, channel, status, schedule, budgets, and guardrails are validated as one spec.
- [ ] Create immutable spec revisions and record author, source, timestamp, and change reason.
- [ ] Flowise IDs are workspace and agent bound, never accepted from another owner or workspace.

### Task 3.2: Bind every run to a stored revision

**Create:** `src/lib/agents/run-service.ts`, `tests/agent-run-service.mts`, `tests/agent-run-route.mts`  
**Modify:** `src/app/api/agents/run/route.ts`, graph contracts

- [ ] Require `specId` in live mode and load it server-side.
- [ ] Reject absent, paused, archived, foreign-owner, foreign-workspace, or provider-incomplete specs.
- [ ] Capture the immutable revision ID and bounded input on the run.
- [ ] Fail before model/tool work if durable run creation fails.
- [ ] Treat checkpoint and event persistence failure as a paused or failed run with a recoverable ID.
- [ ] Remove caller campaign JSON as an authority source. Keep a labelled stateless demo path only.

### Task 3.3: Add durable worker lifecycle

**Create:** `agent_jobs` and lease fields in migration `0020_agent_runtime_lifecycle.sql`, `src/lib/agents/worker.ts`, cron/worker entrypoint, tests  
**Test:** `tests/agent-worker-concurrency.mts`, `tests/agent-resume.mts`

- [ ] Atomic claim with lease owner, expiry, heartbeat, and attempt number.
- [ ] One run step per transaction boundary with idempotent continuation.
- [ ] Per-agent pause, kill switch, daily model/tool budget, maximum steps, and maximum wall time.
- [ ] Expired worker recovery cannot repeat a provider side effect.
- [ ] Two owners run two agents concurrently without reading or changing each other's run state.

### Task 3.4: Replace seat memory with normalized agent memory

**Create:** `agent_memories` schema, `src/lib/agents/memory.ts`, memory API and retention job  
**Modify:** chat and memory UI to use agent IDs  
**Test:** `tests/agent-memory-isolation.mts`, deletion and retention tests

- [ ] Scope every record by workspace, owner, and agent.
- [ ] Record kind, source, confidence, provenance, created-by-run, retention class, and timestamps.
- [ ] Retrieve only an agent's bounded, relevant memories for a run.
- [ ] Never store hidden reasoning, raw provider secrets, or candidate PII outside the defined retention policy.
- [ ] Owner deletion and admin retention actions are durable and audited.
- [ ] Remove live authority from `HermesState.memory` and `HermesState.chats` after migration.

**Exit proof for Phase 3:** two users create, edit, run, pause, resume, and inspect their own agents concurrently; all cross-owner attempts fail at API and database layers.

## Phase 4: Make candidate conversations unambiguous

### Task 4.1: Add canonical conversations and messages

**Create:** `supabase/migrations/0021_candidate_conversations.sql`  
**Modify:** inbound/outbound models and APIs  
**Test:** `tests/conversation-isolation.mts`

- [ ] A conversation binds workspace, agent, candidate, channel, sender seat, and provider thread key.
- [ ] Messages bind to a conversation and carry provider message ID, reply-to/context ID, direction, and ordered timestamps.
- [ ] Enforce cross-table workspace, agent, candidate, and sender consistency.
- [ ] Migrate safe existing rows. Put ambiguous historical rows in triage instead of guessing.

### Task 4.2: Correct WhatsApp reply routing

**Modify:** webhook parsing, `src/lib/whatsapp-inbound.ts`, outbox and receipt code  
**Test:** two-agent same-phone, reply-context, late receipt, and no-context triage cases

- [ ] Resolve by signed sender, Meta context message ID, provider conversation key, and bound agent.
- [ ] Never use latest outbound by phone as an authoritative match.
- [ ] If more than one conversation can match, create a triage event and do not draft or send.
- [ ] Keep opt-out global to the contact/workspace policy where required, while retaining conversation attribution.

### Task 4.3: Correct email reply routing and delivery reconciliation

**Modify:** Gmail/Graph sync, email matching, send route, provider result types  
**Test:** `tests/email-conversation-routing.mts`, `tests/email-reconciliation.mts`

- [ ] Persist Gmail thread ID, RFC message IDs, Graph conversation ID, and internet message IDs.
- [ ] Match an inbound reply by provider thread and reply references before candidate address.
- [ ] Treat address-only matches with multiple possible agents as triage.
- [ ] Add `reconciliation_required` for possible provider acceptance.
- [ ] Never release the dedupe/approval identity until provider outcome is known or an operator authorizes retry.

### Task 4.4: Serialize capacity and dispatch policy

**Create:** `supabase/migrations/0022_atomic_capacity.sql`  
**Test:** real-Postgres daily-cap and outbox concurrency tests

- [ ] Serialize capacity on a per-seat/day counter or locked seat row.
- [ ] Prove exactly one of two concurrent cap-minus-one claims succeeds.
- [ ] Re-check agent status, sender status, consent, suppression, quiet hours, approval, content hash, and conversation state at dispatch time.

### Task 4.5: Resolve the autopilot policy mismatch

**Decision owner:** Tony through the standing goal  
**Default during implementation:** human review remains the only release authority

- [ ] Keep the current queue-only policy until the automated policy path has complete tests and a kill switch.
- [ ] If the active outcome still requires an in-policy auto-answer, implement narrow topic templates, canary count, explicit agent opt-in, daily cap, quiet hours, conversation lock, dispatch-time revalidation, and immediate workspace kill switch.
- [ ] Change comments, UI, docs, and goal evidence so they never claim send behavior that code does not perform.
- [ ] Acceptance must show both one safe auto-answer and one forced human-review case if auto-answer remains in scope.

## Phase 5: Honest frontend and senior-grade UX

### Task 5.1: Model live state explicitly

**Create:** focused live-workspace state module and error boundary components  
**Modify:** provider/store hydration, chat, Studio, fleet, admin  
**Test:** `tests/live-hydration-failure.mts`, browser degraded-state tests

- [ ] Represent `loading`, `empty`, `ready`, `degraded`, `conflict`, and `forbidden` separately.
- [ ] Never seed demo state after an authenticated backend error.
- [ ] Empty states say there is no data only after a successful empty response.
- [ ] Every failure offers a safe retry and a correlation ID without sensitive details.

### Task 5.2: Repair login and public careers truth

**Modify:** `src/app/login/page.tsx`, careers shell/chatbox, public CV ingestion  
**Test:** login, careers, CV extraction, status semantics, browser tests

- [ ] Do not prefill demo credentials when demo login is disabled.
- [ ] Add alert/live semantics, associated labels, visible focus, and a mobile contrast pass.
- [ ] Make availability derive from the real service result; never show `ONLINE` before readiness.
- [ ] Add a real page heading and functional Privacy, Cookies, and Accessibility destinations.
- [ ] Parse supported CV formats server-side with explicit extraction failure. Never invent fallback skills.

### Task 5.3: Make Studio an operational agent console

**Modify:** split `src/app/studio/page.tsx` into focused components  
**Create:** run, memory, conversation, review, and audit panels  
**Test:** `e2e/agent-studio.spec.ts`

- [ ] Show owner, stored revision, sender, provider, budget, schedule, memory policy, and live/demo state.
- [ ] Support create, edit, run, pause, resume, inspect, archive, and safe retry.
- [ ] Show held drafts, approvals, provider reconciliation, and conversation attribution distinctly.
- [ ] Regular users see only their own agents. Admins receive a clearly labelled oversight mode.

### Task 5.4: Add executable accessibility and browser gates

**Create:** Playwright configuration, `e2e/`, axe integration, keyboard/focus scripts  
**Verify:** Chromium desktop/mobile, reduced motion, keyboard-only, contrast, live-region checks

- [ ] Block release on serious/critical axe findings.
- [ ] Test login, Studio, campaign, candidate, replies, fleet, admin, and careers journeys.
- [ ] Test focus trapping and restoration for every modal/drawer.
- [ ] Test labels, fieldsets, headings, landmarks, tables, and error announcements.
- [ ] Capture screenshots only for current release evidence, not in the permanent source tree by default.

### Task 5.5: Split the store after authority migration

**Modify:** `src/lib/store.ts` behind existing public exports  
**Create:** domain modules for workspace, campaigns, candidates, replies, fleet, chat, and integrations  
**Test:** existing contract suites plus module-specific tests

- [ ] Measure behavior and public selectors first.
- [ ] Extract one domain at a time with no UI redesign in the same commit.
- [ ] Remove dead mock and fallback paths only after live/degraded behavior is proven.
- [ ] Keep demo fixtures in a clearly named demo module outside production authority code.

## Phase 6: Flowise and admin evidence

### Task 6.1: Deploy Flowise as private authoring only

**Create:** deploy config, network policy, backup/restore runbook, contract tests  
**Modify:** Flowise proxy and Studio integration

- [ ] Select a tenancy model before deployment: isolated instance per workspace or a proven ARIA-owned isolation layer.
- [ ] Use dedicated database, stable encryption key, backups, and private network access.
- [ ] Disable arbitrary network/file/process nodes and all direct provider-send nodes.
- [ ] Translate saved flow versions into AgentSpec revisions that require ARIA authorization.
- [ ] Prove one user cannot list, load, edit, or execute another user's flow.
- [ ] Prove Flowise cannot access email, WhatsApp, LinkedIn, ARIA service-role credentials, or candidate tables directly.

### Task 6.2: Build canonical admin metrics

**Create:** admin metrics query/API and dashboard  
**Test:** `tests/admin-metrics.mts`, `e2e/admin-dashboard.spec.ts`

- [ ] Define each metric with numerator, denominator, event source, time zone, late-event policy, and exclusions.
- [ ] Compute activity, run success, sourcing yield, approval rate, blocked sends, reply rate, provider delivery, time-to-review, and reconciliation backlog from normalized records.
- [ ] Admin-only access at route and database layers.
- [ ] No synthetic fallback in live mode.

## Phase 7: Operations, repository, and documentation cleanup

### Task 7.1: Prove backup, restore, monitoring, and incident response

**Modify:** backup/restore scripts and runbooks  
**Create:** alert tests, target-environment restore receipt, rollback receipt

- [ ] Automated encrypted backups with retention and failure alert.
- [ ] Fresh backup restored into a scratch database with named tables, policies, migrations, fingerprints, and row counts.
- [ ] Record measured RPO and RTO.
- [ ] Alerts for database/Auth/REST readiness, queue age, provider failures, webhook signatures, reconciliation backlog, auth anomalies, and cost-bearing endpoints.
- [ ] Run one rollback and one incident drill against a non-production environment.

### Task 7.2: Clean the repository without losing evidence

**Create first:** `docs/repository-retention-policy.md`, inventory script, cleanup manifest  
**Candidates:** `.localbin/`, `.rocket-fuel/`, archived screenshots, duplicate brand assets, stale batons, machine metadata, duplicate deploy scripts

- [ ] Classify each tracked artifact as source, test fixture, release evidence, generated output, local tool, or archive.
- [ ] Replace committed platform binaries with checksum-pinned bootstrap instructions or CI-managed artifacts.
- [ ] Move raw run logs and historical screenshots to release artifacts or an external archive.
- [ ] Keep concise audit receipts needed for traceability.
- [ ] Do not rewrite Git history without a separate reviewed plan and Tony's explicit approval.
- [ ] Add CI budgets for repository size, single-file size, generated content, and accidental binaries.

### Task 7.3: Collapse documentation to one current truth set

**Keep current:** README, architecture, local setup, deployment, operations, security, release gate, evidence index, data retention, incident response  
**Archive:** superseded readiness snapshots with an index

- [ ] Validate every command in a clean environment.
- [ ] Validate operational SQL against the current schema.
- [ ] Generate test count, migration list, Node version, route inventory, and build ID from source.
- [ ] Remove stale duplicate baton and keep `_relay/HANDOFF.md` current at each shift.

## Phase 8: Exact-SHA acceptance

The release is not complete until all items below pass against one SHA and one named production environment.

- [ ] CI, CodeQL, dependency audit, secret scan, SBOM, image scan, typecheck, lint, tests, build, database privilege tests, browser E2E, and accessibility are green.
- [ ] Database, Auth, REST, queue, migrations, and app readiness are green and expose the same build identity.
- [ ] One admin and one regular user authenticate through the production identity path.
- [ ] Each creates a different AgentSpec and cannot read or mutate the other's records outside explicit admin oversight.
- [ ] Both agents run concurrently from stored immutable revisions, persist checkpoints, use only their own memory, and resume safely.
- [ ] Two agents can share a candidate address in an adversarial test without cross-routing replies.
- [ ] A real email reaches Tony's controlled inbox, receives a reply, binds to the correct conversation, and reconciles delivery.
- [ ] A real official-API WhatsApp message reaches Tony's controlled number, its reply binds by provider context, and receipts reconcile.
- [ ] One out-of-policy reply remains in human review. If auto-answer remains approved, one narrow in-policy reply is auto-answered under canary and kill-switch controls.
- [ ] No status narration, hidden reasoning, tool output, unsupported fact, JSON, duplicate, or wrong-agent message reaches a provider.
- [ ] Flowise edits one agent revision without exposing another agent or bypassing ARIA policy.
- [ ] Admin metrics show both users from real canonical records.
- [ ] Backup restore, rollback, alert delivery, and incident response have dated receipts.
- [ ] Tony records PASS/FAIL and the release decision.

## Required verification commands

Run without truncating the command's exit behavior:

```bash
npx tsc --noEmit && npm test
npm run lint
npm run build:isolated
npm audit --audit-level=high
git diff --check
docker compose config --quiet
```

Additional required gates will be added as implementation lands:

```bash
npm run test:db-isolation
npm run test:e2e
npm run test:a11y
npm run test:release
```

Every final report must list exact SHA, command, exit code, live environment, migration version, provider checks run, and anything blocked or skipped.
