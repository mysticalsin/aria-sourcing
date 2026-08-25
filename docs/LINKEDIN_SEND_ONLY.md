# LinkedIn channel position — assisted-manual E2E + vendor inbound

**Date:** 2026-08-25  
**Status:** assisted-manual E2E shipped; vendor API still fail-closed without credentials (L-2)

## What works end-to-end (safe)

1. **Settings → Integrations → Connect my LinkedIn** creates a live
   `LinkedIn Assisted Manual` seat (no LinkedIn password/cookies).
2. Source → draft LinkedIn outreach → human approve → **Copy / Open LinkedIn /
   paste-send → Confirm** (`POST /api/outreach/confirm-manual` → durable ledger).
3. LinkedIn suppressions persist to `suppression_list` (type `linkedin`).
4. Draft generation injects `linkedInGuardrailPrompt()` (no login/scrape language).

## Vendor path

- Outbound `vendor-api` requires `LINKEDIN_VENDOR_API_URL` + `LINKEDIN_VENDOR_API_KEY`
  and fails closed when absent (no silent fallback to scrape).
- Inbound: `POST /api/webhooks/linkedin` with HMAC `x-aria-signature` and
  `routeKey` from `linkedin_inbound_routes` (migration **0058**). Set
  `LINKEDIN_INBOUND_WEBHOOK_SECRET` (falls back to `EMAIL_INBOUND_WEBHOOK_SECRET`).

## Explicitly refused

- LinkedIn member OAuth / Recruiter login inside Aria
- Session reuse, headless browsers, grey-market automation tools
- Scraping linkedin.com from this app

## Ops checklist

1. Apply migration `0058_linkedin_assisted_and_inbound.sql`.
2. Admin: Settings → Integrations → Connect my LinkedIn → Validate.
3. Optional vendor: set `LINKEDIN_VENDOR_*` + inbound secret; point vendor at
   `/api/webhooks/linkedin` with the seat `route_key`.
4. Official InMail/RSC still needs a LinkedIn partnership (separate track).
