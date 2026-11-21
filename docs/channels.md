# Outreach channels

`services/channels` is a nested Go module (`github.com/mysticalsin/aria-sourcing/services/channels`). It is the delivery boundary for outreach. It does not decide that a person approved a message. It freezes the exact text, then refuses to send unless a single-use approval token for that text is still valid.

The Rust ledger mints the token. This module does not export a mint function. `issueToken` is the unexported reference encoder for tests and for the ledger's byte layout. `Send` only verifies.

HeyReach reaches LinkedIn. It delivers a LinkedIn message for a connected account through HeyReach's official public API (`POST https://api.heyreach.io/api/public/inbox/SendMessage`). Tony approved that path as a flag-off channel with the safeguards below. The adapter is off unless `ARIA_HEYREACH_ENABLED` is `1`, `true`, or `on`. It does not open a direct LinkedIn client, call a private messaging endpoint, read a session, or scrape.

```bash
cd services/channels
go test -race ./...
go vet ./...
go test -bench=. -benchtime=20ms -run '^$' ./...
```

CI runs `go vet` and `go test -race` in the Channel adapters job. Tests use synthetic addresses, an in-memory SMTP fake, and a loopback server created by `newHeyReachForTest`. They do not read real secrets and they do not call HeyReach.

## HeyReach controls

| Control | Where | Test |
|---|---|---|
| Off by default (`ARIA_HEYREACH_ENABLED`) | `heyreachEnabled` in `policy.go` | `TestHeyReachDisabledByDefault` |
| Official API host only (`HEYREACH_BASE_URL` must be `https://api.heyreach.io`; no direct LinkedIn client) | `NewHeyReach` in `types.go`, `validateOfficialHeyReachBase` in `heyreach.go` | `TestHeyReachRejectsNonOfficialHostAtConstruction`, `TestHeyReachSendUsesPublicInboxAPI`, `TestSourceHasNoDirectLinkedInClient` |
| Exact-text approval token required | `verifyToken` in `token.go`, called from `HeyReach.Send` | `TestEmailSendRefusesTokenOverDraftInsteadOfExactText`, `TestIssueTokenMatchesReferenceMAC` |
| Per-sender daily and weekly caps | `HeyReach.Send` cap reads, `senderLimits.reserve` in `limits.go` | `TestHeyReachCapsAndPacing`, `TestHeyReachWeeklyCapResetsOnTheNextISOWeek` |
| Minimum pacing gap | `senderLimits.reserve` claims the gap before the request | `TestHeyReachCapsAndPacing`, `TestPacingReservationIsAtomic` |
| Kill switch, fail-closed, read on every Send | `killSwitchEngaged` in `policy.go` via the `LiveEnv` on the adapter | `TestKillSwitchIsReadLiveOnEachSend`, `TestHeyReachKillSwitchIsIndependentAndFailClosed` |
| Auto-pause on account warnings, plus an error-rate pause | `accountWarning`, `HeyReach.noteFailure`, `HeyReach.paused` in `heyreach.go`; `PauseStore` in `store.go` | `TestHeyReachAutoPausesOnAccountWarning`, `TestHeyReachErrorRatePauseIsPersistent` |
| Odoo chatter audit on every attempt | `postChatter` in `audit.go` | `TestHeyReachSendUsesPublicInboxAPI`, `TestEmailSendDeliversExactBodyAndChatter` |

`newHeyReachForTest` is the only constructor that accepts a non-official base URL, and only for a loopback host. Another module cannot name it.

## Send path

`Prepare` returns the exact text and its body hash. `Send` then checks, in order:

1. Kill switch, read from the injected `LiveEnv` on that call. `ARIA_SEND_KILL_SWITCH` stops every channel. `ARIA_HEYREACH_KILL_SWITCH` also stops HeyReach. A missing variable does not engage the switch. Any set value other than `0`, `false`, or `off` (trimmed, case-insensitive) engages it, including an empty string.
2. HeyReach enable flag. Off unless set to `1`, `true`, or `on`.
3. Recipient allowlist (`ARIA_RECIPIENT_ALLOWLIST`) on `DeliverTo`, the value the transport actually receives. An unset list allows nobody.
4. Sender allowlist (`ARIA_SENDER_ALLOWLIST`) on the From address or the HeyReach sender account id. An unset list allows nobody.
5. Approval token. The token binds channel, recipient, subject, body hash, List-Unsubscribe URL, mode, QC pass, auto opt-in, From, sender account id, issue time, expiry, and a nonce. It is single-use through a `ConsumedStore`.
6. Mode. Empty or `manual` is the default. `auto` sends only when that same token says the campaign opted in and QC passed.
7. Sender caps and, for HeyReach, the pacing slot. Both are reserved under one lock before the transport runs and released if the transport fails.
8. HeyReach pause store. An account warning pauses that sender until the store is cleared. Delivery failures are counted in a rolling window (`ARIA_HEYREACH_ERROR_THRESHOLD`, default 3; `ARIA_HEYREACH_ERROR_WINDOW_SECONDS`, default 3600) and pause for `ARIA_HEYREACH_ERROR_PAUSE_SECONDS` (default 3600).
9. An audit note before the transport. If that note fails, nothing is sent. If the note after a successful send fails, `Send` returns `ErrSentAuditFailed`. Callers must not retry that token. The nonce is already consumed, so a retry cannot send it again.

