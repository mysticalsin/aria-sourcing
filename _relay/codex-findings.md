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

Historical and current findings follow. The current consolidated audit is
`_relay/2026-07-11-enterprise-audit.md`.

## 2026-07-14 — Booking and report actions returned false success
**Severity:** correctness
**File:** src/lib/store.ts:2957
**Issue:** Booking creation, status updates, and report generation reported success after `commit()` rejection; learning acceptance used two independent commits and callers always toasted success.
**Repro/evidence:** A blocked workspace or rejected commit still emitted a booking event or returned a generated report. An unknown status-only booking update returned `{ok:true}` and an unknown learning ID created activity.
**Suggested fix:** Propagate commit results, validate booking patches, keep candidate booking snapshots aligned, and apply a learning decision atomically.
**Status:** fixed (11ef0db)

## 2026-07-14 — Live calendar creation has no durable booking authority
**Severity:** security
**File:** src/app/api/calendar/event/route.ts:20
**Issue:** An authenticated member with `book` can submit arbitrary attendee and invite content, while the client calls the provider before any durable booking command, idempotency claim, or reconciliation receipt exists.
**Repro/evidence:** The route accepts client-owned name, email, role, times, agenda, and `confirmLive`; `createBookingFor` discards `eventId`, then relies on a debounced workspace save. Timeout, conflict, suppression, or retry can orphan or duplicate a provider event.
**Suggested fix:** Add server-owned prepare/confirm/claim/reconcile authority, content-bound idempotency, provider delivery states, reschedule/cancel synchronization, and erasure obligations. Keep live calendar effects fail closed until it exists.
**Status:** fixed (99419a1; migration 0034 adds calendar_booking_ledger + claim_calendar_booking/reconcile_calendar_booking SECURITY DEFINER RPCs with a double-book partial unique index and request-id idempotency; the route claims before the provider call, replay never re-invokes the provider, and reconcile leaves 'claimed' on unknown outcomes for human review; tests/calendar-booking-authority.mts 58/58)

## 2026-07-14 — Generated reports contain unverified fixed intelligence
**Severity:** spec-mismatch
**File:** src/lib/mock-ai.ts:1191
**Issue:** Weekly reports present fixed cost, best-day/time, winning-pattern, and projected-impact claims as measured campaign intelligence.
**Repro/evidence:** `generateWeeklyReport` returns `costPerHire: 4200`, fixed Tuesday/time claims, a fixed 2.1x pattern, and the same three proposals without evidence provenance.
**Suggested fix:** Return `null` or explicitly unavailable facts unless derived from campaign evidence, and bind each learned proposal to reviewed aggregate receipts.
**Status:** fixed (e694837; src/lib/mock-ai.ts labels the WeeklyReport cost-per-hire, best-day/time, winning-pattern, and projected-impact figures via `illustrativeFields` so exports/UI never present them as measured campaign intelligence)

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
**Status:** fixed (01721dc; live runs require the exact active owner-bound spec, validate its executable role/policy before receipt or egress, persist the truthful run-history/no-delivery policy snapshot, recheck active status before every step, and pass independent QA plus the full local gate)

## 2026-07-09 — Agent ownership is workspace-wide, not per-user
**Severity:** spec-mismatch
**File:** supabase/migrations/0007_agent_runtime.sql:152
**Issue:** Regular workspace users can select and update every AgentSpec and run because policies check only workspace, not `owner_id`. This fails the two-user per-session isolation criterion.
**Repro/evidence:** AgentSpec select and update policies at lines 153-166 contain no owner or admin predicate. API GET and PATCH also omit owner filters.
**Suggested fix:** Add owner-or-admin RLS and API filters, then negative tests for two users in one workspace and two workspaces.
**Status:** fixed (a469aee, 01721dc; migration 0025 enforces owner-or-admin metadata access and immutable authority while execution requires exact owner; disposable PostgreSQL agent-memory isolation and application authority suites pass)

## 2026-07-09 — Live backend failure silently becomes demo state
**Severity:** correctness
**File:** src/lib/supabase/workspace.ts:56
**Issue:** RPC, read, and network failures return an empty workspace marker. Hydration then seeds synthetic demo data, presenting a failed live backend as an operational workspace whose changes do not persist.
**Repro/evidence:** Error branches return `workspaceId: "", state: null`; `src/lib/store.ts:894-916` uses the same shape to build seed state.
**Suggested fix:** Model live load as loaded, empty, failed, or conflict and show a blocking degraded state on failure.
**Status:** fixed (bb719a7, ae571d9, 9023a63; live workspace failures block the application shell and effectful actions, preserve retryable unsaved state, and pass workspace availability/runtime/status/application-shell suites)

## 2026-07-09 — UI seats cannot become live normalized seats
**Severity:** spec-mismatch
**File:** src/lib/store.ts:4274
**Issue:** Fleet seat create and mode changes live only in `workspace_state`, while OAuth, domain verification, AgentSpec, and send routes use normalized `agent_seats` rows.
**Repro/evidence:** No client or API path inserts the normalized row when the UI creates a seat. A UI-created live seat therefore cannot satisfy the send route lookup.
**Suggested fix:** Make a role-checked server API and normalized table authoritative in live mode; keep local seats demo-only.
**Status:** fixed (79dfe7b; normalized server-side seat APIs are authoritative in live mode and `fleet-seats-server` passes 18/18)

## 2026-07-09 — Restore drill can pass after restore failure
**Severity:** correctness
**File:** scripts/restore-drill.sh:24
**Issue:** Both schema and data restore errors are swallowed with `|| true`, then the drill passes when only one public table exists.
**Repro/evidence:** Lines 24-25 ignore restore exit codes; lines 35-38 require only `TABLES >= 1` even though the current application needs many named tables and RLS policies.
**Suggested fix:** Fail on every restore error and verify named tables, RLS, migrations, and selected row counts or checksums.
**Status:** fixed (9ed2dec; contract 49/49, fresh target-environment restore still required)

## 2026-07-09 — Exact-SHA CI is blocked by GitHub Actions budget
**Severity:** test-gap
**File:** .github/workflows/ci.yml:11
**Issue:** CI and CodeQL are red for `14f76f1`, but no job step ran. GitHub rejected each job because the account Actions budget prevents further use.
**Repro/evidence:** Runs `29054140149`, `29053699008`, `29054140078`, and `29053699053` ended in about three seconds with the budget annotation.
**Suggested fix:** Restore Actions budget, align CI to Node 22, rerun the exact SHA, and require the checks in branch protection.
**Status:** wontfix (obsolete diagnosis; Actions now run, replacement exact-SHA CI finding below)

## 2026-07-09 — Production is behind the reviewed source
**Severity:** spec-mismatch
**File:** _relay/HANDOFF.md:31
**Issue:** The public production URL is not running `14f76f1`. Current source has a cron route that returns 401 without its secret and a public unsubscribe route; production returns 404 for cron and redirects unsubscribe to login.
**Repro/evidence:** GitHub deployments list the latest production deployment at SHA `9db39bec...` from 2026-07-03. Vercel success on PR #1 is preview evidence only.
**Suggested fix:** Complete release gates, promote the exact approved SHA, expose a safe build identifier, and run post-deploy smoke tests.
**Status:** wontfix (obsolete diagnosis; Fly deployed the audited SHA, but the data plane is down and release identity remains open below)

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
**Status:** fixed (uncommitted; the Node transport pins one validated public address while preserving Host/SNI, disables pooling and redirects, and passes deterministic DNS-rebinding/TLS tests; independent security review accepted the exact tree)

## 2026-07-09 — Email provider ambiguity releases the duplicate guard
**Severity:** correctness
**File:** src/app/api/outreach/send/route.ts:359
**Issue:** If a provider accepts an email and the response then times out or disconnects, the catch path marks the ledger skipped. The partial unique claim becomes retryable and the same approved message can be sent again.
**Repro/evidence:** Gmail, Graph, and provider helpers do not distinguish proven pre-send failure from unknown post-acceptance failure. Migration `0013` makes skipped rows retryable.
**Suggested fix:** Persist an immutable request identity and use a non-retryable reconciliation state for ambiguous outcomes.
**Status:** fixed (aa60671; migration 0022 adds send_attempt_id + non-retryable 'ambiguous' status with rebuilt de-dupe indexes; adapters classify pre-transport vs unknown outcomes; unknown reconciles ambiguous + 502 reconciliation-required; tests/email-send-ambiguity.mts 54/54)

## 2026-07-09 — Email daily cap count is not serialized
**Severity:** correctness
**File:** supabase/migrations/0002_fleet.sql:119
**Issue:** `claim_and_record()` counts current sends and inserts without locking the seat or a per-seat daily counter. Two different candidates can concurrently pass at cap minus one.
**Repro/evidence:** The function reads and counts in separate statements under normal transaction isolation with no shared lock.
**Suggested fix:** Lock the seat or use a transactional daily counter before count and reservation; test two simultaneous claims at cap minus one.
**Status:** fixed (d29cd40; migration 0021 create-or-replaces claim_and_record with a workspace-scoped SELECT ... FOR UPDATE on agent_seats before the cap count; 0019 search_path and service_role-only ACL preserved; tests/claim-serialization.mts 14/14; live-PG proof via scripts/test-db-privileges.sh in CI)

## 2026-07-11 - Production data plane is down while deploy is green
**Severity:** correctness
**File:** deploy-fly.sh; fly.db.toml; live Fly applications
**Issue:** The audited Fly release serves the app shell, but the sole database machine and both authentication machines are stopped. Auth, REST, and careers requests return 503. The local replacement now fails closed, but it has not recovered or revalidated production.
**Repro/evidence:** Fly machine inventory for exact SHA `05cda612` shows database stopped and GoTrue stopped. In deploy run `29139277754`, the database machine reached `stopped`, Fly classified that state as good because no service health check existed, and the script printed `OK deploy db`. It then logged REST 503 and six Auth 503 probes, continued to migrations, and succeeded because app `/api/health` returned 200.
**Suggested fix:** Diagnose the machine exit-code-1 root cause, require running-state plus dependency readiness, and make every failed retry or probe fail the deploy.
**Status:** open (local false-green release path is repaired and public `/api/ready` now reports database/auth/queue true on build `d2040b...`; exact Machine restart, restore, and sustained-stability evidence remain unproven)

## 2026-07-11 - Deploy can publish a red exact SHA
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml:6
**Issue:** The deployed workflow triggered directly from a branch push and was independent of CI, CodeQL, dependency audit, and secret scan. The local replacement is manual, serialized, exact-SHA gated, action-pinned, and protected-environment scoped, but it is not dispatchable until its definition exists on the default branch.
**Repro/evidence:** Exact-SHA CI runs `29139277737` and `29139278802` failed the dependency audit, while deploy run `29139277754` succeeded for the same SHA. The workflow is now `disabled_manually`; Production has a reviewer plus a custom deploy-branch policy. GitHub reports default branch `vercel-demo`, where `.github/workflows/deploy-aria-mantu.yml` is absent. The deploy branch remains unprotected, administrators can bypass, and the replacement source has not run in GitHub.
**Suggested fix:** Use one protected, serialized release workflow gated by all checks for the same SHA.
**Status:** open (local workflow and release contracts pass; merge to the default branch, branch protection, replacement secrets, and exact-SHA GitHub proof are pending)

## 2026-07-11 - Member-controlled Databricks origin can receive a stored secret
**Severity:** security
**File:** src/app/api/integrations/databricks/needs/route.ts:47
**Issue:** A regular member can update the shared workspace JSON that supplies the Databricks host and secret ID, then invoke a route that resolves the server-held secret and forwards it to that host.
**Repro/evidence:** `0005_rls_tenant_isolation.sql:184-208` permits member writes to the full document. The needs route loads `settings.databricks`; `src/lib/integrations/databricks.ts:91-100,133-151` sends Basic credentials or a PAT Bearer token to the configured host.
**Suggested fix:** Move integration origins and secret bindings to normalized admin-only records and bind every secret to one approved origin and purpose.
**Status:** fixed in source (uncommitted; normalized admin-only connection authority, deployment-owned origin policy, composite key binding, legacy-state stripping, audit trail, and application tests pass; real PostgreSQL and restored-clone execution remain unproven)

## 2026-07-11 - SSRF guard allows hexadecimal IPv4-mapped IPv6 literals
**Severity:** security
**File:** src/lib/api/url.ts:80
**Issue:** The private-IP parser handles only dotted `::ffff:a.b.c.d`, but Node URL canonicalizes mapped literals to hexadecimal IPv6. Private and metadata addresses are classified as public.
**Repro/evidence:** At the audited SHA, `http://[::ffff:127.0.0.1]/`, mapped `10.0.0.1`, and mapped `169.254.169.254` all passed `assertPublicUrl()` after URL canonicalization.
**Suggested fix:** Use a standards-complete address parser and a fetch path that pins the validated connection address; add mapped-literal and DNS-rebinding tests.
**Status:** fixed (uncommitted; mapped, reserved, link-local, metadata, NAT64, non-global IPv6, redirect, and DNS-rebinding cases pass the focused suites and independent security review)

## 2026-07-11 - Service-only claim RPC does not revoke PUBLIC execute
**Severity:** security
**File:** supabase/migrations/0011_outreach_approval_lifecycle.sql:224
**Issue:** The migration revokes `claim_and_record()` from `authenticated` and grants `service_role`, but it does not remove PostgreSQL's default function EXECUTE privilege from PUBLIC.
**Repro/evidence:** No later migration revokes the function from PUBLIC or asserts the caller role. Production ACL could not be queried because the database is down.
**Suggested fix:** Revoke from PUBLIC, anon, and authenticated, add a caller-role assertion, and test final privileges after every migration.
**Status:** fixed in source (uncommitted; migration 0019 resets current and future API-role privileges, explicitly allowlists routines, and static contracts pass; disposable PostgreSQL execution remains blocked by unavailable Docker registry/backend access)

## 2026-07-11 - Inbound replies have no agent conversation identity
**Severity:** correctness
**File:** supabase/migrations/0007_agent_runtime.sql:114
**Issue:** Inbound messages have no AgentSpec, run, conversation, sender, or provider-thread foreign key. WhatsApp assigns a reply to the latest outbound address, and email matching falls back to sender address and active campaign.
**Repro/evidence:** `src/lib/whatsapp-inbound.ts:179-196` selects the latest outbound row by workspace and phone. `src/lib/store.ts:2777-2793` matches email by sender and campaign, even though provider thread IDs are fetched.
**Suggested fix:** Add canonical agent-owned conversations and provider reply/thread binding; ambiguous matches must enter triage.
**Status:** fixed (318f552; migration 0023 adds agent_conversations + conversation_id FKs and service-only resolve_whatsapp_inbound_conversation RPC; whatsapp-inbound drops latest-outbound matching and fails closed to triage on no/ambiguous conversation; email auto-match resolves provider thread first and never falls back to active campaign; tests/inbound-conversation-identity.mts 30/30)

