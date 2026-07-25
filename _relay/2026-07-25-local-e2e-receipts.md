---
project: ARIA / MSourcing
agent: claude-code (Opus 5, 1M)
updated: 2026-07-25
status: login PROVEN · send-guardrails PROVEN · live sourcing PROVEN (see the correction block) · live email send still blocked
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

## SUPERSEDED BELOW — live sourcing WAS subsequently proven

**Correction, appended 2026-07-25 after the section that follows was written.** The three layers
below were real and are kept as the diagnostic record, but the conclusion "live sourcing was not
demonstrated" is **no longer true**. After adding a tool-calling provider key and satisfying the
remaining gates, `POST /api/sourcing-agent` returned **HTTP 200 with three real GitHub
candidates**:

```
sourcing-agent HTTP 200 in 0.749975s
OK  candidates=3  totalFound=3
  * Neil Cummings      | score=30 | https://github.com/TryCatchLearn
  * Sergie Code        | score=30 | https://github.com/sergiecode
  * Fabio Spampinato   | score=30 | https://github.com/fabiospampinato
```

Four gates had to be satisfied in sequence, and each one was a deliberate control working:

1. **Same-origin boundary** — 403 until the harness sent `Origin` (fixed in `7be026c`).
2. **Campaign authority** — 409; `/api/source` refuses ad-hoc live search
   (`src/app/api/source/route.ts:125-134`). The canonical route is `/api/sourcing-agent`.
3. **Request contract** — 503 `invalid_state` then `INVALID_REQUEST`. The real contract is
   `{campaignId, count}` plus an `Idempotency-Key` UUID header under a 2 KB cap, **not** an inline
   campaign; `sourcingStrategy.githubQueries` are objects, not strings. Fixed in `1d37afd`.
4. **Brief readiness** — 409 `CAMPAIGN_NOT_READY`. `evaluateNeedReadiness` requires `seniority` and
   `employmentType` to not be `"Unspecified"`, and the JD never stated employment type. Satisfied
   by confirming the brief, i.e. by doing the human review the product demands.

**Two caveats that matter.** Scores came back flat at 30 with no titles or companies, in 0.75 s —
that is the *deterministic* path, because the seeded workspace had no `llmProviders`, so
`resolveAiProvider` returned nothing and no LLM enrichment ran. And the campaign had to be seeded
directly into `workspace_state`: **there is no server-side route that creates a campaign**, which is
the audit's browser-bound-commit blocker observed from the inside.

## The original diagnostic — three layers, kept for the record

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
   build.

   **Corrected:** an earlier draft of this document said "`npm run build` is in no gate at all".
   That was wrong. `.github/workflows/ci.yml:75-76` runs `npm run build` after `npm ci` at `:29`,
   so **hosted CI would have caught defect 1**. What is true is narrower and more useful:

   - the **locally-runnable** FULL GATE contains no build — it is typecheck, typecheck:tests, lint,
     test:all, test:database — and `isolated-build` only string-matches a script, so it reads like
     build coverage while providing none;
   - hosted CI has the build and **has not been executing** (the 2026-07-19 audit records every job
     failing to start on an exhausted Actions budget).

   So this project has been running on a local-only gate that structurally cannot catch an
   undeclared dependency. *The fix is restoring CI — already an owner action — not adding a step.
   A second-order improvement would be making `isolated-build` actually execute the script it
   describes, which changes it from a text match into a real build proof; that costs minutes and
   changing the locked FULL GATE definition is an owner decision.*
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
