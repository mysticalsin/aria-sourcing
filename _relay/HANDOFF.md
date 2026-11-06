---
project: MSourcing / ARIA
shift: 453
agent: claude-code
updated: 2026-11-06
status: linkedin-bridge-live-ui-v0.2-awaiting-owner-reload
---

# Handoff - Shift 453

## Current state

- Branch mbe-branch. New experimental feature: LinkedIn bridge (owner
  request 2026-11-06): read the owner's LinkedIn inbox in ARIA (`/linkedin`)
  and send LinkedIn messages as the owner, through an unpacked Chrome
  extension that runs LinkedIn's private "Voyager" API calls inside the
  owner's own logged-in linkedin.com tab. Off unless
  `LINKEDIN_BRIDGE_ENABLED=true` (server env; `.env.local` for Docker).
  Design, risks, setup: `docs/linkedin-bridge.md`.
- Owner tested it live in Chrome on his real account (2026-11-06): works.
  Shift 453 = UI v0.2 (real time, one-click pairing, ARIA-branded extension).
- Code: `src/lib/linkedin-bridge/` (voyager request builders, parsers,
  planner, policy/pacing, tokens, outcome, server data layer),
  `src/app/api/linkedin/` (account, conversations, conversations/[id],
  outbox, stream (SSE); bridge/poll and bridge/result for the extension),
  `src/app/linkedin/page.tsx` + `src/components/linkedin/` (nav entry
  "LinkedIn" under Engage), `extensions/linkedin-bridge/` (MV3 0.2.0:
  background.js, allowlist.js, queries.js, aria-page.js, linkedin-page.js,
  popup, icons), migrations `0006_linkedin_bridge.sql` (4 service-only
  tables, RLS forced) and `0007_linkedin_bridge_seen.sql`,
  `tests/linkedin-bridge.mts` (23 tests, application group).
- Gate: see "Done this shift" for the exact runs. This Mac has no Node in
  PATH: the gate ran in a container (`aria-gate:local` = node:22-bookworm-slim
  + openssl, git, curl, jq, python3; node_modules in the docker volume
  `aria_gate_node_modules`).
- Docker: OrbStack 29.8.2 is the engine on this Mac; it was stopped and was
  started this shift (`orbctl start`). The docker CLI here needs
  `PATH=/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH` and, for
  BuildKit, `DOCKER_CONFIG=<dir with cli-plugins/docker-buildx symlink>` +
  `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` (reading
  ~/.docker/config.json was refused by the auto-mode guard). In the owner's
  own terminal plain `docker compose up --build` should work.
- `.env.local` was created (gitignored) with only `LINKEDIN_BRIDGE_ENABLED=true`.

## Done this shift

Owner (2026-11-06, after a successful live test in Chrome on his real
account): "improve the LinkedIn UI, make it dynamic when sending and
receiving, add the ARIA logo to the extension, improve the UI".

