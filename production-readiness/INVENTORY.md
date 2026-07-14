# INVENTORY — MSourcing (Hermes Sourcing by Mantu)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


**Phase 1 — Full inventory & architecture.** Orchestrator / Inventory Lead.
**Audit date:** 2026-06-27 · **Repo:** `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing`
**Branch:** `main` · **Working tree:** DIRTY (73 modified, 86 untracked, 134 tracked — `git status --porcelain`). Audited as-is.
**Gate mapped:** Gate 1 — Inventory complete → **UNKNOWN** (app/repo inventory complete & evidence-backed; production-infra inventory blocked on access; one open HIGH on source-control). See decision at end.

> SUPERSEDES the prior INVENTORY.md. The prior version was **stale**: it claimed
> "NO `.github/workflows`, no IaC, no CI" and "API routes (6)". Current tree has
> CI + CodeQL workflows, 5 Supabase migrations (incl. RLS hardening), and
> **14 server route handlers**. Real (non-mock) adapters are now wired for email
> send, OAuth mailbox connect, DNS domain verification, and cloud LLM providers.
> Corrected items are marked **[CHANGED]** below.

---

## Executive summary

MSourcing is a single Next.js 14.2 (App Router) application — there are **no separate
services, workers, or daemons in this repo**. It runs in two mutually-exclusive modes
decided purely by the presence of Supabase env vars:

- **DEMO mode** (no `NEXT_PUBLIC_SUPABASE_*`): no auth gate, state persisted to
  browser `localStorage` key `hermes-sourcing:v1`. All email sends forced to dry-run.
- **LIVE mode** (Supabase env present): Supabase SSR auth + middleware gate, state
  persisted to a per-workspace `workspace_state` JSONB row, real sends possible only
  behind a multi-condition guardrail.

A separate **NousResearch "hermes-agent" / "Aria" Python aiohttp inference server** is
referenced as an upstream dependency but **is not in this repo and is not deployed by
it** — the app only *proxies* to it (server-side, SSRF-allow-listed to private hosts).

The package.json self-description ("MVP demo, mock integrations, synthetic data") is now
**only partially accurate**: sourcing/enrichment/CRM/calendar are still mock, but email
send (Resend, SendGrid, Gmail API, Microsoft Graph), OAuth mailbox connect, DNS
deliverability checks, and cloud LLM calls (Anthropic/OpenAI/Groq/xAI/Mistral) are
**real wired adapters** gated behind live-mode + explicit confirmation.

---

## 1. Repositories / services / workers / jobs

| Item | Status | Evidence |
|---|---|---|
| App repo | 1 (this one) — local git, **no remote configured** | `git remote -v` → empty |
| Microservices / sidecars in repo | **None** | no Dockerfile/compose/proc; single Next app |
| Background workers / daemons | **None** | no queue/worker code |
| Cron / scheduled jobs (live) | **None** | `schedules` slice = "Demo posture — UI only, no live cron" (`src/lib/types.ts:897`) |
| External dependency (not deployed here) | Hermes/Aria Python aiohttp LLM server | `.env.production.example:81-92`, `src/app/api/hermes/*` |
| CI workflows **[CHANGED]** | 2 — `ci.yml`, `codeql.yml` | `.github/workflows/` |
| Ops shell scripts | 3 — `backup.sh`, `restore-drill.sh`, `local-supabase-up.sh` | `scripts/` |

**App identity:** `name: "hermes-sourcing"`, `version: 1.0.0`, `private: true` (`package.json:2-4`).

---

## 2. Frontend routes (19 pages)

Source: `find src/app -name page.tsx`. All are App-Router client/server pages; the
heavy state lives in a single client context (`HermesProvider`, `src/lib/store.ts`, 3069 lines).

`/` · `/login` · `/intake` · `/campaigns` · `/campaigns/[id]` · `/candidates` ·
`/outreach` · `/replies` · `/calendar` · `/fleet` · `/floor` · `/chat` · `/reports` ·
`/skills` · `/memory` · `/sessions` · `/soul` · `/curator` · `/settings`

Special files: `src/app/layout.tsx`, `src/app/not-found.tsx`. Route gate: `src/middleware.ts`
(matcher excludes `/api`, `_next`, static assets — see Architecture for the auth boundary).

