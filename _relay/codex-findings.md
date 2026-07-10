# Codex audit findings

Codex writes findings here as it audits the codebase. Claude Code triages
every `open` entry at the start of each session/loop iteration. See
`AGENTS.md` for the full protocol.

## Template

```markdown
## <date> — <short title>
**Severity:** correctness | security | spec-mismatch | test-gap
**File:** path:line
**Issue:** what's wrong, concretely — not "could be cleaner"
**Repro/evidence:** the input/state that breaks, or the spec line violated
**Suggested fix:** optional, one line
**Status:** open | fixed (commit hash) | wontfix (reason)
```

No findings logged yet.

## 2026-07-09 — Late inactive-sender opt-out was discarded
**Severity:** correctness
**File:** src/app/api/webhooks/whatsapp/route.ts
**Issue:** The webhook skipped every inbound message whenever a registered sender was paused or revoked, including signed STOP requests.
**Repro/evidence:** A candidate sends STOP after an operator pauses the sender. The prior status guard ran before the inbound row, contact opt-out, and phone suppression writes.
**Suggested fix:** Persist all known-sender inbound events; route only inactive-sender opt-outs through the deterministic processor and mark other late text non-recoverable.
**Status:** fixed (uncommitted, targeted tests and disposable database verification passed)

## 2026-07-09 — Receipt RPC false outcome was acknowledged as durable
**Severity:** correctness
**File:** src/app/api/webhooks/whatsapp/route.ts
**Issue:** The webhook used only the RPC transport error, so `{recorded:false, reason:'outbound-not-found'}` was acknowledged as if a delivery event had been persisted.
**Repro/evidence:** A provider receipt arriving before `record_whatsapp_provider_acceptance` commits cannot find `provider_message_id`; the old route returned 200 because the RPC itself succeeded.
**Suggested fix:** Classify explicit unknown receipts separately from a same-sender dispatching acceptance race and return 503 for the latter.
**Status:** fixed (uncommitted, migration 0015 and direct SQL outcome probe passed)

## 2026-07-09 — Approved WhatsApp review draft could become orphaned
**Severity:** correctness
**File:** src/lib/dispatch-outbound.ts
**Issue:** A previously approved WhatsApp candidate reply re-blocked by a later transient policy check retained `review_decision='approved'`, which the review RPC refuses to review again.
**Repro/evidence:** A queued approved reply hits a temporary missing-contact policy block, transitions to blocked, then fails the `review_decision is null` review eligibility check.
**Suggested fix:** Reset only approved candidate-reply review metadata whenever dispatcher policy returns it to blocked.
**Status:** fixed (uncommitted, dispatcher regression test passed)

## 2026-07-09 — Inbound recovery could starve mapped messages
**Severity:** correctness
**File:** src/lib/whatsapp-inbound.ts
**Issue:** Recovery applied its limit before excluding rows with no WhatsApp sender mapping, allowing unmapped rows to consume the bounded batch.
**Repro/evidence:** A workspace with enough legacy unmapped inbound rows could repeatedly skip its limit and never reach recoverable rows.
**Suggested fix:** Filter `whatsapp_sender_id IS NOT NULL` in the query before the limit.
**Status:** fixed (uncommitted, regression test passed)

## 2026-07-09 — Any generated-draft duplicate was treated as idempotent
**Severity:** correctness
**File:** src/lib/whatsapp-inbound.ts
**Issue:** A `23505` on review-draft insert was treated as success without proving the existing row belonged to the same inbound event.
**Repro/evidence:** Two messages yielding the same dedupe hash could mark the second inbound processed without a visible review draft.
**Suggested fix:** Accept idempotency only for a matching `inbound_message_id`; retain all other collisions as durable triage.
**Status:** fixed (uncommitted, regression test and SQL triage-retention probe passed)

## 2026-07-09 — Public demo admin can reach live side effects
**Severity:** security
**File:** src/app/api/outreach/send/route.ts:96
**Issue:** A production deployment with Supabase and `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` lets any visitor use `admin` / `admin`, receive the seeded admin session, approve content, and request real delivery when a live seat and provider credentials exist.
**Repro/evidence:** `src/app/api/auth/demo-login/route.ts:27-40,63-92` creates the real Supabase session. The send route checks Supabase, role, approval, seat, and `confirmLive`, but never rejects public-demo mode. This conflicts with `src/lib/supabase/config.ts:75-89`, which defines the public demo as synthetic.
**Suggested fix:** Add one server-side public-demo side-effect guard and apply it before approval, claims, calendar changes, mailbox changes, and every provider call.
**Status:** fixed (6e5c1d3)

## 2026-07-09 — Live UI role comes from shared mutable JSON
**Severity:** security
**File:** src/lib/store.ts:6607
**Issue:** Live UI permission checks use `workspace_state.currentRole`, seeded as `admin`, instead of the signed-in user's `profiles.role`.
**Repro/evidence:** `src/lib/seed.ts:940` seeds admin; `src/lib/supabase/workspace.ts:23-79` never loads the profile role; `src/components/settings/roles-panel.tsx:18-33` lets the shared value drive and change the visible role.
**Suggested fix:** Load `current_profile_role()` with the session, override or remove shared role state in live mode, and keep role preview switching demo-only.
**Status:** fixed (5c4121f)

