# Infrastructure Review — MSourcing (hermes-sourcing)

Phase 6 — Infrastructure / Network / IAM / TLS · **Gate 6 — Infrastructure/network (consolidated verdict)**
Reviewer: Cloud / Network / IAM Engineer
Date: 2026-06-27
Scope: configuration + code review only. **No live cloud/staging/prod access authorized** — every live item is marked UNKNOWN with the exact access needed.
Repo: `/Users/tony/.../TEST/MSourcing` · branch `main` · **working tree DIRTY** (audited as-is; 50+ modified files uncommitted, see note).

**Companion reports (read together):**
- `NETWORK_SECURITY_REPORT.md` — exposure, segmentation, SSRF/egress, rate-limiting, dependency-driven network risk.
- `IAM_REVIEW.md` — identity, keys, least-privilege, secrets-at-rest, OAuth scopes, env separation.
- `TLS_AND_HEADERS_REPORT.md` — TLS/HTTPS/HSTS/redirects and security-header correctness.

---

## Executive summary

MSourcing is a Next.js 14.2 App Router app intended for **Vercel serverless** (`vercel.json`, region `cdg1`/Paris) with **Supabase** for Auth + Postgres. **There is no Dockerfile, docker-compose, k8s manifest, Terraform, Helm, or any IaC in the repo** (confirmed) — so "infrastructure" here is exactly two managed planes (Vercel, Supabase) plus a set of egress integrations, all configured by environment variables and two header files.

This supersedes the prior `RELEASE_GATE_MATRIX.md` view of Gate 6 ("UNKNOWN — nothing to audit yet") and Gate 8 ("FAIL — no CI"): there is now **reviewable configuration** — security headers (`next.config.mjs`, `vercel.json`), an SSRF-guarded outbound proxy, RLS + column-grant migrations, a CI workflow (`.github/workflows/ci.yml` with typecheck/lint/test/build + `npm audit` + gitleaks), and documented env separation (`.env.local.example`, `.env.production.example`). The earlier "nothing to audit" no longer holds; the earlier "no CI" is **stale** (CI exists). The **live** plane (deployed TLS, Vercel/Supabase project IAM, network exposure, DR) remains genuinely UNKNOWN and blocked on access.

**Strengths:** clean demo/live mode split; SSRF posture on the Hermes proxy is genuinely good (env-only upstream URL + path allow-list + metadata/loopback blocks); RLS with column-level grants withholding secret columns; `requireAdmin` on mutating routes; least-privilege OAuth scopes; clickjacking + sniffing + referrer + permissions headers on both layers; demo-login hard-disabled in production; CI runs tests + gitleaks.

**Blocking weaknesses (this gate):**
1. **HIGH** — Next.js 14.2.35 ships with multiple **unpatched HIGH advisories** (SSRF via WS upgrade, request smuggling, cache poisoning, image DoS) and CI `npm audit` is **non-blocking** (`NETWORK_SECURITY_REPORT.md`).
2. **HIGH** — Provider API keys and OAuth mailbox tokens are stored **plaintext at rest** with no encryption/KMS (`IAM_REVIEW.md`).
3. **HIGH** — **Demo-mode fail-open**: deploying without Supabase env disables auth entirely (middleware no-op + open API routes); one misconfig = an unauthenticated PII console (this report).
4. **MEDIUM ×N** — header/CSP drift + HSTS only on one path; `unsafe-inline`/`unsafe-eval` CSP; no rate limiting/WAF; segmentation/topology contradiction for Hermes; unverified data residency.
5. **UNKNOWN (blocked)** — live TLS, Vercel project IAM, Supabase project IAM/region/backups, live network exposure.

### Gate 6 decision: **FAIL**
Multiple open HIGH findings and a large UNKNOWN live surface. Per the operating rules (open HIGH ⇒ FAIL; unverified ⇒ UNKNOWN, never PASS), Gate 6 cannot PASS. Component verdicts: TLS/Headers **FAIL**, Network **FAIL**, IAM **FAIL**, with live-plane sub-items **UNKNOWN — blocked on access**.

---

## Infrastructure inventory (what actually exists in the repo)

| Layer | Present? | Evidence |
|---|---|---|
| Container/orchestration (Docker/k8s/Helm) for **MSourcing** | **No** | no `Dockerfile`/`docker-compose`/k8s/helm for the app; the only Dockerfile is a **different** vendored sub-project (`ultraplan/claw3d/Dockerfile`, see INF-05) |
| IaC (Terraform/Pulumi/CDK) | **No** | none in tree |
| Hosting target | Vercel serverless | `vercel.json:3-4` (`framework: nextjs`, `regions: ["cdg1"]`) |
| Build/deploy commands | Defined | `vercel.json:36-38` (`npm run build`, `npm ci`, `.next`) |
| CI/CD | Present | `.github/workflows/ci.yml` (typecheck/lint/test/build, `npm audit` non-blocking, gitleaks) + CodeQL (per brief) |
| Auth/data plane | Supabase | `src/lib/supabase/*`, `supabase/migrations/0001–0005` |
| Security headers | Two sources (divergent) | `next.config.mjs:8-39`, `vercel.json:5-35` |
| Env separation | Documented | `.env.local.example` (dev), `.env.production.example` (prod); **no staging template** |
| Secrets store | Env vars + `api_keys` table | `.env.*.example`, `0003_api_keys.sql` |
| Backups / DR | **No repo evidence** | (see Gate 12; data residency below) |