---

## 3. Server route handlers (14 total) **[CHANGED — prior doc said 6]**

### 3a. API endpoints under `src/app/api` (8)

| Method | Path | Auth (live mode) | Purpose | File |
|---|---|---|---|---|
| POST | `/api/auth/demo-login` | dev-only (404 in prod) | maps `admin`/`admin` → real local Supabase password sign-in | `api/auth/demo-login/route.ts` |
| GET | `/api/health` | public | liveness probe; booleans + node version only | `api/health/route.ts:14` |
| POST | `/api/hermes/chat` | authed; per-task RBAC; demo+HERMES_API_URL ⇒ shared-secret bearer | LLM text proxy (Aria self-host OR cloud provider). **Text only, never sends.** | `api/hermes/chat/route.ts` |
| GET/POST/PUT/PATCH/DELETE | `/api/hermes/proxy` | authed; mutating ⇒ admin | path-allow-listed proxy to Aria runtime | `api/hermes/proxy/route.ts` |
| GET/POST | `/api/intake` | authed (live); open (demo) | parse JD/email → JobAnalysis | `api/intake/route.ts` |
| POST/DELETE | `/api/keys` | admin-only (live) | server-side secret vault CRUD; secret never returned | `api/keys/route.ts` |
| POST | `/api/keys/test` | admin-only (live) | **format-only** validation of a key (not a live provider test) | `api/keys/test/route.ts`; `providers.ts:16` |
| POST | `/api/outreach/send` | authed + `outreach` perm | gated send; dry-run by default | `api/outreach/send/route.ts` |

### 3b. Auth / OAuth route handlers under `src/app/auth` (6) **[NEW — not in prior doc]**

| Method | Path | Auth | Purpose | File |
|---|---|---|---|---|
| GET | `/auth/callback` | n/a | Supabase OAuth code→session; open-redirect-guarded | `auth/callback/route.ts` |
| GET | `/auth/google` | admin | start Gmail-send OAuth for a seat | `auth/google/route.ts` |
| GET | `/auth/google/callback` | admin + workspace check | exchange code, store tokens in `email_connections` | `auth/google/callback/route.ts` |
| GET | `/auth/microsoft` | admin | start Microsoft Graph OAuth for a seat | `auth/microsoft/route.ts` |
| GET | `/auth/microsoft/callback` | admin + workspace check | exchange code, store tokens | `auth/microsoft/callback/route.ts` |
| GET | `/auth/signout` | n/a | sign out, clear session | `auth/signout/route.ts` |

**Webhooks (inbound):** none implemented. `/api/intake` is documented as a *target* for an
external email integration (Graph subscription, forwarding rule, n8n, Zapier) but is a
pull/parse endpoint, not a verified webhook (no signature check). See DATA_FLOW.

---

## 4. Databases / tables / migrations / storage / caches

**Database of record:** PostgreSQL via Supabase (live mode only). Migrations under
`supabase/migrations/` (5 files, applied in order). Demo mode has **no DB** —
browser `localStorage` only.

| Table | Key columns | Sensitivity | Migration |
|---|---|---|---|
| `workspaces` | id, name, allowed_domain (unique) | low | 0001 |
| `profiles` | id→auth.users, email, workspace_id, role | operator PII | 0001 |
| `workspace_state` | workspace_id PK, **state JSONB** (entire app state) | **candidate PII, messages, replies, chats, memory** | 0001 |
| `agent_seats` | operator_email, provider, mode, domain_verified, daily_limit, warmup* | operator PII | 0002 |
| `suppression_list` | type(email/domain/linkedin), value, expires_at | contact-prefs PII | 0002 |
| `outreach_ledger` | candidate_id, **candidate_email**, seat_id, status, at | candidate PII; immutable audit | 0002 |
| `api_keys` | provider, **secret**, last4, status | **secrets** (col-grant withholds `secret`) | 0003 |
| `email_connections` | provider, account_email, **access_token/refresh_token**, expires_at | **OAuth secrets** (col-grant withholds tokens) | 0004 |

**DB functions / RPC (SECURITY DEFINER):** `current_workspace_id()`, `current_profile_role()`,
`ensure_workspace()` (domain-keyed find-or-create), `claim_and_record()` (atomic
suppression + re-contact-window + per-seat daily-cap + de-dupe), `touch_updated_at()` (trigger).

