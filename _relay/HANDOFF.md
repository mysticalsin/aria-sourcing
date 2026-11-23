---
project: MSourcing / ARIA
shift: 473
agent: cursor
updated: 2026-11-23 16:04 America/Sao_Paulo
status: linkedin-token-devin-followup
---

# Handoff - Shift 473

## Current state

- Branch `cursor/linkedin-token-channel-3374`, PR #178, base `twa-odoo` (`e3fa3f594a6d86aec31d42a65414a96be4c8400e`). Do not merge.
- Tip: `git rev-parse HEAD` on this branch. Additive commits only. No force push.
- The channel stays in `src/channels/linkedin-token/`. It is off until an owner or admin records the risk notice.
- `next` in the lockfile is still 16.4.3. This branch does not upgrade Next.js.

## Done this shift

- The token panel no longer sends a fixed workspace id. It uses the workspace from the session, and the settings workspace only when the session has none. Settings links "Your LinkedIn" to `/channels/linkedin-token`.
- A resolved `2002::/16` address is refused when the embedded IPv4 is non-public. `fec0::/10` and `240.0.0.0/4` are refused before any fetch. A public 6to4 embedding is still allowed.
- A pumped refusal writes the queue row as `failed`, including the sqlite copy, so it does not stay `queued`.

## Blockers

- None for this follow-up. Sentinel CONSENSUS is PENDING. Do not merge.

## Next steps

1. Wait for CI on the new tip. Do not merge.
2. Stack conflicts with #251, #272, and #282 are shared files (`.gitleaksignore`, `docker-compose.yml`, `scripts/accept-local-demo.mjs`, `tests/test-manifest.mjs`, `_relay/HANDOFF.md`, `.github/workflows/ci.yml`). Do not rewrite those tips.

## Decisions made (don't relitigate)

- Tony: the token option stays the existing one, off by default, with approved text, daily caps, a kill switch, and auto-pause.
- H-01, NEW-2, and NEW-6 stay as already fixed.
- A timeout keeps the cap slot and the approval. It does not start a second transport attempt.
- Do not upgrade Next.js on this branch.

## Watch out

- `@playwright/test` is pinned to 1.65.1. `scripts/e2e-mac.sh` refuses Node versions other than 22.x.
- The gitleaks exception is one exact digest line, not a path.
- The test-session workspace id stays on the server. The panel reads it from the session response.