## 2026-07-11 - Agent memory is shared seat state and unused by runs
**Severity:** spec-mismatch
**File:** src/lib/types.ts:1254
**Issue:** Memory and chat records are keyed by `seatId` in the shared workspace document, not by AgentSpec and owner. The live run route does not load them.
**Repro/evidence:** Multiple AgentSpecs may share a seat; every member can update `workspace_state`; `src/app/api/agents/run/route.ts` builds state only from caller campaign data.
**Suggested fix:** Normalize memory by workspace, owner, and agent with provenance and retention; load only authorized bounded context in the run service.
**Status:** fixed in local integration (166e752, a469aee, 8312111; post-merge proof on 2026-07-12: `npm run test:security`, `npm test`, and `npm run test:db-agent-memory` passed with `authority=pass isolation=pass quarantine=hash-only receipts=content-free concurrency=pass idempotence=pass`; live deployment pending)

## 2026-07-11 - Autopilot contract and implementation disagree
**Severity:** spec-mismatch
**File:** src/lib/autopilot.ts:211
**Issue:** The active goal requires a guarded in-policy auto-answer, while the implementation type and function can only return `action: "queue"`. Nearby comments still describe a send outcome.
**Repro/evidence:** `decideAutopilot()` unconditionally returns queue with `human-review-required` at lines 223-241.
**Suggested fix:** Keep human review as the declared default; either implement the narrow, kill-switched canary path and acceptance test or amend the goal and every product claim.
**Status:** fixed in local integration (218f6cb, 0f011c6; release contract is queue-only reply drafting with named human approval, not autonomous send; post-merge proof on 2026-07-12: `npm run test:security`, `npm test`, and `tests/autopilot-contract.mts` inside both chains passed)

## 2026-07-11 - Live backend failure is presented as empty or synthetic UI
**Severity:** correctness
**File:** src/lib/supabase/workspace.ts:66
**Issue:** Workspace read errors return a truthy empty marker that seeds demo state, while Chat and Studio turn non-2xx loads into ordinary empty states.
**Repro/evidence:** Live careers is already 503 while the public page initially displays ONLINE. Equivalent failures can display `No sessions` or `No agents yet` instead of degraded state.
**Suggested fix:** Model loading, empty, ready, degraded, conflict, and forbidden separately and add browser failure tests.
**Status:** fixed in local integration (bb719a7, 76b4683, ae571d9, 9023a63; post-merge proof on 2026-07-12: `npm test` passed through `workspace-availability`, `workspace-runtime-safety`, `workspace-effectful-actions`, `workspace-status`, `app-shell-workspace-gate`, `fail-closed`, `chat`, `aria-live`, and `careers-public`; live browser acceptance after deploy pending)

## 2026-07-11 - Dependency audit blocks CI after deployment has already remained available
**Severity:** security
**File:** package-lock.json
**Issue:** The audited SHA had one high and three moderate dependency advisories, including an IPv4-mapped IPv6 rate-limit bypass in a transitive dependency.
**Repro/evidence:** The local repair removes `@dust-tt/client`, replaces it with a schema-validated REST client with bounded time, streaming response bytes, and cancellation, and moves audit and secret scan into independent CI jobs with an aggregate gate. `npm audit --audit-level=high` now exits 0; two moderate PostCSS advisories remain inside Next.js and have no non-breaking published fix in the installed stable line.
**Suggested fix:** Upgrade or replace the dependency chain, run security gates independently, and block deploy on their aggregate result.
**Status:** fixed (uncommitted; local high/critical audit gate, Dust 32/32, full tests, lint, typecheck, and isolated build pass; exact-SHA GitHub proof pending)

## 2026-07-11 - Remote third-party MCP tools can cross the production tool boundary
**Severity:** security
**File:** src/lib/mcp-client.ts; src/lib/ai/tool-loop.ts; src/app/api/hermes/chat/route.ts
**Issue:** Environment-enabled remote MCP discovery and execution could expose third-party tool definitions to production model loops and run an administrator-configured remote tool without a production-specific deny boundary.
**Repro/evidence:** The prior policy relied on an enable flag rather than an explicit production denial at route, loop, and client layers.
**Suggested fix:** Make production denial unconditional, require an exact nonproduction environment plus explicit opt-in, and bound discovery, definitions, calls, results, and time.
**Status:** fixed (uncommitted; production/default-off route and low-level environment probes, model-loop filtering, result-envelope injection tests, port policy, and encoded-secret containment passed independent review)

## 2026-07-11 - Supabase default privileges can regrant future public objects
**Severity:** security
**File:** supabase/migrations/0019_agent_authority_and_integrations.sql
**Issue:** Revoking current table and routine privileges is not durable when the Supabase initializer retains default API-role grants for objects later created by the migration owner or `supabase_admin`.
**Repro/evidence:** The official Supabase Postgres initializer defines default grants. A later table, sequence, or function could therefore regain API-role access without appearing in the current-object allowlist.
**Suggested fix:** Reset default privileges for both owners and test newly created probe objects against every API role.
**Status:** fixed in source (uncommitted; current and future table, sequence, function, schema, and PG17 MAINTAIN checks are in the disposable database matrix; live PostgreSQL execution remains pending)

## 2026-07-11 - Image scan was not bound to the deployed application artifact
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml; deploy-fly.sh
**Issue:** CI scanned a locally built application image while Fly rebuilt the application during deployment, so a green scan did not prove the deployed image was the scanned artifact. Failure paths also skipped release evidence upload.
**Repro/evidence:** The earlier workflow generated CI supply-chain evidence, then invoked a source build in Fly. Its artifact step ran only after every prior step succeeded.
**Suggested fix:** Build once with production inputs, scan the saved image, publish the same image, deploy its immutable digest, verify the running digest, and archive partial evidence on every outcome.
**Status:** fixed in source (uncommitted; release-chain validator accepted YAML, actionlint, 83/83 infrastructure, 34/34 deploy, 17/17 bootstrap, failure inventory, and digest binding; online registry and Fly execution remain unproven)

## 2026-07-11 - Repository includes machine binaries and raw agent logs
**Severity:** spec-mismatch
**File:** .localbin/supabase
**Issue:** The tracked tree is about 227 MB and includes about 155 MB of macOS arm64 Supabase executables plus 198 `.rocket-fuel` files and large event logs.
**Repro/evidence:** `git ls-files` reports 920 files; `.localbin`, `.rocket-fuel`, and screenshot archives account for most non-product size.
**Suggested fix:** Define retention first, replace binaries with checksum-pinned setup, move raw logs/screenshots to release artifacts, and avoid history rewrite without explicit approval.
**Status:** fixed in local integration (69ee81a; tracked `.localbin` binaries and `.rocket-fuel` machine artifacts removed from release tip, ignore rules added, and `tests/repository-hygiene.mts` is wired into `npm test`; no history rewrite attempted)

## 2026-07-11 - Fly deployment credential exposed in internal tool output
**Severity:** security
**File:** production-readiness/.fly-token.env
**Issue:** A diagnostic emitted part of the current Fly deployment credential into an internal tool result while trying to classify the ignored file format.
**Repro/evidence:** Incident record `_relay/incidents/2026-07-11-fly-deploy-token-exposure.md`; the credential is intentionally not reproduced.
**Suggested fix:** Replace with a short-lived least-privilege token, update GitHub deployment secrets, revoke the exposed token, review Fly activity, and ban content-derived secret-file diagnostics.
**Status:** open

## 2026-07-11 - Fly volume is mounted directly at PostgreSQL data_directory
**Severity:** correctness
**File:** fly.db.toml; docker/db/Dockerfile.fly
**Issue:** The Fly volume root contains `lost+found`, but it was mounted directly at the pinned image's `/var/lib/postgresql/data`; `initdb` exits 1 before PostgreSQL starts. A PGDATA-only override is also invalid because `/etc/postgresql/postgresql.conf` still pins `data_directory` to the original path.
**Repro/evidence:** The exact pinned image failed on the root mount, failed with only `PGDATA=/var/lib/postgresql/data/pgdata`, and passed when the volume mounted at `/var/lib/postgresql`. The passing cluster used `/var/lib/postgresql/data` and retained a probe across two restarts.
**Suggested fix:** Mount the volume parent, keep the image's data directory unchanged, and prove the exact image and two restarts in CI.
**Status:** fixed in source (uncommitted; static 12/12 and exact-image container/restart test pass; preserved production-volume inspection and Fly deployment remain pending)

## 2026-07-11 - Volume remount can silently hide a legacy PostgreSQL cluster
**Severity:** correctness
**File:** docker/db/entrypoint.fly.sh
**Issue:** Reusing the same volume at `/var/lib/postgresql` could hide a cluster previously written at the volume root and let the image initialize an empty cluster under `data/`.
**Repro/evidence:** A synthetic legacy volume with root-level `PG_VERSION`, `base`, `global`, and `pg_wal` was remounted at the parent path. Without a guard those markers are outside the image data directory.
**Suggested fix:** Fail before entrypoint initialization when legacy or unexpected root entries exist, and inspect a preserved production-volume clone before deployment.
**Status:** fixed in source (uncommitted; wrapper exits 78 and creates no child cluster; production clone inspection remains pending)

## 2026-07-11 - Optional Supabase role makes database first boot fail
**Severity:** correctness
**File:** docker/db/01-roles.sql
**Issue:** The first-boot script unconditionally altered `supabase_functions_admin`, but the pinned image creates that role only when its pg_net setup path applies. The missing role aborted database initialization.
**Repro/evidence:** The exact custom database image exited 3 at `ALTER USER supabase_functions_admin`; after making only that extension-dependent role conditional, the same image became ready and survived two restarts with persisted data.
**Suggested fix:** Keep required connection roles fail-closed and conditionally alter only the extension-dependent role.
**Status:** fixed in source (uncommitted; exact-image first boot and restart proof pass; Fly execution remains pending)

## 2026-07-11 - Shared database credential preserved privileged substitution paths
**Severity:** security
**File:** docker/bootstrap/run.fly.sh; docker/bootstrap/supabase-admin-reconciliation.sql; deploy-fly.sh
**Issue:** The former bootstrap path reused one database password and could perform owner work through inherited role authority, so a runtime or migrator credential could retain more authority than its service required.
**Repro/evidence:** The replacement requires four distinct active database passwords, performs owner work only in a direct `supabase_admin` superuser session, performs numbered migrations only in a direct `postgres` NOSUPERUSER session, and disables unused login roles.
**Suggested fix:** Preserve the direct-session boundary and retire every temporary bootstrap credential before runtime activation.
**Status:** fixed in source (uncommitted; real PostgreSQL authority, rotation, idempotence, retired-password, and cross-owner denial tests pass; live Fly proof pending)

## 2026-07-11 - Database initialization could log role passwords and JWT policy
**Severity:** security
**File:** docker/db/00-aria-init-log-policy.sql; docker/db/postgresql.schema.sql; docker/bootstrap/supabase-admin-reconciliation.sql
**Issue:** The pinned initializer expands secret-bearing role statements before role-local logging policy exists, and bootstrap reconciliation rotates credentials and writes JWT settings.
**Repro/evidence:** The replacement suppresses statement text, failed-statement text, and error parameter values across first initialization and the owner transaction, then resets normal logging only after successful reconciliation. Canary scans found none of the injected credential or JWT markers.
**Suggested fix:** Keep the early log policy first in lexical init order and preserve the completion marker as the boundary for re-enabling normal logging.
**Status:** fixed in source (uncommitted; first-init and post-restart canary scans pass; managed Fly log proof pending)

## 2026-07-11 - Numbered migration attempted cross-owner privilege mutation
**Severity:** correctness
**File:** supabase/migrations/0019_agent_authority_and_integrations.sql; docker/bootstrap/supabase-admin-reconciliation.sql
**Issue:** Migration 0019 mixed application-schema work with owner-local default ACL and Auth ownership changes that a direct NOSUPERUSER `postgres` migrator cannot reliably perform.
**Repro/evidence:** Owner-local ACL, role rotation, Auth ownership, and JWT configuration now execute in one direct `supabase_admin` transaction; migration 0019 contains only work permitted to the direct `postgres` migrator. Cross-owner mutation probes are denied while the complete ledger remains idempotent.
**Suggested fix:** Keep privileged reconciliation separate from numbered application migrations and test both identities independently.
**Status:** fixed in source (uncommitted; two-phase real-PostgreSQL test passes; production migration ledger pending)

## 2026-07-11 - Three custom production images bypassed release promotion controls
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml; .github/workflows/ci.yml; deploy-fly.sh
**Issue:** Database, bootstrap, and Kong images were remotely rebuilt or pushed without the application image's scan, provenance, immutable-reference, and running-digest controls.
**Repro/evidence:** The replacement builds all four custom images for `linux/amd64`, pulls and scans the exact candidate digest, creates CycloneDX and signed attestation evidence, promotes only the same digest, deploys exact digest references, and compares running digests before acceptance.
**Suggested fix:** Keep every custom runtime image inside one exact-SHA build-scan-attest-promote-deploy chain.
**Status:** fixed in source (uncommitted; CI/release contracts pass 98/98 and deploy contracts pass 60/60; exact-SHA GitHub registry and amd64 execution pending)

## 2026-07-11 - First immutable-tag promotion hashed an empty manifest
**Severity:** correctness
**File:** .github/workflows/deploy-aria-mantu.yml; tests/infra-release-contract.mts
**Issue:** Bash suppresses `set -e` inside a function used as an `if` condition. When an exact-SHA tag did not yet exist, `digest_for` continued after the failed inspect and returned the SHA-256 of empty input, falsely classifying the tag as an existing conflicting artifact.
**Repro/evidence:** Both digest functions now explicitly return on inspect failure, empty manifest, hash failure, or malformed digest. An executable absent-tag regression probe passes, and the infrastructure release contract is 96/96.
**Suggested fix:** Preserve explicit returns inside conditional shell functions; never rely on inherited `errexit` semantics for release identity.
**Status:** fixed in source (uncommitted; live registry first-promotion proof pending)

## 2026-07-11 - Image secret scan omitted config and build history
**Severity:** security
**File:** .github/workflows/ci.yml; .github/workflows/deploy-aria-mantu.yml
**Issue:** Trivy secret scanning inspected image files but did not enable image-config scanning, so a credential embedded in ENV, config, or build history could pass.
**Repro/evidence:** Both four-image scan loops now add `--image-config-scanners secret` beside the filesystem secret scanner. The release contract asserts the flag, order, and fail-closed exit in CI and release.
**Suggested fix:** Preserve both filesystem and image-config scanning for every custom image.
**Status:** fixed in source (uncommitted; infrastructure release contract 98/98; exact registry-image execution pending)

