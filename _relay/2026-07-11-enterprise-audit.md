# ARIA enterprise audit

**Audit date:** 2026-07-11 EDT  
**Audited branch:** `deploy/fly-github-actions`  
**Audited SHA:** `05cda612130d941f63512d503541c0410f1fc0fd`  
**Remote SHA at audit:** same  
**Production target inspected:** Fly apps `aria-mantu-app`, `aria-mantu-kong`, `aria-mantu-rest`, `aria-mantu-auth`, `aria-mantu-db`  
**Verdict:** **Not enterprise-ready and not operational as a sourcing platform.** The web shell is reachable, but the production database and authentication machines are stopped. The current agent implementation is not an independent-employee model: ownership is workspace-wide, runs are driven by caller data, memory is shared browser state keyed to seats, and inbound replies can be assigned to the wrong agent.

**Remediation note:** The audit baseline above remains the truth for deployed SHA `05cda612...`. A multi-role local remediation pass has since replaced the unsafe deploy/bootstrap paths, normalized Databricks authority, added connection-safe egress, disabled remote MCP in production, locked database privileges in source, and bound the release scan to the promoted application image. Those changes remain uncommitted and are not production proof.

## Evidence rules

- **Verified** means reproduced against the audited SHA, GitHub run, real browser, or live Fly state.
- **Inferred** means the conclusion follows from verified code paths but was not exercised against a real provider or production database.
- **Unknown** means the required external proof is absent.
- Passing local tests are not treated as production proof.
- Gateway liveness is not treated as database, authentication, migration, provider, queue, or recovery readiness.

## Audit coverage

| Area | Evidence inspected | Result |
| --- | --- | --- |
| Product and frontend | Real Chromium at desktop and mobile, login, public careers, reduced-motion behavior, console and overflow checks, source routes and components | Partial product shell; misleading live states and accessibility gaps |
| Agent model | AgentSpec, run route, graph, memory/chat types, Studio API, RLS, inbound routing, autopilot | Fails independent agent, owner isolation, memory isolation, and reliable conversation routing |
| Backend and APIs | Auth, RBAC, workspace hydration, provider routes, side-effect boundaries, health endpoints, rate limits | Several sound controls exist, but authority is split and failure can appear as demo success |
| Data and tenancy | Migrations `0001` through `0018`, RLS, grants, RPCs, normalized and JSON state | Owner isolation incomplete; shared JSON remains a security authority; RPC and race gaps remain |
| Messaging | Gmail, Graph, WhatsApp webhook, outbox, approval, dispatch, receipts, inbound matching | Guardrails are substantial; email ambiguity and cross-agent reply routing remain unsafe |
| Security | SSRF controls, secret resolution, workspace settings, dependency audit, secret scan ordering | Deployed baseline has the recorded gaps; local source fixes passed independent security review but are not deployed |
| Infrastructure and release | GitHub Actions, deploy workflow and logs, Fly machine state, live endpoints, health probes | Deployed baseline is false-green and the production data plane is down; local replacement is source-accepted only |
| Operations | Backup and restore scripts, runbooks, readiness docs, rollback and incident material | Restore contract improved; no fresh production restore, failover, alert delivery, or DR proof |
| Repository and maintainability | Tracked file inventory, large objects, docs, scripts, source concentration | 227 MB tracked tree with committed machine binaries, run logs, duplicate/stale docs, and a 6,555-line store |
| Test system | Canonical typecheck/test gate, lint, isolated build, compose validation, dependency audit, targeted suites | Local functional gate green; release, browser, accessibility, concurrency, and real-database proof incomplete |

Graphify was invoked first as required. It could not answer because `graphify-out/graph.json` and `graphify-out/wiki/index.md` are absent. Raw source inspection followed that documented miss. CodeRabbit 0.6.5 was installed but signed out, so no CodeRabbit result is claimed and no source was sent to that service.

## Executive result

ARIA currently has three different realities:

1. **The UI reality:** a broad, polished demo surface with sourcing, fleet, replies, Studio, admin, integrations, and careers experiences.
2. **The source reality:** useful sourcing tools, policy gates, provider adapters, normalized tables, and many contract tests, but incomplete authority and wiring between them.
3. **The production reality:** the Next.js shell and Kong liveness endpoint answer, while database-backed authentication and data calls fail.

