# LinkedIn bridge (experimental)

Read your LinkedIn inbox in ARIA and send LinkedIn messages as yourself from
ARIA. Off unless `LINKEDIN_BRIDGE_ENABLED=true`. Owner request, 2026-11-06,
on `mbe-branch`, for a local Docker test.

> LinkedIn's User Agreement forbids bots, browser add-ons and other automated
> means of accessing LinkedIn or sending messages. This bridge uses that private
> API ("Voyager") from your own browser. LinkedIn can restrict or close the
> account that uses it. The account owner accepted that risk; do not enable it
> for anyone who has not.

## How it works

```
ARIA (/linkedin page, API, Postgres)          Chrome on your machine
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│ outbox  conversations  messages  │  poll    │ ARIA LinkedIn Bridge extension   │
│ planner: what to do next         │◄─────────│  every minute:                   │
│ parsers: LinkedIn JSON -> rows   │  tasks   │  1. POST /api/linkedin/bridge/poll│
│                                  │─────────►│  2. check each task (allowlist)  │
│                                  │  result  │  3. fetch() inside a             │
│                                  │◄─────────│     www.linkedin.com tab         │
└──────────────────────────────────┘          │  4. POST the raw answer back     │
                                              └──────────────────────────────────┘
```

- **ARIA is the brain, the extension is a hand.** ARIA builds every LinkedIn
  request (`src/lib/linkedin-bridge/voyager.ts`) and parses every answer
  (`parse.ts`). When LinkedIn changes a format, the fix ships with ARIA; the
  extension does not need an update.
- **The extension only runs four kinds of request**
  (`extensions/linkedin-bridge/allowlist.js`): who am I, list conversations,
  read a conversation, look up a profile by its public id, send a message. A
  leaked pairing token cannot make it do anything else.
- **No LinkedIn credential leaves the browser.** The extension reads the
  session cookies only to tell ARIA "a session exists" and to set the CSRF
  header of LinkedIn's own requests. ARIA stores the SHA-256 of its pairing
  token, the synced conversations and the outbox
  (`supabase/migrations/0006_linkedin_bridge.sql`).
- **Requests come from your real browser**: same IP, same browser, same
  session as when you use LinkedIn by hand, sent as same-origin requests from
  a `www.linkedin.com` tab. No proxy, no headless browser, no fingerprint
  tricks, no randomised "human" delays (owner decision 2026-11-03: no
  bot-detection evasion).
- **A message leaves only when you click Send.** Nothing else can write to the
  outbox: no agent, no sequence, no API key (`tests/linkedin-bridge.mts`
  checks it). Sends are paced: 40 per rolling 24 h and 90 s between two sends
  by default (`LINKEDIN_BRIDGE_DAILY_SEND_CAP`,
  `LINKEDIN_BRIDGE_MIN_SEND_INTERVAL_SECONDS`).
- **Each user sees only their own inbox.** Rows hang off one
  (workspace, user) pairing; there is no workspace-wide view.

### Sync cycle

Every minute the extension polls. ARIA answers with tasks, in this order:

1. `identity` when the LinkedIn member is unknown or older than 12 h.
2. `send` (or `resolveProfile` first, for a new chat started from a profile
   URL) when a message waits and pacing allows. The outbox row is claimed
   before the task is handed out, so a message is issued once. A send that is
   never confirmed becomes `unknown` and is never retried automatically.
3. `conversations` every 3 minutes (`LINKEDIN_BRIDGE_SYNC_SECONDS`).
4. `messages` for up to 2 conversations with new activity per poll, and at
   most 4 polls a minute, so a first sync spreads over a few minutes.

### Real time (v0.2)

Polling every minute is only the floor. Three signals make it immediate:

- **Send nudge.** The ARIA page and the extension talk through a small
  content script (`extensions/linkedin-bridge/aria-page.js`, injected on
  localhost and on the configured ARIA origin). After a click on Send the
  page nudges the extension, which polls at once: the message leaves about
  1.5 s later instead of up to a minute.
- **Live mode.** While `/linkedin` is open and visible, the page pings the
  extension every 15 s; the extension then polls every ~12 s and ARIA
  refreshes the inbox every 30 s (`LINKEDIN_BRIDGE_LIVE_SYNC_SECONDS`)
  instead of every 3 minutes.
- **LinkedIn activity.** A passive content script on linkedin.com
  (`linkedin-page.js`) watches the tab title, where LinkedIn shows its unread
  count. When it goes up, the extension asks for an inbox refresh right away
  (at most every 15 s). It makes no request and reads nothing else.

On the ARIA side, `/api/linkedin/stream` (Server-Sent Events) tells the page
which part changed (status, inbox, outbox) within ~1.5 s; the page refetches
only that part, and falls back to polling every 10 s if the stream fails.
Measured end to end with a fake LinkedIn: bubble shown 40 ms after the click,
on LinkedIn 1.5 s later, an incoming reply on screen 0.3 s after LinkedIn's
tab title changed.