## 2026-07-11 - CycloneDX evidence was not schema validated
**Severity:** test-gap
**File:** .github/workflows/ci.yml; .github/workflows/deploy-aria-mantu.yml
**Issue:** The SBOM gate checked only three JSON fields and could accept a malformed document that did not conform to the CycloneDX schema.
**Repro/evidence:** Every app, database, bootstrap, and Kong SBOM now runs through the digest-pinned official CycloneDX CLI v0.32.0 with JSON, v1.6, and fail-on-errors selected. The validator digest is included in release evidence.
**Suggested fix:** Keep full schema validation in both CI and release before attestation or promotion.
**Status:** fixed in source (uncommitted; static contracts pass; local Docker Hub route timed out, so exact-SHA amd64 execution pending)

## 2026-07-11 - Known Gitleaks false positives made the protected CI gate red
**Severity:** test-gap
**File:** .gitleaksignore; tests/databricks-intake.mts; src/app/api/source/sillage/start/route.ts
**Issue:** Six reviewed non-secret matches in committed history and one synthetic current fixture caused Gitleaks to exit 1, preventing an exact-SHA release even though no credential was present.
**Repro/evidence:** The replacement uses six exact historical fingerprints, restructures the synthetic Databricks token fixture, and allows only two source lines whose Sillage request field names trigger the LinkedIn client-id rule. A 205-commit scan plus current tests and src scans report no findings.
**Suggested fix:** Keep ignores fingerprint- or line-specific; never allowlist an entire source, relay, or credential directory.
**Status:** fixed in source (uncommitted; local Gitleaks 8.30.1 is green; exact GitHub action proof pending)

## 2026-07-11 - aria-mantu-db first boot needs ALL reconciliation secrets on the DB app itself, not just bootstrap (one-shot crash-loop trap)
**Severity:** correctness
**File:** fly.db.toml:15-19; docker/db/postgresql.schema.sql; docker/bootstrap/supabase-admin-reconciliation.sql:29-54
**Issue:** The credential reconciliation runs INSIDE the aria-mantu-db container's own first-init (image migrate.sh -> /etc/postgresql.schema.sql -> `\ir supabase-admin-reconciliation.sql`, reading env via `\getenv`), not only in the separate bootstrap app. So the `aria-mantu-db` app must have, at first boot, ALL of: POSTGRES_PASSWORD (image initdb) + SUPABASE_ADMIN_TARGET_PASSWORD + POSTGRES_TARGET_PASSWORD + SUPABASE_AUTH_ADMIN_TARGET_PASSWORD + AUTHENTICATOR_TARGET_PASSWORD + JWT_SECRET + JWT_EXP. Each reconciled secret must be a DISTINCT 43-128 char base64url value; JWT_EXP a positive int. If any is missing/empty/malformed/duplicated, reconciliation `raise`s -> migrate.sh exits -> init aborts with PG_VERSION already written but no completion marker -> entrypoint.fly.sh exits 78 on every later boot -> PERMANENT crash loop clearable only by destroying the volume. Easy to under-provision (natural but wrong assumption: only the bootstrap app needs the *_TARGET_PASSWORD set). Note: the prior HANDOFF shift-25 runbook only set POSTGRES_PASSWORD + JWT_SECRET on the db app — that under-provisioning would trigger exactly this trap.
**Repro/evidence:** `\getenv` reads at supabase-admin-reconciliation.sql:29-54; required env set enumerated in scripts/test-fly-db-volume.sh:135-141; fail-closed rejects at supabase-admin-reconciliation.sql:76-110.
**Suggested fix:** Deploy gate — before `fly deploy --config fly.db.toml`, assert `fly secrets list -a aria-mantu-db` contains all six names AND the five reconciled secrets are mutually distinct; add this precheck to the runbook/deploy-fly.sh so a one-shot deploy can't proceed under-provisioned.
**Status:** fixed in local commit c6c7a0a (deploy-fly.sh stages the exact seven first-init DB secret names, activates them with the DB image, and rejects any post-activation inventory other than the exact managed set; live Fly proof remains pending)

## 2026-07-11 - entrypoint.fly.sh unexpected-entry guard bricks restart if a dotfile lands in the volume root
**Severity:** correctness
**File:** docker/db/entrypoint.fly.sh:27-36
**Issue:** The guard `find "$mount_root" -mindepth 1 -maxdepth 1 ! -name data ! -name lost+found` treats ANY extra top-level entry as a hard exit 78. `/var/lib/postgresql` is both the volume root and the `postgres` OS user's $HOME. Non-interactive init never writes there (verified: 2 restarts + recreate leave a clean {data, lost+found}). But if an operator ever shells in interactively as the postgres user (psql/bash) on the machine, a `.psql_history` / `.bash_history` is written to $HOME=/var/lib/postgresql, and the NEXT boot exits 78 — a healthy DB that then refuses to restart.
**Repro/evidence:** guard at entrypoint.fly.sh:27-36; $HOME=/var/lib/postgresql for the postgres user in the pinned image.
**Suggested fix:** Scope the guard to known Postgres cluster markers (PG_VERSION/base/global/pg_wal) instead of "any non-data/lost+found entry", OR set HISTFILE=/dev/null + psql `\set HISTFILE /dev/null` for interactive sessions and document "never leave dotfiles in the volume root".
**Status:** fixed in local commit c6c7a0a (the image disables bash, psql, and less history for Fly SSH/exec processes; the entrypoint removes only the three known regular history files and rejects symlinks/directories; the exact-volume restart suite and independent validator pass)

## 2026-07-11 - Ambiguous admin mutations could trigger destructive compensation
**Severity:** correctness
**File:** scripts/provision-first-admin.sh
**Issue:** A timeout, disconnect, or signal after GoTrue or workspace mutation could leave the remote commit outcome unknown while local cleanup treated it as a proven failure and deleted an identity that may already be bound.
**Repro/evidence:** Behavior tests cover lost create responses, lost workspace RPC responses, transport failure, and in-flight termination. The helper now marks a mutating request ambiguous immediately before transport and clears that state only after a definitive response; ambiguous identities are preserved for owner reconciliation.
**Suggested fix:** Keep destructive compensation limited to an exact marked identity with a definitive uncommitted outcome.
**Status:** fixed in local commit c6c7a0a (20/20 admin behavior cases pass; live first-admin provisioning remains pending)

## 2026-07-11 - Fly secret rotation could accept staged or stale topology
**Severity:** security
**File:** deploy-fly.sh; src/lib/crypto-secrets.ts
**Issue:** Staged Fly secret mutations and omitted optional secrets could be mistaken for deployed state, while retiring a previous data key without release-bound approval could make existing ciphertext unreadable.
**Repro/evidence:** The release helper now distinguishes clean, staging, staged, deployed, retired, and ambiguous states; validates exact per-app allowlists after activation and again before acceptance; stages omitted optional secrets for removal; and requires an exact release-and-recovery-bound approval before a non-empty previous-key ring may be omitted. New ciphertext uses a SHA-256 key identifier and legacy ciphertext can use a bounded prior-key ring.
**Suggested fix:** Preserve exact inventory checks and fail closed on ambiguous activation or key-ring retirement.
**Status:** fixed in local commit c6c7a0a (deploy contract 129/129 and crypto contract 52/52 pass; live secret rotation remains pending)

## 2026-07-11 - Release acceptance was not bound to the uploaded evidence object
**Severity:** test-gap
**File:** .github/workflows/deploy-aria-mantu.yml
**Issue:** A release could reach a terminal-looking receipt without proving which immutable artifact stored the candidate evidence, allowing evidence existence and accepted release identity to diverge.
**Repro/evidence:** The always-run upload has a unique candidate-evidence name. Finalization validates and records the upload action's numeric artifact ID and 64-hex artifact digest, then archives the accepted receipt separately before the sole terminal acceptance step.
**Suggested fix:** Keep candidate, archive, final receipt, and terminal acceptance as a single ordered chain.
**Status:** fixed in local commit c6c7a0a (infrastructure release contract 130/130 passes; GitHub artifact proof remains pending)

## 2026-07-11 - Workflow rerun could bypass independent approval
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml
**Issue:** Checking only the original workflow actor does not prevent that same person from rerunning a previously initiated release and satisfying the approval boundary as the triggering actor.
**Repro/evidence:** Receipt validation now rejects an approver matching either GITHUB_ACTOR or GITHUB_TRIGGERING_ACTOR and records the initial actor, triggering actor, and approver in evidence.
**Suggested fix:** Preserve both actor comparisons and require an independent protected-environment reviewer.
**Status:** fixed in local commit c6c7a0a (recovery workflow contract passes; GitHub environment enforcement remains pending)

## 2026-07-11 - Production UI seeded fabricated campaign and provider state
**Severity:** spec-mismatch
**File:** src/lib/seed.ts; src/lib/store.ts; src/app/login/page.tsx; src/components/settings/databricks-panel.tsx
**Issue:** Production could present seeded campaign/candidate/API-key data or imply an Azure/Databricks connection that had not been configured, masking an empty or degraded live backend.
**Repro/evidence:** Production initialization no longer seeds fake campaigns, candidates, or keys; provider availability is deployment-authority driven; and Azure is hidden unless explicitly enabled. Focused live-side-effect, login, integration-authority, and documentation contracts pass.
**Suggested fix:** Keep demo state explicit and isolated from live readiness and connection status.
**Status:** fixed in local commit c6c7a0a (live deployment and browser acceptance remain pending)

## 2026-07-11 - SMS dispatch reconciles unknown provider outcomes as retryable
**Severity:** correctness
**File:** src/lib/dispatch-outbound.ts:468-476 (SMS branch)
**Issue:** Same bug class as the email ambiguity finding (fixed by 0022): the SMS branch reconciles a provider deliveryState of "unknown" to retryable "skipped", so an accepted-but-disconnected SMS send can be retried and duplicated. Email and WhatsApp now fail closed to a non-retryable reconciliation state; SMS does not.
**Repro/evidence:** Surfaced by the F1 builder while porting the ambiguity doctrine; the SMS branch predates the deliveryState classification.
**Suggested fix:** Port the 0022 doctrine: unknown outcome -> non-retryable ambiguous reconciliation + operator resolution, only proven pre-transport failure stays retryable.
**Status:** fixed in local integration (2171868; public API and dispatcher still reject SMS, dormant unknown provider outcome no longer becomes retryable capacity; post-merge proof on 2026-07-12: `npm run test:security` and `npm test` passed through dispatch/outreach/channel contracts)

## 2026-07-11 - Cross-channel daily cap race between email and WhatsApp claims
**Severity:** correctness
**File:** supabase/migrations/0013_outreach_approval_race_safety.sql (claim_whatsapp_outbound)
**Issue:** 0021 serializes claim_and_record (email) with a per-seat FOR UPDATE lock, but claim_whatsapp_outbound counts the same per-seat ledger without locking agent_seats. A simultaneous email + WhatsApp claim on one seat at cap-1 can still land cap+1 across channels.
**Repro/evidence:** Surfaced by the F2 builder; the two claim functions count the same ledger under different locking disciplines.
**Suggested fix:** New migration: take the same workspace-scoped agent_seats FOR UPDATE lock in claim_whatsapp_outbound before its cap count (keep the 0021-documented lock order: approvals before seats).
**Status:** fixed in local integration (adbc7fc; migration 0024 serializes the shared per-seat daily cap across email and WhatsApp; post-merge proof on 2026-07-12: `npm run test:db-cross-channel-cap` returned `concurrent_claims=1 active_claims=1 ambiguous=blocked deadlock=none privileges=service-only`, and `npm test` passed `cross-channel-cap-contract`)

## 2026-07-12 - Fly DB volume recovery gate cannot build while Alpine indexes are unreachable
**Severity:** test-gap
**File:** docker/db/Dockerfile.fly:12; scripts/test-fly-db-volume.sh
**Issue:** The local `npm run test:fly-db-volume` gate cannot reach its recovery assertions because Docker times out fetching Alpine 3.23 package indexes during the DB image CVE-patch layer.
**Repro/evidence:** On 2026-07-12, `npm run test:fly-db-volume` failed in Docker layer `RUN apk upgrade --no-cache && apk add --no-cache su-exec && rm -f /usr/local/bin/gosu` with `APKINDEX.tar.gz: Operation timed out` for both `main` and `community`, then `ERROR: Not continuing due to stale/unavailable repositories. Use --force-missing-repositories to continue.` Alternate mirrors tested from the host (`dl-2.alpinelinux.org`, `mirrors.edge.kernel.org`, `mirror.leaseweb.com`) also timed out. The Dockerfile mirror override was removed; no `--force-missing-repositories` bypass was accepted.
**Suggested fix:** Retry the gate from a network that can reach Alpine indexes, or move to a reviewed internal package mirror only after proving the exact image and two-restart recovery suite pass. Do not weaken the CVE patch layer.
**Status:** fixed (uncommitted; 2026-07-14 rerun reached every recovery assertion and exited 0, including the exact image, two restarts, legacy cutover/recreate, unsafe-layout blocks, and init-secret-free recreate)

## 2026-07-12 - Read-only QA lane pushed unsafe production authority code
**Severity:** correctness
**File:** src/app/api/agents/run/route.ts; git history b205293
**Issue:** A reviewer instructed to remain read-only edited, committed, and pushed production code. The pushed implementation failed open from unsupported channels to Email and wrote first-touch drafts into the reply outbox with the wrong semantic type.
**Repro/evidence:** Commit `b205293` was observed on `origin/main`. Local commit `7e6d1aa` explicitly reverts it. The replacement source was built in an isolated branch, passed repeated adversarial reviews, and was merged at `01721dc`.
**Suggested fix:** Keep reviewer agents in detached worktrees, require exact-SHA independent GO, and never grant reviewer lanes release-worktree or push authority.
**Status:** fixed and pushed (7e6d1aa, 01721dc; remote `main` advanced normally from b205293 through the reviewed replacement and Relay evidence to 352de32; exact-SHA CI remains pending)

## 2026-07-12 - Pushed main SHA has remote pre-runner CI failures
**Severity:** test-gap
**File:** .github/workflows/ci.yml; .github/workflows/codeql.yml
**Issue:** Source merge `01721dcbe041b5a9c7d71a37a2ff90bd212139f6` and pushed Relay descendant `352de32cc444aec38450e4cfe2f65fe06bdb511b` are fully green locally but are not proven remotely green. Earlier main SHAs were red before runner steps executed.
**Repro/evidence:** `gh run list --repo mysticalsin/aria-sourcing-demo --branch main --limit 8` showed CI run `29217207203` and CodeQL run `29217207170` failed for `ac4c77b`; earlier runs also failed for `52423e8`. Job `86713908848` had empty runner fields, zero steps, and a four-second failure. The corrective main push later succeeded and all three refs matched, but exact-SHA `gh api check-runs` and `gh run list --commit` calls then timed out against `api.github.com`, so no final check conclusion is claimed.
**Suggested fix:** Retrieve logs once GitHub/Azure log endpoints are reachable. If this is account budget/runner/platform failure, clear it and rerun workflows. If logs show workflow syntax or action-resolution failure, fix that exact setup failure and push a new main SHA. Do not deploy while exact-SHA CI and CodeQL are red.
**Status:** open