---

## [HIGH] Demo-mode fail-open — a deployment without Supabase env has no authentication at all
- **Area / Affected:** `src/middleware.ts:13` (`if (!supabaseEnabled) return NextResponse.next();`); `src/lib/supabase/config.ts:13`; demo branches in every `/api/*` route and `requireAdmin` (`server.ts:21-23` returns `{ok:true}` in demo).
- **Description:** Mode is decided **solely** by whether `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present. With them absent (or typo'd / not propagated to the Vercel environment), the app runs in **demo mode**: the middleware auth gate becomes a no-op, `requireAdmin` returns success, and the routes serve without a session. There is **no deploy-time guard** that asserts "production must be in live mode." `/api/health` even advertises the state publicly (`supabaseConfigured:false`).
- **Impact:** A single missing/incorrect env var in the production project turns the recruiting console into an **unauthenticated** app. Mitigating factor: in demo mode persistence is client-side `localStorage` and outreach is forced to dry-run (`outreach/send:50-57`), and the `api_keys` vault doesn't persist — so the worst case is exposure of the **app shell / synthetic demo data and any client-entered data**, not the live multi-tenant DB. But for real users this is a fail-open auth posture driven by config, which is exactly the class of mistake that ships.
- **Likelihood:** Medium — env-var propagation mistakes are common; nothing fails the build or boot when keys are missing.
- **Reproduction:** Build/run with the Supabase env unset → no `/login` redirect, all pages render, `GET /api/health` returns `supabaseConfigured:false`.
- **Evidence:** `src/middleware.ts:12-13`; `src/lib/supabase/server.ts:21-23`; `src/app/api/health/route.ts:17`.
- **Recommended fix:** Add a production boot/build assertion: if `NODE_ENV==='production'` (or a `REQUIRE_AUTH=1` flag) then `supabaseEnabled` **must** be true, else fail the build/startup. Add a deploy-checklist gate and a synthetic check that the prod URL returns a `/login` redirect for an unauthenticated request.
- **Tests to add:** Test that `supabaseEnabled===false` in a production-flagged environment throws; smoke check asserting `302 → /login` on prod root.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** High (config-driven auth bypass) until a hard prod guard exists.

## [MEDIUM] Data residency unverified — functions pinned to `cdg1`, Supabase region not pinned in repo
- **Area / Affected:** `vercel.json:4` (`regions: ["cdg1"]`); Supabase project region — not in repo.
- **Description:** Serverless functions are pinned to Paris (good for EU candidate PII), but the **data** lives in the Supabase project, whose region is set in the Supabase dashboard and is **not evidenced anywhere in the repo**. Functions in cdg1 talking to a US-region Supabase would move EU candidate PII across regions.
- **Impact:** Possible cross-region transfer of EU candidate PII; undermines the apparent EU residency choice. (Not a compliance verdict — produced for human/legal review; see Gate 13.)
- **Likelihood:** Unknown until the Supabase region is confirmed.
- **Evidence:** `vercel.json:4`; no Supabase region anywhere in repo.
- **Recommended fix:** Pin the Supabase project to an EU region matching `cdg1`, document it in `DEPLOYMENT.md`, and confirm all upstreams (email, LLM) are acceptable processors. Record in the DPIA (Gate 13).
- **Status:** OPEN / partially UNKNOWN · **Owner:** Tony + legal · **Residual risk:** Medium.

## [INFO] Working tree is dirty — audited code may not match any deployed/committed artifact
- **Area / Affected:** `git status` shows 50+ modified files uncommitted (incl. `next.config.mjs`, `ci.yml`, `.gitignore`, API routes, README).
- **Description:** Per the brief, the tree was audited as-is. The reviewed `next.config.mjs`/`vercel.json`/routes are **uncommitted working-tree state**; what is deployed (or what a teammate sees) may differ.
- **Impact:** Findings are valid for the current tree only; a deploy from `HEAD` would differ. Supply-chain/provenance concern.
- **Recommended fix:** Commit (or revert) the working tree before any release so the audited state == the deployable state; deploy only from a clean, tagged commit.
- **Status:** OPEN (process) · **Owner:** Tony · **Residual risk:** Medium for provenance.

---

## [LOW] Unrelated sub-project (`ultraplan/claw3d`) vendored into the repo tree (INF-05)
- **Area / Affected:** `ultraplan/claw3d/` — a separate "Claw3D / OpenClaw" Next.js app (its own `Dockerfile`, `.env.example`, `package-lock.json`, custom `server/index.js`, `.github/`), tracked in git (`git ls-files` confirms).
- **Description:** A second, unrelated application is committed inside the MSourcing repo. It has its own container build (`node:20-slim`, custom Node server on port 3000, `NEXT_PUBLIC_GATEWAY_URL=ws://127.0.0.1:18789`), its own dependencies, and its own `.env.example`. It is **not** the MSourcing deployable (Vercel builds `.next` from the root per `vercel.json`), but it expands the repo's dependency/supply-chain surface, secret-scanning scope, and reviewer confusion, and could be mistaken for the app's infra.
- **Impact:** Larger supply-chain/audit surface; risk of its `.env.example`/Dockerfile being read as MSourcing's; its deps are not covered by the root `npm audit`.
- **Likelihood:** Low (not deployed by MSourcing's pipeline).
- **Evidence:** `ultraplan/claw3d/Dockerfile:1-2` ("Claw3D - 3D agent visualization for OpenClaw"); directory listing.
- **Recommended fix:** Move planning/vendored sub-projects out of the deployable repo (separate repo or untracked scratch dir); if kept, document clearly that it is non-deployable and exclude it from the app's audit/scan scope. Confirm gitleaks/CodeQL scope is intentional for it.
- **Status:** OPEN (hygiene) · **Owner:** Tony · **Residual risk:** Low.

## Cross-references (full finding text in the companion files)

| ID | Sev | Title | File |
|---|---|---|---|
| NET-01 | HIGH | Next.js 14.2.35 unpatched HIGH advisories + non-blocking `npm audit` | NETWORK_SECURITY_REPORT.md |
| IAM-01 | HIGH | Plaintext provider keys + OAuth tokens at rest (no KMS) | IAM_REVIEW.md |
| INF-01 | HIGH | Demo-mode fail-open (config-driven auth bypass) | this file |
| HDR-01 | MED | CSP/header drift; HSTS only in vercel.json | TLS_AND_HEADERS_REPORT.md |
| HDR-02 | MED | CSP `unsafe-inline` + `unsafe-eval` | TLS_AND_HEADERS_REPORT.md |
| NET-02 | MED | No rate limiting / WAF | NETWORK_SECURITY_REPORT.md |
| NET-03 | MED | Hermes segmentation/topology contradiction on Vercel | NETWORK_SECURITY_REPORT.md |
| INF-02 | MED | Data residency unverified (cdg1 vs Supabase region) | this file |
| IAM-02 | MED | MS OAuth `/common` multi-tenant; no `state` nonce | IAM_REVIEW.md |
| INF-03 | LOW | Real service-role secret in working-tree `.env.local` | IAM_REVIEW.md |
| INF-04 | LOW | `DEMO_ADMIN_PASSWORD` hardcoded fallback (non-prod) | IAM_REVIEW.md |
| TLS-01 | LOW | `X-Powered-By` exposed | TLS_AND_HEADERS_REPORT.md |
| NET-04 | LOW | Unauthenticated health endpoint recon | NETWORK_SECURITY_REPORT.md |
| HDR-03 | LOW | Dev origins in production CSP | TLS_AND_HEADERS_REPORT.md |
| INF-05 | LOW | Unrelated `ultraplan/claw3d` sub-project vendored in repo | this file |

---

## UNKNOWN — blocked on access (decisions/access needed before Gate 6 can move off FAIL)

| Item | Access / decision needed |
|---|---|
| Live TLS (versions, ciphers, cert, HTTP→HTTPS redirect, HSTS actually served, `preload` submitted?) | prod hostname(s) + authorization to run an external TLS scan (`testssl.sh`/SSL Labs, `curl -sI`) |
| Custom domain + DNS + CAA record | DNS zone access or attestation |
| Vercel project IAM | read-only Vercel project settings: member roles, env-var access, env scoping (prod/preview/dev), deployment protection / preview auth, audit log |
| Supabase project IAM | read-only Supabase settings: separate projects per env?, key rotation history, region, network/IP restrictions, PITR/backups, dashboard MFA, who holds service-role |
| OAuth app registrations (Google/Azure) | confirm single- vs multi-tenant, admin consent, exact registered redirect URIs, secret rotation |
| Live network exposure / preview indexability | authorization to probe + Vercel preview-protection setting |
| Backups / DR restore drill (Gate 12 overlap) | Supabase PITR status + a restore-drill decision |

---

## Gate 6 — Infrastructure/network: **FAIL**
Open HIGH: NET-01 (vulnerable Next.js + non-blocking audit), IAM-01 (plaintext secrets at rest), INF-01 (demo-mode fail-open). Plus open MEDIUMs and a large UNKNOWN live surface. Strong app-level primitives (SSRF guard, RLS/column grants, RBAC, least-privilege OAuth scopes) should be preserved. To reach PASS: remediate the three HIGHs, consolidate headers + add HSTS to the canonical source, add rate limiting, and supply provider-plane IAM + live-TLS evidence (or written attestations) for the UNKNOWN items above.
