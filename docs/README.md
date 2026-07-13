# Documentation map

Start here to find what you need. This repo mixes **product documentation**,
**operational dossiers**, and **agent working-state** — the last is not product docs,
and this map exists so you can tell them apart quickly.

## Where things live

| Path | What it is | Read it when |
|---|---|---|
| [`README.md`](../README.md) | Project overview: stack, shipped surfaces, local run, verification, deploy summary, architecture map | First contact with the repo |
| [`DEPLOYMENT.md`](../DEPLOYMENT.md) | Short deploy pointer + Fly VM sizing / performance notes | Deploying or tuning Fly |
| [`DOCKER.md`](../DOCKER.md) | Run the whole stack (app + self-hosted Supabase) locally in Docker | Running everything with one `docker compose up` |
| [`SUPABASE_SETUP.md`](../SUPABASE_SETUP.md) | Supabase schema/auth/roles setup | Standing up the database layer |
| [`DEPLOY_VERCEL_DEMO.md`](../DEPLOY_VERCEL_DEMO.md) | The separate Vercel `vercel-demo` demo path | Shipping the hosted demo |
| [`NEEDS_GUIDE.md`](../NEEDS_GUIDE.md) | Intake "needs" model guide | Working on intake/sourcing needs |
| [`AGENTS.md`](../AGENTS.md) | Instructions for AI coding agents on this repo | You are (or are configuring) an agent |

## Operational dossier — `production-readiness/`

The canonical release + enterprise-readiness evidence set (60+ files). Entry points:

| File | Purpose |
|---|---|
| `production-readiness/DEPLOYMENT_RUNBOOK.md` | **The** canonical Fly production deploy runbook |
| `production-readiness/DEPLOY_CHECKLIST.md` | Pre-flight gate checklist |
| `production-readiness/LOCAL_SETUP.md` | Local environment setup |
| `production-readiness/STATUS.md` | Dated release posture (kept current; a test enforces its freshness) |
| `production-readiness/ARCHITECTURE.md` | System architecture of record |
| `production-readiness/*_REPORT.md` | Per-domain readiness evidence (security, access, backup/restore, alerting, …) |

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
| `graphify-out/` | Generated knowledge-graph output |
| `CLAUDE_RELAY_BATON.md` | Long-form relay baton between agent sessions |

Machine-local scratch (`.localbin/`, `.rocket-fuel/`) is git-ignored and never tracked
on a release tip — enforced by `tests/repository-hygiene.mts`.
