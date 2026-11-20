---
project: MSourcing / ARIA
shift: 470
agent: cursor
updated: 2026-11-20
status: compliance-boundaries-pr-open
---

# Handoff - Shift 470

## Current state

- Branch `twa-odoo` is `e3fa3f594a6d86aec31d42a65414a96be4c8400e`. Michael's branches were not rewritten.
- PR 168 targets `twa-odoo` from `cursor/compliance-boundaries-8b20`. Not merged.
- Red-first commit `17afd643c12acbd0178a843504816a67e7b44d7a` adds tests that failed before the host and migration fixes.
- `0010_drop_linkedin_bridge.sql` and `0011_drop_agent_autopilot.sql` are forward-only, unapplied, and have no down migration. Existing databases keep `token_hash` and the autopilot rows until those files run.
- `vendorApiAdapter` and `LINKEDIN_VENDOR_API_*` are gone. Dispatch refuses the LinkedIn channel. There is no agents service and no sample `AGENT_RUNNER_SECRET` in Compose.
- The secret scan follows `HEAD`. `.gitleaksignore` adds one fingerprint for the historical intake variable name.

## Done this shift

- Removed the bare `linkedin.com` host from comments, docs, and the web-search host map. Stored or rejected profile paths remain.
- Documented the forward-only drops. Removed `linkedin_oidc` from the auth provider comment.
- A command timeout is retried once. A second timeout exits 2 as an infrastructure error. A product failure is not retried.

## Blockers

- Do not merge until the exact head is green, including the Release gate.

## Next steps

1. Review PR 168 on its exact head. Do not retarget it onto `mbe-branch`.
2. Re-freeze PR 167 on top of this head after 168 lands. Do not merge 167 first.
3. Apply `0010` and `0011` only on a disposable database. Export bridge rows first if they are still needed. `token_hash` stays until `0010` runs.

## Decisions made (don't relitigate)

- Tony, 2026-11-20: `twa-odoo` is cut from `mbe-branch`. PRs target `twa-odoo`.
- Tony, 2026-11-20: Aria never calls the professional-network host. The extension, cookies, tokens, Voyager, and web-search sourcing are permanently out.
- Tony, 2026-11-20: HeyReach may be built later, flag-off, official API only, in the separate Go channel module. It is not in this tree.
- Tony, 2026-11-20: no automation or scraping of `arp.mantu.com`.
- ADR 0002 is withdrawn. Do not reimplement the runner.
- Synthetic data only. No live sends, deploys, or paid calls.
- `0006`–`0009` stay byte-for-byte. Drops are forward-only. There is no down migration.

## Watch out

- Profile path strings may still be stored. That is not a fetch. `tests/compliance-boundaries.mts` fails on a bare host, `licdn`, or a request.
- `_relay/archive/2026-11-20-2200-cursor.md` describes a local password-reset procedure. Do not copy it forward.
- Do not force-push or delete `mbe-branch`, `mbe-ngrok`, `mbe-test`, or `twa-odoo`.
- `.gitleaksignore` should stay minimal so PR 167 can re-freeze on this branch.