- Real time:
  - `GET /api/linkedin/stream` (SSE): a fingerprint of status / inbox /
    outbox every 1.5 s, sends `change {parts}`; the page refetches only
    those parts, falls back to 10 s polling.
  - Extension 0.2.0: `aria-page.js` relay (one-click pairing, send nudge,
    live pings, status push; the service worker accepts them only from the
    configured ARIA origin), `linkedin-page.js` (passive: LinkedIn tab title
    unread count up -> immediate inbox refresh, debounced 15 s).
  - Poll accepts `live` / `activity`; planner: live inbox interval 30 s
    (`LINKEDIN_BRIDGE_LIVE_SYNC_SECONDS`), activity refresh if the last one
    is >= 15 s old. Poll limit 60/min; poll returns `stats` for the badge.
  - `storeConversations` writes a row only when it changed, so `updated_at`
    (the stream's inbox fingerprint) moves only on real news.
- Migration `0007_linkedin_bridge_seen.sql`: `seen_at`,
  `last_message_direction`, `last_message_sender` on conversations. Unread
  in ARIA = LinkedIn unread and nothing newer since the user opened it.
- UI split into `src/components/linkedin/` (types, api, use-linkedin-inbox,
  use-bridge-extension, connection, conversation-list, thread-view,
  composer, new-message, avatar, format) + `src/app/linkedin/page.tsx`:
  optimistic bubble (Queued -> Sending with sheen -> morphs into the
  delivered message, same React key), animated arrivals and list reorder
  (framer-motion, reduced-motion honoured), day separators, "new messages"
  pill, toasts + optional sound on replies, tab title unread count,
  onboarding in 3 steps with one-click connect, live status bar with ticking
  sync time and send meter, auto-open of a new chat once LinkedIn creates it,
  LinkedIn thread link. Page fits the viewport (no page scroll).
- Extension: ARIA mark icons (16/32/48/128 from `public/aria-mark.png`),
  toolbar badge (unread count, red `!` on error), redesigned popup
  (checks, counters, gradient CTA, settings folded, dark mode).
- Bug found by the e2e and fixed: the first sync after pairing toasted every
  existing conversation as a new reply.
- Verified on the running stack (OrbStack), with a separate test user
  `linkedin-e2e@bridge-e2e.test` in its own workspace (the owner's real
  account - 1 pairing, 21 conversations, 108 messages, 2 outbox rows - was
  counted before and after and never touched): real Chromium + real
  extension 0.2.0 + real ARIA + fake LinkedIn (DNS-mapped to 127.0.0.1):
  16/16 checks. Pair in one click -> inbox in 1.8 s; bubble 40 ms after
  Send; on LinkedIn 1.5 s after the click (was up to 60 s); delivered 2.9 s
  end to end; incoming reply on screen 0.3 s after LinkedIn's title changed;
  read reply clears unread; no page errors. Screenshots reviewed.
- Gate: typecheck, typecheck:tests, npm test exit 0 (aria-gate:local);
  eslint clean on the touched paths. `tests/linkedin-bridge.mts`: 23 tests
  (live/activity planner, relay origin checks, passive LinkedIn script,
  manifest content scripts).

## Blockers

- None in code. Unverified until the owner's live run: the real LinkedIn
  answers (Voyager formats, query ids, createMessage payload) and the
  extension in Chrome.

## Next steps

1. Owner: `git pull`, then in Chrome `chrome://extensions` -> reload the
   ARIA LinkedIn Bridge (0.1.0 -> 0.2.0: new content scripts and icons need
   the reload), then reload the ARIA tab. The pairing survives. The stack on
   this Mac already runs the new app build with migration 0007.
2. If the page shows the extension as "not connected" in this browser:
   **Connect this browser** (rotates the code and hands it over).
3. Next ideas, if wanted: "Message on LinkedIn" chip in the candidate drawer
   (`src/components/candidates/candidate-drawer.tsx`) ->
   `/linkedin?to=<linkedinUrl>&candidate=<id>`; link conversations to ARIA
   candidates by profile URL; mark-as-read on LinkedIn itself (new allowlist
   entry); older-history backfill.
4. Carried over from shift 451 (still open): web search sourcing check on the
   stack; AI issue 04 cache check; pre-rename volume login; store.ts split;
   chat multi-turn; perf ideas. See `_relay/archive/2026-11-06-1236-claude-code.md`.

## Decisions made (don't relitigate)

- Owner 2026-11-06: build and test an internal LinkedIn messaging bridge on
  mbe-branch, knowingly against LinkedIn's terms, on the owner's own account,
  owner accepts the ban risk. Kept consistent with 2026-11-03 "no bot-detection
  evasion": runs in the owner's real browser, no proxy, no headless browser,
  no fingerprint spoofing, no random "human" delays; fixed pacing only
  (40/24 h, 90 s gap, env-tunable). Every send is one human click; nothing
  automated (agents, sequences) can queue a LinkedIn message.
- The existing outreach pipeline stays assisted-manual for LinkedIn
  (`src/lib/linkedin-policy.ts`, `getOutboundChannelPolicy`, guardrail
  prompt unchanged). The bridge is a separate, flag-gated path.
- A LinkedIn inbox is personal: bridge rows are scoped to (workspace, user);
  no workspace-wide view. Disconnect deletes everything synced.
- Owner 2026-11-03: the Docker stack targets a Mac; do not spend effort on Windows-specific Docker issues.
- Owner 2026-11-03: Vercel is dropped; the app will be self-hosted later
  (target not chosen). Merging into vercel-demo is no longer a goal.
- Owner 2026-11-03: no local LLM / Ollama for now; AI stays on the Anthropic key.
- Owner 2026-11-03: Kong replaced by Caddy as the API gateway.
- Owner 2026-11-03: no stealth scraping or bot-detection evasion; LinkedIn
  discovery without Apify goes through Claude's web search on public indexed
  pages (`WebSearch` source).
- Owner 2026-11-03: no "hermes" in the code (product is Aria).
- All AI runs on Claude via one Anthropic key, within 20-30 EUR/month; GDPR
  validated by the owner (2026-10-30).
- Model per task: Haiku for classify/extract, Sonnet for chat, outreach and
  sourcing, Opus only by explicit choice.
- Agents run in-process, client-side on top of store actions (ADR 0001).
- Sourcing spends only an admin vault key; the env/.secret key serves chat and
  local dev. Deterministic fallbacks everywhere; human approval before any send.
- UX: English UI ("Talent pool"), one /100 score, no personal credit (Mantu
  Group mention), Carlito self-hosted, nav per audit §4 with one "New campaign".
- Careers stays outside the workspace store provider (test-enforced); demo
  roles come from the API, not the browser store.
- Tutorial never opens on its own (owner, 2026-11-02). Contact basis can be
  recorded on synthetic demo profiles (owner, 2026-11-02).

## Watch out

- The stack on this Mac holds the owner's REAL LinkedIn data (admin@aria.local).
  Never run a test that calls `DELETE /api/linkedin/account` as that user;
  e2e runs use `linkedin-e2e@bridge-e2e.test` (own workspace, left in the
  local DB, bridge data deleted after each run).
- `/api/linkedin/stream` holds the connection open: Playwright `networkidle`
  never fires on `/linkedin`; wait for `load` instead.
- Codex audit focus for this shift: `src/app/api/linkedin/stream/route.ts`,
  `extensions/linkedin-bridge/background.js` handleMessage (origin checks for
  pair/live/nudge), and the earlier ones: `src/app/api/linkedin/bridge/result/route.ts`
  (every echoed ref re-checked against the account), outbox state machine
  (queued -> resolving -> queued -> sending -> sent|failed|unknown; an
  unconfirmed send becomes `unknown` and is never retried), the extension
  allowlist (`extensions/linkedin-bridge/allowlist.js`).
- `extensions/linkedin-bridge/package.json` (`"type": "module"`) exists only
  so Node tests can import the extension modules; Chrome ignores it.
- The extension folder is excluded from the Docker build context (`.dockerignore`).
- Storing candidates' LinkedIn messages is new personal-data processing;
  the 2026-10-30 GDPR validation did not cover it.
- `_relay/codex-findings.md` keeps open findings only: when closing one, move
  it to the archive file of closed findings.
- The bootstrap job now depends on the gateway: a gateway regression shows up as a failed supabase-bootstrap, not as an unhealthy app.
- `getClaims()` falls back to `getUser()` with the HS256 secret used here.
- Store hooks: a `useSlice` selector must return a stable reference. Build
  arrays with `useMemo` on the slice, and use the module-level `NO_ITEMS`.
- `tests/module-boundaries.mts` rejects import cycles, type-only ones included.
- `tests/motion-foundation.mts` greps `providers.tsx` for "framer-motion",
  comments included.
- Several files use CRLF line endings: multi-line `perl`/`sed` edits silently
  miss on them; use the Edit tool.
- `.next/types` keeps stale routes after a page moves: `npx next typegen`.
- Missions run in the browser: closing the tab stops queued agents.
- Under tsx a module can load twice; use `isAgentTimeout`, not `instanceof`.
