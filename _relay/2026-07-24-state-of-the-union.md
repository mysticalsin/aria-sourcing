---
project: ARIA / MSourcing
agent: claude-code (Opus 5, 1M)
updated: 2026-07-24
status: gate-green-at-a-sha · product-plane-still-blocked
scope: gate truth, rock truth, readiness ledger, sourcing plane, agent plane, Hermes integration, Hermes upstream, ops/docs truth
supersedes_status_of: _relay/2026-07-19-50k-enterprise-readiness-verification.md (gate verdict only)
---

# ARIA state of the union — 2026-07-24

## Headline

**The gate is green and now belongs to a SHA. The product plane is still not autonomous.**

Two separate things were true at once and the repo's own documents could not tell them apart:
the *quality gate* had been fixed, and the *sourcing product* still cannot run a candidate
search end to end without a browser. Every artefact in `.rocket-fuel/` and `_relay/` reported
the first as broken and the second as nearly done. Both were backwards.

## Audit method and boundary

Eight dimensions, run as parallel read-only auditors, then adversarially reviewed. Findings
that a reviewer could refute by inspection were dropped. What is below survived.

- **Executed, not read:** the full gate (seven commands, run separately, never chained), on
  both the dirty tree and the committed tree.
- **Read at source:** every migration, worker, route and test named below, plus the upstream
  Hermes clone at `origin/main`.
- **Not exercised:** production Fly infrastructure, real paid provider calls, real candidate
  outreach, load testing, authenticated admin UX.
- **Degraded:** two of eight dimensions ran without shell access (sandbox profile exceeded the
  OS exec argument limit — see the lessons ledger), and two adversarial review lenses of three
  died on a session limit. The single surviving lens upheld every finding it judged. Treat the
  blocker list as verified and the *absence* of further findings as unproven.

## What is true today, executed

Release SHA `85ab870407aabb91504f0a00a65d3fc2d44aef93`, branch
`integration/sourcing-enrichment-on-main`, working tree clean (0 entries under
`--untracked-files=all`).

| Command | Exit |
|---|---|
| `npm run typecheck` | 0 |
| `npm run typecheck:tests` | 0 |
| `npm run lint` | 0 (10 pre-existing warnings, 0 errors) |
| `npm run test:all` | 0 |
| `npm run test:database` | 0 |
| `npm run test:manifest` | 0 |
| `node --import tsx tests/docs-truth.mts` | 0 |

`test:database` ran against real Docker after starting colima (cpu4/mem8/disk60). It is not a
structural pass: `loop-jobs-db` 41 assertions plus a SKIP LOCKED race, `person-model-db` 42,
`email-durability-db` 22, `candidates-corpus-db` 20, `email-inbound-db` 10, `email-outcomes-db`
9, plus the agent-framework authority, agent-framework provisioning, agent-operational rollback,
conversation authority, Apollo enrichment, cross-channel cap, orphan-owner recovery and
candidate-erasure suites.

## Claims this audit proved FALSE

The point of this list is that the next shift should not re-litigate them.

| Artefact | Claim | Truth at `85ab870` |
|---|---|---|
| `_relay/2026-07-19-…verification.md` | "the owned test gate is red", five canonical defects | All five fixed at root cause in `9732199..b8d00c1`; gate green |
| `.rocket-fuel/ROCKS.md:25,39,55,65,82,96,109` | all seven rocks `Status: NOT STARTED` | Rock 1's proof passes; Rocks 2–7 genuinely not started |
| `.rocket-fuel/state.json:43` | "No code committed by Claude this engagement" | 14 commits this session |
| `.rocket-fuel/state.json:61` | colima started 2026-07-21, DB suites runnable | colima was dead; started fresh this session |
| `.rocket-fuel/PLAN.md:84` | "Highest shipped is `0046`" | `0048` |
| `_relay/HANDOFF.md:6,31-32,70,111` | commits BLOCKED by sandbox `.git` permissions | Resolved ~80 minutes later; five commits landed and the baton was never corrected |
| `_relay/HANDOFF.md:29` | "No shipped numbered migration was edited" | `0043` was modified in the working tree at the time the baton was written |
| `docs/TESTING.md:73-74` | its database list mirrors `ci.yml` | omitted `test:db-loop-jobs` until this session added it |
| `_relay/2026-07-16-owner-actions.md` | "GitHub Actions budget exhausted — CI is DEAD" | unproven either way from the repo; the documents contradict each other |
| `.rocket-fuel/ROCKS-wave2.md:28-32` | Rock W5 DONE, "98 suites 0 failed" | superseded; the gate had since gone red and is now green again |

