# LinkedIn messaging — HeyReach-parity scenario plan

**Date:** 2026-08-25  
**Product stance:** Behaves like HeyReach for recruiters (account → campaign touches →
webhook answers → classify → next step), while Aria **never** logs into LinkedIn
or scrapes. Wire delivery is **assisted-manual** (human in LinkedIn) or a
**contracted vendor API**.

## Actor model

| Role | Responsibility |
|---|---|
| Aria | Seats, approvals, ledger, sequences, classify, drafts, inbox UI |
| Operator | Connect seat; for assisted-manual: paste/send invites & messages |
| Vendor (optional) | Session/API to LinkedIn; POSTs signed events to Aria |
| Candidate | Accepts invite / replies on LinkedIn |

## Lifecycle (happy path)

```
Connect seat (Settings)
    → Approve LinkedIn draft (invite note or message)
    → Send (assisted Confirm OR vendor deliver)
    → [optional] connection_accepted webhook
    → Message / follow-up
    → reply webhook
    → inbound_classify (once)
    → INTERESTED → draft_generate (entitled)
       NOT_INTERESTED → suppress linkedin + stop
       OOO → snooze / no suppress
```

## Scenario matrix

| # | Scenario | Trigger | Aria behaviour |
|---|---|---|---|
| S1 | Connect account | Settings → Connect my LinkedIn | Live assisted-manual seat + `route_key` |
| S2 | Validate seat | Validate button | Adapter + route + webhook secret checks |
| S3 | Invite sent (manual) | Confirm invite / Confirm send | `record_linkedin_assisted_manual_send` / event `invite_sent` |
| S4 | Invite sent (vendor) | Vendor `invite_sent` | Ledger reconcile + event row |
| S5 | Connection accepted | Webhook `connection_accepted` | Event; unlock DM step / activity |
| S6 | Connection rejected | Webhook `connection_rejected` | Event; skip DM / mark cold |
| S7 | Message sent | Confirm / vendor `message_sent` | Ledger `sent` |
| S8 | Delivered / seen | `message_delivered` / `message_seen` | Receipt event only (no double-send) |
| S9 | Send failed | `message_failed` | Event + operator surface |
| S10 | Candidate reply | Webhook `reply` | Persist inbound → correlate → enqueue classify |
| S11 | Interested reply | Classify INTERESTED / QUALIFIED | Draft follow-up for entitled autopilot |
| S12 | Not interested | Classify NEGATIVE / NOT_INTERESTED | Suppress `linkedin` |
| S13 | OOO | Classify OOO | No suppress; no draft |
| S14 | Unclear | Classify UNCLEAR | Triage in LinkedIn inbox |
| S15 | Duplicate webhook | Same `eventId` / providerId | Idempotent; no re-classify |
| S16 | Unknown profile | Reply from unmatched URL | Inbound stored; triage (no candidate) |
| S17 | Suppressed profile | Confirm/send while suppressed | Fail closed |
| S18 | No route_key / bad HMAC | Webhook | 401 / 404 |
| S19 | Vendor keys missing | Vendor seat deliver | Fail-closed `linkedin-provider-unconfigured` |
| S20 | Demo dry-run | Public demo | No durable writes |

## Webhook envelope (`2026-08-25.li-events.v1`)

```json
{
  "schemaVersion": "2026-08-25.li-events.v1",
  "routeKey": "<from linkedin_inbound_routes>",
  "eventId": "<idempotency key>",
  "eventType": "reply|connection_accepted|connection_rejected|invite_sent|message_sent|message_delivered|message_seen|message_failed",
  "occurredAt": "ISO-8601",
  "candidate": { "profileUrl": "https://www.linkedin.com/in/…" },
  "thread": { "providerThreadKey": "…", "providerMessageId": "…" },
  "outbound": { "ariaAttemptId": "uuid|null" },
  "payload": { "body": "reply text", "errorCode": null }
}
```

Auth: `x-aria-signature: hex(hmac_sha256(secret, rawBody))`  
Secret: `LINKEDIN_INBOUND_WEBHOOK_SECRET` (fallback `EMAIL_INBOUND_WEBHOOK_SECRET`).

Legacy reply-only payloads (`routeKey`, `providerId`, `fromProfileUrl`, `body`) still accepted as `eventType=reply`.

## What is deliberately not HeyReach

- Cookie/session harvest, PhantomBuster-style scrapers, mass-accept bots
- Silent automated InMail without approval (platform safety claim)
- Official LinkedIn RSC until partnership (separate track)

## Ops enablement

1. Apply migrations `0058` + `0059`.
2. Connect seat; copy `route_key` to vendor.
3. Optional: `LINKEDIN_VENDOR_*` for automated wire.
4. Use **Simulate event** in Settings (admin) to prove S5/S10 without a vendor.
