# Aria Connect LinkedIn: plan

Status: PLAN ONLY. No product code in this document's commit. Nothing merged, nothing deployed.
Branch: `cursor/aria-linkedin-outreach`. Builds on `71c6204` (reply loop) and `0054` (LinkedIn outbox channel).

This is an engineering document. It names vendors so the team can evaluate them. Nothing in
this file is operator-facing copy. Operator-facing copy rules are in section 2 and are
enforced by the white-label test in section 6.

## 0. Summary

LinkedIn has no first-party send API that a personal or Recruiter seat can OAuth into today.
The Messages API and the Invitations API exist, but both carry the note that usage is
restricted to approved partners under an API agreement, and the Messages API requirements
forbid automated or scheduled sends outright. Recruiter System Connect is ATS sync, not send.
The self-serve LinkedIn app Aria already registers gets `openid profile email` only, which is
exactly what `src/app/auth/linkedin/route.ts` requests: identity binding, not delivery.

Decision: **white-labeled licensed delivery behind a Connect LinkedIn card**. The operator
sees Aria. Aria talks to a licensed delivery vendor through the existing `LinkedIn Vendor API`
adapter and the existing inbound webhook. The vendor name never appears in the product.
Caps are 25 messages and 25 connection requests per workspace per day, visible, with the
existing kill switch. Agents target from the campaign shortlist. The campaign launch stays
the human gate.

Honest limits of this decision are in sections 1.4, 5 and 7. Read them before funding it.

## 1. Decision: native OAuth send vs white-labeled licensed delivery

### 1.1 Evidence from LinkedIn

| Source | What it says | Consequence for Aria |
|---|---|---|
| learn.microsoft.com/linkedin/shared/integrations/communications/messages (updated 2023-12-20) | Note at top: usage restricted to approved partners, subject to an API agreement. Recipients are first-degree connections or an existing thread. Requirements: a message must be tied to a specific member action, automated or scheduled events do not count, the member must see the draft and take an affirmative action to send each one. | Even as a partner, a 2 to 10 minute delayed auto-reply is outside the API terms. Native send cannot power the loop. |
| learn.microsoft.com/linkedin/shared/integrations/communications/invitations (updated 2022-04-06) | Same partner-only note. Invites only on behalf of the authenticated member. | Connection requests by API are partner-gated. No self-serve path. |
| learn.microsoft.com/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 | Self-serve product is Sign In with LinkedIn using OpenID Connect. Scopes: `openid`, `profile`, `email`. | Aria's registered app can identify a member, nothing more. |
| `docs/partnerships/linkedin-rsc-application.md` (verified 2026-07-09) | RSC synchronizes ATS and Recruiter data. It is not a send API and not a search API. Months of partner BD, Job Posting integration first. | RSC does not deliver connects or DMs. Do not present it as such. |

Web search on 2026-09-02 confirmed the same picture from third parties: the official
Messages endpoint is partner-only and first-degree-only, and the vendors that offer
"LinkedIn messaging APIs" (Unipile, HeyReach, ConnectSafely and similar) do so by operating
the member's LinkedIn session on their own infrastructure, not through a LinkedIn API.

### 1.2 Evidence from the repo

- `src/app/auth/linkedin/route.ts` line 47: scope is `openid profile email`. The callback
  binds `agent_seats.connected_account` and does not persist a token for any API call.
- `src/lib/linkedin-channel.ts`: two adapters. `assisted-manual` (copy and paste) and
  `vendor-api` (POST to `LINKEDIN_VENDOR_API_URL` with a bearer key, expects a durable id).
  There is no primitive for a connection request yet, only a message body.
- `71c6204`: launch grant (`linkedin_reply_grants`), inbound webhook
  `POST /api/webhooks/linkedin` (HeyReach-shaped or generic), `decideLoopReply` with hold
  reasons, `loopSendTime` 2 to 10 minute jitter past quiet hours, booking through
  `calendar.ts`, Settings kill switch. Reply daily cap default 20 per grant.
- `0054`: first-touch LinkedIn rows need an exact human approval row and pass a per-seat
  daily cap (`agent_seats.daily_limit`, default 40) inside `claim_linkedin_outbound_queued`.
- `src/lib/linkedin-policy.ts`: blocks any content or instruction that tries to log in,
  scrape or drive a browser against LinkedIn. Stays untouched.
- `src/lib/sourcing/engine.ts`: `SHORTLIST_FLOOR = 60`, `SHORTLIST_CAP = 20`.

### 1.3 The pick

