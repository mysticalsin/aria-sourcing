# 08 — Vocabulaire et échelle de notation

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§8. Une seule échelle de notation. Plus de jargon interne à l'écran. Les titres nomment la page. La numérotation ne sert qu'aux vraies séquences.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02)

- One rating scale: the /100 match score. `StarBadge` is replaced by `ScoreBadge` (bands 80+, 60–79, under 60) on the pipeline, talent pool, applicants, home summary and candidate drawer. The drawer's Top Gun/A–D picker is gone; the prequal SLA still derives from the score.
- Jargon removed from screens: Path A/B → "Job application"/"Open application"; TAnIA, Pre-Stage I, TOFU/MOFU → plain stage hints ("To prequalify", "Interviewing"…); "#Vivier", "Silver medalist", "The gold we didn't lose" → "Talent pool", "Runners-up", "Finalists not hired". Applicant rows no longer repeat the role when the campaign has the same title.
- Titles name the page and match the nav: Mailboxes, Pipeline, Outreach, Replies, Overview, Learning loop, Wins, Trust & ROI, History, Applicants. Eyebrows give the nav group (Recruit, Engage, Reports, System).
- Numbering only for real sequences: "01:"/"02:" eyebrows and the Settings/Mailboxes section numerals are gone.
- A scan of 12 routes at 1440 and 390 px finds no remaining term from the list, and no horizontal overflow. Applicant rows wrap correctly at 390 px.
