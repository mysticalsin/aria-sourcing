# Documentation map

Start here to find what you need. This repo contains product documentation,
release material, a dated audit set, and agent working state. They do not carry
the same authority.

## Where things live

| Path | What it is | Read it when |
|---|---|---|
| [`README.md`](../README.md) | Project overview: stack, shipped surfaces, local run, verification, deploy summary, architecture map | First contact with the repo |
| [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | Current module boundaries, data ownership, agent isolation, runtime flows, and deployment topology | Understanding or changing the system |
| [`docs/BUILD_AND_READINESS.md`](BUILD_AND_READINESS.md) | How the system is built, plus the current gap registers for production readiness, enterprise readiness, and sourcing autopilot (LinkedIn included) | Deciding what still has to happen before this runs unattended |
| [`docs/SOURCING.md`](SOURCING.md) | The sourcing pipeline in depth: providers, scoring, enrichment waterfall, candidate corpus, compliance | Working on sourcing, scoring, or enrichment |
| [`docs/TESTING.md`](TESTING.md) | Focused, source, database, release, and live verification tiers | Proving a change |
| [`docs/API.md`](API.md) | Authenticated integration surface: sourcing, outreach, entitlements, MCP allowlist, loop ignition | Wiring an external system or writing a client |
| [`docs/INBOUND_REPLY_AUTOPILOT.md`](INBOUND_REPLY_AUTOPILOT.md) | Webhook-first candidate replies — classify once on answer, no idle token burn | Connecting mail inbound / full autopilot |
| [`docs/API_DESIGN.md`](API_DESIGN.md) | Internal API versioning, typed errors, paid-action safety, and contract-test policy | Changing a server route |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | Machine-readable contract for covered internal routes | Implementing or consuming a contracted route |
| [`docs/operations/APOLLO_AUTHORITY_RETENTION.md`](operations/APOLLO_AUTHORITY_RETENTION.md) | Apollo receipt retention, Fly cleanup monitoring, erasure, and evidence | Operating candidate-data retention controls |
| [`docs/operations/SOURCING_LEARNING.md`](operations/SOURCING_LEARNING.md) | Evidence-grounded sourcing, Graphify aggregate analysis, human promotion, kill switch, and recovery | Operating or auditing adaptive sourcing |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Change workflow, architecture rules, review, and completion evidence | Preparing a code change |
| [`SECURITY.md`](../SECURITY.md) | Private reporting, credential response, and security invariants | Reporting or reviewing a security issue |
| [`docs/operations/FLY_SIZING.md`](operations/FLY_SIZING.md) | Source-derived Fly machine configuration and evidence needed for tuning | Reviewing performance or topology |
| [`DEPLOYMENT.md`](../DEPLOYMENT.md) | Short deploy pointer + Fly VM sizing / performance notes | Deploying or tuning Fly |
| [`DOCKER.md`](../DOCKER.md) | Run the whole stack (app + self-hosted Supabase) locally in Docker | Running everything with one `docker compose up` |
| [`SUPABASE_SETUP.md`](../SUPABASE_SETUP.md) | Supabase schema/auth/roles setup | Standing up the database layer |
| [`DEPLOY_VERCEL_DEMO.md`](../DEPLOY_VERCEL_DEMO.md) | The separate Vercel `vercel-demo` demo path | Shipping the hosted demo |
| [`NEEDS_GUIDE.md`](../NEEDS_GUIDE.md) | Intake "needs" model guide | Working on intake/sourcing needs |
| [`AGENTS.md`](../AGENTS.md) | Instructions for AI coding agents on this repo | You are (or are configuring) an agent |

## Developer maps

| Map | Use it for |
|---|---|
| [`src/lib/README.md`](../src/lib/README.md) | Domain layers, stable entrypoints, and import rules |
| [`tests/README.md`](../tests/README.md) | Test taxonomy, focused gates, and permanent registration |
| [`scripts/README.md`](../scripts/README.md) | Build, recovery, provisioning, validation, and worker helpers |
| [`infra/README.md`](../infra/README.md) | Agent-framework infrastructure and related root deployment paths |
| [`docs/OWNERSHIP.md`](OWNERSHIP.md) | Verified working roles and document authority |

## Release and audit material: `production-readiness/`

Start with
[`production-readiness/README.md`](../production-readiness/README.md). It
separates current operating instructions from the dated 2026-06-27 audit set.

| File | Purpose |
|---|---|
| `production-readiness/README.md` | Authority map for this directory |
| `production-readiness/DEPLOYMENT_RUNBOOK.md` | **The** canonical Fly production deploy runbook |
| `production-readiness/LOCAL_SETUP.md` | Local environment setup |
| `production-readiness/STATUS.md` | Dated release posture (kept current; a test enforces its freshness) |
| `production-readiness/*_REPORT.md` | Historical audit evidence; verify against current source before using |

## Code & config

| Path | What it is |
|---|---|
| `src/` | The Next.js App Router app — routes (`src/app`), UI (`src/components`), logic (`src/lib`) |
| `supabase/migrations/` | Numbered SQL migrations — the schema source of truth |
| `docker/` | Dockerfiles + entrypoints for db / kong / bootstrap / obscura, and `kong.yml` |
| `docker-compose.yml` | Full self-contained local stack (see `DOCKER.md`) |
| `Dockerfile` / `Dockerfile.prod` | Dev image / standalone production image |
| `fly.*.toml` | Fly apps: `app`, `db`, `auth`, `rest`, `kong`, `bootstrap` |
| `scripts/` | Operational shell/TS helpers (local Supabase, backups, admin provisioning, screenshots) |
| `tests/` | The `npm test` gate — 100+ chained `.mts` checks (security, auth, gates, docs-truth, hygiene) |
| `public/` | Static assets, incl. `public/office3d/` (the Floor 3D scene, ~22 MB) and brand/logos |
| `docs/` | This dir: `screenshots/`, `partnerships/`, and design/plan docs |

## Agent working-state — NOT product documentation

These directories are the multi-agent build system's memory and hand-offs. Skim, don't study:

| Path | What it is |
|---|---|
| `_relay/` | Cross-agent hand-off / relay notes. Current state starts at `_relay/HANDOFF.md` |
| `_agent_state/` | Per-agent `memory.json` (learnings, findings) |
| `graphify-out/` | Ignored, machine-generated knowledge-graph output; regenerate locally when needed |
| `CLAUDE_RELAY_BATON.md` | Compatibility pointer; current work starts at `_relay/HANDOFF.md` |

Machine-local scratch (`.localbin/`, `.rocket-fuel/`) is git-ignored and never tracked
on a release tip — enforced by `tests/repository-hygiene.mts`.
