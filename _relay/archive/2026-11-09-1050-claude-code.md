---
project: MSourcing / ARIA
shift: 458
agent: claude-code
updated: 2026-11-09
status: add-candidate-from-linkedin
---

# Handoff - Shift 458

## Current state

- Shift 458 (2026-11-09): commit da301b17, "Add candidate" from a LinkedIn
  profile (see "Done this shift"). Gate exit 0; candidate e2e 39/39, three
  runs in a row (space runs >= 60 s apart: the bridge user rate limit is
  120 requests/min and back-to-back runs hit 429).
- Shift 457 (2026-11-09): commit 56e9c83b, candidate panel redesign (see
  "Done this shift"). Gate exit 0 (typecheck, typecheck:tests, npm test,
  eslint on touched files); candidate e2e 32/32 on the rebuilt stack.
- Owner's real setup on this Mac (checked 2026-11-09): workspace
  `confidentialityMode` is ON, his 7 real candidates are "Sourced", so they
  are masked until "Reveal" (logged). His paired extension reports version
  0.1.0: invitations and relationship checks need 0.3.0 (reload it in
  chrome://extensions from `extensions/linkedin-bridge`).
- Branch mbe-branch, local only (not pushed): 28c59514 merge of mbe-test,
  b647a65c LinkedIn follow-ups, 3c2d74a3 Apify retired, then this baton.
- Gate on 3c2d74a3's tree: typecheck, typecheck:tests, npm test exit 0;
  eslint clean on every touched file. Commit b647a65c was gated alone in a
  worktree: typecheck, typecheck:tests, npm test exit 0 (repository-hygiene
  needs the repo's `.git` mounted in the container for a worktree).
- Stack on this Mac (OrbStack) rebuilt from that tree; `/api/ready` 200.
  Candidate e2e (test user only, fake LinkedIn): 26/26, including the
  Pipeline mark, cross-origin refusals, and no "Apify" on Settings
  (integrations, keys) or the campaign page.
- Apify is gone (owner, 2026-11-06: "we will never use it"):
  - LinkedIn discovery = "LinkedIn via web search" (`WebSearch` source,
    `src/lib/sourcing/claude-web-search.ts`), then GitHub. Plan max 2
    sources, 1-20 profiles each. A stored `LinkedIn` step from an old run ends
    failed without a provider call (`unified-run.ts`).
  - No enrichment provider: `ENRICHMENT_PROVIDERS = []`,
    `ENRICHMENT_RUNNERS = {}`; the drawer says so. Providers now declare
    `keyProvider` (the stored key that unlocks them).
  - Workspace STATE_VERSION 21 drops the `int_apify` / `int_enrichment`
    cards. DB migrations untouched; old `provider_runs` rows keep `Apify`.
  - Candidate photos (`avatarUrl`, from mbe-test) were filled by Apify only:
    new candidates show initials.
- LinkedIn bridge: every cookie-authenticated write (account, candidates,
  conversations, outbox POST/DELETE) requires same-origin
  (`requireBridgeUser(req, { mutation: true })`); `LinkedInBadge compact`
  in the Pipeline overview. Everything else as in shift 454/455 (see
  `_relay/archive/2026-11-06-2233-claude-code.md`).

## Done this shift

Shift 458. Owner (2026-11-09): "add a feature to look for a candidate to
source: I know someone on LinkedIn and want to add them manually to a
campaign's candidates."

- Candidates page header: `AddCandidateButton` (campaign picker). Tabs:
  LinkedIn profile (default) / GitHub username / Manual
  (`src/components/candidates/add-candidate-dialog.tsx`).
- LinkedIn tab = `src/components/linkedin/profile-lookup.tsx`: Search link to
  LinkedIn's people search (new tab, user picks), profile URL, "Look up"
  through the bridge, prefill (name, `splitHeadline` -> title/company),
  connection status.
- Server (`/api/linkedin/candidates` POST): `preview` (contact keyed
  `prospect:<public id>`, `PROSPECT_PREFIX` in server.ts, answer reused for
  24 h), `adopt` (prospect -> candidate, same profile required, conversations
  linked), `discard`. Prospects never own conversations
  (`candidateMembers` filter, `applyProfileCard` skip).
- Manual intake stores a LinkedIn URL as canonical `linkedinUrl`
  (`src/lib/linkedin-profile-url.ts`), platform LinkedIn, company; returns
  `candidateIds`. After add: `/candidates?focus=<id>&added=1&tab=linkedin`,
  drawer `initialTab` + `revealOnOpen` (logged reveal).
- Logging: `[linkedin] ...` lines (code + message only) when a message or
  invitation cannot be queued. One e2e run hit "candidate read failed" from
  the `linkedin_bridge_candidate` RPC (before the code was logged); not
  reproduced in 6 later runs. Watch `docker logs aria-sourcing-app-1 | grep
  "\[linkedin\]"`.

Shift 457. Owner (2026-11-09): "make the candidate panel clearer and wider;
from it, connect with the candidate on LinkedIn and write to them if already
connected; I can't find the LinkedIn chat anymore; essential for the POC."

- Cause found: the LinkedIn section existed but sat at the bottom of the
  panel and was hidden for masked profiles (confidentiality mode), i.e. all
  of the owner's just-sourced candidates.
- `src/components/candidates/candidate-drawer.tsx`: 1024 px panel; header
  card (identity, contact, links, score, `LinkedInQuickAction`); one-line
  next-action strip; tabs Overview / LinkedIn / Evidence & contact /
  Pipeline & history / Compliance (`CandidateTab`, reset to Overview per
  candidate). Logic unchanged, JSX regrouped.
- LinkedIn tab: masked -> "Reveal profile (logged)" (`handleReveal`), no URL
  -> link to Evidence & contact, else `CandidateLinkedIn` (taller thread).
- `firstLookCandidate` (linkedin-store): the first relationship check runs
  once per candidate per tab, triggered by the header button; never for
  masked/blocked/erased profiles (`autoCheck`).
- E2E (scratchpad `smoke/candidate-e2e.mjs`): 3rd fictional candidate Linus
  (Sourced, masked): no LinkedIn lookup before the reveal, invitation offered
  after; header states for Grace (Reply) and Ada (Connect); tab screenshots.

Shift 456 (2026-11-06):

Owner (2026-11-06): "integrate mbe-test without breaking LinkedIn", then
"remove Apify sourcing and even its Settings configuration".

- Merge (28c59514) verified: a browser POST to `/api/source/campaign` under
  Docker reaches validation (400) instead of "Cross-origin sourcing is not
  allowed."
- b647a65c: same-origin guard on bridge writes + test; compact badge.
- 3c2d74a3: Apify removal (55 files). Engine hardening: web-search hits are
  re-checked with `canonicalLinkedInProfileUrl`; non-profile URLs count as
  excluded. Tests rewritten: `tests/unified-sourcing.mts` (12),
  `tests/enrichment-orchestrator.mts` (139 checks, fake providers via mocked
  registry/runners), route/fixture updates, `store-contracts` 118 actions.
  Docs updated (SOURCING, LOCAL-SOURCING-TEST, README, NEEDS_GUIDE, DOCKER,
  SUPABASE_SETUP, ARCHITECTURE, CANDIDATE-REVIEW, .env.local.example).
- Codex findings: triage notes added (2026-07-19 direct adapters: both gone,
  ready for re-audit; enrichment spend: gaps listed below). Issue
  `.scratch/unified-sourcing/issues/02-apify-account-acceptance.md` wontfix.

## Blockers

- None in code. Still unverified live on LinkedIn: the invitation endpoint,
  the relationship shape of the profile read, stub matching on a real inbox.

## Next steps

00. If "[linkedin] ... candidate read failed (CODE: ...)" shows in the app
    logs, investigate the RPC failure with that code (suspect: PostgREST
    pool of 10 under SSE load).
0. Owner: reload the ARIA extension (0.3.0) in chrome://extensions, reload
   ARIA, open a candidate -> header "LinkedIn" button / LinkedIn tab ->
   "Reveal profile (logged)" -> invite or message. Push the local commits
   when satisfied.
1. Owner: review the 3 local commits, push when satisfied (`git push origin
   mbe-branch`). Reload ARIA tabs (the stack here already runs the new app).
2. Owner: in Chrome, reload the ARIA extension (0.3.0) if not done; open a
   real sourced candidate with a LinkedIn URL; first look, then invite or
   message. Report anything odd in the LinkedIn section.
3. Tony: sign in as tony@aria.local on his machine (`docker compose up
   --build`, then `npm run demo:user -- --email tony@aria.local --name "Tony"`),
   own Chrome profile + extension, Settings › Integrations › LinkedIn.
4. Live check of "LinkedIn via web search" with a real Anthropic key
   (`docs/LOCAL-SOURCING-TEST.md`, now written for web search + GitHub).
5. Codex: re-audit and close the 2026-07-19 "direct sourcing adapters"
   finding if satisfied (move it to the closed-findings archive).
6. Before any new enrichment provider: fix the orchestrator gaps listed in
   the enrichment-spend finding (throwing runner leaks its claim; budget gate
   ignores the provider's cost; zero-cost registry entry never settles a real
   cost; failed results counted in spend), and re-apply identity-lookup
   hygiene in the runner (`clearIdentityResolution`).
7. Carried over: withdraw a pending invitation; per-candidate history
   backfill; link "Draft LinkedIn message" to the bridge composer; web
   search sourcing check; AI issue 04; store.ts split; chat multi-turn.

## Decisions made (don't relitigate)

- Owner 2026-11-06 (shift 456): Apify is retired for good: no sourcing, no
  enrichment, no key or card in Settings. LinkedIn discovery is Claude web
  search over public pages only. Do not reintroduce a vendor scraper without
  the owner asking.
- Owner 2026-11-06 (shift 455): mbe-test merged into mbe-branch (design,
  Pipeline overview, Docker-safe same-origin check).

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

- `tests/store-contracts.mts` pins the store action count (118): removing or
  adding an action updates it.
- `tests/sourcing-provider-egress-structure.mts` pins the probe allowlist:
  only `provider-egress.ts` and `src/app/api/source/route.ts` may use
  `clearProviderProbe`.
- `git rm` stages deletions immediately: a later "small" commit picks them
  up. Check `git diff --cached --stat` before every commit.
- eslint treats any function named `use...` as a React hook, test helpers
  included.

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