`_relay/2026-07-19-…verification.md` remains authoritative on **everything except the gate
verdict**. Its readiness analysis is the best document in the repo and most of it still holds.

## Fixed this session

Fourteen commits, `b1c5653..85ab870`. Each one root-cause, one logical change.

**Security**
- Supabase session cookie now `Secure` in production. All four `@supabase/ssr` call sites
  passed `cookieOptions` independently and none set the flag; unified into
  `SUPABASE_COOKIE_OPTIONS`. `b1c5653`
- WhatsApp webhook body bounded *before* buffering and *before* the signature check. An
  attacker without `APP_SECRET` could stream an unbounded body into memory. New
  `readBoundedBody()` rejects an oversized `Content-Length`, then streams and cancels at 1 MB.
  `0755872`
- Classify task now wraps candidate-authored reply text in the `CANDIDATE_REPLY`
  untrusted-data envelope with sanitisation, closing a prompt-injection path into the
  classifier. `c96c66e`
- Rate limits on three unbounded paths: `/api/ready` (3 DB queries + adapter probes per call,
  20/min per IP), `/api/unsubscribe/[token]` (DB hit before any throttle, 30/min per IP),
  `/api/candidates` (multi-column ILIKE + sort + count, 60/min per principal). `6286984`

**Correctness / operations**
- Both long-running workers now exit non-zero on `unhandledRejection` / `uncaughtException`
  instead of surviving as a healthy-looking process that has stopped working. `050f757`
- `RESEND_BASE_URL` override so the send path is testable without reaching the live provider.
  `2d19df7`
- `test:db-loop-jobs` added to CI — the durable job spine had no CI coverage at all. `c7e90cd`
- `docs-truth` now asserts no two migrations share a numeric prefix. `d95ffe5`

**Release integrity**
- `0043` was **edited in place** — a shipped, production-applied migration. That silently
  disables `scripts/backup.sh` and the restore drill, because
  `EXPECTED_MIGRATION_IDENTITIES` is derived from file sha256 and compared against
  `public.aria_schema_migrations`. Reverted and re-issued as `0048`. `31ce9dd`
- `deploy-fly-2.sh` was an **untracked** production deploy surface that read the Fly token
  from disk and sourced production secrets before four `fly deploy` calls, with no release
  authority. `tests/infra-release-contract.mts` structurally could not see it because it
  enumerates from `git ls-files`. Now guarded and registered. `7a7fa37`
- `.gitlab-ci.yml` retired rather than committed: it could not deploy (`deploy-fly.sh` requires
  `GITHUB_ACTIONS` + `GITHUB_REF_PROTECTED`) but did base64-restore the Fly token, production
  secrets and `.env.local` onto a third-party runner and list them into the job log. Preserved
  with reasoning in `_relay/incidents/2026-07-24-gitlab-ci-secret-bundle-retired.md`. `7a7fa37`
- `scripts/prod-swarm-rollout.sh:40` hard-coded `= "45"` migration files against 47 on disk, so
  the owner's swarm rollout **aborted unconditionally**. The release guard above it already
  binds an exact SHA and clean tree, which pins the migration set far harder than a
  hand-bumped literal; replaced with a mirror-vs-checkout integrity check.
- e2e run evidence gitignored, not committed: `06-candidate-list.png`,
  `07-match-score.png`, `09-experience-background.png`, a demo video and a raw scraped profile
  JSON carry candidate PII, and git history is immutable — committing them would put personal
  data permanently beyond the reach of the erasure authority in `0033`/`0041`. `85ab870`

## Open blockers, by plane

Severity is this audit's, deduplicated across the 2026-07-11/16/18/19 audits and verified
against code at `85ab870`. Items already closed above are omitted.

### Sourcing plane — the product does not run headless

1. **The durable job loop registers zero handlers.** `scripts/sourcing-loop-worker.mjs:35`
   has `HANDLER_KINDS = Object.freeze([])`. The queue is an empty pipe. *blocker*
2. **The only live sourcing authority route is browser-bound** — a service-role caller cannot
   reach it, so nothing server-side can drive a search. *blocker*
3. **Scoring, dedupe and the candidate commit all execute in the browser store.** The
   pipeline's decision-making lives client-side, so "headless" is architecturally impossible
   without moving it. *blocker*
4. **The prohibited-criteria gate is bypassed by both vendor-API adapters** (Apify, Apollo).
   The direct Apify adapter reaches a paid provider with raw queries, schools and names and
   never calls the central policy. *high*
