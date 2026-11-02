# 09 — Système visuel

Status: resolved
Blocked by: 03
Spec: ../spec.md

## Critères d'acceptation

§9. Police auto-hébergée identique sur toutes les machines. Couleur pleine réservée à l'action principale. Un seul indicateur de mode démo/dry-run. Eyebrows retirés quand ils répètent le titre.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02)

- Font: Carlito (SIL OFL 1.1, metric twin of Calibri) is served from `public/fonts/carlito/` (latin + latin-ext, 400/700/400 italic, from `@fontsource/carlito@5.3.0`) and leads the `--font-sans` stack. The browser loads it on every route, login included; `.woff2` is excluded from the auth proxy so the login page can fetch it.
- One mode indicator: the top-bar chip ("Synthetic demo · dry-run", "Demo" on phones, "Live" with a real workspace), with details in its tooltip. Removed: the sidebar "Dry-run mode enabled" box, the "Dry-run · nothing sent" header badge, the Exec "Demo data - synthetic" banner. The demo player is now a secondary "Play demo" button.
- Less violet: the active nav entry is a tint, not a gradient; Exec keeps one solid action (Download PDF).
- Eyebrows name the nav group (Recruit, Engage, Reports, System) instead of repeating the title; Calendar, Skills and Settings titles match the nav.
