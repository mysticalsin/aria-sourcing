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
**Status:** fixed (33b0aed, targeted tests and disposable database verification passed)

## 2026-07-09 — Receipt RPC false outcome was acknowledged as durable
**Severity:** correctness
**File:** src/app/api/webhooks/whatsapp/route.ts
**Issue:** The webhook used only the RPC transport error, so `{recorded:false, reason:'outbound-not-found'}` was acknowledged as if a delivery event had been persisted.
**Repro/evidence:** A provider receipt arriving before `record_whatsapp_provider_acceptance` commits cannot find `provider_message_id`; the old route returned 200 because the RPC itself succeeded.
**Suggested fix:** Classify explicit unknown receipts separately from a same-sender dispatching acceptance race and return 503 for the latter.
**Status:** fixed (33b0aed, migration 0015 and direct SQL outcome probe passed)

## 2026-07-09 — Approved WhatsApp review draft could become orphaned
**Severity:** correctness
**File:** src/lib/dispatch-outbound.ts
**Issue:** A previously approved WhatsApp candidate reply re-blocked by a later transient policy check retained `review_decision='approved'`, which the review RPC refuses to review again.
**Repro/evidence:** A queued approved reply hits a temporary missing-contact policy block, transitions to blocked, then fails the `review_decision is null` review eligibility check.
**Suggested fix:** Reset only approved candidate-reply review metadata whenever dispatcher policy returns it to blocked.
**Status:** fixed (33b0aed, dispatcher regression test passed)

## 2026-07-09 — Inbound recovery could starve mapped messages
**Severity:** correctness
**File:** src/lib/whatsapp-inbound.ts
**Issue:** Recovery applied its limit before excluding rows with no WhatsApp sender mapping, allowing unmapped rows to consume the bounded batch.
**Repro/evidence:** A workspace with enough legacy unmapped inbound rows could repeatedly skip its limit and never reach recoverable rows.
**Suggested fix:** Filter `whatsapp_sender_id IS NOT NULL` in the query before the limit.
**Status:** fixed (33b0aed, regression test passed)

## 2026-07-09 — Any generated-draft duplicate was treated as idempotent
**Severity:** correctness
**File:** src/lib/whatsapp-inbound.ts
**Issue:** A `23505` on review-draft insert was treated as success without proving the existing row belonged to the same inbound event.
**Repro/evidence:** Two messages yielding the same dedupe hash could mark the second inbound processed without a visible review draft.
**Suggested fix:** Accept idempotency only for a matching `inbound_message_id`; retain all other collisions as durable triage.
**Status:** fixed (33b0aed, regression test and SQL triage-retention probe passed)

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
**Status:** fixed (33b0aed; the Node transport pins one validated public address while preserving Host/SNI, disables pooling and redirects, and passes deterministic DNS-rebinding/TLS tests; independent security review accepted the exact tree)

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

## 2026-07-11 - Historical production data-plane outage was reported green
**Severity:** correctness
**File:** deploy-fly.sh; fly.db.toml; live Fly applications
**Issue:** The audited Fly release served the app shell while the sole database machine and both authentication machines were stopped. Auth, REST, and careers returned 503 even though deployment reported success.
**Repro/evidence:** Fly machine inventory for exact SHA `05cda612` shows database stopped and GoTrue stopped. In deploy run `29139277754`, the database machine reached `stopped`, Fly classified that state as good because no service health check existed, and the script printed `OK deploy db`. It then logged REST 503 and six Auth 503 probes, continued to migrations, and succeeded because app `/api/health` returned 200.
**Suggested fix:** Diagnose the machine exit-code-1 root cause, require running-state plus dependency readiness, and make every failed retry or probe fail the deploy.
**Status:** fixed historically (the latest readback reports database, auth, queue, migration, and release identity ready on older build `3ff485...`; `/api/ready` remains 503 only at `agentFrameworks`. Exact-release restart, restore, HA, and sustained-stability proof remain open in the current release findings)

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
**Status:** fixed in source (33b0aed; normalized admin-only connection authority, deployment-owned origin policy, composite key binding, legacy-state stripping, audit trail, and application tests pass; real PostgreSQL and restored-clone execution remain unproven)

## 2026-07-11 - SSRF guard allows hexadecimal IPv4-mapped IPv6 literals
**Severity:** security
**File:** src/lib/api/url.ts:80
**Issue:** The private-IP parser handles only dotted `::ffff:a.b.c.d`, but Node URL canonicalizes mapped literals to hexadecimal IPv6. Private and metadata addresses are classified as public.
**Repro/evidence:** At the audited SHA, `http://[::ffff:127.0.0.1]/`, mapped `10.0.0.1`, and mapped `169.254.169.254` all passed `assertPublicUrl()` after URL canonicalization.
**Suggested fix:** Use a standards-complete address parser and a fetch path that pins the validated connection address; add mapped-literal and DNS-rebinding tests.
**Status:** fixed (33b0aed; mapped, reserved, link-local, metadata, NAT64, non-global IPv6, redirect, and DNS-rebinding cases pass the focused suites and independent security review)

## 2026-07-11 - Service-only claim RPC does not revoke PUBLIC execute
**Severity:** security
**File:** supabase/migrations/0011_outreach_approval_lifecycle.sql:224
**Issue:** The migration revokes `claim_and_record()` from `authenticated` and grants `service_role`, but it does not remove PostgreSQL's default function EXECUTE privilege from PUBLIC.
**Repro/evidence:** No later migration revokes the function from PUBLIC or asserts the caller role. Production ACL could not be queried because the database is down.
**Suggested fix:** Revoke from PUBLIC, anon, and authenticated, add a caller-role assertion, and test final privileges after every migration.
**Status:** fixed in source (33b0aed; migration 0019 resets current and future API-role privileges, explicitly allowlists routines, and static contracts pass; disposable PostgreSQL execution remains blocked by unavailable Docker registry/backend access)

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
**Status:** fixed (33b0aed; local high/critical audit gate, Dust 32/32, full tests, lint, typecheck, and isolated build pass; exact-SHA GitHub proof pending)

## 2026-07-11 - Remote third-party MCP tools can cross the production tool boundary
**Severity:** security
**File:** src/lib/mcp-client.ts; src/lib/ai/tool-loop.ts; src/app/api/hermes/chat/route.ts
**Issue:** Environment-enabled remote MCP discovery and execution could expose third-party tool definitions to production model loops and run an administrator-configured remote tool without a production-specific deny boundary.
**Repro/evidence:** The prior policy relied on an enable flag rather than an explicit production denial at route, loop, and client layers.
**Suggested fix:** Make production denial unconditional, require an exact nonproduction environment plus explicit opt-in, and bound discovery, definitions, calls, results, and time.
**Status:** fixed (33b0aed; production/default-off route and low-level environment probes, model-loop filtering, result-envelope injection tests, port policy, and encoded-secret containment passed independent review)

## 2026-07-11 - Supabase default privileges can regrant future public objects
**Severity:** security
**File:** supabase/migrations/0019_agent_authority_and_integrations.sql
**Issue:** Revoking current table and routine privileges is not durable when the Supabase initializer retains default API-role grants for objects later created by the migration owner or `supabase_admin`.
**Repro/evidence:** The official Supabase Postgres initializer defines default grants. A later table, sequence, or function could therefore regain API-role access without appearing in the current-object allowlist.
**Suggested fix:** Reset default privileges for both owners and test newly created probe objects against every API role.
**Status:** fixed in source (33b0aed; current and future table, sequence, function, schema, and PG17 MAINTAIN checks are in the disposable database matrix; live PostgreSQL execution remains pending)

## 2026-07-11 - Image scan was not bound to the deployed application artifact
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml; deploy-fly.sh
**Issue:** CI scanned a locally built application image while Fly rebuilt the application during deployment, so a green scan did not prove the deployed image was the scanned artifact. Failure paths also skipped release evidence upload.
**Repro/evidence:** The earlier workflow generated CI supply-chain evidence, then invoked a source build in Fly. Its artifact step ran only after every prior step succeeded.
**Suggested fix:** Build once with production inputs, scan the saved image, publish the same image, deploy its immutable digest, verify the running digest, and archive partial evidence on every outcome.
**Status:** fixed in source (33b0aed; release-chain validator accepted YAML, actionlint, 83/83 infrastructure, 34/34 deploy, 17/17 bootstrap, failure inventory, and digest binding; online registry and Fly execution remain unproven)

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
**Status:** fixed in source (33b0aed; static 12/12 and exact-image container/restart test pass; preserved production-volume inspection and Fly deployment remain pending)

## 2026-07-11 - Volume remount can silently hide a legacy PostgreSQL cluster
**Severity:** correctness
**File:** docker/db/entrypoint.fly.sh
**Issue:** Reusing the same volume at `/var/lib/postgresql` could hide a cluster previously written at the volume root and let the image initialize an empty cluster under `data/`.
**Repro/evidence:** A synthetic legacy volume with root-level `PG_VERSION`, `base`, `global`, and `pg_wal` was remounted at the parent path. Without a guard those markers are outside the image data directory.
**Suggested fix:** Fail before entrypoint initialization when legacy or unexpected root entries exist, and inspect a preserved production-volume clone before deployment.
**Status:** fixed in source (33b0aed; wrapper exits 78 and creates no child cluster; production clone inspection remains pending)

## 2026-07-11 - Optional Supabase role makes database first boot fail
**Severity:** correctness
**File:** docker/db/01-roles.sql
**Issue:** The first-boot script unconditionally altered `supabase_functions_admin`, but the pinned image creates that role only when its pg_net setup path applies. The missing role aborted database initialization.
**Repro/evidence:** The exact custom database image exited 3 at `ALTER USER supabase_functions_admin`; after making only that extension-dependent role conditional, the same image became ready and survived two restarts with persisted data.
**Suggested fix:** Keep required connection roles fail-closed and conditionally alter only the extension-dependent role.
**Status:** fixed in source (33b0aed; exact-image first boot and restart proof pass; Fly execution remains pending)

