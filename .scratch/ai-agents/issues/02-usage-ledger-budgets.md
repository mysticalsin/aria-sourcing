# 02 — Journal d'usage et budgets

Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md

## Critères d'acceptation
- Chaque appel Anthropic enregistre : workspace, tâche, modèle, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, coût estimé. Jamais le prompt ni la réponse.
- Plafond journalier par workspace. Au-delà, l'app bascule sur les replis déterministes et affiche pourquoi.
- Un interrupteur admin coupe l'IA.
- Un panneau Réglages montre la consommation du jour et du mois.

## Comments
