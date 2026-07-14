# Authorization Matrix — MSourcing (hermes-sourcing)

> SUPERSEDED by `STATUS.md` 2026-07-10 for current release posture. Historical 2026-06-27 evidence may contain stale stack versions, suite counts, migration ranges, and verdicts.


Phase 4 — Authorization review. Gate mapping: **Gate 4 — authz**.

- Auditor role: Authorization Engineer
- Date: 2026-06-27
- Repo: `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` (git, branch `main`, **working tree DIRTY** — audited as-is; many `src/app/**` and `src/components/**` files show `M` in `git status`, plus `next.config.mjs`, `package.json`, `.github/workflows/ci.yml`, and the keys/intake/outreach API routes).
- Method: static read of routes, RBAC module, Supabase RLS migrations, middleware, store persistence; ran `tsx tests/rbac-keys.mts` and `tsx tests/hermes-proxy.mts`.
- Baselines applied: OWASP ASVS L2 (L3 for auth / multi-tenant / sensitive-data), OWASP API Security Top 10 (esp. **API1 BOLA**, **API5 BFLA**), OWASP Top 10 (**A01 Broken Access Control**), NIST SSDF, CIS Controls.
- **No live/cloud/prod access.** Production env-var configuration (whether Supabase is actually enabled in prod) is **UNKNOWN — blocked on access**. RLS policies are reviewed as source; whether they are actually applied to the live DB is **UNKNOWN — blocked on access** (no DB connection authorized).

---

## 1. Executive summary

The relational, secret-bearing surface of MSourcing has a **genuinely strong** tenant-isolation and admin-gating design: RLS on every table scopes by `workspace_id`, `anon`/`PUBLIC` is fully revoked (`0005_rls_tenant_isolation.sql`), secrets/tokens are withheld by column-level grants, the `profiles.workspace_id` and `profiles.role` columns are immutable from the client (blocking both tenant-hop and self-escalation), and the mutating API routes re-check role server-side via `current_profile_role()` + `requireAdmin()`. Cross-workspace **BOLA is well mitigated** on `api_keys`, `agent_seats`, and `email_connections` (every service-role read is preceded by a workspace check).

However, the authorization model is **not enforced uniformly**, and the gate **FAILS** on open HIGH issues:

1. **Intra-tenant role bypass on `workspace_state` (HIGH).** The bulk of the app's sensitive data — campaigns, candidate PII, outreach message content, guardrail/compliance settings, persona/soul, the `currentRole` value itself — lives in one shared `workspace_state` JSONB document. Its RLS write policy (`members update/insert state`) gates only on `workspace_id`, **with no role check**, so any authenticated workspace member — including a `viewer` — can overwrite the entire workspace's application state. The "viewer = read-only" and "member ≠ settings/fleet" boundaries are **not enforced** for everything stored in JSONB.
2. **Broken function-level authorization on Aria proxy reads (HIGH).** `src/app/api/hermes/proxy/route.ts` gates only *mutating* methods behind admin. **Every `GET`** to sensitive allow-listed paths (`api/config`, `api/memory`, `api/oauth/account`, `api/files`, `api/gateway`, `api/tools`, `api/models`, `api/schedules`, `api/curator`) is reachable by **any authenticated role, including `viewer`**. The documented `manage_tools` / `manage_models` / `manage_providers` / `manage_settings` permissions are never enforced on reads.
3. **Fail-open demo mode (HIGH / config).** When Supabase env is absent, middleware is a no-op and `requireAdmin()` returns `{ ok: true, role: "admin" }`. A missing or mistyped `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` silently disables **all** auth and authz and treats every caller as admin. Whether prod is correctly configured is **UNKNOWN — blocked on access**.

Supporting weaknesses: client-side RBAC is decorative and **defaults to `admin`** (not bound to the server profile role) (MEDIUM); the `chat` task on the LLM proxy has no permission gate and can burn workspace API keys (MEDIUM); there is **no admin-bootstrap / no in-app role-assignment path** despite a `manage_roles` permission (MEDIUM); and there are **zero negative authz integration tests** (role × action × object, BOLA, cross-tenant) — the only RBAC test exercises the pure `can()` table (MEDIUM test gap, ASVS L3 shortfall).