That mismatch is the primary enterprise risk. A senior operator can see an apparently live system while the authoritative backend is unavailable, and parts of the frontend replace live failures with synthetic state.

## Local infrastructure remediation update, 2026-07-11 05:10 EDT

**Local source verdict:** accepted by independent Databricks, database, egress/MCP, release-chain, and final full-tree QA reviewers.  
**Production verdict:** no-go until the external recovery and release gates below are proven.

Verified on the current uncommitted tree:

- Final QA passed `pretest` 283/283 and the 97-group suite 2,430/2,430, plus typecheck, lint, security 495/495, isolated build, audit threshold, dependency tree command, shell/YAML/TOML parsing, and diff checks.
- Targeted current contracts pass: deploy 34/34, bootstrap 17/17, infrastructure 83/83, readiness 9/9, Databricks database 10/10, and function privileges 13/13.
- `npm run lint`: exit 0.
- `NPM_CONFIG_OFFLINE=true npm run build:isolated`: exit 0 after a clean 504-package install; Next compiled and generated 59 static pages.
- `npm audit --audit-level=high`: exit 0. Two moderate PostCSS advisories remain inside Next.js; the published audit fix is a breaking downgrade.
- `npm ls --all`, shell syntax, workflow YAML 3/3, Fly TOML 6/6, and `git diff --check`: exit 0.
- CI and CodeQL actions are commit-pinned; CI now separates quality, dependency audit, and secret scan behind an aggregate release gate.
- Production deployment is manual-only, serialized, checks the exact release SHA against successful CI and CodeQL, uses a protected environment, and always archives a non-secret partial-evidence inventory.
- The protected release builds the application image once, scans that tar for a CycloneDX SBOM and HIGH/CRITICAL vulnerabilities, publishes the same image, deploys its immutable digest, and verifies the running digest. A successful release requires the complete receipt set.
- Deployment now uses strict failure propagation, exact HTTP 200 acceptance, digest-addressed migration execution, digest verification for deployed images, full migration-ledger identity, and release-SHA readiness.
- Bootstrap uses one serialized transaction, a database advisory lock, filename plus SHA migration ledger, transactional exceptions for unsafe legacy baselines, and resumable current-or-target admin-password rotation.
- `/api/ready` fails closed on database, Auth, queue storage, exact release SHA, latest migration, migration count, and aggregate ledger SHA, with bounded dependency timeouts.
- The high advisory from the bundled Dust SDK is removed. The replacement validates schemas and enforces timeout plus a 2 MB streaming byte cap with body cancellation.
- Databricks authority is normalized into admin-only records with composite workspace, provider, and key binding. Execution is restricted by deployment-owned `DATABRICKS_ALLOWED_ORIGINS` before credential use.
- Public egress pins a validated public address while preserving Host/SNI, denies redirects and compression, and bounds requests, responses, headers, bodies, and time. Remote third-party MCP execution is unconditionally disabled in production.
- Migration 0019 resets current and future Supabase API-role privileges, including defaults owned by `supabase_admin`, then applies explicit routine allowlists. Static and disposable-database test source is complete, but the real database matrix has not run locally.
- `.dockerignore` excludes every `.env*`, credential and readiness material, backups, Supabase local state, agent state, build output, and ignored compiler artifacts from remote build context.

External gates still open:

1. Rotate and revoke the exposed Fly credential, prove old-token rejection, install replacement GitHub secrets, and review provider activity.
2. Preserve the production database, prove scratch restore and rollback, create an audited migration-ledger baseline, then reproduce and fix database exit code 1 on a disposable target.
3. Merge the manual deploy workflow definition to default branch `vercel-demo` or deliberately change the default branch. GitHub currently reports the workflow missing there.
4. Resolve the public-repository confidentiality gate before pushing the credential-incident record or detailed security findings.
5. Protect the release branch, remove avoidable administrator bypass, install a separate short-expiry app-scoped `FLY_REGISTRY_TOKEN`, re-enable the workflow only after credential rotation, and run CI, CodeQL, audit, secret scan, image scan, and deployment for the exact committed SHA.
6. Prove live database, Auth, REST, Kong, app liveness, full readiness, release receipt, restart survival, and rollback.

The original audit snapshot below is retained as the deployed baseline. Local fixes do not change the live production evidence.

## Release gate snapshot

