# LinkedIn bridge (experimental)

LinkedIn, from each sourced candidate's profile in ARIA, as yourself: see
whether they are a connection, invite them (with a note), and keep your
conversation with them. Each ARIA user connects their own LinkedIn. Off
unless `LINKEDIN_BRIDGE_ENABLED=true`. Owner requests, 2026-11-06, on
`mbe-branch`, for a local Docker test.

> LinkedIn's User Agreement forbids bots, browser add-ons and other automated
> means of accessing LinkedIn or sending messages. This bridge uses that private
> API ("Voyager") from your own browser. LinkedIn can restrict or close the
> account that uses it. The account owner accepted that risk; do not enable it
> for anyone who has not.

## Where it shows

- **Settings › Integrations › LinkedIn** (`/settings?tab=integrations#linkedin`):
  connect the ARIA extension of your browser in one click, see its status,
  disconnect. Personal: the connection belongs to the signed-in ARIA user; one
  LinkedIn account can be connected to one ARIA user only.
- **Candidate drawer › LinkedIn** (any candidate list: Candidates, a
  campaign): where the candidate stands with you (Connected · 1st, Invitation
  pending, Not connected, Profile not found), **Send invitation** with an
  optional note (300 characters), and the conversation with that candidate,
  live, or a first message when they are a connection. Hidden for masked or
  erased profiles; blocked for do-not-contact, unsubscribed, suppressed or
  anonymized candidates.
- **Candidate lists**: a small badge per row when there is something to see
  (Reply, Invited, 1st, In touch, Sending, Not sent).
- The old `/linkedin` inbox is gone (it redirects to Settings): ARIA only
  keeps and shows conversations with sourced candidates.

## Candidates

- **Matching.** LinkedIn's messaging names people by member id (`ACoAA...`),
  candidates carry a public URL (`/in/jane-doe`). The first time a candidate's
  LinkedIn panel opens, ARIA looks the profile up once
  (`identity/dash/profiles`, the top-card decoration LinkedIn's own profile
  page loads): member id, name, headline, and the relationship. LinkedIn counts
  that read as a profile view, so it is never automatic beyond that first look:
  **Check again** is a click, and pending invitations are re-checked once a day
  to notice acceptances. Reads are capped (`LINKEDIN_BRIDGE_DAILY_LOOKUP_CAP`,
  80 a day).
- **Conversations.** A conversation is kept in full (names, messages) only
  when one of its participants is a looked-up candidate. Every other
  conversation is a stub: participant member ids and last activity, no name, no
  text, so a candidate looked up later can still be matched. Messages are only
  fetched for candidates' conversations.
- **Invitations.** `voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2`,
  the Connect dialog's own request; a note-less invitation sends no
  `customMessage`. Paced: 15 a day, 80 a week (`LINKEDIN_BRIDGE_DAILY_INVITE_CAP`,
  `LINKEDIN_BRIDGE_WEEKLY_INVITE_CAP`), and the 90 s gap is shared with messages.
  "Already pending" (`CANT_RESEND_YET`), "already connected" and quota refusals
  are told apart.
- **Messages.** Only to a candidate; LinkedIn delivers them to 1st-degree
  connections only (a refusal, `422 RECIPIENT_NOT_FIRST_DEGREE_CONNECTION`,
  turns the panel into an invitation form).
- **Adding someone you know (prospects).** Candidates › **Add candidate** ›
  **LinkedIn profile**: a **Search** link opens LinkedIn's own people search
  in a new tab (the person is picked by the user there; ARIA does not search
  LinkedIn). Pasting the profile URL and clicking **Look up** reads that one
  profile through the user's LinkedIn (one profile view; a look-up less than
  24 h old is reused) under a `prospect:<public id>` contact, and prefills
  name, title and company. A prospect owns no conversation: nothing is linked
  or synced in full until it is added. On **Add candidate** the contact moves
  to the new candidate (`adopt`, no second view) and their conversations are
  linked; **Cancel** forgets it (`discard`). The new candidate's panel opens
  on its LinkedIn tab, unmasked (logged as a reveal) since the user just
  entered the identity.
