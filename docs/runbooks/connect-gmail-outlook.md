# Connect Gmail and Outlook mailboxes

Authorize routes, callbacks, encrypted token storage, send adapters, Settings
connect hub, and inbound route upsert are built. You still need OAuth app
credentials (and `DATA_ENCRYPTION_KEY`) in the environment.

Verified: authorize routes return a correctly-formed 307 with the right scopes,
PKCE, and HttpOnly state cookies. Live Google/Microsoft recognition needs real
client IDs.

## What already exists

| Piece | Where |
|---|---|
| Google authorize / callback | `src/app/auth/google/route.ts`, `…/callback/route.ts` |
| Microsoft authorize / callback | `src/app/auth/microsoft/route.ts`, `…/callback/route.ts` |
| Settings connect hub | `src/components/settings/email-connections-panel.tsx` → Settings → Integrations |
| List / ensure / register inbound | `GET|POST /api/email/connections` |
| Validate mailbox | `POST /api/email/test` (token refresh + profile + inbound route) |
| Send adapters | `sendViaGmailApi`, `sendViaMicrosoftGraph` in `src/lib/email-oauth.ts` |
| Token refresh | `getAccessTokenForReading` |
| Token store | `public.email_connections` — unique on `(workspace_id, seat_id)` |
| Inbound route upsert | `upsert_inbound_mailbox_route` (migration 0057) — OAuth callback + Settings |
| Disconnect | `POST /api/email/disconnect` (+ deactivate inbound route) |

Security already in place: OAuth `state` nonce + PKCE verifier cookies (600 s),
tokens encrypted at rest, production refuses connect when `DATA_ENCRYPTION_KEY`
is absent.

## Step 1 — set the encryption key FIRST

```
openssl rand -base64 32
```

Put it in `.env.local` (and production) as `DATA_ENCRYPTION_KEY` **before** any
mailbox connect.

## Step 2 — Google

1. Google Cloud Console → project → enable **Gmail API** (+ **Calendar API**).
2. OAuth consent screen (Internal for own Workspace mailboxes avoids verification).
3. OAuth client → Web → redirect URIs:
   - `http://localhost:3100/auth/google/callback`
   - `https://<production-host>/auth/google/callback`
4. Env:

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_REDIRECT_URI=http://localhost:3100/auth/google/callback
```

## Step 3 — Microsoft

1. Entra ID → App registration (multi-tenant if using `/common/`).
2. Redirect URIs for `/auth/microsoft/callback` (local + prod).
3. Client secret; Graph delegated: `Mail.Send`, `Mail.Read`, `Calendars.ReadWrite`,
   `User.Read`, `offline_access` (+ admin consent if required).
4. Env:

```
MICROSOFT_CLIENT_ID=<application (client) id>
MICROSOFT_CLIENT_SECRET=<secret value>
MICROSOFT_REDIRECT_URI=http://localhost:3100/auth/microsoft/callback
```

## Step 4 — connect in Aria (preferred)

1. Sign in as workspace **admin**.
2. **Settings → Integrations** → **Connect Gmail** or **Connect Outlook**.
3. Aria ensures a fleet seat, starts OAuth, stores tokens, registers
   `inbound_mailbox_routes` (purpose `reply`), and returns you to Integrations.
4. Click **Validate** on the connection (or Test on the Gmail / Outlook cards).

Direct URLs (same as Fleet seat card):

```
/auth/google?seat_id=<seat uuid>
/auth/microsoft?seat_id=<seat uuid>
```

## Step 5 — Google restricted scopes

`gmail.send` / `gmail.readonly` are restricted. Prefer **Internal** consent for
your own Workspace, or accept Google verification + CASA for External.

## Step 6 — sending live

`POST /api/outreach/send` still needs `confirmLive: true`, a seat with
`domain_verified`, and From from the seat — not the request body.

## More providers

| Provider | How |
|---|---|
| SendGrid / Resend | API keys (`SENDGRID_API_KEY` / `RESEND_API_KEY`) — not OAuth; seat provider SendGrid/Resend |
| MCP tools | Settings → AI & Models → MCP → Test (`POST /api/mcp/test`) |
| Inbound replies | `EMAIL_INBOUND_WEBHOOK_SECRET` + route (auto on OAuth) → `docs/INBOUND_REPLY_AUTOPILOT.md` |

## Verify SQL

```sql
select provider, account_email, expires_at is not null as has_expiry,
       refresh_token is not null as has_refresh
from public.email_connections;

select mailbox_address, purpose, active, connection_id
from public.inbound_mailbox_routes;
```
