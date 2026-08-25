---
project: MSourcing / ARIA
shift: 70
agent: cursor-cloud
updated: 2026-08-25 UTC
status: linkedin-assisted-manual-e2e-shipped
---

# Handoff - Shift 70

## Current state

- Branch `cursor/enterprise-autopilot-b91d` → PR #25.
- LinkedIn **assisted-manual E2E** shipped (safe connect — no LinkedIn login/scrape).
- Settings → Integrations: **Connect my LinkedIn** + Validate.
- APIs: `/api/linkedin/connections`, `/api/linkedin/test`, `/api/outreach/confirm-manual`, `/api/webhooks/linkedin`.
- Migration **0058**: inbound routes + assisted confirm RPC + inbound record.
- LinkedIn seats can go live without mailbox SPF; suppressions type `linkedin` persist; draft guardrail injected.
- Gate green: `tsc` + `typecheck:tests` + `npm test` (incl. `linkedin-connections`).

## Done this shift

- LinkedIn Settings hub + durable Confirm after human paste/send.
- Vendor inbound webhook path (HMAC + route_key) for when L-2 credentials exist.
- Docs: `LINKEDIN_SEND_ONLY.md`, `docs/runbooks/connect-linkedin-assisted-manual.md`, API map.

## Blockers

- CI-BUDGET (Tony).
- Apply migrations **0057** + **0058** on live Supabase.
- L-2: contract LinkedIn vendor for automated send + inbound (optional; assisted-manual works without it).
- A-1 kill-switch still owner-gated; email OAuth env for full email loop.

## Next steps

1. Apply 0057 + 0058.
2. Admin: Settings → Connect my LinkedIn → Validate → run one draft → Confirm.
3. Optional: set `LINKEDIN_VENDOR_*` + inbound secret; point vendor at `/api/webhooks/linkedin`.
4. Email path: GOOGLE/MICROSOFT + webhook secret (shift 69).

## Decisions made (don't relitigate)

- No LinkedIn member OAuth / password / session automation in Aria.
- Assisted-manual is the shippable LinkedIn messaging product; vendor-api fail-closed until contracted.
- Email remains the primary automated reply channel; LinkedIn inbound is vendor-webhook only.

## Watch out

- `confirm-manual` requires a LinkedIn seat (Settings connect) in live Supabase mode.
- Unique `outreach_ledger` active contact still applies — second LinkedIn confirm to same candidate may return duplicate.
- RSC/InMail partnership remains a separate track from assisted-manual.
