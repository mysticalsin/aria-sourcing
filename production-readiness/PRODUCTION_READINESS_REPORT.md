# Production Readiness Report — MSourcing (Hermes Sourcing by Mantu)

**Date:** 2026-06-27 · **Synthesized by:** Release Manager (final verdict) · **Stage assessed:** local git `main`, **dirty working tree, no git remote** · **App self-description:** "MVP demo, mock integrations, synthetic data."

> This is an **evidence package for human review, not a certification.** No legal, regulatory, or compliance certification is claimed. It supersedes the prior `PRODUCTION_READINESS_REPORT.md` with the current code and the full 13-phase + red-team review set. Where the prior report said "0/14 PASS, NOT READY," that conclusion **stands and is reaffirmed** with deeper, file:line-cited evidence.

---

## 1. VERDICT: **NOT READY** for production with real users or real sensitive data

MSourcing is a **well-engineered MVP demo** whose application-layer security has matured materially (auth-first API handlers, zod validation everywhere, SSRF allow-list, per-task RBAC, atomic outreach de-dupe, a comprehensive RLS migration, accessible UI primitives, 705/705 unit assertions green). It is **not** a deployable production system: the substrate that "production readiness" requires — a committed/tagged artifact, a running CI pipeline, a deployed database with proven backups + a drilled restore, monitoring/alerting, encryption-at-rest for secrets, a fail-closed auth posture, and a declared compliance basis — **does not exist, is untracked, or is blocked on access.**

**0 of 14 gates PASS. 12 FAIL, 2 UNKNOWN.** Two CRITICAL items are open. Per the operating rule "unknown/untested = FAIL or UNKNOWN, never PASS," and the automatic-release-blocker list, the release is blocked.

### Automatic release blockers currently TRIPPED
1. **CRITICAL open — fail-open demo mode is shippable to production.** A deploy missing/mistyping Supabase env disables auth + authz entirely and treats every caller as admin (`src/middleware.ts:13`, `src/lib/supabase/server.ts:21-23`, `src/lib/store.ts:307`). No production hard-guard exists. This defeats every auth/RBAC/admin control.
2. **CRITICAL — data-loss path with no proven backup + no restore drill.** Prod Supabase backups/PITR unverified (PITR off by default); restore never drilled (local drill could not run — Docker absent). Single last-write-wins JSONB doc causes silent data loss backups can't recover.
3. **HIGH without verified fix (≈30 items)** across auth/authz/data-protection/supply-chain/perf/observability/privacy — see §6.
4. **Unknown authn/authz/data-protection/backup/restore/deploy/monitoring status** — all blocked on live access; conservatively UNKNOWN.
5. **Secrets exposure surface:** candidate PII (emails) written to logs unredacted; provider API keys + OAuth mailbox tokens stored plaintext at rest; backup artifacts dump cleartext secrets and `backups/` is not gitignored; a real Supabase service-role secret is present in the working-tree `.env.local` (gitignored).
6. **Multi-tenant isolation untested** — RLS is design-sound but runtime-unverified; the security migrations that carry it (`0004`/`0005`) are untracked in git; zero negative authz/cross-tenant tests exist.
7. **Backups with no restore test; no rollback drill.**
8. **Critical tests missing** — 0/15 server entry points (8 API + 6 auth + middleware) executed by any test; coverage uninstrumented (UNKNOWN).
9. **Exploitable high in scans** — `npm audit` = 4 high + 1 moderate (Next.js 14.2.35: SSRF, cache-poisoning, request smuggling, DoS); CI audit is non-blocking (`|| true`).
10. **No prod monitoring / no incident path** — no error-tracking/metrics/traces/alerting; on-call is placeholders.
11. **SLOs undefined / unmet** — no load test, no capacity model.
12. **Severe a11y gaps** — open WCAG AA defects + a Level-A autoplay-video issue; mandatory manual axe/SR/keyboard pass not performed.
13. **Privacy/compliance uncertainty** — compliance target undefined; no privacy notice/ROPA/DPIA; candidate PII to cloud LLMs without a DPA; algorithmic ranking likely EU AI Act high-risk, unassessed.
14. **CI/CD inert + no release integrity** — no git remote, CI/CodeQL/gitleaks never executed; no prod-deploy approval gate; dirty tree with untracked security migrations = green checks unbound to a deployable artifact.

