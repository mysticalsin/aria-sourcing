---
project: MSourcing / ARIA
shift: 69
agent: cursor-cloud
updated: 2026-08-25 UTC
status: settings-email-oauth-hub-shipped
---

# Handoff - Shift 69

## Current state

- Branch `cursor/enterprise-autopilot-b91d` → PR #25.
- Settings → Integrations has **Connect Gmail / Connect Outlook** hub (`EmailConnectionsPanel`).
- `GET|POST /api/email/connections` lists readiness + ensures seat/OAuth URL + registers inbound routes.
- `POST /api/email/test` validates token refresh + provider profile + inbound route + webhook secret flag.
- OAuth callbacks upsert `inbound_mailbox_routes` via migration **0057** and redirect to `?tab=integrations`.
- Disconnect deactivates inbound routes before deleting `email_connections`.
- Gate green: `npx tsc --noEmit`, `typecheck:tests`, `npm test` (incl. `email-connections`).

## Done this shift

- `src/lib/email-connections.ts` + APIs + panel + migration 0057.
- Honest Gmail/Outlook integration cards + Test wired to `/api/email/test`.
- Docs: `docs/API.md`, `docs/runbooks/connect-gmail-outlook.md`, `docs/INBOUND_REPLY_AUTOPILOT.md`.

## Blockers

- CI-BUDGET (Tony) — Actions minutes.
- Live OAuth: set `GOOGLE_*` / `MICROSOFT_*`, `DATA_ENCRYPTION_KEY`, `EMAIL_INBOUND_WEBHOOK_SECRET`.
- Apply migration 0057 on Supabase before relying on auto inbound-route upsert.
- A-1 kill-switch still owner-gated.

## Next steps

1. Deploy/apply `0057_inbound_mailbox_route_upsert.sql`.
2. Configure OAuth apps + env; connect a real mailbox from Settings → Integrations; click Validate.
3. Point provider inbound webhook at `/api/webhooks/email-inbound`.
4. MCP: Settings → AI & Models → MCP → Test (`POST /api/mcp/test`); prod needs allowlist.

## Decisions made (don't relitigate)

- Settings is the primary connect surface; Fleet seat OAuth still works.
- SendGrid/Resend remain API-key seats, not OAuth.
- Inbound route upsert is best-effort on OAuth (tokens saved even if route fails); Settings can re-register.
- Webhook-first replies; no idle classify.

## Watch out

- Google restricted scopes — prefer Internal consent for own Workspace.
- Global unique `inbound_mailbox_routes.mailbox_address` — cross-tenant claim returns `mailbox-claimed`.
- `requireAdmin` for connect start; list/test allow `source` or `manage_fleet`.
