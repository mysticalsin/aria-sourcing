# 07 — Escalade vers Opus et gestion des refus

Status: needs-triage
Blocked by: 05
Spec: ../spec.md

## Idée
- Si un agent Sonnet ne produit pas de sortie valide après un essai, ou signale une faible confiance, une seule relance sur Opus 5.5.
- Traiter `stop_reason: refusal` et `max_tokens` explicitement. Aujourd'hui une réponse tronquée est acceptée telle quelle.

## Comments