None of these are fixable "in code this turn." They require infrastructure, accounts, CI wiring, encryption decisions, and a compliance-scope decision from the owner.

---

## 2. Top risks (ranked) — full register in `RISK_REGISTER.md`

| # | Risk | Severity | Gate | Status |
|---|------|----------|------|--------|
| 1 | Fail-open demo mode shippable to prod (auth/authz bypass deploy path) | **CRITICAL** | 4 | OPEN |
| 2 | No proven backups/PITR + restore never drilled; last-write-wins silent data loss | **CRITICAL** | 12 | UNKNOWN/OPEN |
| 3 | Vulnerable Next.js 14.2.35 (4 high) + non-blocking CI audit | **HIGH** | 2/4/6/8 | OPEN |
| 4 | Provider keys + OAuth mailbox tokens plaintext at rest, no KMS | **HIGH** | 5/6 | OPEN |
| 5 | Multi-tenant RLS runtime-unverified; security migrations 0004/0005 untracked; zero negative tests | **HIGH** | 4/5 | OPEN/UNKNOWN |
| 6 | workspace_state writable by any member/viewer (intra-tenant authz bypass) + last-write-wins lost-update | **HIGH** | 4/5/10 | OPEN |
| 7 | No API rate limiting anywhere (LLM/email cost, brute force, DoS) | **HIGH** | 4 | OPEN |
| 8 | Candidate PII in logs; no durable tamper-evident audit log | **HIGH** | 11/5 | OPEN |
| 9 | No prod monitoring/alerting/error-tracking; no incident detection | **HIGH** | 11 | OPEN |
| 10 | Suppression/DNC never reaches server guardrail; server send path unwired | **HIGH** | 4 | OPEN |
| 11 | CI/CD inert (no remote, never ran); no deploy-approval; rollback never drilled | **HIGH** | 8 | OPEN |
| 12 | Hermes proxy unauth open relay + BFLA reads in demo; SSRF redirect-follow not blocked | **HIGH** | 4 | OPEN/UNKNOWN |
| 13 | 0/15 handlers tested; coverage uninstrumented | **HIGH** | 9 | OPEN/UNKNOWN |
| 14 | Privacy/compliance undefined; decorative toggles; PII→LLM no DPA; AI-Act high-risk unassessed | **HIGH** | 13 | OPEN |
| 15 | CSP unsafe-inline/eval + header drift; non-HttpOnly tokens; localStorage PII | **HIGH** | 3/6 | OPEN |

---

## 3. What was reviewed / fixed

**Reviewed (13 phases + foundation + red team):** application + repo inventory; threat model; frontend UX, WCAG 2.2 AA, frontend security, frontend performance; backend/API, API security (OWASP API Top 10), authorization matrix, business-logic abuse; database, data protection/retention/deletion; infrastructure/network/IAM/TLS; containers; CI/CD + supply chain; QA/coverage/flaky; performance/reliability/capacity; observability/operations/incident; backup/restore/DR/BCP; privacy/compliance/vendor/access. Each phase produced a deliverable under `production-readiness/` (see `EVIDENCE_INDEX.md`).

**Fixed since the prior audit (verified in current tree):**
- Outreach **send-route RBAC** + byte-cap validation; Hermes proxy **safe-param allow-list + admin gate**; chat **per-task RBAC** (`outreach/send/route.ts:72-75`, `api/validate.ts:19-24`, `hermes/proxy/route.ts:50-60`, `hermes/chat/route.ts:135-146`).
- **Accessible confirm modal** replaces `window.confirm` for destructive actions (`src/components/ui/confirm.tsx`) — prior MEDIUM a11y finding now FIXED.
- Full **RLS tenant-isolation migration** authored (`0005`) — but **untracked** (see §6).

**NOT fixable in code this turn:** infrastructure, CI execution, encryption-at-rest, monitoring, backups/restore, compliance scope.

---