| Gate | Status | Evidence |
| --- | --- | --- |
| Exact local SHA | PASS | Local `HEAD` and `origin/deploy/fly-github-actions` both `05cda612...` |
| Working tree at audit start | PASS | Clean |
| Typecheck plus canonical tests | PASS | `npx tsc --noEmit && npm test`, exit 0; 98 chained commands, 97 unique test files |
| Lint | PASS | `npm run lint`, exit 0 |
| Isolated production build | PASS with warning | `npm run build:isolated`, exit 0; `@dust-tt/client` declares Node `20.19.2` while audit host used Node 22 |
| Compose parse | PASS | `docker compose config --quiet`, exit 0 |
| Dependency audit | FAIL | `npm audit --audit-level=high`, exit 1; one high and three moderate findings |
| GitHub CI for exact SHA | FAIL | Runs `29139277737` and `29139278802` fail at dependency audit; secret scan is skipped after that failure |
| CodeQL | PARTIAL | Push and PR workflows pass, but the PR still reports a separate failing CodeQL context |
| Deploy for exact SHA | FALSE PASS | Run `29139277754` reports success although Auth and REST probes returned 503 |
| Production app liveness | PASS | `/api/health` returns 200 |
| Production database | FAIL | Sole `aria-mantu-db` machine is stopped |
| Production authentication | FAIL | Both `aria-mantu-auth` machines are stopped; `/auth/v1/health` returns 503 |
| Production REST | FAIL | `/rest/v1/` returns 503 `PGRST002`; `/api/careers` returns 503 |
| Production readiness endpoint | ABSENT | `/api/ready` returns 404 |
| Two-user owner isolation | FAIL / unproven | RLS and APIs are workspace-wide; no passing two-user database and browser proof |
| Independent agent memory | FAIL | Memory and chat are shared workspace JSON keyed to `seatId`, not stored AgentSpec and owner |
| Real email round trip | UNKNOWN | No current exact-SHA provider proof |
| Real WhatsApp round trip | UNKNOWN | No current exact-SHA provider proof |
| Flowise private authoring | ABSENT / unknown | No deployed sidecar, isolated views, or spec revision proof |
| Real admin metrics | UNKNOWN | No two-user production evidence from canonical event data |
| Backup and restore | PARTIAL | Contract test passes; no fresh target-environment backup, scratch restore, RTO, or RPO evidence |
| Owner acceptance | NOT RUN | Goal ledger milestones m6 through m12 remain pending |

## Highest-priority findings

### P0-01: Production data plane is down, but deployment reports success

**Status:** verified  
**Evidence:** Fly machine inventory shows the sole database machine `e8299e0c592138` stopped and both authentication machines stopped. PostgREST and Kong remain started. Live Auth and REST calls return 503. In run `29139277754`, Fly reported that the database machine reached `stopped` and then classified it as `in a good state`; the deploy script printed `OK deploy db`. The same run recorded `/rest/v1/ -> 503` and six `/auth/v1/health -> 503` responses, then continued to migrations and declared the stack up because `/api/health` returned 200.  
**Root cause in source:** `deploy-fly.sh` uses `set -uo pipefail`, ignores failed retry helpers, accepts most non-000/non-502/non-401 REST codes, never asserts Auth success, and always prints `Fly stack up`. The GitHub workflow verifies only `/api/health`.  
**Impact:** authentication, tenant state, careers data, agents, metrics, and messaging control-plane calls cannot operate. Releases can be marked successful while unusable.  
**Required closure:** fail-closed deploy script, explicit running-state assertions for services with no Fly service health check, database/Auth/REST readiness probes, migration version check, app build ID, CI dependency, protected serialized environment, and a successful live readiness run.

### P0-02: A regular member can steer stored Databricks credentials to an attacker-selected host

**Status:** verified code path; provider exfiltration not executed  
**Evidence:** `workspace_state` RLS permits both `admin` and `member` to update the complete JSON state. Databricks host, client ID, secret ID, and query are read from that document. Members have `source` permission. The Databricks route resolves the stored secret and then sends either Basic client credentials or a PAT Bearer token to the configured host.  
**Compounding defect:** Node canonicalizes IPv4-mapped IPv6 literals such as `http://[::ffff:127.0.0.1]/` to a hexadecimal form. `classifyFetchHost()` treats that form as public. Reproductions allowed mapped loopback, RFC1918, and metadata addresses.  
**Impact:** an intra-workspace member can cause a server-held integration secret to be transmitted to a host they control, or can target internal services.  
**Required closure:** normalized admin-only integration configuration, server-owned secret-to-host binding, strict approved Databricks origin policy, complete IP parsing, pinned connection address or outbound proxy, and negative tests for member mutation and credential forwarding.