## 2026-07-12 - Release candidate exact-SHA CI and CodeQL fail before meaningful execution
**Severity:** test-gap
**File:** .github/workflows/ci.yml; .github/workflows/codeql.yml
**Issue:** Candidate `c3e94b2b5694825c613e127a69c811f7935a1dd8` passes the complete local gate but is not eligible for production because its GitHub CI and CodeQL runs are red.
**Repro/evidence:** CI run `29221158898` failed eight seconds after creation and CodeQL run `29221158901` failed four seconds after creation. The exact job annotation is unknown because the job and check-run endpoints timed out. The older Actions-budget diagnosis is obsolete and must not be reused without current evidence.
**Suggested fix:** Capture the exact top-level and job annotations, repair that specific workflow-start or account-policy failure, then rerun both workflows for exact `c3e94b2`.
**Status:** open

## 2026-07-12 - GitHub CLI credential exposed through process arguments
**Severity:** security
**File:** _relay/HANDOFF.md
**Issue:** A read-only CI diagnostic interpolated the GitHub CLI credential into a curl Authorization argument, making the credential visible to local process inspection.
**Repro/evidence:** The process command line was observed during the release audit. Matching curl processes were terminated, authenticated GitHub access was stopped, and the credential is not reproduced in this finding.
**Suggested fix:** Revoke and rotate the credential, review GitHub account and repository access history, use least privilege, and keep credentials out of argv and diagnostic output.
**Status:** open

## 2026-07-12 - Live production is healthy only on an older migration ledger
**Severity:** spec-mismatch
**File:** src/app/api/ready/route.ts; supabase/migrations/0024_cross_channel_claim_serialization.sql through 0033_candidate_erasure_authority.sql
**Issue:** Public readiness is green, but the running build is not the reviewed release candidate and does not include the latest authority migrations.
**Repro/evidence:** The final 2026-07-14 `/api/ready` call returned HTTP 200 with build `d2040b534177f5bd2abb28f22de19af57b58dc3a`, migration `0023_conversation_identity.sql`, and all reported components true. Reviewed local source now contains migrations 0024 through 0033.
**Suggested fix:** Complete the protected exact-SHA release path, verify the running digest and build identity, and require the live migration ledger through `0033` before acceptance.
**Status:** open

## 2026-07-13 - Store contract drift had no executable boundary
**Severity:** test-gap
**File:** src/lib/store.ts; src/lib/store/contracts.ts; tests/store-contracts.mts
**Issue:** The 124-action public store contract, implementation object, memo dependency list, React context shape, and consumer hooks shared one 7,002-line coordinator with no parity or dependency-cycle gate. A future extraction could silently omit an action, retain a stale dependency, or introduce a type/runtime cycle.
**Repro/evidence:** The pre-change interface, action object, and memo list each had 124 names but no executable comparison. The new suite checks exact name parity, the seven-field context shape, real provider-bound hook behavior, outside-provider rejection, type-inclusive static cycles, value-only runtime cycles, dynamic imports, and positive two-node/self-cycle fixtures.
**Suggested fix:** Keep `src/lib/store/contracts.ts` React-free and preserve the compatibility re-export while Wave 1B moves action factories behind this boundary.
**Status:** fixed (`316aecb`; exact final gate: 10/10 focused, 135/135 chained commands, typecheck, lint, 59/59 build)

## 2026-07-13 - Hook regression assertion could print workspace state
**Severity:** security
**File:** tests/store-contracts.mts
**Issue:** The first provider-hook characterization compared `context.state` directly with `null`. If server rendering ever exposed a populated state, Node's assertion failure could serialize candidate, outreach, reply, chat, or memory data into CI logs.
**Repro/evidence:** Independent security review reproduced Node's direct-object assertion output. The final test compares the boolean `context.state === null` with a fixed message, so a failure cannot reflect `HermesState`.
**Suggested fix:** Keep security-sensitive negative assertions non-reflective and never print full workspace objects in CI failures.
**Status:** fixed (`316aecb`; independent closure review and focused 10/10 suite passed)

## 2026-07-13 - Campaign updates trusted broad and opaque client patches
**Severity:** security
**File:** src/lib/store/contracts.ts:55; src/lib/store/campaign-actions.ts:213
**Issue:** The public update accepted `Partial<Campaign>`, allowing client code to replace identifiers, timestamps, metrics, and activity history. The first allowlist still accepted undefined values, invalid enums, malformed warnings, and unknown JD fields that could retain opaque or secret-like data in shared state.
**Repro/evidence:** Independent reviewers reproduced `status: undefined` corrupting a required field and a valid-looking JD persisting an invalid seniority plus top-level and nested sentinel fields. The final factory projects only four editable fields, validates canonical enums and exact warning fields, strips unknown JD data, validates strict finite scoring weights, and denies live viewers through the authoritative role ref.
**Suggested fix:** Keep runtime projection at the state boundary even when TypeScript narrows callers, and treat shared workspace JSON as untrusted input.
**Status:** fixed (`1450f85`; adversarial projection cases and focused 22/22 suite passed)

## 2026-07-13 - Campaign flows reported success after rejected or partial work
**Severity:** correctness
**File:** src/lib/store.ts:704; src/app/launch/page.tsx:111; src/lib/store/campaign-launch.ts:15
**Issue:** The old void commit could reject a mutation while creation returned an orphan campaign. Callers then navigated or sourced that nonexistent ID. Multi-role launch also ignored failed sourcing waves and could report success when only some requested roles completed.
**Repro/evidence:** Reviewers reproduced commit rejection, viewer denial, failed sourcing, and one-success plus one-creation-failure result sets. The commit boundary now returns a synchronous application result; callers branch on nullable or boolean action outcomes; launch success requires every requested role to be created and sourced.
**Suggested fix:** Preserve explicit applied/rejected results and keep multi-step UI completion logic in a pure decision function with a complete decision table.
**Status:** fixed (`1450f85`; focused 22/22, full 136-command gate, and production build passed)

## 2026-07-13 - Candidate intake trusted client and provider data across an effect boundary
**Severity:** security
**File:** src/lib/store/sourcing-actions.ts:393
**Issue:** Live batch, exact GitHub, and manual candidate intake could accept stale authority, malformed provider data, unsafe links, fabricated defaults, duplicate identities, or a rejected state commit while still exposing success behavior.
**Repro/evidence:** The adversarial matrix covers workspace and role loss before and after I/O, missing and paused campaigns, exact provider source and identity, bounded DTOs, private and mapped-IP URLs, unknown-field injection, latest-state dedupe, and commit rejection. The final boundary records source events and metrics only after a positive applied result.
**Suggested fix:** Keep the three actions behind the React-free factory and preserve the exact pre-I/O, post-I/O, DTO, dedupe, and commit-result gates.
**Status:** fixed (`e070e55`, `1f89813`; intake 23/23, approval 58/58, outreach 52/52, full 137-command gate, security suite, and 59/59 build passed)

## 2026-07-13 - Paid enrichment accepts unbound provider identifiers
**Severity:** security
**File:** src/app/api/source/apollo/enrich/route.ts:19; src/app/api/source/seamless/research/route.ts:19
**Issue:** The original Apollo and current Seamless flows accepted bounded raw provider identifiers without a server-owned binding to the persisted workspace candidate before spending provider credits or revealing contact data.
**Repro/evidence:** Apollo is fixed in `ced2a58`: search persists the candidate, selection creates an exact server-owned workspace, campaign, candidate, target binding, prepare claims it before confirmation, and commit revalidates it. `SeamlessResearchSchema` still accepts `searchResultId` without the equivalent binding.
**Suggested fix:** Accept a canonical candidate ID, resolve the workspace-owned candidate server-side, verify provider and external ID, then spend or reveal only for that exact record.
**Status:** fixed (`f19bcb1`; every Seamless and Sillage route fails closed before rate limits, secrets, or egress in production, and their production UI actions are hidden; re-enable only after equivalent server-owned authority exists)

## 2026-07-13 - Async enrichment handles are not bound to their persistence target
**Severity:** security
**File:** src/app/api/source/seamless/research-status/route.ts:38; src/app/api/source/sillage/status/route.ts:39; src/lib/store.ts:828
**Issue:** Polling accepts a raw request ID, while the browser separately supplies the campaign or candidate that receives the result. A valid handle is not server-bound to a workspace, provider operation, candidate, or campaign, so a mismatched or replayed handle can disclose or persist data into the wrong client-selected record.
**Repro/evidence:** Both status routes query by `requestId` after role checks only. `checkSeamlessResearch(candidateId, requestId)` and `checkSillageMapping(campaignId, requestId)` choose their local persistence target independently of the server-side provider job.
**Suggested fix:** Persist an opaque workspace-scoped job record at start, bind it to the exact candidate or campaign, and authorize polling and persistence from that server-owned binding.
**Status:** fixed (`f19bcb1`; incomplete Seamless and Sillage start/status paths are production-disabled before secret or provider access and hidden from production UI)

## 2026-07-13 - Sillage returns and persists a company-wide contact batch
**Severity:** security
**File:** src/app/api/source/sillage/status/route.ts:76; src/lib/store.ts:872
**Issue:** One completed company mapping returns all resolved profiles to the browser and the store persists every accepted profile, including provider-returned contact fields. This expands PII exposure beyond an explicit per-candidate reveal decision.
**Repro/evidence:** The status response includes `profiles: mappingRes.data.profiles`; the client maps the entire array and prepends every accepted candidate to shared workspace state.
**Suggested fix:** Return a minimized preview by default, require explicit per-candidate reveal, and persist only the fields and candidates the authorized operator selected.
**Status:** fixed (`f19bcb1`; Sillage is production-disabled before provider access and its UI action is hidden until a minimized server-bound implementation exists)

## 2026-07-13 - Remaining provider actions lack the guarded action contract
**Severity:** correctness
**File:** src/lib/store.ts:946; src/lib/store.ts:1115; src/lib/store.ts:1145; src/lib/store.ts:1222
**Issue:** Seamless, Sillage, and sourcing-agent actions still live in the React coordinator. Several snapshot authority and campaign data before I/O, then commit after await without rechecking current role, workspace, campaign state, dedupe state, or whether the commit applied.
**Repro/evidence:** Apollo now uses the guarded sourcing factory in `ced2a58`, including exact pre-I/O, post-I/O, DTO, binding, persistence, and commit-result gates. The remaining callbacks still use the old coordinator pattern.
**Suggested fix:** Extract one provider action group at a time into the sourcing factory and port the same authority, response projection, latest-state, and applied-result decision table.
**Status:** fixed (`f19bcb1`; unfinished paid-provider paths are production-disabled; the sourcing-agent route now owns campaign/settings authority, revalidates before every external call and commit, returns a strict DTO, and the client rechecks latest campaign and dedupe state)

## 2026-07-13 - Sourcing agent trusts full client objects and returns full candidates
**Severity:** security
**File:** src/app/api/sourcing-agent/route.ts:37; src/app/api/sourcing-agent/route.ts:132
**Issue:** The route accepts opaque campaign and candidate records up to 200 KB, casts them to domain types, and sends them through a cloud tool-calling flow. It does not use a bounded campaign DTO, a minimized candidate context, or a server-authoritative campaign record.
**Repro/evidence:** `campaign` and `existing` are `z.record(z.string(), z.unknown())`; the route then uses `as unknown as Campaign` and `as unknown as Candidate[]`. The caller sends every campaign candidate rather than an explicit dedupe and disclosure projection.
**Suggested fix:** Define exact schemas, resolve authoritative campaign data server-side where available, minimize existing candidates to dedupe fields, and validate every returned candidate before persistence.
**Status:** fixed (`f19bcb1`; the route accepts only a campaign ID, loads campaign and provider authority server-side, minimizes tool context, and releases strict candidate DTOs only after the database completion receipt)

## 2026-07-13 - Provider errors cross the server boundary without one bounded translator
**Severity:** security
**File:** src/app/api/source/seamless/research/route.ts:56; src/app/api/source/sillage/start/route.ts:68
**Issue:** Remaining source routes return provider detail strings to the browser. Upstream bodies can contain request details, identifiers, or unbounded text, and each adapter applies a different error policy.
**Repro/evidence:** Apollo now returns bounded typed errors in `ced2a58`. Seamless and Sillage still return `result.detail || result.title`; there is no shared allowlisted public-error mapping across those routes.
**Suggested fix:** Centralize provider error classification, redact known secret and URL material, cap length, log only a safe diagnostic code, and return a bounded public message.
**Status:** fixed (`f19bcb1`; Apollo uses bounded errors and the incomplete Seamless/Sillage routes are production-disabled before provider access, so upstream detail cannot cross the production boundary)

## 2026-07-13 - Intake and sourcing invented role facts when evidence was missing
**Severity:** spec-mismatch
**File:** src/lib/ai/intake.ts; src/lib/mock-ai.ts; src/app/intake/page.tsx
**Issue:** Generic intake and sample paths could fill absent role facts with plausible defaults, making an incomplete user request appear sourcing-ready and creating searches from invented needs.
**Repro/evidence:** Grounding tests now prove absent title, skills, location, seniority, and description remain unknown; cloud-extracted values not grounded in submitted text are dropped; launch samples are separately labeled and complete.
**Suggested fix:** Keep need readiness evidence-based and block sourcing until required facts and a reviewed query exist.
**Status:** fixed (`f19bcb1`; intake grounding 5/5, launch readiness 1/1, Mantu intake 14/14, and sourcing action tests passed)

## 2026-07-13 - Graphify learning lacked durable artifact and runtime authority
**Severity:** security
**File:** supabase/migrations/0027_sourcing_learning_authority.sql; workers/graphify-lessons; src/app/api/sourcing-agent/route.ts
**Issue:** A lesson system would be forgeable or ceremonial if Graphify output were not stored and digest-bound, if the worker could see candidate/query data, or if promoted clusters never affected later sourcing.
**Repro/evidence:** Migration 0027 stores exact export input, graph bytes, manifest, image digest, source commit, optimistic lesson version, independent evidence, and human review. The isolated worker receives aggregate fingerprints/counts only, and deterministic sourcing diversifies human-promoted exact-role queries across Graphify cluster references.
**Suggested fix:** Preserve aggregate-only exports, immutable image/source binding, separate human promotion, and runtime cluster-aware selection.
**Status:** fixed (`f19bcb1`; static authority 85/85, runtime 7/7, operations 19/19, and disposable PostgreSQL authority/isolation/idempotency/review/kill-switch/privacy gate passed)

