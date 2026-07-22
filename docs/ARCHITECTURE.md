# ARIA architecture guide

This is the current developer-facing architecture map for MSourcing / ARIA.
It describes the checked-in source, not the state of any live deployment.
Release status lives in
[`production-readiness/STATUS.md`](../production-readiness/STATUS.md).

## Product boundary

ARIA is a recruiting operations platform. It turns a hiring need into sourced
candidates, guarded drafts, reply handling, scheduling, and auditable run
history. The repository name is MSourcing. Some Hermes identifiers remain in
package names and runtime adapters for compatibility.

There are two execution modes:

| Mode | State and identity | Side effects |
|---|---|---|
| Demo | Synthetic browser state from `src/lib/seed.ts` and `src/lib/store.ts` | Dry-run only; server policy blocks production side effects |
| Live | Supabase Auth, Postgres, RLS, normalized authority tables | Allowed only through authenticated, role-checked, policy-checked server routes |

`src/lib/supabase/config.ts` decides whether Supabase is configured.
Production server routes must use the authenticated-principal and demo
side-effect policies under `src/lib/server/`; they must not infer authority
from browser state.

## Repository map

| Path | Responsibility |
|---|---|
| `src/app/` | Next.js pages, layouts, authentication callbacks, and HTTP route handlers |
| `src/components/` | Feature UI and shared presentation components |
| `src/lib/` | Domain rules, provider adapters, security policy, state helpers, and server services |
| `src/lib/agents/` | Agent graph, execution policy, and exact-scope memory handling |
| `src/lib/needs/` | Signed need-ingress validation, requisition parsing contracts, and readiness policy |
| `src/lib/sourcing/` | Candidate normalization, provider boundaries, query policy, learning authority, and staged-result clients |
| `src/lib/server/` | Server-only authenticated-principal and side-effect boundaries |
| `src/lib/supabase/` | Supabase configuration, clients, and live workspace persistence |
| `supabase/migrations/` | Ordered database schema and authority source of truth |
| `tests/` | Executable contracts used by `npm test` |
| `scripts/` | Local setup, recovery, admin provisioning, and acceptance helpers |
| `scripts/sourcing-loop-handlers/` | React-free handlers for parse, campaign-create, and bounded real-candidate jobs |
| `infra/agent-frameworks/` | Pinned DeerFlow and Flowise sources, private adapters, images, Fly definitions, and release policy |
| `docker/` and `fly.*.toml` | Container and Fly runtime definitions |
| `production-readiness/` | Current release instructions plus a dated historical audit set |
| `_relay/` | Agent handoff state; never use it as product or deployment documentation |

Use `@/...` imports within `src/`. Keep browser components out of
`src/lib/server/`, and keep provider credentials and service-role clients out
of client bundles.

Developer maps:

- [`src/lib/README.md`](../src/lib/README.md) for domain layers and import rules
- [`tests/README.md`](../tests/README.md) for test taxonomy and registration
- [`scripts/README.md`](../scripts/README.md) for operational helpers
- [`infra/README.md`](../infra/README.md) for framework and deployment sources
- [`docs/OWNERSHIP.md`](OWNERSHIP.md) for verified roles and document authority

## Request and data flow

```text
Browser
  -> Next.js page or route handler
  -> authenticated principal and role policy
  -> domain policy in src/lib
  -> Supabase client or approved provider adapter
  -> Postgres normalized tables and append-only receipts
```

The browser store remains the demo-mode state engine and the live workspace
document coordinator. It is not an authority source for credentials, provider
origins, agent ownership, delivery approval, or cross-tenant identity.
Normalized tables own those decisions in live mode.

Key data ownership:

| Concern | Authority |
|---|---|
| Workspace membership and role | Supabase session, `profiles`, RLS, authenticated-principal policy |
| Shared product document | `workspace_state`; collaboration state only |
| Agent definition | `agent_specs`, bound to workspace and owner |
| Agent execution | `agent_runs` plus append-only `agent_events` |
| Agent memory | Exact workspace + owner + spec scope from migration `0025` |
| Candidate conversation | `agent_conversations` and provider thread identity from migration `0023` |
| External integration authority | Normalized admin-owned connection tables |
| Human approval | `outreach_approvals`, bound to the exact message body |
| Delivery and reconciliation | `outreach_ledger`, `messages_outbound`, and provider receipt tables |
| Suppression and consent | Normalized suppression, consent, sender, and contact-policy tables |

