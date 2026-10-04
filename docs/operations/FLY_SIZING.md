# Fly topology and sizing

This note records the checked-in Fly configuration. It is not live inventory,
load-test evidence, or approval for a topology change.

## Current source configuration

All service definitions use the `cdg` primary region.

| Service | Source file | VM size | Memory | Exposure |
|---|---|---|---|---|
| Next.js application | `fly.app.toml` | `shared-cpu-2x` | 2 GB | Public |
| Kong gateway | `fly.kong.toml` | `shared-cpu-1x` | 1 GB | Public Supabase surface |
| GoTrue Auth | `fly.auth.toml` | `shared-cpu-1x` | 512 MB | Internal |
| PostgREST | `fly.rest.toml` | `shared-cpu-1x` | 512 MB | Internal |
| PostgreSQL | `fly.db.toml` | `shared-cpu-2x` | 2 GB | Internal with durable volume |
| Bootstrap | `fly.bootstrap.toml` | One-shot | Provider default | Internal migration and reconciliation job |

Verify the running machine size and image digest through Fly before making a
capacity claim. A checked-in TOML file proves intended configuration only.

## Request path

```text
Browser
  -> Next.js
  -> Kong
       -> Auth or PostgREST
            -> PostgreSQL
```

Every additional service hop can add latency, but the repository contains no
current production load, saturation, or percentile-latency evidence that
isolates any one hop as the bottleneck.

## Tuning order

1. Capture request rate, p50/p95/p99 latency, CPU, memory, restart, and database
   wait evidence for the exact running release.
2. Separate browser, SSR, gateway, Auth, REST, and database latency.
3. Reproduce the bottleneck with synthetic data in a non-production
   environment.
4. Change one resource or topology variable.
5. Run source gates, recovery tests, and live acceptance again.
6. Record cost and before/after measurements.

Do not infer that more shared CPU will fix a network, lock, query-plan, build,
or external-provider delay.

## Topology changes

Combining the Supabase services into one machine or moving the data plane to a
managed Supabase project would change failure domains, recovery, secret scope,
network exposure, scaling, and rollback. Either option requires:

- an architecture decision record;
- a threat-model and data-residency review;
- backup and restore proof;
- two restart cycles with persisted data;
- migration and rollback evidence;
- load and failure testing;
- updated cost ownership.

Until that evidence exists, the multi-service Fly topology remains the
checked-in production design.