5. **No test proves a prohibited query never reaches a provider.** Only the validator is tested
   in isolation; a status-code assertion is not proof. *high*
6. **`0044`'s enrichment budget is dead code.** The claim/settle/release RPCs have no caller;
   tenant spend is still clamped per request from a client-supplied hint
   (`/api/source/enrich` route.ts:42-53,224). *high*
7. **An activated outreach sequence can never advance past its first touch.** *high*
8. **`0042`–`0046` authority is proven only by regex over migration text**, never by executed
   SQL, and the three named DB harnesses (`requisitions-db.sh`, `sourcing-loop-db.sh`,
   `sequences-db`) do not exist. *medium*

### Agent plane — three unrelated generations stacked

9. **The entire swarm plane has zero tests.** `0046` is 2122 lines of authority — roster,
   missions, assignments, lease-bound checkpoints, escalations, 18 RPCs — plus two workers and
   four routes, and no `tests/swarm-*.mts` exists, no swarm id appears in
   `tests/test-manifest.mjs`. It is outside every gate reported green above. *blocker*
10. **The swarm orchestrator worker has no scheduler.** `fly.app.toml:9-13` declares
    web/cleanup/framework_heartbeat/loop and no swarm process; `package.json` has no swarm
    script. The swarm can be enabled and nothing will ever tick it. *blocker*
11. **A cancelled dependency deadlocks its dependents silently** — no escalation, mission stuck
    in `executing` forever. *high*
12. **`in_progress`/handoff continuations are unbounded** — one stuck agent burns LLM spend
    forever with no cap and no escalation. *high*
13. **All four `/api/swarm` mutation handlers bypass the repo's own same-origin/content-type
    request boundary.** *high*
14. **The roster's Orchestrator agent decomposes nothing.** `plan_swarm_assignments` requires
    the caller to supply the decomposition; no planning step exists anywhere, and no producer
    ever creates a mission from a requisition. *high*
15. **Eleven of twelve `aria_jobs` kinds have no handler in any worker.** *medium*
16. **The only user-editable agent prompt surface reaches no server-side prompt**
    (`settings.guardrails.ariaPrompt`, `AgentSeat.persona`). *medium*
17. **Agent prompts live in four disconnected places** — route source, the swarm executor's
    code, DB roster rows, and the external Hermes runtime's own config. There is no versioned
    agent-spec format. *medium*

### Hermes runtime integration

18. **Live Hermes is structurally dead in production.** `isAllowedHermesUrl`
    (`src/lib/api/url.ts:49-63`) accepts only loopback / RFC1918 / `hermes-agent`; production
    is Fly `.internal` DNS (`fly.app.toml:30`). Every reachable host is rejected, every
    accepted host unreachable, and it degrades silently to the mock. *blocker*
19. **Upstream is two servers on two ports and we address both off one `HERMES_API_URL`.**
    aiohttp `api_server.py` (`DEFAULT_PORT = 8642`) serves `/v1/*` and `/api/sessions`; FastAPI
    `web_server.py` (`--port 8080`) serves `/api/status|config|memory|skills|curator|files|system/stats`.
    Six of nine management paths 404. `SystemSettings.hermesWebUrl` exists for exactly this and
    is read by nothing. *blocker*
20. **The generic proxy's bearer resolver is the weak twin of `resolveVaultSecret`.**
    `hermes-proxy.ts:45-49` selects on `workspace_id` only — no `provider`, no
    `status='valid'` — so any workspace member can cause any workspace secret, including a
    revoked one, to be sent as a Bearer token upstream. *high*
21. **Six allow-listed paths do not exist upstream at all**, and `api/health` — the only path a
    non-admin may read in production — is one of them. *high*
22. **Zero upstream contract coverage.** All 64 Hermes assertions pass; every one stubs `fetch`
    and asserts our own assumptions. *high*
23. **Hermes tenant isolation is keyed on `NODE_ENV`** with no runtime assertion, and the
    shipped compose stack runs `NODE_ENV=development` against real Supabase — the fully-open
    posture. *medium*

### Readiness / infrastructure — mostly owner-gated

24. **Production `/api/ready` can never return 200.** `agentFrameworks` is unconditionally
    required in production (`src/app/api/ready/route.ts:23-24`, `src/lib/readiness.ts:55,64`)
    and demands two private DeerFlow/Flowise adapters proving pinned source commits and image
    digests that exist only as source under `infra/agent-frameworks/`. Nothing in this repo can
    satisfy it. *blocker*
