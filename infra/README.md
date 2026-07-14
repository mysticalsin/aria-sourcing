# Infrastructure source map

The tracked `infra/` tree currently contains the optional agent-framework
runtime. Root-level Fly applications, Dockerfiles, Compose, and database
migrations intentionally remain outside this directory because their public
paths are deployment contracts.

## Agent framework runtime

| Path | Responsibility |
|---|---|
| `agent-frameworks/adapter/` | Private ARIA adapter and workflow-vocabulary enforcement |
| `agent-frameworks/deerflow-agent/` | Checked-in DeerFlow agent configuration and role instructions |
| `agent-frameworks/deerflow-runtime/` | Pinned DeerFlow runtime policy and patch verification |
| `agent-frameworks/deerflow-skills/` | Reviewed role skill material used by the bounded runtime |
| `agent-frameworks/model-gateway/` | Private model-gateway policy and tests |
| `agent-frameworks/fly/` | Fly service definitions, operator, readiness, and image build graph |
| `agent-frameworks/compose.yaml` | Local framework-only topology |

The framework is not an authority source for candidate truth, credentials,
tenant ownership, persistence, approvals, or delivery. It returns a bounded
proposal; ARIA revalidates and performs any allowed effect. DeerFlow stays
memory-only and tracing-disabled. Flowise persistence remains isolated to its
approved PostgreSQL and Redis services.

## Related deployment roots

| Path | Responsibility |
|---|---|
| `fly.*.toml` | Core ARIA application, database, auth, REST, Kong, and bootstrap services |
| `docker/` | Core images, entrypoints, bootstrap, Kong, and Obscura definitions |
| `docker-compose.yml` | Self-contained local application stack |
| `supabase/migrations/` | Ordered database and authority source of truth |
| `.github/workflows/deploy-aria-mantu.yml` | Protected build, scan, attestation, promotion, deploy, and evidence workflow |

Start with [`agent-frameworks/README.md`](agent-frameworks/README.md) for its
runtime contract and
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](../production-readiness/DEPLOYMENT_RUNBOOK.md)
for production operations. Local source checks do not prove a live deployment.