**Gate 4 (authz) verdict: FAIL** — 3 HIGH open. Cross-workspace tenant isolation and object-level (BOLA) controls would pass on their own; function-level authorization (BFLA) and intra-tenant role isolation do not.

---

## 2. Gate decision

| Sub-dimension | Status | Basis |
|---|---|---|
| **Gate 4 — authz (overall)** | **FAIL** | 3 HIGH open (F1, F2, F3) |
| Cross-workspace tenant isolation (BOLA / API1) | PASS* | RLS `workspace_id` scoping + workspace checks before service-role reads; `anon` revoked; profile cols immutable. *PASS of the *source*; live application of RLS is UNKNOWN (no DB access). |
| Object-level authz on secrets/seats/connections | PASS* | `api_keys`/`agent_seats`/`email_connections` reads workspace-verified; secrets/tokens column-withheld. Same live-DB caveat. |
| Function-level authz (BFLA / API5) | **FAIL** | Proxy GET reads ungated by role (F2); `workspace_state` writes ungated by role (F1); chat task ungated (F4). |
| Admin-only mutating routes | PASS | `requireAdmin()` + RLS on keys, OAuth callbacks, proxy mutations, outreach send. |
| Auth-required gating of API routes | PARTIAL | Most routes self-gate; `/api/keys/test` value-path is pre-auth (F7); demo mode fails open (F3). |
| Authz test coverage (ASVS L3) | **FAIL** | No role×action×object / BOLA / cross-tenant negative tests (F8). |

---

## 3. Roles & permissions (source of truth)

`src/lib/types.ts:713` → `ROLES = ["admin","member","viewer"]`.
`src/lib/rbac.ts:29-33` permission grants:

| Permission | admin | member | viewer |
|---|:--:|:--:|:--:|
| view | ✓ | ✓ | ✓ |
| source | ✓ | ✓ | ✗ |
| outreach | ✓ | ✓ | ✗ |
| book | ✓ | ✓ | ✗ |
| reply | ✓ | ✓ | ✗ |
| skills | ✓ | ✓ | ✗ |
| compliance | ✓ | ✓ | ✗ |
| manage_fleet | ✓ | ✗ | ✗ |
| manage_settings | ✓ | ✗ | ✗ |
| manage_keys | ✓ | ✗ | ✗ |
| manage_roles | ✓ | ✗ | ✗ |
| manage_providers | ✓ | ✗ | ✗ |
| manage_models | ✓ | ✗ | ✗ |
| manage_tools | ✓ | ✗ | ✗ |

`can()` (`rbac.ts:38`) is a correct pure lookup — `tests/rbac-keys.mts` → **23 passed, 0 failed** (run 2026-06-27). This proves the *policy table*, not its *enforcement*.

**Two role values exist and they are not bound to each other:**
- **Server role** = `profiles.role`, read via `current_profile_role()` RPC (`0001_init.sql:48`). Authoritative for API routes and RLS.
- **Client role** = `state.currentRole` (`store.ts:307,2910`; `seed.ts:660`), **defaults to `"admin"`**, user-switchable (`setCurrentRole`, `store.ts:2067`), persisted into the shared `workspace_state`. `useRole()` (`store.ts:3028`) returns this. **The client never calls `current_profile_role()`** — UI gating is cosmetic (see F5).

---

## 4. Enforcement points

| Layer | File | What it enforces |
|---|---|---|
| Route middleware | `src/middleware.ts` | Live mode only: redirect unauthenticated → `/login`; email-domain allow-list. **Excludes `/api/*`** (matcher line 67). No-op in demo mode. |
| Admin guard | `src/lib/supabase/server.ts:18` `requireAdmin()` | Auth + `role === 'admin'`. **Returns admin in demo mode** (line 21-23). |
| RBAC check | `src/lib/rbac.ts` `can(role, perm)` | Used server-side in 3 routes; client-side in panels (cosmetic). |
| Per-task RBAC | `hermes/chat/route.ts:135-146` | `outreach→outreach`, `sourcing/classify→source`. `chat` **ungated** (F4). |
| Proxy method gate | `hermes/proxy/route.ts:50-60` | Admin for PUT/PATCH/DELETE and POST (except `v1/chat/completions`,`api/sessions`). **GET ungated by role** (F2). |
| RLS (DB) | `supabase/migrations/0001..0005` | `workspace_id` scoping; admin-only writes on keys/seats/suppression/connections; `workspace_state` writes **ungated by role** (F1). |
| SSRF allow-list | `hermes-proxy.ts` `isAllowedHermesPath` + `isAllowedHermesUrl` | Path + upstream-URL allow-list (out of scope here; covered Phase 3). |