## Token layout

UTF-8. Each field is an 8-byte big-endian length followed by its bytes.

- Body hash: lowercase hex SHA-256 of the length-prefixed body.
- Binding hash: lowercase hex SHA-256 of the length-prefixed channel, recipient, subject, and body hash.
- Token material, in order: channel, recipient, subject, body hash, unsubscribe URL, mode (`manual` or `auto`), QC pass (`1` or `0`), auto opt-in (`1` or `0`), From, sender account id (decimal), issue time (decimal Unix seconds), expiry (decimal Unix seconds), nonce.
- Token: `v1.` + base64url(material) + `.` + base64url(HMAC-SHA256(key, material)), without padding.

A token's expiry must be after its issue time and at most 24 hours later (`MaxTokenLifetime`). Verification allows `ClockSkew` (2 minutes) of peer-clock disagreement. Channel is trimmed and lowercased. A recipient or From that contains `@` is trimmed and lowercased. Subject is trimmed and rejected when it contains control characters. The shared key is at least 16 bytes. This module does not store or log it.

`ConsumedStore` is the single-use ledger. `MemoryConsumedStore` is the in-process implementation. A database or the Rust ledger can implement the same interface.

## Email

The email adapter talks to SMTP only through the `SMTP` interface. `Prepare` appends the caller-supplied lawful-basis text, a fixed GDPR Article 14 / LGPD transparency sentence, and an unsubscribe URL. The URL must be `https` and its host must equal `ARIA_UNSUBSCRIBE_HOST`. `Send` sets `List-Unsubscribe` from that same URL, and the token binds it.

`ARIA_EMAIL_SENDER_DAILY_CAP` is a per-sender UTC-day cap. Unset, empty, or `0` refuses every send. A transport error releases the reserved slot. The nonce stays consumed.

## HeyReach

Production construction (`NewHeyReach`) accepts only `https://api.heyreach.io` with no userinfo, port, query, or extra path. The API key is sent only to that host. Redirects are not followed.

| Variable | Behavior |
|---|---|
| `ARIA_HEYREACH_ENABLED` | Off unless set to `1`, `true`, or `on` |
| `ARIA_HEYREACH_KILL_SWITCH` | Same fail-closed rule as the global switch, read on every Send |
| `ARIA_HEYREACH_SENDER_DAILY_CAP` | Per sender, UTC day. Unset or `0` refuses |
| `ARIA_HEYREACH_SENDER_WEEKLY_CAP` | Per sender, ISO week (Monday, UTC). Unset or `0` refuses |
| `ARIA_HEYREACH_MIN_GAP_SECONDS` | Minimum gap between reserved sends for one sender. Unset refuses. `0` means no extra gap |
| `ARIA_HEYREACH_ERROR_THRESHOLD` | Failures inside the window that pause the sender. Default 3 |
| `ARIA_HEYREACH_ERROR_WINDOW_SECONDS` | Rolling window for that count. Default 3600 |
| `ARIA_HEYREACH_ERROR_PAUSE_SECONDS` | How long an error-rate pause lasts. Default 3600 |

`PauseStore` holds pauses. `MemoryPauseStore` is the in-process implementation. An Odoo or database store can implement the same interface. An account-warning pause has no expiry in the store. A plain `403` does not pause.

Every attempt asks the `Auditor` to record one `mail.message` shaped note: `model`, `res_id`, `message_type=notification`, `subtype_xmlid=mail.mt_note`, `subject`, HTML `body`, `date`, `email_from`, `record_name`, and `is_internal=true`. The adapter does not call Odoo. The note includes the recipient.

## Known limits

- Caps and the in-memory pause and nonce stores reset when the process restarts. Bounces are not ingested. Durable caps need a store this module does not ship yet. `PauseStore` and `ConsumedStore` are the extension points.
- The audit note stores the recipient. Treat chatter notes as personal data. The HeyReach API key is not sent to an operator-chosen host: `NewHeyReach` allows only `api.heyreach.io`.