## 4. What was tested (evidence pointers)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0, clean | `QA_TEST_RESULTS.md §2` |
| `npm run test` (22 suites) | **705/705 assertions, 0 failed** (sandbox-bypassed: tsx IPC EPERM) | `QA_TEST_RESULTS.md §3` |
| `npm run lint` | "No ESLint warnings or errors" | `QA_TEST_RESULTS.md §4` |
| `npm run build` | exit 0, 36 routes (2 Edge/cache warnings) | `QA_TEST_RESULTS.md §5` |
| `npm audit` | **4 high + 1 moderate, 0 critical** (next 14.2.35) | verified 2026-06-27; `SUPPLY_CHAIN_SECURITY_REPORT.md` |
| Security subset | 87 assertions pass (security-audit/redos/rbac-keys/api-validation/guardrails/linkedin) | `SECURITY_REVIEW.md`, `API_SECURITY_REPORT.md` |
| Coverage | **UNINSTRUMENTED — UNKNOWN**; 0/15 server handlers executed | `COVERAGE_REPORT.md` |
| RLS cross-tenant / negative authz | **NOT RUN** — no live DB; zero such tests exist | `AUTHORIZATION_MATRIX.md`, `DATABASE_REVIEW.md` |
| Restore drill | **NOT RUN** — Docker unavailable | `BACKUP_RESTORE_REPORT.md` |
| WCAG axe / SR / keyboard | **NOT RUN** | `ACCESSIBILITY_REPORT.md` |
| Load / SLO / soak | **NOT RUN** — no staging | `PERFORMANCE_REPORT.md`, `CAPACITY_PLAN.md` |
| Live TLS / IAM / exposure | **NOT RUN** — no cloud access | `TLS_AND_HEADERS_REPORT.md`, `IAM_REVIEW.md` |

**Caveat (red-team):** locally-green checks are unbound to a deployable artifact — dirty tree, untracked security migrations (`0004`/`0005`), no git remote, CI never executed. Re-run all gates against a committed/tagged SHA in CI before sign-off.

---

## 5. Evidence index pointer
See `EVIDENCE_INDEX.md` for every deliverable file, its one-line purpose, and the gate it supports.

---

## 6. Remaining findings (grouped by severity)

**CRITICAL (open):**
- Fail-open demo mode → prod auth/authz bypass deploy path (`middleware.ts:13`, `supabase/server.ts:21-23`, `store.ts:307`).
- No proven backups/PITR; restore never drilled; last-write-wins silent data loss (`BACKUP_RESTORE_REPORT.md`; `store.ts:400-416`; `workspace.ts:63-74`).

**HIGH (open / unknown):** Next.js 14.2.35 advisories + non-blocking audit · plaintext provider keys + OAuth tokens at rest (`0003:14`, `0004:13-14`) · security migrations `0004`/`0005`/`config.toml` untracked · RLS runtime-unverified, zero negative tests · workspace_state member-writable + last-write-wins · no API rate limiting · suppression/DNC never reaches server guardrail; server send path unwired · Hermes proxy unauth relay + BFLA reads in demo; SSRF redirect-follow unblocked · candidate PII in logs; no durable/tamper-evident audit log · no monitoring/alerting/error-tracking; no incident detection · no error boundary (app-wide white-screen) · CSP unsafe-inline/eval + header drift; non-HttpOnly tokens; localStorage PII · CI/CD inert (no remote); no deploy-approval gate; rollback never drilled · 0/15 handlers tested; coverage UNKNOWN · unbounded full-state JSONB persistence; no timeouts on email/OAuth/DNS · backup artifacts dump cleartext secrets; `backups/` not gitignored; no off-site source · privacy: target undefined, no notice/ROPA/DPIA, decorative compliance toggles, broken opt-out, PII→cloud-LLM no DPA, AI-Act high-risk unassessed, no subprocessor register, over-broad internal PII access, service-role unmonitored superuser.

**MEDIUM:** CRLF MIME Subject injection · stale "claimed" ledger rows · body fully buffered before size cap (DoS) · no maxDuration vs 30s upstream · OAuth CSRF (no state nonce/PKCE) · no URL-scheme validation on rendered hrefs · 3D no WebGL fallback · destructive actions without confirm (topbar reset, disabling safety switches) · mobile nav reaches 5/17 routes · recharts on landing bundle; global-context re-render; CWV unmeasured; no list virtualization · WCAG: status-message announcement, badge contrast, reduced-motion, focus restore, palette semantics · audit not tamper-evident · data residency unverified · special-category data verbatim to LLM · DSR flow operator-mediated · retention unenforced · no down-migrations · missing FK/workspace_id indexes · runbook schema drift.

**LOW / ACCEPTED:** hardcoded `admindemo123` (prod-disabled) · `/api/health` discloses node version/config booleans · `X-Powered-By` not disabled · dead login marketing links · `.env.local` real demo keys (gitignored) · render-only masking off by default · vendored `ultraplan/claw3d` sub-project widens supply-chain surface.

