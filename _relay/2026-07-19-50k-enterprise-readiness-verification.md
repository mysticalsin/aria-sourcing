---
project: ARIA / MSourcing
agent: Codex
updated: 2026-07-19T06:45:00Z
status: no-go
scope: source, tests, GitHub, Fly, data, security, privacy, agents, sourcing, operations, capacity
---

# ARIA enterprise readiness verification for 50,000 users

## Decision

**NO-GO for production use or a 50,000-user claim.** The application has useful fail-closed controls and a substantial contract-test suite, but production is not ready, the owned test gate is red, the autonomous sourcing plane is absent, the live release is not bound to the inspected source, and the current data/identity/reliability design has hard scale ceilings.

Do not interpret `/api/health` 200 as release readiness. The authoritative live endpoint is `/api/ready`, which returned 503 during this audit.

The phrase "50,000 users" is not yet a capacity requirement. Before sizing, the owner must ratify registered users, monthly and daily active users, peak simultaneous sessions, tenant distribution, request mix, sourcing runs per day, candidates per tenant, outbound volume, geography, SLOs, RTO/RPO, and provider-cost ceilings.

## Audit boundary and evidence

- Clean source verification: remote integration SHA `d3d404b8e002e34ee82c8547c99550cf4fc75d6f`.
- Shared checkout observed: local HEAD `9732199e3c1e663c53f9c727e4b777dcb2d57c81`, dirty with concurrent Claude/Codex work. No existing changes were reset, staged, or committed.
- Live Fly build reported by `/api/ready`: `3ff4852a98...`.
- Live schema reported: `0046_swarm_orchestration_authority.sql`.
- GitHub default branch: `vercel-demo`; remote `main` and integration are different histories/SHAs.
- Audit methods: clean install/build/type checks, canonical test runner, database contract tests in an isolated local Postgres lane, full-history Gitleaks, `npm audit`, GitHub API/CLI inspection, Fly API/CLI inspection, live unauthenticated HTTP checks, source review, and aggregate-only production database inspection.
- Not exercised: authenticated admin UX, real paid provider calls, real candidate outreach, destructive recovery, production load, candidate content, or credential values.
- Graphify query was attempted first but could not run because `graphify-out/graph.json` is absent; `graphify-out/wiki/index.md` is also absent. Restore both as a documentation and code-navigation control.

## Point-in-time release truth

| Control | Result | Evidence |
|---|---|---|
| Public shell | PASS, narrow | `/` redirects to login; login and `/api/health` respond |
| Deep readiness | **FAIL** | `/api/ready` 503; `agentFrameworks=false` |
| Release identity | Partial | readiness reports identity true, but live build is not the inspected remote SHA |
| Migration identity | PASS, narrow | readiness reports migration 0046 true |
| Exact-SHA CI | **FAIL / not executed** | GitHub annotation: Actions budget prevented every job from starting |
| CodeQL | **FAIL / not executed** | same Actions budget block; GitHub also reports code scanning disabled |
| Secret scanning | **FAIL as hosted control** | GitHub reports secret scanning disabled; local full-history Gitleaks found no leaks |
| Branch control | **FAIL** | `vercel-demo` and integration branches are unprotected |
| Dependency state | Partial | clean install and `npm audit` report 0; one open GitHub PostCSS alert remains even though the default lock shows 8.5.15, above patched 8.5.10; reconcile and close with a fresh scan |
| Build | PASS on inspected SHA | Next isolated production build completed, 66 pages |
| Type checks | PASS on inspected SHA | application and tests type checks completed |
| Canonical test gate | **FAIL** | recovery inventory drift plus application/database failures listed below |
| Live autonomous agent plane | **FAIL** | Flowise, DeerFlow, model gateway and adapter apps absent; heartbeat workers stopped |
| Real sourcing E2E | **NOT PROVEN** | no receipt covers real need through real sourced candidate, enrichment, identity resolution, ranking, authorized delivery and webhook outcome |

## Canonical test defects to fix before release

