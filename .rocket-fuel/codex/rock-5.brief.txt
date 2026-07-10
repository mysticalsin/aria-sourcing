You are the Integrator building Rock 5 in the MSourcing/ARIA Next.js repo. workspace-write. Build EXACTLY this.

Objective: make the real-mailbox OAuth path usable and testable — document the Google Cloud OAuth app setup, confirm the env plumbing, and add a test proving /auth/google produces a real Google consent redirect when configured.

Read first: (understand before editing)
- src/app/auth/google/route.ts — the Gmail OAuth start route. It calls requireAdmin() FIRST (~21-29), then checks process.env.GOOGLE_CLIENT_ID (~26), then builds an accounts.google.com/o/oauth2/v2/auth redirect with PKCE + state (scopes gmail.send, gmail.readonly, calendar.events). Uses GOOGLE_REDIRECT_URI (default http://localhost:3000/auth/google/callback).
- src/app/auth/google/callback/route.ts and src/app/auth/microsoft/* — the callback + MS equivalent, for context.
- .env.local.example and .env.production.example — where GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI (and Microsoft equivalents) are documented. Confirm they are present with clear instructions.
- src/lib/supabase/server.ts requireAdmin + the demo-side-effects guard (publicDemoSideEffectsDisabled) so the test mocks the right things.

Build:
1. Write production-readiness/GOOGLE_OAUTH_SETUP.md: step-by-step to create the Google Cloud OAuth client (console.cloud.google.com → APIs & Services → Credentials → OAuth client ID, type Web application), the scopes (gmail.send, gmail.readonly, calendar.events), the exact Authorized redirect URIs (local: http://localhost:3003/auth/google/callback AND http://localhost:3000/auth/google/callback; prod: https://<domain>/auth/google/callback), consent-screen notes (test users vs verification), and which env vars to set (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI). Add a short Microsoft/Entra equivalent pointer.
2. Ensure .env.local.example + .env.production.example document GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI clearly (add if missing; do not add real secrets).
3. Do NOT change the route logic unless there is an actual bug.

Constraints: (what must NOT change) do not weaken requireAdmin or the demo-side-effects guard. Do not print or commit any real secret. Do not change scopes. Do not weaken or delete any existing test.

Proof: create tests/auth-google-redirect.mts. It must, with a mocked authenticated admin session and demo-side-effects disabled and a dummy GOOGLE_CLIENT_ID set, invoke the /auth/google GET handler and assert the response is a redirect whose Location host is accounts.google.com and includes the gmail.send scope + a state param. The Visionary runs `npx tsx tests/auth-google-redirect.mts` outside the sandbox; you only need it to compile and `npx tsc --noEmit` clean.

Stop when: production-readiness/GOOGLE_OAUTH_SETUP.md exists and is complete, env examples document the Google vars, tests/auth-google-redirect.mts exists and encodes the redirect assertion, and `npx tsc --noEmit` is clean. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result. Treat SHIP = built + tsc clean + all deliverables present; REVISE = blocked or incomplete (state why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