**Vendor behind Aria.** Reasons, in order:

1. Native send is not available to Aria (partner-only), and would not permit the loop even
   if it were (no scheduled sends, per-message affirmative action).
2. The vendor adapter, webhook, grant, dispatcher and calendar already exist at `71c6204`.
   The delta is caps, targeting, a connect primitive, and copy.
3. Every fail-closed control lives in Aria's DB and code, not in the vendor. The vendor is a
   transport. If it disappears, rows become visible blocked drafts, never fake sends.

### 1.4 What this decision does not hide

- A licensed delivery vendor of this category runs the operator's LinkedIn session on the
  vendor's infrastructure. Aria never touches linkedin.com, never holds cookies, never runs a
  browser, so `linkedin-policy.ts` and the hard gates hold for Aria. The operator's LinkedIn
  account is still the one sending, under LinkedIn's User Agreement, which prohibits
  third-party automation tools. Account restriction risk sits on that account. Section 7
  covers detection and fail-closed handling. Tony decides whether that risk is acceptable
  for his own seat before anything is switched on.
- "One login, then it works" holds only if the vendor exposes an API or an embeddable hosted
  step to attach a LinkedIn sender. If the vendor requires its own console for that step,
  the operator sees the vendor once, at connect time. Slice S0 in section 6 settles this
  before any product code is written.
- Vendor notification emails, invoices and status pages carry the vendor's brand. Aria can
  keep its own surfaces clean; it cannot rename someone else's email.

## 2. Operator UX

### 2.1 The card

One card in Settings, Fleet: **Connect LinkedIn**. Same card position as the LinkedIn seat
today. States:

| State | Card copy | Button |
|---|---|---|
| Not connected | Connect your LinkedIn account. Aria sends connection requests and messages from it, within the daily limits you set below. | Connect LinkedIn |
| Connecting | Finishing the connection. This can take a minute. | (disabled) |
| Connected | Connected as {name}. Sending from this account. | Disconnect |
| Restricted or paused by provider | LinkedIn has paused sending from this account. Aria has stopped every campaign until it clears. | Retry connection |
| Not configured on this deployment | LinkedIn sending is not enabled on this workspace. Ask your admin. | (none) |

Flow behind Connect LinkedIn: the existing official OIDC step (identity, bound to the seat,
already built) followed by the vendor sender attach (S0 decides the mechanics). The operator
sees Aria pages and one LinkedIn login page. If S0 finds that the vendor's own hosted page
is unavoidable, the card copy says "You will be asked to sign in to LinkedIn on a secure
page" and nothing else.

### 2.2 Daily limits and quiet hours

Settings, Approval & Compliance, the existing "Automatic LinkedIn replies" panel grows into
**LinkedIn sending**:

- Messages per day: default 25, range 0 to 25 (hard ceiling, not editable above 25 in UI).
- Connection requests per day: default 25, same range.
- Quiet hours: default 21:00 to 08:00 in the workspace timezone (reused from grants).
- Today's usage: "12 of 25 messages, 7 of 25 connection requests" with a reset time.
- Kill switch: existing button. Copy: "Stop everything. Every queued message becomes a draft
  for a person."

### 2.3 Campaign launch

From a campaign with a shortlist, one button: **Launch outreach**. The sheet shows: the
people selected (score 60 or more, up to 20), the drafted connection note and first message
per person, the two daily limits, quiet hours, the calendar that will hold interviews. One
tap launches. That tap is the human gate for that list. People added later show as
"Not launched yet" with an **Add to launch** button.

### 2.4 Copy rules (enforced by test, section 6)

- Original Aria copy. No em dashes anywhere in operator-facing strings.
- Never say AI, assistant, automation, bot, or model in a message to a candidate
  (`gateOutbound` already blocks this) or in the campaign sheet.
- Never name a vendor: no HeyReach, Unipile, PhantomBuster, Apify, actor names, or
  "vendor" in operator chrome. Say "LinkedIn" or "your LinkedIn account".
- Fail-loud toasts point at an Aria button (Connect LinkedIn, Open Settings), never at an
  external console.

Known copy that violates this today and must be swept in S2:
`src/lib/sourcing/people-connect.ts` line 79 and line 234, `src/components/fleet/seat-card.tsx`
line 567, `src/components/outreach/quick-draft.tsx` lines 136 and 137,
`src/components/outreach/outreach-message-card.tsx` line 364,
`src/components/settings/integration-card.tsx` line 318, `src/lib/integrations.ts` lines 96
to 107, `src/components/settings/linkedin-loop-panel.tsx` line 181 ("Vendor campaign").

