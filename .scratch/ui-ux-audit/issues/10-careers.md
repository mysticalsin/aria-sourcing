# 10 — Page carrières en démo et hors ligne

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§10. Postes fictifs en démo. Message hors ligne écrit pour un candidat. En-tête et chat alignés.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

## Resolution (2026-11-02)

- Demo roles: with no Supabase and no `CAREERS_WORKSPACE_ID`, `/api/careers` uses an in-memory repository built from the seed (3 published roles). Applications go through the same validation (`submitPublicCareerApplication`) and are dropped; responses carry `demo: true` and the chat says "Demo site · example roles, nothing is stored". A Supabase deployment without a careers tenant still answers 503.
- Offline copy for candidates: "Applications are unavailable right now. We can't show our open roles at the moment. Please come back a little later; nothing you typed has been sent." Neutral styling, "Try again" button; the status pill reads "Applications closed".
- Header, chat and footer share one `max-w-6xl` column (chat 168–1272 px at 1440, header content 168–1272 px).
- The post-application summary shows the /100 score without stars.
