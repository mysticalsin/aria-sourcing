---
project: MSourcing / ARIA
shift: 71
agent: cursor-cloud
updated: 2026-08-25 UTC
status: linkedin-heyreach-parity-shipped
---

# Handoff - Shift 71

## Current state

- Branch `cursor/enterprise-autopilot-b91d` → PR #25.
- LinkedIn messaging now follows **HeyReach-parity** loop (scenarios S1–S20 in `docs/LINKEDIN_HEYREACH_PARITY.md`).
- Multi-event webhook `POST /api/webhooks/linkedin` (`2026-08-25.li-events.v1` + legacy reply).
- Migration **0059**: `linkedin_channel_events`, `record_linkedin_channel_event`, correlate, `read_inbound_message_for_loop` (Email|LinkedIn).
- Loop worker classifies LinkedIn inbound via `read_inbound_message_for_loop` + `channel: LinkedIn`.
- Admin **Simulate event** in Settings; **LinkedIn messaging inbox** on `/replies`.
- Gate: `tsc` + `typecheck:tests` + linkedin/heyreach/worker/privileges contracts green this shift.

## Done this shift

- Scenario plan doc for invite → accept → message → reply → classify intents.
- Durable multi-event ingest + correlate + conversation row (without violating 0028 owner_id inbound FK).
- Fixed dead-end: LinkedIn inbound no longer blocked by Email-only `read_inbound_email_for_loop`.
- Simulate + events APIs; Settings/Replies UI; privileges + tests.

## Blockers

- CI-BUDGET (Tony).
- Apply migrations **0057–0059** on live Supabase.
- L-2: contract LinkedIn vendor for automated wire (assisted-manual + simulate work without it).
- A-1 kill-switch still owner-gated.

## Next steps

1. Apply 0057–0059 on Supabase.
2. Admin: Connect LinkedIn → Validate → Simulate `reply` → confirm classify job + Replies inbox.
3. Optional: set `LINKEDIN_VENDOR_*` + inbound secret; point vendor at webhook with `route_key`.
4. Email OAuth env still required for full email loop (shift 69).

## Decisions made (don't relitigate)

- No LinkedIn member OAuth / password / cookies / scrape / session fleets.
- Inbound tenant ONLY from `route_key` (never sender profile).
- Webhook-first classify; no idle LLM burn.
- Conversation attach on `messages_inbound` skipped when no owner_id (0028 constraint); event row still stores conversation_id.

## Watch out

- `read_inbound_email_for_loop` remains Email-only wrapper — new callers must use `read_inbound_message_for_loop`.
- Privileges inventory grew for 0058/0059 RPCs in `tests/db/function-privileges.sql`.