## 2026-07-11 - Shared database credential preserved privileged substitution paths
**Severity:** security
**File:** docker/bootstrap/run.fly.sh; docker/bootstrap/supabase-admin-reconciliation.sql; deploy-fly.sh
**Issue:** The former bootstrap path reused one database password and could perform owner work through inherited role authority, so a runtime or migrator credential could retain more authority than its service required.
**Repro/evidence:** The replacement requires four distinct active database passwords, performs owner work only in a direct `supabase_admin` superuser session, performs numbered migrations only in a direct `postgres` NOSUPERUSER session, and disables unused login roles.
**Suggested fix:** Preserve the direct-session boundary and retire every temporary bootstrap credential before runtime activation.
**Status:** fixed in source (33b0aed; real PostgreSQL authority, rotation, idempotence, retired-password, and cross-owner denial tests pass; live Fly proof pending)

## 2026-07-11 - Database initialization could log role passwords and JWT policy
**Severity:** security
**File:** docker/db/00-aria-init-log-policy.sql; docker/db/postgresql.schema.sql; docker/bootstrap/supabase-admin-reconciliation.sql
**Issue:** The pinned initializer expands secret-bearing role statements before role-local logging policy exists, and bootstrap reconciliation rotates credentials and writes JWT settings.
**Repro/evidence:** The replacement suppresses statement text, failed-statement text, and error parameter values across first initialization and the owner transaction, then resets normal logging only after successful reconciliation. Canary scans found none of the injected credential or JWT markers.
**Suggested fix:** Keep the early log policy first in lexical init order and preserve the completion marker as the boundary for re-enabling normal logging.
**Status:** fixed in source (33b0aed; first-init and post-restart canary scans pass; managed Fly log proof pending)

## 2026-07-11 - Numbered migration attempted cross-owner privilege mutation
**Severity:** correctness
**File:** supabase/migrations/0019_agent_authority_and_integrations.sql; docker/bootstrap/supabase-admin-reconciliation.sql
**Issue:** Migration 0019 mixed application-schema work with owner-local default ACL and Auth ownership changes that a direct NOSUPERUSER `postgres` migrator cannot reliably perform.
**Repro/evidence:** Owner-local ACL, role rotation, Auth ownership, and JWT configuration now execute in one direct `supabase_admin` transaction; migration 0019 contains only work permitted to the direct `postgres` migrator. Cross-owner mutation probes are denied while the complete ledger remains idempotent.
**Suggested fix:** Keep privileged reconciliation separate from numbered application migrations and test both identities independently.
**Status:** fixed in source (33b0aed; two-phase real-PostgreSQL test passes; production migration ledger pending)

## 2026-07-11 - Three custom production images bypassed release promotion controls
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml; .github/workflows/ci.yml; deploy-fly.sh
**Issue:** Database, bootstrap, and Kong images were remotely rebuilt or pushed without the application image's scan, provenance, immutable-reference, and running-digest controls.
**Repro/evidence:** The replacement builds all four custom images for `linux/amd64`, pulls and scans the exact candidate digest, creates CycloneDX and signed attestation evidence, promotes only the same digest, deploys exact digest references, and compares running digests before acceptance.
**Suggested fix:** Keep every custom runtime image inside one exact-SHA build-scan-attest-promote-deploy chain.
**Status:** fixed in source (33b0aed; CI/release contracts pass 98/98 and deploy contracts pass 60/60; exact-SHA GitHub registry and amd64 execution pending)

## 2026-07-11 - First immutable-tag promotion hashed an empty manifest
**Severity:** correctness
**File:** .github/workflows/deploy-aria-mantu.yml; tests/infra-release-contract.mts
**Issue:** Bash suppresses `set -e` inside a function used as an `if` condition. When an exact-SHA tag did not yet exist, `digest_for` continued after the failed inspect and returned the SHA-256 of empty input, falsely classifying the tag as an existing conflicting artifact.
**Repro/evidence:** Both digest functions now explicitly return on inspect failure, empty manifest, hash failure, or malformed digest. An executable absent-tag regression probe passes, and the infrastructure release contract is 96/96.
**Suggested fix:** Preserve explicit returns inside conditional shell functions; never rely on inherited `errexit` semantics for release identity.
**Status:** fixed in source (33b0aed; live registry first-promotion proof pending)

## 2026-07-11 - Image secret scan omitted config and build history
**Severity:** security
**File:** .github/workflows/ci.yml; .github/workflows/deploy-aria-mantu.yml
**Issue:** Trivy secret scanning inspected image files but did not enable image-config scanning, so a credential embedded in ENV, config, or build history could pass.
**Repro/evidence:** Both four-image scan loops now add `--image-config-scanners secret` beside the filesystem secret scanner. The release contract asserts the flag, order, and fail-closed exit in CI and release.
**Suggested fix:** Preserve both filesystem and image-config scanning for every custom image.
**Status:** fixed in source (33b0aed; infrastructure release contract 98/98; exact registry-image execution pending)

## 2026-07-11 - CycloneDX evidence was not schema validated
**Severity:** test-gap
**File:** .github/workflows/ci.yml; .github/workflows/deploy-aria-mantu.yml
**Issue:** The SBOM gate checked only three JSON fields and could accept a malformed document that did not conform to the CycloneDX schema.
**Repro/evidence:** Every app, database, bootstrap, and Kong SBOM now runs through the digest-pinned official CycloneDX CLI v0.32.0 with JSON, v1.6, and fail-on-errors selected. The validator digest is included in release evidence.
**Suggested fix:** Keep full schema validation in both CI and release before attestation or promotion.
**Status:** fixed in source (33b0aed; static contracts pass; local Docker Hub route timed out, so exact-SHA amd64 execution pending)

## 2026-07-11 - Known Gitleaks false positives made the protected CI gate red
**Severity:** test-gap
**File:** .gitleaksignore; tests/databricks-intake.mts; src/app/api/source/sillage/start/route.ts
**Issue:** Six reviewed non-secret matches in committed history and one synthetic current fixture caused Gitleaks to exit 1, preventing an exact-SHA release even though no credential was present.
**Repro/evidence:** The replacement uses six exact historical fingerprints, restructures the synthetic Databricks token fixture, and allows only two source lines whose Sillage request field names trigger the LinkedIn client-id rule. A 205-commit scan plus current tests and src scans report no findings.
**Suggested fix:** Keep ignores fingerprint- or line-specific; never allowlist an entire source, relay, or credential directory.
**Status:** fixed in source (33b0aed; local Gitleaks 8.30.1 is green; exact GitHub action proof pending)

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
**Status:** fixed (33b0aed; 2026-07-14 rerun reached every recovery assertion and exited 0, including the exact image, two restarts, legacy cutover/recreate, unsafe-layout blocks, and init-secret-free recreate)

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
**Status:** fixed (33b0aed; dependencies and Graphify 0.9.14 are vendored with checked hashes, the container builds without network, and `npm run test:graphify-learning` passed exact-runtime, network-none, deterministic graph, and receipt checks)

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
**Status:** fixed (33b0aed; migration 0028 removes authenticated message DML, owner-binds message/conversation/spec authority, accepts only durable sent receipts, routes human queueing through one bounded RPC, and passes 46/46 static plus disposable PostgreSQL authority/replay/isolation proof)

## 2026-07-13 - Alternate agent-run route invents missing hiring requirements
**Severity:** correctness
**File:** src/lib/agents/runtime-policy.ts:60; src/app/api/agents/run/route.ts:92
**Issue:** A title-only stored brief is expanded to Senior, Full-time, Remote, and Standard urgency, then the alternate agent route can run real model and search work without the reviewed-need and role-evidence gates used by the sourcing route.
**Repro/evidence:** `normalizeStoredAgentRoleBrief` supplies those defaults and the route does not call the campaign readiness, unsafe-input, reviewed-query, or sourcing-receipt authority.
**Suggested fix:** Fail this incomplete legacy execution path closed in production until it consumes the same reviewed campaign and receipt authority as `/api/sourcing-agent`; preserve unknown facts as unknown.
**Status:** fixed (33b0aed; the route returns 503 before parsing input or resolving credentials, invented role defaults were removed, and the disabled-path/need-authority suites pass)

