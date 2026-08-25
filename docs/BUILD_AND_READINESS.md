# ARIA / MSourcing — Build, Readiness, and the Path to Sourcing Autopilot

**Basis:** source at `integration/sourcing-enrichment-on-main` @ `d46a3d2`
(`feat(linkedin): LinkedIn as a real channel, assisted-manual working and vendor dark`).
**Remote:** `https://github.com/mysticalsin/aria-sourcing.git`.
**Written:** 2026-08-25.

This document answers three questions in one place:

1. **How is it built?** — the architecture, as it actually is in source today.
2. **What is missing to be production and enterprise ready?** — a gap register
   with evidence, not a wish list.
3. **What is missing for it to source on autopilot, LinkedIn included?** — the
   specific set of switches, credentials, proofs, and decisions that stand
   between the current build and an unattended sourcing loop.

## 0. How to read this

Every claim below is marked:

- **[verified]** — read out of source at this SHA. File paths are cited.
- **[assumed]** — a reasonable reading that has not been executed or proven.
- **[unknown]** — nobody has checked; treat as a task, not a fact.

This document does **not** replace the deep docs. It is the map above them:

| For | Read |
|---|---|
| Module boundaries and runtime flows | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| The sourcing pipeline in detail | [`docs/SOURCING.md`](SOURCING.md) |
| Deploying to Fly | [`production-readiness/DEPLOYMENT_RUNBOOK.md`](../production-readiness/DEPLOYMENT_RUNBOOK.md) |
| Release posture as of the last audit | [`production-readiness/STATUS.md`](../production-readiness/STATUS.md) |
| Verification tiers | [`docs/TESTING.md`](TESTING.md) |
| Where any file lives | [`docs/README.md`](README.md) |

The `production-readiness/*_REPORT.md` set and the `_relay/*audit*.md` set are
**dated evidence**, not current state. Where they disagree with this document,
this document was written against a later SHA — but re-verify before acting.

---

## 1. How it is built

### 1.1 In one paragraph

ARIA is a Next.js 16 App Router application on a self-hosted Supabase Postgres,
in which **Postgres — not the application — holds the authority**. Sourcing,
enrichment, scoring, outreach drafting, approval, dispatch, and reconciliation
are each a stage in a job DAG. Every stage that spends money, touches a
candidate, or reaches the wire is gated by a `SECURITY DEFINER` Postgres
function that is executable by `service_role` only and re-checks its own
preconditions at claim time. The application process can be wrong, restarted,
or duplicated without being able to double-send, double-charge, or contact a
suppressed person. Autonomy is a per-workspace switchboard on top of that
spine, and it ships **off**.

### 1.2 Stack **[verified — `package.json`]**

| Area | Truth |
|---|---|
| App | Next.js `^16.2.6` App Router, React `^19.2.7`, TypeScript `^5.6.3` |
| Runtime | Node `22.x` |
| Data / auth | Supabase Postgres + Supabase Auth (GoTrue), RLS tenancy, service-role server routes |
| Validation | `zod ^3.23.8` |
| UI | Tailwind, Recharts, lucide-react, Framer Motion, Three.js / React-Three-Fiber |
| Browser automation | `playwright-core` (screenshots/evidence only — **not** used against linkedin.com) |
| Schema | 53 numbered SQL migrations, `0001` → `0054` |

### 1.3 Repo layout **[verified]**

| Path | What it is |
|---|---|
| `src/app` | Routes. `src/app/api/**/route.ts` is the server surface (~60 routes) |
| `src/lib` | Domain logic. The load-bearing files are listed in §1.6–1.9 |
| `supabase/migrations/` | **The schema source of truth.** Committed migration bytes are immutable; change is additive-forward only |
| `scripts/` | Workers and operational helpers. `sourcing-loop-worker.mjs` is the autopilot |
| `workers/` | The isolated, no-network Graphify lesson worker (Python) |
| `tests/` | The `npm test` chain, driven by `tests/test-manifest.mjs` |
| `docker/`, `Dockerfile.prod`, `fly.*.toml` | Local full stack and the six Fly apps |
| `production-readiness/` | Release runbook + dated audit dossier |
| `_relay/`, `_agent_state/` | Multi-agent build memory. **Not** product documentation |

