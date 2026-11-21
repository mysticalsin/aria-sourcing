---
project: MSourcing / ARIA
shift: 473
agent: cursor
updated: 2026-11-21
status: integration-sweep-0-draft
---

# Handoff - Shift 473

## Current state

- Branch `integration/aria-all` is the no-ff merge of `twa-odoo` (`e3fa3f594a6d86aec31d42a65414a96be4c8400e`) plus PRs #168, #167, #170, #169, #171, #176, #175, #178, #174, #172, #177 in that order. #173 was not merged.
- Conflict notes: `docs/integration/CONFLICTS.md`. Sweep notes: `docs/integration/SWEEP-00.md`.
- Michael's branches, `main`, `vercel-demo`, and `twa-odoo` were not rewritten. No force-push.

## Done this shift

- Merged the eleven heads. The LinkedIn bridge and the Compose agents service stay deleted. Approval migrations are `0012` and `0013`.
- Added `scripts/integration-e2e.sh`, `scripts/integration-e2e-mac.sh`, `e2e/integration/**`, and `stress/**`.
- Ran the click sweep under xvfb and stress cases A1-A8. A5 fails: touches are stored after Hired. A8 passed at 1800s. Compose started; Odoo could not open a TCP connection to its database in this VM.

## Blockers

- `services/ingest/Dockerfile` does not build (`poppler-utils` pin). The overlay skips that image.
- The Next demo session is a member, so the LinkedIn token switch returns 403.

## Next steps

1. Read `docs/integration/SWEEP-00.md` and fix each finding on its owning PR, not on this branch.
2. Re-run `bash scripts/integration-e2e.sh` after those fixes.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: Aria does not call the professional-network host. The extension and the bridge stay deleted. The token option is only `src/channels/linkedin-token/`, off by default.
- Tony, 2026-11-20: MANUAL is the default. FULL AUTOMATIC needs a QC pass bound to the exact body hash.
- `body_hash` is the wire hash. `exact_body_hash` is the exact binding. The daily cap is the Postgres counter from #167.
- ADR 0002 stays withdrawn. Do not put the agents service back.
- This branch is a test vehicle. Do not merge it.

## Watch out

- One Compose healthcheck: the app ready probe. Do not re-add `process.kill(1,0)` on an agents service.
- One accept-script locator: the visible Manual tabpanel Name field in `scripts/accept-local-demo.mjs`.
- Do not force-push or delete `mbe-branch`, `mbe-ngrok`, `mbe-test`, or `twa-odoo`.
