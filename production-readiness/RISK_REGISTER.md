# Risk Register — MSourcing (Hermes Sourcing) — AGGREGATE

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Date:** 2026-06-27 · **Owner of register:** Release Manager (final synthesis) · **Supersedes** the Phase-2 register, which is preserved in `THREAT_MODEL.md`.
**Scope:** de-duplicated aggregate of all 13 review phases + foundation + red team, against the **dirty working tree (no git remote; migrations 0004/0005 + config.toml untracked).**
**Severity model:** per prompt. "today" = current demo posture (synthetic data, no deploy, `supabaseEnabled` typically false). "prod" = real users/PII on a real deploy. Red-team overrides applied (downgrade-only).

## Ranked summary

| # | ID | Risk | Sev today / prod | Gate | Status |
|---|---|---|---|---|---|
| 1 | R-FAILOPEN | Fail-open demo mode shippable to prod — auth/authz bypass deploy path | LOW / **CRITICAL** | 4/6 | OPEN |
| 2 | R-BACKUP | No proven backups/PITR; restore never drilled; last-write-wins silent data loss | LOW / **CRITICAL** | 12 | UNKNOWN/OPEN |
| 3 | R-NEXT | Vulnerable Next.js 14.2.35 (4 high incl. SSRF) + non-blocking CI audit | **HIGH** / **HIGH** | 2/4/6/8 | OPEN |
| 4 | R-SECRETS | Provider keys + OAuth mailbox tokens plaintext at rest, no KMS | LOW / **HIGH** | 5/6 | OPEN |
| 5 | R-RLS | Multi-tenant RLS runtime-unverified; migrations 0004/0005 untracked; zero negative tests | LOW / **HIGH** | 4/5 | OPEN/UNKNOWN |
| 6 | R-WSSTATE | workspace_state writable by any member/viewer + last-write-wins lost-update | LOW / **HIGH** | 4/5/10 | OPEN |
| 7 | R-DOS | No API rate limiting anywhere (LLM/email cost, brute force, DoS) | MED / **HIGH** | 4 | OPEN |
| 8 | R-LOGPII | Candidate PII in logs; no durable tamper-evident audit log | LOW / **HIGH** | 11/5 | OPEN |
| 9 | R-MONITOR | No monitoring/alerting/error-tracking; no incident detection path | LOW / **HIGH** | 11 | OPEN |
| 10 | R-SUPPRESS | Suppression/DNC never reaches server guardrail; server send path unwired | LOW / **HIGH** | 4 | OPEN |
| 11 | R-CICD | CI/CD inert (no remote, never ran); no deploy-approval; rollback never drilled | **HIGH** / **HIGH** | 8 | OPEN |
| 12 | R-PROXY | Hermes proxy unauth relay + BFLA reads in demo; SSRF redirect-follow unblocked | LOW / **HIGH** | 4 | OPEN/UNKNOWN |
| 13 | R-COVERAGE | 0/15 server handlers tested; coverage uninstrumented | n/a / **HIGH** | 9 | OPEN/UNKNOWN |
| 14 | R-PRIVACY | Compliance undefined; no notice/ROPA/DPIA; PII→LLM no DPA; AI-Act high-risk unassessed | LOW / **HIGH** | 13 | OPEN |
| 15 | R-CSP | CSP unsafe-inline/eval + header drift; non-HttpOnly tokens; localStorage PII | MED / **HIGH** | 3/6 | OPEN |
| 16 | R-ERRBOUND | No React error boundary — any client throw white-screens whole SPA | MED / **HIGH** | 3 | OPEN |
| 17 | R-PERSIST | Unbounded whole-state JSONB re-serialized/persisted per mutation (scale ceiling) | LOW / **HIGH** | 10 | OPEN |
| 18 | R-TIMEOUT | No timeout on email/OAuth-refresh/DNS calls (hang to platform limit) | LOW / **HIGH** | 10 | OPEN |
| 19 | R-BACKUPLEAK | Backup artifacts dump cleartext secrets+PII; `backups/` not gitignored; no off-site source | LOW / **HIGH** | 12 | OPEN |
| 20 | R-ACCESS | Over-broad internal PII access; service-role unmonitored all-tenant superuser | LOW / **HIGH** | 13 | OPEN |
| 21 | R-OPTOUT | Outreach opt-out non-functional (List-Unsubscribe placeholder `hermes.example`) | LOW / **HIGH** | 13 | OPEN |
| 22 | R-A11Y | WCAG 2.2 AA defects + Level-A autoplay video; no axe/SR/keyboard pass run | MED / MED | 3 | OPEN/UNKNOWN |
| 23 | R-CRLF | Gmail MIME Subject (CRLF) header injection | LOW / MED | 4 | OPEN |
| 24 | R-CSRF | OAuth seat-connect — no anti-CSRF state nonce / no PKCE | LOW / MED | 4/6 | OPEN |
| 25 | R-CLAIMS | Stale "claimed" outreach-ledger rows on mid-send crash (no TTL/reaper) | LOW / MED | 4/10 | OPEN |
| 26 | R-BODYDOS | Request bodies fully buffered before size cap checked (memory DoS self-host) | LOW / MED | 4 | OPEN |
| 27 | R-MAXDUR | No `maxDuration` on serverless routes vs 30s upstream timeout | LOW / MED | 4/10 | OPEN |
| 28 | R-HREF | No URL-scheme validation on rendered candidate/booking hrefs (DOM-XSS) | LOW / MED | 3 | OPEN |
| 29 | R-RELAY | Demo-mode chat unauthenticated relay to paid LLMs (env-conditional) | LOW / MED | 4 | OPEN |
| 30 | R-AUDIT | Audit trail not tamper-evident; service-role can rewrite ledger | LOW / MED | 5/11/13 | OPEN |
| 31 | R-RETENTION | Retention windows configured but never enforced (retention theater) | LOW / MED | 5/13 | OPEN |
| 32 | R-ERASURE | Right-to-erasure/export incomplete; ledger/replies/chats/memory retain PII | LOW / MED | 5/13 | OPEN |
| 33 | R-DELACCOUNT | No account/workspace deletion; no mailbox-token revocation on offboarding | LOW / MED | 5/13 | OPEN |
| 34 | R-RESIDENCY | Data residency unverified (Vercel cdg1 pinned; Supabase region UNKNOWN) | LOW / MED | 6/13 | UNKNOWN |
| 35 | R-INTRANSIT | Encryption in transit unverified (config ssl_enforcement off; prod TLS unverified) | LOW / MED | 5/6 | UNKNOWN |
| 36 | R-VENDOR | No subprocessor register / DPAs evidenced; mock integrations enable w/o review | LOW / MED | 13 | OPEN |
| 37 | R-INDEX | Missing FK/workspace_id indexes; no down-migrations; runbook schema drift | n/a / MED | 5/12 | OPEN |
| 38 | R-PERF-BUNDLE | recharts on landing route; global-context re-render; no virtualization; CWV unmeasured | n/a / MED | 3/10 | OPEN/UNKNOWN |
| 39 | R-CONTAINER | Planned Claw3D Docker image fails hardening (root, unpinned, no HEALTHCHECK/scan); merge would bake `.env.local` | n/a / MED | 7 | OPEN/UNKNOWN |
| 40 | R-PROC | Dirty tree, no release SHA, vendored sub-project widens audit surface | n/a / MED | 1/8 | OPEN |
| 41 | R-HEALTH | `/api/health` discloses node version + config booleans unauthenticated | LOW / LOW | 4/6 | OPEN |
| 42 | R-DEMO | Hardcoded `admindemo123` fallback (prod-disabled) | LOW / LOW | 4 | ACCEPTED |
| 43 | R-CONF | Security-header config drift (HSTS only on Vercel) | LOW / LOW | 6 | OPEN |
| 44 | R-POWERED | `X-Powered-By: Next.js` not disabled | LOW / LOW | 6 | OPEN |

