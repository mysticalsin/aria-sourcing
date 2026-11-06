---
project: MSourcing / ARIA
shift: 452
agent: claude-code
updated: 2026-11-06
status: linkedin-bridge-built-awaiting-owner-live-test
---

# Handoff - Shift 452

## Current state

- Branch mbe-branch. New experimental feature: LinkedIn bridge (owner
  request 2026-11-06): read the owner's LinkedIn inbox in ARIA (`/linkedin`)
  and send LinkedIn messages as the owner, through an unpacked Chrome
  extension that runs LinkedIn's private "Voyager" API calls inside the
  owner's own logged-in linkedin.com tab. Off unless
  `LINKEDIN_BRIDGE_ENABLED=true` (server env; `.env.local` for Docker).
  Design, risks, setup: `docs/linkedin-bridge.md`.
- Code: `src/lib/linkedin-bridge/` (voyager request builders, parsers,
  planner, policy/pacing, tokens, outcome, server data layer),
  `src/app/api/linkedin/` (account, conversations, conversations/[id],
  outbox; bridge/poll and bridge/result for the extension),
  `src/app/linkedin/page.tsx` (+ nav entry "LinkedIn" under Engage),
  `extensions/linkedin-bridge/` (MV3: background.js, allowlist.js,
  queries.js, popup), migration `supabase/migrations/0006_linkedin_bridge.sql`
  (4 service-only tables, RLS forced), `tests/linkedin-bridge.mts` (22 tests,
  in the application group).
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

- Research: HeyReach connects accounts by credentials or by an extension that
  captures the li_at cookie, then runs everything from its cloud through a
  dedicated proxy per account; LinkedIn reportedly removed HeyReach's company
  page and founders' profiles in March 2026. Chosen design keeps the session
  in the owner's browser instead (see docs). Voyager endpoints/payloads
  cross-checked against mautrix/linkedin (AGPL, reference only, no code copied).
- Feature implemented as listed in Current state. Guarantees enforced by
  tests: every request ARIA builds passes the extension allowlist; the
  allowlist refuses other paths/headers/methods; only `src/app/linkedin/page.tsx`
  calls `/api/linkedin/outbox` and only a signed-in user can queue (the
  extension token cannot); no module outside the bridge imports it; the
  migration stores no cookie/credential; background.js only tests li_at for
  presence.
- Gate green on the committed tree, run in `aria-gate:local`: `npm run
  typecheck`, `npm run typecheck:tests`, `npm test` all exit 0; eslint clean
  on the touched paths. (node:22-bookworm-slim alone fails the pretests for
  lack of `openssl` and `curl`: environment, not code.)
- First real Docker run of the whole stack on this Mac (OrbStack): `up
  --build` green first time, bootstrap applied 0001-0006, every `[gateway] ok`,
  app healthy, `/api/ready` 200. This also covers shift 451's next step 1.
- Verified on that stack (scripts kept out of the repo):
  - API smoke, extension played by a script with canned Voyager answers:
    30/30 checks (pairing, 401 without/unknown token, identity, inbox, threads,
    GraphQL error surfaced, send claimed once, payload, sent message in the
    thread, non-profile URL refused, 90 s pacing holds the next send, withdraw,
    extension token cannot queue, disconnect deletes all and kills the token).
  - UI in Chromium (Playwright image v1.61.1): list -> thread -> reply ->
    "Waiting for the extension", no page errors.
  - Real unpacked extension in Chromium against real ARIA, linkedin.com
    served by Playwright and DNS-mapped to 127.0.0.1 (nothing reached
    LinkedIn): pairing via popup, identity, inbox, thread, send with
    csrf-token = JSESSIONID value and text/plain content type, outbox "sent",
    only allowlisted endpoints called. A tab the extension opens itself is not
    intercepted by Playwright (it hit the 127.0.0.1 map and the error surfaced
    on the account): harness limit, the test pre-opens the LinkedIn tab.
- The stack is left running (OrbStack) with the bridge enabled and no
  pairing (test data deleted).

## Blockers

- None in code. Unverified until the owner's live run: the real LinkedIn
  answers (Voyager formats, query ids, createMessage payload) and the
  extension in Chrome.

## Next steps

1. Owner live test (docs/linkedin-bridge.md "Try it locally"): stack up with
   `LINKEDIN_BRIDGE_ENABLED=true` in `.env.local`, `/linkedin` -> Connect the
   extension, load `extensions/linkedin-bridge` unpacked in Chrome, paste the
   code, open https://www.linkedin.com/messaging/ once. Expect "Connected as
   <name>" within a minute, then conversations.
2. If something fails, the reason is on `/linkedin` (account lastError) and
   in the extension popup. Parser fixes go in `src/lib/linkedin-bridge/parse.ts`
   with a fixture in `tests/linkedin-bridge.mts` (capture the real answer
   shape, strip personal data).
3. Then, if the owner wants it: "Message on LinkedIn" chip in the candidate
   drawer (`src/components/candidates/candidate-drawer.tsx`, near the
   LinkedIn link) -> `/linkedin?to=<linkedinUrl>&candidate=<id>` (page already
   supports it); older-history backfill (messengerConversations with
   lastUpdatedBefore cursor); mark-as-read.
4. Carried over from shift 451 (still open): web search sourcing check on the
   stack; AI issue 04 cache check; pre-rename volume login; store.ts split;
   chat multi-turn; perf ideas. See the archived baton
   `_relay/archive/2026-11-06-1236-claude-code.md`.

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

- Codex audit focus for this shift: `src/app/api/linkedin/bridge/result/route.ts`
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
