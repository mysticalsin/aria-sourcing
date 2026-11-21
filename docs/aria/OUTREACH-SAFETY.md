# Outreach safety

Outreach is manual exact-text approval by default. An opt-in automatic mode can send only after the QC gate passes on that same text, and only inside the caps, the kill switch, the auto-pause rules, and the Odoo audit. Nothing in this page is a merged send path. The controls below are **in review** unless a row says **on `twa-odoo`**.

There is no LinkedIn scraping and no login automation in this design. The browser bridge that is still on `twa-odoo` is removed by the compliance change in review (#168).

## Approval ledger

The ledger answers one question: is this exact text allowed to be sent to this recipient on this channel right now? It does not deliver the message.

| Binding | What it covers | Status |
| --- | --- | --- |
| Wire hash | SHA-256 of the subject, a newline, and the body. The database claim already used this digest. | in review (#167) |
| Exact-body hash | The approver, the approval time, the channel, the recipient, the sanitized subject, the body, and the notice version, over NFC text. The send route, the dispatcher, the queued-claim function, and the active-approval check all read it. | in review (#167) |
| Rust hash | Length-prefixed SHA-256 of the channel, the recipient reference, the subject, the body, and the notice version (`aria-approval-v1`). The body is not trimmed or case-folded. | in review (#170) |
| Channel token | The Go adapters verify a single-use token. They do not export a mint function. The token binds channel, recipient, subject, body hash, unsubscribe URL, mode, QC pass, auto opt-in, sender, issue time, expiry, and a nonce. Expiry is at most 24 hours after issue. | in review (#175) |

Those three encodings are specified on three open branches. They are not yet one shared function. A send on the Go adapter path checks the channel token. A send on the console path in review checks the database hashes.

The in-memory ledger accepts `demo` and `test` runs and refuses live mode. The database approval row is the gate that path uses until a single ledger implementation is shared.

Approval state moves `draft` to `pending` to `approved` to `sent`. Any of those may become `invalidated`. Any other edge is refused.

A recorded approval expires. The in-memory default is 7 days. The channel token expires on its own timestamp, at most 24 hours after it was issued.

## Modes

| Mode | When a send is allowed | Status |
| --- | --- | --- |
| Manual | A person has approved this exact text. This is the default. An empty mode is manual. | in review (#167, #175). Human approval in front of email already exists on `twa-odoo`. |
| Automatic | The campaign and channel have opted in, and a QC pass is bound to the same text. The token or the ledger record has to say both. | in review (#167, #175, #185) |

Automatic mode is off until that opt-in is stored. A QC pass without the opt-in does not send. An opt-in without a QC pass does not send.

### QC

Two checkers are in review, and they are not wired together yet.

| Checker | Pass rule | Status |
| --- | --- | --- |
| Ledger stub | The stub says pass, the rubric is at least 80, and a deterministic generic-phrase detector does not flag the body. No model is called. | in review (#167) |
| Go QC gate | Seven reasons, in order: grounding, protected attributes, opt-out, length, placeholders, prohibited promises, language. A failed check forces `FAIL` even if the numeric score clears the threshold. The default threshold is `0.9` (`ARIA_QC_PASS_THRESHOLD`). All seven checks passing scores 1. | in review (#185) |

QC states are `Draft`, `QCPending`, `QCPassed`, and `QCFailed`. A pass returns to `Draft` when the text is edited. The package does not send, does not read the clock, and does not import the ledger.

The recorded click journey did not find a manual/automatic control on the outreach queue.

## Caps

A cap stops a sender or a channel even when the text was approved.

| Cap | Rule | Status |
| --- | --- | --- |
| Ledger channel cap | After the kill switch, the allowlist, and the hash check, the day's count for that channel is compared with the configured cap. A count at the cap is refused. | in review (#167) |
| Cap ownership | The daily cap is the configuration row. The caller does not pass the number. The count table is not readable by a workspace member. A missing count refuses the send. The cap is consumed only after the claim and the gate checks pass. | in review (#182), stacked on the ledger branch |
| Email sender cap | `ARIA_EMAIL_SENDER_DAILY_CAP` is a per-sender UTC-day cap. Unset, empty, or `0` refuses every send. A transport error releases the reserved slot. The nonce stays consumed. | in review (#175) |
| HeyReach sender caps | Per-sender daily and weekly caps, plus a minimum gap. The slot is reserved before the request and released if the transport fails. | in review (#175) |
| LinkedIn token cap | `ARIA_LINKEDIN_TOKEN_DAILY_CAP` defaults to 40. `ARIA_LINKEDIN_TOKEN_MIN_GAP_MS` defaults to 90 seconds. | in review (#178) |

The recorded stress run held a cap of 50: exactly 50 of 500 attempts were accepted, on both the database function and the email adapter.

An unset recipient allowlist allows nobody. An unset sender allowlist allows nobody. The allowlist is applied to the address the transport will actually use.

## Kill switch

The kill switch is read on the send that is about to run.

| Switch | Effect | Status |
| --- | --- | --- |
| Ledger flag | A set kill switch refuses before the allowlist and the cap. | in review (#167) |
| `ARIA_SEND_KILL_SWITCH` | Stops every Go channel adapter. A missing variable leaves the switch off. Any set value other than `0`, `false`, or `off` engages it, including an empty string. | in review (#175) |
| `ARIA_HEYREACH_KILL_SWITCH` | Stops HeyReach as well. Same fail-closed reading. | in review (#175) |
| Token-channel switch | An owner or admin can engage a per-workspace kill. The environment kill is also read. | in review (#178) |

A send that has already passed the check can finish. Later sends see the switch. The recorded stress run confirmed that a restarted process with the switch set still refuses.

The click journey did not show the switch to a member session. The token channel answers that page only to an owner or an admin.

## Auto-pause

| Channel | What pauses the sender | Status |
| --- | --- | --- |
| HeyReach | An account warning pauses that sender until the pause store is cleared. Delivery failures in a rolling window also pause. The default window is 3 failures in 3600 seconds, and the default pause is 3600 seconds. | in review (#175) |
| LinkedIn token | A throttle, a challenge, a session problem, or a warning pauses the workspace channel. Turning the channel off purges the token and cancels outstanding sends. | in review (#178) |

The HeyReach pause store records pause and paused state. A human resume action is not implemented. The recorded stress run left the sender paused. That gap is open.

## Odoo audit

| Event | Record | Status |
| --- | --- | --- |
| Send attempt | A chatter note is written before the transport. If the note fails, nothing is sent. If the note after a successful send fails, the token is already consumed and must not be retried. | in review (#175) |
| Stage attempt | Every Hired attempt, allowed or refused, writes `aria.recruitment.transition.audit` and a chatter note. The audit row cannot be edited or deleted. A refused attempt is also copied on a separate cursor so a rolled-back business transaction still keeps the record. | in review (#176) |

## Channel flags

| Channel | Default | How it turns on | Status |
| --- | --- | --- | --- |
| Fake sink | Tests only | The harness injects an in-memory mail port or a loopback handler. No provider is called. | in review (#175, #208) |
| Email | Adapter present, cap closed | A positive sender cap, an allowlisted recipient and sender, and an exact-text token. The unsubscribe URL is `https` and its host equals `ARIA_UNSUBSCRIBE_HOST`. | in review (#175). An email send route already exists on `twa-odoo`. |
| HeyReach | Off | `ARIA_HEYREACH_ENABLED` must be `1`, `true`, or `on`. The base URL must be the vendor's official API host. The adapter does not open a direct LinkedIn client, does not call a private messaging endpoint, does not read a session, and does not scrape. | in review (#175) |
| LinkedIn token | Off | An owner or admin records the risk notice, then the channel may store a token. No environment variable turns the flag on. The token is typed at runtime, encrypted at rest, revocable, and scrubbed from logs. The notice states that the vendor agreement prohibits third-party session-token tools and that the account may be restricted. | in review (#178) |

HeyReach and the LinkedIn token channel are separate optional paths. Either one still requires the exact-text approval, the caps, the kill switch, and auto-pause. The ledger branch refuses LinkedIn delivery, including the token channel, on its own tree. The token implementation lives on #178. They meet on the integration test branch (#208), which stays unmerged.

The compliance removal (#168) allows a single directory for the token channel and refuses every other LinkedIn delivery path, including an unflagged vendor route.

## What a send refuses

A send is refused when any of these is true:

- The kill switch is engaged.
- The channel flag is off.
- The recipient or the sender is not allowlisted.
- The approval does not match the exact text, was already used, or has expired.
- The mode is automatic and the same record does not show both the opt-in and a QC pass.
- The daily, weekly, or pacing cap is exhausted.
- The sender is paused.
- The audit note cannot be written.
- The channel is a LinkedIn path and the branch under test is the one that refuses LinkedIn delivery outright.
