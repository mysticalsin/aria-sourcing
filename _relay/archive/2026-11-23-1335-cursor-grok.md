---
project: MSourcing / ARIA
shift: 438
agent: cursor-grok
updated: 2026-11-23T13:24Z
status: local-main-hire-route
---

# Handoff — Shift 438

## Current state

- Audit `0fd61f6c78424cc9eca867d10d8b60e321364f46`. Hire route `66cbfac6432c3023a85a8f2d2fff374251b41840`. Next 16 agent-rules block `91386259`. This handoff sits on top of those.
- `origin/main` is still `b5480986`. Do not push. Do not open a PR. GitHub rejected `main` (`GH006`, protected branch).
- `npx tsc --noEmit && npm test` green with `flyctl` on `PATH` and `FLY_API_TOKEN=local-validate-only`.
- Manifest freeze: pretest 51, application 156, posttest 2, all 209, parity 211.
- `npm audit`: 1 high remains (`zod` 3.25.76). Fix is `zod@4.6.7`, a major. Left on 3.x. Critical, the other highs, and the previous 10 moderates are cleared.
- Installed: `next` 16.4.6, `eslint-config-next` 16.4.6, `postcss` 8.5.33 (including the `next.postcss` override), `sharp` 0.35.5, `nanoid` 3.3.20, `browserslist` 4.29.6, `brace-expansion` 1.1.22, `source-map-js` 1.2.4.

## Done this shift

1. Dependency audit commit `0fd61f6c`.
2. Stress, no code change. In process: score 2,000 candidates 19.4 ms; brief-skill scan 2,000 texts 20 ms; map 500 LinkedIn leads 15.9 ms (454 kept, 46 below the quality bar); 100 metric recomputes of 2,000 candidates 34.7 ms. Warmed pages: `/candidates` 343–361 ms, design campaign 275–332 ms, `/outreach` 70–101 ms, `/campaigns` 200 ms, floor heading 189–194 ms, 3D canvas 402 ms after the toggle. Source next batch 472–540 ms (6 accepted, 2 skipped). Hired click to toast 487–501 ms.
3. `runSourcingThroughHired` in `src/lib/mcp-client.ts`. HTTP `POST /api/hire`. Odoo runs hr.job create, hr.applicant create, stage write, hire write (authenticate then execute_kw each step). SMART posts the same four steps with a bearer token. Neither configured: `{ ok: true, erp: "skipped", linkedIn: true }` and no fetch. `tests/hire-pipeline.mts` 15 passed.

## Blockers

- Push of `main` is still blocked. Tony has not allowed a PR.
- Live Odoo needs `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`. Live SMART needs `SMART_URL` and `SMART_TOKEN`. Live Recruiter needs `LINKEDIN_RSC_URL` (HTTPS API, not a linkedin.com page) and `LINKEDIN_RSC_TOKEN`.
- Zod high stays until a Zod 4 migration is explicitly accepted.

## Next steps

1. Stay on local `main`. Do not create a branch and do not push until a PR is allowed.
2. Do not run `npm audit fix --force`. That installs Zod 4.

## Decisions made (don't relitigate)

- Zod stays on 3.x
- LinkedIn policy stays assisted-manual or official Recruiter System Connect
- Do not copy cookie scraping, login evasion, Voyager, or the LinkedIn browser bridge
- `linkedInSourcingRunsWithoutErp` returns true. ERP sync is gated separately
- Odoo is preferred when both Odoo and SMART are configured
- #49 closed permanently; #51 was the Europe successor
- Slim Fly deploy preserves live 0079 migration identity

## Watch out

- `tests/public-fetch.mts` forbids a `fetch(` call in `src/lib/mcp-client.ts`. The hire runner takes an injected fetch and does not call `fetch(`
- `POST /api/hire` uses the same demo, origin, rate-limit, and `source` permission gates as `POST /api/source`
- A partial Odoo env does not call fetch; LinkedIn sourcing still completes
- Manifest contract hashes must be recomputed when a test is added
- `FLY_API_TOKEN=local-validate-only` is only for local `flyctl config validate`. Do not commit it