## 2026-07-09 — Manual fleet suppression is not enforced server-side
**Severity:** security
**File:** src/components/fleet/suppression-panel.tsx:54
**Issue:** The suppression panel writes only the client workspace document and immediately promises the contact will never be reached. Live send policy reads the normalized `suppression_list` table instead.
**Repro/evidence:** `src/lib/store.ts:4509-4540` performs only a local commit. Candidate-level suppression has a separate server sync path, proving the manual global path is missing it.
**Suggested fix:** Await `/api/compliance/suppress` for add and remove, cover every supported type, and update live UI state only after server confirmation.
**Status:** fixed (438c6f7)

## 2026-07-09 — Losing dispatcher can overwrite a winning WhatsApp send
**Severity:** correctness
**File:** src/lib/dispatch-outbound.ts:74
**Issue:** Two workers may both select one queued row. The loser receives a not-queued claim result and calls `finish("blocked")` without a compare-and-set condition, which can overwrite the winner's `dispatching` or `sent` state.
**Repro/evidence:** Selection is outside the atomic claim at lines 74-88. All failure paths update by ID only at lines 90-108. Acceptance reconciliation requires `dispatching`, so an accepted Meta request can become unreconcilable after the overwrite.
**Suggested fix:** Make losing claims no-op and guard every final transition with worker attempt ID plus expected status.
**Status:** fixed (93b5de9)

## 2026-07-09 — Paid ElevenLabs proxy is anonymous
**Severity:** security
**File:** src/app/api/voice/tts/route.ts:38
**Issue:** Any caller can spend the server's ElevenLabs quota. API routes are excluded from the route proxy, and this handler has no Supabase or signed-demo-session check.
**Repro/evidence:** The route reads `ELEVENLABS_API_KEY` and calls ElevenLabs after only an in-memory per-IP limiter.
**Suggested fix:** Authenticate before reading or using the key, then rate-limit by principal and IP.
**Status:** fixed (6d029d4)

## 2026-07-09 — Stored AgentSpec does not control a run
**Severity:** spec-mismatch
**File:** src/app/api/agents/run/route.ts:32
**Issue:** Live runs accept an optional `specId` but build the graph from caller-supplied campaign JSON. Stored role brief, channels, ownership, status, and guardrails are not loaded or enforced.
**Repro/evidence:** `specId` is only inserted at line 121. Migration `0007_agent_runtime.sql` makes `agent_runs.spec_id` non-null, so omitting it silently prevents persistence while the route still returns a successful stateless result.
**Suggested fix:** Require and authorize a stored spec in live mode, build graph state from it, and fail or pause when persistence fails.
**Status:** open

## 2026-07-09 — Agent ownership is workspace-wide, not per-user
**Severity:** spec-mismatch
**File:** supabase/migrations/0007_agent_runtime.sql:152
**Issue:** Regular workspace users can select and update every AgentSpec and run because policies check only workspace, not `owner_id`. This fails the two-user per-session isolation criterion.
**Repro/evidence:** AgentSpec select and update policies at lines 153-166 contain no owner or admin predicate. API GET and PATCH also omit owner filters.
**Suggested fix:** Add owner-or-admin RLS and API filters, then negative tests for two users in one workspace and two workspaces.
**Status:** open

## 2026-07-09 — Live backend failure silently becomes demo state
**Severity:** correctness
**File:** src/lib/supabase/workspace.ts:56
**Issue:** RPC, read, and network failures return an empty workspace marker. Hydration then seeds synthetic demo data, presenting a failed live backend as an operational workspace whose changes do not persist.
**Repro/evidence:** Error branches return `workspaceId: "", state: null`; `src/lib/store.ts:894-916` uses the same shape to build seed state.
**Suggested fix:** Model live load as loaded, empty, failed, or conflict and show a blocking degraded state on failure.
**Status:** open

## 2026-07-09 — UI seats cannot become live normalized seats
**Severity:** spec-mismatch
**File:** src/lib/store.ts:4274
**Issue:** Fleet seat create and mode changes live only in `workspace_state`, while OAuth, domain verification, AgentSpec, and send routes use normalized `agent_seats` rows.
**Repro/evidence:** No client or API path inserts the normalized row when the UI creates a seat. A UI-created live seat therefore cannot satisfy the send route lookup.
**Suggested fix:** Make a role-checked server API and normalized table authoritative in live mode; keep local seats demo-only.
**Status:** open

## 2026-07-09 — Restore drill can pass after restore failure
**Severity:** correctness
**File:** scripts/restore-drill.sh:24
**Issue:** Both schema and data restore errors are swallowed with `|| true`, then the drill passes when only one public table exists.
**Repro/evidence:** Lines 24-25 ignore restore exit codes; lines 35-38 require only `TABLES >= 1` even though the current application needs many named tables and RLS policies.
**Suggested fix:** Fail on every restore error and verify named tables, RLS, migrations, and selected row counts or checksums.
**Status:** open