Apply every numbered migration in order. The missing `0016` number is
intentional; do not renumber migrations or hand-pick a partial range.

## Autonomous need-to-candidate execution

The autonomous path is a durable job chain, not a browser macro and not a
free-form agent conversation:

1. `POST /api/webhooks/needs` authenticates an exact tenant credential, raw-body
   HMAC, timestamp, and idempotency key. Migration `0049` stores the bounded
   private input and first job atomically.
2. `requisition_parse` resolves only a database-approved tenant model binding,
   fences every model effect, validates the structured role evidence, and
   records a content-bound receipt through migrations `0050`, `0051`, and
   `0053`. There is no synthetic production fallback.
3. `campaign_create` uses migration `0052` to project that receipt into one
   deterministic campaign and enqueue the first sourcing batch in the same
   database transaction.
4. `sourcing_batch` uses migration `0054` to snapshot campaign authority,
   reserve bounded mode-specific GitHub quota, record an egress attempt before
   the request, retain response digests, and atomically persist only candidates
   that match the provider evidence. Anonymous mode is the default;
   authenticated mode requires an explicit worker setting and deployment
   `GITHUB_TOKEN`.
5. A promoted Graphify lesson may select or reorder only a finite, same-page
   query variant already derived by the server from the exact approved role.
   The lesson, review, export, query, and digest snapshot is frozen before
   egress; Graphify cannot create a role requirement, provider credential,
   candidate fact, or delivery permission.
6. The next batch is bounded by a finite ordinal and stops on capacity,
   provider exhaustion, pause, kill switch, stale authority, or terminal
   policy failure. Exact replay reads receipts instead of repeating egress.

The human-in-the-loop control is an activation boundary. Administrators issue
the ingress credential, approve runtime bindings and framework versions, and
can keep the sourcing loop dark. Once independently activated, each valid need
does not require a browser click. Outbound delivery remains a separate,
default-off capability, so autonomous sourcing never implies autonomous
contact.

The checked-in autonomous provider is evidence-bound public GitHub discovery.
The multi-provider bridge described in
[`docs/operations/AUTONOMOUS_PROVIDER_SOURCING.md`](operations/AUTONOMOUS_PROVIDER_SOURCING.md)
remains fail-closed until its separate database receipt contract and live proof
exist. Do not describe browser Tavily support as autonomous multi-provider
coverage.

## Independent agent execution

An ARIA agent is an owner-bound `agent_specs` row plus one independently
reviewed workflow version. DeerFlow orchestrates the approved graph and Flowise
authors the bounded graph; neither framework owns candidate truth, provider
credentials, persistence, delivery, or tenant authority.

1. `src/app/api/agents/specs/route.ts` lists only the latest approved workflow
   binding returned by service-role database authority. A spec without that
   binding is visible but not runnable.
2. The private Flowise adapter compiles only ARIA's three-node workflow
   vocabulary. Arbitrary code, HTTP, MCP, nested-flow, credential, and delivery
   nodes are rejected. A different administrator must approve the immutable
   workflow hash before execution.
3. `src/app/api/agents/run/route.ts` claims a workspace + owner + actor + spec +
   campaign run. The database snapshots exact DeerFlow/Flowise commits, image
   digests, instance IDs, readiness receipts, workflow hash, and kill-switch
   state before the private DeerFlow adapter is called.
4. DeerFlow returns a proposal only. ARIA accepts exactly one reviewed GitHub
   query and records hash-only step receipts. Candidate and message effects from
   framework output are rejected.
5. The resulting one-time sourcing capability is consumed by
   `src/app/api/sourcing-agent/route.ts`. That route performs the real provider
   search, rechecks campaign and framework authority before external work and
   completion, then stages a content-bound result in Postgres.
6. The browser persists the strict candidate DTO through the canonical store
   transaction and calls `/api/sourcing-agent/ack`. The run becomes terminal
   only after Postgres verifies the staged candidates in authoritative
   `workspace_state`; response loss replays the staged result without repeating
   provider egress.
