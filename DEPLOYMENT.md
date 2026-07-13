# Deployment

Canonical Fly production procedure:
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](production-readiness/DEPLOYMENT_RUNBOOK.md).

Current source and release posture:
[`production-readiness/STATUS.md`](production-readiness/STATUS.md).

Production release requires protected exact-SHA checks, independent approval,
least-privilege credentials, database recovery evidence, immutable image
identity, complete migration identity, and live acceptance.

The Vercel demo is a separate non-production path:
[`DEPLOY_VERCEL_DEMO.md`](DEPLOY_VERCEL_DEMO.md).

Environment variable names and descriptions:
[`.env.production.example`](.env.production.example) and
[`.env.local.example`](.env.local.example). Do not store values in
documentation or Relay notes.

Source-derived Fly topology and sizing notes:
[`docs/operations/FLY_SIZING.md`](docs/operations/FLY_SIZING.md).
That guide does not prove the running machine inventory or measured capacity.
