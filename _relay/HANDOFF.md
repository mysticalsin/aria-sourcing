---
project: MSourcing / ARIA
shift: 94
agent: cursor-cloud
updated: 2026-08-26 UTC
status: exec-map-world-fit
---

# Handoff - Shift 94

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29 → `integration/sourcing-enrichment-on-main`
- Real **Sign In with LinkedIn (OIDC)** is implemented on branch (not yet live on Fly):
  - Routes: `/auth/linkedin`, `/auth/linkedin/callback`
  - Migration: `supabase/migrations/0061_linkedin_oauth_connections.sql`
  - API: `POST /api/linkedin/connections` action `ensure_oauth` → seat + `authorizeUrl`
- Settings → Integrations: LinkedIn OIDC primary CTA; assisted-manual under Advanced; live cards only; roadmap collapsed; fake Connected seeds wiped via **STATE_VERSION 18**
- LinkedIn/oauth/honesty/infra tests green; full gate still has **7 pre-existing** `store-sourcing-actions` failures (harness now includes `flushWorkspaceSave`; remaining mismatches unrelated to LinkedIn)

## Ops required for live OAuth on Fly

1. LinkedIn Developer Portal → create app → enable **Sign In with LinkedIn using OpenID Connect**
2. Authorized redirect URL: `https://aria-mantu-app.fly.dev/auth/linkedin/callback`
3. `fly secrets set LINKEDIN_CLIENT_ID=… LINKEDIN_CLIENT_SECRET=… LINKEDIN_REDIRECT_URI=https://aria-mantu-app.fly.dev/auth/linkedin/callback -a aria-mantu-app`
4. Apply migration **0061**; confirm `DATA_ENCRYPTION_KEY` present
5. Redeploy app image that includes this branch

## Done this shift

- OIDC routes + encrypted `linkedin_oauth_connections` table
- Panel rewrite + integrations honesty (no fake connected cards)
- STATE_VERSION 18 migration for stale mock-connected GitHub/Apify/Graph/SendGrid
- Infra: register `fly-deploy-now.sh`; neutralize false-positive `fly secrets set` echo in golive script
- Test harness: add missing `flushWorkspaceSave` mock

## Blockers

- Fly has no `LINKEDIN_CLIENT_*` secrets — Sign In shows “missing env” until ops sets them
- Fly production may lag this branch SHA until redeploy

## Done this shift (continued)

- Exec choropleth: `geoMercator().fitExtent()` so full world visible (was cropped by manual scale/translate)
- Map height 380→420 on `/exec`

## Next steps

1. Tony/ops: LinkedIn app + Fly secrets + migrate 0061 + redeploy (includes map fix)
2. Smoke: Settings → Integrations → Sign in with LinkedIn (real LinkedIn consent screen)
3. Optional: triage remaining 7 `store-sourcing-actions` failures on this branch

## Decisions made (don't relitigate)

- OIDC identity login is allowed; password/cookie/session capture still refused
- Messaging remains assisted-manual or vendor (LinkedIn does not grant InMail via public OIDC)
- Apify = profile search via vault key; not LinkedIn member login
- No secrets in `_relay`/git

## Watch out

- Redirect URI must match LinkedIn app config exactly
- Tokens require `DATA_ENCRYPTION_KEY` (≥32 chars)
- Demo localStorage lies until STATE_VERSION 18 migration runs (hard refresh once)