## 3. Architecture

### 3.1 Reuse from 71c6204 and 0054 (no change)

| Piece | Reused as is |
|---|---|
| `linkedin_reply_grants` + `launch_linkedin_reply_loop` RPC | The launch grant. Gains a scope (section 3.2) but keeps table, uniqueness, revoke. |
| `POST /api/webhooks/linkedin` | Inbound replies and connection-accepted events. Same secret header. |
| `decideLoopReply`, `loopSendTime`, `isLoopOptOut`, `detectBookingIntent` | Pure decisions. |
| `dispatchLinkedInLoopDue`, `claim_linkedin_loop_reply` | Reply dispatch. |
| `linkedin-booking.ts`, `calendar.ts`, 0034 claim ledger | Meeting booking. |
| `LinkedIn Vendor API` adapter | Message send. Gains a `connect` operation (3.3). |
| `sourcing_loop_controls.kill_switch`, `linkedin_reply_loop_enabled` | Kill switch and loop switch. |
| `enforce_active_linkedin_approval` trigger with the additive grant branch | Unchanged. First-touch rows still need an approval row. |

### 3.2 Add

**Seats.** No new seat kind. The `LinkedIn Vendor API` seat is the one the card connects.
Its display label becomes "LinkedIn" everywhere the operator can see it. A new column
`agent_seats.provider_sender_ref text` stores the vendor's sender id (opaque, never shown).
A new column `agent_seats.provider_state text` in
`{ 'connected', 'paused', 'restricted', 'disconnected' }` mirrors the vendor's last known
state for the seat, fail-closed default `'disconnected'`.

**Caps.** Migration 0056. Two workspace-level columns on `sourcing_loop_controls`:
`linkedin_daily_message_cap int not null default 25 check (between 0 and 25)` and
`linkedin_daily_connect_cap int not null default 25 check (between 0 and 25)`. A counter view
`linkedin_daily_usage(workspace_id, day, messages, connects)` computed from
`outreach_ledger` (first touch, channel LinkedIn), `linkedin_reply_attempts` (replies) and a
new `linkedin_connect_attempts` ledger, all in the workspace timezone. Both existing claim
RPCs (`claim_linkedin_outbound_queued`, `claim_linkedin_loop_reply`) add one check:
`messages_today >= linkedin_daily_message_cap` returns `workspace-message-cap-reached`. The
new `claim_linkedin_connect` does the same against the connect cap. Grant `daily_cap` stays
as a per-campaign sub-limit; the workspace cap is the ceiling. A missing controls row means
cap 0, so nothing sends.

**Grant scope.** `linkedin_reply_grants` gains `scope text not null default 'replies'` with
values `replies` or `campaign`. A `campaign` grant is what Launch outreach creates. In the
same RPC transaction it writes one `outreach_approvals` row per shown draft
(`approval_source = 'human'`, body hash of the exact draft shown, scope hash of candidate,
channel, profile URL). That satisfies the existing 0054 trigger with no bypass: the launch is
the human approval of those exact drafts. Editing a draft after launch invalidates its
approval row and re-queues it for the next launch tap.

**Connect primitive.** `LinkedInAdapter` gains `connect(req)` returning the same outcome
shape as `deliver`. The vendor-api implementation posts `{ profileUrl, note, attemptId }`
to `LINKEDIN_VENDOR_CONNECT_URL` (new env, same key). Assisted-manual returns a copy and
paste outcome, never `sent`. No durable id from the vendor means `ambiguous`, no retry
without a person.

**Dispatcher.** `dispatchLinkedInCampaignDue` drains `linkedin_connect_attempts` and
first-touch rows that are due, one claim per row, jitter 2 to 10 minutes between rows,
quiet hours respected, both caps re-checked in the claim. The existing cron route calls it
after the reply drain.

**Webhook.** `parseLinkedInInboundWebhook` already recognises
`CONNECTION_REQUEST_ACCEPTED` (tests/linkedin-loop.mts line 219). New: an accepted event
schedules the first message for that person under the campaign grant, same jitter, same
caps. A `SENDER_RESTRICTED`, `SENDER_DISCONNECTED` or unknown-state event for the seat sets
`provider_state` and pauses every grant on that seat (section 7).

**Calendar.** Unchanged. The grant's `calendar_seat_id` is set at launch from the campaign
sheet.

### 3.3 Env