One-click pairing uses the same relay: **Connect in one click** creates a
pairing code and hands it to the extension, which only accepts it from the
ARIA address it is set up for (default `http://localhost:3000`).

LinkedIn rotates the GraphQL query ids of its messaging API. The extension
watches the requests LinkedIn's own messaging page makes and reports the ids
it sees; ARIA uses them and falls back to built-in ones.

On HTTP 401/403 the bridge pauses 10 minutes and re-checks who is signed in;
on 429/999 or a security check (checkpoint page) it pauses 30 minutes and
shows the reason on `/linkedin`.

## How HeyReach does it, and why this is different

HeyReach (and Expandi, Dripify, Unipile...) connect an account either with
your LinkedIn email and password or with a Chrome extension that captures
your browser session cookie (`li_at`), then **run every action from their
cloud**, through one dedicated residential or mobile proxy per account, so
the session keeps working with your computer off. The inbox ("Unibox") is a
server-side sync of the same private API.

That model needs the session cookie stored on a server and a proxy to hide
that the session moved. LinkedIn treats both as automation signals, and in
March 2026 it reportedly removed HeyReach's company page and its founders'
profiles. This bridge keeps the cookie in your browser and runs from your own
machine. The trade-off: Chrome must be open, signed in to LinkedIn, with the
extension installed. ARIA works through the outbox and catches up when the
browser comes back.

## Try it locally (Docker)

1. Turn it on: add `LINKEDIN_BRIDGE_ENABLED=true` to `.env.local` (the app
   container reads it), then `docker compose up --build` (or
   `docker compose up -d --build app` on a running stack). Migrations
   `0006`/`0007` are applied by `supabase-bootstrap`.
2. In Chrome: `chrome://extensions` -> Developer mode -> **Load unpacked** ->
   pick `extensions/linkedin-bridge`. After pulling a new version, click the
   extension's reload arrow there (and reload the ARIA tab).
3. Stay signed in to linkedin.com in the same Chrome profile. Opening
   https://www.linkedin.com/messaging/ once lets the extension learn the
   current query ids. If no LinkedIn tab is open, the extension opens a
   pinned one when it has work (turn that off in its popup).
4. Sign in to ARIA at http://localhost:3000, open **LinkedIn** in the
   sidebar: the page detects the extension. Click **Connect in one click**.
   (Another ARIA address, or no detection: **Use a pairing code instead**,
   then paste it in the extension popup under Settings.)
5. Within seconds `/linkedin` shows "Live", then your conversations. Reply in
   a thread, or **New message** with a profile URL.
   `/linkedin?to=<profile url>&candidate=<id>` opens a prefilled message.

The toolbar icon shows the number of unread conversations (red `!` on a
problem); its popup shows the LinkedIn session, the pairing and the last sync.

## Limits

- Messages go to 1st-degree connections (and existing conversations).
  LinkedIn refuses others; the reason appears on the message. InMail,
  connection requests, Sales Navigator and Recruiter inboxes are not handled.
- Text only: attachments are shown as `[file: name]`, `[image]`, etc.
- One page of the inbox (about 20 most recent conversations) per sync, the
  latest 40 messages per conversation refresh. Older history is not
  backfilled.
- Voyager is undocumented. Parsers are written against the observed formats
  (nested and normalized JSON) and against the open-source mautrix-linkedin
  bridge; the first real run is the real test.
- Personal data: candidates' LinkedIn messages are stored in ARIA. Disconnect
  on `/linkedin` deletes everything synced for that user.

## Troubleshooting

| What you see | Do |
| --- | --- |
| `/linkedin` says the bridge is turned off | `LINKEDIN_BRIDGE_ENABLED=true` in `.env.local`, restart the app container |
| Extension: "ARIA is not reachable" | ARIA address in the popup; app running on that port |
| "Extension online, not signed in to LinkedIn" | Sign in to linkedin.com in the same Chrome profile |
| "LinkedIn refused the session (HTTP 401/403)" | Sign out and in again on linkedin.com; the bridge retries after 10 min |
| "LinkedIn wants ... a security check" | Open linkedin.com, pass the check; the bridge retries after 30 min |
| "Inbox sync failed: ..." (GraphQL) | Open https://www.linkedin.com/messaging/ once so the extension sees the current query ids |
| A message stays "Unconfirmed" | Check the conversation on LinkedIn before sending again |

Code: `src/lib/linkedin-bridge/`, `src/app/api/linkedin/`,
`src/app/linkedin/page.tsx`, `extensions/linkedin-bridge/`,
`tests/linkedin-bridge.mts`.
