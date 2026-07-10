# MSourcing / ARIA

MSourcing is the repo name; ARIA is the product identity used in the UI; older
Hermes names remain on some runtime and adapter surfaces for continuity. Today
the product is a recruiting operations console that turns intake into sourced
candidates, guarded outreach, reply handling, booking workflows, executive
visibility, and audit evidence with Supabase-backed live mode and a dry-run demo
mode.

## Current Stack

Verified from `package.json` on 2026-07-10:

| Area | Current truth |
|---|---|
| App | Next.js `^16.2.6` App Router, React `^19.2.7`, TypeScript `^5.6.3` |
| Data/auth | Supabase Postgres, Supabase Auth, RLS tenancy, service-role server APIs |
| UI/runtime | Tailwind, Recharts, lucide-react, Framer Motion, Three.js/R3F |
| Node | `22.x` |
| Verification | `npm test` runs 97 suite commands including `pretest` |
| Quality gates | `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:isolated` for this OneDrive checkout |

## Shipped Surfaces

| Surface | Where it lives | Status |
|---|---|---|
| Sourcing and campaign flow | `src/app/intake`, `src/app/campaigns`, `src/app/api/source`, `src/app/api/sourcing-agent` | Built |
| Outreach guardrails | `src/app/outreach`, `src/lib/dispatch-outbound.ts`, `src/lib/gate.ts`, `src/lib/outreach-*` | Built |
| Candidate disclosure security layer | `src/lib/agent-disclosure-policy.ts`, `tests/agent-disclosure-policy.mts`, `tests/salary-boundary-adversarial.mts` | Built |
| Public careers intake | `src/app/careers`, `src/app/api/careers/route.ts`, `src/lib/careers*` | Built |
| Executive dashboard | `src/app/exec`, `src/lib/exec-dashboard.ts` | Built |
| Win log | `src/app/winlog`, `tests/winlog.mts` | Built |
| Databricks intake | `src/app/api/integrations/databricks/needs/route.ts`, `src/components/settings/databricks-panel.tsx`, `tests/databricks-intake.mts` | Built |
| MCP query auth and secret-leak checks | `tests/mcp-query-auth.mts`, `tests/mcp-secret-leak-adversarial.mts` | Built |
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

## Deployment

The canonical deploy story is
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](production-readiness/DEPLOYMENT_RUNBOOK.md).
The short root pointer is [`DEPLOYMENT.md`](DEPLOYMENT.md).

Production requires, at minimum:

- Cloud Supabase project with every migration in `supabase/migrations/` applied
  in order by `supabase db push`.
- Required production env vars from `.env.production.example`.
- A verified delivery provider path before any live outreach.
- Domain, OAuth, and unsubscribe settings matching the deployment URL.
- Green local/CI gates against the release SHA.

The current dated status page is
[`production-readiness/STATUS.md`](production-readiness/STATUS.md).

## Architecture Map

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

Important code anchors:

- `src/lib/types.ts` is the central domain model.
- `src/lib/store.ts` owns client state and local/demo persistence.
- `src/lib/supabase/*` owns live-mode Supabase config and server helpers.
- `src/lib/crypto-secrets.ts` encrypts provider/OAuth secrets at rest when
  `DATA_ENCRYPTION_KEY` is set.
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
`supabase/migrations/` in order with `supabase db push` for linked projects or
`supabase db reset` locally. The only annotated per-migration list lives in the
canonical deploy runbook.