| Variable | Purpose |
|---|---|
| `LINKEDIN_VENDOR_API_URL`, `LINKEDIN_VENDOR_API_KEY` | Existing. Message send. |
| `LINKEDIN_VENDOR_CONNECT_URL` | New. Connection request send. Unset means connects are blocked `linkedin-connect-unconfigured`. |
| `LINKEDIN_VENDOR_SENDER_URL` | New. Attach or list senders (S0 decides whether it exists). |
| `LINKEDIN_INBOUND_WEBHOOK_SECRET` | Existing. |

## 4. Targeting

Inputs: the campaign shortlist as built by the sourcing chain (`SHORTLIST_FLOOR` 60,
`SHORTLIST_CAP` 20, LinkedIn URL present, not suppressed, not contacted in 90 days per
`outreach_ledger`).

Decision per person, made at launch and re-made when an event arrives:

| Situation | Action | Counts against |
|---|---|---|
| Not a connection (vendor reports degree 2 or 3, or unknown) | Connection request with a note under 200 characters, drafted from the campaign brief and the person's headline. | Connect cap |
| Vendor reports degree 1 | First message (existing `generateOutreach` LinkedIn draft, under 80 words). | Message cap |
| `CONNECTION_REQUEST_ACCEPTED` arrives | First message, scheduled 2 to 10 minutes out, never inside quiet hours. | Message cap |
| Reply arrives | Existing reply loop. | Message cap and grant `daily_cap` |
| Opt-out text | Existing suppression path. Cancel queued connects and messages for that person. | none |
| Connection request pending more than 14 days | Withdraw is not attempted (needs vendor support, S0). Person is marked `no-response`, nothing else sent. | none |

Ordering inside a day: highest match score first, then people whose connect was accepted
(warm), then new connects. When a cap is reached the rest wait for the next day, visible on
the campaign as "Waiting for tomorrow's limit".

Human gate: the launch tap. Agents never add a person to a launched list on their own.
Agents never send to someone whose draft was not shown at launch.

## 5. Cost

| Item | Cost | Confidence |
|---|---|---|
| LinkedIn first-party API | Not available at any price for this use. | verified (section 1.1) |
| Licensed delivery vendor, one sender | Category pricing is per LinkedIn sender per month. HeyReach lists per-sender plans; Unipile prices per connected account. Exact figures change; check the vendor page the day S0 runs. | assumed, verify in S0 |
| Tony's LinkedIn seat | Free or Premium account works for connects and messages to connections. InMail to non-connections needs Premium or Recruiter and is out of scope. LinkedIn's own weekly invite limit (around 100 a week for most accounts, and a monthly cap on personalised notes for free accounts) applies to the account regardless of Aria. | assumed from public LinkedIn help pages, verify |
| Model tokens | One compose per connect note, first message and reply. Under 2k tokens each on the server model. At 25 plus 25 plus replies per day this is well under one dollar a day on Sonnet class pricing. | assumed |
| Aria compute | Cron already drains. No new service. | verified |

Using Tony's own LinkedIn seat costs nothing extra on the LinkedIn side. The vendor fee is
the only new recurring spend. The non-monetary cost is the account risk in section 7.

## 6. Build DAG

Small slices, one commit each, each with fail-closed tests, in this order. Nothing here is
started in this plan's session.

```
S0 vendor probe (docs only) ─┐
                             ├─> S1 caps authority ──> S3 campaign grant scope ──> S5 connect primitive ──> S6 targeting ──> S7 live proof
S2 white-label guard ────────┘                                    │
                                                                  └─> S4 Connect LinkedIn card (needs S0 answer)
```

**S0 Vendor probe (docs only, one day).** For the shortlisted vendor, record in
`docs/outreach/vendor-probe.md`: can a sender be attached by API or hosted link, what a send
message call returns, whether a connection request call exists and what it returns, the
exact webhook payload for reply and accepted and restricted events (captured from a real
test account, pasted with PII removed), and the price that day. Every unknown stays
unknown. This is the input to S4 and S5.

**S1 Caps authority. First implementable slice.** Migration 0056 as in 3.2, TS constants
`LINKEDIN_DAILY_MESSAGE_CAP = 25` and `LINKEDIN_DAILY_CONNECT_CAP = 25` in
`src/lib/linkedin-loop.ts`, `decideLoopReply` takes `messagesToday` and holds with
`workspace-message-cap-reached`. Settings panel shows both limits and today's usage.
Tests in `tests/linkedin-caps.mts`:
- 25 messages sent today, one more reply is held, no row written.
- 24 sent, one more is scheduled; the 26th in the same second is held (claim serialises).
- Missing controls row means hold, never send.
- Cap day rolls in the workspace timezone, not UTC.
- SQL contract: both claim RPCs contain the workspace cap check; grant sub-cap still applies.
- The UI cannot submit a cap above 25 (schema max 25, server rejects 26).