## 2026-07-13 - Feedback receipts disappeared or crossed campaign UI state
**Severity:** correctness
**File:** src/app/campaigns/[id]/page.tsx; supabase/migrations/0027_sourcing_learning_authority.sql
**Issue:** Component-only feedback prompts disappeared after reload, a new run could replace older pending prompts, failed searches could become impossible-to-submit prompts, and preserved component state could show a prior campaign's receipts.
**Repro/evidence:** The database now lists only successful unreviewed receipts for the exact workspace, actor, and campaign. The page scopes state by campaign, reloads it, merges new receipts by opaque ID, and removes only a durably recorded receipt.
**Suggested fix:** Keep feedback authority durable and server-scoped; never derive it solely from the latest component response.
**Status:** fixed (`f19bcb1`; feedback route/runtime 13/13, UI contract 7/7, and mixed-success disposable PostgreSQL regression passed)

## 2026-07-13 - Exact Graphify worker container cannot complete on current network
**Severity:** test-gap
**File:** workers/graphify-lessons/Dockerfile; tests/graphify-learning-container.sh
**Issue:** The exact Graphify 0.9.14 container acceptance gate cannot install its hash-locked Python dependencies because the current route to PyPI times out.
**Repro/evidence:** Docker resolves the digest-pinned Python base, then pip repeatedly reports `Connection to pypi.org timed out` while requesting `/simple/networkx/`. Host API checks used a different installed Graphify version and are not exact-runtime proof.
**Suggested fix:** Run `npm run test:graphify-learning` in clean CI/network, scan and publish the resulting immutable image, then configure only that accepted digest.
**Status:** fixed (uncommitted; dependencies and Graphify 0.9.14 are vendored with checked hashes, the container builds without network, and `npm run test:graphify-learning` passed exact-runtime, network-none, deterministic graph, and receipt checks)

## 2026-07-13 - Migration 0027 was missing from reviewed recovery authority
**Severity:** correctness
**File:** docker/bootstrap/legacy-baseline-invariants.sql; docker/bootstrap/legacy-baseline-public-schema.sha256
**Issue:** Migration 0027 applied under the restricted migration role, but protected legacy recovery still pinned the schema, table set, and function signatures from migration 0026, so an exact current database could not pass recovery preflight.
**Repro/evidence:** The first full `npm run test:db-privileges` reported schema fingerprint mismatch. After the digest changed, the next run rejected the legacy public table set. The final allowlists include all ten learning tables and sixteen functions.
**Suggested fix:** Move the reviewed recovery digest and exact table/function allowlists atomically with every future migration.
**Status:** fixed (`f19bcb1`; final owner-session gate exited 0 with restricted postgres, direct supabase_admin, read-only empty/legacy/complete preflights, approved baseline, exact ledger, rotation, idempotence, and no secret leak)

## 2026-07-13 - Apollo paid work lacked exact persisted authority
**Severity:** security
**File:** supabase/migrations/0026_apollo_enrichment_authority.sql:1; src/lib/store/sourcing-actions.ts:1309
**Issue:** Apollo enrichment previously spent against a client-supplied external identifier without a durable, replay-safe server record proving the exact workspace, campaign, candidate, target, confirmation, and attempt authority.
**Repro/evidence:** Migration 0026 and the guarded sourcing factory now require a persisted Apollo candidate and exact target binding, revoke stale or anonymized targets, serialize prepare and commit, permit only same-workspace authorized teammate handoff, and deny cross-workspace, tenant, campaign, candidate, and replay cases. The TypeScript authority matrix passed 47/47 and the real PostgreSQL authority gate exited 0.
**Suggested fix:** Keep all future paid providers on the same select, prepare, confirm, commit, reconcile authority model.
**Status:** fixed (`ced2a58`)

## 2026-07-13 - Successful retry could leave local state behind persisted state
**Severity:** correctness
**File:** src/lib/store.ts:639; src/lib/store.ts:657
**Issue:** A failed authoritative save retained a retryable snapshot, but a later successful retry could clear recovery state without installing that exact snapshot locally. A subsequent save could overwrite the recovered server document with stale local state.
**Repro/evidence:** Retry success now installs `pending.snapshot` in the local state and state ref under the exact skip-persist guard before clearing recovery state. The focused recovery convergence matrix passed 18/18 and the unchanged-snapshot full gate passed.
**Suggested fix:** Preserve remote and local convergence as one atomic success condition for every retryable shared-state save.
**Status:** fixed (`ced2a58`)

## 2026-07-13 - Candidate anonymization left linked privacy data behind
**Severity:** security
**File:** src/lib/candidate-privacy.ts:14; src/lib/candidate-privacy.ts:156
**Issue:** Candidate removal needed one canonical projection covering provider authority and receipts, outreach, replies, bookings, wins, activity, chat, suppression, ingestion, and structured content without deleting unrelated short-name text.
**Repro/evidence:** `anonymizeHermesState` removes exact candidate-linked data, redacts structured content, revokes Apollo authority, handles punctuation around identifiers, and uses boundary-aware matching to avoid cases such as Ian inside compliance. The focused privacy suite passed 9/9 and the real PostgreSQL erasure path proved lost-response convergence.
**Suggested fix:** Route every candidate-rights operation through the canonical privacy projection and server erasure RPC.
**Status:** fixed (`ced2a58`)

## 2026-07-13 - Cleanup worker could leak authority or accept stale release proof
**Severity:** security
**File:** scripts/apollo-authority-cleanup-worker.mjs:25; scripts/verify-apollo-cleanup-release.mjs:38
**Issue:** A privileged cleanup worker must not forward its service-role header across redirects, and release verification must not accept an old success event, partial process topology, a mismatched image, or incomplete counters.
**Repro/evidence:** The worker denies redirects, applies a 10-second abort, emits the exact release SHA and all counters, and isolates bounded workspace failures. A real two-origin test proved the redirected origin received no `apikey`. The verifier requires the promoted digest on all web and cleanup Machines, one active cleanup Machine, one explicitly paired stopped standby, and a success event created after app activation with every expected counter. Focused cleanup tests passed 5/5 and deploy-contract tests passed 131/131.
**Suggested fix:** Keep privileged background workers redirect-denying and bind operational receipts to the exact promoted artifact, topology, release, and activation window.
**Status:** fixed (`ced2a58`)
## 2026-07-13 - Authenticated users can forge message authority and cross-bind an agent conversation
**Severity:** security
**File:** supabase/migrations/0007_agent_runtime.sql:146; supabase/migrations/0023_conversation_identity.sql:134; src/lib/whatsapp-inbound.ts:297
**Issue:** Authenticated workspace members retain direct message-table writes. A member can insert a workspace-local outbound row whose simple `spec_id` foreign key points to another workspace, and the inbound resolver accepts composed or unsent history. The service worker then trusts the returned spec identity. Authenticated inbound insertion also lets a member forge a WhatsApp STOP event that reaches suppression processing.
**Repro/evidence:** An isolated PostgreSQL run with migrations 0001 through 0027 allowed a viewer to insert both message rows, accepted the foreign spec binding, and returned the other workspace's spec from `resolve_whatsapp_inbound_conversation`.
**Suggested fix:** Make normalized message writes service/RPC-only, bind messages and conversations to immutable workspace-owner-spec authority, derive conversations only from provider-accepted outbound receipts, and reselect the runtime spec by workspace plus owner plus spec.
**Status:** fixed (uncommitted; migration 0028 removes authenticated message DML, owner-binds message/conversation/spec authority, accepts only durable sent receipts, routes human queueing through one bounded RPC, and passes 46/46 static plus disposable PostgreSQL authority/replay/isolation proof)

## 2026-07-13 - Alternate agent-run route invents missing hiring requirements
**Severity:** correctness
**File:** src/lib/agents/runtime-policy.ts:60; src/app/api/agents/run/route.ts:92
**Issue:** A title-only stored brief is expanded to Senior, Full-time, Remote, and Standard urgency, then the alternate agent route can run real model and search work without the reviewed-need and role-evidence gates used by the sourcing route.
**Repro/evidence:** `normalizeStoredAgentRoleBrief` supplies those defaults and the route does not call the campaign readiness, unsafe-input, reviewed-query, or sourcing-receipt authority.
**Suggested fix:** Fail this incomplete legacy execution path closed in production until it consumes the same reviewed campaign and receipt authority as `/api/sourcing-agent`; preserve unknown facts as unknown.
**Status:** fixed (uncommitted; the route returns 503 before parsing input or resolving credentials, invented role defaults were removed, and the disabled-path/need-authority suites pass)

## 2026-07-13 - Alternate agent-run route has browser-owned provider authority and no durable replay receipt
**Severity:** security
**File:** src/app/api/agents/run/route.ts:50
**Issue:** The browser selects provider, key identifier, model, and an arbitrary existing-candidate array. The route lacks same-origin enforcement, a database idempotency/quota claim, a server-owned configuration fingerprint, completion receipt, and live role/config/key revalidation around each external call.
**Repro/evidence:** The request schema accepts every authority input directly; the key is resolved once and reused; the per-node callback rechecks only active spec ownership.
**Suggested fix:** Disable the incomplete route in production or rebuild it on server-owned configuration, database claims, exact receipts, and per-egress revalidation.
**Status:** fixed (uncommitted; the route returns 503 before parsing browser authority or touching providers, secrets, candidates, or persistence; focused disabled-route tests pass)

## 2026-07-13 - Candidate erasure does not cover normalized conversations and provider lifecycle
**Severity:** spec-mismatch
**File:** src/lib/store.ts:3743; src/lib/candidate-privacy.ts:156
**Issue:** The original anonymization covered workspace state and Apollo authority but did not prove the broader candidate data lifecycle.
**Repro/evidence:** Migration 0033 now performs one service-owned local scrub across normalized messages, conversations, WhatsApp rows, runs/events, framework results, caches, and content-free receipts. Provider-held data, logs, restore replay, and retention ownership remain in the narrower open findings below.
**Suggested fix:** Add a legal-hold-aware service workflow that enumerates and scrubs every candidate-bearing store, calls supported provider DSRs, and produces a bounded durable receipt with automated proof.
**Status:** fixed in source and superseded by the narrower open restore, reimport/memory, provider-evidence, and bulk-obligation findings