- **Outreach drafts: approving sends (owner, 2026-11-09).** A LinkedIn draft
  in Outreach shows **Approve & send on LinkedIn**. That click is the decision
  to send the exact text: ARIA queues it as a message to a connection, or, when
  they are not connected and it fits (300), as an invitation note; the
  outreach is then recorded as sent (`confirmManualSend`). Bulk approval does
  the same for each selected LinkedIn draft. If it cannot go (bridge off or not
  connected, invitation pending, longer than a note), it stays in "Pending
  manual send" with the reason, where **Send with my LinkedIn** (prefilled
  LinkedIn tab) and copy-paste remain. Server pacing and caps still apply.
  Code: `src/components/linkedin/outreach-send.ts`.
- **Keyboard.** In the LinkedIn tab, Enter sends (message or invitation);
  Shift+Enter adds a line.
- Endpoints, payloads and the relationship shape come from third-party
  captures of the web client (2026); verify on the first live run.

## Campaign autopilot (ADR 0002, proof of concept)

Owner decision 2026-11-09: test whether an agent can contact candidates on
LinkedIn without a click per message.

- **Turn it on:** the campaign page has an **Autopilot** card. The person who
  turns it on becomes the campaign's owner for the agents and signs a standing
  approval: cadence, profiles per source, contacts per run (1-5), minimum
  score, and a consent text. Enabling also records a delegation
  (`agent_delegations`); **Stop all agents acting for me** revokes it.
- **What runs:** the `agents` Compose service calls `POST /api/agent/tick`
  every minute (`AGENT_RUNNER_SECRET`). Each tick does one bounded step:
  1. start the campaign's durable sourcing run when it is due;
  2. advance it;
  3. when it ends, pick the best eligible candidates by match score:
     Sourced, never contacted, contactable, with a LinkedIn URL;
  4. for each pick: look the profile up through the owner's extension, write
     the copy (Claude, template fallback), and queue it in the **owner's**
     outbox. A 1st-degree connection gets a message, anyone else an
     invitation with a note of 300 characters at most.
- **Who sends:** the owner's extension, from the owner's browser, under the
  same pacing and caps as a click. The outreach shows "Pending Manual Send",
  approved by "ARIA agent for <owner>". When the extension reports the send,
  the candidate becomes Contacted. Refusals and `unknown` sends are reported
  on the card and never retried.
- **Guards:** `src/lib/linkedin-bridge/agent.ts` is the agent's only way into
  the outbox. Before each insert it re-reads the standing approval and the
  delegation, the candidate's compliance flags, and the relationship.
  `tests/linkedin-bridge.mts` checks that order and that no other code
  inserts.
- **Off unless:** `AGENTS_ENABLED=true` and `AGENT_RUNNER_SECRET`
  (32+ characters) on the app, and `LINKEDIN_BRIDGE_ENABLED=true` for
  contacts.

## How it works

