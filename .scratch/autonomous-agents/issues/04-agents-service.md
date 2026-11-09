# 04 — Service agents dans le compose

Status: resolved
Blocked by: 03
Spec: ../spec.md

## À faire
- Service `agents` : même image, entrypoint runner, `restart: unless-stopped`, logs bornés, healthcheck.
- Secrets : `ANTHROPIC_API_KEY` et le jeton d'agent.
- Planificateur : toutes les 5 minutes, il prend les missions dues et pose un verrou par mission.
- Il réutilise `src/lib/agents/mission.ts`.
- Une table `agent_missions` : étapes, durée, tokens, coût, erreur. Jamais le contenu des candidats.
- Des plafonds IA propres aux agents (`AGENT_AI_DAILY_BUDGET_USD`, `AGENT_AI_MONTHLY_BUDGET_USD`).
- Suivre l'issue 08 de ai-agents (`@anthropic-ai/sdk`).

## Critères d'acceptation
- Un redémarrage de l'app ou des agents ne relance pas une mission terminée et ne double aucun envoi.
- Les missions sont visibles dans l'app.

## Comments

2026-11-09 (claude-code): `agents` service in `docker-compose.yml` (image `aria-sourcing-app:local`, `scripts/agents-runner.mjs`), plus migration 0009 (`agent_missions` among others). Separate AI caps are NOT done: the agents share `AI_*_BUDGET_USD` (ADR 0002, point 5).