---

## 7. Required human approvals / decisions (blocking real production)
1. **Go-live posture decision:** is v1 strictly dry-run, or is live email sending in scope? (Escalates BL-1/2/3/7 to CRITICAL if live.)
2. **Production fail-closed guard:** approve a code change that refuses to serve protected routes when `NODE_ENV=production && !supabaseEnabled`, plus a prod env-var attestation.
3. **Database/tenancy model:** commit Supabase; **commit migrations 0004/0005 + config.toml**; add a CI job that applies migrations + runs pgTAP/RLS cross-tenant + intra-tenant (viewer-write) negative tests.
4. **Secrets at rest:** choose KMS/Vault/pgsodium envelope for `api_keys.secret` + `email_connections` tokens; define rotation.
5. **Supply chain:** approve a Next.js upgrade window and make `npm audit --audit-level=high` blocking in CI.
6. **Infra access for verification:** Vercel + prod Supabase + OAuth-app consoles (IAM, TLS, region/residency, PITR/backups, MFA) — currently all UNKNOWN.
7. **SLOs + RTO/RPO:** ratify latency/throughput/availability targets and recovery objectives.
8. **Compliance scope (DPO/legal):** declare controller/processor + jurisdictions + regimes (GDPR/UK GDPR/CCPA/EU AI Act/e-Privacy); commission DPIA + (if high-risk) FRIA; execute DPAs + subprocessor list; confirm EU residency.
9. **Source integrity:** create a git remote (after gitignoring `backups/`), commit/tag a release SHA, capture a green CI run.
10. **Observability + on-call:** select stack (Sentry/Datadog/OTel), wire alerting + a real on-call rotation, set log retention + PII-scrub.

---

## 8. 30 / 60 / 90-day hardening plan

**0–30 days — make it committed, deployable, and fail-closed:**
- Gitignore `backups/`; create git remote; commit migrations `0004`/`0005` + `config.toml`; commit/tag a release SHA. Wire CI to actually run (typecheck, lint, test, CodeQL, gitleaks) and make `npm audit --audit-level=high` **blocking**.
- Ship the **production fail-closed guard** against demo mode; add a post-deploy smoke asserting `/` → `/login` and `/api/health` shows `supabaseConfigured:true`.
- Add **API rate limiting** (per user+route sliding window) on hermes/*, intake, keys/test, auth/demo-login. Add the **demo-mode auth guard** to `/api/hermes/proxy`.
- Plan + execute the **Next.js upgrade**; redactionhelper for candidate email in logs.
- Add an **error boundary** (`error.tsx`/`global-error.tsx`) + WebGL fallback on `/floor`; confirm-gates on topbar reset and on disabling safety switches.

**30–60 days — prove isolation, recoverability, observability:**
- Spin up a seeded Supabase; add CI **RLS cross-tenant + intra-tenant negative tests** and handler-level tests for all 15 server entry points; add coverage instrumentation + a published threshold.
- Implement **secrets encryption at rest** (KMS/Vault); rotate exposed keys.
- Enable **PITR/backups**; run + record a **restore drill** and a **rollback drill** with measured RTO/RPO.
- Stand up **monitoring** (error tracking, RED/USE metrics, synthetic `/api/health` probe, security-signal alerts, cost/budget alerts); replace on-call placeholders; set log retention + PII scrubbing.
- Run a full **axe + SR + keyboard + cross-browser + reduced-motion** WCAG 2.2 AA pass; fix AA defects + the Level-A autoplay video.

**60–90 days — scale, compliance, DR:**
- **Load/soak test** to ratified SLOs; add timeouts/retries/circuit-breakers; fix the unbounded-JSONB persistence model (optimistic concurrency or per-entity RLS tables).
- **DPIA** (+ FRIA if AI-Act high-risk); privacy notice + ROPA; wire retention enforcement, DSR export/erasure, account/workspace deletion + mailbox-token revocation; execute DPAs + publish subprocessor list.
- DR tabletop + break-glass procedure; SBOM + provenance/signing in CI; independent pen-test of authorized staging.

---

## Release gate summary
See `RELEASE_GATE_MATRIX.md`. **0/14 PASS · 12 FAIL · 2 UNKNOWN. Final verdict: NOT READY.**
