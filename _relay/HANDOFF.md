---
project: MSourcing / ARIA
shift: 470
agent: cursor
updated: 2026-11-21
status: linkedin-token-auth-host-checks
---

# Handoff - Shift 470

## Current state

- Branch `cursor/linkedin-token-channel-3374`, based on `origin/twa-odoo` (`e3fa3f59`). PR #178. Do not merge.
- The LinkedIn session-token channel stays in `src/channels/linkedin-token/`. It is off until an owner or admin records the risk notice.
- Feature red-first commit: `ac8162a70b89cc8ed6622858e746ef0c66360393`.
- Authorization and host-check red-first commit: `624d7d8373d51ce1ba0fbfbbdd8b00f18f422c14`.
- Unit suite: `tests/linkedin-token.mts` and `tests/linkedin-token-security.mts` pass (34). Playwright `e2e/linkedin-token.spec.ts`: 14 passed, 0 failed (log `e2e-artifacts/20261121T034838Z`).
- `next` in the lockfile is still 16.4.3. No upgrade in this branch.

## Done this shift

- Token routes require a signed-in user and the session workspace. Viewers cannot change the channel. Approval stamps come from server state.
- Outbound delivery stays on loopback or one configured https host. The remote flag does not replace that check.
- The test-session route stays closed unless `NODE_ENV` is `test` and `ARIA_LINKEDIN_TOKEN_TEST_SESSION=1`. `scripts/e2e-mac.sh` sets both.

## Blockers

- None in this port. Wait for every CI check on the new head before freezing.

## Next steps

1. After CI is green, leave the branch frozen. Do not merge.
2. Narrow PR #168's negative test to allow exactly `src/channels/linkedin-token/`.
3. Apply `src/channels/linkedin-token/migration.sql` on Postgres when this channel is installed. Local proof uses SQLite via `ARIA_LINKEDIN_TOKEN_DB`.

## Decisions made (don't relitigate)

- Tony, 20:31 BRT: "the token option should be the existing one, toggleable on and off, off by default, with the same guardrails: approved text, daily caps, a kill switch and auto-pause."
- Tony, earlier: "Yes, build the Aria LinkedIn token option as an off-by-default switch with those safeguards."
- The port stays TypeScript and reuses `approvalHash` in `src/lib/outreach-content.ts`. The Go guardrails on PR #175 are not on this base and are not imported.
- The Chrome extension is not copied. The adapter sends HTTP with a user-supplied token to a configured base URL. Tests use a loopback fake only.
- Do not port `src/lib/sourcing/apify.ts` or `src/app/api/source/apify/**`.
- Do not upgrade Next.js on this branch.

## Watch out

- `@playwright/test` is pinned to 1.65.1. `scripts/e2e-mac.sh` refuses Node versions other than 22.x.
- `next dev` may exit once to show a Next.js security upgrade reminder, then continue on the next start. The script starts it twice for that reason.
- The dev bundler rewrites a direct `NODE_ENV` read. The session check builds that key at runtime.
- The token value is never logged. The end-to-end script fails if `fake-li-token-000` appears in the server log, Playwright log, HTML report, traces, or screenshots.
