---
project: MSourcing / ARIA
shift: 3
agent: cursor
updated: 2026-11-24 14:20 -03
status: in-progress
---

# Handoff — live Odoo hire path on vercel-demo

## Current state
- Branch `cursor/odoo-live-hire-path-9db8`, based on `vercel-demo` at `f2d0d3d07bdb8eb2bcb1e0d0bbd85e1cf99f9e7e`.
- Previous tip `754399f584e1943fd658c380daad03df101aad22` is still the hire feature. GitHub job `Typecheck / Lint / Test / Build` failed only at `npm audit --audit-level=high` after typecheck, lint, test, Obscura, and build succeeded.
  - https://github.com/mysticalsin/aria-sourcing/actions/runs/45408975864/job/138497299679
  - https://github.com/mysticalsin/aria-sourcing/actions/runs/45408933103/job/138497144231
- That audit was 13 high + 2 critical, inherited from the `vercel-demo` lock. `next@16.2.9` was inside `9.3.4-canary.0 - 16.4.4`. `zod@3.25.76` is `<4.6.6` (GHSA-mrhx-c7xc-m3w5) and has no 3.x fix.
- Audit fix commit `2c3b87fcb9543dcdd4325e068d83a3319fb55e46` resolves `next@16.4.6`, `zod@4.6.7` (override `"zod": "$zod"`), `@dust-tt/client@1.2.11`, `postcss@8.5.23`, `sharp@0.35.5`. Declared floors: `next@^16.4.6`, `zod@^4.6.7`, `@dust-tt/client@^1.2.11`, `postcss@^8.5.23`, `ip-address@^10.7.6`. The branch tip is the handoff note on top of that commit.
- Local `npm audit --audit-level=high` exits 0 (`found 0 vulnerabilities`), including `npm ci` with npm 10.8.2 and npm 10.9.9. `npx tsc --noEmit`, `npm test`, `npm run lint`, and `npm run build` (Next.js 16.4.6, 58 pages) exited 0. Hire suites stayed `tests/hire-connector.mts` 62 passed, `tests/hire-pipeline.mts` 46 passed.
- `/demo/hire` was not re-rendered this shift. Hire connector behavior was not edited. No `ODOO_*` values were set and no live Odoo host was called.
- Draft PR https://github.com/mysticalsin/aria-sourcing/pull/319 only. Not merged. Not deployed. PRs 313, 317, and 318 were not updated.
- CI on `eb685e91` is green for both `Typecheck / Lint / Test / Build` jobs.
- With the four Odoo variables set to the existing fixture placeholders, `hireEnvForRoute` plus `runSourcingThroughHired` and `POST /api/hire` both complete sourcing through hired on the in-repo fake. The route proof stubs `fetch` and uses the RFC 5737 documentation address `203.0.113.50`, so no DNS lookup and no socket run. The fixture values are removed before the test exits.
- Search (`/candidates`), shortlist (`/vivier`), the candidate drawer, and the command center (`/`) call `hireFromSourcingScreen`. With no live connector they run fixture SMART, the generic HTTPS API, and MCP on in-process stubs and keep unset skipped. A complete runtime connector uses the live public HTTPS path. `POST /api/hire` is unchanged.
- `tests/sourcing-screen-hire.mts` no longer contains the `linkedin.com` substring. It proves fixture hosts, the stubbed `203.0.113.50` live path, and that a private URL is refused before fetch.

## Done this shift
- Moved the lock and the direct floors so the blocking audit can pass without a hire behavior change.
- `@dust-tt/client` 1.2.6 bundled `@modelcontextprotocol/sdk@1.26.0`, which `npm audit fix` cannot rewrite. 1.2.11 is the published client whose SDK range is `^1.32.1`.

## Blockers
- A real Odoo call is blocked because `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, and `ODOO_API_KEY` are absent from the process environment and from `.env`, `.env.local`, `.env.production`, and `.env.development`. No host was guessed and none was called.
- `ODOO_HIRED_STAGE_ID` is also absent. With the four variables set, job create, applicant create, and the vacancy close run. The hired-stage write stays skipped until that id is a positive integer.
- The live transport still refuses non-https, loopback, private, and metadata hosts.
- `@dust-tt/client@1.2.11` declares `engines.node >=24.16.0`. CI uses Node 20. `npm ci` warns `EBADENGINE` and continues. `tests/dust.mts` passed under Node v20.20.2 (28 passed).

## Next steps
1. Leave the pull request a draft. Do not merge it and do not deploy it.
2. A real Odoo call waits on the four runtime variables. Do not invent them.
3. CI on `eb685e91` is green. A later proof commit needs its own check run.

## Decisions made (don't relitigate)
- Synthetic `/demo/hire` never sends runtime credentials. It uses the in-repo fake.
- Live hire runs only when the connector env is complete. Private, loopback, and metadata hosts are refused.
- Vacancy close never sends `hr.job.state`.
- No secrets in git or in `_relay/`.
- The audit gate stays blocking. Zod is 4.6.7 for the whole tree because `@dust-tt/client@1.2.11` still declares `zod@^3.23.8` and the advisory starts at 4.6.6.
- Do not `npm audit fix --force`.

## Watch out
- `POST /api/hire` will call the configured public HTTPS Odoo when all four variables are set, including when Supabase is off.
- The existing MCP probe in `src/lib/mcp-client.ts` still uses its own fetch. The hire path uses `fetchPublicUrl`.
- `@dust-tt/client@1.2.11` prints an engine warning on Node 20 and Node 22. The Dust tests passed on both.
