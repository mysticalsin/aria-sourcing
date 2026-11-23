---
project: MSourcing / ARIA
shift: 475
agent: cursor
updated: 2026-11-23
status: integration-sweep-2
---

# Handoff - Shift 475

## Current state

- Suite head `94164d39921a346fceeefce7b934be10c760732f` on `integration/aria-all`. Artifact `e2e-artifacts/20261121T063931Z/`. Playwright exit 0. Compose exit 0. Notes: `docs/integration/SWEEP-02.md`.
- 14 click steps pass, including the original 13 and the synthetic CV upload. Quick-stat numbers stay clickable after Skip, and a return to Home has no dialog.
- Stress A1–A8 pass. A8 is 600.074s (`STRESS_SOAK_SECONDS=600`).
- Ingest image is healthy: `ingest serve` on `127.0.0.1:8091`, healthcheck `ingest ready`. The log line has the upload id, byte size, and state.
- `scripts/sandbox-bridge.sh` prints `apply` only for CI or a VM sandbox. Darwin always prints `skip: host firewall is not changed on macOS`.
- Draft PRs touched this shift: #210, #212, #284 (stacked on #217), #208. Product heads are in SWEEP-02.
- Mac harness: `scripts/integration-e2e.sh` no longer uses Bash 4 lowercase expansion. `COMPOSE_PROJECT` is set from `scripts/e2e-compose-project.sh` when unset. Frozen suite head `94164d39921a346fceeefce7b934be10c760732f` is unchanged. Check: `bash tests/integration-e2e-bash32.sh` (no Docker).
- Mac stress: an existing `go` is taken from `command -v` or the usual Mac install paths. When none is found, A1-channel, A2–A6, and A8 are `SKIP` with a harness reason. The harness does not install Go. Empty Playwright journeys get `journeysNote` in `summary.json`, and each finished step is written to `journey-matrix.json` as it ends. Check: `bash tests/e2e-harness-offline.sh`.

## Done this shift

- Closed the first-run dialog when the path leaves Home (#212, red `60e8ef68`).
- Added the candidate CV upload and the ingest HTTP handler (#284, red `4da47449`).
- Stopped the demo from requesting sourcing feedback while Supabase is off. The route still returns 503 (#210, red `b733c2ab`).
- Replaced the ingest sleep image with the real service.
- Guarded the bridge accept rule (red `dfcebafb`).
- Bash 3.2 Mac harness: red `tests/integration-e2e-bash32.sh`, then lowercase the compose project with `tr` and default `COMPOSE_PROJECT` when unset. Jarvis's detached-clone workaround stays off this remote.
- Mac go/journeys: red `tests/e2e-harness-offline.sh`, then discover an existing `go` or record `SKIP`, and explain an empty Playwright journey list. No Go install.

## Blockers

- Four compliance checks on this integration branch still fail. They name banned token labels from the token-channel tests and from `docs/integration/CONFLICTS.md`. The HeyReach catalog check passes. Do not merge this branch.
- Next.js printed a security advisory during `next dev` (nudge `fb1edeee-6b73-4b7d-93d2-1fd835d631d3`). #179 owns the upgrade. It was not run.

## Next steps

1. Read `docs/integration/SWEEP-02.md`.
2. Do not merge `integration/aria-all`.
3. Leave the product heads frozen at the suite SHA above.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: Aria does not call the professional-network host. The extension and the bridge stay deleted. The token option is only `src/channels/linkedin-token/`, off by default.
- Tony, 2026-11-20: MANUAL is the default. FULL AUTOMATIC needs a QC pass bound to the exact body hash.
- `body_hash` is the wire hash. `exact_body_hash` is the exact binding. The daily cap is the Postgres counter from #167.
- ADR 0002 stays withdrawn. Do not put the agents service back.
- This branch is a test vehicle. Do not merge it.
- The token channel has no refresh RPC. Do not add one unless a later design says so.
- #282 owns the agents `process.kill(1,0)` healthcheck. Do not add it on #210.
- #179 owns the Next.js security upgrade. Do not run it on this branch.

## Watch out

- One Compose healthcheck: the app ready probe. Do not re-add `process.kill(1,0)` on an agents service.
- One accept-script locator: the visible Manual tabpanel Name field in `scripts/accept-local-demo.mjs`.
- Do not force-push or delete `mbe-branch`, `mbe-ngrok`, `mbe-test`, or `twa-odoo`.
- `sudo docker` drops `APP_PORT` unless the script passes it. The click demo stays on port 3000. The packaged app publishes on 3010.
- The bridge rule must go through `scripts/sandbox-bridge.sh`. A developer Mac never gets the iptables change.
