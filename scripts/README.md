# Script map

`scripts/` holds local build, setup, provisioning and probe helpers. The local
stack itself starts with `docker compose up --build` (see [`DOCKER.md`](../DOCKER.md)).

## Categories

| Purpose | Scripts |
|---|---|
| OneDrive-safe build | `build-isolated.mjs` |
| Local database without Docker Compose | `local-supabase-up.sh` (Supabase CLI) |
| Initial authority on a non-local Supabase | `provision-first-admin.sh` |
| Acceptance and probes | `acceptance-campaign-dry-run.sh`, `smoke-source-live.mts`, `smoke-linkedin-live.mts`, `probe-tavily-mcp.mts`, `validate-email-domain.mjs` |
| Test runners | `run-test-manifest.mjs` (behind `npm test`), `run-tests-sandbox.mjs` (keep-going diagnostics) |

## Script rules

- Resolve the repository root from the script location; do not rely on an
  operator's current directory.
- Validate required authority before mutation and fail closed on missing input.
- Keep secrets out of arguments, stdout, receipts, and process listings.
- Use bounded waits, forward termination signals, and clean only resources
  created by the script.

The matching contracts live under [`tests/`](../tests/README.md).
