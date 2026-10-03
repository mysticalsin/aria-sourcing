# Operational script map

`scripts/` contains local build, database, recovery, provisioning, validation,
and bounded worker entrypoints. Scripts are implementation tools; the canonical
production procedure remains
[`production-readiness/DEPLOYMENT_RUNBOOK.md`](../production-readiness/DEPLOYMENT_RUNBOOK.md).

## Categories

| Purpose | Scripts |
|---|---|
| OneDrive-safe build | `build-isolated.mjs` |
| Local database | `local-supabase-up.sh`, `test-db-privileges.sh` |
| Backup and recovery | `backup.sh`, `restore-drill.sh`, `recovery-receipt-digest.mjs`, `validate-volume-recovery-receipt.mjs`, `recover-orphan-workspace-owner.sh` |
| Initial authority | `provision-first-admin.sh`, `seed-cloud-admin.sh`, `provision-agent-framework-authority.mjs` |
| Agent frameworks | `agent-framework-configuration.mjs`, `agent-framework-heartbeat-worker.mjs` |
| Sourcing learning | `configure-sourcing-learning.mjs`, `run-sourcing-learning.mjs`, `review-sourcing-lesson.mjs` |
| Acceptance and probes | `acceptance-campaign-dry-run.sh`, `smoke-source-live.mts`, `probe-tavily-mcp.mts`, `test-fly-db-volume.sh` |
| Test diagnostics | `run-tests-sandbox.mjs` |

## Script rules

- Resolve the repository root from the script location; do not rely on an
  operator's current directory.
- Validate required authority before mutation and fail closed on missing input.
- Keep secrets out of arguments, stdout, receipts, and process listings.
- Use bounded waits, forward termination signals, and clean only resources
  created by the script.
- Production migrations and deploys run only through the protected workflow;
  helper scripts do not grant release authority.

The matching contracts live under [`tests/`](../tests/README.md). Infrastructure
topology is mapped in [`infra/README.md`](../infra/README.md).
