# 04 — Navigation et entrée de création unique

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§4. Navigation regroupée qui tient sans scroll à 900 px de haut. Une seule action « Nouvelle campagne » couvrant un ou plusieurs rôles. Les anciennes routes redirigent.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02)

- Nav grouped as in §4: Home; Recruit (Campaigns, Candidates, Pipeline); Engage (Outreach, Replies, Calendar); Analyze (Reports); System (Mailboxes, Skills, History, Settings). 12 entries instead of 19; the sidebar fits 1440×900 without scrolling (logo block is now a 2-line horizontal lockup).
- One "New campaign" button (sidebar, mobile drawer, command search) opens `/campaigns/new` with a "One role / Several roles" switch. `/intake` and `/launch` redirect there (next.config.mjs, query kept). Intake and Launch bodies moved to `src/components/campaigns/`.
- Candidates, Applicants and Talent pool are tabs of one entry; Exec, Learning loop, Wins and Trust & ROI are tabs of Reports. The shell draws the tabs from the URL (`SectionTabs`), so each view keeps its route.
- Mobile bottom bar: Home, Campaigns, Candidates, Outreach, Replies. The drawer no longer hides its last entries behind the bottom bar.
- "New intake" buttons renamed "New campaign".