---

## 5. Role × action × object matrix

Legend: **UI** = client `can()` gate (cosmetic, bypassable). **SRV** = server route re-check. **RLS** = DB row/column policy. ✅ enforced / ⚠️ partial / ❌ not enforced / — n/a.

| # | Object / Action | Sensitive? | admin | member | viewer | Enforced by | Notes |
|---|---|:--:|:--:|:--:|:--:|---|---|
| 1 | `api_keys` create (`POST /api/keys`) | secret | allow | deny | deny | SRV `requireAdmin` + RLS | ✅ keys/route.ts:40 |
| 2 | `api_keys` delete (`DELETE /api/keys`) | secret | allow | deny | deny | SRV `requireAdmin` + RLS | ✅ keys/route.ts:70; RLS scopes workspace |
| 3 | `api_keys` test-stored (`POST /api/keys/test {id}`) | secret read | allow | deny | deny | SRV `requireAdmin` + workspace check | ✅ keys/test:43-54 |
| 4 | `api_keys` test-value (`POST /api/keys/test {value}`) | low | allow | allow | allow | **none (pre-auth)** | ❌ F7 — returns before auth (keys/test:26-29) |
| 5 | `api_keys` metadata read | medium | allow | allow | allow | RLS workspace + column grant | ✅ secret column withheld (`0005 §10`) |
| 6 | Aria proxy GET `api/status`,`api/health`,`api/system/stats` | low | allow | allow | allow | SRV auth-only | acceptable |
| 7 | Aria proxy GET `api/config`,`api/memory`,`api/oauth/account`,`api/files`,`api/gateway`,`api/tools`,`api/models`,`api/schedules`,`api/curator`,`api/skills` | **high** | allow | allow | **allow** | SRV auth-only | ❌ **F2** — no role gate on reads; `manage_*` perms ignored |
| 8 | Aria proxy POST `v1/chat/completions`,`api/sessions` | medium | allow | allow | allow | SRV auth-only | runtime chat; ungated by design |
| 9 | Aria proxy POST(other)/PUT/PATCH/DELETE | high | allow | deny | deny | SRV `can(role,manage_settings)` | ✅ proxy:52-60 |
| 10 | LLM `chat` task (`POST /api/hermes/chat task=chat`) | cost/keys | allow | allow | **allow** | SRV auth-only | ⚠️ **F4** — viewer can invoke LLM + use workspace key |
| 11 | LLM `outreach` task | cost | allow | allow | deny | SRV `can(role,outreach)` | ✅ chat:143 |
| 12 | LLM `sourcing`/`classify` task | cost | allow | allow | deny | SRV `can(role,source)` | ✅ chat:143 |
| 13 | Real outreach send (`POST /api/outreach/send confirmLive`) | **PII send** | allow | allow | deny | SRV `can(role,outreach)` + RLS seat + `claim_and_record` | ✅ outreach/send:72-75 + RPC guardrails |
| 14 | `agent_seats` create/update/delete | config | allow | deny | deny | RLS admin-only (`0005 §7`) | ✅ DB-enforced |
| 15 | `agent_seats` read | medium | allow | allow | allow | RLS workspace | ✅ |
| 16 | `suppression_list` write | compliance | allow | deny | deny | RLS admin-only (`0005 §8`) | ✅ |
| 17 | `email_connections` connect (OAuth callback) | OAuth tokens | allow | deny | deny | SRV `requireAdmin` + seat workspace check + RLS | ✅ google/microsoft callback:52,94 |
| 18 | `email_connections` tokens read | OAuth tokens | service-role only | ❌ | ❌ | column grant withholds tokens (`0004:26`) | ✅ |
| 19 | `workspace_state` read (campaigns, candidate PII, messages, settings) | **PII** | allow | allow | allow | RLS workspace | ⚠️ by design viewer sees all; acceptable per model |
| 20 | **`workspace_state` write (overwrite ALL app state)** | **PII/integrity** | allow | **allow** | **allow** | RLS workspace, **no role** | ❌ **F1** — viewer/member overwrite everything (`0005 §6`) |
| 21 | `profiles.role` self-escalation | privesc | deny | deny | deny | RLS pinned `is not distinct from current_profile_role()` | ✅ `0005 §5` / `0001:63` |
| 22 | `profiles.workspace_id` tenant-hop | tenant | deny | deny | deny | RLS pinned + insert `workspace_id is null` | ✅ `0005 §5` |
| 23 | Cross-workspace read of any table | tenant | deny | deny | deny | RLS `= current_workspace_id()`; `anon` revoked | ✅ `0005 §1-3` (live application UNKNOWN) |
| 24 | Role assignment (make someone admin) | privesc | **no path** | — | — | — | ⚠️ **F6** — no route; manual DB edit only |
| 25 | Intake parse (`POST /api/intake`) | low | allow | allow | allow | SRV auth-only | text parse; acceptable |
| 26 | `/api/health` | none | public | public | public | none | safe (booleans + node version) |
| 27 | `/api/auth/demo-login` | dev | dev-only | dev-only | dev-only | `NODE_ENV!==production` 404 | ✅ demo-login:15 |