### P0-03: The current AgentSpec and run model does not enforce independent agent employees

**Status:** verified  
**Evidence:** AgentSpec SELECT and UPDATE policies are workspace-only. The specs GET and PATCH routes have no owner-or-admin filter. The run route accepts caller-supplied campaign JSON, makes `specId` optional, never loads the stored spec, and keeps running when the run-row insert fails. Run and event persistence errors are ignored. There is no live resume input or route.  
**Impact:** one member can inspect or change another member's agent, and a run can claim a spec ID without executing the stored role, owner, channel, status, or guardrails. A successful response does not prove a durable agent run exists.  
**Required closure:** owner-or-admin RLS and API authorization; server-loaded active AgentSpec; immutable spec revision on each run; fail-closed durable run creation; leases, pause/resume, budgets, and two-user concurrency tests.

### P0-04: Candidate replies are not bound to an agent conversation

**Status:** verified  
**Evidence:** `messages_inbound` has no agent, spec, run, conversation, or provider-thread foreign key. WhatsApp assigns an inbound reply to the latest outbound row for `(workspace_id, to_address)`. Meta reply-context identifiers are not used for routing. Email sync fetches provider thread IDs but the client store matches by sender email and active campaign, then falls back to the first matching candidate.  
**Impact:** when two agents contact the same person or address, a candidate reply can be shown to or answered by the wrong agent with the wrong role context. This directly violates the requirement that candidates never be confused.  
**Required closure:** canonical `candidate_conversations` and `conversation_messages`, stable provider thread and reply IDs, agent and sender binding, deterministic fallback-to-triage, and adversarial two-agent/same-candidate tests.

### P0-05: Agent memory is a shared UI document, not runtime-owned memory

**Status:** verified  
**Evidence:** `MemoryEntry` and `ChatThread` are keyed only by `seatId`. Both live in the single shared `workspace_state` JSON document. Any member can update that full document. The agent graph and run route do not load these memories. Multiple specs may share one seat.  
**Impact:** the product can display memory without the running agent using it, and two agents sharing a seat can share or overwrite context. There is no provenance, retention, owner ACL, or per-agent memory boundary.  
**Required closure:** normalized `agent_memories` keyed by workspace, owner, AgentSpec, and source; server-side retrieval with bounded context; provenance and deletion; no browser authority; isolation and retention tests.

### P0-06: Deploys are independent of CI and current CI is red

**Status:** verified  
**Evidence:** the audited source workflow triggers directly on every push to the deploy branch and has no dependency on the CI workflow. Exact-SHA CI fails the high dependency gate, but exact-SHA deploy succeeds. Actions use mutable tags, the workflow installs Fly twice, has no concurrency group or protected environment, and reconstructs a secret tarball in the repository workspace without cleanup. The unsafe workflow has since been disabled manually. The live `Production` environment now requires reviewer `mysticalsin` and accepts only `deploy/fly-github-actions`; the branch itself remains unprotected, administrators can bypass, and the replacement workflow remains uncommitted and unverified.  
**Impact:** a known-red revision can become production, concurrent deploys can race, and secrets remain on the ephemeral runner longer than needed.  
**Required closure:** one release workflow that requires all checks for the same SHA, immutable action pins, environment protection, concurrency, restrictive file mode, cleanup trap, and an attested release manifest.

### P0-07: The intended service-only claim function may still be executable through PUBLIC

**Status:** verified migration defect; target-database ACL unverified because production DB is down  
**Evidence:** `claim_and_record()` is a `SECURITY DEFINER` function. Migration `0011` revokes it from `authenticated` and grants it to `service_role`, but does not revoke PostgreSQL's default function EXECUTE privilege from `PUBLIC`, `anon`, and authenticated roles as a set.  
**Impact:** the service-only boundary is not proven. Direct invocation could bypass the intended API approval sequence, depending on the deployed ACL.  
**Required closure:** explicit revoke from `PUBLIC`, `anon`, and `authenticated`; role assertion inside the function; database privilege test after all migrations.

