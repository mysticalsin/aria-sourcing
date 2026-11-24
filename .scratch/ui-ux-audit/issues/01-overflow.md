# 01 — Débordements desktop/mobile

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§1. Aucune des 21 routes ne dépasse la largeur du viewport à 1440 et 390 px (contrôle scripté scrollWidth <= innerWidth). Kanban et tables larges défilent dans leur propre conteneur, avec un indice visuel.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

2026-10-29 (Claude Code): fixed. Three causes.
1. `sr-only` (position:absolute) inside an unpositioned scroll container escaped
   the clipping: home integration strip (3708 px), `Table`, funnel kanban.
   Containers made `relative`.
2. Grids with only `sm:`/`md:`/`lg:grid-cols-*` used an implicit `auto` track
   that grows to its content on mobile (settings 1023 px, fleet, outreach,
   skills). Added a `grid-cols-1` base to 81 grids.
3. Funnel kanban hid its scrollbar; now visible.
Verification: 42 captures (21 routes × 1440/390), scrollWidth <= viewport
everywhere; typecheck, typecheck:tests and npm test green (240 pass).