**RLS:** enabled on all 8 tables. Migration `0005_rls_tenant_isolation.sql` revokes anon/PUBLIC,
re-asserts least-privilege grants for `authenticated`, scopes every table to
`current_workspace_id()`, makes admin-only writes for fleet/keys/connections, adds the
missing `WITH CHECK` on `workspace_state` UPDATE, and gives `outreach_ledger` no DELETE
policy (permanent audit). Column-level grants withhold `api_keys.secret` and
`email_connections.access_token/refresh_token` from the `authenticated` role; service-role
is the only read path. **NOTE: RLS correctness is asserted in SQL but NOT verified against a
live DB in this audit — see UNKNOWN_ITEMS.**

**Storage buckets:** none configured in `supabase/config.toml` (storage enabled, no buckets defined).
**Caches:** none (no Redis/Memcached/edge cache config). State persistence is the only store.
**Local backups present:** `backups/hermes_20260627_164402_{schema,data}.sql.gz` (gzipped pg_dump of
the LOCAL stack; `backups/.latest` pointer). Not encrypted; local working backups only (`scripts/backup.sh:5`).

---

## 5. Auth / roles / sessions / tokens / API keys / service accounts

- **Auth provider:** Supabase Auth (SSR via `@supabase/ssr`). External OAuth for mailbox
  send (Google + Microsoft). Login UI references Microsoft (Entra) SSO. Demo mode = no auth.
- **Session:** Supabase cookie session refreshed in `src/middleware.ts`; `jwt_expiry=3600`,
  refresh-token rotation on (local `config.toml:165-174`).
- **Roles / RBAC:** `admin | member | viewer` with 14 permissions (`src/lib/rbac.ts`). Enforced
  server-side via `current_profile_role()` RPC + `can()` and `requireAdmin()`; mirrored in RLS.
  Role/workspace are immutable from the client (profile insert/update policies).
- **Tokens / secrets:**
  - App secret vault: `api_keys.secret` (provider keys), read server-side via service-role only.
  - OAuth mailbox tokens: `email_connections.access_token/refresh_token`, service-role only.
  - Hermes/Aria bearer: `HERMES_API_KEY` env OR vault `api_keys` row by id.
  - Demo-login password: `DEMO_ADMIN_PASSWORD` env (fallback `admindemo123`), dev-only route.