## High-priority findings

| ID | Finding | State | Required proof or fix |
| --- | --- | --- | --- |
| P1-01 | DNS validation and actual fetch resolve separately in web, MCP, and integration paths | Verified | Pin the validated address or route through a controlled egress proxy; test DNS rebinding |
| P1-02 | Email provider acceptance ambiguity is marked retryable after timeout or disconnect | Verified | Add reconciliation-required state and immutable provider request identity |
| P1-03 | Daily seat caps use count-then-insert without a lock | Verified | Serialize on seat or daily counter; real Postgres concurrent test |
| P1-04 | Live workspace read errors become truthy empty state and seed demo data | Verified | Explicit loading, empty, degraded, and conflict states; never synthesize on live failure |
| P1-05 | Fleet bulk deploy still creates client-only `seat_*` identities | Verified | Server-owned normalized bulk create with UUID adoption and rollback behavior |
| P1-06 | Auth configuration disables signup and provides no verified two-user provisioning flow | Verified configuration, operational flow unknown | Admin invitation/provisioning, domain policy, disabled-user lifecycle, two-user acceptance |
| P1-07 | Autopilot always queues, while active goal and comments describe an in-policy auto-answer | Verified | Decide and document release policy. If auto-answer stays required, implement canary, topic scope, dispatch-time approval, and kill switch. If not, amend the goal and UI claims |
| P1-08 | No durable scheduler or worker lease proves independent background execution | Verified absence in repository and Fly config | Durable jobs, lease/heartbeat, idempotent resume, per-agent pause and budgets |
| P1-09 | Flowise remains a planned sidecar, not a deployed tenant-isolated authoring service | Unknown/absent | Private deployment, versioned spec sync, credential isolation, node restrictions, rollback |
| P1-10 | Admin metrics have no exact-SHA two-user proof from canonical event rows | Unknown | Server metrics API, definitions, reconciliation, admin-only E2E |
| P1-11 | Production has one database volume, no replica, and no fresh target restore proof | Verified topology; recovery unknown | Backups, restore drill, alerting, replica/failover decision, recorded RPO/RTO |
| P1-12 | ElevenLabs key rotation remains unproven after prior exposure | Unknown | Provider-side revoke and non-secret rotation receipt |
| P1-13 | Secret scanning is skipped when dependency audit fails first | Verified | Separate jobs or `if: always()` with final aggregate release gate |
| P1-14 | CI runs Node 20 while `.nvmrc`, package engine, and docs target Node 22 | Verified | Choose one supported version and enforce it locally, CI, image, and docs |

## Product, UX, and accessibility findings

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| UX-01 | Production login pre-fills `admin` / `admin` even though the production demo-login route is disabled | Source and live Chromium | Broken and misleading enterprise sign-in posture |
| UX-02 | Login errors lack `role=alert` or a live region | Source inspection | Screen-reader users may not receive authentication feedback |
| UX-03 | Remote hero video and large headline reduce mobile login contrast and focus | Mobile Chromium | Primary action and policy text are harder to scan |
| UX-04 | Careers UI says hiring and `ONLINE` before its backend succeeds | Live Chromium and source | A 503 backend is presented as available until the error arrives |
| UX-05 | Careers page has no `h1`; footer Privacy, Cookies, and Accessibility labels are spans, not destinations | Browser semantics inspection | Poor structure and non-functional legal/accessibility affordances |
| UX-06 | Public CV handling calls `File.text()` for PDF/DOC and falls back to invented skill signals when extracted text is empty | Source inspection | Candidate profile facts can be wrong |
| UX-07 | Studio fields are not consistently associated with labels; channel group lacks fieldset/legend | Source inspection | Form semantics incomplete |
| UX-08 | Chat and Studio convert backend failure into empty-state language such as `No sessions` or `No agents yet` | Source inspection | Users cannot distinguish empty data from an outage |
| UX-09 | No executable axe, keyboard, focus-order, screen-reader, or browser E2E gate exists in the canonical test chain | Test inventory | Visual regressions and accessibility failures are not release-blocking |

The candidate-facing shell is visually clean and responsive, reduced motion is considered, and no horizontal overflow or browser console error was observed in the tested pages. Those positives do not offset false state or missing semantics.