## 2026-07-14 - Flowise binding treated caller input as tenant authority
**Severity:** security
**File:** src/app/api/agents/specs/route.ts; src/app/api/flowise/[...path]/route.ts
**Issue:** An operator could assign an arbitrary `flowise_chatflow_id` to an owner-visible spec, after which the public proxy treated that circular binding as proof of ownership and forwarded arbitrary query/body/session controls to one shared Flowise runtime.
**Repro/evidence:** The old create/update schemas accepted the raw ID; the proxy queried the same client-writable column, appended the caller query string, and forwarded the unvalidated body under one global API key. Flowise OSS does not independently prove ARIA workspace ownership.
**Suggested fix:** Remove browser-owned external IDs, disable the public proxy, and resolve immutable server-owned instance/workflow bindings only through a private typed adapter.
**Status:** fixed (uncommitted; browser Flowise identifiers and the upstream proxy were removed, all public methods fail closed, and the private compiler accepts only ARIA's strict node vocabulary; focused policy/client tests pass)

## 2026-07-14 - DeerFlow and Flowise were described as frameworks without being used
**Severity:** spec-mismatch
**File:** src/lib/agents/graph.ts:1; _agent_state/mantu-goal/goal-2026-07-08-aria-enterprise-ready.json
**Issue:** The current agent graph explicitly implements an older DeerFlow-inspired pattern in plain TypeScript, the executor is now disabled, and Flowise was only an unsafe optional prediction proxy. Goal milestone m5 records the custom graph as done even though Tony now requires actual DeerFlow and Flowise frameworks.
**Repro/evidence:** Before this shift neither pinned runtime existed in deployment definitions. Current source pins DeerFlow `fabadae4168db81f0eaaf62f209050f978e2f691` and Flowise `bb773ffa710bd22639c4ba2643413a0ea2b679d3`, executes approved Flowise IR through the private DeerFlow adapter, and provides a ten-app private Fly deployment pack. The aggregate framework suite passes 42/42.
**Suggested fix:** Reopen framework milestones, keep ARIA as authority, use a pinned private DeerFlow adapter plus isolated Flowise authoring/import, and require live two-tenant framework E2E before completion.
**Status:** fixed in source (uncommitted; actual pinned framework runtimes, private adapters, governed execution, and deployment definitions now exist; promoted image digests, deployed adapters, and live E2E remain release blockers below)

## 2026-07-14 - Flowise and DeerFlow enterprise dependencies are unproven
**Severity:** security
**File:** docs/architecture; production deployment configuration
**Issue:** No accepted image, SBOM, signature, tenant-isolation proof, private network policy, restart/restore proof, or operational owner exists for either framework. Flowise OSS uses a shared default workspace while users/workspaces/RBAC/SSO are commercial features; DeerFlow warns its default trusted-localhost tool surface is unsafe for public deployment.
**Repro/evidence:** Upstream audits found Flowise `@flowiseai/agentflow` 0.0.0-dev.14 explicitly not recommended for production, plus Custom JS/HTTP/MCP/tool capabilities. DeerFlow exposes broad Gateway thread/run, file, web, MCP, Bash, memory, and agent-mutation surfaces; its active run registry is process-local and orphaned runs become errors rather than auto-resume.
**Suggested fix:** Obtain Flowise tenancy/license/vendor evidence; build exact commits with frozen locks and digest-pinned bases; scan/sign/attest; deploy only ARIA-owned narrow adapters with default-deny egress, per-workspace isolation, real readiness, leases, idempotency, and kill switches.
**Status:** open (source now has private narrow adapters, separate state planes, immutable-identity gates, signed/SBOM/provenance/scan requirements, readiness, leases, idempotency, and kill switches; vendor entitlement, promoted artifacts, egress proof, HA/restore, deployment, and live E2E remain unproven)

## 2026-07-14 - Legacy WhatsApp template name constraint crashes valid inserts
**Severity:** correctness
**File:** supabase/migrations/0009_whatsapp_delivery_policy.sql:76
**Issue:** The POSIX regular expression uses `{1,512}`; PostgreSQL rejects that repetition bound when the constraint is evaluated, so a valid approved template insert fails with SQLSTATE 2201B instead of validating the name.
**Repro/evidence:** The disposable conversation-authority database test stopped at template seed with `invalid regular expression: invalid repetition count(s)`. Migration 0028 replaces it with an explicit 1..512 length predicate plus an unbounded allowlisted character class.
**Suggested fix:** Preserve the corrected validated constraint in the migration ledger and recovery fingerprint.
**Status:** fixed (uncommitted; the full disposable PostgreSQL conversation authority test including migration replay passes)

## 2026-07-14 - Owner recovery was absent from CI
**Severity:** test-gap
**File:** .github/workflows/ci.yml:37; .github/workflows/ci.yml:128
**Issue:** The source exposed operator and database recovery test scripts, but neither gate ran in CI or through the aggregate `npm test` command.
**Repro/evidence:** The pre-fix workflow contained no `test:owner-recovery` or `test:db-owner-recovery` invocation. The operator gate also needs the quality job's installed Node dependencies, while the database gate belongs in the Docker-backed database job.
**Suggested fix:** Run the operator contract in `quality` after `npm ci` and the PostgreSQL authority test in `database-security`.
**Status:** fixed (uncommitted; workflow YAML parses and the recovery contract verifies both actual run commands)

## 2026-07-14 - Owner binding committed before password login was proven
**Severity:** correctness
**File:** scripts/recover-orphan-workspace-owner.sh:427
**Issue:** The script called the durable recovery RPC before attempting password login. A confirmed-looking but non-login-capable GoTrue identity could therefore commit the workspace/profile binding and fail only afterward, leaving the tenant recovered on paper but unusable.
**Repro/evidence:** The behavior test originally required `recovery.rpc` before `auth.password-login`. A new rejected-login scenario proves the RPC is never reached and the exact pre-binding identity is cleaned up.
**Suggested fix:** Prove the exact active email identity through password login before the recovery RPC, then use its token for post-binding RLS verification.
**Status:** fixed (uncommitted; operator contract and behavior suite pass with `login=prebinding-verified`)

## 2026-07-14 - Recovery RPC accepted an unmarked GoTrue identity
**Severity:** security
**File:** supabase/migrations/0031_orphan_owner_recovery_authority.sql:269
**Issue:** The shell required a deterministic request marker, but the service-role database RPC checked only email/provider/account fields. A direct RPC caller could bypass the reviewed marked-identity invariant.
**Repro/evidence:** The disposable database test now clears `raw_user_meta_data` and invokes the RPC with otherwise valid service-role authority; it receives `identity_not_eligible` and performs no recovery mutation.
**Suggested fix:** Derive the exact marker from request ID and verified approval SHA inside the RPC and require it in `raw_user_meta_data`.
**Status:** fixed (uncommitted; `test:db-owner-recovery` passes including the unmarked direct-call rejection)

## 2026-07-14 - Concurrent retry cleanup could delete another attempt's user
**Severity:** correctness
**File:** scripts/recover-orphan-workspace-owner.sh:180
**Issue:** Exact retries share the deterministic request marker. If two operators observed empty Auth and one create lost with a conflict, its cleanup could mistake the other in-flight attempt's user for its own and hard-delete it before binding.
**Repro/evidence:** The adversarial mock returns a create conflict while exposing another attempt's exact-request user. Pre-fix cleanup matched only the shared marker and deleted it.
**Suggested fix:** Add a random per-attempt cleanup ID to GoTrue metadata and require both the deterministic marker and attempt ID before deletion.
**Status:** fixed (uncommitted; behavior suite proves the foreign-attempt user is preserved while own failed pre-binding users are deleted)

## 2026-07-14 - Pinned DeerFlow tool schema made every real model request fail
**Severity:** correctness
**File:** infra/agent-frameworks/model-gateway/server.mjs; infra/agent-frameworks/deerflow-config.yaml
**Issue:** The pinned DeerFlow runtime always binds its built-in `review_skill_package` tool even when the ARIA agent and skill declare no tools. The model gateway rejected every request containing `tools`, so a real proposal could never reach the cloud model.
**Repro/evidence:** The exact pinned DeerFlow commit and locked `langchain-openai` 1.2.1 request included the built-in schema. The gateway now accepts only that byte-semantically exact schema, strips it and optional literal `tool_choice: "none"` before egress, disables streaming fallback, and rejects every schema drift or additional tool. Focused gateway tests pass.
**Suggested fix:** Keep the exact locked schema contract synchronized with the promoted DeerFlow image; never forward tool authority to the provider.
**Status:** fixed (uncommitted; exact-schema acceptance, negative drift, egress stripping, and non-streaming compatibility tests pass)

## 2026-07-14 - Provider responses could restore stripped local tool authority
**Severity:** security
**File:** infra/agent-frameworks/model-gateway/server.mjs
**Issue:** After request-side tool stripping, a malicious or compromised provider could still return `tool_calls` or legacy `function_call`; LangChain would parse that response and DeerFlow could execute its locally bound built-in.
**Repro/evidence:** Adversarial upstream fixtures return valid assistant text plus each tool-call shape. The gateway now returns a generic 502 and never relays either response; focused tests pass for both formats.
**Suggested fix:** Preserve response-side tool-call rejection whenever the request boundary strips all tool authority.
**Status:** fixed (uncommitted; both current and legacy provider tool-injection tests pass)

## 2026-07-14 - Shared Redis let Flowise mutate DeerFlow stream authority
**Severity:** security
**File:** infra/agent-frameworks/compose.yaml; infra/agent-frameworks/adapter/server.mjs
**Issue:** DeerFlow, Flowise, their worker, and both adapters shared one Redis service, volume, and password. Compromise of Flowise's broad OSS runtime therefore granted authentication to DeerFlow's stream state.
**Repro/evidence:** The stack now has distinct `deerflow-redis` and `flowise-redis` services, volumes, password files, dependency graphs, and mode-bound adapter host authority. Fly adapter startup additionally requires `REDIS_HOST` to equal the exact reviewed `REDIS_FLY_HOST`. Cross-framework host/secret assertions and Compose rendering pass.
**Suggested fix:** Keep Redis credentials and state per framework even when both services use the same promoted Redis image digest.
**Status:** fixed (uncommitted; 31/31 framework adapter/gateway/deployment tests and `docker compose config -q` pass)

## 2026-07-14 - Gateway rejected schema-valid large grounded needs
**Severity:** correctness
**File:** infra/agent-frameworks/model-gateway/server.mjs; infra/agent-frameworks/compose.yaml
**Issue:** The gateway imposed a hidden 16 KiB per-message limit and production configured only 64 KiB total, while the reviewed ARIA need contract permits a UTF-8 prompt of about 126 KiB before DeerFlow's system envelope.
**Repro/evidence:** A 130 KiB framework prompt failed with 400 before the fix. The production ceiling is now 256 KiB, individual messages share that total bound, and the same regression returns 200 while oversized bodies still fail before egress.
**Suggested fix:** Keep application schema bounds and gateway byte ceilings in one tested compatibility contract.
**Status:** fixed (uncommitted; 130 KiB compatibility and request-overflow tests pass)

## 2026-07-14 - Adapter readiness did not prove the cloud model was usable
**Severity:** correctness
**File:** infra/agent-frameworks/adapter/server.mjs; infra/agent-frameworks/compose.yaml
**Issue:** DeerFlow adapter readiness checked only the framework's configured model list. After startup, a provider outage, HTTP 402 account failure, or gateway model drift could still leave adapter and ARIA readiness green.
**Repro/evidence:** Readiness now derives `/readyz` from the canonical private model base URL, authenticates with the internal gateway token, and requires the exact configured provider and model before any DeerFlow dependency can be healthy. Wrong provider/model fixtures and unavailable-gateway readiness fail closed.
**Suggested fix:** Preserve authenticated live provider/model proof in every activation heartbeat; a configured model name is not readiness.
**Status:** fixed (uncommitted; exact authenticated gateway and negative drift/readiness tests pass)

## 2026-07-14 - Oversized upstream streams were rejected without cancellation
**Severity:** security
**File:** infra/agent-frameworks/adapter/server.mjs
**Issue:** When a chunked DeerFlow or Flowise response exceeded 2 MB, the adapter threw and released the stream reader without cancelling it, allowing the upstream connection and response production to continue after rejection.
**Repro/evidence:** An incremental 6 MB upstream fixture remained open before the fix. The adapter now cancels the reader on overflow; the fixture observes connection closure before completion while the client receives the same generic 502.
**Suggested fix:** Cancel bounded response streams before releasing their reader on every overflow path.
**Status:** fixed (uncommitted; streamed-overflow cancellation regression passes)

## 2026-07-14 - Demo localStorage accepted real and manual candidate PII
**Severity:** security
**File:** src/lib/store.ts; src/lib/store/sourcing-actions.ts; src/lib/store/migrations.ts
**Issue:** The no-Supabase demo could call real GitHub or web providers and accept manual candidates, then serialize the resulting candidate PII into cleartext localStorage with no provenance guard.
**Repro/evidence:** Before the fix, `syntheticSourcingAllowed()` selected a branch that still called `/api/source` for explicit GitHub and web platforms, manual intake used the same persisted commit, and both commit paths plus the final localStorage flush accepted non-synthetic candidates.
**Suggested fix:** Make browser-local candidate authority synthetic-only, reject real and manual actions before I/O, recheck explicit provenance at commit and flush, and purge legacy unsafe snapshots during hydration.
**Status:** fixed (uncommitted; focused privacy and sourcing boundary gate passes 46/46, legacy unsafe snapshots are purged, and the final 164-command aggregate passes)

## 2026-07-14 - Framework stack had no controlled private Fly deployment path
**Severity:** spec-mismatch
**File:** infra/agent-frameworks/fly/operator.mjs; infra/agent-frameworks/fly/*.toml
**Issue:** Compose contracts could not create or verify the ten private production services, and there was no approval, immutable artifact, secret-import, network, readiness, or replay authority for a Fly rollout.
**Repro/evidence:** The new source pack defines separate private apps for both PostgreSQL stores, both Redis planes, gateway, DeerFlow, Flowise, worker, and adapters. Its prepare/confirm/deploy operator binds a 15-minute approval to config and image digests, verifies cosign signature/SBOM/provenance and Trivy results, imports file secrets over stdin, uses exact `--image` and `--no-public-ips`, and requires current network, Machine, platform-check, and authenticated private identity evidence before a receipt. `npm run test:agent-framework-adapter` passes 42/42, all ten TOML files pass `flyctl config validate`, shell/Node/Python syntax checks pass, and Bake renders seven wrapper targets.
**Suggested fix:** Keep this operator in the protected release gate and archive its owner-reviewed manifest, plan, approval, and receipt without secret material.
**Status:** fixed in source (uncommitted; no Fly mutation or production receipt was produced)

## 2026-07-14 - Private Fly source pack still lacks enterprise release evidence
**Severity:** security
**File:** infra/agent-frameworks/fly/README.md; infra/agent-frameworks/fly/docker-bake.hcl
**Issue:** The upstream DeerFlow and Flowise Dockerfiles still consume mutable base tags, Fly egress is not proven gateway-only, the stateful topology is one Machine and one volume per store, and neither restore nor live framework/campaign behavior has been tested on these apps.
**Repro/evidence:** The operator requires final signed digests, an SPDX SBOM, SLSA provenance containing the exact source commit, and a zero-high/critical Trivy result, but `cosign`, `trivy`, and `syft` are unavailable in this workspace and no promoted manifests were supplied. No Fly deploy was authorized. A private Flowise bootstrap, provider readiness, PostgreSQL HA decision, timed snapshot restore, failure injection, and real approved-campaign canary remain absent.
**Suggested fix:** Pin or independently attest every upstream base input, install the verification tools in a protected runner, enforce and test egress, complete the Flowise bootstrap, accept an HA/RTO/RPO design, execute restore/failure drills, then deploy and canary through the approved operator.
**Status:** open; framework activation remains NO-GO

## 2026-07-14 - Restored backups can reintroduce erased candidate data
**Severity:** security
**File:** scripts/restore-drill.sh:73
**Issue:** The restore drill verifies the restored archive's internal schema and rows, but it has no external erasure journal to replay deletions that happened after the backup was created.
**Repro/evidence:** A backup taken before a candidate erasure can restore the deleted candidate and still pass the current drill because both the archive and restored database predate the erasure receipt.
**Suggested fix:** Keep an independently retained erasure journal outside the restored database and make post-restore replay plus verification a mandatory recovery gate.
**Status:** open; production restore and candidate erasure remain NO-GO

## 2026-07-14 - Candidate reimport and memory erasure authority is incomplete
**Severity:** security
**File:** supabase/migrations/0025_agent_memory_authority.sql:196; supabase/migrations/0033_candidate_erasure_authority.sql:289
**Issue:** Candidate data embedded in agent-run/event JSON, framework-result payloads, and encrypted AgentSpec memory has no explicit candidate provenance that an administrator can target for erasure.
**Repro/evidence:** Migration 0033 guards and transaction-serializes workspace state, normalized messages, outreach, suppression, WhatsApp contact/window, conversations, and Apollo writes; both writer-first and erasure-first PostgreSQL sessions now pass. Migration 0025 still permits bounded encrypted memory content without a candidate identifier or administrator erasure receipt, and run/framework payloads remain unstructured for erasure authority.
**Suggested fix:** Add explicit candidate provenance and administrator erasure receipts for run, framework, and memory payloads before production activation.
**Status:** open; production candidate erasure remains NO-GO

## 2026-07-14 - Provider erasure evidence is manual and not independently verified
**Severity:** security
**File:** src/app/api/admin/candidates/erasure/route.ts:36; supabase/migrations/0033_candidate_erasure_authority.sql:1839
**Issue:** ARIA exposes a manual provider-reference workflow and accepts a case reference plus syntactically valid SHA-256, but it neither executes provider deletion nor verifies that the evidence artifact exists and proves deletion.
**Repro/evidence:** The completion request validates the hash format and expected attempt count. The database records that assertion; no approved evidence store or provider adapter is queried.
**Suggested fix:** Bind completion to an approved evidence-store object and provider account, or add provider-specific deletion and receipt adapters with replay-safe reconciliation.
**Status:** open; provider-held candidate data remains a production NO-GO

## 2026-07-14 - Large provider-obligation sets have no safe completion path
**Severity:** correctness
**File:** supabase/migrations/0033_candidate_erasure_authority.sql:201
**Issue:** The 100-obligation guard prevents partial local scrubbing, but candidates with more than 100 linked provider records cannot enter the application erasure workflow.
**Repro/evidence:** The before-insert trigger raises SQLSTATE 54000 at the 101st obligation, and the route returns a typed 409 before destructive data changes. There is no paginated bulk workflow that can complete the request.
**Suggested fix:** Replace the fixed durable-obligation cap with paginated response authority while preserving atomic request creation and bounded API pages.
**Status:** open; documented Security and DPO escalation is required

## 2026-07-14 - Candidate scrub implementations lack parity proof
**Severity:** test-gap
**File:** supabase/migrations/0033_candidate_erasure_authority.sql:289; src/lib/candidate-privacy.ts:95
**Issue:** The live path previously applied the database scrub and then persisted a second browser scrub whose token rules were not equivalent.
**Repro/evidence:** Successful live erasure now clears all queued or failed browser save authority and reloads the exact server-owned workspace. `anonymizeHermesState()` remains only in synthetic demo mode, where no real candidate data is permitted.
**Suggested fix:** Keep the database as the only live erasure authority and preserve the hydration regression.
**Status:** fixed (uncommitted; candidate privacy passes 9/9, store contracts pass 11/11, and TypeScript passes)

## 2026-07-14 - Late legal hold state disappeared from the reloaded admin queue
**Severity:** correctness
**File:** src/components/candidates/candidate-drawer.tsx:91; src/components/candidates/candidate-drawer.tsx:458
**Issue:** The API and database could return `blocked_legal_hold`, but the drawer's obligation parser and durable-queue validator rejected that valid state after a page reload.
**Repro/evidence:** A regression first failed because neither validator allowlisted `blocked_legal_hold`; the focused contract now requires both paths to preserve it.
**Suggested fix:** Keep the UI status allowlist aligned with the canonical erasure state type and OpenAPI enum.
**Status:** fixed (uncommitted; candidate erasure contract passes 4/4 and TypeScript passes)

## 2026-07-14 - Late legal hold degraded provider actions to an availability error
**Severity:** correctness
**File:** src/app/api/admin/candidates/erasure/route.ts:390
**Issue:** The database returned `blocked_legal_hold` for both provider-authority inspection and reconciliation, but the PATCH route rejected that valid state as an untyped 503.
**Repro/evidence:** The regression first received HTTP 503 for both actions after a late hold. The route now maps both database results to the canonical non-final HTTP 423 response.
**Suggested fix:** Keep route, database, and OpenAPI legal-hold states aligned.
**Status:** fixed (uncommitted; candidate route passes 10/10, OpenAPI contract passes, and TypeScript passes)

## 2026-07-14 - Stale inbound workers could recreate erased contact rows
**Severity:** security
**File:** supabase/migrations/0033_candidate_erasure_authority.sql:837
**Issue:** A worker that claimed inbound work before erasure could later recreate raw suppression, WhatsApp contact/window, or conversation identity after the local scrub committed.
**Repro/evidence:** The tombstone trigger originally guarded workspace state, messages, outreach, and Apollo only. It now also rejects erased email, phone, LinkedIn, and candidate identifiers in suppression, WhatsApp contact/window, and conversation writes with SQLSTATE 23514.
**Suggested fix:** Preserve these guards and the shared normalized identity locks; add candidate provenance for the remaining run/event/framework/memory paths in the next migration.
**Status:** fixed for the bounded contact paths (uncommitted; both transaction lock orders pass and leave zero raw rows after rejected writes)

## 2026-07-14 - AgentSpec dependency failures appeared as missing memory
**Severity:** correctness
**File:** src/app/api/agents/memories/route.ts
**Issue:** The owned-AgentSpec lookup collapsed database errors and confirmed absence into null, so GET, POST, PATCH, and DELETE returned 404 during a retryable database failure. The authentication lookup also ignored its returned error.
**Repro/evidence:** Adversarial route tests first received 404 or 201 with injected AgentSpec/auth dependency errors. The lookup now has found, not_found, and unavailable states; auth and database errors return non-cacheable 503 while only confirmed absence returns 404.
**Suggested fix:** Keep dependency errors distinct from resource absence at every authority boundary.
**Status:** fixed (uncommitted; memory route tests pass 20/20)

## 2026-07-14 - Candidate drawer could cross candidate erasure authority
**Severity:** security
**File:** src/components/candidates/candidate-drawer.tsx; src/lib/store.ts
**Issue:** Late queue, inspect, or completion responses could update a newly opened candidate. Typed 423 holds discarded their body, successful erasure could leave click-time PII visible after hydration failure, and an anonymized tombstone still exposed incompatible restore controls.
**Repro/evidence:** Every request now carries an abort controller and candidate/open generation scope checked after each await. A 423 clears decrypted authority and reloads the queue; a valid receipt masks local state before fallible hydration and closes the drawer; the store commit boundary preserves tombstones and restore exits before any suppression DELETE.
**Suggested fix:** Keep UI request authority candidate-scoped and treat erasure tombstones as permanently immutable.
**Status:** fixed (uncommitted; candidate erasure, privacy, and store contract suites pass)

## 2026-07-14 - Framework recovery changed a successful idempotent response
**Severity:** correctness
**File:** src/lib/agents/framework/execution.ts; supabase/migrations/0032_agent_operational_authority.sql
**Issue:** A first successful framework run returned its bounded report summary, but recovery after a lost response returned reports as an empty array for the same idempotency key.
**Repro/evidence:** Migration 0032 now persists exactly one bounded public report summary with the proposal digest. Recovery validates it and returns the original complete response; missing or malformed reports fail closed and changed replay reports conflict.
**Suggested fix:** Preserve the full public response contract in durable idempotency authority.
**Status:** fixed (uncommitted; framework execution passes 15/15 and database/rollback authority passes)

## 2026-07-14 - Fly adapter configuration mixed provider and private runtime URLs
**Severity:** correctness
**File:** infra/agent-frameworks/fly/operator-core.mjs; src/lib/agents/framework/configuration-core.mjs; scripts/agent-framework-heartbeat-worker.mjs
**Issue:** The Fly operator injected the public Moonshot/OpenAI origin as DeerFlow's private model-gateway URL, while its HTTP-only private adapters were rejected by ARIA and heartbeat's HTTPS-only checks.
**Repro/evidence:** The operator now injects the exact private gateway and adapter origins, derives and verifies the configuration digest from that environment, and shares one credential-free .internal URL policy across configuration, ARIA readiness, and heartbeat. Public origins remain rejected.
**Suggested fix:** Keep cloud-provider identity distinct from private gateway identity and test generated deployment values across every consumer.
**Status:** fixed (uncommitted; Fly deployment 15/15, framework configuration/contract, and heartbeat tests pass)

## 2026-07-14 - Candidate erasure queue mutated state through an unprotected GET
**Severity:** security
**File:** src/app/api/admin/candidates/erasure/route.ts; docs/api/openapi.yaml
**Issue:** Queue listing refreshes expired holds and request states in PostgreSQL, but GET accepted a missing Origin and therefore performed state changes outside the same-origin JSON mutation boundary.
**Repro/evidence:** Queue listing is now PATCH action list with the exact same-origin JSON boundary. GET is side-effect free and returns 405 with Allow: POST, PATCH; the drawer and OpenAPI use the new contract.
**Suggested fix:** Keep all state-changing reads behind an explicit mutation contract.
**Status:** fixed (uncommitted; route 11/11 and OpenAPI contract pass)

## 2026-07-14 - Candidate erasure and stale reimport were not transaction-serialized
**Severity:** security
**File:** supabase/migrations/0033_candidate_erasure_authority.sql; tests/candidate-erasure-db.sh
**Issue:** Reimport triggers read tombstones without sharing a transaction lock with erasure, so a concurrent writer could pass before tombstone commit and recreate PII afterward.
**Repro/evidence:** Erasure and all nine reimport triggers now lock the same normalized workspace/identity keys in deterministic order. Real two-session tests prove writer-first erasure waits then scrubs the committed row, while erasure-first writer waits then rejects with SQLSTATE 23514 and persists no row.
**Suggested fix:** Preserve the shared identity-lock authority and both lock-order regressions.
**Status:** fixed (uncommitted; candidate database authority and database privilege gates pass)

## 2026-07-14 - Private readiness could leave the reviewed Machine through redirects or proxies
**Severity:** security
**File:** infra/agent-frameworks/fly/runtime/private-probe.py:63
**Issue:** The DeerFlow in-Machine readiness probe used default urllib redirect and environment-proxy behavior, so readiness could be supplied by an origin other than the exact `FLY_PRIVATE_IP`.
**Repro/evidence:** The regression rejects a 302 and an inherited `HTTP_PROXY`, asserting that neither the redirect target nor proxy receives a request.
**Suggested fix:** Keep the no-redirect, no-proxy transport isolated in `private_http.py` and preserve the executable regression in the Fly deployment suite.
**Status:** fixed (uncommitted; Fly deployment suite passes 15/15)

## 2026-07-14 - Release documentation drifted from workflow-derived evidence
**Severity:** test-gap
**File:** README.md; production-readiness/STATUS.md; production-readiness/DEPLOYMENT_RUNBOOK.md; docs/ARCHITECTURE.md; tests/docs-truth.mts
**Issue:** Current release docs still described six scanned images, four local attestations, 24 application tables, and ten active framework apps after the workflow, inventory, and operator had changed.
**Repro/evidence:** The protected workflow declares seven scanned and five locally attested components; the table inventory is canonical; the framework operator has eight active and two release-disabled roles. The docs test previously passed without checking those facts.
**Suggested fix:** Derive supply-chain counts from the workflow, refer to the canonical table inventory without a copied count, and keep active/disabled topology explicit.
**Status:** fixed (uncommitted; documentation truth passes 39/39)

## 2026-07-14 - The 0032 SQL fallback had no ledger-safe production operator path
**Severity:** spec-mismatch
**File:** supabase/rollbacks/0032_agent_operational_authority.sql; production-readiness/DEPLOYMENT_RUNBOOK.md
**Issue:** The fallback SQL was described as operational, but no protected apply job existed and the migration ledger would prevent a normal 0032 forward reapply.
**Repro/evidence:** The database test manually applies rollback SQL and reapplies migration 0032. The production bootstrap records 0032 as applied and has no receipt-bound reverse/forward action for this file.
**Suggested fix:** Keep production use prohibited until a protected job and new append-only forward migration are reviewed; use restore or a forward migration meanwhile.
**Status:** open (documentation now fails closed; production machinery remains absent)

## 2026-07-14 - Test manifest could pass without validating itself
**Severity:** test-gap
**File:** tests/test-manifest.mjs:389
**Issue:** The manifest contract was exposed as an optional package script but was absent from the canonical lifecycle, so `npm test` could pass after manifest hashes, wiring, trace parity, or fail-fast behavior drifted.
**Repro/evidence:** The initial 186-process parity run exited 0 without executing `tests/test-manifest-contract.mts`. The final application group registers it exactly once; the untouched-tree lifecycle ran the contract 8/8 and exited 0.
**Suggested fix:** Keep every runner-integrity contract in the canonical manifest exactly once.
**Status:** fixed (`e58992a`)

## 2026-07-14 - Canonical test execution was not process-portable
**Severity:** correctness
**File:** scripts/run-test-manifest.mjs:122; tests/test-manifest-contract.mts:230
**Issue:** Canonical `tsx` entries were executed through the loader shortcut rather than the installed CLI, and the trace proof launched the Windows-incompatible `npm` command directly with `shell: false`.
**Repro/evidence:** The runner now resolves `tsx/cli` and executes it through `process.execPath`. The npm trace uses the lifecycle-provided `npm_execpath`; bare non-npm execution skips only that lifecycle-specific trace subtest while retaining the other seven runner checks.
**Suggested fix:** Preserve logical command identity while resolving package CLIs through Node and keep platform shims out of shell-free spawns.
**Status:** fixed (`e58992a`)

## 2026-07-19 - Direct sourcing adapters can bypass the central recruiting policy
**Severity:** security
**File:** src/app/api/source/apify/start/route.ts:21; src/app/api/source/apollo/search/route.ts:107; src/lib/sourcing/query-policy.ts:5
**Issue:** The central query policy rejects protected traits and proxy criteria, but the direct Apify route accepts raw queries, schools, first names, and last names without invoking it; Apollo search is not bound to a verified approved requisition.
**Repro/evidence:** Static route tracing found no call from either direct adapter to the canonical policy/requisition authority. The Apify UI exposes the same name filters. A user can therefore reach provider side effects through a path with weaker policy controls than the canonical agent.
**Suggested fix:** Enforce one server-side prohibited-criteria and approved-requisition check before every provider call, with an immutable policy receipt.
**Status:** open; real sourcing remains NO-GO

## 2026-07-19 - Enrichment spend authority is defined but not used by application calls
**Severity:** correctness
**File:** supabase/migrations/0044_sourcing_enrichment_authority.sql:138; src/app/api/source/enrich/route.ts:42
**Issue:** Migration 0044 defines database claim, settle, and release authority, but no application source calls those RPCs. The enrichment route treats the client budget as a hint and caps only one request, not total workspace spend.
**Repro/evidence:** `rg` found no `claim_enrichment_budget`, `settle_enrichment_spend`, or `release_enrichment_claim` call under `src`. Repeated or parallel requests across app instances can exceed a tenant budget while each individual request remains within ten units.
**Suggested fix:** Wrap every paid enrichment/provider call in durable database claim, settle, and release operations and test concurrent multi-instance replays against a hard ceiling.
**Status:** open; paid enrichment remains NO-GO

## 2026-07-19 - Autonomous sourcing workers have no executable job handlers
**Severity:** spec-mismatch
**File:** scripts/sourcing-loop-worker.mjs:19; scripts/sourcing-loop-worker.mjs:218
**Issue:** The production loop worker declares an empty handler set and cannot claim any durable sourcing job, so a need cannot progress headlessly from intake through sourcing when the browser is closed.
**Repro/evidence:** `HANDLER_KINDS` is empty and the worker's claim path therefore has no eligible job kinds. Live aggregate inspection showed zero job/heartbeat activity, one loop control with sourcing disabled, and no deployed framework executor plane.
**Suggested fix:** Implement bounded idempotent handlers for the approved workflow, deploy supervised executors, and prove lease recovery and zero duplicate sends during worker failure.
**Status:** open; autonomous campaign execution remains NO-GO

## 2026-07-19 - Live browser-agent image is missing a declared Playwright runtime asset
**Severity:** correctness
**File:** package.json:62
**Issue:** The live web process logs an external-module load failure because `/app/node_modules/playwright-core/browsers.json` is absent.
**Repro/evidence:** `flyctl logs -a aria-mantu-app --no-tail` returned `Cannot find module '/app/node_modules/playwright-core/browsers.json'` from the running web machine on 2026-07-19. Health remains 200, so shallow liveness does not detect this browser-tool failure.
**Suggested fix:** Correct standalone image tracing/runtime packaging, add a browser-tool readiness probe, and verify the signed production image contains the exact required Playwright assets without enabling broader browser privileges.
**Status:** open; browser-agent capability remains NO-GO

## 2026-08-27 — Enable webhook hidden when sub active + seat mock
**Severity:** correctness
**File:** src/components/settings/email-connections-panel.tsx:389
**Issue:** Enable webhook only renders when `!c.graphSubscription?.active`. If Graph subscription is active but `seat.mode` is still mock (partial OAuth / promote failure / demote), the repair path that calls `ensure_graph_webhook` → `promoteMicrosoftGraphSeatLive` is unreachable; E2E step 6b then fails closed on exactly this state.
**Repro/evidence:** Panel condition `!c.graphSubscription?.active`; ensureGraphWebhook at connections/route.ts:441-480 still promotes when sub is unchanged+ready; e2e-workflow-test.sh:1070 fails "webhook active but seat.mode is not live".
**Suggested fix:** Show Enable webhook when Graph connection lacks active sub OR matching seat.mode !== "live".
**Status:** fixed (6dacd05c6c6ac50a249b8a481bda39248eca4ad0)

## 2026-08-27 — Outlook OAuth callback creates subscription instead of ensure
**Severity:** correctness
**File:** src/app/auth/microsoft/callback/route.ts:203-204
**Issue:** Callback always `createGraphMailSubscription` (POST). Reconnect / repair when Graph already has an Inbox subscription for the app fails closed before `mode=live` promote; Enable-webhook path correctly uses `ensureGraphMailSubscription`.
**Repro/evidence:** callback imports create; connections ensureGraphWebhook uses ensure; Graph rejects duplicate resource subscriptions without delete-first.
**Suggested fix:** Replace create with `ensureGraphMailSubscription` before promote (same as Enable webhook).
**Status:** fixed (6dacd05c6c6ac50a249b8a481bda39248eca4ad0)

## 2026-08-27 — e2e_uuid lacks openssl fallback (uuidgen gap mostly fixed)
**Severity:** test-gap
**File:** e2e-workflow-test.sh:143-151
**Issue:** Tip dfa70ec E2E used bare `uuidgen` (log: command not found → Idempotency-Key empty → sourcing-agent 400). HEAD `31a5d21` adds `e2e_uuid` with python3 fallback, but preflight only requires curl/jq/openssl — if both uuidgen and python3 are missing, key is still empty.
**Repro/evidence:** `/tmp/e2e-tip-dfa70ec.log:52` uuidgen missing; HEAD has e2e_uuid; openssl already required at line 141.
**Suggested fix:** Fall back to `printf '%s' "$(openssl rand -hex 16)" | sed 's/^\(........\)\(....\)\(....\)\(....\)\(............\)$/\1-\2-\3-\4-\5/'`.
**Status:** fixed (6dacd05c6c6ac50a249b8a481bda39248eca4ad0)

## 2026-08-27 — requisition_parse rpc_http_404 is apply_workspace_patch digest search_path
**Severity:** correctness
**File:** supabase/migrations/0063_loop_append_outreach.sql:14
**Issue:** 0063 rewrote apply_workspace_patch with search_path omitting `extensions`. Live pgcrypto digest lives in extensions (public install is a no-op when already present elsewhere), so digest(text, unknown) raises 42883; PostgREST maps that to HTTP 404; loop worker records handler:requisition_parse:rpc_http_404 and never append_campaign.
**Repro/evidence:** curl apply_workspace_patch with valid append_campaign → HTTP 404 code=42883 "function digest(text, unknown) does not exist"; invalid patch_kind returns 200 invalid_request (digest not reached). E2E webhook queues requisition_parse but campaign never materializes.
**Suggested fix:** Migration 0068 restores extensions on search_path + schema-qualified digest with sha256::text cast + md5 fallback; worker classifyRpcHttpFailure surfaces digest_unresolved.
**Status:** fixed (9da085d + bba23f6 on enterprise-autopilot; live Fly mig **0068** applied on `e469126` — service-role `append_campaign` returns `not_found` not 42883; synthetic webhook→campaign `camp-req-620deff9` materialized 2026-08-27)

## 2026-08-27 — requisition_parse complete_aria_job 22023 from graphStage enqueue
**Severity:** correctness
**File:** scripts/sourcing-loop-worker.mjs:successorJob / handleRequisitionParse
**Issue:** After 0068 restored digest, `requisition_parse` still failed closed with `handler:requisition_parse:rpc_http_400:22023`. Campaign blob was written via `apply_workspace_patch` (separate RPC) but `complete_aria_job` rolled back job success because `campaign_create` enqueue payload included `graphStage`, which `aria_job_payload_contract_ok` rejects (allowed keys: requisitionId, campaignId only). Same bug on shortlist_build / calendar_book successors.
**Repro/evidence:** Live tick 2026-08-27T22:47:21Z claimed=1 completed=0 failureCodes=`handler:requisition_parse:rpc_http_400:22023`; campaign `camp-req-620deff9` present with 0 candidates (no campaign_create→sourcing_batch chain).
**Suggested fix:** Strip `graphStage` in `successorJob` (keep on result objects only); resume when ingest status is `campaign_created` so retries enqueue `campaign_create` without `record_requisition_parse`.
**Status:** fixed (this shift; requires Fly redeploy of tip beyond `e469126`)

## 2026-08-29 — microsoftOAuth true without tenant while authorize 500s
**Severity:** correctness
**File:** src/lib/email-connections.ts:107-114
**Issue:** `emailProviderReadiness.microsoftOAuth` was true with only CLIENT_ID/SECRET/REDIRECT_URI. Production authorize/callback require `resolveMicrosoftOAuthAuthority()` (MICROSOFT_TENANT_ID or GOTRUE_EXTERNAL_AZURE_URL); without tenant Connect Outlook returns 500 while E2E step 2d would PASS microsoftOAuth.
**Repro/evidence:** Fly can have REDIRECT present + partial CLIENT_* without TENANT; `resolveMicrosoftOAuthAuthority({NODE_ENV:production})===null` but old readiness still true.
**Suggested fix:** Gate microsoftOAuth on `resolveMicrosoftOAuthAuthority(env)` as well.
**Status:** fixed (this shift — cursor/m365-oauth-tenant-readiness-570c)

## 2026-08-29 — Graph-min tenant-from-URL hard-errored as partial Entra
**Severity:** correctness
**File:** scripts/fly-apply-owner-microsoft-secrets.sh:136-162
**Issue:** A real `GOTRUE_EXTERNAL_AZURE_URL` used only to derive `MICROSOFT_TENANT_ID` (with PLACEHOLDER Entra CLIENT_ID/SECRET) set `entra_any=1` + `entra_all=0` and exited ERROR — blocking Graph-only reopen that docs allow via “tenant or Azure URL”.
**Repro/evidence:** Drop-zone with real Graph CLIENT/SECRET, `MICROSOFT_TENANT_ID=PLACEHOLDER_*`, real tenant URL, PLACEHOLDER Entra ID/SECRET → `owner_ms_has_drop_file` PASS then apply ERROR partial Entra.
**Suggested fix:** Skip Entra when CLIENT_ID+SECRET are both PLACEHOLDER/empty; URL alone may still derive tenant.
**Status:** fixed (this shift — cursor/graph-minimum-reopen-fixes-bca0)

## 2026-08-29 — fly-apply preferred stale production-readiness over /tmp drop-zone
**Severity:** correctness
**File:** scripts/fly-apply-owner-microsoft-secrets.sh:50-53
**Issue:** Apply sourced `/tmp/owner-microsoft.env` then `production-readiness/.owner-microsoft.env`, so a stale gitignored copy overwrote the VM drop-zone the watcher/probe treat as primary.
**Repro/evidence:** Valid Graph-min `/tmp` + PLACEHOLDER `production-readiness/.owner-microsoft.env` → detect credentials present, apply fails on PLACEHOLDER Graph fields.
**Suggested fix:** Load production-readiness first, `/tmp` last (drop-zone wins).
**Status:** fixed (this shift — cursor/graph-minimum-reopen-fixes-bca0)

## 2026-08-29 — fly-enterprise-activate treated Entra/LLM as Graph PASS blockers
**Severity:** spec-mismatch
**File:** scripts/fly-enterprise-activate.sh:53-74
**Issue:** Checklist `note_blocker` on missing `GOTRUE_EXTERNAL_AZURE_*` and Fly-env LLM keys (and auth-dead LLM), so Graph-minimum reopen + Hermes/vault still exited activation incomplete. Also omitted `MICROSOFT_TENANT_ID` from required Graph list.
**Repro/evidence:** Decisions: Entra/LLM WARN-only for Graph E2E PASS; `print-fly-secrets-checklist` ends with `fly-enterprise-activate.sh`.
**Suggested fix:** Entra/LLM → WARN; require `MICROSOFT_TENANT_ID` with other Graph secrets.
**Status:** fixed (this shift — cursor/graph-minimum-reopen-fixes-bca0)

## 2026-08-29 — Synthetic Graph client_id false-ready after apply
**Severity:** correctness
**File:** scripts/lib/owner-microsoft-credentials.sh; src/lib/email-connections.ts; scripts/fly-apply-owner-microsoft-secrets.sh
**Issue:** Env exports with monotonous demo UUID `11111111-1111-4111-8111-111111111111` passed PLACEHOLDER checks, were applied to Fly, and made `microsoftOAuth=true` while authorize redirected with a non-real client_id (Connect Outlook would fail at Microsoft).
**Repro/evidence:** After `probe-m365-unblock.sh --apply`, authed `GET /auth/microsoft?seat_id=…` Location contained `client_id=11111111-1111-4111-8111-111111111111`.
**Suggested fix:** Treat monotonous fixture UUIDs as placeholder in apply + readiness; refuse authorize; unset fake Fly secrets.
**Status:** fixed (29bd05b)

## 2026-08-29 — E2E PASS gap audit (post-Owner-hardening)
**Severity:** spec-mismatch
**File:** (audit) Connect Outlook / verify-m365 / post-m365 / Settings / synthetic gates / e2e 6b
**Issue:** Adversarial pass over remaining RESULT: PASS blockers after Owner preflight + consent SKIP + shared lock + Settings Owners hint. Live Fly: `graph_secrets_missing=3` (CLIENT_ID/SECRET/TENANT only); `encryptionReady=true`; microsoftOAuth=false; 6 mock Microsoft Graph seats ready for Connect.
**Repro/evidence:** See audit body below. Authorize already requests Calendars.ReadWrite + OnlineMeetings.ReadWrite (`src/app/auth/microsoft/route.ts:89-91`); callback auto-wires route + `ensureGraphMailSubscription` + promote (`callback/route.ts:204-265`); synthetic/PLACEHOLDER/monotonous UUID refused in readiness+authorize+callback+apply; verify-m365 + e2e 6b require live seat + webhook + both scopes + Teams joinUrl.
**Suggested fix:** None required for PASS — only Entra Owner dropzone + real secrets + Connect Outlook.
**Status:** open (ops: Entra admin Owners Add Tony → apply → Connect Outlook); code PASS path clear

### Non-blocking honesty nits (do not claim PASS; optional polish)
1. **outlook-needs-panel omits Owners** — `src/components/intake/outlook-needs-panel.tsx:278-286` title/copy says only "OAuth env missing"; Settings panels already say Owners → Add twalteur@amaris.com. Mislead only.
2. **fleet seat-card toast omits Owners** — `src/components/fleet/seat-card.tsx:170-174` generic "OAuth env missing". Mislead only.
3. **encryptionReady ≠ secretEncryptionEnabled** — `email-connections.ts:141` is `length > 0`; callback uses `encryptionRequiredButMissing()` → `secretEncryptionEnabled()` (valid base64-32). Junk key could enable Connect UI then fail callback. Live Fly encryptionReady=true and LinkedIn live seat present — not a current PASS blocker.
4. **post-m365 LIVE_SEAT omits status=active** — `post-m365-secrets-golive.sh:168-170` vs `verify-m365-ready.sh:155-160`; oauth wait can leave ENC=false if MS_OAUTH true (`:148-151`). Verify still fail-closes; no false PASS.

## 2026-08-29 — Autopilot sequences always "not armed" (service_role table SELECT)
**Severity:** correctness
**File:** src/lib/rei-autopilot-dispatch.ts (loadAutopilotContext)
**Issue:** Autopilot read `sourcing_loop_controls` via PostgREST table SELECT. `service_role` has EXECUTE on `get_sourcing_loop_controls` only — table SELECT is revoked (42501). Live Fly with kill_switch=false + sequences_enabled=true still returned `sequences_not_armed` for every Autopilot dispatch/sweep.
**Repro/evidence:** Planted critics-green Needs Approval draft; `get_sourcing_loop_controls` showed sequences armed; cron sweep returned `reason:sequences_not_armed`. Direct `GET /sourcing_loop_controls` as service_role → 403 permission denied.
**Suggested fix:** Use `rpc("get_sourcing_loop_controls")` exclusively.
**Status:** fixed (this shift)

## 2026-08-29 — Autopilot sweep hides RPC / recipient failures as empty
**Severity:** correctness
**File:** src/lib/workspace-loop-slices.ts; src/app/api/cron/autopilot-send-outreach/route.ts
**Issue:** Sweep RPC errors and `targetFromMessage` nulls collapsed to `{ok:true,sent:0,results:[]}`.
**Repro/evidence:** Audit plant recipe; ready drafts with missing candidate/recipient looked identical to empty outreach.
**Suggested fix:** 503 on sweep read failure; push `candidate_missing` / `no_recipient` into results.
**Status:** fixed (this shift)

## 2026-08-29 — Worker sweep discards send outcomes
**Severity:** test-gap
**File:** scripts/sourcing-loop-worker.mjs (sweepAutopilotReadyDrafts)
**Issue:** Worker cancelled cron body; tick only reported `autopilotSweep=ok` + workspace count.
**Repro/evidence:** Live tick ok while cron sent:0; no skip reasons in heartbeat.
**Suggested fix:** readBoundedJson; surface sent/skipped/errors/reasons; degrade on errors>0.
**Status:** fixed (this shift)

## 2026-08-29 — LinkedIn Autopilot skip reason collapses config gaps
**Severity:** spec-mismatch
**File:** src/lib/rei-autopilot-send.ts; src/lib/rei-autopilot-dispatch.ts; src/lib/heyreach-delivery.ts
**Issue:** Missing campaign vs seat vs key all mapped to `linkedin_assisted_manual_only`.
**Repro/evidence:** Vault HeyReach key without settings.heyreach.campaignId.
**Suggested fix:** Split diagnostic flags; keep fail-closed AND for dispatch.
**Status:** fixed (this shift)

## 2026-08-29 — approvalScopeHash locale vs SQL lower
**Severity:** correctness
**File:** src/lib/outreach-content.ts
**Issue:** `toLocaleLowerCase()` could diverge from SQL `lower()` / 0079 bind.
**Repro/evidence:** Non-ASCII locale recipient casing.
**Suggested fix:** Use invariant `toLowerCase()`.
**Status:** fixed (this shift)
