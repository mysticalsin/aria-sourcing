# LinkedIn channel — OIDC identity + Automatic / Manual messaging

**Date:** 2026-09-04  
**Status:** Sign In with LinkedIn (OpenID Connect) is the real identity connection.
Messaging defaults to **Automatic** via an entitled vendor/API seat; operators may
switch the workspace to **Manual** (assisted approve-and-paste). No scrape / session bots.

## Real login (OIDC)

1. Create a LinkedIn app → enable **Sign In with LinkedIn using OpenID Connect**.
2. Set redirect URI to `{SITE}/auth/linkedin/callback`.
3. Fly / env:
   - `LINKEDIN_CLIENT_ID`
   - `LINKEDIN_CLIENT_SECRET`
   - `LINKEDIN_REDIRECT_URI`
   - `DATA_ENCRYPTION_KEY` (tokens encrypted at rest)
4. Apply migration **0061** (`linkedin_oauth_connections`) and **0062** (`enqueue_linkedin_outbound`).
5. Settings → Integrations → **Sign in with LinkedIn**.

Tokens are stored in `linkedin_oauth_connections` (never returned to the browser).
The seat’s `connected_account` mirrors the LinkedIn display name / email.

## Delivery mode (`settings.fleet.deliveryMode`)

| Mode | Default | Behaviour |
|---|---|---|
| `automatic` | **Yes** | After approval, Send queues `messages_outbound` → vendor-api dispatcher. No per-message paste/confirm. Still respects contact lease, DNC, caps, kill switches. |
| `manual` | Opt-in | Draft → human paste in LinkedIn → Confirm (`record_linkedin_assisted_manual_send`). `/api/outreach/send` returns **409 manual-required**. |

Toggle: **Settings → Integrations → LinkedIn stack → Delivery mode**
(“Automatic outreach” / “Manual approve-and-send”).

## Messaging backends

- **Vendor API (automatic path):** requires `LINKEDIN_VENDOR_API_URL` + `LINKEDIN_VENDOR_API_KEY` and a live `LinkedIn Vendor API` seat (fail-closed; no silent assisted-manual fallback).
- **Assisted-manual (manual mode):** draft + Confirm receipt.
- Official InMail / RSC still needs a LinkedIn partnership (separate track).

## Explicitly refused

- LinkedIn password / cookie / Recruiter session capture inside Aria
- Headless browsers, grey-market automation tools (PhantomBuster clones, etc.)
- Scraping linkedin.com from this app

## Ops checklist

1. Migrations `0058`–`0062`.
2. Configure OIDC env + encryption key.
3. Admin: Sign in with LinkedIn → Validate.
4. For Automatic: set `LINKEDIN_VENDOR_*` + live Vendor API seat; inbound secret for replies.
   Point vendor at `/api/webhooks/linkedin` with the seat `route_key`.
5. Leave Delivery mode on Automatic (default), or switch to Manual when desired.
