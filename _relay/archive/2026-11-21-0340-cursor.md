---
project: MSourcing / ARIA
shift: 472
agent: cursor
updated: 2026-11-21
status: integration-merge-in-progress
---

# Handoff - Shift 472

## Current state

- Branch `integration/aria-all` is being built from `twa-odoo` at `e3fa3f594a6d86aec31d42a65414a96be4c8400e`.
- PR #168 (`91c287c9817b459f351d0fabc9faa5604c4250f6`) is merged. The LinkedIn bridge, extension, autopilot, and Compose agents service stay deleted.
- PR #167 (`9e231dfcffc623df0fffce21b6d143df98c9fa5f`) is being merged on top. The approval ledger, `exact_body_hash`, and the Postgres daily cap stay. Its temporary 410 bridge routes do not.
- Michael's branches, `main`, `vercel-demo`, and `twa-odoo` are not rewritten.

## Done this shift

- Started the integration merge. Conflict notes go to `docs/integration/CONFLICTS.md`.

## Blockers

- Remaining PR heads are not merged yet.

## Next steps

1. Finish merges in the requested order.
2. Package the stack with a 6 GiB ceiling and run the sweep harness.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: `twa-odoo` is cut from `mbe-branch`. PRs target `twa-odoo`.
- Tony, 2026-11-20: Aria never calls the professional-network host. The extension, cookies, Voyager, and web-search sourcing stay out. The token option is a later off-by-default port under `src/channels/linkedin-token/`.
- Tony, 2026-11-20: MANUAL is the default. FULL AUTOMATIC is opt-in and requires a QC pass bound to the exact body hash.
- `body_hash` stays the wire hash. `exact_body_hash` is the exact approval binding.
- ADR 0002 is withdrawn. Do not reimplement the agents runner.
- Synthetic data only. No live sends, deploys, or paid calls.

## Watch out

- `0010` and `0011` remain the forward-only drops. #167's approval SQL is `0012` and `0013` so the version numbers do not collide.
- Do not force-push or delete `mbe-branch`, `mbe-ngrok`, `mbe-test`, or `twa-odoo`.
