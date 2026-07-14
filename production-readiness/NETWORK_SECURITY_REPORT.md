# Network Security Report — MSourcing (hermes-sourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


Phase 6 — Infrastructure / Network / IAM / TLS · **Sub-area: network exposure, segmentation, SSRF/egress, rate-limiting, dependency-driven network risk**
Reviewer: Cloud / Network / IAM Engineer
Date: 2026-06-27
Scope: configuration + code review only. **No live scan / port-scan access authorized** — live exposure marked UNKNOWN.
Repo: `/Users/tony/.../TEST/MSourcing` · branch `main` · working tree DIRTY.

---

## Executive summary

The application targets **Vercel serverless** (`vercel.json:4`, region `cdg1`/Paris) with no Dockerfile, k8s, or IaC in the repo (confirmed). Network trust boundaries are therefore Vercel's edge + serverless functions, Supabase (Postgres + Auth over HTTPS/WSS), and a set of egress calls (Google/Microsoft OAuth, Resend/SendGrid, optional cloud LLMs, and a self-hosted "Aria"/Hermes runtime). The outbound proxy to the Hermes runtime has a **genuinely solid SSRF posture**: the upstream base URL is **env-only** (never client-supplied), an allow-list of paths is enforced, and an SSRF host validator blocks cloud-metadata/link-local/loopback ranges (`src/lib/api/url.ts`, `src/app/api/hermes/proxy/route.ts`). That is the strongest part of the network layer.

The weaknesses are: (1) the deployed **Next.js 14.2.35 carries multiple unpatched HIGH advisories** (SSRF via WebSocket upgrade, HTTP request smuggling in rewrites, cache poisoning, image-optimizer DoS) and CI runs `npm audit` **non-blocking**, so this never fails the pipeline; (2) **no application-layer rate limiting or WAF** anywhere (no `upstash`/`arcjet`/`helmet`, no `vercel.json` WAF/firewall block); (3) a **network-topology contradiction** — the Hermes SSRF allow-list permits only `localhost`/private-IP hosts, which **Vercel serverless cannot reach** (no VPC/private networking on the standard platform), so the self-hosted Hermes integration cannot function from Vercel as configured (fail-closed, but an operability gap that pushes traffic to mock/cloud LLM paths); (4) a public unauthenticated **health endpoint** discloses runtime/config recon.

**Gate 6 (network component): FAIL** — open HIGH (vulnerable Next.js + non-blocking audit) and open MEDIUMs (no rate limiting, segmentation/topology). Live port/exposure posture is UNKNOWN.

---

## Trust boundaries & egress (from code/config)

| Edge | Direction | Where | Auth/Guard |
|---|---|---|---|
| Browser → app | inbound | Vercel edge → Next routes | middleware gate (live mode only); per-route auth in `/api/*` |
| App → Supabase | egress HTTPS/WSS | `*.supabase.co` | anon key (RLS) + service-role (server) |
| App → Hermes/Aria runtime | egress HTTP | `HERMES_API_URL` (env only) | bearer token; **SSRF allow-list** `src/lib/api/url.ts` |
| App → Google/Microsoft OAuth | egress HTTPS | `accounts.google.com`, `login.microsoftonline.com`, Graph/Gmail | client secret (server) |
| App → email providers | egress HTTPS | Resend / SendGrid | API key (server/vault) |
| App → cloud LLMs | egress HTTPS | Anthropic/OpenAI/Groq/xAI/Mistral | vault/env key (server) |

CSP `connect-src` (the browser-side egress allow-list) is restricted to `'self'`, Supabase, blob, and local dev origins (`next.config.mjs:22`) — good: the browser cannot be steered to arbitrary hosts.

---

