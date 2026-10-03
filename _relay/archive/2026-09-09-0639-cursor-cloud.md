---
project: MSourcing / ARIA
shift: 115
agent: cursor-cloud
updated: 2026-09-08T22:35Z
status: linkedin-first-java-outreach-video-green
---

# Handoff — Shift 115

## Current state

- **Branch:** `cursor/llm-wiki-brain-java-sourcing-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/75
- **LinkedIn-first:** software/data role profiles primary platform = LinkedIn; wiki suggests LinkedIn boolean first
- **Video:** `/opt/cursor/artifacts/aria-linkedin-java-ready-to-outreach.mp4` (~43s)
- **Live LinkedIn leads (Tavily):** 5 profiles in `_relay/evidence/2026-09-08-linkedin-java-profiles.json`
- **Server note:** demo `next start` needs `TAVILY_API_KEY` for LinkedIn web search (DDG egress blocked here)

## Done this shift

1. LinkedIn-first platforms in `roles.ts` + STATE_VERSION 22 migration
2. Wiki playbook + `suggestedLinkedInQuery`; UI shows LinkedIn first / GitHub secondary
3. Source next batch prefers LinkedIn; auto-drafts LinkedIn outreach for new accepts
4. Recorded E2E video login → wiki → source → outreach-ready

## Blockers

1. None for demo video. Prod Fly needs `TAVILY_API_KEY` (already present) for LinkedIn SERP path; Apify token still optional for richer profiles.

## Next steps

1. Review PR #75 / merge
2. Optional: Apify LinkedIn profile connector for denser profile cards
3. Keep wiki recall ≠ contact lease

## Decisions made (don't relitigate)

- Brain = LLM wiki on disk, not Supabase
- Software sourcing is LinkedIn-first; GitHub secondary
- Wiki never grants contact claims

## Watch out

- Do not commit Tavily/Apify secrets
- Turbopack `next dev` hydration flaky — use `next start` for UI proofs
