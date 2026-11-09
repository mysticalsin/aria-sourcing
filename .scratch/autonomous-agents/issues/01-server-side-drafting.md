# 01 — Rédaction d'un message d'approche côté serveur

Status: ready-for-agent
Blocked by: —
Spec: ../spec.md

## Contexte
`generateOutreachLive` et `approveOutreach` vivent dans le store React (`src/lib/store.ts`, `"use client"`). Un agent sans navigateur ne peut ni rédiger ni approuver.

## À faire
- Extraire la construction du prompt, l'appel (tâche `outreach`) et la validation (`validateCandidateBoundText`, `detectInjection`, `candidateDraftBlocker`) dans un module serveur.
- Écrire le brouillon dans `workspace_state` avec le jeton de concurrence optimiste, sur le modèle de `src/lib/sourcing/unified-repository.ts`.
- Le store appelle ce module au lieu de dupliquer la logique.
- Format LinkedIn : une note d'invitation de 300 caractères au plus si le candidat n'est pas une connexion.

## Critères d'acceptation
- Deux rédactions concurrentes (navigateur et agent) ne s'écrasent pas : la plus ancienne est rejetée et rejouée.
- `draftedBy` et l'idempotence par candidat et campagne sont conservés.

## Comments