7. Migration `0025` keeps memory isolated by workspace + owner + spec. Migration
   `0023` binds inbound provider threads to one agent conversation; missing or
   ambiguous identity goes to triage rather than being guessed.

Framework execution defaults disabled with the kill switch active. Readiness is
bound to one workspace and immutable instance IDs, not a generic process ping.
The earlier browser-owned Flowise proxy and legacy graph executor remain
disabled; there is one production sourcing-effect path.

This is a source architecture, not a live framework receipt. No complete
Flowise runtime currently passes the release zero HIGH/CRITICAL policy, and no
accepted DeerFlow/Flowise production deployment, restore drill, exact-model
canary, or campaign canary exists for this branch. Framework execution must
remain disabled until those separate acceptance gates pass.

### Identity glossary

These names overlap in the current product and must not be treated as
interchangeable:

| Term | Meaning |
|---|---|
| `AgentSeat` | Sender capacity, provider connection, persona, model, and tool configuration used by the UI and delivery system |
| `AgentSpec` | Owner-bound sourcing runtime definition with role brief, policy, status, and optional seat reference |
| Browser chat and memory | Seat-keyed shared workspace document features; not execution memory and never an Agent-run authority source |
| Agent execution memory | Encrypted normalized memory scoped by workspace, owner, and AgentSpec |
| Agent conversation | Candidate and channel thread bound to an AgentSpec and provider identity |

The run route currently does not use `seat_id` as memory or ownership
authority. If seat-keyed browser memory remains a product feature, name and
present it as shared workspace or persona context. Do not feed it into Agent
execution without an explicit owner/spec migration.

## Outreach and reply authority

There are three distinct draft paths. Do not merge their authority:

| Path | Storage | Can send? |
|---|---|---|
| Agent graph first-touch draft | Agent run history | No delivery authority |
| Inbound candidate reply draft | Named human-review queue | Only after explicit review and all dispatch checks |
| Operator-created outbound | Outreach approval plus delivery ledger | Only through the server send route |

`src/app/api/outreach/send/route.ts` is the live email delivery boundary.
`src/lib/dispatch-outbound.ts` owns durable dispatch and reconciliation.
`src/lib/delivery-outcome.ts` owns the shared HTTP retry-safety
classification used by email and messaging adapters.
WhatsApp adds sender, consent, template or reply-window, review, and signed
webhook checks. Unknown provider outcomes remain non-retryable until an operator
reconciles them.

LinkedIn remains assisted-manual unless an official signed integration is
available. Do not add login automation, scraping, or rate-limit bypass.

## Integration boundaries

- AI providers are called only from server routes after credential resolution.
- Live GitHub, Apollo, Seamless, and web-search records are normalized by
  `src/lib/sourcing/candidate-mappers.ts`. `src/lib/mock-ai.ts` contains
  deterministic synthetic behavior and compatibility re-exports only.
- Provider keys and OAuth tokens are encrypted at rest and never returned to
  the browser.
- Databricks and Dust use normalized admin-owned connection authority; shared
  `workspace_state` cannot select an external tenant, origin, or secret.
- Hermes runtime access is restricted to its configured workspace boundary.
- MCP execution is disabled in production unless the explicit server-side
  policy allows the exact connection and operation.
- Public web fetches validate and pin the resolved address, reject redirects,
  and block private, reserved, metadata, and non-global destinations.

## Deployment topology

The checked-in core Fly design defines five long-running applications plus a
one-shot bootstrap application. `aria-mantu-app` contains separately governed
web, cleanup, framework-heartbeat, and sourcing-loop process groups:

```text
Internet
  -> aria-mantu-app
  -> aria-mantu-kong
       -> aria-mantu-auth
       -> aria-mantu-rest
            -> aria-mantu-db

aria-mantu-bootstrap
  -> privileged reconciliation and ordered migrations
  -> exits after evidence is recorded
```

The private framework deployment pack in `infra/agent-frameworks/fly/` defines
this target topology and no public service, but it has not been deployed or
accepted for this branch:

