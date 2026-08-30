---
id: source-catalog
kind: sourcing
status: canonical
updated: 2026-08-27
supersedes: []
evidence:
  - src/lib/sourcing/orchestrator.ts
  - src/lib/sourcing/providers/
---

# Source catalog

| Provider | Module | Credentials | Notes |
| --- | --- | --- | --- |
| GitHub | `providers/github*` | `GITHUB_TOKEN` | Reviewed query policy |
| LinkedIn profiles | `providers/linkedin-profiles.ts` | Workspace Apify key | Not env-only on cron |
| Web / Tavily | tavily helpers | Workspace Tavily or `TAVILY_API_KEY` | Site-scoped research |
| Manual | UI entry | Operator | Requires lawful basis |

Autonomous cron (`/api/cron/run-sourcing-batch`) must resolve **workspace** Apify
and Tavily keys — not only process env — so tenant keys participate.
