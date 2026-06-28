# ARCHITECTURE — MSourcing (Hermes Sourcing by Mantu)

**Phase 1 deliverable.** Audit date: 2026-06-27. New document (no prior version).
Companion to INVENTORY.md, DATA_FLOW.md, ASSET_REGISTER.md, UNKNOWN_ITEMS.md.

---

## 1. System shape (one diagram)

```
                         ┌──────────────────────────────────────────────────────┐
   Browser (operator)    │  Next.js 14 App Router (Vercel serverless, cdg1)      │
   ┌───────────────┐     │                                                      │
   │ React 18 UI   │     │  ┌── middleware.ts (LIVE only) ──┐                    │
   │ 19 pages      │◀───▶│  │ Supabase SSR session refresh  │  excludes /api     │
   │ HermesProvider│     │  │ redirect-to-/login gate       │                    │
   │ (store.ts,    │     │  │ email-domain allow-list       │                    │
   │  3069 LOC)    │     │  └───────────────────────────────┘                    │
   │ three/r3f 3D  │     │                                                      │
   └──────┬────────┘     │  Route handlers (self-gate auth):                     │
          │ anon key     │   /api/keys*  /api/outreach/send  /api/intake         │
          │ (RLS)        │   /api/hermes/{chat,proxy}  /api/health               │
          │              │   /auth/*  (Supabase + Gmail/Graph OAuth)             │
          ▼              │            │ service-role (RLS bypass, secrets)        │
   ┌──────────────┐      │            ▼                                          │
   │ localStorage │      │   ┌─────────────────────────┐                         │
   │ (DEMO mode)  │      │   │ Supabase Postgres (LIVE) │  RLS per workspace      │
   └──────────────┘      │   │ 8 tables + RPCs          │                         │
                         │   └─────────────────────────┘                         │
                         │            │ outbound (server)                         │
                         └────────────┼──────────────────────────────────────────┘
                                      ▼
        ┌──────────────┬──────────────┬───────────────┬──────────────────────┐
        ▼              ▼              ▼               ▼                      ▼
   Aria/Hermes    Cloud LLMs     Email send      OAuth token        DNS resolver
   (private host  (Anthropic/    (Resend/        exchange/refresh   (SPF/DKIM/
    only, SSRF     OpenAI/Groq/   SendGrid/       (Google/MS)        DMARC)
    allow-list)    xAI/Mistral)   Gmail/Graph)
```

There is **one deployable** (the Next.js app). Everything else is an external dependency
the app talks to. The Aria/Hermes Python inference server is **out of repo and out of
scope to deploy here**; the app is only a client of it.

---

## 2. Runtime modes (the central architectural switch)

`supabaseEnabled = NEXT_PUBLIC_SUPABASE_URL && NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabase/config.ts:13`)
flips the entire behaviour:

| Concern | DEMO mode | LIVE mode |
|---|---|---|
| Auth gate | none (open app) | middleware → Supabase session, redirect to /login |
| Persistence | `localStorage` (`hermes-sourcing:v1`) | `workspace_state` JSONB (anon key, RLS, 600 ms debounced upsert) |
| API auth | mostly open (no backend) | `auth.getUser()` + RBAC per route |
| Email send | always dry-run | possible behind 5-condition gate |
| Secret vault | not persisted (session metadata only) | `api_keys` table, service-role reads |

**Architectural risk:** the same codebase silently downgrades to a no-auth,
unencrypted-at-rest, browser-local store if the Supabase env is missing/misconfigured.
A prod deploy with a typo'd env var fails *open* (demo), not closed. (Cross-ref SECURITY_REVIEW.)

---

## 3. Component layers

- **UI / state:** `src/components/**` (24 feature dirs incl. `floor3d/retro/{core,objects,scene,systems}`
  for the three.js city). Global state in one React context (`HermesProvider`, `src/lib/store.ts`,
  3069 LOC) holding the entire `HermesState` (`types.ts:878`): campaigns, candidates, outreach,
  replies, bookings, reports, integrations, activities, settings, seats, suppression, ledger,
  skills, apiKeys, chats, memory, schedules. Versioned migrations (`STATE_VERSION = 11`,
  `seed.ts:45`) with forward-fill on load.
- **Domain logic (`src/lib/`):** `fleet.ts`, `scoring.ts`, `metrics.ts`, `rules.ts`,
  `linkedin-policy.ts`, `confidential.ts`, `humanizer.ts`, `i18n.ts`, `roles.ts`, `rbac.ts`,
  `mock-ai.ts` (45 KB synthetic generator + JD parser).
- **Server boundary (`src/lib/supabase/`, `src/lib/api/`, `src/lib/ai/`):** Supabase clients
  (browser / server-cookie / service-role), input validation (`validate.ts`), SSRF URL guard
  (`url.ts`), Aria proxy helpers (`hermes-proxy.ts`), cloud provider request builders (`ai/provider.ts`).
- **Outbound adapters:** `providers.ts` (Resend/SendGrid), `email-oauth.ts` (Gmail/Graph + token
  refresh), `domain-verification.ts` (DNS).

---

## 4. Trust boundaries

