# LinkedIn reply loop

Aria's rebuild of the HeyReach reply loop, inside Aria. One human start, then the
agent carries the conversation to a booked meeting.

```
Tony launches a campaign          (the one human tap: a launch grant)
      |
vendor webhook: candidate replied  POST /api/webhooks/linkedin
      |
store inbound, resolve thread      messages_inbound + agent_conversations
      |
decide: may Aria answer?           grant live, kill switch off, loop on,
      |                            not opted out, daily cap left
compose reply as Tony              server model, gated (no AI disclosure)
      |
wait 2 to 10 minutes               jitter, never inside quiet hours
      |
send through the vendor            LinkedIn Vendor API adapter only
      |
booking intent?                    real calendar event via calendar.ts,
      |                            then the confirmation goes out
loop until booked
```

## 1. Campaign launch is the human gate

`POST /api/outreach/linkedin-loop/launch` records a **launch grant**
(`linkedin_reply_grants`, migration 0055): workspace, campaign, the LinkedIn
send seat, an optional calendar seat, daily cap (default 20), quiet hours
(default 21:00 to 08:00) and timezone. The caller needs the `outreach`
permission. The vendor's campaign id (HeyReach `campaignId`) is stored on the
grant so the webhook can resolve the tenant from it.

Without a live grant nothing is answered automatically. A revoked grant
(`DELETE` on the same route, or Revoke in Settings) pulls every queued reply
back to a visible draft.

The first message of a campaign still goes through the existing Needs Approval
path in `/outreach`. The grant only covers replies inside a thread Aria already
opened.

## 2. Inbound webhook

`POST /api/webhooks/linkedin` accepts a HeyReach-shaped event
(`eventType`, `campaignId`, `lead.profileUrl`, `message`) or a generic vendor
shape (`profileUrl`, `text`, `campaignId`). Parsing is field-tolerant and
verified against the live payload before go-live; anything without a real
`linkedin.com/in` URL and message text is ignored, never guessed.

Authentication is a shared secret: header `x-aria-webhook-secret` must equal
`LINKEDIN_INBOUND_WEBHOOK_SECRET`. An unset secret refuses every call.

Aria never reads LinkedIn itself, never logs in, never scrapes, never drives a
browser. `src/lib/linkedin-policy.ts` still blocks any content that tries.

Storage comes first: the reply lands in `messages_inbound` (channel LinkedIn,
idempotent on the vendor message id) before any model call. The thread is the
latest LinkedIn message Aria sent to that profile in that campaign; a profile
Aria never wrote to goes to triage for a person (`no-conversation`).

## 3. The 2 to 10 minute delay

`loopReplyDelayMs(seed)` in `src/lib/linkedin-loop.ts` gives a deterministic
jitter in `[120s, 600s]` from the inbound id. `loopSendTime` pushes the send past
quiet hours in the grant's timezone and re-jitters so a quiet night does not end
with every reply firing at 08:00:00. The dispatcher re-checks quiet hours at send
time and reschedules if needed.

Nothing is sent from the webhook request that stored the reply: the row is
queued with `scheduled_at` in the future, and the drain only picks rows that are
due.

## 4. Agent reply

`ingestLinkedInInbound` composes with the same prompt as WhatsApp
(`buildReplyPrompt`): as the recruiter, in the candidate's language, under 80
words, never naming AI, tools or automation. Every draft passes `gateOutbound`
(hard block on AI disclosure, status narration, leaked markup, placeholders),
the disclosure policy and injection detection. A draft that fails is stored
`blocked` for a person, never sent.

The reply is written to `messages_outbound` as `type = candidate_reply`,
`status = queued`, with `linkedin_reply_grant_id` set. The shared dispatcher
skips grant rows; `dispatchLinkedInLoopDue` owns them.

## 5. Booking intent and the calendar event

`detectBookingIntent` recognises agreement ("yes", "let's meet", "works for me")
and a concrete time ("Tuesday at 3pm", "tomorrow 10:30", ISO). Agreement
without a time gets a reply that asks for one or two slots. A named time:

