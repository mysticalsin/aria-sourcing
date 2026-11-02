# 02 — Journal d'usage et budgets

Status: resolved
Blocked by: 01
Spec: ../spec.md

## Critères d'acceptation
- Chaque appel Anthropic enregistre : workspace, tâche, modèle, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, coût estimé. Jamais le prompt ni la réponse.
- Plafond journalier par workspace. Au-delà, l'app bascule sur les replis déterministes et affiche pourquoi.
- Un interrupteur admin coupe l'IA.
- Un panneau Réglages montre la consommation du jour et du mois.

## Comments

2026-11-02 (claude-code) : fait, avec un écart assumé. Les compteurs sont persistés dans un fichier JSON et non en base : le plafond porte sur la clé Anthropic, globale au serveur, et le déploiement prévu a un seul conteneur app (ADR 0001). Pas d'interrupteur admin dédié : mettre `AI_MONTHLY_BUDGET_USD=0` coupe l'IA.
