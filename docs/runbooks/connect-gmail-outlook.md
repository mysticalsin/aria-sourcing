# Connect Gmail and Outlook mailboxes

The integration is **already built**. Authorize routes, callbacks, token refresh, encrypted
token storage and both send adapters exist. What is missing is credentials: you register one
OAuth app with Google and one with Microsoft, paste six values, and connect a seat.

Verified working on 2026-07-25 with placeholder credentials — both authorize routes return a
correctly-formed 307 with the right scopes, PKCE, and HttpOnly state cookies. The only thing that
cannot be tested without real credentials is Google/Microsoft recognising the client id.

## What already exists

| Piece | Where |
|---|---|
| Google authorize / callback | `src/app/auth/google/route.ts`, `src/app/auth/google/callback/route.ts` |
| Microsoft authorize / callback | `src/app/auth/microsoft/route.ts`, `src/app/auth/microsoft/callback/route.ts` |
| Send adapters | `sendViaGmailApi`, `sendViaMicrosoftGraph` in `src/lib/email-oauth.ts` |
| Token refresh | `getAccessTokenForReading` in the same file |
| Token store | `public.email_connections` — `access_token`, `refresh_token`, `expires_at`, `scope`, unique on `(workspace_id, seat_id)` |
| Disconnect | `src/app/api/email/disconnect/route.ts` |

Security properties already in place, confirmed by reading the code: a random nonce echoed in
`state` and bound to an HttpOnly `SameSite=lax` cookie, a PKCE verifier cookie, both expiring in
600 s; tokens encrypted at rest with `encryptSecret`; and the callback refuses to proceed in
production when `DATA_ENCRYPTION_KEY` is absent.

## Step 1 — set the encryption key FIRST

```
openssl rand -base64 32
```

Put it in `.env.local` (and the production secret store) as `DATA_ENCRYPTION_KEY`.

**Do this before connecting any mailbox.** `encryptSecret` falls back to storing plaintext when no
key is configured, and `encryptionRequiredButMissing()` only hard-fails in production. Connect a
mailbox in dev without the key and you have refresh tokens sitting in the database in the clear.

## Step 2 — Google

1. Google Cloud Console → create or pick a project.
2. **APIs & Services → Library** → enable **Gmail API** (and **Google Calendar API** — the flow
   requests `calendar.events`).
3. **OAuth consent screen** → External (or Internal if you are on Workspace and only connecting
   `@mantu`/`@amaris` mailboxes — Internal avoids the verification problem in Step 5).
4. **Credentials → Create credentials → OAuth client ID → Web application.**
5. Authorised redirect URIs — add exactly:
   - `http://localhost:3100/auth/google/callback` (local; match whatever port you run)
   - `https://<your-production-host>/auth/google/callback`
6. Copy the client ID and secret.

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_REDIRECT_URI=http://localhost:3100/auth/google/callback
```

## Step 3 — Microsoft

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
2. Supported account types: multi-tenant if you will connect mailboxes outside your tenant —
   the code targets the `/common/` endpoint, which expects that.
3. **Redirect URI** → Web → exactly:
   - `http://localhost:3100/auth/microsoft/callback`
   - `https://<your-production-host>/auth/microsoft/callback`
4. **Certificates & secrets → New client secret.**
5. **API permissions → Microsoft Graph → Delegated**: `Mail.Send`, `Mail.Read`,
   `Calendars.ReadWrite`, `User.Read`, `offline_access`. If your tenant requires it, click
   **Grant admin consent**.

```
MICROSOFT_CLIENT_ID=<application (client) id>
MICROSOFT_CLIENT_SECRET=<client secret value, not the secret id>
MICROSOFT_REDIRECT_URI=http://localhost:3100/auth/microsoft/callback
```

## Step 4 — connect a seat

Each connection binds to one seat in `public.agent_seats` (`email_connections` is unique on
`workspace_id, seat_id`). Create the seat, then visit, signed in as a workspace member:

```
/auth/google?seat_id=<seat uuid>
/auth/microsoft?seat_id=<seat uuid>
```

`seat_id` is required — the authorize route rejects the request without it. On success the callback
upserts `email_connections` and writes the mailbox address onto the seat's `connected_account`.

Verify:

```sql
select provider, account_email, scope, expires_at is not null as has_expiry,
       refresh_token is not null as has_refresh
from public.email_connections;

select name, provider, connected_account, domain_verified, mode from public.agent_seats;
```

`has_refresh` must be true, or sending stops working when the access token expires. Google only
returns a refresh token because the flow sends `access_type=offline` and `prompt=consent`.

## Step 5 — the constraint that will actually bite you

`gmail.send` and `gmail.readonly` are **Google restricted scopes.** An unverified app is limited to
a small number of explicitly-added test users and shows an "unverified app" interstitial. Shipping
this to customers on External consent requires Google's OAuth verification **plus a CASA security
assessment**, which takes weeks and is repeated annually.

Two ways around it, and this is an owner decision:

- **Internal consent screen** — if every mailbox you connect belongs to your own Workspace tenant,
  set the consent screen to Internal. No verification, no interstitial. This is the right answer
  for connecting your own recruiters' mailboxes.
- **Drop `gmail.readonly`** — if you only need to *send* and are willing to lose Gmail-side reply
  reading, the scope set shrinks. `gmail.send` is still restricted, so this reduces review surface
  rather than eliminating it. Reply correlation would then have to come from the existing inbound
  path (`0040`) instead.

Microsoft has no equivalent verification gate for delegated Graph scopes, but a tenant admin may
still need to grant consent for `Mail.Send`.

## Step 6 — sending actually live

Connecting a mailbox is not sufficient. `POST /api/outreach/send` still requires all of:

- `confirmLive: true` in the request — anything else returns `dry-run` and delivers nothing;
- a seat whose `domain_verified` is true — and that flag is only ever set by the verification path,
  not by hand;
- the From address is taken **from the seat**, never from the request body.

Those are deliberate. Do not work around them to get a test send out; connect a mailbox you own and
send to yourself.

## The UI already exists

`src/components/fleet/seat-card.tsx` is the entry point. It picks the route from the seat's own
provider — `/auth/google` for `Gmail API`, `/auth/microsoft` for anything else (`:166`) — renders
`connectedAccount` or "Not connected" (`:237-251`), and has a disconnect control wired to
`actions.disconnectSeatAccount` (`:171`). So the flow is: create a seat, set its provider to
**Gmail API** or **Microsoft Graph**, then use Connect on the seat card in the Fleet view.

The direct URLs in Step 4 are the same thing without the UI, useful for scripted checks.