---

## 6. IDOR / BOLA analysis

- **`api_keys` by id** — `resolveVaultSecret` (`hermes/chat:88-107`), `resolveHermesBearerToken` (`hermes-proxy.ts:32-55`), `keys/test:48-54`: service-role read then `row.workspace_id === wid` check. **No cross-workspace key use.** ✅
- **`agent_seats` by id** — outreach/send:81-88 uses the session (RLS-scoped) client; OAuth callbacks verify `seatRow.workspace_id === wid` before service-role write. ✅
- **`email_connections` by `seat_id`** — outreach/send:138 reads via service-role, but only after the seat was confirmed in-workspace by the prior RLS-scoped select. ✅
- **`api_keys` delete by id** — `keys/route.ts:73` `.delete().eq("id", id)` on the session client; RLS `admins delete keys` confines it to the caller's workspace. ✅
- **`outreach_ledger`** — written only via `claim_and_record` (SECURITY DEFINER, `wid := current_workspace_id()`), no client DELETE policy → immutable audit trail. ✅
- **`workspace_state`** — single doc keyed by `workspace_id`; cross-tenant write blocked by `WITH CHECK` (`0005 §6`), **but intra-tenant role bypass remains (F1).**

**BOLA verdict: cross-workspace object access is well controlled in source.** The residual object-level issue is intra-tenant (F1), not cross-tenant. Live-DB application of these policies is **UNKNOWN — blocked on DB access**.

---

## 7. Tenant / workspace isolation

Strong in source (`0005_rls_tenant_isolation.sql`): (1) `revoke all ... from anon, public` on every table (§1) closes the Supabase "anon can read public tables" default; (2) explicit least-privilege grants for `authenticated` with column-level withholding of `api_keys.secret` and `email_connections.access_token/refresh_token` (§2); (3) RLS enabled on all 8 tables (§3); (4) `current_workspace_id()` / `current_profile_role()` are `SECURITY DEFINER` to avoid recursive RLS; (5) profile `workspace_id`+`role` immutable from client (§5). **Caveat:** these are migration files — there is **no evidence the migrations have been applied to a live database**, and no DB access was authorized to verify. Treat live tenant isolation as **UNKNOWN until proven** with a connected-DB negative test (see F8 / RISK_REGISTER Gate 5).

---

## 8. Findings