1. `tests/recovery-schema-allowlists.mts` fails because `docker/bootstrap/legacy-table-inventory.txt` no longer matches the invariant table set in `docker/bootstrap/legacy-baseline-invariants.sql`. Reconcile the canonical inventory from the schema, then keep one generated/sorted authority.
2. `tests/dispatch-outbound.mts` fails its SMS ordering contract because it expects `sendViaProvider({` after the guard while the route was refactored. Determine whether the contract or implementation is canonical, then prove policy validation occurs before every database/provider side effect.
3. `tests/email-send-ambiguity.mts` raises `ledger update connection reset` from the reconciliation path. The ambiguity handler must return a durable retryable state without an uncaught failure, duplicate send, or false success.
4. `tests/email-durability-db.sh` fails because `service_role` lacks the expected SELECT privilege on `email_delivery_events`. Fix the privilege contract or the test only after confirming the least-privilege read path.
5. `tests/email-inbound-db.sh` fails `resolve-hit-lowercased`, returning `true:t` where the contract expects `true:true`. Align the SQL result shape and caller contract, then rerun the real database suite.

Environment-only Docker mount errors seen under `/private/tmp` were rechecked under `$HOME`; they are not source defects. In the compatible lane, the remaining database failures are email durability and email inbound.

## Missing controls by domain

### 1. Release engineering and supply chain: P0

- Restore the GitHub Actions budget and rerun CI/CodeQL on the exact release SHA.
- Protect the real default/release branch: required reviews, required signed checks, no force pushes/deletions, admin enforcement, CODEOWNERS, environment approval, and a single promotion path.
- Enable GitHub code scanning and secret scanning. Keep Gitleaks full-history scanning as an additional control.
- Build, scan, attest and sign every production image, including Flowise, DeerFlow, workers, adapters, model gateway, Postgres and Redis images used by the agent plane.
- Bind source SHA, image digest, migration ledger, SBOM, approval, deployment and rollback receipt in one immutable release record.
- Route production traffic only when deep readiness is green. `/api/health` is liveness, not promotion eligibility.
- Resolve the open dependency alert with a current default-branch scan and an auditable dismissal or upgrade receipt.

**Acceptance:** one protected SHA has green CI, CodeQL, secret scan, dependency scan, database security, image scan/signatures/SBOMs; it is deployed only by the protected workflow; live build and image digest match; `/api/ready` is 200; rollback to the previous signed release is timed and successful.

### 2. Identity, access and tenant lifecycle: P0

- Replace the five-character password floor, mailer auto-confirm and single-admin bootstrap assumptions.
- Enable enterprise OIDC/Entra SSO with MFA/conditional access.
- Add approved invitation or SCIM provisioning, group-to-role mapping, tenant selection, deprovisioning, session/token revocation and access reviews.
- Remove email-domain auto-join and first-user auto-admin authority. Use explicit, audited membership and two-person approval for privileged role changes.
- Split roles by resource and operation. A viewer must not receive the whole workspace candidate corpus.
- Add break-glass accounts, rotation, monitored use and recovery exercises.

**Acceptance:** lifecycle tests cover join, role change, group removal, offboarding and immediate session revocation; cross-tenant and cross-role negative tests pass; 50,000-user identity/token-refresh load meets the ratified SLO.

### 3. Data architecture and tenant isolation: P0

- Replace `workspace_state` as the authoritative whole-workspace JSONB document for campaigns, candidates, outreach, ledgers, settings and workflow writes.
- Normalize server-owned tables with row/version concurrency, idempotency keys, keyset pagination, indexed search and field/resource authorization.
- Stop downloading and replacing the entire workspace in browsers. Candidate mirror tables cannot remain read-only shadows of a growing JSONB source.
- Add deterministic multi-writer conflict tests and transaction boundaries for all money, message and candidate state.
- Force RLS where appropriate, remove broad owner/service bypasses from request paths, and continuously test tenant isolation against every public table/RPC.
- Add retention/purge for terminal jobs, loop events, agent events and operational receipts according to policy.

**Acceptance:** production-shaped concurrent writers cause zero lost updates and no manual "reapply" conflicts; all list/search operations are paginated/indexed; the browser never receives unauthorized candidate fields or an entire tenant corpus; cross-tenant SQL/API tests pass.

