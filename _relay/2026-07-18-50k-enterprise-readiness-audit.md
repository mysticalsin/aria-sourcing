---
project: MSourcing / ARIA
agent: codex
updated: 2026-07-18 20:02 EDT
status: no-go-for-production-and-50000-users
audit_sha: d3d404b8e002e34ee82c8547c99550cf4fc75d6f
---

# ARIA 50,000-user enterprise-readiness audit and execution plan

This note is an executable handoff for Claude Code and the next Codex shift. It
was produced from a clean clone of the remote integration branch. The shared
OneDrive worktree had concurrent uncommitted work, so this audit did not modify
or reinterpret those in-progress changes.

## Decision

**NO-GO.** Do not onboard real enterprise users or run an uncontrolled real
candidate campaign. The public shell is reachable, but the deep readiness gate,
agent execution plane, release proof, high-availability data plane, enterprise
identity, compliance evidence, and 50,000-user capacity proof are incomplete.

## Audit scope and current truth

- Canonical source audited: `integration/sourcing-enrichment-on-main` at
  `d3d404b8e002e34ee82c8547c99550cf4fc75d6f`.
- Live verification at `2026-07-19T00:01:43Z`:
  - `/api/health`: HTTP 200, healthy.
  - `/api/ready`: HTTP 503, `agentFrameworks=false`, `migration=false`.
  - Live build: `3ff4852a98e74e5275b3927a4fb4bb0e72d0b03a`, 23 commits behind the audited source.
  - Live migration: `0037_person_identity_model.sql`; audited source reaches `0046`.
- Exact-SHA GitHub CI and CodeQL runs failed without starting any steps because
  an Actions budget prevented execution.
- Native GitHub code scanning and secret scanning are disabled. The repository's
  custom local security checks are useful but do not replace exact-release
  hosted receipts.
- Production currently has one database machine in one region, no proven
  standby/failover or connection pool, and configuration drift between source
  and live database sizing/snapshot retention.
- Flowise, DeerFlow, the swarm executor, and the Graphify learning schedule are
  not operational in production. The live readiness endpoint confirms the
  framework plane is unavailable.

## P0 launch blockers

1. **Reconcile release truth.** The live build is stale, nine migrations behind,
   and was not matched to a successful protected exact-SHA deployment receipt.
2. **Gate traffic on deep readiness.** Fly routes on shallow `/api/health`, so it
   continues serving while required migrations and agent frameworks are absent.
3. **Make real sourcing executable.** The real swarm process is not declared in
   `fly.app.toml`; the loop worker has no generic handlers; the swarm worker has
   no configured executor; the kill switch remains engaged.
4. **Resolve provider configuration honestly.** A Fly `KIMI_API_KEY` does not
   configure a workspace sourcing provider. Source policy intentionally excludes
   Kimi from the sourcing task. Deterministic GitHub sourcing can work only when
   a reviewed real query exists, but the live build is behind that source.
5. **Replace the single-node database topology.** Add a supported HA PostgreSQL
   design, pooling, failover, PITR, and a production restore proof before scaling.
6. **Replace single-admin identity.** Add Entra SSO, MFA, SCIM joiner/mover/leaver
   lifecycle, invitations, groups, tenant administration, deprovisioning, session
   controls, and access reviews. The current five-character password floor,
   auto-confirm, disabled signup, and domain auto-assignment are not acceptable.
7. **Remove the whole-workspace hot row from primary workflows.** The browser
   loads a complete JSONB workspace and mutations rewrite the complete document.
   The server candidate corpus is preview-only and removes core bulk workflows.
8. **Restore a green release gate.** The required local gate is red and hosted
   CI cannot run. Fix source/test drift and real defects, then obtain exact-SHA
   CI, CodeQL, secret, dependency, database, image, and deployment receipts.
9. **Close AI and privacy governance.** The project's own AI gate is NO-GO.
   Complete DPIA/FRIA/ROPA, candidate notice and rights path, processor and
   transfer contracts, retention enforcement, ranking oversight, fairness and
   representativeness evaluation, incident monitoring, named ownership, and
   accountable approvals.
10. **Prove a real end-to-end campaign.** The release campaign check constructs
    synthetic state and does not source a real candidate. Prove authenticated
    intake, reviewed need, real-source provenance, persistence, drafting,
    approval, controlled delivery, reply ingestion, suppression/unsubscribe,
    booking, erasure, and learning without synthetic fallback.

## Verified test state

Passed on the clean audited source:

- `npm ci --ignore-scripts`
- `npm run typecheck`
- `npm run typecheck:tests`
- `npm run lint`
- `npm run build`
- `npm audit --omit=dev --json` with zero advisories
- `npm audit signatures`
- full-history Gitleaks scan with no findings

The required gate `npm run typecheck && npm run typecheck:tests && npm test` is
red. Confirmed findings include:

- recovery schema inventory is stale by 24 tables;
- release-contract tests reject alternate production mutation scripts;
- the email ambiguous-send test exposes an uncaught ledger reconciliation error
  after provider acceptance;
- one outbound test and one inbound DB assertion are stale/brittle;
- the database privilege/recovery proof is red;
- three Docker DB lanes were locally inconclusive because the macOS Docker
  bind-mounted reconciliation file as a directory in the temporary clone;
- the email durability DB test has an ACL/test-contract mismatch.

Do not call the branch green until the complete manifest passes in a clean,
production-like lane and GitHub runs the exact SHA.

## Missing enterprise controls by domain

### Architecture and data

- Normalize campaign, candidate, message, settings, audit, and workflow state.
- Use keyset pagination and indexed query paths; remove exact whole-corpus counts
  and leading-wildcard scans from high-volume paths.
- Define database connection budgets across web, Auth, REST, workers, and ops.
- Add online/expand-contract migration rules, lock and statement timeouts,
  migration performance tests, and tested rollback/roll-forward procedures.
- Version all 60 API routes or publish an explicit compatibility/deprecation
  contract; the current OpenAPI document covers only a small subset.

### Reliability, observability, and operations

- Define SLIs/SLOs, error budgets, RTO/RPO, service ownership, support hours, and
  incident severity/escalation rules.
- Add PII-redacted error tracking, distributed traces, request/error/duration and
  resource metrics, DB pool telemetry, queue lag/age, worker heartbeat, provider
  latency/quota/cost, dashboards, alerts, synthetic journeys, and log retention.
- Health-gate every worker and required dependency. Worker stoppage and backlog
  must fail release/readiness rather than remain invisible.
- Add multi-zone failure tolerance, canary rollout, automated application
  rollback, chaos tests, failover drills, and a current signed restore receipt.
- Retain erasure decisions independently so restoring a snapshot cannot
  reintroduce erased candidate data.
- Replace placeholder on-call/DPO contacts and stale Vercel-era runbook sections.

### Security and IAM

- Harden auth cookies and add tested idle/absolute session limits and revocation.
- Apply a shared same-origin/content-type boundary to every cookie-authenticated
  mutation and test the full route inventory.
- Replace process-local rate limits with shared tenant, user, IP, provider, and
  cost limits plus edge/gateway enforcement.
- Configure and test an explicit restrictive CORS policy.
- Remove `unsafe-inline` from the production CSP through nonce/hash adoption.
- Add durable, tamper-evident audit events for keys, roles, integrations, model
  configuration, access, recovery, and other sensitive administration.
- Move encryption-key custody to a managed KMS/HSM model with rotation and
  break-glass controls.
- Enable native code/secret scanning, add CODEOWNERS and dependency automation,
  require a production environment reviewer, and include every framework image
  in SBOM, vulnerability, provenance, and attestation gates.

### Privacy, AI, and vendor governance

- Enforce retention settings with jobs and receipts instead of display-only UI.
- Publish candidate-facing privacy, source-of-data, objection, unsubscribe, and
  rights-request paths. Verify every first outreach carries the required notice.
- Complete provider DPAs, transfer mechanisms, residency, deletion, no-training,
  zero-retention, subprocessor, and vendor-exit evidence.
- Build a complete data inventory and erasure/export proof across normalized
  tables, JSON state, backups, logs, agent memory, framework payloads, Graphify,
  and external processors.
- Maintain a model/workflow inventory, immutable versions, evaluation datasets,
  bias/error analysis, human ranking oversight, override/appeal evidence, drift
  monitoring, numeric kill criteria, and independent validation.

### Product, UX, accessibility, and support

- Complete server-backed candidate workflows before enabling the corpus flag:
  drawer detail, bulk selection/actions, filters, pagination, concurrency, and
  large-tenant behavior.
- Mark every draft with generation source, provider/model/workflow version, and
  fallback reason. Provider failure must not silently appear as successful AI.
- Add authenticated browser E2E, Safari/Firefox/Chromium, mobile viewports,
  320-pixel reflow, zoom, keyboard, screen reader, axe, and Web Vitals gates.