## [HIGH] F1 — Any workspace member (incl. viewer) can overwrite the entire `workspace_state` (intra-tenant role bypass)
- **Area:** RLS / data-layer authorization (OWASP A01, API1/API5).
- **Affected:** `supabase/migrations/0005_rls_tenant_isolation.sql:164-181` (`members read/insert/update state`); `supabase/migrations/0001_init.sql:80-85`; written by `src/lib/supabase/workspace.ts:63-76` (`saveRemoteState` upsert) from `src/lib/store.ts:388,412`.
- **Description:** Campaigns, candidate PII, outreach message bodies, guardrail/compliance settings (client mirror), persona/soul, skill toggles, provider/model/tool config mirrors, and `currentRole` are all stored in the single `workspace_state` JSONB document. Its INSERT/UPDATE RLS policies gate only on `workspace_id = current_workspace_id()` with **no `current_profile_role()` check**. The `authenticated` role also holds a table-level `grant select, insert, update on workspace_state` (`0005:58`).
- **Impact:** The role model ("viewer = read-only", "member ≠ settings/fleet") is unenforced for everything in JSONB. A `viewer` or `member` can, with their own anon JWT (no UI needed), overwrite campaigns and candidate records, alter outreach content, flip client-side guardrail/compliance settings, change persona, or wipe the whole shared document (last-write-wins via the 600 ms debounced upsert) — an integrity and availability hit to all workspace users. Authoritative send-time guardrails (`suppression_list`, `claim_and_record`, seat admin-RLS) are *separately* protected, which caps the worst-case, but candidate-PII integrity and the documented role boundaries are not.
- **Likelihood:** High once >1 role exists in a workspace. Trivially reproducible by any authenticated non-admin.
- **Reproduction:** As a `viewer` JWT: `supabase.from('workspace_state').update({ state: {…arbitrary…} }).eq('workspace_id', myWid)` → succeeds. (Cannot execute here — no DB access; derived from policy source.)
- **Evidence:** `0005:177-181` UPDATE policy has `using`/`with check` on `workspace_id` only; `0005:58` grant; `store.ts:307` default role `admin`.
- **Recommended fix:** Either (a) move all role-restricted state out of the shared JSONB into role-gated relational tables, or (b) split `workspace_state` into a read-all document plus role-gated sections and add a `current_profile_role()` predicate (or a `SECURITY DEFINER` write RPC that validates role + diffs allowed keys) to the write policy. At minimum, gate writes that touch settings/fleet/keys/role/persona keys behind `current_profile_role() in ('admin')` / member.
- **Tests to add:** Connected-DB negative test: `viewer` and `member` UPDATE of `workspace_state` is rejected for admin-only sections; concurrent-writer last-write-wins guard.
- **Status:** OPEN · **Owner:** Tony / backend · **Residual risk:** HIGH until JSONB write authz is role-aware.

## [HIGH] F2 — Aria proxy GET reads of sensitive paths are not role-gated (Broken Function-Level Authorization)
- **Area:** API route authorization (OWASP API5/A01).
- **Affected:** `src/app/api/hermes/proxy/route.ts:36-60`; allow-list `src/lib/api/hermes-proxy.ts:61-77`.
- **Description:** The admin gate (`isAdminMutation`) only fires for PUT/PATCH/DELETE and non-allow-listed POSTs. **All `GET` requests** to allow-listed paths require only authentication. Sensitive upstream paths — `api/config`, `api/memory`, `api/oauth/account`, `api/files`, `api/gateway`, `api/tools`, `api/models`, `api/schedules`, `api/curator`, `api/skills` — are therefore readable by **any authenticated user, including `viewer`**. The RBAC permissions `manage_tools`/`manage_models`/`manage_providers`/`manage_settings` are never consulted on reads.
- **Impact:** A read-only viewer can exfiltrate Aria runtime configuration, agent memory (which may contain candidate/operational data), connected OAuth account info (`api/oauth/account`), scheduled jobs, and file listings. Confidentiality + role-boundary breach. Severity is driven by `api/memory` and `api/oauth/account` content.
- **Likelihood:** High when Aria is configured (`HERMES_API_URL` set); any authenticated session.
- **Reproduction:** Authenticated `GET /api/hermes/proxy?upstreamPath=api/oauth/account` (or `api/memory`, `api/config`) as a viewer → 200 + body. (Requires a live Aria upstream; not executable here.)
- **Evidence:** `proxy/route.ts:52-54` (gate only on mutating methods); `hermes-proxy.ts:61-77` (allow-list contents).
- **Recommended fix:** Add a per-path read-permission map (e.g. `api/config`/`api/models`/`api/tools`→`manage_*`; `api/oauth/account`/`api/memory`→`manage_settings`) and enforce on GET as well; default-deny reads of admin paths for non-admins. Keep `api/status`/`api/health`/`api/system/stats` open.
- **Tests to add:** viewer/member GET of each sensitive path → 403; admin → allowed (mock upstream).
- **Status:** OPEN · **Owner:** Tony / backend · **Residual risk:** HIGH until read authz added.