### 4. Autonomous sourcing and agent execution: P0

- Implement real durable handlers for receive need, parse, clarify/approve, create campaign, source, enrich, resolve identity, rank, draft, approve/auto-authorize and record outcomes. `HANDLER_KINDS` is currently empty.
- Deploy Flowise, DeerFlow, the model gateway, adapters, their data services, the swarm executor and workers as signed private services.
- Make every step restart-safe, lease-bound, idempotent and observable. Browser closure must not stop a campaign.
- Include worker heartbeat freshness, queue age, backlog, dead jobs, executor state and framework probes in readiness. Table accessibility is not queue readiness.
- Start and supervise cleanup and framework-heartbeat process groups. During this audit, both cleanup machines and both framework heartbeat machines were stopped; one loop machine was running and another stopped.
- Provide an operator control plane for queue depth, failed jobs, leases, retries/dead letters, cost, provider receipts, kill switches and per-run timeline.

**Acceptance:** a headless need reaches a completed campaign after web and worker restarts; killing a worker mid-step recovers the lease; repeated receipts never duplicate candidates or sends; backlog at twice expected peak drains within the signed SLA; operator retry and kill actions are RBAC-controlled and audited.

### 5. Real sourcing quality, provider configuration and learning: P0/P1

- One server-owned sourcing policy must apply to every provider. The direct Apify path currently accepts raw queries, names and schools without the central prohibited-criteria check; Apollo is not strongly bound to an approved requisition.
- Unify fragmented buttons and provider routes behind one campaign authority that chooses approved providers by geography, evidence quality, cost, quota and fallback policy.
- Validate provider-to-key binding, supported model/tool calling, base URL semantics, quota and task suitability. Settings currently exposes base URL and providers that runtime does not consistently support.
- Live secret names include Kimi, GitHub and Tavily configuration, but no successful paid sourcing call was proven. Never infer provider readiness from secret presence.
- Separate fit score from evidence confidence. GitHub/web candidates often lack title, company, location, experience and other signals while unknown dimensions still contribute an anchored number.
- Enrich before outreach when identity/evidence thresholds are not met.
- Resolve people conservatively across LinkedIn, GitHub, email, phone, provider IDs and source URLs; route ambiguous matches for review; maintain one suppression/contact authority per person.
- Schedule Graphify learning under a limited identity. Keep promotion independent, redacted, digest-bound and reversible. Current learning is manual and narrow to reviewed GitHub query selection.

**Acceptance:** the same synthetic identity from three providers resolves to one person and one suppression authority; prohibited criteria are rejected identically by every adapter; provider readiness has a receipt-producing test; two feedback cycles produce a reviewed lesson that changes only the allowed selection, and expired/negative lessons no longer influence runs.

### 6. Human-in-the-loop and autonomous authority: P0 product decision

- Current behavior deliberately requires human approval and tests enforce that no automation toggle exists.
- If configurable autonomy is required, add server-owned policy by tenant, campaign, channel, score/confidence, domain, volume and risk. Default remains human approval.
- Require two-person enablement, canary volumes, immutable policy receipts, kill switch, anomaly auto-pause, time windows and restricted recipients for any auto-send.
- Do not let client flags grant delivery authority.

**Acceptance:** default tenants cannot auto-send; an authorized canary can send only inside the signed policy; threshold, volume, recipient, provider, anomaly and kill-switch violations fail closed; each decision is reproducible from an immutable receipt.

### 7. Privacy, recruiting compliance and AI governance: P0

- Publish approved privacy/terms notices and capture policy-version/legal-basis receipts at careers/intake collection.
- Complete ROPA, DPIA, recruiting/fairness review, AI transparency position, data-residency requirements, subprocessors and transfer assessments.
- Implement verified DSAR intake, identity proof, export across every store/provider, correction, restriction, objection and deletion with backup/provider replay.
- Automate per-class retention, legal holds, evidence preservation and deletion. The current candidate-object export is not a complete data-subject export.
- Remove or obtain explicit approval for instructions that hide AI/automation from candidates.
- Establish an approved model/provider catalog with no-train terms, residency, PII minimization, prompt/output retention, evaluation, drift/bias monitoring and change approval.
- Add candidate provenance to agent runs, framework payloads and memory so erasure can target all derived data.

