---
project: MSourcing / ARIA
shift: 469
agent: claude-code
updated: 2026-11-23
status: odoo-integration-built-awaiting-owner-review
---

# Handoff - Shift 469

## Current state

- New local branch `odoo` (from mbe-branch e3fa3f59), not pushed. Commits:
  1d6d914f (backend), 202eb194 (UI), 1910302c (docs/dev tooling), then this
  handoff. Gate green on every commit (typecheck, typecheck:tests, npm test;
  intermediate commits gated in worktrees) and eslint on the changed files; `bash tests/schema-authority-db.sh` passed
  (5 scenarios incl. new `odoo-integration`).
- mbe-branch untouched. The owner's stack (aria-sourcing-*, port 3000) was NOT
  rebuilt and runs mbe-branch 75f8b8bb as before; migration 0010 is NOT
  applied to it.
- Running for the owner to try (disposable, safe to remove):
  - Odoo 20 dev: `docker/odoo/docker-compose.yml` (project aria-odoo),
    http://localhost:8069, admin / admin, database `aria`, demo data, job
    "Senior Python Backend Engineer" (id 7) plus a few hired test applicants.
  - Disposable ARIA stack on the `odoo` branch: project aria-odoo-e2e,
    http://localhost:3010, admin@aria.local / admindemo123, Odoo already
    connected. Built with an override in the session scratchpad (own image
    tag aria-odoo-e2e-app:local, no .env.local, throwaway DATA_ENCRYPTION_KEY).
    Remove: `docker compose -p aria-odoo-e2e down -v` and
    `docker compose -f docker/odoo/docker-compose.yml down -v`.

## Done this shift

- Owner asked (FR): IT will use Odoo open source; make ARIA work with Odoo and
  explain where ARIA fits. Proposal in `docs/adr/0003-odoo-recruitment-system-of-record.md`
  (status proposed): Odoo Recruitment = system of record (jobs, applications,
  hires); ARIA = sourcing/engagement layer in front of it. Guide: `docs/odoo.md`.
- Built: JSON-2 client + mapping + Odoo operations + server authority
  (`src/lib/integrations/odoo/`), routes `/api/integrations/odoo/{config,check,jobs,links,applicants}`,
  migration `0010_odoo_integration.sql`, Settings > Integrations > Odoo,
  "Import from Odoo" on new campaign, Odoo strip on the campaign page,
  "Send to Odoo" in the candidate drawer.
- Verified against real Odoo (not from memory): `scripts/smoke-odoo.mts --write`
  14/14 on Odoo 19.0 and 20.0; Playwright walk on the disposable stack:
  connect, import job, parse, create (linked), add candidate, send, Odoo
  moves it, ARIA syncs Interviewed then Hired, the "open in Odoo" URL
  (`/odoo/hr.applicant/<id>`) shows the ARIA note.
- Facts found on real Odoo: no hr.candidate in 19/20 (18 only); Odoo 20
  JSON-2 accepts only API keys of scope `rpc` (UI default); hr.job.user_id
  became recruiter_id; message_post escapes HTML unless body_is_html; error
  bodies carry a full Python traceback; `=ilike` treats `_`/`%` as wildcards
  (fixed: escaped, test added).
- Intake: generic parser now reads an explicit "Required skills:" line
  (`src/lib/mock-ai.ts`); the Odoo brief avoids the Mantu-format markers.

## Blockers

- None. Waiting for the owner's review of ADR 0003 (positioning).

## Next steps

1. Owner: read the explanation / ADR 0003; accept or adjust the boundary
   (status proposed). Try it on http://localhost:3010 (Odoo already connected).
2. Owner/IT: which Odoo version (19 or 20) and where it is hosted; create the
   ARIA integration user and an RPC API key (docs/odoo.md "Connect Odoo").
3. Follow-ups in `.scratch/odoo-integration/spec.md` (01 push webhook,
   02 minimal-rights Odoo user, 05 server-side reveal check, 06 erasure).
4. To ship on mbe-branch: merge `odoo`, rebuild the owner's stack
   (applies migration 0010), check `DATA_ENCRYPTION_KEY` is set in .env.local.
5. Carried over from 468: demo campaign prep, empty AGENTS_LINKEDIN_ALLOWLIST
   after the demo, issue `.scratch/linkedin-bridge/issues/01-...`, VM POC
   (issue 07), server config (issue 10).

## Decisions made (don't relitigate)

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

- Odoo (branch `odoo`): never rebuild `aria-sourcing-app:local` for a test
  stack (the owner's agents service uses that tag with pull_policy never);
  use another project name, image tag and `env_file: !reset []`.
- Odoo: the hand-off route trusts the server copy of the candidate, not the
  browser, but does not check that a confidential profile was revealed (the
  drawer hides the button while masked). Follow-up 05.
- Odoo: the campaign strip moves candidates' stages on page open for users
  with `source`; Odoo outcomes override ARIA's own stage (by design, ADR 0003).
- Odoo: changing the Odoo address or database in Settings clears every
  campaign/applicant link (ids belong to the old database).
- `tests/odoo-integration.mts` replaces global fetch with an in-memory Odoo
  and restores it in its last test; keep that test last.

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