## [HIGH] Deployed Next.js (14.2.35) carries multiple unpatched HIGH advisories; CI `npm audit` is non-blocking
- **Area / Affected:** `package.json:"next":"^14.2.35"` (installed 14.2.35, confirmed via `require('next/package.json').version`); CI `.github/workflows/ci.yml:39-40`.
- **Description:** `npm audit` reports `next` HIGH with advisory range `9.3.4-canary.0 – 16.3.0-canary.5` (includes 14.2.35). Network-relevant titles include: **SSRF in applications using WebSocket upgrades**, **HTTP request smuggling in rewrites**, **Middleware/Proxy redirects can be cache-poisoned**, **cache poisoning in RSC responses**, and **DoS in the Image Optimization API**. The only fix `npm audit` offers is `next@16.2.9` (a major, breaking upgrade). CI runs `npm audit --audit-level=high || true` — the `|| true` means a vulnerable dependency **never fails the build**.
  - *Correction to prior assumptions:* 14.2.35 **is** patched for CVE-2025-29927 (the `x-middleware-subrequest` auth-gate bypass, fixed in 14.2.25), so that specific CRITICAL does **not** apply. The HIGH advisories above are newer and still open on this version.
- **Impact:** SSRF / request-smuggling / cache-poisoning primitives in the framework that fronts a PII console and an auth middleware. Cache poisoning of middleware redirects is especially relevant because the auth gate is a redirect.
- **Likelihood:** Medium — exploitability depends on whether the specific features (image optimizer, rewrites, WS upgrade) are reachable; the framework is internet-facing regardless.
- **Reproduction:** `npm audit` (output captured this review): `5 vulnerabilities (1 moderate, 4 high)`; `next` HIGH covering 14.2.35.
- **Evidence:** `npm audit` run 2026-06-27; `.github/workflows/ci.yml:39-40`.
- **Recommended fix:** Plan the upgrade to a patched Next (the project will likely need the Next 15/16 line per the advisory). Make `npm audit --audit-level=high` **blocking** in CI (drop `|| true`), or gate via `osv-scanner`/Dependabot with a fail threshold. Track the upgrade as a release blocker, not a backlog item.
- **Tests to add:** CI step that fails on HIGH+ advisories; smoke test of middleware redirect + image route after upgrade.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** High until upgraded.

