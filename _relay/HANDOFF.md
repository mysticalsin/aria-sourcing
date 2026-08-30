---
project: MSourcing / ARIA
shift: 429
agent: cursor-cloud
updated: 2026-08-30T05:35Z
status: cloudflare-live-parse-approved
---

# Handoff — Shift 429

## Current state

- **main = integration = Fly tip:** `dd865aef4e81b599ae14fcf7adcbefcc19414ce5`
- **PR #44 MERGED** — Cloudflare Workers AI + free gateway for live JD parse
- **Fly secrets:** `CLOUDFLARE_WORKERS_AI_URL`, `CLOUDFLARE_WORKERS_AI_SECRET`, `CLOUDFLARE_ACCOUNT_ID` set
- **Worker:** `https://aria-intake-llm.tony-walteur.workers.dev` (AI binding)
- **Live QA:** `/intake` Calypso brief parses — no "Live parse required"
- **Note:** Fly `KIMI_API_KEY` remains 401-dead; gateway is the live path
- Cloudflare panel is under Settings → AI (section “Cloudflare Workers AI”) — scroll past provider list

## Done this shift

1. Root-caused live parse fail: Kimi env 401 on Fly
2. Deployed free Cloudflare Workers AI Worker + Fly gateway secrets
3. Landed Settings Cloudflare connect + intake/chat failover
4. Physical E2E intake parse PASS

## Blockers (owner)

1. Graph/HeyReach dropzones empty → HOLD sent>0

## Decisions made (don't relitigate)

- Prefer Cloudflare free Workers AI gateway when Kimi env is dead

## Watch out

- Do not commit Workers AI shared secret to git
