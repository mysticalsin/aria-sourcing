# MSourcing / ARIA

MSourcing is the repo name; ARIA is the product identity used in the UI; older
Hermes names remain on some runtime and adapter surfaces for continuity. Today
the product is a recruiting operations console that turns intake into sourced
candidates, guarded outreach, reply handling, booking workflows, executive
visibility, and audit evidence with Supabase-backed live mode and a dry-run demo
mode.

## Current Stack

Verified from `package.json` on 2026-07-13:

| Area | Current truth |
|---|---|
| App | Next.js `^16.2.6` App Router, React `^19.2.7`, TypeScript `^5.6.3` |
| Data/auth | Supabase Postgres, Supabase Auth, RLS tenancy, service-role server APIs |
| UI/runtime | Tailwind, Recharts, lucide-react, Framer Motion, Three.js/R3F |
| Node | `22.x` |
| Verification | `npm test` runs 156 chained checks: 34 `pretest` commands plus 122 test commands |
| Quality gates | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:isolated` for this OneDrive checkout |

## Shipped Surfaces

| Surface | Where it lives | Status |
|---|---|---|
| Sourcing and campaign flow | `src/app/intake`, `src/app/campaigns`, `src/app/api/source`, `src/app/api/sourcing-agent` | Built |
| Review-gated sourcing lessons | `supabase/migrations/0027_sourcing_learning_authority.sql`, `workers/graphify-lessons`, `docs/operations/SOURCING_LEARNING.md` | Built in source; database migration, digest-pinned worker image, and human review operations required |
| Outreach guardrails | `src/app/outreach`, `src/lib/dispatch-outbound.ts`, `src/lib/gate.ts`, `src/lib/outreach-*` | Built |
| Candidate disclosure security layer | `src/lib/agent-disclosure-policy.ts`, `tests/agent-disclosure-policy.mts`, `tests/salary-boundary-adversarial.mts` | Built |
| Public careers intake | `src/app/careers`, `src/app/api/careers/route.ts`, `src/lib/careers*` | Built |
| Executive dashboard | `src/app/exec`, `src/lib/exec-dashboard.ts` | Built |
| Win log | `src/app/winlog`, `tests/winlog.mts` | Built |
| Databricks intake | `src/app/api/integrations/databricks/{config,needs}`, `src/lib/integrations/databricks-authority.ts`, `tests/{databricks-intake,integration-authority}.mts` | Built in source; migration 0019, deployment `DATABRICKS_ALLOWED_ORIGINS`, and admin rebinding required |
| MCP discovery and query auth | `src/app/api/mcp/test`, `tests/mcp-query-auth.mts` | Built; HTTPS port 443 only |
| Third-party MCP execution | `src/lib/mcp-client.ts`, `tests/mcp-runtime-policy.mts` | Disabled in production; nonproduction requires explicit opt-in |
| Hermes runtime proxy | `src/app/api/hermes/*`, `src/lib/api/hermes-proxy.ts` | Built, private runtime required |
| Google/Microsoft mailbox OAuth | `src/app/auth/google/*`, `src/app/auth/microsoft/*`, `src/lib/email-oauth.ts` | Built, provider credentials required |
| WhatsApp review and inbound safety | `src/app/api/webhooks/whatsapp/route.ts`, `src/app/api/outreach/whatsapp-review/route.ts`, `src/lib/channels.ts` | Built, Meta credentials required |

LinkedIn remains compliant assisted-manual unless an official signed integration
is provided. The app must not automate LinkedIn login, scraping, or rate-limit
bypass.

## Local Run

Install and run the demo UI:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

To run against local Supabase instead of browser demo state:

```bash
bash scripts/local-supabase-up.sh
npm run dev
```

The script starts local Supabase, applies every numbered migration in
`supabase/migrations/`, and writes a local `.env.local`. It requires Docker
Desktop and the Supabase CLI.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build:isolated
```

Use `npm run build:isolated` in this OneDrive-synced checkout. It copies the
project to a temporary workspace and runs the normal Next build there.

## Documentation

[`docs/README.md`](docs/README.md) is the documentation map. It says what every
top-level directory and doc is for, and separates product docs from the operational
dossier (`production-readiness/`) and agent working-state (`_relay/`, `_agent_state/`).
Start there when you're looking for something and don't know which file holds it.

The current developer architecture is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Change workflow and verification are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/TESTING.md`](docs/TESTING.md). Security reporting and invariants are in
[`SECURITY.md`](SECURITY.md).

## Deployment

The canonical deploy story is
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](production-readiness/DEPLOYMENT_RUNBOOK.md).
The short root pointer is [`DEPLOYMENT.md`](DEPLOYMENT.md).

Production requires, at minimum:

- Fly-hosted PostgreSQL recovered and migrated only through the protected
  bootstrap ledger path in the canonical workflow. Do not run `supabase db
  push` against the Fly production database.
- Required production env vars from `.env.production.example`.
- Protected GitHub `Production` environment secrets for the Fly deployment and
  a separate registry-only `FLY_REGISTRY_TOKEN` restricted to the app, DB,
  bootstrap, and Kong registries. Do not reuse a general operator token.
- A verified delivery provider path before any live outreach.
- Domain, OAuth, and unsubscribe settings matching the deployment URL.
- Green local/CI gates against the release SHA.

The protected Fly workflow builds the app, DB, bootstrap, and Kong images from
the exact release SHA, pushes isolated candidates, pulls and scans their exact
registry digests, signs provenance and SBOM attestations, promotes immutable SHA
tags, and deploys without rebuilding. It also pulls the config-pinned upstream
Auth and REST images for `linux/amd64`, applies the same CycloneDX,
HIGH/CRITICAL, and secret gates, records them as upstream rather than claiming a
local build attestation, and compares all six running digests. Its always-run
evidence upload retains rollback, manifest, schema-validated SBOM, vulnerability,
filesystem plus image-config/history secret, attestation, and release receipts
even when a later gate fails.
The workflow must exist on the repository default branch before manual dispatch
is available.

The current dated status page is
[`production-readiness/STATUS.md`](production-readiness/STATUS.md).

## Architecture map

```text
src/
  app/                       Next App Router pages and API routes
  components/                App shell, feature UI, dashboard, settings, trust, 3D floor
  lib/                       Domain logic, providers, Supabase helpers, security gates
  styles/                    Global CSS and design tokens

supabase/
  migrations/                Root-level Supabase SQL migrations, apply in order

tests/                       Root-level TypeScript test suites
scripts/                     Local setup, backup/restore, smoke, build helpers
production-readiness/        Canonical deployment runbook, checklist, status, older evidence pack
```

For data ownership, agent isolation, request flows, and deployment boundaries,
read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Important code anchors:

- `src/lib/types.ts` is the central domain model.
- `src/lib/store.ts` owns client state and local/demo persistence.
- `src/lib/store/contracts.ts` owns the React-free public action and context
  contracts used to decompose the client store without breaking callers.
- `src/lib/store/campaign-actions.ts` owns campaign/intake mutations, editable
  field filtering, and viewer-safe mutation checks.
- `src/lib/store/campaign-launch.ts` summarizes multi-role creation and sourcing
  results without allowing partial success to appear complete.
- `src/lib/supabase/*` owns live-mode Supabase config and server helpers.
- `src/lib/crypto-secrets.ts` encrypts provider/OAuth secrets at rest when
  `DATA_ENCRYPTION_KEY` is set and supports bounded rotation through
  `DATA_ENCRYPTION_PREVIOUS_KEYS`.
- `src/lib/agent-disclosure-policy.ts` blocks candidate-facing disclosure leaks.
- `src/lib/metrics.ts` and `src/lib/exec-dashboard.ts` define metric semantics.
- `src/app/api/cron/dispatch-outbound/route.ts` is protected by `CRON_SECRET`.

## Environment

Use `.env.local.example` for local development and `.env.production.example` for
Vercel/self-hosted production. Both examples are regenerated from the actual
`process.env.*` reads under `src/`, plus the provider-map keys used through
`process.env[PROVIDER_ENV[provider]]`.

Do not commit real secrets.

## Migration Rule

Do not hand-pick a partial migration range. Apply every file in
`supabase/migrations/` in order. Fly production uses only the protected
bootstrap ledger path. `supabase db push` is limited to a separately linked
legacy Vercel demo project, and `supabase db reset` is local development only.
The only annotated per-migration list lives in the canonical deploy runbook.