- Fix login error announcement/field association, shared `Field` error semantics,
  and status-color contrast.
- Build member/role administration, access-review, support request, status and
  incident views, and per-user role-aware onboarding.
- Localize the operator UI, dates, numbers, currency, time zones, and RTL where
  required. Current localization covers generated messages, not the application.
- Either implement Slack/Telegram/email notification dispatch, retries, and
  receipts or remove promises that are currently preferences only.

### Capacity, cost, and acceptance

- Define whether 50,000 means registered, monthly active, daily active, or
  simultaneous users, then define tenant sizes, request mix, peak factor,
  sourcing rate, candidates per tenant, queue arrivals, provider tokens/latency,
  storage growth, availability target, and cost ceiling.
- Add baseline, ramp, stress, spike, multi-hour soak, failover, deployment-under-
  load, and provider-failure tests with production-shaped data.
- Size web replicas, workers, database pools, storage, and provider quotas from
  measured safe throughput, with at least 30 percent tested headroom.
- Add spend alerts and cost per campaign, source, candidate, message, and model
  metrics. Database-backed quotas in migration `0044` are not live yet.

## Ordered execution plan

### Phase 0: restore truthful release control

1. Raise the GitHub Actions budget and enable native code and secret scanning.
2. Freeze alternate manual production deploy scripts or route them through the
   same immutable exact-SHA verifier.
3. Fix the manifest failures and topology-verifier conflict in small commits.
4. Merge through the protected release branch with independent approval.
5. Deploy the exact approved image, apply migrations through `0046`, reconcile
   live/source sizing and snapshot policy, and require `/api/ready` before traffic.
6. Verify rollback to the preceding image and complete a fresh restore drill.

### Phase 1: make real sourcing work safely

1. Configure one supported sourcing provider in the workspace vault or validate
   the deterministic reviewed-query path. Do not treat a Fly secret as workspace
   configuration.
2. Deploy pinned Flowise/DeerFlow dependencies and the model gateway only after
   their tenant isolation, egress, licensing, SBOM, and evaluation gates pass.
3. Wire the swarm executor, declare its process, register loop handlers, expose
   heartbeats/backlog, and assign kill-switch owner/deputy.
4. Schedule Graphify export/analysis with hash-pinned inputs, PII exclusion,
   receipts, evaluation, and human lesson promotion. It must not self-promote.
5. Run a dry-run real-source campaign and prove no synthetic candidate path.

### Phase 2: replace scale ceilings

1. Define the 50,000-user workload and SLO/cost envelope.
2. Migrate primary workflows from whole-workspace JSON to normalized,
   server-paginated tables using expand/backfill/dual-read/cutover/contract.
3. Introduce HA PostgreSQL, pooler, replica/failover strategy, PITR, distributed
   rate limiting, horizontally scalable workers, and multi-failure-domain web,
   gateway, Auth, and REST services.
4. Add full operational telemetry, alerts, on-call routing, support, and tenant
   administration.

### Phase 3: close enterprise governance

1. Implement Entra SSO, MFA, SCIM, groups, invitations, lifecycle, session, and
   access-review controls.
2. Complete privacy, AI, vendor, records-management, security, and incident
   sign-offs with named accountable owners.
3. Add immutable administrative audit, enforced retention, complete DSR,
   provider deletion evidence, and restore-time erasure replay.
4. Complete independent application security review and targeted penetration
   testing after architecture changes stabilize.

### Phase 4: prove 50,000-user acceptance

1. Seed 50,000 accounts and production-shaped tenant/candidate/message data in a
   production-like isolated environment.
2. Run browser, API, queue, provider, database, load, soak, chaos, failover,
   recovery, accessibility, security, and two-tenant adversarial suites.
3. Run a controlled one-candidate real campaign with human approval, verified
   provenance, delivery/reply/booking, suppression, erasure, and Graphify lesson
   review receipts.
4. Canary 1, 5, 25, 50, then 100 percent with numeric abort thresholds and
   automated rollback. Require a 24-hour soak, current restore receipt, support
   drill, and 30 percent capacity headroom before acceptance.

## Acceptance rule

Production is ready only when the same exact SHA has green protected CI and
security receipts, deep readiness is 200, migrations and release identity match,
required processes are healthy, HA/restore/failover are proved, enterprise IAM
and governance approvals are closed, the 50,000-user workload passes with the
agreed SLO/cost headroom, and one controlled real sourcing journey succeeds end
to end without synthetic data or an unlabelled fallback.
