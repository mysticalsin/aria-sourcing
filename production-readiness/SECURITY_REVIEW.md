# Security Review — MSourcing (Hermes Sourcing) — CONSOLIDATED

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Date:** 2026-06-27 · **Author:** Release Manager (cross-cutting synthesis)
**Method:** Static analysis of the `main` working tree + local test/audit runs. No penetration testing, no running instance, no live cloud/DB access. Supersedes the prior `SECURITY_REVIEW.md`; the controls inventory from that version is preserved and updated below.
**Baselines:** OWASP ASVS L2/L3, OWASP API Top 10, OWASP Top 10, NIST SSDF/CSF, CIS Controls.

> **Net posture:** strong application-layer hygiene undercut by a CRITICAL deploy-config auth-bypass, an unpatched framework, plaintext secrets at rest, untested/untracked tenant isolation, and no rate-limiting — none of which can be marked PASS without remediation + live verification. **No security gate PASSes.**

---

## 1. Controls present (verified in source)

| Control | Status | Location |
|---|---|---|
| SSRF guard on Hermes URL (env-only base, allow-list, blocks metadata/loopback/link-local) | Present — **residual: redirect-follow not blocked; private-IP-only = unreachable from Vercel; 127.0.0.1 pivot** | `src/lib/api/url.ts:24-61` |
| Hermes path + query-param allow-list | Present | `src/lib/api/hermes-proxy.ts:61-77`; `hermes/proxy/route.ts:97` |
| Server-side key vault (secrets never returned; only `last4`) | Present | `src/app/api/keys/route.ts`; `store.ts:1981` |
| RBAC (`can(role, perm)`); per-task chat RBAC; send-route role check; requireAdmin on keys/OAuth/proxy-mutations | Present — **fails open in demo mode**; GET proxy reads ungated | `src/lib/rbac.ts`; `server.ts:18-36`; `outreach/send:72-75`; `hermes/chat:135-146` |
| Human approval gate (never auto-send) | Present | `src/lib/rules.ts`; `outreach/send/route.ts` |
| Atomic outreach de-dupe/cap (`claim_and_record`) | Present — **but route has no caller; suppression flags ignored** | `0002_fleet.sql:99-136`; `outreach/send/route.ts:96-118` |
| Zod input validation + body size caps | Present — **cap enforced after full buffering** | `src/lib/api/validate.ts:19-24` |
| Security headers (X-Frame-Options DENY, frame-ancestors none, nosniff, referrer, permissions) | Present | `next.config.mjs:8-39`; `vercel.json:5-35` |
| RLS tenant-isolation model (8 tables, anon revoked, column-grant secret withholding) | Present in source — **untracked (0004/0005), runtime-unverified, no role predicate on workspace_state** | `supabase/migrations/0005_rls_tenant_isolation.sql` |
| Render-time PII masking | Present — **off by default, reversible, presentation-only** | `src/lib/confidential.ts:11-58` |
| Upstream timeout (Hermes/LLM 30s) + mock fallback | Present — **no timeout on email/OAuth/DNS** | `hermes/chat/route.ts`; `hermes-proxy.ts:11` |
| No XSS sinks (no dangerouslySetInnerHTML/innerHTML/eval/new Function) | Present (verified grep + `security-audit.mts`) | `src/` |
| Secrets server-only (service-role never `NEXT_PUBLIC`); gitleaks in CI | Present — **gitleaks never executed (no remote)** | `config.ts:16`; `ci.yml:42` |
| Least-priv OAuth scopes (`gmail.send`, `Mail.Send`) | Present | `auth/google`, `auth/microsoft` |

---

## 2. Findings by domain (consolidated, de-duplicated)

### CRITICAL
- **SEC-C1 Fail-open demo mode → prod auth/authz bypass.** No-Supabase deploy disables auth + treats all callers as admin (`middleware.ts:13`, `server.ts:21-23`, `store.ts:307`). Red-team CRITICAL override. **Fix:** fail-closed guard in prod + env attestation.
- **SEC-C2 Data-loss path** (cross-ref `R-BACKUP`): no proven backups, restore never drilled, last-write-wins JSONB silent loss. Security-relevant as availability + audit-integrity. **Fix:** PITR + drill + concurrency control.

