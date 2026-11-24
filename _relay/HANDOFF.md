---
project: MSourcing / ARIA
shift: 474
agent: cursor
updated: 2026-11-23 23:17 America/Sao_Paulo
status: 178-merged-twa-odoo
---

# Handoff - Shift 474

## Current state

- Pull request 178 merged current twa-odoo `a27373efae80fc438f48405ef0a3b683a29c2685` with a merge commit. Do not squash-merge 178 until the gates pass and Ultron confirms. No force push.
- The LinkedIn token channel stays in `src/channels/linkedin-token/` and stays off until an owner or admin records the risk notice. The release gate also requires the LinkedIn token Playwright job.
- Synthetic hire Playwright is job `synthetic-hire-e2e` in `.github/workflows/ci.yml`. It runs `bash scripts/e2e-synthetic-hire.sh`, which serves the app on loopback and runs `e2e/synthetic-hire.spec.ts` against `/demo/hire`. Fixture hosts are `*.example.test`. The release gate requires that job. `scripts/e2e-mac.sh` runs only `e2e/linkedin-token.spec.ts`.
- Shared config for the ordered pull request stack lives in .gitleaksignore, docker-compose.yml, scripts/accept-local-demo.mjs, .github/workflows/ci.yml, and _relay/HANDOFF.md.
- The agents service healthcheck signals pid 1 with process.kill(1, 0), interval 5s, timeout 5s, retries 12, start_period 5s.
- Branch cursor/aria-stack-shared-config, based on twa-odoo. Later stack branches take this version of those five files.
- Merged twa-odoo 70e72d6c (the squash of pull request 251) with a merge commit. The agents healthcheck stays process.kill(1, 0) with interval 5s, timeout 5s, retries 12, and start_period 5s. The cmdline probe from that squash is not the shared probe. Line allowlists in .gitleaks.toml stay, and they do not allowlist a path.

- Branch mbe-branch, local only (not pushed). HEAD = 75f8b8bb
  (fix(intake): keep skills Claude reworded from the brief's own words).
  Gate green (typecheck, typecheck:tests, npm test exit 0). App + agents
  restarted on the image rebuilt from 75f8b8bb; /api/health healthy.
- Owner workspace still empty (wiped shift 467): no campaign yet for the demo.
- LinkedIn bridge: owner account paired (extension 0.3.0), last seen
  2026-11-10; 6 outbox rows, all sent. A conversation with Tony exists.
- The owner's demo cheat sheet is a private Claude Doc, not in the repo
  (owner asked: never commit it).

## Done this shift

- Synthetic hire Playwright spec `e2e/synthetic-hire.spec.ts` covers the fixture `/demo/hire` page: Odoo vacancy close, unset connector, and hired on SMART, the generic HTTPS API, and MCP. Local run with `CI=true`: 2 passed, 0 failed.
- Demo-day check: OrbStack was stopped; started it, stack came back healthy
  (the db answered slowly for the first minutes after boot).
- Playwright smoke of every in-scope page (/, /campaigns, /campaigns/new,
  /candidates, /funnel, /outreach, /exec, /costs, /sessions, /settings,
  /linkedin -> settings): no console error, no 5xx.
- Live parse of "Load Mantu need" (no campaign created): Claude returned 7
  Murex skills, `groundLiveIntakeFields` dropped them all (exact-substring
  check vs reworded skills). Fixed: a skill is also grounded when every word
  (or its plural) is in the brief; invented words still drop it. Test added
  in tests/intake-grounding.mts. Re-tested live: Murex skills kept.

## Blockers

- None.

## Next steps

1. Owner, before the demo: create the demo campaign and run sourcing ahead
   of time; verify one profile (Reveal contact -> Evidence & contact ->
   Save and rescore), record the contact basis, draft for Tony only.
2. Owner: Chrome open with the ARIA extension and LinkedIn signed in.
3. After the demo: empty AGENTS_LINKEDIN_ALLOWLIST before real autopilot use.
4. Carried over: issue `.scratch/linkedin-bridge/issues/01-stale-candidate-conversation-link.md`,
   VM POC (issue 07), server config (issue 10).

## Decisions made (don't relitigate)

- 2026-11-21: the five shared files above are canonical on cursor/aria-stack-shared-config. Later pull requests merge that branch with an ordinary merge and keep this version of those files.
- 2026-11-21: the agents healthcheck is process.kill(1, 0) with interval 5s, timeout 5s, retries 12, and start_period 5s. The agents service stays in docker-compose.yml.
- 2026-11-23: pull request 251 landed on twa-odoo as 70e72d6c. This branch merged that commit and kept process.kill(1, 0). The two wantTokenMAC fingerprints are different digests.
- 2026-11-23: pull request 272 landed on twa-odoo as 4730a158. This branch merged that commit. The public-repo hygiene test is in this tip, and history was not rewritten.
- 2026-11-21: pull request 168 deletes LinkedIn bridge routes and strips LinkedIn dispatch. Pull request 167 keeps its approval hash, allowlist, and kill switch on the remaining send path and does not restore the deleted LinkedIn files.

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages
  that need an integration this install does not run are left out of the
  navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`
  (Applicants, Talent pool, Replies, Calendar, Learning loop, Wins,
  Trust & ROI, Mailboxes, Skills). Empty the set to bring them back.
- Shift 466: a LinkedIn message recorded as sent (bridge or confirmed manual
  copy) is a real send (`dryRun: false`); the dry-run switch is email only.
- Owner 2026-11-12: the demo campaign is wiped; a new one will be prepared
  for the presentation. The Reports ROI stays and the demo script explains it
  is an extrapolation for the demo.
- Owner 2026-11-12: the untested features are to be validated without
  messaging real people. Autopilot demos and tests run with
  `AGENTS_LINKEDIN_ALLOWLIST` set (on this Mac: Tony's profile only).
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

- Public-repo hygiene: addresses in relay notes and goal records at this tip are placeholders. `tests/public-repo-hygiene.mts` rejects a private-key block, a non-sample linkedin.com/in/ URL outside `tests/`, and a non-placeholder address outside `tests/`. History was not rewritten.

- Remove or empty `AGENTS_LINKEDIN_ALLOWLIST` in `.env.local` (and restart
  the app) before any real autopilot use beyond the demo; set but invalid
  means the agent contacts nobody.
- Manual approvals in Outreach are not restricted by the allowlist: in the
  demo, approve only Tony's message.

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
