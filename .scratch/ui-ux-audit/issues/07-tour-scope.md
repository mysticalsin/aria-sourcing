# 07 — Tour d'accueil limité à l'accueil

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§7. Le modal ne s'ouvre que sur `/` à la première visite ; jamais sur un lien direct vers une autre page.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02, commit 6f7e0b51)

- `Onboarding` opens only when `pathname === "/"` and the browser has not seen it; a direct link to any other page never shows the modal.
