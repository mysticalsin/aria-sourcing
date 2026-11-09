# 03 — Routes /api/agent/*

Status: ready-for-agent
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
