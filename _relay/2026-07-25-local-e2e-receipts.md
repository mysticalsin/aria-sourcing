---
project: ARIA / MSourcing
agent: claude-code (Opus 5, 1M)
updated: 2026-07-25
status: login PROVEN · send-guardrails PROVEN · live sourcing UNPROVABLE on this machine
scope: executed end-to-end run against a local stack — receipts, not assertions
---

# Local end-to-end receipts

Everything below was executed. Nothing here is inferred.

## Setup

Supabase in containers (`docker compose up db db-init auth rest kong supabase-bootstrap`), app
served from a **persistent isolated mirror** in `$TMPDIR` — not from the working tree, for the
reason in "Environment defects" below. Admin created through the GoTrue admin API. Local anon and
service keys are the public Supabase demo JWTs already in `docker-compose.yml:28-29`
(`gitleaks:allow`); no real secret was read, printed or copied.

## PROVEN working

| Claim | Receipt |
|---|---|
| **Every migration applies to a virgin database** | `supabase-bootstrap` exited 0; `aria_schema_migrations` = **47 rows**, tip `0048_requisitions_member_read_via_rpc_only.sql` |
| GoTrue healthy | `{"version":"v2.189.0","name":"GoTrue"}` HTTP 200 |
| PostgREST via Kong | HTTP 200 |
| Kong refuses unauthenticated traffic | `/auth/v1/health` → **401** without an `apikey` |
| **Clean build from the lockfile** | `npm ci` exit 0 then `npm run build` exit 0 in the mirror — after the fix in `f90d852` |
| App serves | `/api/health` → **200** |
| **Login** | password grant → `access_token`, HTTP 200 |
| **First-user-becomes-admin** | `current_profile_role = admin`, with source + outreach permissions |
| **Session cookie contract** | 2349 chars, one part; accepted by `GET /api/source` (`connected=true, anonymous=false`) |
| Intake | `POST /api/intake` → HTTP 200 `ok:true` with a fully parsed `jobAnalysis` |
| **Human approval is recorded server-side** | PASS — the state the client renders as "Pending Manual Send" |
| **LinkedIn cannot auto-send** | `POST /api/outreach/send` → **409 manual-required**, no send fired, no `sent` ledger row |
| **Email stays dry-run** | "Dry-run: confirmLive not set. Nothing sent." |
| **Nothing was delivered** | `outreach_ledger=0` and `messages_outbound=0` for both canary message ids |

`/api/ready` returned, informatively:

```
database:true  auth:true  queue:true  hermesRuntime:true
agentFrameworks:false  migration:false  releaseIdentity:false
```

`hermesRuntime:true` is the component added in `9acbd03` behaving correctly — no runtime
configured is not a fault. `agentFrameworks:false` is the known unsatisfiable blocker.
`migration`/`releaseIdentity` are false only because the release-identity env vars are unset
locally; that is expected for a local run.

## NOT proven — live sourcing, and why

Live sourcing was **not** demonstrated. Three layers, in the order they were hit:

1. **403 `CROSS_ORIGIN_REQUEST`.** The harness sent no `Origin` header, so every sourcing route
   refused it at the request boundary. Fixed in `7be026c` — a browser always sends `Origin`, so a
   harness that omits it was not modelling the real client and was reporting a harness fault as a
   sourcing fault.
2. **409 `CAMPAIGN_AUTHORITY_REQUIRED`.** With `Origin` sent, `/api/source` refuses live campaign
   search **by design** (`src/app/api/source/route.ts:125-134`): it keeps exact-profile intake and
   the signed demo path only, so live search "cannot bypass campaign readiness, idempotency,
   learning receipts, or configuration authority in a live tenant." **The shipped harness's step 3
   targets `/api/source` and therefore cannot ever prove live sourcing against a live tenant.** It
   needs rewriting against the canonical route.
3. **No tool-calling provider key on this machine.** The canonical route is `/api/sourcing-agent`
   (there is no `/api/campaigns/*`), and it requires a tool-calling provider. `.env.local` declares
   `GITHUB_TOKEN`, `TAVILY_API_KEY`, `KIMI_API_KEY`, `KIMI_BASE_URL` — no Anthropic or OpenAI key —
   and kimi is explicitly rejected for tool-calling. Attempting it returned HTTP 400, and with
   `AGENT_PROVIDER=kimi` the draft path returned `Upstream error 401`.

**This is the one thing an owner can unblock immediately:** add an `ANTHROPIC_API_KEY` (or OpenAI)
to `.env.local` and re-run. Everything else in the chain is now proven. I did not invent a key or
weaken the provider gate.

Also note the harness's intake step reports FAIL on an HTTP 200 `ok:true` response carrying a
complete `jobAnalysis` — its assertion is stale, the product step works. Not fixed here; it is a
separate harness correction.

## Defects found by running it

1. **A dead file made a clean build impossible — my regression.** `Floor3DScene.tsx`, landed in
   `1299447`, imports `@react-three/postprocessing`, which was deliberately removed from
   `package.json`/`package-lock.json` on 2026-07-10. `tsc` resolved it from this machine's stale
   `node_modules`. Fixed in `f90d852`.
2. **`tests/isolated-build.mts` does not build anything.** It passes 7 assertions by checking that
   `scripts/build-isolated.mjs` *contains the strings* `"src"`, `"public"`, `"ci"` and
   `delete buildEnv.NEXT_DIST_DIR`, plus that a guide mentions the command. It never executes a
   build. That is why defect 1 shipped green. **`npm run build` is in no gate at all** — the FULL
   GATE is typecheck, typecheck:tests, lint, test:all, test:database.
   *Recommendation: add a real build to CI (not to `test:all`, which would add minutes to every
   run). Changing the locked FULL GATE definition is an owner decision.*
3. **`next dev` from the CloudStorage working tree is unusable, not merely slow.** It logged
   `✓ Ready in 6.8min` and then answered nothing: 240 s on `/api/health`, process at **0.0% CPU,
   sleeping, zero request lines logged**. Stronger than the existing "builds stall" note.
   The workaround is the isolated mirror; `scripts/build-isolated.mjs` already encodes the recipe
   but deletes its directory in `finally`, so it proves a build and leaves nothing runnable.
4. **`scripts/provision-first-admin.sh` cannot be rehearsed locally.** It refuses non-HTTPS
   origins — *"KONG_URL must be one credential-free HTTPS origin."* Correct as a production guard;
   the consequence is that the production admin-provisioning path has **no local dry run**, for a
   system whose first-user-becomes-admin behaviour is the open Rock 4 question.

## Honest readiness statement

Login works. The send guardrails hold under a real attempt. Migrations apply cleanly from zero. The
app builds and serves from the lockfile.

That is **not** production or enterprise ready, and this run does not move those blockers:
`/api/ready` can never return 200 in production while `agentFrameworks` is unconditionally
required; Fly routes traffic on shallow `/api/health` so the deep gate cannot block a bad release;
Postgres is a single machine with no replication, no pooler and no proven restore; rate limiting is
per-instance in memory behind a Kong with no rate-limit plugin; there is no error tracking or
tracing in the tree. And the prohibited-criteria policy still guards one of nine provider paths
(`_relay/2026-07-25-sourcing-egress-and-swarm-0049-spec.md`) — an unguarded discrimination-proxy
surface is disqualifying for the word "enterprise" regardless of what the suites say.

Separately, this run proves nothing about **headless** sourcing. It is a client-driven loop, and
scoring, dedupe and the candidate commit all still execute in the browser store with the durable
loop registering zero handlers.