---

## CRITICAL

### [CRITICAL] R-FAILOPEN — Fail-open demo mode is shippable to production
- **Area / Affected:** Broken auth (A07/ASVS V2) · `src/middleware.ts:13`; `src/lib/supabase/server.ts:21-23`; `src/lib/store.ts:307`; every route's `if (supabaseEnabled)` guard. **Description:** With no/mistyped Supabase env, middleware is a no-op, all API auth is skipped, `requireAdmin` returns admin, and the client treats the caller as admin — the entire console + admin routes are open over real data. No production hard-guard enforces live mode. **Impact:** Total unauthenticated all-tenant access; defeats every auth/RBAC/admin control. **Likelihood:** Low (deploy-config gated) / catastrophic. **Reproduction:** Build/serve without Supabase env → `/` loads with no login; admin routes respond. **Evidence:** red-team CRITICAL override; `middleware.ts:13`, `server.ts:21-23`. **Fix:** refuse to serve protected routes when `NODE_ENV=production && !supabaseEnabled` (fail closed) + prod env attestation + post-deploy smoke (`/` → `/login`). **Tests:** smoke asserting redirect; unit asserting fail-closed in prod. **Status:** OPEN · **Owner:** Tony/Eng · **Residual:** LOW once gated.

### [CRITICAL] R-BACKUP — No proven backups/PITR; restore never drilled; silent data loss
- **Area / Affected:** Availability/DR (NIST CSF RC, CIS 11) · prod Supabase (no infra evidence); `src/lib/store.ts:400-416`; `src/lib/supabase/workspace.ts:63-74`; `workspace_state` (`0001_init.sql:28-31`). **Description:** Prod backups/PITR unverified (PITR off by default on Supabase; documented-only). Restore never drilled — local drill couldn't run (Docker absent). App persistence is a single last-write-wins JSONB doc (600ms debounced) → concurrent writers silently overwrite each other, a loss DB backups cannot recover. **Impact:** Unrecoverable loss of all candidate PII; silent intra-day loss. **Likelihood:** Low day-to-day / catastrophic. **Reproduction:** Two concurrent sessions mutate state → last write wins; no restore evidence exists. **Evidence:** `BACKUP_RESTORE_REPORT.md` F-BR-01/02/04. **Fix:** enable PITR/backups; run + record a restore drill with RPO/RTO; add optimistic concurrency or per-entity tables. **Tests:** scheduled restore drill; concurrency lost-update test. **Status:** UNKNOWN/OPEN — blocked on Supabase access + Docker · **Owner:** Tony/Eng · **Residual:** until drilled.