**Acceptance:** a seeded data subject is found, exported and erased across primary data, agent memory/events, provider obligations and restored backup; legal hold blocks deletion correctly; DPO-approved evidence and policy receipts are attached to the release.

### 8. Application and infrastructure security: P0/P1

- Add a shared distributed tenant/user/IP/provider/operation limiter. The in-process Map multiplies limits by instance count.
- Restrict Kong CORS to approved origins and methods; remove TRACE/CONNECT exposure; add gateway rate limits and a managed WAF/bot/DDoS control.
- Enforce egress with network policy/proxy, not an environment assertion. Pen-test redirects, DNS rebinding, cloud metadata and private ranges.
- Move application encryption to managed KMS/HSM envelope encryption, rotate per policy, audit decrypt/secret use and prove no legacy plaintext records remain.
- Export immutable authentication, membership, privileged action, PII read/export, provider, secret, config, retention and agent-authority events to a SIEM with alert rules.
- Add webhook freshness/replay enforcement consistently and prove real delivery/inbound signatures end to end.
- Remediate the live `playwright-core/browsers.json` module error before enabling browser tools; verify the production image contains its declared runtime assets without expanding browser privileges.
- Commission an independent penetration test after architecture changes, including OWASP ASVS/API, tenant breakout, SSRF, agent prompt/tool abuse and business-logic abuse.

**Acceptance:** multi-instance limiter cannot exceed the configured total; hostile-origin CORS/method tests fail; metadata/private egress fails at the network boundary; SIEM receives test signals within MTTD; key rotation and revocation drills pass; pentest has no unresolved critical/high finding.

### 9. High availability, database, backup and disaster recovery: P0

- Replace the single `cdg` Postgres machine and one attached volume with a supported HA design: primary/standby across failure domains, connection pooling, PITR, monitored storage growth and documented maintenance.
- Current live DB is 1 CPU/1 GB with `max_connections=100`; source intent differs. Allocate explicit connection budgets for web, Auth, REST, workers, migrations and operators.
- Add multi-region/failure-domain strategy for web, gateway, Auth, REST and worker services based on data-residency decisions.
- Align live snapshot retention (reported 5) with approved policy/source declarations; an unattached second volume is not a replica.
- Ratify RPO/RTO and run restore, point-in-time recovery, failover, region-loss, credential-loss and rollback drills. Reapply erasure receipts after restore.

**Acceptance:** failover under load meets RTO with no more than RPO data loss; restore to an isolated environment passes schema, tenant, erasure and application smoke checks; one instance/failure domain can be removed with at least 30 percent headroom.

### 10. Capacity, performance and cost: P0

- Ratify the workload model before selecting infrastructure.
- Add k6 or equivalent scenarios for login/token refresh, reads, concurrent writes, intake, source, enrich, queues, webhooks, outreach and admin metrics.
- Test target plus 30 percent headroom, twice-target stress, sudden spike, deploy under load, provider outage and a 24-hour soak.
- Move long sourcing work off the web request path. Current deterministic sourcing can hold a request for 45 seconds and makes sequential provider calls.
- Wire database enrichment budget claim/settle/release around every paid call. The migration exists, but application source does not call it; client budget is only a hint and each request is merely clamped to ten units.
- Add token/currency/provider budgets by tenant/campaign/day, anomaly alerts, cost attribution and hard fail-closed ceilings.
- Measure Core Web Vitals, bundle budgets, database query plans, pool saturation, queue drain rate and provider latency.

**Acceptance:** all SLOs pass at target plus headroom; no lost updates or duplicate sends; DB connections, CPU, memory, disk, queue age and provider spend stay below signed limits; one component/provider fails without uncontrolled retries or cost.

### 11. Observability, incident response and operations: P0