- **Service accounts:** Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY`, server-only,
  bypasses RLS). No other machine identities in repo.

---

## 6. Secrets / env / certs / credentials

Env var inventory (from `.env.production.example`, `.env.local.example`, `config.ts`):

| Var | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | public (browser) | Supabase project + anon key (RLS-protected) |
| `SUPABASE_SERVICE_ROLE_KEY` | server | RLS-bypass for secret reads/admin ops |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | public | optional sign-in domain allow-list (enforced in middleware) |
| `GOOGLE_CLIENT_ID/_SECRET/_REDIRECT_URI` | server | Gmail-send OAuth |
| `MICROSOFT_CLIENT_ID/_SECRET/_REDIRECT_URI` | server | Microsoft Graph OAuth |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | server | transactional email send |
| `HERMES_API_URL` / `HERMES_API_KEY` | server | Aria runtime base URL + bearer |
| `HERMES_PROXY_SECRET` | server | shared secret for demo-mode proxy auth |
| `DEMO_ADMIN_PASSWORD` | server | dev-only demo login |
| `ANTHROPIC/OPENAI/GROQ/XAI/MISTRAL_API_KEY` | server | cloud LLM fallbacks (`provider.ts:111`) |

- **Local `.env.local` present** but **NOT git-tracked** (gitignored `.env*.local`; `git ls-files`
  confirms untracked). Contains only empty Supabase var names — **no real secrets committed**.
- **Certs/TLS:** none in repo; local Supabase TLS disabled (`config.toml:28`). Prod TLS = hosting concern (UNKNOWN).
- **Secret scanning:** gitleaks in `ci.yml`; CodeQL in `codeql.yml`. CI cannot run without a remote.

---

## 7. Infrastructure / DNS / TLS / CI-CD / deploy / rollback

| Area | State | Evidence |
|---|---|---|
| Deploy target | Vercel (declared) — serverless, region `cdg1` | `vercel.json` |
| Build/install | `npm run build` / `npm ci`, output `.next` | `vercel.json:36-38` |
| Security headers | CSP + XFO DENY + nosniff + referrer + permissions; HSTS (vercel.json only) | `next.config.mjs:8-39`, `vercel.json:5-34` |
| CI | typecheck → lint → test → build → `npm audit` (non-blocking) → gitleaks | `ci.yml` |
| SAST | CodeQL (js-ts), weekly + on push/PR | `codeql.yml` |
| Git remote | **NONE** → CI has no host to run on; source has no off-machine copy | `git remote -v` empty |
| IaC (Terraform/Pulumi/CFN) | **None** | repo scan |
| Containers (Docker/compose/k8s/helm) | **None** | repo scan |
| DNS / domain / WAF / CDN / LB | **None provisioned / not accessible** | UNKNOWN_ITEMS |
| Monitoring / APM / log aggregation | **None** (structured `console` logs only — `logUpstream`, `auditLog`) | hermes routes; `providers.ts` |
| Rollback mechanism | runbook docs exist; no automated tested rollback | `ROLLBACK_RUNBOOK.md` (not verified live) |

---

## 8. Third-party integrations / processors

Configurable integration cards (`src/lib/integrations.ts`) — 13 entries:
Email/Outlook, Resume Matcher API, GitHub Sourcing, LinkedIn Sourcing, LinkedIn RSC,
Twenty CRM, Supabase, n8n, Cal.com, Microsoft Graph/Teams, Apollo/Hunter/Clearbit,
SendGrid/Resend, Slack/Telegram.

**Real (wired) external data processors at runtime:**
- Supabase (DB, auth) — `*.supabase.co`
- Resend `api.resend.com`, SendGrid `api.sendgrid.com` (email send) — `providers.ts:85,111`
- Google `oauth2.googleapis.com` + `gmail.googleapis.com`; Microsoft `login.microsoftonline.com` + `graph.microsoft.com` (OAuth + send) — `email-oauth.ts`
- Cloud LLMs: Anthropic/OpenAI/Groq/xAI/Mistral endpoints — `ai/provider.ts:103-109`
- DNS resolver (SPF/DKIM/DMARC lookups) — `domain-verification.ts`
- Aria/Hermes self-hosted runtime (private host only) — `api/url.ts` allow-list
- Web fonts / login hero video: `fonts.googleapis.com`, `db.onlinewebfonts.com`, CloudFront — `next.config.mjs` CSP

**Mock-only (no live adapter):** sourcing (GitHub/LinkedIn), enrichment (Apollo/Hunter/Clearbit),
CRM (Twenty), calendar (Cal.com), n8n, Slack/Telegram. Sourcing returns synthetic candidates
from `src/lib/mock-ai.ts` / `seed.ts` (`STATE_VERSION = 11`).

---

## 9. Sensitive-data locations (summary; full map in DATA_FLOW.md)

- Candidate PII + recruiter messages + classified replies + chats + agent memory →
  `workspace_state.state` JSONB (live) or `localStorage` (demo).
- Candidate email (de-dupe identifier) → `outreach_ledger` (immutable, no client DELETE).
- Provider secrets → `api_keys.secret`. OAuth mailbox tokens → `email_connections`.
- Operator PII (email) → `profiles`, `agent_seats.operator_email`, `api_keys.created_by`.
- Candidate PII transits to the LLM provider (live mode) and to email providers on send.

---

## Gate 1 decision — Inventory complete: **UNKNOWN**

- The **application / repository inventory is COMPLETE and evidence-backed** (routes,
  endpoints, schema, RBAC, secrets, integrations, CI — all enumerated with file:line).
- It is **not PASS** because: (a) the **production-infrastructure inventory cannot be
  completed** — no git remote, no deployed environment, no cloud/DNS/monitoring/backup
  access (blocked on access/decision; catalogued in UNKNOWN_ITEMS); and (b) one **open
  HIGH**: the repo has **no git remote**, so source has no off-machine backup and the
  defined CI/CodeQL/secret-scan pipeline has no host to execute on.
- Per operating rules (unknown/blocked ⇒ never PASS; be conservative) → **UNKNOWN**.
