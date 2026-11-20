# Outreach channels

`services/channels` is a nested Go module (`github.com/mysticalsin/aria-sourcing/services/channels`). It is the delivery boundary for outreach. It does not decide that a person approved a message. It freezes the exact text, then refuses to send unless an approval token for that text is still valid.

The Rust ledger will mint that token once it lands. `IssueToken` is the reference encoder so the ledger and this module can share one byte layout. `Send` only verifies.

```bash
cd services/channels
go test -race ./...
go vet ./...
go test -bench=. -benchtime=20ms -run '^$' ./...
```

Tests use synthetic addresses, an in-memory SMTP fake, and an `httptest` HeyReach server. They do not read environment secrets and they do not call a real provider.

## Send path

`Prepare` returns the exact text and its body hash. `Send` then checks, in order:

1. Kill switch. `ARIA_SEND_KILL_SWITCH` stops every channel. `ARIA_HEYREACH_KILL_SWITCH` also stops HeyReach. A missing variable does not engage the switch. Any set value other than `0`, `false`, or `off` (trimmed, case-insensitive) engages it, including an empty string.
2. HeyReach enable flag. `ARIA_HEYREACH_ENABLED` defaults off. Only `1`, `true`, or `on` turns it on.
3. Recipient allowlist (`ARIA_RECIPIENT_ALLOWLIST`) applied to `DeliverTo`, the value the transport actually receives. An unset or empty list allows nobody. An allowlisted substitute target still needs a token bound to that same target.
4. Approval token. See the byte layout below. Expired tokens are refused (`now < expiry`).
5. Mode. Empty or `manual` is the default. `auto` sends only when that campaign has `AutoOptIn` and `QCPass` set. The flags are inputs the ledger will own; this module refuses automatic mode when either is missing.
6. Sender caps and, for HeyReach, pacing and account pause.
7. An audit note, before the transport is called. If the note cannot be recorded, nothing is sent.

## Token layout

UTF-8. Each field is an 8-byte big-endian length followed by its bytes.

- Body hash: lowercase hex SHA-256 of the length-prefixed body.
- Binding hash: lowercase hex SHA-256 of the length-prefixed channel, recipient, subject, and body hash.
- Token material: length-prefixed channel, recipient, subject, body hash, and expiry as decimal Unix seconds.
- Token: `v1.` + base64url(material) + `.` + base64url(HMAC-SHA256(key, material)), without padding.

Channel is trimmed and lowercased. A recipient that contains `@` is trimmed and lowercased; any other recipient keeps its case. Subject is trimmed and rejected when it contains control characters. The shared key is at least 16 bytes. This module does not store or log it.

## Email

The email adapter talks to SMTP only through the `SMTP` interface. `Prepare` appends the caller-supplied lawful-basis text, a fixed GDPR Article 14 / LGPD transparency sentence, and an unsubscribe URL. `Send` refuses a body that does not still contain those, and it sets `List-Unsubscribe` from the same URL. The URL must be `https`, or `http` on a loopback host.

`ARIA_EMAIL_SENDER_DAILY_CAP` is a per-sender UTC-day cap. Unset, empty, or `0` refuses every send. A transport error does not consume the cap. Counts are in memory and reset when the process restarts.

## HeyReach

HeyReach uses the public inbox call `POST {HEYREACH_BASE_URL}/api/public/inbox/SendMessage` with the `X-API-KEY` header (`HEYREACH_API_KEY`). The base URL must be `https`, or `http` on a loopback host. Redirects are not followed. There is no other network client in this module.

| Variable | Behavior |
|---|---|
| `ARIA_HEYREACH_ENABLED` | Off unless set to `1`, `true`, or `on` |
| `ARIA_HEYREACH_KILL_SWITCH` | Same fail-closed rule as the global switch |
| `ARIA_HEYREACH_SENDER_DAILY_CAP` | Per sender, UTC day. Unset or `0` refuses |
| `ARIA_HEYREACH_SENDER_WEEKLY_CAP` | Per sender, ISO week (Monday, UTC). Unset or `0` refuses |
| `ARIA_HEYREACH_MIN_GAP_SECONDS` | Minimum gap between successful sends for one sender. Unset refuses. `0` means no extra gap |

A response with `accountWarning: true`, code `account_warning` or `sender_restricted`, or an error message that says the account is warned or restricted, pauses that sender and that sender account. A later send for either id does not call the API. A plain `403` does not pause. Caps and pauses are in memory.

Every attempt asks the `Auditor` to record one `mail.message` shaped note: `model`, `res_id`, `message_type=notification`, `subtype_xmlid=mail.mt_note`, `subject`, HTML `body`, `date`, `email_from`, `record_name`, and `is_internal=true`. The adapter does not call Odoo.

## What this module does not do

It does not open a session on any other site, and the package is tested to contain none of the usual session-client markers (`linkedin.com`, `voyager`, `li_at`, cookie, `jsessionid`, `sessiontoken`). The HeyReach JSON field `linkedInAccountId` is the public API's sender-account id, not a browser session.

The approval token's authenticity is only as strong as the shared key. Replay across processes, durable caps, and the human or QC decision that mints the token belong to the Rust ledger.
