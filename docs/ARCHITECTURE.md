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
| `src/lib/server/` | Server-only authenticated-principal and side-effect boundaries |
| `src/lib/supabase/` | Supabase configuration, clients, and live workspace persistence |
| `supabase/migrations/` | Ordered database schema and authority source of truth |
| `tests/` | Executable contracts used by `npm test` |
| `scripts/` | Local setup, recovery, admin provisioning, and acceptance helpers |
| `docker/` and `fly.*.toml` | Container and Fly runtime definitions |
| `production-readiness/` | Current release instructions plus a dated historical audit set |
| `_relay/` | Agent handoff state; never use it as product or deployment documentation |

Use `@/...` imports within `src/`. Keep browser components out of
`src/lib/server/`, and keep provider credentials and service-role clients out
of client bundles.

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

## Independent agent execution

An ARIA sourcing agent is an owner-bound `agent_specs` row, not a shared seat
or UI card.

1. `src/app/api/agents/specs/route.ts` creates and lists specs after validating
   the role brief and stored execution policy.
2. `src/app/api/agents/run/route.ts` requires an authenticated caller with the
   required provider-management permission and loads the exact active spec for
   that caller, workspace, and owner.
3. The route persists the execution-policy snapshot before memory retrieval or
   model/provider access.
4. `src/lib/agents/memory.ts` loads only memory matching workspace, owner, and
   spec. Legacy shared memory is not activated.
5. `src/lib/agents/graph.ts` runs one bounded step at a time and persists state
   after every step. The spec is rechecked before each step.
6. The current graph supports Email drafting only. Drafts stay in run history
   with `deliveryAuthority=none`. The graph does not create an approval queue
   and does not write the provider outbox.
7. Migration `0023` binds inbound provider threads to an agent conversation.
   Missing or ambiguous identity goes to triage instead of being guessed from
   the latest message or active campaign.

This separation prevents one agent from reading another owner's memory,
resuming another agent's run, or taking over a candidate conversation through
address-only matching.

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

The production definition has five long-running Fly services plus a one-shot
bootstrap app:

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

The protected workflow builds the application, database, bootstrap, and Kong
images from one release SHA. Auth and REST are pinned upstream images. Release
acceptance requires exact image digests, scans, attestations, migration
identity, recovery evidence, and live behavior. See
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](../production-readiness/DEPLOYMENT_RUNBOOK.md).

## Verification layers

| Layer | Command or evidence |
|---|---|
| Type safety | `npm run typecheck` |
| Lint | `npm run lint` |
| Deterministic contracts | `npm test` |
| OneDrive-safe production build | `npm run build:isolated` |
| Database authority | `npm run test:db-privileges` and `npm run test:db-agent-memory` |
| Cross-channel capacity | `npm run test:db-cross-channel-cap` |
| Exact DB image and restart behavior | `npm run test:fly-db-volume` |
| Release identity | Exact-SHA CI, CodeQL, image evidence, and protected workflow receipts |
| Live acceptance | Readiness, authenticated DB/Auth/REST/Kong, restarts, login, and zero-send campaign proof |

Passing source tests does not prove a live deployment. Keep source, release,
and live evidence separate.

## Known structure constraints

These are current facts, not permission for a broad rewrite:

- `src/lib/store.ts` is still the large client-state coordinator. Its public
  action and context contracts now live in the React-free
  `src/lib/store/contracts.ts`; callers retain the compatibility export from
  `src/lib/store.ts`. New domain calculations and action factories should move
  behind that contract in small React-free modules under `src/lib/store/` and
  remain covered by focused tests.
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
