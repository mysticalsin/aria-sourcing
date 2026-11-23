---
project: MSourcing / ARIA
shift: 437
agent: cursor-grok
updated: 2026-11-23T13:05Z
status: local-main-linkedin-sourcing
---

# Handoff — Shift 437

## Current state

- Local `main` tip: `fc1945ef9d934f7dcd7a22cf006031d09bd8cbda`
- Parent commit: `d9d884c9e0e9948155ebc937e706b0ec0ab3dd69` (hire connector; LinkedIn sourcing does not depend on Odoo or SMART)
- `origin/main` is still `b5480986`. Push of `main` was rejected (`GH006`, protected branch, pull request required). Do not push. Do not open a PR.
- `npx tsc --noEmit && npm test` green on this tip with `flyctl` on `PATH` and `FLY_API_TOKEN=local-validate-only`
- Manifest freeze: pretest 51, application 155, posttest 2, all 208, parity 210
- LinkedIn public search and official Recruiter System Connect both source. Cookie scraping, Voyager, and the `origin/mbe-branch` browser bridge were not copied.

## Done this shift

1. Hire connector and `tests/hire-connector.mts` on local main (`d9d884c9`)
2. Public LinkedIn location and brief-skill parsing from `origin/mbe-branch` commit `22c081df`, plus a quality bar
3. Official Recruiter System Connect client (`LINKEDIN_RSC_URL` + `LINKEDIN_RSC_TOKEN`)
4. Candidate drawer panel for location, observed skills, and public vs Recruiter
5. Tests: `tests/skill-evidence.mts` (11), `tests/linkedin-recruiter.mts` (8), sourcing parser cases (61 total in that file)

## Blockers

- `git push origin main` fails: protected branch, PR plus required checks. Tony has not allowed a PR.
- Live Recruiter search needs `LINKEDIN_RSC_URL` (HTTPS API, not a `linkedin.com` page) and `LINKEDIN_RSC_TOKEN`. Without them, public results still return and `recruiter` is `not-configured`.
- Odoo (`ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`) and SMART (`SMART_URL`, `SMART_TOKEN`) are unset. LinkedIn sourcing still runs.
- No Odoo card in the integrations UI.

## Next steps

1. Stay on local `main`. Do not create a branch and do not push until a PR is allowed.
2. npm audit highs that are safe to bump are still open (next, postcss, sharp, and the other non-major highs). Leave `zod` on 3.x.
3. Hire connector is not yet exposed through `src/lib/mcp-client.ts` or an HTTP route.
4. Stress numbers for sourcing-to-hired were not captured.

## Decisions made (don't relitigate)

- LinkedIn policy stays assisted-manual or official Recruiter System Connect
- Do not copy cookie scraping, login evasion, Voyager, or the LinkedIn browser bridge from `origin/mbe-branch`
- Volume is the search count. Quality drops a LinkedIn profile only when it has no stated role and no brief skill observed in the text
- `linkedInSourcingRunsWithoutErp` returns true. ERP sync is gated separately
- #49 closed permanently; #51 was the Europe successor
- Slim Fly deploy preserves live 0079 migration identity

## Watch out

- `tests/public-fetch.mts` forbids a `fetch(` call in `src/lib/mcp-client.ts`. `fetchPublicUrl` stays
- `mapWebSearchCandidates` applies the quality bar to every LinkedIn web lead, including Recruiter leads
- A two-letter skill matches only when the original token is two capitals (`IT`, not `it`)
- Do not set `location` when the result does not state a place
- Manifest contract hashes must be recomputed when a test is added
- `FLY_API_TOKEN=local-validate-only` is only for local `flyctl config validate`. Do not commit it