```text
aria-mantu-app
  -> aria-mantu-deerflow-adapter -> aria-mantu-deerflow
                                 -> aria-mantu-model-gateway
  -> aria-mantu-flowise-adapter  -> aria-mantu-flowise
                                 -> aria-mantu-flowise-worker

DeerFlow state -> aria-mantu-deerflow-db + aria-mantu-deerflow-redis
Flowise state  -> aria-mantu-flowise-db  + aria-mantu-flowise-redis
```

Private DNS, workload identity, immutable source/image pins, database-backed
readiness receipts, and the ARIA adapters are part of the authority boundary.
A process health response without those exact identities is not framework
readiness.

The checked-in protected workflow is designed to build the application,
database, bootstrap, and Kong service images plus a separately built one-shot
Graphify lesson-worker image from one release SHA. Auth and REST are pinned
upstream images. All 7 images are scanned; the 5 local images are attested and
promoted. Graphify receives a pre-publication container test but no
post-promotion execution receipt. That workflow has not completed for the
current source SHA, and the separate framework plane has no accepted release or
deployment receipt. Release acceptance requires exact image digests, migration
identity, recovery evidence, and live behavior. See
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](../production-readiness/DEPLOYMENT_RUNBOOK.md).

## Verification layers

| Layer | Command or evidence |
|---|---|
| Application type safety | `npm run typecheck` |
| Test type safety | `npm run typecheck:tests` |
| Lint | `npm run lint` |
| Deterministic contracts | `npm test` |
| OneDrive-safe production build | `npm run build:isolated` |
| Database authority | Full disposable-database gate documented in `docs/TESTING.md` and `.github/workflows/ci.yml` |
| Cross-channel capacity | Included in the disposable-database gate as `npm run test:db-cross-channel-cap` |
| Exact DB image and restart behavior | `npm run test:fly-db-volume` |
| Release identity | Exact-SHA CI, CodeQL, image evidence, and protected workflow receipts |
| Live acceptance | Readiness, authenticated DB/Auth/REST/Kong, restarts, login, restore and failover evidence, ratified capacity proof, exact-model LLM proof, and a real zero-contact sourcing campaign canary |

Passing source tests does not prove a live deployment. Keep source, release,
and live evidence separate.

## Known structure constraints

These are current facts, not permission for a broad rewrite:

- `src/lib/store.ts` is still the large client-state coordinator. Its public
  action and context contracts now live in the React-free
  `src/lib/store/contracts.ts`; callers retain the compatibility export from
  `src/lib/store.ts`. New domain calculations and action factories should move
  behind that contract in small React-free modules under `src/lib/store/` and
  remain covered by focused tests. The first action boundary is
  `store/campaign-actions.ts`; it owns four campaign/intake actions, filters
  updates to editable fields, and fails closed for viewers or unavailable
  workspaces. `store/campaign-launch.ts` keeps multi-role launch aggregation
  React-free and requires every requested role to complete before success.
- Normalized outreach rows own approval and delivery authority while
  `workspace_state` also carries the UI projection. Server mutations should
  return canonical records, and projection save failures need an explicit
  resynchronization path.
- `src/lib/types.ts` is the central persisted-domain model. Move types only
  with migration, serialization, and compatibility evidence.
- Many API routes repeat authentication, role, workspace, and rate-limit
  resolution. Consolidate them one route family at a time behind a typed
  workspace-access helper with negative tests.
- Several older pages and feature components exceed normal review size. Split
  them only at tested domain or presentation boundaries, one feature at a time.
- The `production-readiness/*_REPORT.md` files are a dated 2026-06-27 audit
  set. They are useful history, not current runtime truth.

## Senior developer onboarding

Read in this order:

1. [`README.md`](../README.md)
2. This architecture guide
3. [`docs/README.md`](README.md)
4. [`production-readiness/STATUS.md`](../production-readiness/STATUS.md)
5. The route and domain module for the feature being changed
6. The matching tests and relevant numbered migrations
7. [`_relay/HANDOFF.md`](../_relay/HANDOFF.md) only when coordinating active
   work with another agent

Before changing an authority boundary, find the matching negative test first.
Before changing persisted data, inspect every later migration that replaces the
same function, policy, trigger, or privilege.