## 2026-07-09 — Exact-SHA CI is blocked by GitHub Actions budget
**Severity:** test-gap
**File:** .github/workflows/ci.yml:11
**Issue:** CI and CodeQL are red for `14f76f1`, but no job step ran. GitHub rejected each job because the account Actions budget prevents further use.
**Repro/evidence:** Runs `29054140149`, `29053699008`, `29054140078`, and `29053699053` ended in about three seconds with the budget annotation.
**Suggested fix:** Restore Actions budget, align CI to Node 22, rerun the exact SHA, and require the checks in branch protection.
**Status:** open

## 2026-07-09 — Production is behind the reviewed source
**Severity:** spec-mismatch
**File:** _relay/HANDOFF.md:31
**Issue:** The public production URL is not running `14f76f1`. Current source has a cron route that returns 401 without its secret and a public unsubscribe route; production returns 404 for cron and redirects unsubscribe to login.
**Repro/evidence:** GitHub deployments list the latest production deployment at SHA `9db39bec...` from 2026-07-03. Vercel success on PR #1 is preview evidence only.
**Suggested fix:** Complete release gates, promote the exact approved SHA, expose a safe build identifier, and run post-deploy smoke tests.
**Status:** open

## 2026-07-09 — ElevenLabs key requires rotation
**Severity:** security
**File:** .env.local
**Issue:** The live `ELEVENLABS_API_KEY` appeared in an internal agent tool result during this audit. It is gitignored, but should be treated as compromised.
**Repro/evidence:** The incident was observed in the current session. No part of the key is reproduced in this finding.
**Suggested fix:** Revoke it, issue a least-privilege replacement, update local and deployment secrets, and record only rotation metadata.
**Status:** open

## 2026-07-09 — Aria runtime proxy shares global memory across tenants
**Severity:** security
**File:** src/app/api/hermes/proxy/route.ts:48
**Issue:** Every workspace and user is forwarded to one `HERMES_API_URL` with one bearer token and no tenant or user namespace. Authenticated viewers may read global runtime memory, files, sessions, and other allow-listed state.
**Repro/evidence:** The route authenticates the caller but forwards no workspace or user identity. `src/lib/api/hermes-proxy.ts:31-76` resolves one global runtime and credential.
**Suggested fix:** Give each workspace an isolated runtime namespace and credential, pass a server-issued user/session identifier, and admin-gate sensitive reads.
**Status:** fixed (7a817ca; contained single-workspace mode)

## 2026-07-09 — Page email allow-list does not protect APIs
**Severity:** security
**File:** src/proxy.ts:116
**Issue:** The email-domain allow-list runs only in page middleware. `/api/*` is excluded, so an off-domain Supabase session can call authenticated cost-bearing APIs directly.
**Repro/evidence:** `src/proxy.ts:96-104` performs the domain check, while its matcher excludes API paths. Representative API handlers check user and role but not allowed domain.
**Suggested fix:** Centralize authenticated API principal resolution with the same domain policy and use it on every protected route.
**Status:** fixed (9c4b32f)

## 2026-07-09 — DNS allow-list and fetch resolve the host separately
**Severity:** security
**File:** src/lib/api/url.ts:132
**Issue:** URL validation resolves a hostname once, then the later `fetch()` resolves it again. An attacker-controlled DNS name can return a public address for validation and an internal address for the actual request.
**Repro/evidence:** `src/lib/ai/web-tools.ts:135-157` fetches by the original hostname after `assertPublicUrl()` completes. The same shape exists in the MCP client.
**Suggested fix:** Use a controlled outbound proxy or a dispatcher that pins the validated address while preserving TLS hostname validation and redirect denial.
**Status:** open

## 2026-07-09 — Email provider ambiguity releases the duplicate guard
**Severity:** correctness
**File:** src/app/api/outreach/send/route.ts:359
**Issue:** If a provider accepts an email and the response then times out or disconnects, the catch path marks the ledger skipped. The partial unique claim becomes retryable and the same approved message can be sent again.
**Repro/evidence:** Gmail, Graph, and provider helpers do not distinguish proven pre-send failure from unknown post-acceptance failure. Migration `0013` makes skipped rows retryable.
**Suggested fix:** Persist an immutable request identity and use a non-retryable reconciliation state for ambiguous outcomes.
**Status:** open

## 2026-07-09 — Email daily cap count is not serialized
**Severity:** correctness
**File:** supabase/migrations/0002_fleet.sql:119
**Issue:** `claim_and_record()` counts current sends and inserts without locking the seat or a per-seat daily counter. Two different candidates can concurrently pass at cap minus one.
**Repro/evidence:** The function reads and counts in separate statements under normal transaction isolation with no shared lock.
**Suggested fix:** Lock the seat or use a transactional daily counter before count and reservation; test two simultaneous claims at cap minus one.
**Status:** open
