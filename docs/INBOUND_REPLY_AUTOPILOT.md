# Inbound reply autopilot — webhook-first (no idle token burn)

**Date:** 2026-08-25  
**Audience:** ops wiring full autopilot sourcing end-to-end.

## Problem

Polling inboxes on a timer and classifying every tick wastes LLM tokens when
candidates have not answered. ARIA must wake **only when a reply arrives**.

## Design

```
Provider (Resend / SendGrid / Graph adapter / n8n)
    │  signed POST
    ▼
POST /api/webhooks/email-inbound
    │  record_inbound_email (idempotent)
    │  correlate_inbound_email (In-Reply-To)
    │  enqueue inbound_classify  ← only if NOT duplicate
    ▼
Fly sourcing-loop-worker (claim_due_aria_jobs)
    │  read_inbound_email_for_loop
    │  classify once (model or deterministic fallback)
    │  append_reply patch
    │  if INTERESTED / QUALIFIED_INTEREST + entitled profile
    │      → enqueue draft_generate (still approval-gated before send)
    ▼
Human / entitled approval → dispatch-outbound
```

Idle loop ticks (~30s) **do not** call Graph or the classifier. Empty daily
`email_sync` ignition with `{}` enqueues zero classify jobs.

## Ops checklist

1. Set `EMAIL_INBOUND_WEBHOOK_SECRET` (HMAC-SHA256 hex of raw body → `x-aria-signature`).
2. Connect Gmail/Outlook in **Settings → Integrations** (OAuth callback upserts
   `inbound_mailbox_routes` via migration 0057). Or insert routes manually / use
   **Register inbound** on the connection card.
3. Point provider inbound / Graph subscription adapter at  
   `https://<host>/api/webhooks/email-inbound`.
4. Flip workspace `sourcing_loop_controls`: `kill_switch=false`, `intake_enabled=true`
   only after migrations proven (see `_relay/issues-open.md` A-1).
5. Entitled operators: `profiles.autopilot_enabled=true` (Settings → Access & roles).
6. Run Fly loop process with `ARIA_LOOP_KILL_SWITCH=false`.
7. Validate: Settings → Integrations → **Validate** on the mailbox (token + profile + route).

## Payload shape

```json
{
  "mailbox": "ops@yourdomain.com",
  "providerId": "provider-message-id",
  "from": "candidate@example.com",
  "body": "Thanks — I'm interested. When can we talk?",
  "inReplyTo": "<rfc822-message-id-of-our-outbound>"
}
```

## Response

```json
{
  "ok": true,
  "inboundId": "…",
  "duplicate": false,
  "correlated": true,
  "classifyQueued": true,
  "classifyStatus": "enqueued"
}
```

- `duplicate: true` → no re-enqueue (retries are cheap; no second LLM call).
- `classifyStatus: control_blocked` → mail stored; flip switchboard then replay or wait for next provider retry.

## LinkedIn

Inbound LinkedIn messages stay send-only until a vendor webhook exists
(`docs/LINKEDIN_SEND_ONLY.md`). Email + WhatsApp are the live reply channels.

## Tests

- `tests/inbound-reply-trigger.mts` — enqueue / draft successor purity
- `tests/email-inbound-contract.mts` — DB authority
- `tests/sourcing-loop-worker.mts` — classify + draft successor path
