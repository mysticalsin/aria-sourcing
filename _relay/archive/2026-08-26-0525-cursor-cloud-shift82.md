---
project: MSourcing / ARIA
shift: 82
agent: cursor-cloud
updated: 2026-08-26 UTC
status: sourcing-quality-floor-80-await-fly-deploy
---

# Handoff - Shift 82

## Current state

- **Branch:** `cursor/enterprise-autopilot-b91d` · PR **#28**
- **Production:** https://aria-mantu-app.fly.dev — still needs Fly deploy (no token in agent env)
- User: sourced candidates scoring ~26% — demand **80%+ only**, deep search for best fit

## Done this shift

- **SOURCING_QUALITY_FLOOR = 80** — live mapper + agent + tool runner reject below-floor leads
- **minScoreToContact default 80**; hydrate clamps existing workspaces to ≥80; Settings UI min 80
- **Deep LinkedIn:** `buildLinkedInQueryVariants` (up to 4 queries); agent pulls more SERP hits per query
- **Scoring:** stronger title+skill boosts; acronym skill match (MTTF); industry inferred from SERP text
- Tests updated: candidate-fit, scoring-metrics, rules-confidential, agent-graph

## Blockers

- Fly deploy blocked (no `FLY_API_TOKEN`)
- Pre-existing `infra-release-contract` fail

## Next steps

1. Deploy Fly with latest SHA via `scripts/fly-deploy-now.sh`
2. Re-source System Designer — expect only ≥80 fits (may be fewer / empty if SERP has no title-aligned profiles)
3. If empty batch: broaden skills in brief or retry Source next batch (deep variants still run)

## Decisions made (don't relitigate)

- Quality floor is hard at accept-time (80), not only at Approve
- Fit endorsement remains for edge cases but new sourced batch should already clear 80
- No LangChain rewrite

## Watch out

- Stricter bar can return **zero** candidates — that is intentional vs shipping 26% noise
- Existing low-score candidates already in a campaign are not auto-deleted; re-source for new quality
