# ARIA architecture guide

This is the current developer-facing architecture map for MSourcing / ARIA.
It describes the checked-in source on `mbe-branch`. The current target is a
local Docker demo of the recruiting journey; an internal Azure deployment
(Terraform) is planned later and not started.

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
| `src/lib/ai/` | LLM provider resolution, the bounded tool loop, and the built-in web and sourcing tools |
| `src/lib/server/` | Server-only authenticated-principal and side-effect boundaries |
| `src/lib/supabase/` | Supabase configuration, clients, and live workspace persistence |
| `supabase/migrations/` | Ordered database schema and authority source of truth |
| `tests/` | Executable contracts used by `npm test` |
| `scripts/` | Local setup, admin provisioning, smoke and acceptance helpers |
| `docker/`, `docker-compose.yml`, `Dockerfile` | Local stack: app + self-hosted Supabase and the one-shot bootstrap |
| `_relay/` | Agent handoff state; never use it as product or deployment documentation |

Use `@/...` imports within `src/`. Keep browser components out of
`src/lib/server/`, and keep provider credentials and service-role clients out
of client bundles.

Developer maps:

- [`src/lib/README.md`](../src/lib/README.md) for domain layers and import rules
- [`tests/README.md`](../tests/README.md) for test taxonomy and registration
- [`scripts/README.md`](../scripts/README.md) for operational helpers

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
| Sourcing runs and quota | `sourcing_runs` and receipts behind `src/lib/sourcing/learning-authority.ts` |
| Candidate conversation | `agent_conversations` and provider thread identity from migration `0023` |
| External integration authority | Normalized admin-owned connection tables |
| Human approval | `outreach_approvals`, bound to the exact message body |
| Delivery and reconciliation | `outreach_ledger`, `messages_outbound`, and provider receipt tables |
| Suppression and consent | Normalized suppression, consent, sender, and contact-policy tables |

Apply every numbered migration in order. The missing `0016` number is
intentional; do not renumber migrations or hand-pick a partial range.

## Sourcing agent

The sourcing agent runs in-process; there is no external agent framework.

1. The campaign **Run agent** control (`src/components/run/agent-run-stream.tsx`)
   calls `runCampaignSourcing` (`src/lib/sourcing/campaign-run.ts`), which uses
   the canonical store action `sourceNextBatch`. Only an explicit demo
   deployment may use the synthetic `Talent Pool` source.
2. In a live workspace the action calls `src/app/api/sourcing-agent/route.ts`.
   The route re-reads the campaign from `workspace_state`, requires a reviewed
   brief and at least one reviewed query, and claims a sourcing run through
   `src/lib/sourcing/learning-authority.ts` (quota, idempotency).
3. With an LLM provider configured it runs in `cloud` mode: a bounded tool loop
   (`src/lib/ai/tool-loop.ts`, Anthropic or OpenAI-compatible) where the only
   sourcing tool is `search_candidates` (`src/lib/ai/sourcing-tools.ts`). The
   tool runs the real GitHub / web-search pipeline and returns already-scored
   people; the model chooses among them and drafts first-touch copy. Without a
   provider it runs in `deterministic` mode over the reviewed GitHub queries.
4. The route returns a strict DTO (`src/lib/sourcing/sourcing-agent-contract.ts`)
   with the campaign fingerprint; the store re-scores, dedupes and persists only
   if the campaign has not changed meanwhile.

### Sender seats

`AgentSeat` (`/fleet`, labelled **Mailboxes** in the navigation) is a sender
mailbox: provider connection (Gmail, Microsoft Graph, Resend, SendGrid, or
LinkedIn assisted-manual), persona, and send limits. Delivery always resolves a
live seat server-side; the browser never chooses credentials.

Tables from removed agent-framework features (`agent_specs`, `agent_runs`,
agent memory, swarm, loop jobs) remain in the schema because migrations are not
rewritten; no route reads them any more.

## Outreach and reply authority

There are two distinct draft paths. Do not merge their authority:

| Path | Storage | Can send? |
|---|---|---|
| Sourcing-agent first-touch draft | Outreach queue as a draft | Only after human approval, through the server send route |
| Operator-created outbound | Outreach approval plus delivery ledger | Only through the server send route |

`src/app/api/outreach/send/route.ts` is the live email delivery boundary.
`src/lib/dispatch-outbound.ts` owns durable dispatch and reconciliation.
`src/lib/delivery-outcome.ts` owns the shared HTTP retry-safety
classification used by the email adapters. Unknown provider outcomes remain
non-retryable until an operator reconciles them. Outreach channels are Email
and assisted LinkedIn; the dispatcher refuses any other channel (including
legacy WhatsApp / SMS rows) before approval, claim, or provider work.

LinkedIn remains assisted-manual unless an official signed integration is
available. Do not add login automation, scraping, or rate-limit bypass.

## Integration boundaries

- AI providers are called only from server routes after credential resolution.
- Live GitHub, Apify, and web-search records are normalized by
  `src/lib/sourcing/candidate-mappers.ts`. `src/lib/mock-ai.ts` contains
  deterministic synthetic behavior and compatibility re-exports only.
- Provider keys and OAuth tokens are encrypted at rest and never returned to
  the browser.
- Dust uses normalized admin-owned connection authority; shared
  `workspace_state` cannot select an external tenant, origin, or secret.
- MCP execution is disabled in production unless the explicit server-side
  policy allows the exact connection and operation.
- Public web fetches validate and pin the resolved address, reject redirects,
  and block private, reserved, metadata, and non-global destinations.

## Runtime topology

The demo runs locally with `docker compose up --build` (see
[`DOCKER.md`](../DOCKER.md)):

```text
Browser
  -> app (Next.js dev server, :3000)
  -> kong (:54321)
       -> auth (GoTrue)
       -> rest (PostgREST)
            -> db (supabase/postgres)

db-init, supabase-bootstrap
  -> owner reconciliation, ordered hash-checked migrations, admin seed; then exit
```

An internal Azure Cloud deployment (Terraform) is planned and not started.

## Verification layers

| Layer | Command or evidence |
|---|---|
| Application type safety | `npm run typecheck` |
| Test type safety | `npm run typecheck:tests` |
| Lint | `npm run lint` |
| Deterministic contracts | `npm test` |
| OneDrive-safe production build | `npm run build:isolated` |
| Database authority | Disposable-database suites run by the `database-security` job in `.github/workflows/ci.yml` |
| Local stack | `docker compose up --build`, then sign in and walk the journey |

Passing source tests does not prove the stack boots; check both.

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

## Senior developer onboarding

Read in this order:

1. [`README.md`](../README.md)
2. This architecture guide
3. [`docs/README.md`](README.md)
4. The route and domain module for the feature being changed
5. The matching tests and relevant numbered migrations
6. [`_relay/HANDOFF.md`](../_relay/HANDOFF.md) only when coordinating active
   work with another agent

Before changing an authority boundary, find the matching negative test first.
Before changing persisted data, inspect every later migration that replaces the
same function, policy, trigger, or privilege.
