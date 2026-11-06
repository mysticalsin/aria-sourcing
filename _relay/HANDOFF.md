---
project: MSourcing / ARIA
shift: 455
agent: claude-code
updated: 2026-11-06
status: mbe-test-merged-into-mbe-branch
---

# Handoff - Shift 455

## Current state

- Branch mbe-branch. LinkedIn bridge (experimental, off unless
  `LINKEDIN_BRIDGE_ENABLED=true`) is now centred on sourced candidates
  (owner request 2026-11-06, shift 454). Design/setup: `docs/linkedin-bridge.md`.
  - Settings › Integrations › LinkedIn (section "20", hash `#linkedin`):
    the user's own connection (one-click pairing, status, disconnect).
  - Candidate drawer › LinkedIn (`src/components/linkedin/candidate-linkedin.tsx`):
    relationship (Connected · 1st / Invitation pending / Not connected /
    Profile not found), invitation with note (300 chars), the conversation
    with that candidate only, first message, pacing countdown. Hidden when
    masked/erased/no LinkedIn URL/no outreach permission; blocked by
    compliance flags (also enforced server-side).
  - Candidate lists: `LinkedInBadge` in `CandidateTable` (Candidates page and
    campaign detail).
  - `/linkedin` inbox removed (redirects to Settings, or to
    `/candidates?focus=` with `?candidate=`); nav entry removed.
  - Only conversations with a looked-up candidate are kept in full; others
    are stubs (participant member ids + last activity). Migration 0008
    converted the owner's 21 cached conversations to stubs and deleted the
    108 cached messages (a cache of LinkedIn; candidates' threads come back
    once looked up).
  - One LinkedIn account per ARIA user (unique index + identity check).
- Extension 0.3.0 (`extensions/linkedin-bridge/`): allowlist adds the
  decorated profile read and the invitation; ARIA warns when the extension
  is older than 0.3.0. The owner must reload it in chrome://extensions.
- Users on the local stack: admin@aria.local (owner, has his real LinkedIn
  paired), tony@aria.local (created this shift, role member, demo workspace;
  password given to the owner in chat, not stored here),
  linkedin-e2e@bridge-e2e.test (test user, own workspace "bridge-e2e.test",
  seeded with 2 fictional candidates; bridge data deleted after each run).
- `npm run demo:user -- --email x@aria.local --name "X" [--role admin]`
  (`scripts/create-local-user.mjs`) creates/updates a local user; localhost
  only.
- Gate and Docker on this Mac: see the previous baton's notes (container gate
  `aria-gate:local`, OrbStack CLI via xbin + DOCKER_HOST/DOCKER_CONFIG).

## Merged from mbe-test (its shift 452, 2026-11-04, archived as
`_relay/archive/2026-11-04-1447-claude-code.md`)

- 8388d6f9 same-origin check uses the host the browser addressed: under
  Docker (`HOSTNAME=0.0.0.0`) every browser POST to the sourcing routes
  failed with "Cross-origin sourcing is not allowed." (`isSameOriginRequest`
  in `src/lib/api/same-origin-json.ts`).
- 182b7014 Pipeline page (/funnel) = campaign x stage overview
  (`src/lib/pipeline.ts`, `src/components/tania/pipeline-overview.tsx`,
  `tests/pipeline.mts`); funnel-board removed.
- d761bf8a candidate photos (LinkedIn CDN, `avatarUrl`,
  `src/lib/candidate-photo.ts`, CSP img-src media.licdn.com), LinkedIn link,
  details button, live sourcing scan; 95dc2ef4 login talent-field, buttons
  that never wrap; b5191c57/697601c7 roadmap placeholder integration cards
  removed (STATE_VERSION 20); a951652b campaign fingerprint ignores
  jobAnalysis key order.

## Done in shift 454 (before the merge)

Owner (2026-11-06): "connect it to the sourcing features; the LinkedIn
connection is per user, create a user Tony; show LinkedIn on sourced
candidates only (not every conversation); add invitations since messages need
1st-degree connections; move the extension connection to Settings."

