# 05 — Approbation permanente et file LinkedIn par l'agent (B2)

Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md

## Décision
ADR 0002, point 3.

## À faire
- Par campagne, le propriétaire signe une approbation permanente : seuil de score, 3 au plus par jour, type (invitation avec note ou message), interrupteur.
- La route `POST /api/agent/linkedin/queue` insère dans l'outbox du compte LinkedIn du propriétaire. Les quotas et le rythme du pont restent inchangés.
- Revoir le test `tests/linkedin-bridge.mts:549-567`. Seuls peuvent mettre en file :
  - les composants LinkedIn ;
  - la route agent, avec une délégation `queue_linkedin` valide et une approbation active.
- Réconciliation : l'outreach passe à « envoyé » quand l'extension confirme. Un envoi `unknown` reste visible et n'est pas annoncé.

## Critères d'acceptation
- Couper l'approbation bloque toute nouvelle mise en file.
- Les éléments déjà en file restent annulables.
- Pas d'envoi si le propriétaire n'a pas de compte LinkedIn appairé : on le notifie dans l'app.

## Comments