### HIGH
- **SEC-H1 Vulnerable Next.js 14.2.35** — 4 high advisories (SSRF/cache-poisoning/request-smuggling/image-DoS) + postcss XSS; CI `npm audit ... || true` non-blocking (`ci.yml:40`). Verified 2026-06-27: `{high:4, moderate:1, critical:0}`.
- **SEC-H2 Plaintext secrets at rest** — `api_keys.secret` (`0003:14`), `email_connections.access_token/refresh_token` (`0004:13-16`); pgcrypto unused; no KMS.
- **SEC-H3 Tenant isolation untracked + unverified** — `0004`/`0005` are `??` untracked (not in deployable artifact); zero cross-tenant/negative tests; workspace_state UPDATE has no role predicate (any viewer overwrites tenant state). Red-team: RLS-design FAIL, BOLA/DB-roles UNKNOWN.
- **SEC-H4 No API rate limiting** — LLM/email cost amplification, brute-force, resource exhaustion across all routes.
- **SEC-H5 Hermes proxy unauth open relay + BFLA reads in demo** — unauthenticated PUT/DELETE to Aria config/memory/schedules; role-ungated GET reads of sensitive paths; SSRF redirect-follow not blocked.
- **SEC-H6 Candidate PII in logs; no tamper-evident audit log** — recipient emails + provider bodies logged (`providers.ts:77+`); activities ring buffer is client-mutable, not an audit trail; no `audit_log` table.
- **SEC-H7 CSP `unsafe-inline`+`unsafe-eval`; header/CSP divergence; HSTS only on Vercel** (`next.config.mjs:9-13` vs `vercel.json:11`) — negates XSS mitigation on a PII console; ambiguous effective policy; no HSTS off-Vercel.
- **SEC-H8 Non-HttpOnly session tokens + localStorage PII** — Supabase JWTs in JS-readable cookies (XSS-exfiltratable under weak CSP); demo localStorage persists full candidate PII plaintext (`store.ts:416`).
- **SEC-H9 Suppression/DNC not server-enforced; server send path unwired** — operator opt-out never reaches `claim_and_record`; `/api/outreach/send` has no caller.
- **SEC-H10 CI/CD inert; no deploy-approval; secret-scan never ran** — no git remote; CodeQL/gitleaks zero history; emergency `vercel --prod` bypasses CI.
- **SEC-H11 Privacy/data-protection HIGHs** — PII→cloud-LLM without DPA/no-train; AI-Act high-risk unassessed; retention unenforced; erasure/export/account-removal incomplete; over-broad internal PII access; service-role unmonitored superuser. (See `PRIVACY_REVIEW.md`, `DATA_PROTECTION_REPORT.md`, `ACCESS_REVIEW.md`.)
- **SEC-H12 No coverage of sensitive server paths** — 0/15 handlers, middleware, tenant isolation, OAuth tokens executed by any test; coverage uninstrumented.

### MEDIUM
- Gmail MIME Subject CRLF injection (`email-oauth.ts:168-193`).
- OAuth seat-connect: no anti-CSRF state nonce / no PKCE.
- Stale "claimed" ledger rows on mid-send crash (no TTL/reaper).
- Body fully buffered before size cap (memory DoS self-host).
- No `maxDuration` vs 30s upstream timeout.
- No URL-scheme validation on rendered candidate/booking hrefs (`javascript:`/`data:` DOM-XSS).
- Demo-mode chat unauth relay to paid LLMs (env-conditional).
- Audit trail not tamper-evident; service-role can rewrite ledger.
- Inconsistent error semantics (config/upstream/SSRF-policy failures return HTTP 200 `{ok:false}`).
- No webhook signature/replay protection on `/api/intake`.
- Data residency unverified; encryption-in-transit unverified (config `ssl_enforcement` commented out).

### LOW / ACCEPTED
- `/api/health` discloses node version + config booleans (incl. demo/no-auth state).
- `X-Powered-By: Next.js` not disabled; no OpenAPI; routes unversioned.
- Third-party font CDN (`db.onlinewebfonts.com`) + prod CSP carrying local dev origins.
- `eslint.ignoreDuringBuilds: true` (lint not a build gate).
- **ACCEPTED:** hardcoded `admindemo123` fallback (prod-disabled via `NODE_ENV`); `.env.local` holds only published Supabase demo keys (gitignored).

---

## 3. Test-based assurance — and its limits
- `npm run test`: **705/705 assertions** (22 suites) pass; security subset 87 assertions (security-audit 15, redos 9, rbac-keys 23, api-validation 17, guardrails 11, linkedin-policy 12). `typecheck`/`lint`/`build` clean.
- **Red-team caveat:** the "security tests" are largely static-regex source scans (e.g. `security-audit.mts`) with a self-defeating `||` escape hatch, and **none run in CI** (no remote). `rbac-keys.mts` tests the pure `can()` table — **0/15 handlers** and **no RLS/cross-tenant** behavior are exercised. Assurance is real for logic, **overstated for deployed security posture.**

## 4. Gate verdict
**All security-relevant gates FAIL or UNKNOWN.** Required before any can move toward PASS: ship the fail-closed prod guard; upgrade Next.js + make audit blocking; encrypt secrets at rest; commit `0004`/`0005` and add CI RLS cross-tenant + intra-tenant negative tests on a seeded DB; add API rate limiting + the demo-proxy auth guard; redact PII in logs + add a tamper-evident audit sink; consolidate headers + tighten CSP + HttpOnly cookies; wire CI on a remote with a green run; then verify live TLS/IAM/cookie-flags/backups against authorized infra.
