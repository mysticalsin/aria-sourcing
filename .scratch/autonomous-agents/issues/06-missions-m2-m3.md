# 06 — Missions sourcing nocturne et top 3 vers LinkedIn

Status: ready-for-human
Blocked by: 04, 05
Spec: ../spec.md

## M2
- Pour chaque campagne due : sourcing WebSearch puis GitHub, limites basses, jusqu'à l'état terminal.

## M3
- Prendre le top 3 éligible.
- Rédiger le message (issue 01).
- Mettre en file (issue 05).
- Notifier le propriétaire dans l'app.

## Critères d'acceptation
- Démo de bout en bout sur un compte de test, la nuit, sans intervention humaine.
- Le journal de mission donne le coût et les étapes.

## Comments

2026-11-09 (claude-code): implemented and verified on the local stack, in the e2e test workspace. GitHub sourcing added 3 profiles, the agent picked the top candidate (85) and failed cleanly without a LinkedIn account. With a simulated account it queued an invitation, and the extension's `sent` moved the candidate to Contacted. Remaining: the owner's live run with their own paired LinkedIn (a real send).
