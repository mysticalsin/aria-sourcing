# 03 — Tâche extraction sur Haiku pour l'analyse de brief

Status: resolved
Blocked by: 01
Spec: ../spec.md

## Contexte
`parseIntakeLive` (src/lib/ai/intake.ts) passe aujourd'hui par la tâche `chat`, donc par Sonnet. Extraire des champs d'un email est un travail pour Haiku.

## Critères d'acceptation
- Nouvelle `ModelTask` `extraction`, avec Haiku 5.5 par défaut et un effort low.
- Sortie structurée (`output_config.format`, schéma JSON) à la place du parse JSON tolérant. Le repli heuristique reste en place.
- Tests : routage, schéma, repli.

## Comments

2026-11-02 (claude-code) : fait. Tâche `extract` (`ModelTask` `extraction`), Haiku 5.5 en effort low, schéma `src/lib/ai/intake-schema.ts` envoyé en `output_config.format`. Validation et ancrage conservés. Migration v19, schéma serveur du sourcing et panneau Modèles mis à jour.
