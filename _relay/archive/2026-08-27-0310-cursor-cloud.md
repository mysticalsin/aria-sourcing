---
project: MSourcing / ARIA
shift: 109
agent: cursor-cloud
updated: 2026-08-27 UTC
status: llm-wiki-v1-landed-awaiting-fly-confirm
---

# Handoff — Shift 109

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#30**
- **Local gate:** `tsc` + `npm test` green after wiki land (`d65a61c`); audit matrix **25/25**
- **CI Actions:** deferred per owner (billing) — do not block on empty runners
- **Fly live:** still migration **0060**; source through **0064**; deploy needs `ARIA_PROD_DEPLOY_CONFIRM`
- **LLM wiki v1:** `docs/agent-wiki/` + `src/lib/agent-wiki/` + `tests/agent-wiki.mts` (registered)

## Done this shift

- Filesystem LLM wiki / second brain under `docs/agent-wiki/` (agent, sourcing, identity, feedback, safety, schemas, lessons, ops)
- Runtime: identity fingerprints (never name-only), note IO, compaction, feedback→proposed lessons
- Sourcing feedback route stages proposed lessons to `var/agent-wiki/proposed/` (best-effort; `ARIA_AGENT_WIKI_AUTO_PROPOSE=0` disables)
- Audit matrix **25/25** includes wiki requirement; test manifest freezes updated

## Blockers (owner — not Actions)

1. `ARIA_PROD_DEPLOY_CONFIRM` for Fly-only `fly-deploy-now.sh`
2. M365/webhook secrets on Fly if not set
3. Deployed E2E with admin creds

## Next steps

1. Keep local gate green; ignore Actions billing
2. Owner provides deploy confirm → Fly push through 0064 only
3. Promote staged wiki lessons from `var/agent-wiki/proposed/` into `docs/agent-wiki/lessons/` when reviewed
4. Prove Graph webhook + E2E on aria-mantu-app.fly.dev when Fly is live

## Decisions made (don't relitigate)

- Skip waiting on GitHub Actions billing; continue product/Fly path
- Fly-only enterprise production
- LinkedIn send assisted-manual (409)
- Tracked wiki is aggregate/PII-free; candidate identity never name-only; feedback proposes, humans promote

## Watch out

- Do not write candidate PII into `docs/agent-wiki/`
- Do not auto-canonical proposed lessons
- Do not deploy to Vercel for enterprise