**S2 White-label guard.** `tests/linkedin-white-label.mts` reads every file under
`src/components` and `src/app` plus `src/lib/sourcing/people-connect.ts` and
`src/lib/integrations.ts` and fails on any of: `HeyReach`, `heyreach`, `Unipile`,
`PhantomBuster`, `Dux-Soup`, `vendor campaign`, `Vendor API` inside a JSX string or
exported copy constant, and on any em dash in an exported copy constant or JSX text. The
adapter provider string `LinkedIn Vendor API` stays internal (it is a DB value), so the test
allows it in `src/lib/linkedin-channel.ts` and migrations only. The slice then sweeps the
files listed in 2.4 until the test passes. `tests/integrations-honesty.mts` lines 262, 401
to 429 and 641 assert the old HeyReach copy and are updated in the same slice.

**S3 Campaign grant scope.** `scope` column, launch RPC writes approval rows for the shown
drafts, Launch outreach sheet, Add to launch. Tests: a launch without drafts shown writes no
approvals; an edited draft after launch is not dispatchable; revoke pulls every first-touch
row back to draft; the 0054 trigger body stays byte-identical (existing hash test).

**S4 Connect LinkedIn card.** Card states from 2.1, `provider_sender_ref` and
`provider_state` columns, connect flow per S0. Tests: no vendor config means the card shows
"not enabled", never a fake connected state; `provider_state` other than `connected` blocks
every claim.

**S5 Connect primitive and accepted event.** Adapter `connect`, `linkedin_connect_attempts`,
`claim_linkedin_connect`, dispatcher, accepted event schedules first message. Tests: connect
without `LINKEDIN_VENDOR_CONNECT_URL` is blocked, never sent; no durable id is `ambiguous`;
accepted event for a person without a campaign grant is stored and held; jitter window
holds for connects too.

**S6 Targeting.** The table in section 4 as a pure function
`decideCampaignAction(person, vendorDegree, events, caps)` with exhaustive tests, then the
launch sheet uses it to draft connect note or first message per person.

**S7 Live proof.** Devon applies 0056 on Fly, Tony connects his own LinkedIn through the
card, one campaign of 3 people, caps set to 3 and 3, quiet hours set to now plus one hour
to prove the hold. Receipt with vendor ids, ledger rows and calendar event id. Only after
this is READY TO MERGE discussed.

## 7. Risks and fail-closed handling

| Risk | Handling |
|---|---|
| LinkedIn User Agreement prohibits third-party automation on the operator's account | Stated plainly to Tony in this plan and in the S4 card copy for admins ("Sending runs from your LinkedIn account and follows your account's limits"). Aria itself never touches linkedin.com. Caps at 25 and 25 sit far under LinkedIn's own published invite limits. Tony's decision, not the agent's. |
| Account restriction or checkpoint on the LinkedIn account | Vendor state event or a send failure with a restriction code sets `provider_state = 'restricted'`, revokes every grant on the seat, and every queued row becomes a visible draft. Card shows the paused state. No automatic reconnect. |
| Webhook payload shape unknown | S0 captures real payloads before S5. Parser stays tolerant and ignores anything without a LinkedIn profile URL and text. Unknown event types are stored for a person and never acted on. |
| Vendor accepts a send without a durable id | Existing `ambiguous` state, no retry without a person. Same for connects. |
| Vendor outage | Rows blocked `linkedin-provider-unconfigured` or `unknown` delivery state, visible, never counted as sent. |
| Double send after a crash between claim and vendor call | Existing `send_attempt_id` idempotency and the attempt ledger. Connect ledger uses the same discipline. |
| Cap counted in the wrong day | All counters in workspace timezone (learned in 71c6204 review). Tests in S1. |
| Vendor name leaks into the product | S2 test fails the build. |
| A person is messaged without a launch | Trigger needs an approval row; grant scope needs the draft shown at launch; `decideLoopReply` holds on `no-campaign-launch`. Three independent locks. |
| Harvest stamp-fail, never-0 chain, PR 54 | Out of scope. Not touched by any slice above. |

## 8. What this plan does not do

No native LinkedIn send, because it does not exist for Aria. No RSC as a send path. No
browser, cookies or scraping anywhere in Aria. No Path-B, no Fly, no Vercel, no merge. No
product code in this commit.