- Add error tracking, RED/USE metrics, distributed traces, structured persistent log drains and tenant-safe correlation IDs bound to release SHA.
- Add dashboards/alerts for readiness, error/latency/saturation, DB pool/replication/disk, queue age/dead jobs/heartbeats, framework probes, provider quota/latency/cost, security events and webhook lag.
- Add external synthetic journeys for login, intake, sourcing and safe no-send canaries.
- Establish on-call ownership, severity definitions, pager routing, escalation, incident command, customer communication, evidence handling and post-incident review.
- Turn written SLO/error-budget and RTO/RPO proposals into ratified measured controls.
- Add status/support channels, service ownership, runbook drills, change windows, capacity reviews and vendor outage playbooks.

**Acceptance:** injected failure of every required component produces a correctly routed page within MTTD; a game day demonstrates diagnosis, failover/rollback, communication and recovery within targets; logs/traces contain no candidate PII/secrets.

### 12. QA, accessibility and release acceptance: P0/P1

- Make the canonical owned gate green before any release.
- Add scripted Playwright E2E for login, intake, campaign, real/sandbox sourcing, enrichment, identity resolution, ranking, approval/auto-policy, send, delivery/reply/bounce/unsubscribe and erasure.
- Add current axe WCAG 2.2 AA checks for login and every authenticated top-level route at desktop/tablet/mobile, plus keyboard tests and manual VoiceOver/NVDA passes.
- Fix login error announcement and field association; maintain focus, reduced-motion, target-size, contrast, zoom/reflow and screen-reader evidence.
- Add coverage/mutation targets for authority boundaries, cross-browser/device tests, provider contract tests, chaos/recovery tests and performance gates.
- Build a sanitized, production-shaped test-data factory. Never use real candidate PII in CI/load testing.

**Acceptance:** four independent QA lanes sign off functional E2E, security/tenant abuse, resilience/performance and accessibility/compatibility; exact artifacts link to the protected release SHA; all failures are reproducible and zero critical/high defects remain.

### 13. Enterprise governance, vendor management and support: P1

- Assign accountable owners for service, security, privacy/DPO, incident command, data, AI/model risk, vendor management and customer support.
- Complete service inventory, data flow, asset register, threat model, vendor due diligence, SLAs/DPAs, subprocessors, business continuity, change management and quarterly access reviews.
- Add operational license/SBOM notices for all shipped framework and model components.
- Define support tiers, customer onboarding/offboarding, tenant migration, data export, maintenance notices, incident notification and evidence-retention commitments.
- Maintain architecture decisions and regenerate Graphify graph/wiki in CI so agents and engineers use current structure.

**Acceptance:** every control has an owner, evidence source, review cadence and exception expiry; vendor/data/model changes require approval; the quarterly control review produces a signed record.

## Verified controls to preserve

- Auth middleware generally fails closed.
- RLS is enabled on all discovered public tables, and newer sensitive tables often force it.
- Agent delivery authority defaults to none; generated outreach requires review.
- Framework contracts pin revisions and prohibit arbitrary credential, MCP, code-execution and delivery capabilities.
- Agent memory is explicitly treated as untrusted input.
- Candidate erasure has idempotency, legal-hold behavior and durable receipts for its covered stores.
- Durable queue SQL has leases, retries, dead letters, `SKIP LOCKED` claims and transactional follow-on enqueue.
- URL/DNS/private-network validation, log redaction, signed webhooks and opaque unsubscribe tokens have good source-level controls.
- Production database volumes are encrypted and the DB has no public IP.
- Clean install/build/type checks, local dependency audit, focused security tests and full-history Gitleaks passed on the inspected SHA.

These controls are source evidence, not a release certificate. They need exact-SHA hosted execution and live outcome proof.

## Ordered execution plan for Claude

### Phase 0: restore truthful release control

