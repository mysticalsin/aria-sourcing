---
project: MSourcing / ARIA
shift: 437
agent: cursor
updated: 2026-11-23T17:12Z
status: rsc-connect-state-draft
---

# Handoff — Shift 437

## Current state

- Branch `cursor/linkedin-rsc-connect-076b` off `origin/main` `b5480986`. Not merged.
- Official Recruiter System Connect state is read only from `LINKEDIN_RSC_URL` and `LINKEDIN_RSC_TOKEN`. The settings panel shows Connected or Not connected. The token is not accepted from the browser and is not returned by `GET /api/linkedin/connect`.
- A `linkedin.com` page URL is refused. `http` is refused except a loopback stub (`127.0.0.1`, `localhost`, `::1`) used by tests.
- `POST /api/linkedin/rsc/search` still returns synthetic workspace candidates when RSC is unset or refused. When the env is valid it POSTs `{ source: "recruiter-system-connect", query, count }` with a bearer token and applies the quality bar.
- The vendor token channel (`LINKEDIN_VENDOR_API_URL` / `LINKEDIN_VENDOR_API_KEY`) stays off by default. Exact-text approval in `0054_linkedin_channel_adapter_authority.sql` is unchanged.
- Gate on this shift: `npx tsc --noEmit` clean, `npm run typecheck:tests` clean, `npm test` exit 0 with `flyctl` on `PATH` and `FLY_API_TOKEN=local-validate-only`. `npx tsx scripts/linkedin-rsc-playwright.mts` passed disconnected, refused page URL, and a local stub (2 searches). No live LinkedIn call.

## Done this shift

1. Server connect state and settings panel for RSC plus the off-by-default token channel.
2. RSC catalog card no longer asks the browser to store a token.
3. Unit suite `tests/linkedin-rsc-connect.mts` (36 passed) registered in the application manifest. Counts are now application 153 / all 206 / parity 207.
4. Playwright proof in `scripts/linkedin-rsc-playwright.mts` against a local stub. Synthetic names only.
5. `production-readiness/STATUS.md` date refreshed to 2026-11-23 so `docs-truth` stays inside its 31-day window. The source-gate text was not rewritten.

## Blockers

- A live Recruiter System Connect call needs Tony to set `LINKEDIN_RSC_URL` (HTTPS API, not a linkedin.com page) and `LINKEDIN_RSC_TOKEN` on the server. No token was invented.
- The vendor token channel stays off until `LINKEDIN_VENDOR_API_URL` and `LINKEDIN_VENDOR_API_KEY` are set. Sends still need the existing exact-text human approval.

## Next steps

1. Review the draft PR. Do not merge from this handoff.
2. For a live RSC check, set the two server env vars and call `GET /api/linkedin/connect`. Expect `connected: true` and no token in the JSON.
3. Leave PR #287 (`cursor/sourcing-through-hired-bfd1`, tip `dfca5267a4b3ad8258bc31aac3cc22117de08558`) frozen. Do not push onto it.

## Decisions made (don't relitigate)

- #49 closed permanently; #51 was the Europe successor — now merged
- Keep focused Europe/EMEA geo+scoring slice — no megapr #36 reopen
- Slim Fly deploy preserves live 0079 migration identity (tip tree ledger ends 0054)
- Ignore Vercel/GHA budget noise
- LinkedIn account connect is official Recruiter System Connect via server env, or the existing off-by-default vendor token channel. No browser LinkedIn login, no scraping, no Voyager, no cookies, no rate-limit bypass.
- RSC credentials are server env only. The client catalog card stays not-connected. The panel is the state.
- Do not push onto PR #287 or PR #201.

## Watch out

- Manifest freezes are now application 153 / all 206 / parity 207. The parity hash is unchanged because `linkedin-rsc-connect` is excluded from the pre-expansion baseline.
- `npm test` needs `flyctl` on `PATH` and `FLY_API_TOKEN=local-validate-only` or `infra/agent-frameworks/fly/deployment.test.mjs` fails with ENOENT / no access token.
- `store-sourcing-actions` falseEuMatch expects Americas dampen ≤40
- Playwright dismisses the first-run tour (Skip) before clicking Source candidates. The script kills stray `next dev` processes.
- E2E screenshots from shift 436: `/opt/cursor/artifacts/screenshots/e2e-workflow-*.png`
