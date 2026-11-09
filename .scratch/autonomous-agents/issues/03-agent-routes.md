# 03 — Routes /api/agent/*

Status: resolved
Blocked by: 01, 02
Spec: ../spec.md

## Routes
- `GET campaigns/due` : les campagnes actives du délégant, avec la date du dernier run.
- `POST source` : `start`/`advance`, la même logique que `/api/source/campaign`, sans cookie.
- `GET campaigns/:id/top` : les N meilleurs éligibles. Éligible veut dire tous ces critères :
  - pas encore contacté ;
  - pas supprimé, désinscrit ni « ne pas contacter » ;
  - pas effacé ;
  - URL LinkedIn connue ;
  - au-dessus du seuil.
- `POST draft` : le module de l'issue 01.
- `POST linkedin/queue` : voir l'issue 05.
- `POST notify` : voir l'issue 08.

## Critères d'acceptation
- Pas de clé de service côté conteneur.
- Une révélation en mode confidentialité est journalisée avec l'acteur agent.

## Comments

2026-11-09 (claude-code): one route for the runner, `POST /api/agent/tick`, which runs one bounded step of `src/lib/agents/tick.ts`, instead of one route per action. All logic stays typed and testable in the app. User route: `GET/POST /api/agent/autopilot`.
