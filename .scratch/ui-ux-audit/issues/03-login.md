# 03 — Nouveau login

Status: resolved
Blocked by: —
Spec: ../spec.md

## Critères d'acceptation

§3. Formulaire ou bouton SSO visible sans clic préalable, sans vidéo tierce, tient sur 1366×768 et 390×844, une seule mention de sécurité. Le flux d'auth existant et le test d'acceptation (`getByLabel("Username or email")`) restent verts.

Vérification : porte de test complète, plus une nouvelle capture des routes concernées à 1440×900 et 390×844.

## Comments

2026-10-29 (Claude Code): implemented.
- Sign-in screen instead of a landing page: form (or Microsoft / demo button)
  visible without a click, visible field labels, errors in `role="alert"`.
- Removed: third-party CloudFront video, glass button, 120 px Times headline,
  pause control, personal credit. "ARIA is a Mantu Group product." instead.
- Desktop: ink panel showing the 3-step approval sequence; the human step is
  the only accent (Mantu yellow). Mobile: form only.
- `min-h-screen` instead of `h-screen overflow-hidden`: no clipping at 768 px.
- Shared `Button` gains `justify-center` (full-width buttons were left-aligned
  across the app).
- Contract test `tests/login-page.mts` rewritten around the new contract;
  security assertions kept (demo prefill, demo shortcut, Azure flag, safe
  redirect).
- Checked visually in local mode and with `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true`
  at 1440 and 390 px. Supabase/Azure mode not rendered here (needs a backend).