- [ ] Freeze production promotion and document the chosen release/default branch.
- [ ] Restore GitHub Actions billing; enable code scanning and secret scanning.
- [ ] Protect the release branch and Production environment; install required checks and CODEOWNERS.
- [ ] Reconcile the PostCSS alert against the patched lock and rerun Dependabot.
- [ ] Fix all five canonical test failures and run `npm run typecheck && npm run typecheck:tests && npm test` in a clean compatible lane.
- [ ] Build/sign/scan every production image and create one exact-SHA release receipt.
- [ ] Do not deploy until all later P0 release prerequisites used by readiness are satisfied.

### Phase 1: make one real campaign work safely

- [ ] Unify server-side intake; persist source, grounded parse, warnings, clarifications and approved requisition.
- [ ] Apply one prohibited-criteria/requisition policy to every sourcing adapter.
- [ ] Validate one supported sourcing LLM/provider and one real sourcing provider with receipt-producing health checks.
- [ ] Deploy the private framework plane and make `agentFrameworks=true`.
- [ ] Implement durable headless handlers through source, enrich, resolve, rank and draft.
- [ ] Build the operator job/run timeline and kill/retry controls.
- [ ] Run an owner-approved canary need through a real unique candidate, enrichment, person dedupe, ranking/confidence, draft, authorized sandbox or owner-approved recipient, delivery webhook, suppression and cleanup.
- [ ] Preserve a redacted receipt bundle; never claim real sourcing without it.

### Phase 2: remove scale ceilings

- [ ] Normalize hot workspace entities and remove whole-document browser writes.
- [ ] Add row-version concurrency, pagination/indexes and field/resource authorization.
- [ ] Move long work to queues and deploy supervised workers/executors.
- [ ] Replace process-local rate limits; wire hard spend/token/provider budgets.
- [ ] Adopt HA Postgres, pooling, PITR and monitored storage.
- [ ] Add tenant lifecycle/SSO/MFA/SCIM and remove domain auto-admin.

### Phase 3: close security, privacy and AI-governance blockers

- [ ] Implement complete DSAR/retention/provider/backup erasure with provenance.
- [ ] Complete DPIA/ROPA/notices/legal basis/subprocessor/model governance and candidate transparency review.
- [ ] Enforce CORS/WAF/egress/KMS/SIEM controls and close RLS/service-role gaps.
- [ ] Run threat-model abuse tests and independent penetration testing.

### Phase 4: prove operations and 50,000-user acceptance

- [ ] Ratify workload, SLO, error budget, RTO/RPO and cost profile.
- [ ] Install metrics/traces/logs/synthetics/on-call and prove alert routing with injected failures.
- [ ] Run target plus 30 percent, twice-target stress, spike, failover and 24-hour soak.
- [ ] Run restore, PITR, failover, region-loss and release rollback drills.
- [ ] Complete automated/manual WCAG and cross-browser/device certification.
- [ ] Obtain four independent QA sign-offs tied to the exact protected SHA.

### Phase 5: production canary and expansion

- [ ] Deploy the protected signed SHA to an isolated canary tenant.
- [ ] Require `/api/ready` 200, fresh workers, zero dead jobs, budget compliance and green synthetics.
- [ ] Expand gradually with automatic rollback thresholds and explicit owner approval at each stage.
- [ ] Re-run the complete release gate after every source, model, provider, migration or infrastructure change.

## Immediate next commands

Run from a clean non-OneDrive clone where Docker mounts are compatible:

```sh
npm ci
npm run typecheck
npm run typecheck:tests
npm test
npm run build:isolated
gh run list --repo mysticalsin/aria-sourcing --branch integration/sourcing-enrichment-on-main
curl -fsS https://aria-mantu-app.fly.dev/api/ready
flyctl machines list -a aria-mantu-app
```

Before changing source, inspect the exact failing test output and preserve the shared worktree. Do not discard any uncommitted Claude/Codex changes. Update `_relay/HANDOFF.md` only after reconciling the active concurrent shift.

## Release acceptance rule

The app is enterprise-ready only when one protected source SHA is locally and remotely green, its signed images are the images running on Fly, deep readiness is 200, a real controlled sourcing campaign has an end-to-end receipt, identity/privacy/security controls are live, and the ratified 50,000-user workload passes load, failure, recovery, accessibility and four-lane QA evidence. Documentation or source presence alone does not pass a control.