## Repository, documentation, and maintainability findings

| ID | Finding | Evidence | Action |
| --- | --- | --- | --- |
| REP-01 | Git tracks about 227 MB across 920 files | `git ls-files` plus `du` | Set a repository budget and remove generated or machine-specific content from source history in a separate approved cleanup |
| REP-02 | `.localbin/` contains about 155 MB of committed macOS arm64 Supabase executables | File type and size inspection | Replace with checksum-pinned install/bootstrap instructions or CI artifacts; keep developer setup cross-platform |
| REP-03 | `.rocket-fuel/` contains 198 tracked files and about 16 MB, including multi-megabyte event logs | Tracked inventory | Retain only concise receipts needed for audit; move raw run logs outside the product repository |
| REP-04 | `docs/screenshots/` is about 20 MB and contains many archived images | Size inspection | Keep a small current evidence set; move historical media to release artifacts |
| REP-05 | `production-readiness/` contains 57 tracked docs, 51 containing superseded markers | Inventory | Replace with one current runbook, gate matrix, evidence index, and archive index |
| REP-06 | `README`, status, runbook, Docker, and local setup disagree on test count, migration end, ports, hosting, and backup output | Docs audit | One generated facts source plus a test that checks runtime values, not mirrored prose |
| REP-07 | Incident SQL uses stale column names | Runbook versus migrations | Validate every operational query against the current schema in CI |
| REP-08 | `_relay/HANDOFF.md` is stale and there is a duplicate root relay baton | Current files | Archive stale batons and keep one current shift snapshot |
| REP-09 | `src/lib/store.ts` is 6,555 lines and owns most product domains | Line and symbol inspection | Split by domain behind selectors and commands after authority migration, with behavior tests first |
| REP-10 | `graphify-out/.graphify_python` records machine-specific tool metadata while the graph and wiki are absent | Graphify failure and tracked files | Stop tracking tool-local metadata; regenerate a useful graph or remove false navigation claims |

Repository cleanup must not delete user or agent work blindly. It should use an inventory, retention rules, and a reversible branch. Large tracked binaries require a deliberate history-rewrite decision; removing them only from the current tree does not shrink existing history.

## Controls that are already worth preserving

- Public demo side-effect denial has been added to representative live provider routes.
- Live role authority is sourced from the profile instead of the shared role preview.
- Manual suppression now has a server path.
- WhatsApp dispatcher compare-and-set and late-event recovery work has been added.
- Candidate-bound disclosure and salary-boundary checks have meaningful adversarial coverage.
- Official WhatsApp API policy, opt-out handling, approval identity, dedupe, and dispatch-time checks provide a solid base.
- LinkedIn remains governed and draft-assisted. No bypass or unofficial automation should be introduced.
- Restore-drill contract now fails on restore errors and checks named tables, migrations, RLS, fingerprints, and row counts.
- Lint, typecheck, isolated build, and the canonical local test chain pass on the audited SHA.
- Reduced-motion foundations, modal/drawer/tab primitives, and responsive candidate shell are useful UI foundations.

## Fable challenge: is this actually an agent platform?

**Current answer: no.** It is a feature-rich sourcing dashboard with an agent-shaped request runner. The stable identity, authority, memory, conversation, worker lifecycle, and provider reconciliation needed for agents to behave as independent employees are not yet one system.

The minimum honest model is:

```text
workspace + owner
  -> stored AgentSpec + immutable revision
     -> durable AgentRun + lease + budget
        -> agent-owned Memory records
        -> agent-owned CandidateConversation
           -> ordered inbound/outbound Messages
              -> policy decision + approval identity
                 -> OutboxAttempt + provider reconciliation
```

Every row must carry the workspace and agent boundary, and every API must re-check it. A browser seat ID, active campaign, email address, phone number, or `latest outbound` lookup is not an agent identity.

## Audit conclusion

The next build should not start with more pages or a visual redesign. It should first stop false-green releases, restore a genuinely ready production data plane, close the integration-secret path, and establish the normalized agent/conversation/memory authority model. The replacement execution plan is `docs/superpowers/plans/2026-07-11-aria-enterprise-remediation.md`.

The full enterprise goal remains active. This audit does not mark any pending production, provider, two-user, Flowise, recovery, or owner-acceptance criterion complete.
