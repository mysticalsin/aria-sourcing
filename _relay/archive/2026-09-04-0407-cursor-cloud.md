---
project: MSourcing / ARIA
shift: 97
agent: cursor-cloud
updated: 2026-09-04 UTC
status: linkedin-automatic-default-shipped
---

# Handoff - Shift 97

## Current state

- **Branch/PR:** `cursor/linkedin-auto-default-b91d` → `integration/sourcing-enrichment-on-main` (or current base)
- LinkedIn outreach **defaults to Automatic**; Manual approve-and-send is an explicit toggle
- Policy: `getOutboundChannelPolicy(channel, { deliveryMode })` — automatic allowed; manual → 409
- Wire: `/api/outreach/send` LinkedIn automatic → `enqueue_linkedin_outbound` → vendor-api dispatcher
- Settings → Integrations → LinkedIn stack → Delivery mode toggle
- Migration `0062_linkedin_automatic_enqueue.sql`; STATE_VERSION 19

## Done this shift

- `fleet.deliveryMode: 'automatic' | 'manual'` (default automatic)
- Policy/docs/guardrails updated (scrape/session bots still blocked)
- Send route + store approval/send paths for automatic LinkedIn
- Settings UI Automatic / Manual toggle
- Tests: linkedin-policy, linkedin-connections, acceptance dry-run

## Blockers

- Automatic wire still needs `LINKEDIN_VENDOR_API_URL` + `LINKEDIN_VENDOR_API_KEY` + live Vendor API seat
- Fly LinkedIn OAuth secrets may still be pending ops
- Apply migration 0062 on deploy

## Next steps

1. Ops: apply 0062 + set `LINKEDIN_VENDOR_*` for automatic wire
2. Optional: OpenBot-style observe/takeover / computerId stubs (out of scope this PR)
3. Optional: prefer creating Vendor API seat when deliveryMode=automatic on connect

## Decisions made (don't relitigate)

- LinkedIn delivery **defaults to Automatic**; Manual is opt-in (Tony product directive 2026-09-04)
- Automatic uses entitled vendor/API only — **no** silent fallback to assisted-manual paste
- Scrape / session-bot / PhantomBuster-style tooling remains forbidden
- Reuse Integrations primitives across Fleet/Replies (prior)
- Guardrails on Fleet collapsed by default (prior)

## Watch out

- Approval scope for LinkedIn now normalizes profile URLs via `normalizeLinkedInProfileUrl`
- Acceptance harness expects LinkedIn `confirmLive=false` → **dry-run** (not 409)
- Assisted-manual Confirm path still required when `deliveryMode=manual`