1. `claimCalendarBooking` holds the candidate + start slot (0034 ledger).
2. `createGoogleCalendarEvent` / `createGraphCalendarEvent` (`calendar.ts`) on
   the grant's calendar seat.
3. `reconcileCalendarBooking` on a definite outcome.

If the calendar seat is missing, not connected, rejects the event, or the
outcome is unknown, **nothing is booked**: the inbound goes to triage with
`booking-failed:<reason>` and no confirmation is written. Only a confirmed event
produces the confirmation copy (`bookingConfirmCopy`), which still waits the
human delay.

## 6. Send: vendor or nothing

The dispatcher sends only through the `LinkedIn Vendor API` adapter
(`src/lib/linkedin-channel.ts`, `LINKEDIN_VENDOR_API_URL` and
`LINKEDIN_VENDOR_API_KEY`). Point those at the HeyReach send endpoint or a relay
that holds the HeyReach key.

Honest states:

| State | What happens |
|---|---|
| Vendor configured, seat live | Reply is sent, attempt ledger records `sent` with the vendor message id |
| Vendor not configured | Row is blocked `linkedin-provider-unconfigured`, visible as a draft. Never counted as sent |
| Seat is Assisted Manual | Row is blocked `linkedin-loop:requires-vendor-api`. A person copies and pastes. Never faked as sent |
| Vendor accepts without a message id | Attempt recorded `ambiguous`, row failed, no retry without a person |

The DB claim (`claim_linkedin_loop_reply`) re-verifies the grant, the workspace
switch, suppression, the live vendor seat and the grant's daily cap inside one
transaction, and the LinkedIn approval trigger only lets a grant row through
while `linkedin_reply_grant_active()` is true. Human-approved LinkedIn rows keep
the 0054 path unchanged.

## 7. Kill switch, caps, opt-out

- **Workspace switch**: `sourcing_loop_controls.linkedin_reply_loop_enabled`,
  default off. Settings, Approval & Compliance, "Automatic LinkedIn replies".
  Admins only. The existing `kill_switch` on the same row also stops the loop.
- **Kill switch button**: turns the loop off and revokes every launch grant.
- **Per-campaign**: revoke a grant.
- **Daily cap**: per grant, counted in `linkedin_reply_attempts`.
- **Opt-out**: "stop", "not interested", "remove me" and similar add the profile
  to `suppression_list` (type linkedin), cancel queued replies, and hold.

## 8. Ledgers

Replies inside a thread are not new contacts, so the loop does not write
`outreach_ledger` (one active contact per candidate per 90 days stays intact).
Each reply attempt lives in `linkedin_reply_attempts` with its own
`send_attempt_id`, the same reconcile discipline as the other channels.

## 9. WhatsApp next

The grant table carries a `channel` column and the pure decisions in
`linkedin-loop.ts` take the channel as data. Wiring WhatsApp means: a grant
with `channel = 'WhatsApp'`, the existing WhatsApp webhook calling the same
decide and schedule path instead of storing a blocked draft, and an additive
branch in the WhatsApp approval trigger. Not in this slice.

## Environment

| Variable | Purpose |
|---|---|
| `LINKEDIN_INBOUND_WEBHOOK_SECRET` | Shared secret for `/api/webhooks/linkedin` |
| `LINKEDIN_VENDOR_API_URL`, `LINKEDIN_VENDOR_API_KEY` | Vendor send (HeyReach endpoint or relay) |
| `CRON_SECRET` | `/api/cron/dispatch-outbound` also drains the loop |
| A server model key (`ANTHROPIC_API_KEY` first) | Reply composition |

## Tests

`tests/linkedin-loop.mts` proves the fail-closed paths: no launch means no
auto-send; a launched campaign schedules 2 to 10 minutes out, never immediate;
quiet hours, kill switch, disabled loop and opt-out hold; booking intent creates
the event and a calendar failure never marks a booking; an unconfigured vendor
or an assisted-manual seat is never counted as sent.