25. **Production traffic is gated on shallow `/api/health`** by explicit decision
    (`fly.app.toml:51-67`), so the deep gate is advisory and cannot block a bad release. *high*
26. **Single-machine Postgres**, no replication, no pooler, no proven production restore
    (`fly.db.toml:1-3`). *blocker, owner infra spend*
27. **All four production-unsafe identity defaults are unchanged** — 5-char password floor,
    mailer auto-confirm, email-domain auto-join, first-user auto-admin — and two are now
    *positively asserted as correct* by a currently-green DB contract
    (`tests/db/ensure-workspace-authority.sql:117-259`), so Rock 4 collides with a green test.
    Mitigated only by `GOTRUE_DISABLE_SIGNUP=true`. *high*
28. **Rate limiting is per-instance in memory** (`src/lib/rate-limit.ts:14-20`) behind a Kong
    with no rate-limiting plugin (`fly.kong.toml:13`). *high*
29. **Zero error tracking, tracing or log durability in production.** No observability module
    exists in `src/lib` at all. *high*
30. **`workspace_state` remains the authoritative whole-workspace document**; the normalized
    corpus read path is default-off. *high*
31. **Live schema is one migration behind source**, and remote/local integration histories are
    different commit graphs — ~21 commits including all release hardening are local-only,
    because pushes went through the GitHub REST API rather than `git push`. *medium*
32. **`supabase/rollbacks/` contains exactly one file** against 47 applied migrations. *medium*

## Hermes upstream — the fork problem

Tony's ask was to bring the Hermes process agents up to the newest upstream. The finding that
governs everything else:

`~/.hermes/hermes-agent` is **4444 commits behind** `origin/main` (3755 on first-parent),
merge-base equals local HEAD so it is cleanly fast-forwardable — **except the working tree is a
dirty, unversioned fork**. `gateway/run.py` carries +49/-1 of hand-written patches for a
*different product*, the Amaris WhatsApp HR bot "Mina", whose own comments read
`(Custom Amaris patch — reapply after hermes update.)`. Plus untracked
`gateway/platforms/whatsapp_business.py` (622 lines), `hermes_cli/web_server.py` +164, seven
bridge pairing scripts, and a `web_server.py.orig` left by a `patch` run.

One of those patches is a **security control**: it re-runs the `pre_gateway_dispatch` safety
gate on transcribed voice text, because the gate first ran on the `[ptt received]` placeholder
— without it a spoken grievance bypasses sensitive-topic escalation, the human-handoff keyword
and the FAQ cache. It exists only as an uncommitted diff.

The same Hermes install serves both Mina and MSourcing's sourcing agents
(`HERMES_API_URL=http://127.0.0.1:8642`), so an upgrade for one risks the other.

**Upstream has since absorbed nearly all of it**, which turns a rebase into a migration:
`whatsapp_cloud.py`, `whatsapp_common.py`, `whatsapp_identity.py`, `setup_whatsapp_cloud.py`, a
first-class `plugins/platforms/whatsapp/` **plugin seam**, a maintained bridge with unit tests,
and ~10 `tests/gateway/test_whatsapp_*.py`. Plus security work the fork lacks: webhook body-limit
enforcement, `client_max_size` on three previously uncapped aiohttp apps, DM-allowlist gating on
interactive taps, `WHATSAPP_CLOUD_ALLOWED_USERS` honoured, poll-vote gating, media-download
failure containment, and a non-ASCII `compare_digest` crash fix.

Strategically the most valuable upstream change is **profile multiplexing**: every gateway route
is now mounted twice, bare and at `/p/{profile}{path}`, with a middleware that scopes config
*and credentials* per profile when `gateway.multiplex_profiles` is on
(`api_server.py:1688`, secret scoping via `agent/secret_scope.py::is_multiplex_active`). That is
upstream's own multi-tenancy primitive, and it would retire our homegrown
`HERMES_RUNTIME_WORKSPACE_ID` — which upstream knows nothing about. Alongside it,
`X-Hermes-Session-Key` scopes long-term memory per channel, 403s unless `API_SERVER_KEY` is set,
and rejects CRLF injection — the right primitive for per-tenant candidate memory.

Full inventory of new routes, headers and breaking changes: see the Hermes adoption plan.

## What I did not verify

- Whether hosted CI can run at all. The repo's documents contradict each other and I did not
  query GitHub.
- The `_handle_chat_completions` request/response contract diff and the SSE event shape against
  our stream parser. Both are untested in either direction.
- `run_agent.py`, ACP, and the `plugins/memory` provider contract at `origin/main`.
- Any production Fly state.
