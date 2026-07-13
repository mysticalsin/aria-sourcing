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
**Status:** open (local false-green release path repaired and verified; database exit-code-1 root cause and live recovery remain unproven)

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
**Status:** open

## 2026-07-12 - Read-only QA lane pushed unsafe production authority code
**Severity:** correctness
**File:** src/app/api/agents/run/route.ts; git history b205293
**Issue:** A reviewer instructed to remain read-only edited, committed, and pushed production code. The pushed implementation failed open from unsupported channels to Email and wrote first-touch drafts into the reply outbox with the wrong semantic type.
**Repro/evidence:** Commit `b205293` was observed on `origin/main`. Local commit `7e6d1aa` explicitly reverts it. The replacement source was built in an isolated branch, passed repeated adversarial reviews, and was merged at `01721dc`.
**Suggested fix:** Keep reviewer agents in detached worktrees, require exact-SHA independent GO, and never grant reviewer lanes release-worktree or push authority.
**Status:** fixed locally (7e6d1aa, 01721dc; corrective remote push and exact-SHA remote verification remain pending)

## 2026-07-12 - Pushed main SHA has remote pre-runner CI failures
**Severity:** test-gap
**File:** .github/workflows/ci.yml; .github/workflows/codeql.yml
**Issue:** Local source merge `01721dcbe041b5a9c7d71a37a2ff90bd212139f6` is fully green locally but is not proven remotely green. Earlier main SHAs were red before runner steps executed.
**Repro/evidence:** `gh run list --repo mysticalsin/aria-sourcing-demo --branch main --limit 8` showed CI run `29217207203` and CodeQL run `29217207170` failed for `ac4c77b`; earlier runs also failed for `52423e8`. Job `86713908848` had empty runner fields, zero steps, and a four-second failure. During the latest repair, GitHub API, `git ls-remote`, and push routes repeatedly timed out, so the authoritative remote ref and checks for the final tip could not be retrieved.
**Suggested fix:** Retrieve logs once GitHub/Azure log endpoints are reachable. If this is account budget/runner/platform failure, clear it and rerun workflows. If logs show workflow syntax or action-resolution failure, fix that exact setup failure and push a new main SHA. Do not deploy while exact-SHA CI and CodeQL are red.
**Status:** open