---

## HIGH (selected detail; remainder cited in domain reports)

### [HIGH] R-NEXT — Vulnerable Next.js 14.2.35; CI audit non-blocking
- **Affected:** `package.json` (`next@^14.2.35`); `.github/workflows/ci.yml:40` (`npm audit --audit-level=high || true`). **Description:** `npm audit` 2026-06-27 = **4 high + 1 moderate** (SSRF GHSA-c4j6-fc7j-m34r, cache-poisoning, request smuggling, image DoS; transitive postcss XSS). npm fix is a major upgrade. **Impact:** SSRF/cache-poisoning/XSS/DoS in the framework fronting all PII + the secret-resolving proxy. **Fix:** upgrade Next.js; drop `|| true`; add Dependabot/Renovate. **Status:** OPEN · **Owner:** Eng.

### [HIGH] R-SECRETS — Provider keys + OAuth tokens plaintext at rest
- **Affected:** `0003_api_keys.sql:14`; `0004_email_connections.sql:13-16`; writers `keys/route.ts:48-51`, `*/callback/route.ts:103-116`, `outreach/send/route.ts:166-169`. **Description:** cleartext columns; `pgcrypto` installed but unused for these. Column grants hide from `authenticated`, but a dump/backup/service-role leak yields full cleartext. **Fix:** KMS/Vault/pgsodium envelope; rotation. **Status:** OPEN · **Owner:** Eng+Tony.

