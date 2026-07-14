# Google OAuth Setup - Gmail Mailbox Seats

**Purpose:** configure the real Gmail OAuth path used by `/auth/google` and
`/auth/google/callback` so an admin can connect a Gmail API seat without
weakening ARIA's approval, dry-run, and demo-side-effects controls.

Do not commit real client secrets. Set them only in `.env.local` for local
testing or in the production host's secret store.

## 1. Create the Google Cloud OAuth client

1. Open https://console.cloud.google.com.
2. Select the Google Cloud project that owns the Gmail integration.
3. Go to **APIs & Services**.
4. Open **Credentials**.
5. Click **Create credentials**.
6. Choose **OAuth client ID**.
7. For **Application type**, choose **Web application**.
8. Name it clearly, for example `ARIA Gmail mailbox OAuth`.

If Google prompts you to configure the consent screen first, complete section 3
below, then return to **Credentials** and create the OAuth client.

## 2. Enable APIs and requested scopes

Enable the Gmail API for the project before testing the flow:

1. Go to **APIs & Services**.
2. Open **Library**.
3. Search for **Gmail API**.
4. Click **Enable**.

ARIA requests these delegated scopes in `src/app/auth/google/route.ts`:

| Scope | Why ARIA requests it |
|---|---|
| `https://www.googleapis.com/auth/gmail.send` | Send approved outreach from the connected Gmail mailbox. |
| `https://www.googleapis.com/auth/gmail.readonly` | Read mailbox metadata/replies for sync and reply handling. |
| `https://www.googleapis.com/auth/calendar.events` | Create calendar events from approved scheduling flows. |

Do not add broader scopes unless the route and storage model are changed and
reviewed together.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services**.
2. Open **OAuth consent screen**.
3. Choose the user type that matches the deployment:
   - **Internal** for a Google Workspace-only tenant.
   - **External** when users may come from outside the tenant.
4. Add the application name, support email, developer contact email, and app
   domain details.
5. Add the exact scopes listed in section 2.
6. While the app is in testing mode, add every pilot mailbox under **Test users**.

Testing mode works for named test users only. A wider external rollout with
sensitive Gmail scopes may require Google verification before non-test users can
complete consent.

## 4. Add authorized redirect URIs

In the OAuth client, add every callback URL ARIA may use. The value must match
`GOOGLE_REDIRECT_URI` exactly, including scheme, host, port, and path.

Local development:

```text
http://localhost:3003/auth/google/callback
http://localhost:3000/auth/google/callback
```

Production:

```text
https://<domain>/auth/google/callback
```

Use the deployed app domain for `<domain>`, for example the Vercel production
domain or the customer-owned domain. Do not use a preview URL for the production
environment unless that preview URL is intentionally the OAuth test target.

## 5. Set ARIA environment variables

Local `.env.local`:

```bash
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:3003/auth/google/callback
```

If your local Next.js server is on port 3000, use:

```bash
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Production:

```bash
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=https://<domain>/auth/google/callback
```

Set production values in the host secret store, for example Vercel project
environment variables. Do not commit `.env.local` or copied production secrets.

## 6. Local smoke test

1. Start the app on the same port used by `GOOGLE_REDIRECT_URI`.
2. Sign in as an admin.
3. Open a fleet seat connect action that sends the browser to
   `/auth/google?seat_id=<agent_seat_id>`.
4. Confirm the browser is redirected to `https://accounts.google.com`.
5. Complete consent with a test user.
6. Confirm callback returns to Settings > Fleet and the seat shows the connected
   account.

The start route intentionally runs `requireAdmin()` before checking Google env
configuration. The public-demo side-effects guard must remain enabled for public
synthetic demos, and must stay disabled only for real tenant/local testing.

## Microsoft / Entra equivalent

For Outlook/Exchange seats, use the Microsoft path instead:

- Start route: `/auth/microsoft`
- Callback route: `/auth/microsoft/callback`
- Env vars: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
  `MICROSOFT_REDIRECT_URI`
- App registration: Azure Portal > Microsoft Entra ID > App registrations

The Microsoft redirect URI has the same shape:

```text
https://<domain>/auth/microsoft/callback
```
