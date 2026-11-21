---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-21
status: linkedin-token-port-ready
---

# Handoff - Shift 469

## Current state

- Branch `cursor/linkedin-token-channel-3374`, based on `origin/twa-odoo` (`e3fa3f59`).
- The LinkedIn session-token channel is a self-contained port in `src/channels/linkedin-token/`. It is off until an owner or admin records the risk notice.
- Red-first commit: `ac8162a70b89cc8ed6622858e746ef0c66360393`.
- Unit suite `tests/linkedin-token.mts`: 27 passed. Playwright `e2e/linkedin-token.spec.ts`: 14 passed, 0 failed, 0 skipped (log `e2e-artifacts/20261121T000939Z`).
- No Apify code was ported. Michael's `mbe-*` branches were not modified.

## Done this shift

- Ported the Voyager `createMessage` request, csrf session send, `sendSlot`, and answer classification from `mbe-branch` `e3fa3f594a6d86aec31d42a65414a96be4c8400e` into `src/channels/linkedin-token/`.
- Added the off-by-default flag, admin acknowledgement, exact-text approval (`approvalHash`), caps, pacing, kill switch, auto-pause, AES-GCM token storage, revoke, purge, and Odoo-shaped audit notes.
- Settings screen: `/channels/linkedin-token`. Migration SQL lives in the same directory.
- `scripts/e2e-mac.sh` runs the suite. On macOS it uses `PLAYWRIGHT_BROWSERS_PATH` (default `~/qa-tools/playwright/browsers`) and does not download browsers. CI installs Chromium for `@playwright/test` 1.65.1.

## Blockers

- None in this port. Codex review is unavailable (quota).

## Next steps

1. Review the PR. Base is `twa-odoo`. The directory can be re-stacked onto `main` at `b5480986` without the Go channel adapters.
2. Narrow PR #168's negative test to allow exactly `src/channels/linkedin-token/`.
3. Apply `src/channels/linkedin-token/migration.sql` on Postgres when this channel is installed. Local proof uses SQLite via `ARIA_LINKEDIN_TOKEN_DB`.

## Decisions made (don't relitigate)

- Tony, 20:31 BRT: "the token option should be the existing one, toggleable on and off, off by default, with the same guardrails: approved text, daily caps, a kill switch and auto-pause."
- Tony, earlier: "Yes, build the Aria LinkedIn token option as an off-by-default switch with those safeguards."
- The port stays TypeScript and reuses `approvalHash` in `src/lib/outreach-content.ts`. The Go guardrails on PR #175 are not on this base and are not imported.
- The Chrome extension is not copied. The adapter sends HTTP with a user-supplied token to a configured base URL. Tests use a loopback fake only.
- Do not port `src/lib/sourcing/apify.ts` or `src/app/api/source/apify/**`.

## Watch out

- `@playwright/test` is pinned to 1.65.1. `scripts/e2e-mac.sh` refuses Node versions other than 22.x.
- `next dev` may exit once to show a Next.js security upgrade reminder, then continue on the next start. The script starts it twice for that reason.
- The token value is never logged. The end-to-end script fails if `fake-li-token-000` appears in the server log, Playwright log, HTML report, traces, or screenshots.