## [HIGH] F3 — Fail-open demo mode disables all auth/authz and treats everyone as admin
- **Area:** Configuration / deploy-time authorization (OWASP A01, A05).
- **Affected:** `src/middleware.ts:13` (no-op when `!supabaseEnabled`); `src/lib/supabase/server.ts:21-23` (`requireAdmin` returns `{ok:true, role:"admin"}`); `supabaseEnabled` derives from `NEXT_PUBLIC_SUPABASE_*` presence.
- **Description:** When Supabase env vars are absent (or mistyped), the middleware gate is skipped, every API route's `supabaseEnabled` branch is bypassed, and `requireAdmin()` reports admin. The client `currentRole` already defaults to `admin` (`store.ts:307`). The result is full open access with admin privileges and all data in browser `localStorage`.
- **Impact:** A single missing/typo'd env var on a public deployment = complete authentication + authorization bypass on every page and route, including `/settings`, `/soul`, `/memory`, keys, and intake. This is the documented "demo mode" — fine locally, catastrophic if shipped to a reachable URL.
- **Likelihood:** Medium (config error / intentional demo deploy). Whether prod is correctly configured is **UNKNOWN — blocked on access** (no authorized way to read prod env).
- **Reproduction:** Unset `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` and start the app → all routes open, all actions treated as admin.
- **Evidence:** `middleware.ts:13`; `server.ts:21-23`; `store.ts:307`.
- **Recommended fix:** Add a startup assertion that **fails closed in production** (`NODE_ENV==='production'` ⇒ require `supabaseEnabled` and `SUPABASE_SERVICE_ROLE_KEY`, else refuse to boot / return 503). Add a deploy gate (smoke test) that asserts `/api/health` reports `supabaseConfigured: true` in prod. Document in DEPLOY_CHECKLIST.
- **Tests to add:** prod-mode boot without Supabase env → fails closed; `/api/health` assertion in CI/deploy.
- **Status:** OPEN (design fail-open) · prod actual = **UNKNOWN — blocked on access** · **Owner:** Tony / DevOps · **Residual risk:** CRITICAL if demo mode is ever publicly reachable; HIGH as a latent misconfig risk.

## [MEDIUM] F4 — `chat` LLM task has no permission gate; viewer can invoke the model and consume workspace API keys
- **Area:** API route authorization / cost abuse.
- **Affected:** `src/app/api/hermes/chat/route.ts:135-146` (`TASK_PERM` omits `chat`), `:88-107` (`resolveVaultSecret` is workspace-scoped, not role-scoped).
- **Description:** Only `outreach`/`sourcing`/`classify` map to a permission; `task=chat` passes with mere authentication. `resolveVaultSecret(keyId)` resolves any `api_keys` row in the caller's workspace regardless of role, so a `viewer` can submit `task=chat` with an `apiKeyId`/`provider` and have the server bill the workspace's stored cloud key.
- **Impact:** A read-only viewer can drive paid LLM usage on workspace-owned keys (financial/abuse), and reach the LLM despite "read-only".
- **Likelihood:** Medium.
- **Reproduction:** Viewer `POST /api/hermes/chat {task:"chat", provider:"anthropic", apiKeyId:"<workspace key id>", prompt:"…"}` → 200.
- **Evidence:** `chat/route.ts:137-142`; `:155-160`.
- **Recommended fix:** Require at least `view`+a `chat`/`source` permission for `task=chat`, or restrict `apiKeyId` usage to roles with `manage_keys`/`source`; rate-limit per role.
- **Tests to add:** viewer `task=chat` → 403; viewer `apiKeyId` use → denied.
- **Status:** OPEN · **Owner:** Tony / backend · **Residual risk:** MEDIUM (cost / least-privilege).

