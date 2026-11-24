---
project: MSourcing / ARIA
shift: 466
agent: claude-code
updated: 2026-11-12
status: poc-polished-for-presentation
---

# Handoff - Shift 466

## Current state

- Branch mbe-branch, local only (not pushed). Commits this shift:
  22c081df (sourcing extraction), dc0740b8 (POC scope, real LinkedIn sends,
  verify form). Gate green: `npm run typecheck && npm run typecheck:tests && npm test`
  (run in `aria-gate:local`), eslint clean on touched files.
- Docker app image rebuilt from dc0740b8 and restarted (`docker compose build app`,
  `up -d --no-build app agents`).
- Local DB, owner workspace `00000000-0000-4000-8000-000000000001` (data):
  Tony's sent LinkedIn message set `dryRun: false`, its two activities
  reworded (bridge send, "Approved for LinkedIn"), campaign metrics.contacted 1,
  Supabase integration description fixed. Backup before the edit:
  `/private/tmp/claude-501/-Users-michaelbernard-amaris-aria-sourcing/c5be0767-8d5f-473e-ba0e-418d01433443/scratchpad/workspace-state-backup-2026-11-12.json` (temporary dir).
  A "Candidate PII revealed" activity for Brice Challamel was added by the
  visual check of the verify form (truthful, harmless).
- The 9 existing demo candidates keep their old noisy headlines and 30-35
  scores: the new extraction applies to new sourcing runs only.

## Done this shift

- Owner request (FR): analyse the POC, polish weak points, exclude what does
  not work, before a presentation in a few days; demo storyline to be built
  together afterwards.
- Screenshot tour of all 20 pages (Playwright, `aria-demo:local`), findings:
  bridge send counted as simulated / "manually copied"; "Review 9 drafts"
  with no drafts; garbage headlines from search snippets; every web-sourced
  profile at 30/100 (cannot reach the 70 floor); contradictory integration
  badges; empty pages needing Outlook/Graph/careers site.
- Fixes: see commit messages of 22c081df and dc0740b8.

## Blockers

- None.

## Next steps

1. With the owner: build the demo storyline (fil conducteur). Suggested
   flow: New campaign from a pasted brief -> Run sourcing (LinkedIn via web
   search) -> open a profile, Reveal contact, Evidence tab "Verify the
   profile" -> score rises over 70 -> Draft LinkedIn message -> approve in
   Outreach = sent from own LinkedIn -> Reports / AI costs -> Autopilot card.
2. Decide whether to wipe and re-source the demo campaign so headlines and
   locations use the new extraction.
3. Rehearse untested-live items before showing them: "Run Aria" (home),
   "Several roles" (new campaign), Autopilot turn-on (contacts real people).
4. Reports Overview shows an annualized ROI (3x, $53,655) extrapolated from
   one day of activity: consider hiding it or explaining it in the demo.
5. Carried over: issue `.scratch/linkedin-bridge/issues/01-stale-candidate-conversation-link.md`,
   live autopilot test (issue 06), VM POC (issue 07), server config (issue 10).

## Decisions made (don't relitigate)

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages
  that need an integration this install does not run are left out of the
  navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`
  (Applicants, Talent pool, Replies, Calendar, Learning loop, Wins,
  Trust & ROI, Mailboxes, Skills). Empty the set to bring them back.
- Shift 466: a LinkedIn message recorded as sent (bridge or confirmed manual
  copy) is a real send (`dryRun: false`); the dry-run switch is email only.
- Shift 466: the scoring rule stays (unknown requested dimension = 30), so a
  public search result alone cannot reach the 70 floor. The way up is the
  recruiter's "Verify the profile" form (drawer, Evidence tab).

- Owner 2026-11-09 (shift 463/464), ADR 0002 (`docs/adr/0002-agents-runner.md`):
  an `agents` Compose service is allowed (amends ADR 0001). The campaign
  autopilot may queue LinkedIn invitations/messages WITHOUT a click per
  message, from the campaign owner's own paired account, under a standing
  approval the owner signs per campaign. POC goal: "is it possible", owner
  accepts the account risk. Sender = the autopilot owner (the user who
  turned it on); each user pairs their own LinkedIn.
- Owner 2026-11-09: VM POC (B3) = real visible Chrome, one profile per user,
  each user signs in to LinkedIn there themselves. NO session-cookie copy, NO
  proxies / fingerprint changes / random delays (re-confirmed). App and
  agents run on a server; the VM is only for the browsers.
- Owner 2026-11-09: higher AI budget is fine. GDPR for algorithm-decided
  contacts: "later, the project is not ready" (do not block on it).
- Owner 2026-11-09 (shift 462): approving a LinkedIn outreach message is the
  human decision to send it: approval queues it on LinkedIn (no separate
  "manual send" or send click). Still never automatic: nothing queues a
  LinkedIn write without a person's click (approval, Send, Enter).
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
  automated can queue a LinkedIn message, EXCEPT the campaign autopilot of
  ADR 0002 (2026-11-09).
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
- Browser missions (Run Aria, Triage inbox, follow-ups) still run client-side
  on store actions; the campaign autopilot runs server-side (ADR 0002).
- Sourcing spends only an admin vault key; the env/.secret key serves chat and
  local dev. Deterministic fallbacks everywhere; human approval before any send.
- UX: English UI ("Talent pool"), one /100 score, no personal credit (Mantu
  Group mention), Carlito self-hosted, nav per audit §4 with one "New campaign".
- Careers stays outside the workspace store provider (test-enforced); demo
  roles come from the API, not the browser store.
- Tutorial never opens on its own (owner, 2026-11-02). Contact basis can be
  recorded on synthetic demo profiles (owner, 2026-11-02).

## Watch out

- The verify-profile form shows only after "Reveal contact (logged)" on a
  confidential candidate (`!masked` gate in the drawer): rehearse it.
- The locked guardrail text in settings ("never automate LinkedIn DMs ...
  assisted-manual copy/paste") predates the bridge; the decision says the
  guardrail prompt stays unchanged, so it was left as is.

- `.env.local` on this Mac now has `AGENTS_ENABLED=true` (added shift 464).
  The runner ticks every minute but nothing runs until someone turns on an
  autopilot. Turning one on in the owner's workspace WILL contact real
  people from the owner's LinkedIn when his extension is running.
- `linkedin-e2e@bridge-e2e.test`: its password was reset in shift 464 (GoTrue
  admin API, local sample service key) for the agents e2e; set a new one the
  same way when needed. Its workspace was restored after the test
  (campaign back to Interviewing, Linus Sourced, GitHub additions removed,
  agent rows and the simulated bridge account deleted). Its sourcing job and
  provider receipt rows remain.
- Do not pass a short `ARIA_RELEASE_SHA` to `docker compose build`: the
  metadata script rejects it; leave it unset.
- The app image is now tagged `aria-sourcing-app:local` and shared by the
  `agents` service (`pull_policy: never`).
- Agents spend the shared AI caps (`AI_MONTHLY_BUDGET_USD`, default 30;
  `AI_DAILY_BUDGET_USD`, default 6). Raise them in `.env.local` for longer runs.
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
- Browser missions stop when the tab closes; the autopilot does not (server).
- Under tsx a module can load twice; use `isAgentTimeout`, not `instanceof`.