- Research (third-party captures of the web client, 2026; none verified
  live from here): invitation = `POST voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=...InvitationCreationResultWithInvitee-2`
  with `{invitee:{inviteeUnion:{memberProfile}}, customMessage?}`; duplicate
  = 400 `CANT_RESEND_YET`; message to a non-connection = 422
  `RECIPIENT_NOT_FIRST_DEGREE_CONNECTION`; relationship from the profile read
  with `decorationId=...WebTopCardCore-19` (`fsd_memberRelationship` entity:
  connection / noConnection.invitationUnion.invitation|noInvitation /
  memberDistance). LinkedIn meters that read as a profile view. Messaging
  participant URLs are member-id style (`/in/ACoAA...`), so candidates are
  matched by looking their public id up once. tomquirk/linkedin-api is gone
  (404).
- Migration `0008_linkedin_bridge_candidates.sql`: contacts table, outbox
  `kind` (message|invitation) + `contact_id` + body check by kind,
  conversations `candidate_id`, stubs, unique member per account, service-only
  `linkedin_bridge_candidate(workspace, candidate)` reading workspace_state.
- Server: planner ops `invite`, `lookupContact`; `writeSlot` pacing (shared
  90 s gap; 40 messages/day, 15 invitations/day, 80/week; 80 profile reads/day;
  pending invitations re-checked daily); result handlers for lookups,
  invitations (sent / already pending / already connected / quota), 422
  refusal -> invitation offer; candidate routes `/api/linkedin/candidates`
  (GET summary incl. `nextWriteAt`, POST check|invite); outbox POST now only
  to candidates (conversationId or candidateId), compliance-checked.
- UI: `linkedin-store.ts` (one shared live store/EventSource per tab),
  `candidate-linkedin.tsx`, `linkedin-badge.tsx`, `settings-panel.tsx`;
  `ThreadView` gained `title`/`compact`; inbox components deleted.
- Verified on the stack (OrbStack), test user only, fake LinkedIn: 19/19
  e2e checks (redirect, one-click pairing in Settings, Grace matched from a
  stub, Ada not connected -> invitation with note (payload checked) ->
  acceptance via "check now" -> pacing countdown -> first message delivered,
  list badges, only candidates' conversations exposed, a non-candidate's
  private message never in the page, popup 0.3.0, no page errors).
- Gate: typecheck, typecheck:tests, npm test exit 0; eslint clean on touched
  paths; `tests/linkedin-bridge.mts` 29 tests; `tests/settings-accordion.mts`
  updated for section 20.

## Blockers

- None in code. Not yet seen live on LinkedIn: the invitation endpoint, the
  relationship shape of the profile read, and the stub matching on a real
  inbox (messaging and sending were confirmed live by the owner earlier).

## Next steps

1. Owner: `git pull`; chrome://extensions -> reload the ARIA extension
   (0.3.0); reload ARIA tabs. The stack on this Mac already runs migration
   0008 and the new app. Open a real sourced candidate with a LinkedIn URL:
   first look (relationship), then invite or message. Report anything odd
   shown in the LinkedIn section.
2. Tony: sign in as tony@aria.local from his own Chrome profile with his own
   LinkedIn session and his own copy of the extension; Settings ›
   Integrations › LinkedIn › Connect in one click. On his own machine:
   `docker compose up --build` then `npm run demo:user -- --email tony@aria.local --name "Tony"`.
3. If LinkedIn's live answers differ (relationship shape, invitation
   answer), fix `parseProfileCard` / `parseInvitationResult` in
   `src/lib/linkedin-bridge/parse.ts` with a fixture in `tests/linkedin-bridge.mts`.
4. Ideas: withdraw a pending invitation; older-history backfill per
   candidate; link the existing "Draft LinkedIn message" (assisted-manual
   outreach) to the bridge composer; team view of who is connected.
5. Carried over from shift 451: web search sourcing check; AI issue 04;
   pre-rename volume login; store.ts split; chat multi-turn; perf ideas.

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
- Owner 2026-11-06 (shift 454): the bridge is candidate-centred. Only
  conversations with sourced candidates are shown and kept in full; no
  general inbox page. One LinkedIn account per ARIA user. Invitations are a
  click on the candidate (note optional), never automatic. Profile reads are
  on first look, on click, and daily for pending invitations only.
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

- Pipeline counts read the live candidate stage, not campaign.metrics (which
  are high-water marks and never go down). (from mbe-test)
- The candidate drawer also shows the older "Draft LinkedIn message" button
  (assisted-manual outreach queue): it is not the bridge.
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
