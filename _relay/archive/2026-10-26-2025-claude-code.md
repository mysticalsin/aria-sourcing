---
project: MSourcing / ARIA
shift: 437
agent: claude-code
updated: 2026-10-26T15:11Z
status: demo-cleanup-done-local-docker-green
---

# Handoff — Shift 437

## Current state

- Branch `mbe-branch` (owner: Michael Bernard), 11 commits ahead of `b5480986` (including this handoff), **not pushed**.
- Direction set by the owner on 2026-10-26: turn the POC into a working **local Docker demo** of the
  recruiting journey; internal Azure + Terraform comes later. Repo documentation is written in English.
- Plan and follow-ups: `.scratch/demo-cleanup/spec.md` and `.scratch/demo-cleanup/issues/01..07`
  (local-markdown issue tracker, see `docs/agents/issue-tracker.md`).
- Gate green at tip: `npm run typecheck && npm run typecheck:tests && npm test && npm run lint`.
- `docker compose up --build` boots on a fresh volume: 53 migrations applied, admin
  `admin@hermes.local` / `admindemo123` seeded into workspace `00000000-0000-4000-8000-000000000001`.
  A logged-in headless-Chrome pass over all 20 kept pages showed no console errors; `/api/careers` → `{"ok":true}`.
- Host tooling: Node is only available via nvm (`$HOME/.nvm/versions/node/v24.14.1/bin`); package wants 22.x (warning only).

## Done this shift

1. Engineering skills configured (`docs/agents/`, `## Agent skills` in `AGENTS.md`).
2. Removed: Fly/Vercel deploy, `production-readiness/`, prod/recovery scripts; pages Floor, Chat, Replay,
   Studio, Architecture, Memory, Curator, Soul (Sessions and Skills restored on owner request; `/fleet` kept,
   labelled Mailboxes); DeerFlow/Flowise, Hermes runtime, swarm, autonomous loop, Graphify worker, Obscura,
   voice; Apollo, Seamless, Sillage; WhatsApp, SMS, Databricks. Docs rewritten.
3. Kept agent: in-process `/api/sourcing-agent` (`cloud` tool loop with Claude/OpenAI, or `deterministic`).
   Campaign "Run agent" now goes through `src/lib/sourcing/campaign-run.ts` → `sourceNextBatch`.
4. Docker fixes: `docker/bootstrap/migrate.sh` (migrations phase extracted from the deleted `run.fly.sh`),
   admin seeded from GoTrue JSON, `CAREERS_WORKSPACE_ID` set, Node 22 image.
5. Test-manifest parity freeze removed so the suite can shrink with the product.

## Blockers

- None for the local demo.

## Next steps

1. Owner review of the cleanup; push `mbe-branch` when approved (not done: no push authorization given).
2. After push, verify CI (`.scratch/demo-cleanup/issues/06-ci-after-cleanup.md`); DB suites `tests/*-db.sh` were not run locally.
3. Get owner input on decision-maker reporting KPIs (`issues/04`).
4. Implement the local / OpenAI-compatible LLM provider (`issues/01`).
5. Fix `ensure_workspace()` email lookup for non-seeded users (`issues/02`).

## Decisions made (don't relitigate)

- Target = local Docker demo now; Azure + Terraform later. No Fly/Vercel work.
- Repo docs in English.
- Kept pages: `/`, intake, launch, campaigns, candidates, vivier, applicants, careers, outreach, replies,
  calendar, funnel, exec, reports, winlog, trust, sessions, skills, fleet (Mailboxes), settings.
- Sources: GitHub, Tavily web search, Apify. Channels: Email (Gmail/Outlook) + assisted LinkedIn. Also Dust + MCP.
- Agents: one in-process sourcing agent; external agent frameworks were POC-only and are removed.
- Migrations are not rewritten; dead tables stay until `issues/03` is decided.

## Watch out

- The `postgres` DB role cannot read `auth.users`; use `-U supabase_admin` for auth tables.
- `/careers` returns 503 until the admin has signed in once (first sign-in creates `workspace_state`).
- `_relay/archive/` and `_agent_state/` were kept per AGENTS.md; owner decision pending (`issues/07`).