## [MEDIUM] No application-layer rate limiting or WAF on any endpoint
- **Area / Affected:** all `/api/*` routes; `vercel.json` (no firewall/WAF block); `package.json` (no rate-limit dependency).
- **Description:** No `@upstash/ratelimit`, `arcjet`, `helmet`, or equivalent is present (`grep` → none), and `vercel.json` defines no firewall rules. Routes enforce body-size caps (`src/lib/api/validate.ts:19-25`, 8–100 KB) but nothing throttles request **rate** per IP/user/workspace. Sensitive surfaces: `/api/auth/demo-login` (credential check — dev only but reachable in any non-prod deploy), `/api/intake` (LLM/parse), `/api/outreach/send`, `/api/hermes/{chat,proxy}` (auth'd but each call fans out to an upstream and can run up cost/quota), `/api/keys/test`.
- **Impact:** Brute-force/credential-stuffing on auth, cost-amplification / quota-exhaustion on LLM and email paths, and application-layer DoS. Vercel provides platform DDoS protection but **not** per-route business-logic rate limiting.
- **Likelihood:** Medium.
- **Reproduction:** No throttling middleware in repo; routes return on first valid request without any counter.
- **Evidence:** `grep -iE 'ratelimit|upstash|arcjet|helmet' package.json` → none; `src/lib/api/validate.ts` (size cap only).
- **Recommended fix:** Add per-identity rate limiting (Upstash/Vercel KV or Arcjet) on auth, intake, outreach, and proxy routes; add a Vercel WAF rule set if on a plan that supports it. Tighten especially the unauthenticated/demo paths.
- **Tests to add:** Rate-limit unit test (N+1 request → 429).
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Medium.

## [MEDIUM] Network segmentation / egress topology contradiction for the Hermes runtime
- **Area / Affected:** `src/lib/api/url.ts:47-61`, `.env.production.example:80-92`, `DEPLOYMENT.md:12`, `vercel.json:4`.
- **Description:** The SSRF allow-list permits only `localhost`, `127.0.0.1`, `hermes`, `hermes-agent`, `gateway`, `host.docker.internal`, and RFC-1918 private ranges (`10/8`, `172.16/12`, `192.168/16`). `.env.production.example` says `HERMES_API_URL` "must be a private/internal endpoint (not public internet)". But Vercel serverless functions have **no private/VPC networking by default** — they cannot route to `127.0.0.1` (that's the function itself) or to an arbitrary RFC-1918 address. So on Vercel the Hermes integration **cannot connect** as configured: the proxy correctly fails closed (good for security) but the feature silently degrades to the deterministic mock / cloud-LLM path. Conversely, if someone "fixes" this by pointing `HERMES_API_URL` at a public host, the SSRF allow-list will **reject** it. The intended deployment topology (co-located Node host? Vercel + secure-compute VPC peering? separate origin?) is undocumented.
  - Secondary: the SSRF validator checks the **literal hostname string**, not the **resolved IP** — an allow-listed name (e.g. `gateway`) that resolves via DNS to a public/internal IP is a classic DNS-rebinding/TOCTOU gap. This is **largely mitigated** because the base URL is env-controlled (not attacker-controlled), so the residual risk is low, but it should be hardened if Hermes ever moves to a resolvable name.
- **Impact:** Operability gap (Hermes unusable on Vercel) and an undocumented segmentation model; risk of an insecure "fix" (public Hermes URL) that defeats the SSRF intent.
- **Likelihood:** High that the current config does not work on Vercel; low that the DNS-rebinding path is exploited (env-only URL).
- **Evidence:** `src/lib/api/url.ts:24-61`; `src/app/api/hermes/proxy/route.ts:81-117`; `vercel.json:4`.
- **Recommended fix:** Document the supported topology explicitly. If Hermes must be reachable from Vercel, use Vercel Secure Compute / a private network bridge or a dedicated authenticated origin with mTLS, and resolve+pin the IP before fetch (validate the resolved address, not just the hostname). If Hermes is only for self-hosted Node deploys, state that and keep Vercel on mock/cloud-LLM.
- **Tests to add:** Already covered partly by `tests/hermes-proxy.mts`; add a resolved-IP validation test if DNS names are allowed.
- **Status:** OPEN · **Owner:** Tony / platform · **Residual risk:** Medium (operability) / Low (SSRF, due to env-only URL).

## [LOW] Unauthenticated health endpoint discloses runtime + configuration recon
- **Area / Affected:** `src/app/api/health/route.ts:14-25`
- **Description:** `GET /api/health` returns `200` with `node` version and booleans `supabaseConfigured`, `hermesConfigured`, `emailDomainRestricted`. It is intentionally public for uptime monitoring (and excluded from the middleware matcher — `src/middleware.ts:67`).
- **Impact:** Node version aids CVE targeting; `supabaseConfigured:false` publicly advertises that the deployment is in **demo/no-auth mode** (see `INFRASTRUCTURE_REVIEW.md` fail-open finding) — a direct pointer for an attacker.
- **Likelihood:** Low/Medium (recon).
- **Evidence:** `src/app/api/health/route.ts:15-21`.
- **Recommended fix:** Return only `{ ok: true }` for the public probe; move detailed checks behind auth or an internal-only path; drop `node` from the public payload.
- **Status:** OPEN · **Owner:** Tony · **Residual risk:** Low.

## [UNKNOWN — blocked on access] Live network exposure
- **What cannot be verified:** which routes/ports are actually exposed, whether preview deployments are public and indexable, whether any non-prod surface (demo-login) is internet-reachable, and the real outbound IP set (for upstream allow-listing). No port-scan / live access authorized.
- **Access/decision needed:** production + preview hostnames and authorization to probe; Vercel project settings (deployment protection, preview auth).
- **Status:** UNKNOWN · **Owner:** Tony / platform.

---

## Gate decision (network component of Gate 6): **FAIL**
Open HIGH (vulnerable Next.js + non-blocking `npm audit`) and open MEDIUMs (no rate limiting, segmentation/topology). The SSRF posture on the Hermes proxy is a genuine strength but does not offset the above. Live exposure is UNKNOWN.
