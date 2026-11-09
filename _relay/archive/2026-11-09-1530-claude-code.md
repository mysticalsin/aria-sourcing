---
project: MSourcing / ARIA
shift: 464
agent: claude-code
updated: 2026-11-09
status: agents-autopilot-poc-built
---

# Handoff - Shift 464

## Current state

- Branch mbe-branch, local only (not pushed). HEAD = this baton on top of:
  1006fdc1 agents runner service + Autopilot card, 5f0a2166 campaign
  autopilot (tick, routes, bridge agent entry, migration 0009), 8479dbab
  refactor (shared transitions/prompts/vault/sourcing providers).
- Gate on 1006fdc1's tree: typecheck, typecheck:tests, npm test exit 0;
  eslint clean on every touched file. New suite `agents-autopilot` (13
  tests, fakes); `linkedin-bridge` 32/32 with the rewritten invariant.
- Stack on this Mac rebuilt from 1006fdc1: 6 running services (agents is
  new), migration 0009 applied, `/api/ready` 200, `POST /api/agent/tick`
  401 with a wrong secret, `idle` with the right one. No autopilot exists
  in any workspace.
- Verified on the real local DB, e2e workspace only: run-now -> source-start
  -> source-advance (GitHub, 3 added) -> source-finished (picked Linus, 85)
  -> contact failed "no LinkedIn connected". With a simulated paired account
  (no extension) and relationship `none`: invitation queued in the outbox
  (template copy, 299 chars), outreach "Pending Manual Send" approved by
  "ARIA agent for linkedin-e2e"; outbox set to `sent` by hand -> next tick:
  candidate Contacted, message Scheduled, two campaign activities. UI card
  screenshotted at 1440 and 390 px, no horizontal overflow.
- NOT verified: a real LinkedIn send by the agent (needs the owner's paired
  extension running and an autopilot on one of his campaigns); a Claude-
  written note (the e2e workspace has no Anthropic key, template used).
- Study, decisions and issues: `.scratch/autonomous-agents/` (issues 01-05
  resolved, 06 ready-for-human (live run), 07 VM POC ready-for-human,
  08-10 needs-triage).
- Earlier shifts' state (LinkedIn bridge, candidate panel, Apify retired):
  `_relay/archive/2026-11-09-1430-claude-code.md`.

## Done this shift

Owner (2026-11-09): "add a container to the infra to create agents on my
Claude key: auto-source running campaigns, contact the 3 best on LinkedIn
automatically, later email managers and read managers' mailboxes; later VMs
with the app and the extension connected." Then decisions A-E, then "start
coding, stop when done".

- Study + ADR 0002 + issues (commits 7c8bcd0c, ff9eca16, 886b997b).
- `agents` service: `scripts/agents-runner.mjs` (clock only, no DB creds,
  no model key) -> `POST /api/agent/tick` (`AGENT_RUNNER_SECRET`, off unless
  `AGENTS_ENABLED=true`).
- `src/lib/agents/tick.ts`: one bounded step per tick (follow-ups; one
  contact; or one sourcing step). Deps in `src/lib/agents/server/deps.ts`;
  authority (`ownerAuthority`: delegation + scope + workspace + role) in
  `authority.ts`; `workspace_state` writes with the concurrency token in
  `workspace.ts`; server copy in `draft.ts`; pure rules in
  `src/lib/agents/autopilot.ts` (eligibility, top N, plan, note <= 300).
- `src/lib/linkedin-bridge/agent.ts`: the agents' only way into the outbox
  (`agentMayQueue` re-reads autopilot + delegation before each insert).
- Migration `0009_agents_runner.sql`: `agent_delegations`,
  `agent_campaign_autopilots`, `agent_missions`, `agent_outreach`
  (service role only).
- `/api/agent/autopilot` + `src/components/agents/campaign-autopilot-card.tsx`
  on the campaign page (settings, consent, run now, turn off, stop all agents,
  contacts and missions).
- Docs: DOCKER.md (six services), docs/linkedin-bridge.md ("Campaign
  autopilot"), ADR 0002 implementation notes, linkedin-policy header.

## Blockers

- None in code. The live POC needs the owner: his extension running, an
  autopilot on a campaign of his.

## Next steps

1. Owner, live B2 test: Chrome open with the ARIA extension (0.3.0) paired;
   pick ONE campaign in Sourcing/Outreach with a reviewed brief; campaign
   page -> Autopilot card -> settings (e.g. contacts per run 1, min score
   80) -> tick the consent -> Turn on autopilot -> Run now. Watch the card
   (Picked -> Checking LinkedIn -> Waiting for your browser -> Sent) and
   `docker compose logs -f agents`. Raise `AI_*_BUDGET_USD` if needed.
2. Record the result in `.scratch/autonomous-agents/issues/06-missions-m2-m3.md`
   (resolve it if a real invitation/message went out).
3. Issue 07 (VM bridge host): Linux VM with a visible Chrome (Xvfb + noVNC
   or a desktop), one Chrome profile per user, extension pointed at the
   server's HTTPS origin; keep the daily log listed in the issue for 7 days.
4. Issue 10 (server config) before any non-local deployment: the compose
   file holds public sample secrets, including `AGENT_RUNNER_SECRET`.
5. Follow-ups: separate AI caps for agents; issue 08 (manager email after a
   confirmed send; `campaign.hiringManagerEmail` already exists); issue 09
   (mailbox intake).
6. Carried over from shift 463: owner reloads the extension (0.3.0); Tony's
   setup; Codex re-audits (direct sourcing adapters finding, enrichment
   orchestrator gaps); withdraw invitation; store.ts split.
7. Codex audit focus: `src/lib/linkedin-bridge/agent.ts`,
   `src/lib/agents/tick.ts` (crash/idempotency: message_id recorded before
   the workspace write; outbox dedupe on candidate+kind),
   `src/app/api/agent/autopilot/route.ts` (ownership takeover rules),
   `src/lib/agents/server/workspace.ts` (conflict retry vs the browser store).

## Decisions made (don't relitigate)

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
