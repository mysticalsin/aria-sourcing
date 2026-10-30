# 05 — Orchestrateur de missions et agents

Status: needs-triage
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
