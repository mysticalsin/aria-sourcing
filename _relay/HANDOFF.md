---
project: MSourcing / ARIA
shift: 429
agent: cursor-cloud
updated: 2026-08-30T05:45Z
status: cloudflare-workers-ai-jd-parse
---

# Handoff — Shift 429

## Current state

- Cloudflare Workers AI Settings connect (PR #37) + free Workers AI gateway for live JD parse
- Fly `KIMI_API_KEY` is **401-dead**; intake uses `CLOUDFLARE_WORKERS_AI_URL` Worker with AI binding
- Worker: `https://aria-intake-llm.tony-walteur.workers.dev`

## Decisions made (don't relitigate)

- Prefer Cloudflare free Workers AI for live intake when Kimi env is dead