## [MEDIUM] F5 — Client-side RBAC is decorative and defaults to `admin`; not bound to the server profile role
- **Area:** Defense-in-depth / UI authorization.
- **Affected:** `src/lib/store.ts:307,2910` (`currentRole` defaults `"admin"`), `:2067` (`setCurrentRole`), `:3028` (`useRole`); all `can(useRole(), …)` panel gates (`api-keys-panel.tsx:19`, `fleet/page.tsx:85`, `roles-panel.tsx:22`, etc.).
- **Description:** The UI computes permissions from the client `currentRole`, which defaults to `admin`, is user-switchable, and is **shared** across the workspace via `workspace_state`. The client never reads `current_profile_role()`, so the UI role is unrelated to the authenticated user's real role.
- **Impact:** On its own this is only a defense-in-depth gap (the real routes/RLS re-check). Combined with F1 (writable `workspace_state`) it becomes the lever that lets a non-admin perform admin-looking actions whose effects land in the unprotected JSONB. Also causes confusing UX (a real viewer may see admin controls and hit 403s, or a real admin may be shown viewer UI).
- **Likelihood:** High (default state).
- **Evidence:** `store.ts:307`; absence of any client `current_profile_role()` call (grep: only `server.ts:31`).
- **Recommended fix:** On load, fetch `current_profile_role()` and bind `useRole()` to it (read-only, not user-editable); default unknown role to `viewer`, not `admin`; keep server/RLS as the real gate.
- **Tests to add:** UI role reflects server profile role; non-admin cannot flip to admin in live mode.
- **Status:** OPEN · **Owner:** Tony / frontend · **Residual risk:** MEDIUM.

## [MEDIUM] F6 — No admin bootstrap / no in-app role assignment; `manage_roles` is unimplemented
- **Area:** Authorization lifecycle / auditability.
- **Affected:** `supabase/migrations/0001_init.sql:89-127` (`ensure_workspace` inserts profiles with default `role='member'`); `src/lib/rbac.ts:22` (`manage_roles` exists but no route implements it).
- **Description:** Every new user is provisioned as `member` (the profile default; insert RLS pins role to `'member'`). There is no code path to promote anyone to `admin` and no UI/route that assigns roles. Role changes therefore require a manual service-role / SQL edit, with no in-app audit trail.
- **Impact:** Either (a) a fresh live deployment has **no admin**, making every admin-only operation (keys, fleet, OAuth, suppression, proxy mutations) unreachable, or (b) roles are granted out-of-band via raw DB access — privileged, unlogged, and unmonitored. Both are operational/governance gaps; (b) is a privilege-management risk.
- **Likelihood:** High (every deployment).
- **Evidence:** `0001:120-123` (profile insert defaults member); `0005:130-136` insert policy forces `role='member'`; no `profiles ... update role` route (grep).
- **Recommended fix:** Provide an admin-only role-assignment RPC/route (with `current_profile_role()='admin'` check) and an audit-logged first-admin bootstrap (e.g. first user of a domain, or an env-listed admin email seeded by `ensure_workspace`).
- **Tests to add:** admin can set another profile's role; member/viewer cannot; first-admin bootstrap path.
- **Status:** OPEN · **Owner:** Tony / backend · **Residual risk:** MEDIUM.

## [LOW] F7 — `/api/keys/test` value-path returns before any authentication check
- **Area:** API route authorization.
- **Affected:** `src/app/api/keys/test/route.ts:26-29`.
- **Description:** When a `value` is supplied, the route runs `validateApiKeyFormat` and returns before the `requireAdmin`/auth block. `/api/*` is excluded from middleware (`middleware.ts:67`), so this is an **unauthenticated** endpoint reachable by anyone on the internet.
- **Impact:** No data exposure (it only reports valid/invalid for a value the caller already holds), but it is an unauthenticated, unthrottled compute endpoint (minor abuse / regex-cost surface — note a separate ReDoS hardening test exists, `tests/security-redos.mts`).
- **Likelihood:** Low.
- **Evidence:** `keys/test/route.ts:25-29` precedes the auth block at `:43`.
- **Recommended fix:** Require an authenticated session before the value-path; add rate-limiting.
- **Tests to add:** unauthenticated `POST /api/keys/test {value}` → 401.
- **Status:** OPEN · **Owner:** Tony / backend · **Residual risk:** LOW.

