# LinkedIn channel — OIDC identity + assisted-manual / vendor messaging

**Date:** 2026-08-26  
**Status:** Sign In with LinkedIn (OpenID Connect) is the real identity connection;
messaging remains assisted-manual or contracted vendor (no scrape / session bots).

## Real login (OIDC)

1. Create a LinkedIn app → enable **Sign In with LinkedIn using OpenID Connect**.
2. Set redirect URI to `{SITE}/auth/linkedin/callback`.
3. Fly / env:
   - `LINKEDIN_CLIENT_ID`
   - `LINKEDIN_CLIENT_SECRET`
   - `LINKEDIN_REDIRECT_URI`
   - `DATA_ENCRYPTION_KEY` (tokens encrypted at rest)
4. Apply migration **0061** (`linkedin_oauth_connections`).
5. Settings → Integrations → **Sign in with LinkedIn**.

Tokens are stored in `linkedin_oauth_connections` (never returned to the browser).
The seat’s `connected_account` mirrors the LinkedIn display name / email.

## Messaging (unchanged policy)

- **Assisted-manual:** draft → human paste-send in LinkedIn → Confirm in Aria.
- **Vendor API:** requires `LINKEDIN_VENDOR_API_URL` + `LINKEDIN_VENDOR_API_KEY` (fail-closed).
- Official InMail / RSC still needs a LinkedIn partnership (separate track).

## Explicitly refused

- LinkedIn password / cookie / Recruiter session capture inside Aria
- Headless browsers, grey-market automation tools
- Scraping linkedin.com from this app

## Ops checklist

1. Migrations `0058`–`0061`.
2. Configure OIDC env + encryption key.
3. Admin: Sign in with LinkedIn → Validate.
4. Optional: `LINKEDIN_VENDOR_*` + inbound secret for automated wire.
   Point vendor at `/api/webhooks/linkedin` with the seat `route_key`.
