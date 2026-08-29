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
    │  if INTERESTED / QUALIFIED_INTEREST
    │      → enqueue pre_call_propose (dry-run slot; live book only if Autopilot+Sequences)
    │      → enqueue draft_generate when entitled (follow-up step 2)
    │         → critics-green + Autopilot ON + Sequences → autopilot-send durable queue
    │         → else Needs Approval → human Approve → Send
    │
    └── first_interview_book (live Teams when Graph ready)
              → interview_prep_send → live critics → Autopilot Email queue
                (else Needs Approval)

Autopilot ON: mint autopilot_critics → Email/WA/LI queue; live Teams book when Graph ready;
              post-book prep Autopilot-queues when critics green
Autopilot OFF: human Approve → Send; Calendar confirmLive for book; prep stays Needs Approval
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

Assisted-manual E2E is live (Settings connect → Confirm). Vendor inbound uses
`POST /api/webhooks/linkedin` (migration 0058 + `route_key`). Without a
contracted vendor, operators still read replies in LinkedIn out of band.
See `docs/LINKEDIN_SEND_ONLY.md`.

## Tests

- `tests/inbound-reply-trigger.mts` — enqueue / draft successor purity
- `tests/email-inbound-contract.mts` — DB authority
- `tests/sourcing-loop-worker.mts` — classify + draft successor path