## [MEDIUM] F8 — No negative authorization tests (role × action × object, BOLA, cross-tenant)
- **Area:** Test coverage (ASVS L3 for auth/multi-tenant).
- **Affected:** `tests/` — only `rbac-keys.mts` (pure `can()` table) and `hermes-proxy.mts` (path allow-list) touch authz; **none** exercise route-level role enforcement, RLS, `workspace_state` write authz, or cross-workspace BOLA.
- **Description:** The strongest claims in this review (RLS scoping, admin-only writes, BOLA mitigations) are **unverified against a running DB/app**. The gate matrix already notes "No authz-matrix tests per role/object" (`RELEASE_GATE_MATRIX.md:12`).
- **Impact:** Authorization regressions and unapplied migrations would pass CI undetected.
- **Evidence:** `tests/rbac-keys.mts` (23 assertions, all on `can()`); `tests/hermes-proxy.mts` (11 assertions, path-only); grep for `workspace_state`/`requireAdmin`/`403` in `tests/` → none.
- **Recommended fix:** Add an integration suite against a seeded local Supabase covering the matrix in §5 — especially rows 4, 7, 10, 20, 21, 22, 23 — as fail-closed negative tests.
- **Status:** OPEN · **Owner:** Tony / QA · **Residual risk:** MEDIUM.

---

## 9. Verified-good controls (evidence for PASS sub-areas)

- Admin-only mutating routes: `keys` POST/DELETE (`requireAdmin`), OAuth callbacks (`requireAdmin` + seat workspace guard, callbacks:52,94), proxy mutations (`can(role,manage_settings)`, proxy:57), outreach send (`can(role,outreach)`, send:73).
- Secrets never returned to client: `keys/route.ts:57` returns `{id,last4}`; `keys/test` returns `{valid,detail}`; `resolveVaultSecret`/`resolveHermesBearerToken` set the bearer server-side only.
- Column-level secret withholding: `api_keys.secret` and `email_connections.access_token/refresh_token` excluded from `authenticated` grants (`0003:26`, `0004:26`, `0005 §10-11`).
- Anti tenant-hop / anti self-escalation: `profiles` insert forces `workspace_id is null` + `role='member'`; update pins both via `is not distinct from` (`0005 §5`).
- `anon`/`PUBLIC` fully revoked (`0005 §1`).
- Immutable audit trail: `outreach_ledger` has no client DELETE policy (`0005 §9`).
- `can()` policy table correct: `tests/rbac-keys.mts` → 23/0 (2026-06-27). Proxy path allow-list: `tests/hermes-proxy.mts` → 11/0.

---

## 10. Negative tests required before Gate 4 can flip to PASS

1. `viewer`/`member` UPDATE `workspace_state` (admin-only sections) → rejected (F1).
2. `viewer`/`member` `GET /api/hermes/proxy?upstreamPath=api/{config,memory,oauth/account,models,tools}` → 403 (F2).
3. Prod-mode boot without Supabase env → fails closed; `/api/health.supabaseConfigured===true` asserted in deploy (F3).
4. `viewer` `POST /api/hermes/chat {task:"chat"}` and with `apiKeyId` → 403 (F4).
5. UI `useRole()` equals server `current_profile_role()`; non-admin cannot self-switch to admin (F5).
6. admin can assign roles; member/viewer cannot; first-admin bootstrap exists (F6).
7. unauthenticated `POST /api/keys/test {value}` → 401 (F7).
8. Cross-workspace: user A cannot read/update workspace B's `workspace_state`, `api_keys`, `agent_seats`, `outreach_ledger` (tenant isolation, live-DB).
9. BOLA: caller cannot resolve/use another workspace's `api_keys.id` via chat/proxy/keys-test.

---

## 11. Changes vs prior docs

- `RELEASE_GATE_MATRIX.md:12` marked Gate 4 **PARTIAL** with note "No authz-matrix tests per role/object; demo auth bypass." This review **supersedes** that to **FAIL**, adding the concrete intra-tenant `workspace_state` write bypass (F1) and the proxy GET read gap (F2) — both new, code-grounded HIGH findings not previously enumerated. The demo-bypass note is promoted to a structured HIGH (F3). Still-valid prior content (SSRF allow-list, secret handling in `SECURITY_REVIEW.md:36`, RLS hardening intent) is preserved and cross-referenced. No prior `AUTHORIZATION_MATRIX.md` existed; this is the new authoritative artifact for Gate 4.