### [HIGH] R-RLS — Multi-tenant RLS runtime-unverified; security migrations untracked
- **Affected:** `0005_rls_tenant_isolation.sql`, `0004_email_connections.sql` (both `??` untracked); `workspace.ts:63-76`. **Description:** isolation rests on RLS that is design-sound but never tested against a live DB; the migrations carrying it are not in the deployable artifact (`git ls-files supabase/` returns only 0001-0003); zero cross-tenant/negative tests. Red team: BOLA PASS → UNKNOWN, RLS-design PASS → FAIL, DB-roles PASS → UNKNOWN. **Fix:** commit 0004/0005/config.toml; add CI pgTAP/RLS cross-tenant + intra-tenant negative tests. **Status:** OPEN/UNKNOWN · **Owner:** Eng.

### [HIGH] R-WSSTATE — workspace_state writable by any member/viewer + lost-update
- **Affected:** `0005:164-181`; `workspace.ts:63-76`; `store.ts:400-419`. **Description:** workspace_state UPDATE policy checks only `workspace_id`, no role predicate → a viewer can overwrite campaigns, candidate PII, outreach content, guardrails, compliance flags; combined with last-write-wins = data loss. **Fix:** role-predicate on writes; optimistic concurrency. **Status:** OPEN · **Owner:** Eng.

### [HIGH] R-DOS — No API rate limiting anywhere
- **Affected:** all `src/app/api/**/route.ts`. **Description:** no per-user/IP/workspace throttle; authenticated loop on `/api/hermes/chat` burns provider budget; `/api/intake` reachable unauth; `/api/keys/test` brute-forceable. **Fix:** edge/middleware sliding-window limiter; per-workspace LLM cap; spend alerts. **Status:** OPEN · **Owner:** Eng.

### [HIGH] R-LOGPII — Candidate PII in logs; no durable tamper-evident audit log
- **Affected:** `src/lib/providers.ts:77,82,99,102,108,126,129`; `email-oauth.ts:68`; `store.ts:445-453` (client ring buffer, not an audit log); no `audit_log` table in migrations. **Fix:** redaction helper; append-off-box, tamper-evident audit sink for sends/key/role changes. **Status:** OPEN · **Owner:** Eng.

### [HIGH] R-MONITOR — No monitoring/alerting/error-tracking; no incident detection
- **Affected:** whole app (no sentry/otel/datadog dep; no `instrumentation.ts`; no `/metrics`; no crons; on-call placeholders). **Fix:** error tracking + RED/USE metrics + synthetic `/api/health` probe + security-signal + cost alerts; real on-call. **Status:** OPEN · **Owner:** Tony/Eng.

### [HIGH] R-SUPPRESS — Suppression/DNC never reaches server guardrail; send path unwired
- **Affected:** `store.ts:1339-1382`; `0002_fleet.sql:99-117` (no `suppression_list` writer in repo); `/api/outreach/send` (zero callers). **Description:** operator suppression/DNC/unsubscribe written only to the JSON state doc; `claim_and_record` ignores candidate flags; the only server-enforced send route has no caller (all outreach is client-side dry-run). Contained today only because live send is unwired. **Fix:** wire server send path; write suppression_list; enforce flags in RPC. **Status:** OPEN · **Owner:** Eng.

### [HIGH] R-CICD — CI/CD inert; no deploy-approval; rollback never drilled
- **Affected:** `.github/workflows/*` (no git remote → never executed); no GitHub Environment/required reviewer; `ROLLBACK_RUNBOOK.md` undrilled. **Fix:** remote + green CI run; blocking audit; prod-deploy approval gate; rollback/PITR drill. **Status:** OPEN · **Owner:** Tony/Eng.

