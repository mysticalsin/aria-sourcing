# 05 — Orchestrateur de missions et agents

Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md §5

## Questions à trancher
- Réutiliser les tables héritées `agent_runs` / `agent_specs` ou en créer de nouvelles ?
- Où s'exécute une mission longue dans le processus Next (route + file d'attente en base, sans worker externe, cf. ADR 0001) ?
- Comment l'UI suit la progression (polling ou flux) ?

## Critères d'acceptation (provisoires)
- Une mission a un budget, un délai, une limite de concurrence, une annulation et un journal d'audit.
- Chaque agent renvoie une sortie validée par un schéma. En cas d'échec, l'étape bascule sur son repli déterministe.

## Comments

2026-10-30 (claude-code) : première tranche livrée. Moteur `src/lib/agents/mission.ts`, mission « Run Aria » `src/lib/agents/campaign-mission.ts`, branchés sur le panneau de campagne. Exécution côté client au-dessus des actions du store (aucune réécriture des routes serveur). Les tables héritées ne sont pas utilisées. Reste à faire : une mission « réponses entrantes », la persistance du journal de mission si nécessaire, l'exécution côté serveur si les missions doivent survivre à la fermeture de l'onglet.