### 1.4 Runtime topology **[verified — `fly.*.toml`]**

Six Fly apps in `cdg`:

| App | Role |
|---|---|
| `aria-mantu-app` | The Next.js service **and** the workers (see process groups below) |
| `aria-mantu-db` | Postgres on a durable volume mounted at `/var/lib/postgresql` |
| `aria-mantu-auth` | GoTrue, pinned to an upstream digest |
| `aria-mantu-rest` | PostgREST, pinned to an upstream digest |
| `aria-mantu-kong` | The public Supabase gateway |
| `aria-mantu-bootstrap` | One-shot protected migration/bootstrap path |

`aria-mantu-app` runs four process groups:

| Process | Command | Notes |
|---|---|---|
| `web` | `node server.js` | Only group behind `http_service`; health check is `/api/health` |
| `cleanup` | `scripts/apollo-authority-cleanup-worker.mjs` | Apollo receipt retention |
| `framework_heartbeat` | `scripts/agent-framework-heartbeat-worker.mjs` | Agent-framework leases |
| `loop` | `scripts/sourcing-loop-worker.mjs` | **The autopilot. Ships inert.** |

Server-side Supabase traffic goes over Fly 6PN (`http://aria-mantu-kong.internal:8000`),
never the public Kong URL. The loop worker reaches the web process over 6PN
process-group DNS (`ARIA_WEB_INTERNAL_URL`).

A separate, unrelated Vercel demo path exists on the `vercel-demo` branch
([`DEPLOY_VERCEL_DEMO.md`](../DEPLOY_VERCEL_DEMO.md)) — dry-run demo state, not
the production system.

### 1.5 The authority model — the central design idea **[verified]**

This is the thing to understand before anything else.

- Money-spending and wire-touching operations are **Postgres functions**, not
  application code: `claim_due_aria_jobs`, `claim_linkedin_outbound_queued`,
  `record_linkedin_delivery_outcome`, `enqueue_aria_job`,
  `sourcing_loop_stage_enabled`, and their Email/WhatsApp equivalents.
- Those functions are `security definer` with a pinned `search_path`, and their
  grants are `revoke all … from public, anon, authenticated, service_role,
  authenticator` followed by `grant execute … to service_role`. A compromised
  browser session or a member-role JWT cannot reach them.
- Each function **re-checks its own preconditions at claim time** — approval
  identity, body hash, suppression list, the 90-day recontact window, seat
  capacity, and the workspace switchboard — rather than trusting what the
  caller believed a moment earlier.
- `tests/db/function-privileges.sql` and `scripts/test-db-privileges.sh` assert
  the grant surface, so the guarantee is regression-tested rather than
  documented-and-hoped.

Consequence: **the blast radius of an application bug is bounded by SQL.** That
is why the gap registers below are mostly about *proof and enablement*, not
about missing safety code.

### 1.6 The sourcing pipeline **[verified — `src/lib/sourcing/`]**

| Provider | Module | What it buys |
|---|---|---|
| Apify (`harvestapi/linkedin-profile-search`) | `apify.ts` | **LinkedIn public-profile search data**, vendor-API purchased. Server-only, workspace token stored encrypted, hard ceiling `MAX_ITEMS_CEILING = 50` per run |
| Apollo | `apollo.ts` | People/company search + enrichment |
| Sillage | `sillage.ts` | Asynchronous account mapping |
| Seamless | `seamless.ts` | Contact research |
| GitHub | `github.ts`, `github-identity.ts` | Developer identity signals |
| Tavily | `tavily.ts` | Web research |
| Web leads | `web-leads.ts` | Open-web lead capture |

Around them: `provider-egress.ts` and `provider-transport.ts` (egress clearance),
`query-policy.ts` (what a run is allowed to ask for), `source-authority.ts` (DB
quota, replay authority, completion receipts), `candidate-mappers.ts` (raw →
`Candidate`), and `learning-authority.ts` (review-gated lessons; the Graphify
worker sees only aggregate query fingerprints and outcome counts, and cannot
promote a lesson without separate admin review).

Flow: **discover → map → score → dedupe → commit**. Candidate records are
released only after the completion receipt is accepted — a provider run that
dies mid-flight does not leak half a batch into the corpus.

