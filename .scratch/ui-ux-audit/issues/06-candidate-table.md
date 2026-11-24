# 06 — Table Candidats compacte + mobile

Status: resolved
Blocked by: 01
Spec: ../spec.md

## Critères d'acceptation

§6. Au moins 10 lignes visibles en 1440×900. Source sur une seule pastille. Filtres repliables et cartes sous 640 px.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02)

- Filters are one toolbar row (search, sort, stage, source, "Source next batch"); controls carry their own labels.
- Rows are about 52 px: 10 full rows at 1440×900 (table body starts at y≈364), no horizontal clipping.
- One source pill per row plus a talent-pool icon; Synthetic/Manual badges and stars are gone, the /100 score stays.
- Compliance flags sit next to the name instead of a mostly empty column; mobile cards show them as labelled badges.
- Under 640 px: one card per candidate, sort and filters fold behind a "Filters" button. No overflow at 390 px.
- Search icons on Candidates, Campaigns and Mailboxes were hidden behind the input background; they now sit on top.