| ID | Boundary | Crossing | Controls in place | Gaps |
|---|---|---|---|---|
| TB-0 | Browser ↔ app | every request | LIVE: middleware session gate (not on /api); CSP/XFO/HSTS headers | CSP uses `unsafe-inline`+`unsafe-eval` (3D/Next); demo = no gate |
| TB-1 | Client ↔ route handlers | API calls | per-route `auth.getUser()` + RBAC; Zod + byte-cap body validation; admin gate on key/proxy mutations | demo mode routes open; `/api/intake` open in demo |
| TB-2 | App ↔ Supabase (anon) | DB reads/writes from browser | RLS per `current_workspace_id()`; column grants hide secrets/tokens | RLS not live-verified; tenant = shared email domain (any `@company.com` user joins same workspace) |
| TB-3 | Route handler ↔ Supabase (service-role) | secret/token reads, ledger writes | server-only client; workspace-id re-check before service-role writes (OAuth callback, key test) | service-role bypasses RLS — correctness depends on each call's manual scoping |
| TB-4 | App ↔ Aria/Hermes runtime | LLM proxy | env-only base URL; SSRF allow-list (**private/local hosts only**); bearer server-side; path allow-list; per-task RBAC | allow-list rejects PUBLIC hosts ⇒ cannot reach a public Aria URL from Vercel (see §6) |
| TB-5 | App ↔ cloud LLM providers | outreach/classify prompts | key server-side (vault by id, workspace-scoped, or env); fixed 30 s timeout | candidate PII leaves to 3rd-party LLM (DATA_FLOW exit point) |
| TB-6 | App ↔ email providers | candidate email send | From = seat mailbox (never request body); domain-verified; claim RPC; confirmLive | provider-side deliverability/abuse out of scope |
| TB-7 | App ↔ Google/MS OAuth | mailbox token grant | admin-gated start; callback re-checks seat workspace before service-role write | OAuth `state` is base64 JSON (seatId/provider), **no CSRF nonce bound to session** (cross-ref SECURITY) |

---

## 5. Key control flows

**Outreach send (safe-by-construction; `api/outreach/send/route.ts`):** a real send needs ALL of —
(1) `supabaseEnabled`, (2) authenticated + `outreach` permission, (3) seat in caller's workspace,
`active`, `mode='live'`, `domain_verified`, (4) `claim_and_record` RPC allows (suppression +
90-day re-contact window + per-seat warm-up daily cap + atomic de-dupe via partial unique index),
(5) `confirmLive===true`. From-address is taken from the seat row, not the request body. The ledger
row is written `claimed` first, reconciled to `sent`/`skipped` after the provider responds (failed
send frees the slot, never counts as contacted). Anything short ⇒ dry-run.

**LLM proxy (`api/hermes/chat`):** auth first → Zod validate → per-task RBAC (outreach⇒outreach,
sourcing/classify⇒source) → server-defined system prompt only (never accepts client `system`) →
either cloud provider (key resolved vault→env) or self-host Aria (SSRF-checked URL). Text generation
only; the never-auto-send invariant lives upstream in the store.

**Auth bootstrap:** `ensure_workspace()` (SECURITY DEFINER) maps the signed-in user's **email
domain** to a shared workspace (find-or-create) and provisions the profile with default role
`member`. This is the tenancy model: **one workspace per email domain, shared by all users of that
domain.** Role/workspace are immutable from the client (RLS insert/update `WITH CHECK`).

---

## 6. Notable architecture observations (feed findings)

1. **Aria proxy SSRF allow-list is private-host-only** (`src/lib/api/url.ts:47-57`: localhost,
   `hermes`, `10/8`, `172.16/12`, `192.168/16`, `host.docker.internal`). On Vercel serverless the
   app cannot reach a *public* Aria endpoint — so the self-host LLM path only works when Aria is
   reachable on a private network the Vercel function shares (it is not, by default). In a Vercel
   deploy, only the **cloud LLM provider** branch is functional; the self-host branch is effectively
   unreachable. This is an architecture/deployment mismatch, not a bug, but it means the documented
   "Aria runtime" path needs a non-Vercel host (or Vercel + private networking) to function.
2. **Two CSP definitions can drift** — `next.config.mjs` (richer: fonts, CloudFront video, local
   Supabase) and `vercel.json` (stricter). On Vercel both apply; `vercel.json` headers and
   `next.config` headers are both emitted and the browser will enforce the union/last — config drift
   risk. HSTS is only in `vercel.json` (absent from `next.config`).
3. **Tenancy = email domain.** Any user who can authenticate with an `@company.com` address lands in
   the *same shared workspace* and sees all candidate PII, ledger, chats, and memory for that domain.
   Multi-tenant isolation is *between* domains, not *within*. This is a deliberate "shared org"
   model but must be an explicit business decision for PII (UNKNOWN_ITEMS).
4. **No live cron/worker layer.** `schedules` is UI-only. Anything described as "autonomous" /
   "always-on agent fleet" is, in this repo, operator-triggered store actions + a mock generator.
   Real autonomy would require the out-of-repo Aria runtime + a scheduler that does not exist here.
5. **Single giant client store** (3069 LOC) persisted whole to one JSONB row / localStorage key.
   Concurrency model is last-writer-wins (debounced upsert), no per-entity locking → concurrent
   operators on the same workspace can clobber each other's state (the server-side ledger/claim RPC
   is the only authoritative concurrency control, and only for sends).
6. **"Test key" is format-only** (`providers.ts:16` regex/prefix check), not a live provider call —
   a key can show "valid" yet fail at send/generate time.

---

## 7. Tech stack (versions)

Next.js ^14.2.35, React ^18.3.1, TypeScript ^5.6.3, Tailwind ^3.4.15, framer-motion ^11,
three ^0.169 + @react-three/fiber ^8 + drei ^9 + postprocessing, recharts ^2.13, zod ^3.23,
@supabase/ssr ^0.5.2 + supabase-js ^2.108. Node 20 in CI; local audit ran Node v22.22.3.
17 runtime deps, 11 dev deps, pinned by `package-lock.json` (280 KB). See ASSET_REGISTER for the
dependency-risk view (npm audit: 5 vulns — 4 high, 1 moderate — all in the Next.js tree).