```
ARIA (candidate drawer, API, Postgres)        Chrome on your machine
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
- **The extension only runs a short list of requests**
  (`extensions/linkedin-bridge/allowlist.js`): who am I, list conversations,
  read a conversation, look up a profile, send a connection invitation, send a
  message. A leaked pairing token cannot make it do anything else.
- **No LinkedIn credential leaves the browser.** The extension reads the
  session cookies only to tell ARIA "a session exists" and to set the CSRF
  header of LinkedIn's own requests. ARIA stores the SHA-256 of its pairing
  token, candidates' LinkedIn standing, their conversations and the outbox
  (`supabase/migrations/0006`-`0008`).
- **Requests come from your real browser**: same IP, same browser, same
  session as when you use LinkedIn by hand, sent as same-origin requests from
  a `www.linkedin.com` tab. No proxy, no headless browser, no fingerprint
  tricks, no randomised "human" delays (owner decision 2026-11-03: no
  bot-detection evasion).
- **A message or an invitation leaves only when you click**, with one
  exception: the campaign autopilot (ADR 0002, proof of concept, below).
  Nothing else can write to the outbox: no sequence, no API key
  (`tests/linkedin-bridge.mts` checks it). Sends are paced: 40 per rolling 24 h and 90 s between two sends
  by default (`LINKEDIN_BRIDGE_DAILY_SEND_CAP`,
  `LINKEDIN_BRIDGE_MIN_SEND_INTERVAL_SECONDS`).
- **Each user sees only their own LinkedIn.** Rows hang off one
  (workspace, user) pairing; there is no workspace-wide view. Teammates see the
  same candidates but each talks to them from their own LinkedIn.

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
- **Live mode.** While an ARIA page using LinkedIn (a candidate's LinkedIn
  section, Settings › LinkedIn) is open and visible, the page pings the
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
shows the reason in Settings › LinkedIn and on the candidate.

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
   `docker compose up -d --build` on a running stack: `supabase-bootstrap`
   applies migrations `0006`-`0008`).
2. In Chrome: `chrome://extensions` -> Developer mode -> **Load unpacked** ->
   pick `extensions/linkedin-bridge`. After pulling a new version, click the
   extension's reload arrow there (and reload ARIA's tabs). ARIA warns when the
   extension is older than it needs.
3. Stay signed in to linkedin.com in the same Chrome profile.
4. ARIA -> **Settings › Integrations › LinkedIn** -> **Connect in one click**.
5. Open a sourced candidate with a LinkedIn URL: the LinkedIn section checks
   where they stand, then offers an invitation or the conversation.

**Another person** (e.g. a teammate testing with their own LinkedIn):
`npm run demo:user -- --email tony@aria.local --name "Tony"` creates the
account on the local stack (member of the demo workspace, same candidates;
`--role admin` for settings too) and prints a password. They sign in from
their own Chrome profile with their own LinkedIn session and their own copy
of the extension: one browser profile = one LinkedIn session = one ARIA user.
The stack listens on 127.0.0.1 only, so a teammate on another machine runs
their own stack and the same command there.

The toolbar icon shows the number of unread candidate conversations (red `!`
on a problem); its popup shows the LinkedIn session, the pairing and the
last sync.

## Limits

- Messages go to 1st-degree connections (and existing conversations); others
  get an invitation first. InMail, Sales Navigator and Recruiter inboxes are
  not handled.
- Text only: attachments are shown as `[file: name]`, `[image]`, etc.
- One page of the inbox (about 20 most recent conversations) per sync, the
  latest 40 messages per conversation refresh. A candidate's conversation
  older than what the bridge has seen shows up once either side writes again.
- Voyager is undocumented. Parsers are written against the observed formats
  (nested and normalized JSON) and against the open-source mautrix-linkedin
  bridge; the first real run is the real test.
- Personal data: candidates' LinkedIn messages and standing are stored in
  ARIA; nothing from non-candidate conversations beyond member ids. Disconnect
  (Settings) deletes everything synced for that user.

## Troubleshooting

| What you see | Do |
| --- | --- |
| Settings › LinkedIn says the bridge is turned off | `LINKEDIN_BRIDGE_ENABLED=true` in `.env.local`, restart the app container |
| Extension: "ARIA is not reachable" | ARIA address in the popup; app running on that port |
| "Extension online, not signed in to LinkedIn" | Sign in to linkedin.com in the same Chrome profile |
| "LinkedIn refused the session (HTTP 401/403)" | Sign out and in again on linkedin.com; the bridge retries after 10 min |
| "LinkedIn wants ... a security check" | Open linkedin.com, pass the check; the bridge retries after 30 min |
| "Inbox sync failed: ..." (GraphQL) | Open https://www.linkedin.com/messaging/ once so the extension sees the current query ids |
| A message stays "Unconfirmed" | Check the conversation on LinkedIn before sending again |

Code: `src/lib/linkedin-bridge/`, `src/app/api/linkedin/`,
`src/app/linkedin/page.tsx`, `extensions/linkedin-bridge/`,
`tests/linkedin-bridge.mts`.