### [HIGH] R-PROXY — Hermes proxy unauth relay + BFLA reads in demo; SSRF redirect unblocked
- **Affected:** `hermes/proxy/route.ts:37-61,141-145`; `hermes-proxy.ts:61-77`. **Description:** in demo mode all auth + admin gate are skipped → unauthenticated PUT/DELETE to Aria api/config|memory|schedules; even authenticated, GET reads of sensitive paths are ungated by role (BFLA). SSRF allow-list does not block redirect-follow; private-IP-only allow-list is unreachable from Vercel → as-deployed posture unverifiable. **Fix:** demo-mode auth guard (`HERMES_PROXY_SECRET`); role-gate GET reads; `redirect:'manual'`; document prod Aria host. **Status:** OPEN/UNKNOWN · **Owner:** Eng.

### [HIGH] R-COVERAGE — 0/15 handlers tested; coverage uninstrumented
- **Affected:** `src/middleware.ts`; `src/app/api/**/route.ts` (8); `src/app/auth/**/route.ts` (6); `workspace.ts`; `email-oauth.ts`. **Description:** 705 assertions are unit/logic-level; no runtime test invokes any handler, middleware, tenant isolation, or OAuth token path; no c8/nyc/istanbul → coverage UNKNOWN. **Fix:** handler-level + tenant-isolation + OAuth tests; coverage instrumentation + CI threshold. **Status:** OPEN/UNKNOWN · **Owner:** QA/Eng.

### [HIGH] R-PRIVACY — Compliance undefined; PII→LLM no DPA; AI-Act high-risk unassessed
- **Affected:** whole product; no `/privacy`|`/terms` route; `compliance-panel.tsx` toggles with zero consumers; `ai/provider.ts:103-109`; `scoring.ts`. **Description:** compliance target undefined; no notice/ROPA/DPIA; decorative gdprMode/ccpaDoNotSell/crmAuditLogs/unsubscribeEnforcement; candidate PII + verbatim reply text to cloud LLMs without DPA/no-train; algorithmic ranking = profiling + likely EU AI Act Annex III §4 high-risk, unassessed. **Fix:** DPO scope decision; notice/ROPA/DPIA(+FRIA); DPAs; functional opt-out. **Status:** OPEN · **Owner:** Tony/DPO+legal.

### [HIGH] R-CSP — CSP unsafe-inline/eval + header drift; non-HttpOnly tokens; localStorage PII
- **Affected:** `next.config.mjs:9-13`, `vercel.json:11`; `supabase/client.ts`; `store.ts:416`. **Description:** script-src ships `unsafe-inline`+`unsafe-eval`; CSP/HSTS diverge between the two header sources (HSTS only on Vercel); Supabase JWTs in non-HttpOnly cookies (XSS-exfiltratable); demo localStorage persists full candidate PII plaintext. **Fix:** nonce/hash CSP, drop unsafe-eval; single header source + HSTS; HttpOnly cookies; encrypt/TTL localStorage or gate behind auth. **Status:** OPEN · **Owner:** Eng.

> Remaining HIGH items (R-ERRBOUND, R-PERSIST, R-TIMEOUT, R-BACKUPLEAK, R-ACCESS, R-OPTOUT) are detailed in `UX_REVIEW.md`, `PERFORMANCE_REPORT.md`/`RELIABILITY_REPORT.md`, `BACKUP_RESTORE_REPORT.md`, `ACCESS_REVIEW.md`, and `COMPLIANCE_MAPPING.md` respectively.

## MEDIUM / LOW / ACCEPTED
Enumerated in the summary table (rows 22–44) with file:line evidence in the corresponding domain reports. ACCEPTED: R-DEMO (prod-disabled `admindemo123`). Functional note: SSRF allow-list excluding public LLM hosts is by design (cloud branch reaches providers via hard-coded endpoints), not a vulnerability.

---
**Mitigation owners:** Tony (infra/KMS/DR/monitoring/compliance decisions) + Eng (deps, encryption, rate-limiting, RLS tests, fail-closed guard, CSP, error boundary). Most code-shaped HIGHs can ship now; the rest are blocked on infrastructure access or a compliance-scope decision.