Scoring, the six weighted dimensions, the three-state model, the enrichment
waterfall, per-field provenance, and the candidate corpus (migrations
`0035`/`0036`/`0037`) are documented in depth in [`docs/SOURCING.md`](SOURCING.md).

### 1.7 The autopilot loop **[verified — `scripts/sourcing-loop-worker.mjs`, `supabase/migrations/0038`, `0050`]**

The `loop` process ticks every 30s and, in order:

1. **Global kill switch.** Anything but the exact string `"false"` in
   `ARIA_LOOP_KILL_SWITCH` means the tick does nothing — no DB write, no HTTP.
   The variable is deliberately **not** set in `fly.app.toml`, so a fresh
   deploy is inert.
2. Records a worker heartbeat (worker id + release SHA).
3. Reaps expired job leases and agent-framework leases (crash recovery).
4. Drains outbound by calling the **same** `/api/cron/dispatch-outbound` route
   the daily cron hits — so every send-side guardrail is reused verbatim, at
   minute cadence instead of daily. No dispatch logic is duplicated in the worker.
5. Claims due jobs via `claim_due_aria_jobs` and runs one handler per stage.

The pipeline is a fixed DAG. A handler may enqueue **only** the successors
declared in `PIPELINE_STAGE_TRANSITIONS`:

| Stage | Successor | Owner |
|---|---|---|
| `email_sync` | `inbound_classify` | `handleEmailSync` |
| `inbound_classify` | — (terminal) | queue for human review |
| `requisition_parse` | `campaign_create` | `handleRequisitionParse` |
| `campaign_create` | — (terminal) | — |
| `sourcing_batch` | `shortlist_build` | `handleSourcingBatch` |
| `provider_poll` | `shortlist_build` | `handleProviderPoll` |
| `enrich_candidate` | `shortlist_build` | `handleEnrichCandidate` |
| `shortlist_build` | `draft_generate` | **`POST /api/shortlist/approve` — a human** |
| `draft_generate` | — (terminal) | drafts stop here |
| `delivery_reconcile` | `outcome_feedback` | `handleDeliveryReconcile` |
| `outcome_feedback` | — (terminal) | — |

Two of those rows are the whole story of what "autopilot" currently means:
**`shortlist_build → draft_generate` is owned by a human API call**, and
**`draft_generate` is terminal** — generating a draft grants no delivery
authority whatsoever.

On top of the DAG sits a per-workspace switchboard,
`public.sourcing_loop_controls` (migration `0038`, mapped to stages by
`sourcing_loop_stage_enabled()` in `0050`):

| Column | Default | Gates |
|---|---|---|
| `kill_switch` | **`true`** | everything |
| `intake_enabled` | `false` | `email_sync`, `inbound_classify`, `requisition_parse`, `campaign_create` |
| `sourcing_enabled` | `false` | `sourcing_batch`, `provider_poll`, `shortlist_build`, `draft_generate` |
| `enrichment_enabled` | `false` | `enrich_candidate` |
| `sequences_enabled` | `false` | `delivery_reconcile`, `outcome_feedback` |
| `swarm_enabled` | `false` | `swarm_assignment` (column added by `0046`) |
| `max_sourcing_runs_per_day` | `10` | 0–100 |
| `max_sequence_sends_per_day` | `50` | 0–1000 |
| `max_enrichment_units_per_day` | `200` | 0–10000 |

