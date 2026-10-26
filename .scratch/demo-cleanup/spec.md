# Spec: trim ARIA to the recruiting-journey demo

Status: done (follow-ups in issues/)
Branch: `mbe-branch`
Owner decision date: 2026-10-26

## Goal

Turn the POC into a working, demo-able product that runs locally with
`docker compose up`. Remove every surface that is not on the recruiting
journey. A later phase targets internal Azure Cloud with Terraform; nothing
here should build towards Fly.io or Vercel.

## Target journey (keep)

```
Intake → Launch → Campaigns → sourcing agent → Candidates / Vivier
  → Outreach (human approval) → Replies → Calendar
  → Funnel / Exec / Reports / Winlog / Trust & ROI (decision-maker reporting)
Public: Careers → Applicants
```

Pages kept: `/` (Command Center), `/intake`, `/launch`, `/campaigns`,
`/candidates`, `/vivier`, `/applicants`, `/careers`, `/outreach`, `/replies`,
`/calendar`, `/funnel`, `/exec`, `/reports`, `/winlog`, `/trust`, `/sessions`,
`/skills`, `/fleet` (labelled Mailboxes: sender mailboxes + suppression), `/settings`,
`/login`, `/unsubscribe`.

Decision-maker reporting (candidates sourced, ROI, funnel conversion) is a
first-class requirement: `/exec`, `/trust` (ROI) and `/reports` stay and will
be consolidated later.

## Kept integrations

- **Sourcing:** GitHub, Tavily web search (LinkedIn / Stack Overflow /
  Dribbble / Behance via `site:`), Apify LinkedIn profile search.
- **Sourcing agent:** the in-process "cloud" mode of `/api/sourcing-agent`
  (server-side Claude/OpenAI tool loop over the real search tools) plus its
  deterministic fallback. No external agent framework.
- **Channels:** email via Gmail / Outlook OAuth.
- **Other:** Dust and MCP.

## Remove

| Area | What goes |
|---|---|
| Deploy targets | Fly.io (`fly.*.toml`, `deploy-fly*.sh`, `Dockerfile.prod`, `docker/**/*.fly*`, `infra/agent-frameworks/fly`, `prod-*` scripts, backup / restore-drill / volume-recovery tooling), Vercel (`vercel.json`, `DEPLOY_VERCEL_DEMO.md`) |
| Ops dossier | `production-readiness/` |
| Heavy assets | `docs/screenshots/`, `public/office3d/`, `docs/superpowers/` |
| Stale docs | engagement / lessons / roadmap docs, `CLAUDE_RELAY_BATON.md` |
| Pages | `/floor`, `/chat`, `/replay`, `/studio`, `/architecture`, `/memory`, `/curator`, `/soul` and their components (done; `/sessions` and `/skills` restored on owner request) |
| Agent frameworks | DeerFlow / Flowise (`infra/agent-frameworks`, framework run / capability / ack path), Hermes private-runtime proxy, swarm, autonomous loop worker, Graphify lessons worker, Obscura browser, voice / TTS |
| Sources | Apollo, Seamless, Sillage |
| Channels | WhatsApp (Meta), Databricks intake |

## Out of scope for this spec

- Database migrations stay as they are (ordered and hash-checked by the
  bootstrap). Dropping tables that no longer have code is a later, separate
  decision.
- Azure / Terraform.

## Done when

- `npm run typecheck && npm run typecheck:tests && npm test` is green.
- `docker compose up --build` starts the stack and the journey can be clicked
  through in demo mode.
- README and `docs/ARCHITECTURE.md` describe only what remains.
