# 01 — Mode tutoriel pas à pas

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

- Ouvert uniquement depuis le menu (sidebar, menu mobile, recherche), jamais automatiquement.
- Chaque partie de l'app a une étape qui explique et propose un exercice ; les exercices vérifiables sont détectés.
- Anglais, utilisable à 1440×900 et 390×844 sans débordement.

## Vérification (2026-11-02)

- Parcours complet automatisé (Playwright) à 1440 et 390 : 22 étapes, anneau présent sur chaque étape ciblée, bonne page à chaque étape (y compris les sections de Settings), pas d'ouverture automatique, panneau fermé après « Finish », `scrollWidth` = largeur.
- Exercices « Record contact basis » et « Approve » réalisés : les deux passent à « Done ».
- `tests/tutorial-curriculum.mts` : 38 tests. `tests/candidate-qualification.mts` : base seule acceptée sur profil synthétique, nouveaux faits refusés, candidat exclu refusé.