A table check constraint makes this fail-closed: **no stage may be enabled
while the kill switch is engaged, and every enable must be attributable to a
named admin** (`updated_by` FK'd to `profiles(workspace_id, id)`).

### 1.8 The outreach gate **[verified — `src/lib/dispatch-outbound.ts`]**

Before anything reaches a provider, the dispatcher requires, per message:

1. A named human approval row for **exactly this message id and body hash**,
   not revoked, with `approval_source === "human"`
   (`src/lib/dispatch-outbound.ts:263`). A legacy agent flag cannot substitute.
2. The human-likeness gate (`src/lib/gate.ts`), quiet hours, and suppression.
3. Injection and disclosure checks (`src/lib/agent-disclosure-policy.ts`) — the
   candidate's own words are treated as untrusted data, never as instructions.
4. An atomic DB claim that flips `queued → dispatching` and writes the ledger
   row **before** any transport call.

Anything that fails becomes `blocked` (human queue) or `failed`. An ambiguous
provider outcome keeps holding seat capacity rather than freeing it for a
possible double-send. Inbound candidate replies are queue-only and require
named human review; agent-graph drafts live in run history with no delivery
authority at all.

The salary/compensation disclosure boundary is enforced in the system prompt
**and** re-validated on generated text — the agent may ask a candidate's target
range and must never state, confirm, hint at, or imply an internal figure.

### 1.9 LinkedIn, specifically **[verified]**

Two entirely separate concerns, deliberately kept apart:

**Data in — works today.** `src/lib/sourcing/apify.ts` buys LinkedIn
public-profile search results from Apify's `harvestapi` actor. No LinkedIn
login, no recruiter cookies, no headless browser against linkedin.com, no
session reuse. It is a vendor data purchase in the same trust category as
Apollo or Seamless. Async: start a run → poll `getRunStatus()` → fetch dataset
items. A real zero-hit result is authoritative; the module never fabricates a
profile.

**Messages out — one channel, two backends** (`src/lib/linkedin-channel.ts`,
migration `0054`):

| Backend | Provider label | State |
|---|---|---|
| `assisted-manual` | `LinkedIn Assisted Manual` | **Working.** Returns the approved draft plus the profile deep link for an operator to copy, paste, and send. Requires a profile URL |
| `vendor-api` | `LinkedIn Vendor API` | **Dark.** Wired to `LINKEDIN_VENDOR_API_URL` / `LINKEDIN_VENDOR_API_KEY`, and fails closed as `linkedin-provider-unconfigured` while they are absent. **No silent fallback to assisted-manual** |

Both backends share one adapter interface and the **same DB claim path**:
`claim_linkedin_outbound_queued(uuid)` re-checks exact human approval, the
LinkedIn scope hash, suppression, the 90-day contact window, and active seat
cap before flipping `queued → dispatching`; `record_linkedin_delivery_outcome(...)`
reconciles the shared ledger. A separate channel-guarded trigger,
`enforce_active_linkedin_approval()`, leaves the existing Email and WhatsApp
triggers untouched.

Cross-channel capping is proven in the DB harness: an existing Email contact
blocks LinkedIn recontact, and an Email-consumed seat cap blocks a different
LinkedIn candidate on the same seat.

**The policy module** (`src/lib/linkedin-policy.ts`) is a hard guardrail, not a
lint: it blocks content or instructions that attempt LinkedIn login automation,
scraping, session/proxy rotation, fake identities, or named grey-market tools
(`phantombuster`, `dux-soup`, `linkedinhelper`, `octopus`, `meetalfred`), and it
exports a guardrail prompt injected into LLM calls routed through the app.

### 1.10 Build, run, verify

```bash
npm install
npm run dev                       # demo UI at http://localhost:3000

bash scripts/local-supabase-up.sh # local Supabase + every migration + .env.local
npm run dev                       # now against a real database
```

Verification gates:

```bash
npm run typecheck                 # tsc --noEmit
npm run typecheck:tests           # tsconfig.tests.json
npm run lint
npm test                          # the manifest chain (tests/test-manifest.mjs)
npm run test:all                  # every registered group
npm run test:database             # Docker-backed Postgres authority proofs
npm run build:isolated            # use THIS in the OneDrive checkout, not `npm run build`
```

`npm run build:isolated` copies the project to a temp workspace and builds
there — OneDrive path semantics break Turbopack in place.

Inspect the chain rather than copying totals:
`node scripts/run-test-manifest.mjs --list all`.

**Known local-environment blockers in this checkout** **[verified — reproduced
2026-07-29, `_relay/HANDOFF.md`]**, none of which are application defects:

| Symptom | Cause | Workaround |
|---|---|---|
| `permission denied … /Users/tony/.colima/default/docker.sock` | Docker socket denied to the sandbox | Run `test:database` on a Docker-enabled machine |
| `listen EPERM: operation not permitted 127.0.0.1` | Loopback listeners denied | Same |
| `listen EPERM … tsx-501/*.pipe` | `tsx` CLI IPC denied | Use `node --import tsx <file>` |
| `TurbopackInternalError … binding to a port` | Build subprocess/port denied | `npm run build:isolated`, or build in CI |

CI: `.github/workflows/ci.yml`, `codeql.yml`, and the protected
`deploy-aria-mantu.yml` (image build, CycloneDX 1.7 SBOM schema validation,
HIGH/CRITICAL + secret gates across 7 images, digest attestation and promotion,
deployed-digest verification). `.gitlab-ci.yml` is a **manual** GitLab fallback
that restores a base64 secret bundle and runs `deploy-fly.sh` — it exists
because GitLab runners have a cleaner network path to Fly.

---

## 2. Gap register — production ready

"Production ready" here means: one real tenant, real candidates, real outbound,
with evidence that survives an incident review.

| ID | Gap | Evidence | Done looks like | Type |
|---|---|---|---|---|
| **P-1** | Migrations `0053` (sequence engine) and `0054` (LinkedIn channel) have **never executed against a real Postgres** in this checkout | `_relay/HANDOFF.md` "Blockers" 1; Docker denied locally | `npm run test:database` and `tests/cross-channel-cap-postgres.sh` green on a Docker-enabled host, printing `… linkedin=blocked deadlock=none privileges=service-only` | Engineering |
| **P-2** | The full gate set has not run green on **one** machine at this SHA — the local run stops at `tests/apollo-cleanup-worker.mts` | `_relay/HANDOFF.md` "Blockers" 2 | `typecheck && typecheck:tests && lint && test:all && test:database && test:manifest && build` all green at one 40-char SHA | Engineering |
| **P-3** | No CI + CodeQL run bound to the release SHA with zero open high/critical alerts | `production-readiness/STATUS.md` "Release acceptance still required" §1 | Green CI + CodeQL on the protected release ref | Engineering |
| **P-4** | Schema dump-diff not reviewed for the three new public functions added by `0054` | `_relay/HANDOFF.md` "Next steps" §3 | Reviewed dump-diff for `enforce_active_linkedin_approval`, `claim_linkedin_outbound_queued`, `record_linkedin_delivery_outcome` | Engineering |
| **P-5** | The `0032` application-surface fallback passes its disposable-DB test but is **not production-executable** | `production-readiness/STATUS.md` | A protected apply job + append-only, ledger-safe forward migration | Engineering |
| **P-6** | `/api/ready` is deliberately **not** a Fly routing check, because its `agentFrameworks` component probes Flowise/Deerflow adapters that are not deployed | `fly.app.toml` comment; relay Track C | Either deploy the Flowise sidecar, or make the readiness component conditional so `/api/ready` can gate routing honestly | Engineering + decision |
| **P-7** | No verified delivery-provider path bound to a verified domain | `README.md` "Deployment"; `src/app/api/outreach/verify-domain` | Provider key installed, domain verified, unsubscribe base URL matching the deployment host, one live send receipt | Owner |
| **P-8** | Backup restore and rollback proven only as procedure, not as a dated drill at this SHA | `scripts/restore-drill.sh`, `production-readiness/BACKUP_RESTORE_REPORT.md` (dated) | A dated restore drill + rollback receipt bound to the release | Engineering |
| **P-9** | No production alerting/on-call binding — the reports describe alerting, the deployment does not prove it | `production-readiness/ALERTING_REPORT.md` (dated) | Alert routes firing to a real destination, tested by an induced failure | Owner + engineering |
| **P-10** | Candidate erasure does **not** reach candidate data embedded in agent-run JSON, framework results, or encrypted agent memory | `production-readiness/STATUS.md`, explicit carve-out | Erasure extended to those three stores, or the carve-out documented in the privacy notice as a known retention boundary | Engineering + legal |
| **P-11** | `src/components/floor3d/Floor3DScene.tsx` (611 lines) is committed but **imported by nothing** | Only self-references and one stale comment in `InstancedAgents.tsx:15` | Either wired to a route or deleted | Engineering |
| **P-12** | `tests/docs-truth.mts` is **red on this branch** by time decay: `production-readiness/STATUS.md` is dated 2026-07-14 and the freshness assertion has aged out | `node --import tsx tests/docs-truth.mts` → `FAIL: STATUS.md contains a recent, non-future ISO date` (45 passed, 1 failed) | STATUS.md re-reviewed against current source and re-dated. **Do not just bump the date** — the assertion exists to force the review | Engineering |

## 3. Gap register — enterprise ready

"Enterprise ready" means: it survives a security questionnaire, a procurement
review, and a customer's IT department.

| ID | Gap | Evidence | Done looks like | Type |
|---|---|---|---|---|
| **E-1** | **No SCIM / directory provisioning.** Users are provisioned by first-profile-becomes-admin and manual role assignment | `src/lib/rbac.ts`; migration `0018`; no SCIM references in source | SCIM 2.0 user/group endpoints, or a documented manual-provisioning position with an access-review cadence | Engineering |
| **E-2** | **SSO is configurable but off.** `NEXT_PUBLIC_ENABLE_AZURE_LOGIN = "false"` in `fly.app.toml`; Entra completion is an open runbook item | `fly.app.toml`; `production-readiness/DEPLOY_CHECKLIST.md` Phase 3; `UNKNOWN_ITEMS.md` B7 | Entra SSO enforced, demo login off, MFA required, password policy raised from the local default | Owner |
| **E-3** | **Three fixed roles, no custom roles, no delegated admin.** `admin` / `member` / `viewer` over 14 permissions | `src/lib/rbac.ts` | Either a customer-definable role model, or a documented position that the three roles are the product | Decision |
| **E-4** | **No tenant-facing audit log export.** Authority receipts exist in Postgres; nothing surfaces them to a customer auditor | No export route under `src/app/api` | A scoped, tenant-isolated audit export (CSV/JSON) covering approvals, sends, erasures, and switchboard changes | Engineering |
| **E-5** | **Data residency is single-region** (`cdg`) with no documented DPA position on sub-processors (Apify, Apollo, Sillage, Seamless, Tavily, Meta, Databricks, Dust) | `fly.*.toml`; `src/lib/sourcing/*` | A sub-processor register + DPA set, and a residency statement | Legal + owner |
| **E-6** | **AI-governance evidence is dated, not live.** `AI_GOVERNANCE_GATE.md` and `COMPLIANCE_MAPPING.md` predate the current model/provider config | `production-readiness/` (dated set) | Re-run against the shipped provider/model configuration, with an EU-AI-Act role determination for the sourcing agent | Legal + engineering |
| **E-7** | **Third-party MCP execution is disabled in production and opt-in elsewhere** — correct today, but the enterprise story ("tool use") depends on it | `README.md`; `src/lib/mcp-client.ts`, `tests/mcp-runtime-policy.mts` | A per-tenant allowlist with signed tool manifests, or keep it off and stop selling it | Decision |
| **E-8** | **No documented capacity or cost model per tenant.** Daily caps exist (`max_*_per_day`) but nothing maps them to spend | migration `0038` caps; `production-readiness/CAPACITY_PLAN.md` (dated) | Cost-per-workspace model tied to the provider credit meters already in `0051_metered_provider_run_authority.sql` | Engineering |
| **E-9** | **Secrets live in two half-documented places**: Fly secrets and a base64 CI bundle (`ARIA_DEPLOY_BUNDLE`) | `.gitlab-ci.yml`; `production-readiness/.fly-secrets.env` | One documented secret authority with rotation evidence; the key-ID ring already in source is the right foundation | Engineering |
| **E-10** | **Business continuity is written, not exercised** | `BUSINESS_CONTINUITY_PLAN.md`, `DISASTER_RECOVERY_PLAN.md` (dated) | One tabletop + one real failover drill, dated | Owner |

## 4. Gap register — sourcing on autopilot

This is the honest answer to "can it source on autopilot?"

**Today: no — and mostly by design.** The loop can run intake → sourcing →
enrichment → shortlist unattended. It **cannot** cross from shortlist to
outreach without a human, in two separate places, both enforced in SQL.

| ID | Gap | Evidence | Done looks like | Type |
|---|---|---|---|---|
| **A-1** | The loop worker is **inert on every deploy**: `ARIA_LOOP_KILL_SWITCH` is deliberately unset | `fly.app.toml` `[[vm]] processes = ["loop"]` comment | `ARIA_LOOP_KILL_SWITCH=false` set as a Fly secret, after P-1/P-2 | Owner |
| **A-2** | Every workspace switchboard flag defaults **off** with `kill_switch = true` | migration `0038:134-157` | A named admin flips `kill_switch=false` plus the specific stage flags; the check constraint enforces attribution | Owner |
| **A-3** | `sequences_enabled` is **false everywhere** and the sequence engine has never run live | `_relay/HANDOFF.md`; migration `0053` header ("remains dark") | Sequence scheduling proven on a real DB, then enabled per workspace | Engineering → owner |
| **A-4** | `shortlist_build → draft_generate` is owned by `POST /api/shortlist/approve` — **a human call** | `scripts/sourcing-loop-worker.mjs:70` | *Decision:* either keep it (recommended — it is the last cheap place to catch a bad shortlist) or add an auto-approve path bounded by score threshold, daily cap, and a reversible audit trail | **Decision** |
| **A-5** | Every send requires a named human approval row matching the exact body hash | `src/lib/dispatch-outbound.ts:263` | *Decision:* this is the product's core safety claim. Removing it changes what ARIA is. A "template-approved" model (human approves a template + audience, machine approves instances) is the only variant that keeps the claim intact | **Decision** |
| **A-6** | Inbound replies are queue-only and require named human review | `src/lib/autopilot.ts` header; `production-readiness/STATUS.md` | Same decision shape as A-5, with the salary-disclosure boundary as the hard limit on any automated reply | **Decision** |
| **A-7** | Loop ignition needs `CRON_SECRET` **and** a per-request `x-aria-workspace-id` header; nothing in the repo schedules it | `src/app/api/cron/ignite-sourcing-loop/route.ts` | A scheduler (Fly cron / GitHub Actions / Vercel cron) that calls the ignite route per active workspace daily, with the secret installed | Engineering |
| **A-8** | Daily caps are conservative defaults (10 sourcing runs, 50 sends, 200 enrichment units) | migration `0038:141-146` | Caps deliberately set per tenant against the cost model from E-8 | Owner |
| **A-9** | No end-to-end unattended run has ever been observed | no live receipt at this SHA | One workspace, one requisition, intake → shortlist unattended, with the job ledger as evidence | Engineering |
| **A-10** | Provider spend is metered (`0051`) but there is **no budget kill** — caps are per-day counts, not per-day currency | migration `0051`, migration `0038` | A currency ceiling that trips the switchboard, not just a run counter | Engineering |

## 5. Gap register — LinkedIn on autopilot

Split the question, because the two halves have completely different answers.

**LinkedIn data in: already autopilot-capable.** `provider_poll` and
`sourcing_batch` drive the Apify actor without a human in the loop, subject only
to the switchboard and the 50-item ceiling. Nothing blocks this but A-1/A-2.

**LinkedIn messages out: not autopilot, and the live path is by definition manual.**

| ID | Gap | Evidence | Done looks like | Type |
|---|---|---|---|---|
| **L-1** | The only **working** LinkedIn backend is `assisted-manual`, which returns a draft for an operator to copy/paste/send. That is the opposite of autopilot | `src/lib/linkedin-channel.ts` `assistedManualAdapter` | Understood and accepted, or replaced by L-2 | — |
| **L-2** | The `vendor-api` backend is **dark**: no vendor selected, no contract, no credentials | `linkedin-channel.ts` `configured()`; fails closed as `linkedin-provider-unconfigured` | A named, contractually permitted LinkedIn messaging vendor (or LinkedIn Recruiter System Connect) with credentials installed | **Owner — this is the single blocking decision** |
| **L-3** | ~~`LINKEDIN_VENDOR_API_URL` / `LINKEDIN_VENDOR_API_KEY` appear in neither env example~~ — **closed in the same commit as this document** | both keys now documented in `.env.local.example` and `.env.production.example` with the fail-closed behaviour stated | done | — |
| **L-4** | The vendor adapter's response contract is **assumed, not verified**: it expects `{ id }` or `{ messageId }` and treats a missing durable id as `unknown` | `linkedin-channel.ts` vendor branch | Contract confirmed against the chosen vendor's real API, with a live smoke run (`scripts/smoke-linkedin-live.mts` exists for this) | Engineering, after L-2 |
| **L-5** | No LinkedIn **inbound**. Replies to a LinkedIn message never re-enter the system — no webhook, no correlation, no `delivery_reconcile` for the channel | no LinkedIn route under `src/app/api/webhooks/` | Either a vendor inbound webhook with the same untrusted-data treatment as WhatsApp, or an explicit "LinkedIn is send-only, reply in LinkedIn" position | Engineering + decision |
| **L-6** | No LinkedIn delivery-status reconciliation loop equivalent to Meta's receipts | `record_linkedin_delivery_outcome` is called at send time only | Vendor status callbacks reconciled into the shared ledger | Engineering, after L-2 |
| **L-7** | LinkedIn sends still require the same named-human approval row as Email and WhatsApp | `claim_linkedin_outbound_queued` re-checks exact human approval | Same decision as A-5. LinkedIn cannot become more autonomous than Email without changing the platform's safety claim | **Decision** |
| **L-8** | Apify actor coverage is unproven at scale: `MAX_ITEMS_CEILING = 50` per run, and the second actor path (`dev_fusion~linkedin-profile-scraper`) is wired but its role is undocumented | `src/lib/sourcing/apify.ts` | Documented actor selection policy + a measured yield/cost figure per run | Engineering |

---

## 6. The sequenced path

Each phase has an exit criterion. Do not start the next one until it holds.

**Phase 0 — prove what is already built.** P-1, P-2, P-3, P-4.
*Exit:* every gate green at one 40-character SHA on a Docker-enabled machine,
CI + CodeQL clean on that ref.

**Phase 1 — make one tenant real.** E-2 (Entra SSO on, demo login off), P-7
(delivery provider + verified domain), P-9 (alerting), P-8 (restore drill).
*Exit:* one human sends one approved message end to end and the ledger proves it.

**Phase 2 — light the loop, read-side only.** A-1, A-2, A-7 — enable
`intake_enabled`, `sourcing_enabled`, `enrichment_enabled`. Leave
`sequences_enabled` false. LinkedIn data-in runs unattended here.
*Exit:* A-9 — one requisition goes intake → shortlist with no human touch, and
the job ledger shows it.

**Phase 3 — the outreach decision.** A-4, A-5, A-6, L-7 are not engineering
tasks; they are a product decision about how much authority a machine gets over
a message to a real person. The recommended shape, because it keeps the safety
claim intact: a human approves a **template plus an audience definition**, the
machine approves instances against it, and every instance stays revocable and
attributable. Whatever is chosen, A-3 (prove the sequence engine) and A-10
(currency ceiling) come first.
*Exit:* a written, dated decision, and the SQL that implements it.

**Phase 4 — LinkedIn messaging out.** L-2 is the gate. Until a compliant vendor
or an official Recruiter System Connect integration is contracted, LinkedIn
outreach is assisted-manual and that is the end of it. After L-2: L-3, L-4,
L-6, then L-5.
*Exit:* one vendor-API LinkedIn message sent from an approved draft, reconciled
in the shared ledger.

## 7. The boundary that does not move

The following are refused by design and should not be revisited as engineering
tasks **[verified — `src/lib/linkedin-policy.ts`, `_relay/HANDOFF.md` "Decisions
made"]**:

- No LinkedIn account fleet, captured session, cookie reuse, proxy rotation, or
  first-party LinkedIn automation.
- No headless browser against `linkedin.com`.
- No scraping of LinkedIn by this application. Vendor-purchased public-profile
  data is a different trust category and is what `apify.ts` does.
- No fallback from `vendor-api` to `assisted-manual` when vendor credentials
  are missing — it fails closed instead.
- Email and WhatsApp approval triggers are not modified to accommodate LinkedIn;
  LinkedIn got its own channel-guarded trigger.

"LinkedIn on autopilot" is therefore achievable in exactly one lawful shape:
**unattended vendor-purchased sourcing data, plus outreach through a
contractually permitted messaging path, with the platform's human-approval
model intact.** Everything else on the market that calls itself LinkedIn
automation is the thing `linkedin-policy.ts` exists to block.