## 2026-07-13 - Alternate agent-run route has browser-owned provider authority and no durable replay receipt
**Severity:** security
**File:** src/app/api/agents/run/route.ts:50
**Issue:** The browser selects provider, key identifier, model, and an arbitrary existing-candidate array. The route lacks same-origin enforcement, a database idempotency/quota claim, a server-owned configuration fingerprint, completion receipt, and live role/config/key revalidation around each external call.
**Repro/evidence:** The request schema accepts every authority input directly; the key is resolved once and reused; the per-node callback rechecks only active spec ownership.
**Suggested fix:** Disable the incomplete route in production or rebuild it on server-owned configuration, database claims, exact receipts, and per-egress revalidation.
**Status:** fixed (33b0aed; the route returns 503 before parsing browser authority or touching providers, secrets, candidates, or persistence; focused disabled-route tests pass)

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
**Status:** fixed (33b0aed; browser Flowise identifiers and the upstream proxy were removed, all public methods fail closed, and the private compiler accepts only ARIA's strict node vocabulary; focused policy/client tests pass)

## 2026-07-14 - DeerFlow and Flowise were described as frameworks without being used
**Severity:** spec-mismatch
**File:** src/lib/agents/graph.ts:1; _agent_state/mantu-goal/goal-2026-07-08-aria-enterprise-ready.json
**Issue:** The current agent graph explicitly implements an older DeerFlow-inspired pattern in plain TypeScript, the executor is now disabled, and Flowise was only an unsafe optional prediction proxy. Goal milestone m5 records the custom graph as done even though Tony now requires actual DeerFlow and Flowise frameworks.
**Repro/evidence:** Before this shift neither pinned runtime existed in deployment definitions. Current source pins DeerFlow `fabadae4168db81f0eaaf62f209050f978e2f691` and Flowise `bb773ffa710bd22639c4ba2643413a0ea2b679d3`, executes approved Flowise IR through the private DeerFlow adapter, and provides a ten-app private Fly deployment pack. The aggregate framework suite passes 42/42.
**Suggested fix:** Reopen framework milestones, keep ARIA as authority, use a pinned private DeerFlow adapter plus isolated Flowise authoring/import, and require live two-tenant framework E2E before completion.
**Status:** fixed in source (33b0aed; actual pinned framework runtimes, private adapters, governed execution, and deployment definitions now exist; promoted image digests, deployed adapters, and live E2E remain release blockers below)

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
**Status:** fixed (33b0aed; the full disposable PostgreSQL conversation authority test including migration replay passes)

## 2026-07-14 - Owner recovery was absent from CI
**Severity:** test-gap
**File:** .github/workflows/ci.yml:37; .github/workflows/ci.yml:128
**Issue:** The source exposed operator and database recovery test scripts, but neither gate ran in CI or through the aggregate `npm test` command.
**Repro/evidence:** The pre-fix workflow contained no `test:owner-recovery` or `test:db-owner-recovery` invocation. The operator gate also needs the quality job's installed Node dependencies, while the database gate belongs in the Docker-backed database job.
**Suggested fix:** Run the operator contract in `quality` after `npm ci` and the PostgreSQL authority test in `database-security`.
**Status:** fixed (33b0aed; workflow YAML parses and the recovery contract verifies both actual run commands)

## 2026-07-14 - Owner binding committed before password login was proven
**Severity:** correctness
**File:** scripts/recover-orphan-workspace-owner.sh:427
**Issue:** The script called the durable recovery RPC before attempting password login. A confirmed-looking but non-login-capable GoTrue identity could therefore commit the workspace/profile binding and fail only afterward, leaving the tenant recovered on paper but unusable.
**Repro/evidence:** The behavior test originally required `recovery.rpc` before `auth.password-login`. A new rejected-login scenario proves the RPC is never reached and the exact pre-binding identity is cleaned up.
**Suggested fix:** Prove the exact active email identity through password login before the recovery RPC, then use its token for post-binding RLS verification.
**Status:** fixed (33b0aed; operator contract, behavior suite, disposable owner-recovery database proof, and pinned real-GoTrue integration pass with `login=prebinding-verified`)

## 2026-07-14 - Recovery RPC accepted an unmarked GoTrue identity
**Severity:** security
**File:** supabase/migrations/0031_orphan_owner_recovery_authority.sql:269
**Issue:** The shell required a deterministic request marker, but the service-role database RPC checked only email/provider/account fields. A direct RPC caller could bypass the reviewed marked-identity invariant.
**Repro/evidence:** The disposable database test now clears `raw_user_meta_data` and invokes the RPC with otherwise valid service-role authority; it receives `identity_not_eligible` and performs no recovery mutation.
**Suggested fix:** Derive the exact marker from request ID and verified approval SHA inside the RPC and require it in `raw_user_meta_data`.
**Status:** fixed (33b0aed; migration 0062 delegates the exact identity decision to the restricted Auth-owner bridge, and both owner-recovery database and pinned real-GoTrue integration proofs pass)

## 2026-07-14 - Concurrent retry cleanup could delete another attempt's user
**Severity:** correctness
**File:** scripts/recover-orphan-workspace-owner.sh:180
**Issue:** Exact retries share the deterministic request marker. If two operators observed empty Auth and one create lost with a conflict, its cleanup could mistake the other in-flight attempt's user for its own and hard-delete it before binding.
**Repro/evidence:** The adversarial mock returns a create conflict while exposing another attempt's exact-request user. Pre-fix cleanup matched only the shared marker and deleted it.
**Suggested fix:** Add a random per-attempt cleanup ID to GoTrue metadata and require both the deterministic marker and attempt ID before deletion.
**Status:** fixed (33b0aed; behavior suite proves the foreign-attempt user is preserved while own failed pre-binding users are deleted)

## 2026-07-22 - Tenant authorization trusted stale GoTrue tokens until JWT expiry
**Severity:** security
**File:** supabase/migrations/0061_active_auth_identity_workspace_authority.sql; docker/bootstrap/auth-owner-bridges.sql
**Issue:** Tenant profile policies and workspace-role helpers trusted `auth.uid()` without rechecking the backing GoTrue identity. A banned, soft-deleted, or no-longer-confirmed user could retain database access until an already-issued token expired.
**Repro/evidence:** Migration 0061 delegates the bounded active-identity decision to an Auth-owner bridge, then rebinds profile policies, workspace lookup, role lookup, and workspace provisioning. `tests/gotrue-active-identity-integration.sh` runs pinned GoTrue against the real ownership model and reports `PASS: pinned GoTrue, Auth-owner bridge ACL, workspace provisioning, and stale-token revocation` after replaying one pre-ban token across banned, unconfirmed, and soft-deleted states. The canonical database manifest exits zero.
**Suggested fix:** Preserve the exact bridge owner and ACL, and require the active identity predicate at every tenant-authority entry point.
**Status:** fixed (33b0aed; real pinned-GoTrue and full database proofs pass)

## 2026-07-22 - Owner recovery crossed the real Auth-owner boundary directly
**Severity:** security
**File:** supabase/migrations/0062_orphan_owner_recovery_auth_bridge.sql; docker/bootstrap/auth-owner-bridges.sql
**Issue:** A postgres-owned recovery RPC could not safely inspect `auth.users` directly under GoTrue's real `supabase_auth_admin` ownership and row-security boundary without either failing or broadening authority.
**Repro/evidence:** Migration 0062 delegates only the exact recovery identity decision to `auth.aria_orphan_owner_recovery_identity_status`, owned by `supabase_auth_admin`. Forward, rollback, and bootstrap tests require the exact owner, SECURITY DEFINER mode, volatility, search path, return type, and service-only execution ACL. `tests/orphan-owner-recovery-db.sh` and the pinned real-GoTrue integration both pass inside the canonical database manifest.
**Suggested fix:** Keep Auth-owner reads inside the narrow bridge and leave all tenant mutation and CAS authority in the postgres-owned recovery RPC.
**Status:** fixed (33b0aed; forward, rollback, ACL, real-owner, and stale-token proofs pass)

## 2026-07-14 - Pinned DeerFlow tool schema made every real model request fail
**Severity:** correctness
**File:** infra/agent-frameworks/model-gateway/server.mjs; infra/agent-frameworks/deerflow-config.yaml
**Issue:** The pinned DeerFlow runtime always binds its built-in `review_skill_package` tool even when the ARIA agent and skill declare no tools. The model gateway rejected every request containing `tools`, so a real proposal could never reach the cloud model.
**Repro/evidence:** The exact pinned DeerFlow commit and locked `langchain-openai` 1.2.1 request included the built-in schema. The gateway now accepts only that byte-semantically exact schema, strips it and optional literal `tool_choice: "none"` before egress, disables streaming fallback, and rejects every schema drift or additional tool. Focused gateway tests pass.
**Suggested fix:** Keep the exact locked schema contract synchronized with the promoted DeerFlow image; never forward tool authority to the provider.
**Status:** fixed (33b0aed; exact-schema acceptance, negative drift, egress stripping, and non-streaming compatibility tests pass)

## 2026-07-14 - Provider responses could restore stripped local tool authority
**Severity:** security
**File:** infra/agent-frameworks/model-gateway/server.mjs
**Issue:** After request-side tool stripping, a malicious or compromised provider could still return `tool_calls` or legacy `function_call`; LangChain would parse that response and DeerFlow could execute its locally bound built-in.
**Repro/evidence:** Adversarial upstream fixtures return valid assistant text plus each tool-call shape. The gateway now returns a generic 502 and never relays either response; focused tests pass for both formats.
**Suggested fix:** Preserve response-side tool-call rejection whenever the request boundary strips all tool authority.
**Status:** fixed (33b0aed; both current and legacy provider tool-injection tests pass)

## 2026-07-14 - Shared Redis let Flowise mutate DeerFlow stream authority
**Severity:** security
**File:** infra/agent-frameworks/compose.yaml; infra/agent-frameworks/adapter/server.mjs
**Issue:** DeerFlow, Flowise, their worker, and both adapters shared one Redis service, volume, and password. Compromise of Flowise's broad OSS runtime therefore granted authentication to DeerFlow's stream state.
**Repro/evidence:** The stack now has distinct `deerflow-redis` and `flowise-redis` services, volumes, password files, dependency graphs, and mode-bound adapter host authority. Fly adapter startup additionally requires `REDIS_HOST` to equal the exact reviewed `REDIS_FLY_HOST`. Cross-framework host/secret assertions and Compose rendering pass.
**Suggested fix:** Keep Redis credentials and state per framework even when both services use the same promoted Redis image digest.
**Status:** fixed (33b0aed; 31/31 framework adapter/gateway/deployment tests and `docker compose config -q` pass)

## 2026-07-14 - Gateway rejected schema-valid large grounded needs
**Severity:** correctness
**File:** infra/agent-frameworks/model-gateway/server.mjs; infra/agent-frameworks/compose.yaml
**Issue:** The gateway imposed a hidden 16 KiB per-message limit and production configured only 64 KiB total, while the reviewed ARIA need contract permits a UTF-8 prompt of about 126 KiB before DeerFlow's system envelope.
**Repro/evidence:** A 130 KiB framework prompt failed with 400 before the fix. The production ceiling is now 256 KiB, individual messages share that total bound, and the same regression returns 200 while oversized bodies still fail before egress.
**Suggested fix:** Keep application schema bounds and gateway byte ceilings in one tested compatibility contract.
**Status:** fixed (33b0aed; 130 KiB compatibility and request-overflow tests pass)

## 2026-07-14 - Adapter readiness did not prove the cloud model was usable
**Severity:** correctness
**File:** infra/agent-frameworks/adapter/server.mjs; infra/agent-frameworks/compose.yaml
**Issue:** DeerFlow adapter readiness checked only the framework's configured model list. After startup, a provider outage, HTTP 402 account failure, or gateway model drift could still leave adapter and ARIA readiness green.
**Repro/evidence:** Readiness now derives `/readyz` from the canonical private model base URL, authenticates with the internal gateway token, and requires the exact configured provider and model before any DeerFlow dependency can be healthy. Wrong provider/model fixtures and unavailable-gateway readiness fail closed.
**Suggested fix:** Preserve authenticated live provider/model proof in every activation heartbeat; a configured model name is not readiness.
**Status:** fixed (33b0aed; exact authenticated gateway and negative drift/readiness tests pass)

## 2026-07-14 - Oversized upstream streams were rejected without cancellation
**Severity:** security
**File:** infra/agent-frameworks/adapter/server.mjs
**Issue:** When a chunked DeerFlow or Flowise response exceeded 2 MB, the adapter threw and released the stream reader without cancelling it, allowing the upstream connection and response production to continue after rejection.
**Repro/evidence:** An incremental 6 MB upstream fixture remained open before the fix. The adapter now cancels the reader on overflow; the fixture observes connection closure before completion while the client receives the same generic 502.
**Suggested fix:** Cancel bounded response streams before releasing their reader on every overflow path.
**Status:** fixed (33b0aed; streamed-overflow cancellation regression passes)

## 2026-07-14 - Demo localStorage accepted real and manual candidate PII
**Severity:** security
**File:** src/lib/store.ts; src/lib/store/sourcing-actions.ts; src/lib/store/migrations.ts
**Issue:** The no-Supabase demo could call real GitHub or web providers and accept manual candidates, then serialize the resulting candidate PII into cleartext localStorage with no provenance guard.
**Repro/evidence:** Before the fix, `syntheticSourcingAllowed()` selected a branch that still called `/api/source` for explicit GitHub and web platforms, manual intake used the same persisted commit, and both commit paths plus the final localStorage flush accepted non-synthetic candidates.
**Suggested fix:** Make browser-local candidate authority synthetic-only, reject real and manual actions before I/O, recheck explicit provenance at commit and flush, and purge legacy unsafe snapshots during hydration.
**Status:** fixed (33b0aed; focused privacy and sourcing boundary gate passes 46/46, legacy unsafe snapshots are purged, and the final 164-command aggregate passes)

## 2026-07-14 - Framework stack had no controlled private Fly deployment path
**Severity:** spec-mismatch
**File:** infra/agent-frameworks/fly/operator.mjs; infra/agent-frameworks/fly/*.toml
**Issue:** Compose contracts could not create or verify the ten private production services, and there was no approval, immutable artifact, secret-import, network, readiness, or replay authority for a Fly rollout.
**Repro/evidence:** The new source pack defines separate private apps for both PostgreSQL stores, both Redis planes, gateway, DeerFlow, Flowise, worker, and adapters. Its prepare/confirm/deploy operator binds a 15-minute approval to config and image digests, verifies cosign signature/SBOM/provenance and Trivy results, imports file secrets over stdin, uses exact `--image` and `--no-public-ips`, and requires current network, Machine, platform-check, and authenticated private identity evidence before a receipt. `npm run test:agent-framework-adapter` passes 42/42, all ten TOML files pass `flyctl config validate`, shell/Node/Python syntax checks pass, and Bake renders seven wrapper targets.
**Suggested fix:** Keep this operator in the protected release gate and archive its owner-reviewed manifest, plan, approval, and receipt without secret material.
**Status:** fixed in source (33b0aed; no Fly mutation or production receipt was produced)

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
**File:** supabase/migrations/0059_candidate_payload_provenance.sql; src/app/api/agents/memories/route.ts
**Issue:** Candidate data embedded in agent-run/event JSON, framework-result payloads, and encrypted AgentSpec memory has no explicit candidate provenance that an administrator can target for erasure.
**Repro/evidence:** Migration 0059 attaches explicit candidate provenance to run, event, and framework result payloads and removes direct `service_role` mutation of the legacy payload tables. Production POST and content PATCH operations on AgentSpec memory now return non-cacheable `403 memory_content_writes_disabled`; reads, metadata, review, and deletion remain available. The focused provenance, memory-route, candidate-erasure, privilege, rollback, and canonical lifecycle gates pass.
**Suggested fix:** Preserve the provenance and production free-text boundary. Provider-held data and post-restore erasure replay remain separate external obligations.
**Status:** fixed in source; provider-erasure evidence and restore replay remain open under their dedicated findings

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
**Status:** fixed (33b0aed; candidate privacy passes 9/9, store contracts pass 11/11, and TypeScript passes)

## 2026-07-14 - Late legal hold state disappeared from the reloaded admin queue
**Severity:** correctness
**File:** src/components/candidates/candidate-drawer.tsx:91; src/components/candidates/candidate-drawer.tsx:458
**Issue:** The API and database could return `blocked_legal_hold`, but the drawer's obligation parser and durable-queue validator rejected that valid state after a page reload.
**Repro/evidence:** A regression first failed because neither validator allowlisted `blocked_legal_hold`; the focused contract now requires both paths to preserve it.
**Suggested fix:** Keep the UI status allowlist aligned with the canonical erasure state type and OpenAPI enum.
**Status:** fixed (33b0aed; candidate erasure contract passes 4/4 and TypeScript passes)

## 2026-07-14 - Late legal hold degraded provider actions to an availability error
**Severity:** correctness
**File:** src/app/api/admin/candidates/erasure/route.ts:390
**Issue:** The database returned `blocked_legal_hold` for both provider-authority inspection and reconciliation, but the PATCH route rejected that valid state as an untyped 503.
**Repro/evidence:** The regression first received HTTP 503 for both actions after a late hold. The route now maps both database results to the canonical non-final HTTP 423 response.
**Suggested fix:** Keep route, database, and OpenAPI legal-hold states aligned.
**Status:** fixed (33b0aed; candidate route passes 10/10, OpenAPI contract passes, and TypeScript passes)

## 2026-07-14 - Stale inbound workers could recreate erased contact rows
**Severity:** security
**File:** supabase/migrations/0033_candidate_erasure_authority.sql:837
**Issue:** A worker that claimed inbound work before erasure could later recreate raw suppression, WhatsApp contact/window, or conversation identity after the local scrub committed.
**Repro/evidence:** The tombstone trigger originally guarded workspace state, messages, outreach, and Apollo only. It now also rejects erased email, phone, LinkedIn, and candidate identifiers in suppression, WhatsApp contact/window, and conversation writes with SQLSTATE 23514.
**Suggested fix:** Preserve these guards and the shared normalized identity locks; add candidate provenance for the remaining run/event/framework/memory paths in the next migration.
**Status:** fixed for the bounded contact paths (33b0aed; both transaction lock orders pass and leave zero raw rows after rejected writes)

## 2026-07-14 - AgentSpec dependency failures appeared as missing memory
**Severity:** correctness
**File:** src/app/api/agents/memories/route.ts
**Issue:** The owned-AgentSpec lookup collapsed database errors and confirmed absence into null, so GET, POST, PATCH, and DELETE returned 404 during a retryable database failure. The authentication lookup also ignored its returned error.
**Repro/evidence:** Adversarial route tests first received 404 or 201 with injected AgentSpec/auth dependency errors. The lookup now has found, not_found, and unavailable states; auth and database errors return non-cacheable 503 while only confirmed absence returns 404.
**Suggested fix:** Keep dependency errors distinct from resource absence at every authority boundary.
**Status:** fixed (33b0aed; memory route tests pass 20/20)

## 2026-07-14 - Candidate drawer could cross candidate erasure authority
**Severity:** security
**File:** src/components/candidates/candidate-drawer.tsx; src/lib/store.ts
**Issue:** Late queue, inspect, or completion responses could update a newly opened candidate. Typed 423 holds discarded their body, successful erasure could leave click-time PII visible after hydration failure, and an anonymized tombstone still exposed incompatible restore controls.
**Repro/evidence:** Every request now carries an abort controller and candidate/open generation scope checked after each await. A 423 clears decrypted authority and reloads the queue; a valid receipt masks local state before fallible hydration and closes the drawer; the store commit boundary preserves tombstones and restore exits before any suppression DELETE.
**Suggested fix:** Keep UI request authority candidate-scoped and treat erasure tombstones as permanently immutable.
**Status:** fixed (33b0aed; candidate erasure, privacy, and store contract suites pass)

## 2026-07-14 - Framework recovery changed a successful idempotent response
**Severity:** correctness
**File:** src/lib/agents/framework/execution.ts; supabase/migrations/0032_agent_operational_authority.sql
**Issue:** A first successful framework run returned its bounded report summary, but recovery after a lost response returned reports as an empty array for the same idempotency key.
**Repro/evidence:** Migration 0032 now persists exactly one bounded public report summary with the proposal digest. Recovery validates it and returns the original complete response; missing or malformed reports fail closed and changed replay reports conflict.
**Suggested fix:** Preserve the full public response contract in durable idempotency authority.
**Status:** fixed (33b0aed; framework execution passes 15/15 and database/rollback authority passes)

## 2026-07-14 - Fly adapter configuration mixed provider and private runtime URLs
**Severity:** correctness
**File:** infra/agent-frameworks/fly/operator-core.mjs; src/lib/agents/framework/configuration-core.mjs; scripts/agent-framework-heartbeat-worker.mjs
**Issue:** The Fly operator injected the public Moonshot/OpenAI origin as DeerFlow's private model-gateway URL, while its HTTP-only private adapters were rejected by ARIA and heartbeat's HTTPS-only checks.
**Repro/evidence:** The operator now injects the exact private gateway and adapter origins, derives and verifies the configuration digest from that environment, and shares one credential-free .internal URL policy across configuration, ARIA readiness, and heartbeat. Public origins remain rejected.
**Suggested fix:** Keep cloud-provider identity distinct from private gateway identity and test generated deployment values across every consumer.
**Status:** fixed (33b0aed; Fly deployment 15/15, framework configuration/contract, and heartbeat tests pass)

## 2026-07-14 - Candidate erasure queue mutated state through an unprotected GET
**Severity:** security
**File:** src/app/api/admin/candidates/erasure/route.ts; docs/api/openapi.yaml
**Issue:** Queue listing refreshes expired holds and request states in PostgreSQL, but GET accepted a missing Origin and therefore performed state changes outside the same-origin JSON mutation boundary.
**Repro/evidence:** Queue listing is now PATCH action list with the exact same-origin JSON boundary. GET is side-effect free and returns 405 with Allow: POST, PATCH; the drawer and OpenAPI use the new contract.
**Suggested fix:** Keep all state-changing reads behind an explicit mutation contract.
**Status:** fixed (33b0aed; route 11/11 and OpenAPI contract pass)

## 2026-07-14 - Candidate erasure and stale reimport were not transaction-serialized
**Severity:** security
**File:** supabase/migrations/0033_candidate_erasure_authority.sql; tests/candidate-erasure-db.sh
**Issue:** Reimport triggers read tombstones without sharing a transaction lock with erasure, so a concurrent writer could pass before tombstone commit and recreate PII afterward.
**Repro/evidence:** Erasure and all nine reimport triggers now lock the same normalized workspace/identity keys in deterministic order. Real two-session tests prove writer-first erasure waits then scrubs the committed row, while erasure-first writer waits then rejects with SQLSTATE 23514 and persists no row.
**Suggested fix:** Preserve the shared identity-lock authority and both lock-order regressions.
**Status:** fixed (33b0aed; candidate database authority and database privilege gates pass)

## 2026-07-14 - Private readiness could leave the reviewed Machine through redirects or proxies
**Severity:** security
**File:** infra/agent-frameworks/fly/runtime/private-probe.py:63
**Issue:** The DeerFlow in-Machine readiness probe used default urllib redirect and environment-proxy behavior, so readiness could be supplied by an origin other than the exact `FLY_PRIVATE_IP`.
**Repro/evidence:** The regression rejects a 302 and an inherited `HTTP_PROXY`, asserting that neither the redirect target nor proxy receives a request.
**Suggested fix:** Keep the no-redirect, no-proxy transport isolated in `private_http.py` and preserve the executable regression in the Fly deployment suite.
**Status:** fixed (33b0aed; Fly deployment suite passes 15/15)

## 2026-07-14 - Release documentation drifted from workflow-derived evidence
**Severity:** test-gap
**File:** README.md; production-readiness/STATUS.md; production-readiness/DEPLOYMENT_RUNBOOK.md; docs/ARCHITECTURE.md; tests/docs-truth.mts
**Issue:** Current release docs still described six scanned images, four local attestations, 24 application tables, and ten active framework apps after the workflow, inventory, and operator had changed.
**Repro/evidence:** The protected workflow declares seven scanned and five locally attested components; the table inventory is canonical; the framework operator has eight active and two release-disabled roles. The docs test previously passed without checking those facts.
**Suggested fix:** Derive supply-chain counts from the workflow, refer to the canonical table inventory without a copied count, and keep active/disabled topology explicit.
**Status:** fixed (33b0aed; documentation truth passes 39/39)

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

## 2026-07-21 - Autonomous sourcing worker cannot execute a sourcing job
**Severity:** spec-mismatch
**File:** scripts/sourcing-loop-worker.mjs; scripts/sourcing-loop-handlers/
**Issue:** The production `loop` process has an empty handler allowlist, so it records maintenance heartbeats and may drain outbound messages but can never claim or execute a sourcing, provider-poll, enrichment, shortlist, or draft job.
**Repro/evidence:** The worker now exposes the exact four-handler contract `autonomous_web_sourcing|campaign_create|requisition_parse|sourcing_batch`, claims only those purpose-bound jobs, and dispatches through isolated handlers. Runtime proof passes 35/35, autonomous provider runtime passes 15/15, and the disposable PostgreSQL authority passes 51 assertions including crash recovery, replay, kill switch, ambiguity, erasure, guarded rollback, and reapply.
**Suggested fix:** Keep sourcing activation dark until the exact release passes the protected live canary and shared-throttle gates.
**Status:** fixed in source; live activation remains gated

## 2026-07-21 - Protected Fly release proof excludes the loop process
**Severity:** correctness
**File:** fly.app.toml; scripts/verify-apollo-cleanup-release.mjs; .github/workflows/deploy-aria-mantu.yml
**Issue:** Fly configuration declares the `loop` process, but release verification allowlists only `web`, `cleanup`, and `framework_heartbeat`. A real loop Machine is therefore either absent from the accepted inventory or rejected as an unexpected process group.
**Repro/evidence:** Release verification now requires the loop topology, exact image/release identity, and a fresh database heartbeat whose handler digest matches the canonical four-handler contract. Deploy fixtures and infrastructure contracts pass 141/141 and 142/142. Live Fly still runs an older build and is not evidence for this source repair.
**Suggested fix:** Preserve exact process inventory and verify it again after the protected deployment.
**Status:** fixed in source; exact-release Fly proof remains pending

## 2026-07-21 - Durable need-to-campaign runtime is absent
**Severity:** spec-mismatch
**File:** supabase/migrations/0049_need_ingress_authority.sql; supabase/migrations/0050_requisition_parse_authority.sql; supabase/migrations/0052_campaign_create_authority.sql
**Issue:** The schema can store and transition requisitions, but no application route or worker invokes `ingest_requisition`, `record_requisition_parse`, or `record_requisition_campaign`. A received need therefore cannot become a reviewed campaign and sourcing job without browser-driven manual state changes.
**Repro/evidence:** Migrations 0049 through 0053 and the need, parser, campaign, and worker routes provide tenant-bound idempotent ingress, private raw-input authority, a real approved cloud-model parse, deterministic campaign creation, clarification for incomplete needs, reconciliation, and sourcing enqueue. The canonical lifecycle, focused route/runtime suites, and disposable PostgreSQL gates pass.
**Suggested fix:** Keep public ingress disabled until shared edge-throttle evidence exists, then prove the exact live zero-send chain.
**Status:** fixed in source; public ingress and live canary remain gated

## 2026-07-21 - Ordinary sourcing results are lost after a persistence failure
**Severity:** correctness
**File:** supabase/migrations/0027_sourcing_learning_authority.sql:36; src/app/api/sourcing-agent/route.ts:737; src/lib/sourcing/sourcing-agent-client.ts:73; src/lib/store/sourcing-actions.ts:735
**Issue:** Non-framework sourcing completes its durable run with counts and query receipts, returns candidate data only in the HTTP response, and then relies on the browser to replace the full workspace document. If that client write conflicts, disconnects, or is superseded, the original candidates cannot be recovered; the offered retry creates a new idempotency key and can repeat provider work.
**Repro/evidence:** Migration 0058 now stages a bounded result before completion, recovers it under the original run without provider egress, and scrubs it after receipt-backed acknowledgement, expiry, or erasure. Its rollback refuses while migration 0059 remains applied; its replay preserves the byte-identical 0059 receipt constraint. The focused durability gate and the full 30-command database manifest both exit zero.
**Suggested fix:** Persist a bounded encrypted or normalized candidate result under the run before completion, and make the same idempotency key atomically commit or replay that result without another provider call.
**Status:** fixed (33b0aed; ordinary sourcing stages a bounded result, recovers it without provider egress, binds an exact durable workspace receipt, acknowledges idempotently, and scrubs on acknowledgement, expiry, and erasure)

## 2026-07-21 - Empty and all-skipped sourcing results had no durable persistence proof
**Severity:** correctness
**File:** supabase/migrations/0058_ordinary_sourcing_result_durability.sql; src/lib/store/sourcing-actions.ts; src/lib/store.ts
**Issue:** Candidate-presence acknowledgement cannot prove an empty batch and cannot finish when every observed candidate is intentionally skipped by dedupe, exclusions, or contact-window policy. Such runs would remain staged until expiry and block clean sequential recovery.
**Repro/evidence:** The database regression first rejects acknowledgement without a marker, then accepts zero-hit and all-skipped commits only after an activity ID binds the exact sourcing run UUID and result SHA-256. The marker is written atomically with accepted candidates and intentional skips.
**Suggested fix:** Keep the exact `sourcing-run:<run-id>:<result-sha256>` marker as the durable processing receipt and never acknowledge from an unbound activity or candidate count alone.
**Status:** fixed (33b0aed; application lifecycle, both typechecks, exact 0058/0059 constraint transitions, and the full database manifest pass; the focused gate reports `behavior=pass concurrency=pass acl=pass rollback=guarded reapply=pass rows=8`)

## 2026-07-21 - Readiness can be green while autonomous sourcing is inert
**Severity:** correctness
**File:** src/app/api/ready/route.ts; src/lib/readiness.ts; supabase/migrations/0054_sourcing_batch_authority.sql
**Issue:** Production readiness proves only that the outbound queue table is queryable. It does not require a fresh loop heartbeat, the exact release identity, a non-empty expected handler set, bounded oldest-job age, or absence of dead jobs.
**Repro/evidence:** The route now calls the service-owned readiness RPC for the exact release and accepts only its exact bounded schema. Operational readiness requires at least one expected handler, a fresh heartbeat no older than 90 seconds, oldest runnable job age at most 120 seconds, and zero overdue, dead, ambiguous, or overdue-begun work. A dark release remains ready without claiming autonomous sourcing or public need ingress. The real database suite passes 59 assertions and the pure readiness suite passes 23/23.
**Suggested fix:** Preserve the release-bound RPC, exact response schema, dark-versus-operational capability split, and queue-health limits.
**Status:** fixed (33b0aed; sourcing database 59 assertions and readiness 23/23 pass)

## 2026-07-21 - 50,000-user capacity has no accepted staging receipt
**Severity:** test-gap
**File:** docs/operations/capacity/workload-profile.v1.json; scripts/capacity-release-gate.mjs; docs/operations/FLY_SIZING.md
**Issue:** A bounded staging gate now exists, but its proposed workload is not owner-ratified and no staging observation, platform-metrics export, or accepted receipt exists. It cannot establish 50,000-user readiness from source alone.
**Repro/evidence:** The deterministic harness passes 11/11 and truthfully rejects production, unapproved profiles, synthetic metric fixtures, and missing telemetry. The checked-in profile remains `pending-owner`, points to an `.invalid` origin, assumes 500 peak sessions and 16.67 RPS, uses one synthetic session, and exercises read-only health, readiness, candidate, and agent-spec routes. It does not test 500 distinct sessions, multi-tenant distribution, writes, provider throughput, stress, soak, or failover.
**Suggested fix:** Ratify measured workload profiles, provision production-shaped isolated staging, add session-pool, write, provider-stub, stress, and soak revisions, capture exact-window platform telemetry, and accept signed or independently reviewed receipts for the exact release before a 50,000-user claim.
**Status:** open; the harness is executable, but capacity remains UNKNOWN until external staging evidence is accepted

## 2026-07-21 - Substring matching invents skill evidence and inflates candidate rank
**Severity:** correctness
**File:** src/lib/sourcing/candidate-mappers.ts:31; src/lib/sourcing/candidate-mappers.ts:88; src/lib/sourcing/candidate-mappers.ts:206
**Issue:** GitHub, Apollo, and web candidate mapping treat any case-insensitive substring as proof of a required skill. Short skills such as `Go`, `R`, or `C` therefore match unrelated words and are added to `techStack`, where they increase the candidate's skills score.
**Repro/evidence:** With required skill `Go`, no top language, and GitHub bio `Google engineer`, `mapGithubCandidates` returned `techStack: ["Go"]`, a skills score of 82, and rationale `1/1 required ... skills present`. The same `includes` predicate is used for Apollo headlines and web title/snippet text.
**Suggested fix:** Use a canonical, boundary-aware skill and alias matcher that records the exact evidence span and source. Keep ambiguous or absent evidence unknown, and add regressions for `Go`/`Google`, `R`/`research`, `C`/`CTO`, aliases, punctuation, and case.
**Status:** fixed (33b0aed; red-to-green sourcing regression 57/57, focused TypeScript and ESLint pass)

## 2026-07-21 - LLM-bound autonomous sourcing lacks a durable provider-evidence contract
**Severity:** spec-mismatch
**File:** supabase/migrations/0060_autonomous_web_sourcing_authority.sql; src/lib/sourcing/autonomous-web-runtime.ts
**Issue:** The reusable LLM sourcing runner returns mapped candidates and query summaries, but not a normalized provider-response digest or a canonical external identifier for every source. Migration 0054 can validate only one anonymous GitHub query, so it cannot authorize or atomically attest multi-provider LLM-bound execution.
**Repro/evidence:** Migration 0060 binds job, lease, fence, tenant, exact verified Tavily credential version, finite SQL-derived LinkedIn query, request/response digests, observed canonical profile URLs, staged candidate evidence, quota, ambiguity, final settlement, retention, and erasure. Lost-response and commit-uncertainty paths never repeat provider egress. Runtime passes 15/15 and database authority passes 51 assertions with rollback/reapply proof.
**Suggested fix:** Do not widen the provider or query set without an equally purpose-bound migration and observed-evidence contract.
**Status:** fixed in source; live credential, activation, and no-contact canary remain pending

## 2026-07-21 - Runtime binding approval did not bind immutable credential material
**Severity:** security
**File:** supabase/migrations/0055_ai_runtime_binding_authority.sql:404
**Issue:** Independent review approved an `api_key_id`, but an administrator could update that row's encrypted secret, provider, tenant, or display fingerprint after activation. The binding hashes would remain unchanged while runtime secret resolution returned different credential material.
**Repro/evidence:** Migration 0003 grants administrators update access to `api_keys`. Before this fix, neither the table nor migration 0055 rejected an in-place secret replacement. The disposable database regression now attempts active and unbound secret substitution plus tenant and provider substitution and receives SQLSTATE 55000 in every case.
**Suggested fix:** Keep credential identity append-only, rotate by inserting a new untested row and independently approving a new binding set, allow immediate invalidation, and reserve monotonic test-evidence updates and restoration to valid for the service-owned key-test workflow.
**Status:** fixed (33b0aed; AI runtime binding database outcomes 32/32, static contract 12/12, and function privilege contract 21/21 pass)

## 2026-07-21 - Workspace Tavily resolution accepted unverified key rows
**Severity:** security
**File:** src/lib/sourcing/tavily.ts:18
**Issue:** Workspace sourcing selected the newest Tavily row without requiring `status = valid` and trusted an incompletely projected response, so invalid, untested, cross-workspace, or wrong-provider credential material could reach decryption and provider use.
**Repro/evidence:** The former query selected only `secret` and had no status predicate. Regressions now reject invalid, untested, cross-workspace, wrong-provider, and live-verification-missing rows, while asserting the query and returned row are tenant, provider, validity, and verification-method bound.
**Suggested fix:** Preserve both the database predicates and the defensive response-shape checks before decryption.
**Status:** fixed (33b0aed; Tavily credential and redaction suite 30/30 passes)

## 2026-07-21 - Missing workspace Tavily authority silently selected a process-wide key
**Severity:** security
**File:** src/lib/ai/web-tools.ts:225; src/app/api/sourcing-agent/route.ts:478
**Issue:** Bound sourcing converted a missing or undecryptable workspace Tavily key to `undefined`; the web tool interpreted `undefined` as permission to use `process.env.TAVILY_API_KEY`. Tenant-scoped authority failure could therefore cause unreviewed egress under a shared deployment credential.
**Repro/evidence:** Red tests proved the cloud route passed `undefined` to its runner and the web tool called Tavily with the process key after workspace resolution returned null. The explicit authority contract now reserves `undefined` for deliberate system fallback and treats `null` as a fail-closed tenant boundary; bound sourcing normalizes omitted keys to null.
**Suggested fix:** Keep null and undefined semantically distinct and require tenant-scoped routes to pass null after an unsuccessful workspace lookup unless a separate reviewed global-fallback authority is introduced.
**Status:** fixed (33b0aed; route boundary, web-tool fallback, and bound execution regressions pass)

## 2026-07-21 - Credential valid status does not prove live provider authentication
**Severity:** spec-mismatch
**File:** src/app/api/keys/test/route.ts:166
**Issue:** Stored OpenAI, Anthropic, Groq, XAI, Mistral, Kimi, and Tavily credentials were marked `valid` after format validation only. Runtime binding activation therefore proved reviewed credential identity and structural plausibility, not live provider authentication.
**Repro/evidence:** Each LLM execution credential uses a fixed official model-list authentication endpoint with redirect refusal, an eight-second timeout, bounded response parsing, and no provider-body return or logging. Tavily standard keys use the authenticated non-search `/usage` endpoint and persist `tavily_usage_v1`; existing Enterprise `tavily_key_info_v1` evidence remains accepted. Migration 0055 persists the exact method and HTTP status, downgrades legacy format-only execution rows, and rejects missing or NULL evidence at staging, activation, resolution, and Tavily selection.
**Suggested fix:** Preserve the live evidence requirement and retest stored execution credentials after migration 0055. Keep legacy non-binding integrations separate from runtime-binding authority.
**Status:** fixed in source; Tavily 30/30, binding database 35 assertions, provider/runtime suites, both TypeScript checks, and canonical lifecycle pass

## 2026-07-21 - Cached Tavily authority survived row revocation during a sourcing run
**Severity:** security
**File:** src/app/api/sourcing-agent/route.ts:459; src/lib/sourcing/tavily.ts:67
**Issue:** The route decrypted a valid tenant Tavily key once, then reused it without rechecking that exact credential row before later search egress. Revocation or deletion during an in-flight model call could therefore allow one more external search.
**Repro/evidence:** The route now retains only the credential row ID beside the in-memory key and rechecks the exact ID, workspace, provider, status, and live-verification method at every external boundary. The regression revokes the row during the model call and proves the following search runner is never invoked.
**Suggested fix:** Keep credential-row authorization in the shared per-egress callback and preserve the post-provider authority recheck before any result classification.
**Status:** fixed (33b0aed; sourcing route authority 29/29 and bound execution 6/6 pass)

## 2026-07-21 - Zero-vulnerability Flowise worker image contained no runtime dependencies
**Severity:** correctness
**File:** infra/agent-frameworks/upstream/flowise.Dockerfile
**Issue:** The first distroless Flowise worker build passed the zero-HIGH/CRITICAL scan only because `pnpm prune --prod` removed the workspace runtime dependencies. The resulting image could not start Flowise.
**Repro/evidence:** The image was only 65.7 MB; its exported filesystem contained an empty `app/node_modules/.pnpm` and empty package `node_modules` directories. Running Node against `/app/packages/server/bin/run` exited with `MODULE_NOT_FOUND`.
**Suggested fix:** Produce a lock-bound offline production deployment containing every transitive runtime dependency, prove Oclif and native module startup inside the exact image, then rerun the unsuppressed Trivy policy.
**Status:** fixed (33b0aed; final official-tag comparison image `sha256:dcc584efb8df74fa1301de7271ac1726aa46210d697c34ae5cd4a603d4e5f257` is 535,139,124 bytes, loads every asserted server/component/native runtime module, starts the real worker through Oclif, and reaches only the deliberately unreachable Redis boundary)

## 2026-07-21 - Audited Flowise revisions fail the unsuppressed release policy
**Severity:** security
**File:** infra/agent-frameworks/upstream/flowise.Dockerfile; src/lib/agents/framework/source-identity.mjs
**Issue:** Neither the current canonical Flowise revision nor official Flowise 3.1.3 satisfies the required zero-HIGH/CRITICAL production-image policy once the complete runtime dependency graph is present.
**Repro/evidence:** The current canonical image scan reported 15 CRITICAL and 116 HIGH findings. The hardened official-tag comparison image above was scanned with pinned Trivy 0.72.0 digest `sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f`, scanners `vuln,secret,misconfig`, severities `HIGH,CRITICAL`, and no suppression flags. It reported 18 CRITICAL, 167 HIGH, zero secrets, and zero HIGH/CRITICAL misconfigurations. The official tag is therefore worse, not a safe pin rotation.
**Suggested fix:** Keep Flowise execution disabled, remediate or replace the affected production dependency graph at a newly audited immutable revision, rebuild from a clean cache, and require the same exact zero-finding scan before promotion.
**Status:** open; Flowise activation and deployment remain NO-GO

## 2026-07-21 - Sourcing loop polling leaked one abort listener per normal wake
**Severity:** correctness
**File:** scripts/sourcing-loop-worker.mjs:607
**Issue:** The worker's normal sleep path resolved its timer without removing the abort listener registered for that tick. A continuously running worker accumulated one listener every polling cycle and could eventually emit listener warnings or retain avoidable closures.
**Repro/evidence:** A red unit test used a counting AbortSignal and observed one add with zero removes after a normal timer wake. The revised delay removes the listener on every settle, clears the timer, and closes the abort-registration race.
**Suggested fix:** Preserve the symmetric timer and listener cleanup in the exported delay helper.
**Status:** fixed (33b0aed; sourcing loop worker 30/30 and test typecheck pass)

## 2026-07-21 - Database regression gates were stale after dedicated job and manifest authority landed
**Severity:** test-gap
**File:** tests/loop-jobs-db.sh:239; tests/orphan-owner-recovery-contract.mts:165; tests/requisition-parse-db.sh:1824
**Issue:** Three recovery gates exercised obsolete contracts: the generic queue suite completed a sourcing batch through the now-forbidden generic RPC, the recovery contract required an explicitly named CI command even when the canonical database manifest contained the gate, and the parse race harness invoked a deliberately revoked internal ingestion primitive as service_role.
**Repro/evidence:** The suites failed respectively with `sourcing batch completion requires its dedicated authority`, a false CI assertion, and `permission denied for function ingest_requisition_and_enqueue`. The tests now use an ordinary queue kind, validate the canonical manifest membership, and exercise the internal lock-order primitive only through the postgres-owned harness while retaining service claims.
**Suggested fix:** Keep generic queue tests on generic kinds and update integration contracts whenever an authority path becomes purpose-bound.
**Status:** fixed (33b0aed; recovery 20/20 plus behavior, loop queue 41 assertions plus race, requisition parse 119 assertions, and retention 22 assertions all pass)

## 2026-07-21 - Next image runtime inherited newly disclosed libvips vulnerabilities
**Severity:** security
**File:** package.json
**Issue:** The current Next.js package resolved `sharp` 0.34.5, which the current npm advisory database marks affected by four high-severity inherited libvips CVEs under GHSA-f88m-g3jw-g9cj.
**Repro/evidence:** `npm audit --audit-level=moderate` reported two high findings through `next -> sharp` with affected range `<0.35.0`. The package override now resolves `sharp` 0.35.3 and libvips 8.18.3; `npm audit --audit-level=moderate` reports zero findings, a native transform passed, and Next's own `optimizeImage` path produced a valid resized WebP.
**Suggested fix:** Keep the tested Next-scoped `sharp` override until Next's declared optional dependency accepts a fixed release, and retain both dependency-audit and exact-image scan gates.
**Status:** fixed (33b0aed; lock resolution, zero audit, native transform, Next image-optimizer smoke, production build, and exact Linux image scan pass)

## 2026-07-21 - Production image policy exempted unfixed high and critical vulnerabilities
**Severity:** security
**File:** .github/workflows/ci.yml; .github/workflows/deploy-aria-mantu.yml; Dockerfile.prod
**Issue:** CI and production promotion passed `--ignore-unfixed=true` to Trivy. An exact image could pass even when its runtime contained unfixed HIGH or CRITICAL findings.
**Repro/evidence:** After removing the exemption, the prior Debian 12 runner failed with 22 findings: 17 HIGH and 5 CRITICAL. The final stage now uses the exact pinned nonroot Distroless Node 22 Debian 13 image. Local exact image `sha256:b7d12374c82a311ab9d2e460b683be24e0d452baeaad1694846577f70eaba5c6` built successfully, ran as UID 65532, executed Sharp 0.35.3 with libvips 8.18.3, passed web and worker command smokes, and returned zero findings under the pinned unsuppressed Trivy 0.72.0 gate.
**Suggested fix:** Preserve the no-exemption scan policy, pinned minimal runner, native-module smoke, and exact saved-image scan in every promotion.
**Status:** fixed (33b0aed; infrastructure release contract 136/136 and exact image scan 0 HIGH/CRITICAL)

## 2026-07-21 - Database security job lacked its lockfile dependencies
**Severity:** test-gap
**File:** .github/workflows/ci.yml
**Issue:** The consolidated `database-security` job invoked the canonical database manifest on a fresh GitHub runner without installing Node dependencies. Node/tsx-backed manifest entries would fail before the database authority gate ran.
**Repro/evidence:** The job had checkout and setup-node followed directly by `npm run test:database`. It now runs `npm ci --ignore-scripts --no-audit --no-fund` first, and the release contract verifies ordering.
**Suggested fix:** Keep the exact lockfile install ahead of the canonical database manifest.
**Status:** fixed (33b0aed; infrastructure release contract 136/136)

## 2026-07-21 - Single-volume database and unmeasured connection budget block HA claims
**Severity:** spec-mismatch
**File:** fly.db.toml; fly.app.toml; fly.auth.toml; fly.rest.toml; docs/operations/FLY_SIZING.md
**Issue:** The source topology explicitly permits only one PostgreSQL Machine and one durable volume, while the repository defines no measured PostgreSQL, PostgREST, or Auth pool budget. This is a single failure domain and cannot support a high-availability or 50,000-user capacity claim.
**Repro/evidence:** `fly.db.toml` warns that a second Machine would have an empty independent volume. Source files declare intended VM sizes and request concurrency, but no replication, failover target, connection-pool limit, query saturation result, or accepted load receipt exists. `docs/operations/FLY_SIZING.md` correctly labels source sizing as intent only.
**Suggested fix:** Select an approved replicated or managed database design, bind every service pool to a measured database connection budget, prove restore and failover objectives, and accept production-shaped load, stress, and soak receipts before raising capacity status.
**Status:** open; architecture, paid staging, telemetry, and owner approval are external gates

## 2026-07-21 - Promoted Graphify lessons were not consumed by durable sourcing authority
**Severity:** spec-mismatch
**File:** supabase/migrations/0054_sourcing_batch_authority.sql; scripts/sourcing-loop-handlers/sourcing-batch.mjs
**Issue:** The autonomous GitHub batch used only its deterministic role query. Human-promoted Graphify lessons existed, but no pre-egress authority selected, froze, validated, replayed, or attested an applied lesson.
**Repro/evidence:** The authority now accepts only a human-promoted, unexpired, exact-workspace and exact-role lesson at its current reviewed version, linked to a current completed Graphify export. Its query must already equal the server-derived GitHub query and match the workspace HMAC. The exact lesson, review, artifact, query identity, and snapshot hash are stored in the claim before egress, reused across retries, and copied into the append-only completion receipt.
**Suggested fix:** Preserve query equality, exact review and Graphify binding, worker-side snapshot validation, and claim-based replay. Do not reread mutable lesson rows after the claim exists.
**Status:** fixed (33b0aed; worker 28/28, authority 14/14, sourcing-batch database 66 assertions, sourcing-result durability database pass, both TypeScript checks, and diff hygiene pass)

## 2026-07-21 - Autonomous worker and database readiness advertised different handler contracts
**Severity:** correctness
**File:** supabase/migrations/0060_autonomous_web_sourcing_authority.sql; scripts/sourcing-loop-worker.mjs
**Issue:** The worker advertised four handlers after autonomous web sourcing landed, but database readiness still expected the three-handler 0054 digest and count. Every fresh exact-release worker would be reported as `contract_mismatch`.
**Repro/evidence:** Migration 0060 now replaces the expected digest and combined readiness atomically with the four-handler authority. It includes autonomous dead jobs, ambiguous failures, and attempts unsettled for more than five minutes without double-counting dead job IDs. Its guarded rollback restores normalized byte-equivalent 0054 three-handler definitions before dropping 0060 tables. Worker proof passes 35/35, autonomous database proof passes 51 assertions, sourcing-batch database proof passes 78 assertions, and rollback/reapply return 4 to 3 to 4 exactly.
**Suggested fix:** Keep handler-set expansion, readiness, worker identity, rollback, and deploy acceptance in the same reviewed release slice.
**Status:** fixed in source

## 2026-07-21 - Production observability had no standard export or release SLO gate
**Severity:** spec-mismatch
**File:** src/instrumentation.ts; src/lib/observability/; docs/operations/OBSERVABILITY.md
**Issue:** Local structured logs alone could not prove production-stage latency, error rate, queue lag, provider ambiguity, or exact-release readiness to an external operator.
**Repro/evidence:** Source now initializes the standard OpenTelemetry Node SDK with OTLP trace and aggregate metric export, redacts receipts, emits critical sourcing-stage evidence, and fails production readiness closed when required telemetry configuration is missing. Observability, readiness, bootstrap, deploy, infrastructure, typecheck, lint, and isolated-build gates pass.
**Suggested fix:** Provision the approved OTLP collector, retention, alert destinations, and on-call ownership, then verify receipt arrival for the exact deployed SHA.
**Status:** fixed in source; external collector, alert routing, retention, and on-call proof remain open

## 2026-07-21 - GitHub release gates cannot execute and Production targets a stale branch
**Severity:** correctness
**File:** .github/workflows/ci.yml; .github/workflows/deploy-aria-mantu.yml
**Issue:** Required CI and CodeQL checks cannot start because of the repository Actions budget, and the only Production environment branch policy still names `deploy/fly-github-actions` while the hardened workflow accepts only `refs/heads/main`.
**Repro/evidence:** Every latest failing job has zero steps and the annotation `The job was not started because an Actions budget is preventing further use.` Workflow `Deploy Aria Mantu (Fly)` is `disabled_manually`. The `Production` environment has no required reviewers, no environment secrets, and one custom branch policy for `deploy/fly-github-actions`. The additional workflow environments `Production-Need-Ingress-Throttle-Proof` and `Production-Sourcing-Activation` do not exist. Protected `main` requires all seven checks, one independent approval, last-push approval, administrators included, linear history, and no force push.
**Suggested fix:** Restore Actions capacity, configure the three environments with reviewed branch and reviewer policies, add the individually required secrets without restoring the legacy bundle, re-enable the workflow, and rerun every required context for the exact merged SHA.
**Status:** open; protected merge and production deployment are externally blocked

## 2026-07-21 - Hardened deployment has no usable GitHub secret set
**Severity:** security
**File:** .github/workflows/deploy-aria-mantu.yml
**Issue:** The workflow now requires purpose-bound database, auth, registry, recovery, sourcing, framework, telemetry, and canary secrets, but GitHub exposes only the obsolete repository-level `ARIA_DEPLOY_BUNDLE` and no Production environment secrets.
**Repro/evidence:** `gh secret list` returned only `ARIA_DEPLOY_BUNDLE`; `gh secret list --env Production` returned no entries. The workflow deliberately no longer consumes the bundle and requires individual names including Fly tokens, Supabase keys, database passwords, sourcing execution authority, framework adapter tokens, OTLP configuration, and protected canary credentials.
**Suggested fix:** Have an authorized owner populate each exact environment secret and variable through the approved secret manager. Never unpack or recommit the legacy bundle.
**Status:** open; deploy preflight must fail until owner provisioning is complete

## 2026-07-21 - Live release cannot activate a real sourcing binding
**Severity:** spec-mismatch
**File:** supabase/migrations/0055_ai_runtime_binding_authority.sql; .github/workflows/deploy-aria-mantu.yml
**Issue:** Real cloud parsing and Tavily sourcing require a current tenant binding approved by two distinct active administrators, plus live authenticated credential evidence. The observed production workspace has one real administrator, and the last Kimi provider probe returned HTTP 402.
**Repro/evidence:** Source enforces two-person activation and exact live credential methods. Fly secret-name inventory shows legacy provider names but does not prove a tenant-bound valid Tavily row, a funded Kimi account, or an active independently approved binding. No authenticated live need-to-candidate canary exists for this branch.
**Suggested fix:** Add a second real tenant administrator, fund or replace the approved cloud-model provider, verify the workspace Tavily credential through the non-search usage endpoint, activate one exact binding set, and run the protected zero-send canary.
**Status:** open; real production sourcing is not yet proven usable

## 2026-07-25 — Phase 0 sequence authority review
**Severity:** security
**File:** supabase/migrations/0063_outreach_sequence_authority_repair.sql
**Issue:** The initial Phase 0 repair trusted stored approval hashes at activation, exposed manual-task state across workspaces, accepted a same-candidate outbound row without binding its approved content, and left ineligible work retryable.
**Repro/evidence:** The disposable database suite reproduced candidate/body mutation, a cross-workspace manual-completion attempt, a mismatched approved outbound bind, and suppression/missing-recipient claim paths.
**Suggested fix:** Recompute durable approval scope, scope manual completion before state checks, bind the exact approved outbound payload, and terminally cancel ineligible sequences.
**Status:** fixed (`30c8b63`; `bash tests/sequences-db.sh` 116 assertions, full database manifest, both typechecks, complete application test lifecycle, privilege, bootstrap, concurrency, rollback-guard, and reapply proof pass)

## 2026-07-25 - Legacy LinkedIn tombstones did not cover canonical person linking
**Severity:** security
**File:** supabase/migrations/0063_outreach_sequence_authority_repair.sql; tests/person-model-db.sh
**Issue:** The existing person-link helper could compare a legacy LinkedIn URL form without using the canonical candidate-erasure tombstone authority, allowing an erased identity to be considered under a different equivalent URL representation.
**Repro/evidence:** The chronological disposable-database fixture installs the legacy candidate before the 0037 backfill, applies the later migrations, and proves that `link_one_candidate` now delegates to `candidate_erasure_tombstone_exists` for canonical identity matching. `tests/person-model-db.sh` passes 42 assertions.
**Suggested fix:** Preserve the canonical tombstone helper as the single erasure decision for every candidate-to-person link path.
**Status:** fixed (`30c8b63`)

## 2026-07-25 - Newly disclosed dependency advisories invalidated the prior audit result
**Severity:** security
**File:** package.json; scripts/dependency-audit.mjs; production-readiness/dependency-audit-exceptions.json; .github/workflows/ci.yml
**Issue:** The current advisory database marks the prior Next and PostCSS versions vulnerable and reports `GHSA-mh99-v99m-4gvg` through ESLint's `brace-expansion` 1.x dependency. A forced global 5.x override is API-incompatible with the 1.x consumer and breaks lint.
**Repro/evidence:** Next is now 16.2.12 and PostCSS is 8.5.23, so the production graph reports zero HIGH or CRITICAL findings. The remaining development-only advisory is bound to one exact package version and node path, has canonical ordered timestamps, expires 2026-08-08, and tracks the open compatible v1 backport. Ten executable policy cases reject future, reversed, expired, unused, path-drifted, version-drifted, package-mismatched, malformed, and production-vulnerable states. Independent release and security re-reviews pass.
**Suggested fix:** Replace the exception with the compatible fixed v1 release as soon as upstream publishes it; never extend the exception without a new review.
**Status:** fixed (`4d18784`; production audit clean, policy 10/10, infrastructure 147/147, lint, typechecks, application test lifecycle, and isolated build pass)

## 2026-07-26 - Candidate-list receipts could outlive or race governed erasure
**Severity:** security
**File:** supabase/migrations/0064_candidate_lists_authority.sql; tests/candidate-lists-db.sh
**Issue:** Early 0064 revisions retained a candidate-linkable add receipt after erasure, required a sourcing secret before the canonical erasure RPC created it, and allowed a later or concurrent add to recreate the receipt after cleanup.
**Repro/evidence:** Adversarial review recomputed the retained subject HMAC with the workspace key, reproduced the no-secret trigger-order failure, and showed that add did not share the canonical candidate-erasure lock. The final RPC uses the subject HMAC only as a deletion index, skips receipt-HMAC cleanup when no secret exists, takes `candidate_erasure_identity_lock_key(workspace,'candidate_id',candidate)` before any add artifact, and rejects tombstoned candidates without a receipt. The PostgreSQL 17 harness passes 51 assertions, including governed no-secret erasure, post-erasure add, and deterministic add-versus-erasure contention; independent security re-audit reports no open 0064 finding.
**Suggested fix:** Keep every future candidate-bearing mutation on the same erasure identity lock and prove both transaction orders before release.
**Status:** fixed (`be7278d`; 51/51 focused database assertions, both TypeScript checks, complete npm test lifecycle, privilege and recovery gates, Gitleaks, and independent security/QA review pass)

## 2026-07-26 - Candidate-list admission still trusts a best-effort mirror and cannot consume provider evidence
**Severity:** spec-mismatch
**File:** supabase/migrations/0035_candidates_corpus.sql; supabase/migrations/0064_candidate_lists_authority.sql
**Issue:** Migration 0035 declares `public.candidates` a best-effort projection, but 0064 currently requires that row and accepts only manually inserted attestations. A real GitHub or Tavily sourcing result cannot yet become a list member, and a mirror failure can produce a false `candidate_not_found`.
**Repro/evidence:** GitHub evidence is durable in `sourcing_candidate_evidence`; Tavily evidence is durable until expiry in `autonomous_web_candidate_evidence`; neither is resolved by `add_candidate_list_member`. No authenticated RPC creates, supersedes, or revokes a manual attestation, while the focused fixture must insert one as `postgres`.
**Suggested fix:** Add migration 0065 with a private evidence resolver over GitHub, unexpired Tavily, and canonical workspace-state manual evidence; add a narrow attestation RPC with supersession/revocation; remove the mirror foreign keys without weakening erasure.
**Status:** open

## 2026-07-26 - Phase 1 list operations and product surface are not implemented
**Severity:** spec-mismatch
**File:** /Users/tony/.codex/plans/msourcing-linkedin-campaign-control-20260725.md
**Issue:** The current slice creates list authority and one add/read path only. Set operations, bounded export, complete eligibility, shared quota, authenticated API routes, accessible UI, browser E2E, and production-shaped performance evidence remain absent.
**Repro/evidence:** `tests/candidate-lists-db.sh` explicitly excludes those behaviors. No current route or component exposes the normalized 0064 tables to a recruiter workflow.
**Suggested fix:** Complete the ordered Phase 1 slices and four-lane QA before enabling campaign enrollment or claiming real sourcing usability.
**Status:** open

## 2026-07-26 - Recovery inventory omitted Phase 0 outreach tables
**Severity:** correctness
**File:** docker/bootstrap/legacy-baseline-invariants.sql; docker/bootstrap/legacy-table-inventory.txt
**Issue:** Migration 0063 added three outreach authority tables only through runtime replacements in the invariant SQL, while the canonical backup/restore inventory remained at the prior table set. Backup and restore exact-table checks would reject a current 0063 database.
**Repro/evidence:** The mandatory pretest failed when 0064 tables were added to the inventory because the static invariant parser saw only 118 tables. Comparison then showed that the 0063 tables had never entered the inventory. The invariant now has one static 125-table constant containing 0063 and 0064, the sorted inventory is byte-for-byte equal, and `tests/recovery-schema-allowlists.mts` passes 15/15.
**Suggested fix:** Add every future migration table to the single static invariant constant and canonical inventory in the same atomic slice.
**Status:** fixed (`be7278d`; static 125-table equality, recovery schema 15/15, restricted-owner bootstrap, and complete npm test lifecycle pass)

## 2026-07-26 - Provider-only list admission would escape governed erasure
**Severity:** security
**File:** supabase/migrations/0033_candidate_erasure_authority.sql; supabase/migrations/0064_candidate_lists_authority.sql
**Issue:** The proposed 0065 bridge initially treated durable provider evidence as sufficient candidate existence authority. The governed erasure RPC returns not_found when the exact candidate is absent from canonical workspace_state, so provider-only list data would be unreachable by the deletion workflow.
**Repro/evidence:** request_candidate_erasure locks and searches workspace_state before creating the request. public.candidates is explicitly best-effort, but canonical workspace state is not. Security and schema reviews independently reproduced the authority mismatch.
**Suggested fix:** Require exactly one canonical workspace-state candidate for every fresh provider or manual admission while permitting the public.candidates mirror row to be absent.
**Status:** open; required RED contract for migration 0065

## 2026-07-26 - Candidate-list campaign grammar exceeds erasure authority
**Severity:** security
**File:** supabase/migrations/0064_candidate_lists_authority.sql
**Issue:** 0064 accepts campaign text up to 200 characters, while request_candidate_erasure accepts only the canonical 120-character identifier grammar. Candidate-linked members, attestations, and HMAC receipts could otherwise be created for an identity the governed erasure RPC cannot target.
**Repro/evidence:** The 0064 table checks and add RPC use only length bounds for campaign_id; the erasure RPC requires ^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$.
**Suggested fix:** In 0065, atomically preflight incompatible legacy rows and receipts, replace both table checks, and enforce the exact erasure grammar before any secret, HMAC, receipt, attestation, or member write.
**Status:** open; required RED contract for migration 0065

## 2026-07-26 - Manual evidence lifecycle needs one erasable append-only authority
**Severity:** security
**File:** supabase/migrations/0064_candidate_lists_authority.sql
**Issue:** 0064 has no authenticated manual evidence writer. Adding attest and revoke idempotency without changing cleanup and lock order would retain candidate-linkable receipts after erasure or create workspace-to-identity deadlocks and lifecycle forks.
**Repro/evidence:** Current cleanup filters operation_kind to add_member, current add locks identity before any canonical workspace read, and the attestation table has no predecessor, revocation, observation, or idempotency authority.
**Suggested fix:** Use workspace-state then identity then evidence lock ordering, a tenant-and-candidate-bound append-only predecessor chain, completed provider receipt joins, immutable membership snapshots, and erasure cleanup across every candidate-subject receipt operation.
**Status:** open; required RED contract for migration 0065
