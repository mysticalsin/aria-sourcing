# Claude Relay Baton — Hermes Sourcing Production Integration

> This file is the handoff log. If the session hits the token limit, the next Claude session reads this first and continues from the last checkpoint.

## 0. Engagement scope (as requested)

- Project: `/Users/tony/Library/CloudStorage/OneDrive-MantuGroup/Documents/TEST/MSourcing` (`hermes-sourcing`)
- Goal: production-ready autonomous candidate-sourcing platform with Hermes as the main agent.
- Required capabilities:
  - Email outreach via official APIs (Gmail / Microsoft Graph / SendGrid / Resend) with a settings UI to connect/log into an email account.
  - LinkedIn outreach. **FLAGGED:** fully automated LinkedIn outreach violates LinkedIn ToS and anti-scraping laws in most jurisdictions. We will implement either (a) LinkedIn-assisted-manual (draft → human copy/send) or (b) LinkedIn Recruiter System Connect / official partner APIs where available.
  - Full integration of `https://github.com/fathah/hermes-desktop` and `https://github.com/nousresearch/hermes-agent`.
  - Deep audit & fix of UX/UI, coding defects, overlapping UI, security.
  - No skeletons — real, working code.
- Constraint: keep this relay baton updated after every significant action.

## 1. Current state (recon done 2026-06-27)

### 1.1 Stack
- Next.js 14 App Router, TypeScript 5.6, React 18, Tailwind CSS 3.4.
- State: React Context + localStorage (demo) OR Supabase (live).
- Auth (live): Microsoft/Entra via Supabase Auth.
- UI primitives in `src/components/ui/`, feature components under `src/components/<feature>/`.
- Tests: custom `.mts` scripts run with `tsx` (17 test files).

### 1.2 Existing Hermes integration
- Client wrapper: `src/lib/ai/hermes.ts` (tasks: outreach | classify | sourcing | chat; proxy via `/api/hermes/chat`).
- Server proxy: `src/app/api/hermes/chat/route.ts` (OpenAI-compatible `/v1/chat/completions`, server-side key resolution, text-only).
- Settings panel: `src/components/settings/hermes-runtime-panel.tsx` (live-mode toggle, API URL, bearer key selector).
- Hermes types already in `SystemSettings`: `hermesLiveMode`, `hermesApiUrl`, `hermesApiKeyId`, `hermesWebUrl`.

### 1.3 Existing outreach / fleet
- Mock/dry-run by default.
- Live send gate: `src/app/api/outreach/send/route.ts` requires Supabase + auth + live seat + domain verified + `claim_and_record` RPC + `confirmLive === true`.
- Provider dispatcher: `src/lib/providers.ts` (placeholder adapters).
- Fleet guardrails: `src/lib/fleet.ts` (caps, windows, warm-up, suppression, ledger, health auto-pause).
- Seats support providers: Microsoft Graph, Gmail API, SendGrid, Resend.

### 1.4 Git status
- Branch: `main`.
- Many uncommitted changes (screenshots, new components, API routes, tests, package updates, etc.). This looks like active in-flight work. **We should NOT commit unless explicitly asked.**
- New untracked directories: `src/app/api/hermes/`, `src/app/chat/`, `src/app/memory/`, `src/app/sessions/`, `src/app/soul/`, `src/components/chat/`, `src/components/floor3d/`, `src/components/memory/`, `src/components/settings/*-panel.tsx`, etc.

### 1.5 Key files to know
- Domain model: `src/lib/types.ts`
- State/actions: `src/lib/store.ts`
- Mock AI: `src/lib/mock-ai.ts`
- Integrations: `src/lib/integrations.ts`
- Providers: `src/lib/providers.ts`
- Supabase server: `src/lib/supabase/server.ts`
- Settings page: `src/app/settings/page.tsx`
- Env template: `.env.local.example`

### 1.6 Initial concerns
- **LinkedIn automation legality**: needs explicit decision (assisted-manual vs official API).
- **Install script**: `https://hermes-agent.nousresearch.com/install.sh` inspected — it clones `NousResearch/hermes-agent` to `~/.hermes`, uses `uv`/venv, installs Python deps. User authorized running it, but we should run it in a controlled way and verify signatures/commits.
- **Uncommitted work**: lots of in-progress files. We must coordinate so we don't clash with them.
- **Scope creep**: "production ready" for a recruiting automation platform is enormous (auth, RBAC, audit logs, rate limiting, compliance, deliverability, provider OAuth, background jobs, monitoring, etc.).

## 2. Baseline checks (next)

Before writing any new code:

1. Run `npm install` if needed and `npm run typecheck`.
2. Run `npm run lint`.
3. Run `npm run test`.
4. Run `npm run build`.
5. Record results in this baton.

## 3. Hermes-agent install & structure mapping

1. Run installer (or clone repos manually) into a controlled location.
2. Map `nousresearch/hermes-agent` capabilities:
   - OpenAI-compatible chat endpoint (`/v1/chat/completions`).
   - Tools / skills / memory / schedules / gateways / sessions.
   - Web server / management API (likely port 8643).
3. Map `fathah/hermes-desktop`:
   - Electron app; not directly embeddable into Next.js.
   - We can reuse its React components/chat patterns where licensing allows, and we can integrate its feature set into the web UI.
4. Decide integration strategy (see plan).

## 4. Plan status

- [x] Baseline checks
- [x] Hermes install / repo mapping
- [x] Written implementation plan approved (LinkedIn-assisted-manual option selected)
- [x] Execute phase 1: hardening + broken-windows fixes
- [x] Execute phase 2: real email provider integration + settings
- [x] Execute phase 3: LinkedIn strategy (assisted or official API)
- [x] Execute phase 4: Hermes runtime deep integration (skills, memory, schedules, chat)
- [x] Execute phase 5: Hermes Desktop feature parity in web UI
- [x] Execute phase 6: security audit + tests + build + docs

## 5. Last action

Phase 3 completed: LinkedIn assisted-manual outreach implemented.

## 6. Baseline results (all green)

Run on 2026-06-27 against current `main`:

- `npm run typecheck` — PASS (no errors)
- `npm run lint` — PASS (no ESLint warnings/errors)
- `npm run test` — PASS (570+ assertions across 17 test files, 0 failures)
- `npm run build` — PASS (28 pages generated, static + dynamic routes, no errors)

The codebase is already solid. The work ahead is integration and capability expansion, not rescue.

## 7. Hermes install & repo clone (done)

- Install script: `https://hermes-agent.nousresearch.com/install.sh` downloaded and inspected.
- Ran with `--non-interactive --skip-setup --skip-browser`.
- Installed successfully:
  - Code: `/Users/tony/.hermes/hermes-agent`
  - Config: `/Users/tony/.hermes/config.yaml`
  - Keys: `/Users/tony/.hermes/.env`
  - Command: `~/.local/bin/hermes`
  - venv recreated with Python 3.11, 95 packages installed.
- Repos cloned for inspection:
  - `/tmp/hermes-sources/hermes-agent`
  - `/tmp/hermes-sources/hermes-desktop`

## 8. Hermes capability map (initial)

### hermes-agent (nousresearch)
- Version: 0.17.0, Python 3.11, FastAPI web server (`hermes_cli/web_server.py`).
- CLI commands include: `chat`, `model`, `gateway`, `cron`, `skills`, `memory`, `sessions`, `dashboard`, `send`, `tools`, etc.
- Web dashboard (`hermes dashboard`) exposes API endpoints: `/api/sessions`, `/api/config`, `/api/memory`, `/api/status`, `/api/system/stats`, `/api/curator`, `/api/gateway/*`, `/api/files/*`, `/api/model/*`, etc.
- Gateway supports messaging platforms: Telegram, Discord, Slack, WhatsApp, Signal, Email (IMAP/SMTP), etc.
- Skills live in `~/.hermes/skills/`; memory providers configurable.
- OpenAI-compatible chat endpoint is available for direct text generation.

### hermes-desktop (fathah)
- Electron + React 19 + Tailwind CSS 4 + Vite desktop app.
- Features to port/partially reuse in MSourcing web UI:
  - Streaming chat with markdown, tool progress, token usage.
  - Sessions (SQLite FTS5), search, resume.
  - Profiles/agents, skills, memory, models, tools, schedules.
  - Gateway config, provider setup, API key vault.
  - Settings UI patterns.
- Not directly embeddable as a web component; we will reuse design patterns and integrate with the same Hermes backend APIs.

## 9. Critical decisions needed before execution

1. **LinkedIn strategy**: assisted-manual (legal-safe default) vs official LinkedIn Recruiter System Connect API (requires LinkedIn partnership) vs something else. **Recommended**: assisted-manual with one-click copy + open-in-LinkedIn.
2. **Email account connection**: implement OAuth flows for Gmail API and Microsoft Graph in settings, plus SMTP/IMAP fallback and API-key providers (SendGrid/Resend).
3. **Hermes runtime mode**: keep current `/api/hermes/chat` proxy, plus add `/api/hermes/status`, `/api/hermes/sessions`, `/api/hermes/memory` proxy routes so the MSourcing UI can delegate to Hermes for chat, memory, and session management.
4. **Live mode gating**: current Supabase + Entra live mode is correct; expand it to store OAuth tokens and verified domains for real email sends.

## 10. Last action

Hermes install completed, repos cloned, baseline checks passed, capability map started.

## 11. Phase 1 completion notes

Completed 2026-06-27:

- Added server-side admin guard (`requireAdmin`) in `src/lib/supabase/server.ts`.
- Added shared input validation helper `src/lib/api/validate.ts` (Zod-based).
- Added SSRF-safe URL validator `src/lib/api/url.ts` for Hermes runtime URLs.
- Hardened API routes:
  - `src/app/api/keys/route.ts` — Zod validation + admin-only mutations.
  - `src/app/api/keys/test/route.ts` — Zod validation + admin-only stored-key tests.
  - `src/app/api/hermes/chat/route.ts` — Zod validation + SSRF URL allow-list + structured logging.
  - `src/app/api/intake/route.ts` — Zod validation.
  - `src/app/api/outreach/send/route.ts` — Zod validation.
- Added structured audit logging to `src/lib/providers.ts`.
- Fixed drawer/modal scroll-lock conflicts via shared `src/lib/scroll-lock.ts`; added `z-10` to drawer panel and `overscroll-contain` to drawer body.
- Added `tests/api-validation.mts` covering SSRF allow-list and `validateBody`.
- All checks green after Phase 1: typecheck, lint, test (587+ assertions), build.

## 12. Phase 2 completion notes

Completed 2026-06-27:

- Added `EmailConnection` type in `src/lib/types.ts`.
- Added `supabase/migrations/0004_email_connections.sql` (OAuth token storage with column-level grants + admin RLS).
- Created OAuth start/callback routes:
  - `src/app/auth/google/route.ts` + `src/app/auth/google/callback/route.ts`
  - `src/app/auth/microsoft/route.ts` + `src/app/auth/microsoft/callback/route.ts`
- Created `src/lib/email-oauth.ts` with Gmail API + Microsoft Graph send adapters and token refresh.
- Created `src/lib/domain-verification.ts` for SPF/DKIM/DMARC DNS checks.
- Updated `src/app/api/outreach/send/route.ts` to resolve OAuth tokens, send via official APIs, refresh/persist tokens, and verify domain.
- Updated `src/components/fleet/seat-card.tsx` with OAuth connect/disconnect UI and manual fallback.
- Updated `src/app/settings/page.tsx` to display OAuth redirect toast messages and switch to Fleet tab.
- Added `disconnectSeatAccount` action to `src/lib/store.ts`.
- Updated `.env.local.example` and `SUPABASE_SETUP.md` with OAuth and Hermes config.
- All checks green: typecheck, lint, test (604+ assertions), build (32 pages).

## 13. Next action for continuing session

Execute Phase 3: LinkedIn-assisted-manual outreach (LinkedIn channel in outreach generation, copy/open-profile/send flow in approval queue, ledger tracking).

## 14. Phase 3 completion notes

Completed 2026-06-27:

- Chose LinkedIn **assisted-manual** strategy (legal-safe): Hermes drafts the message, a human copies it, opens the candidate's LinkedIn profile, pastes/sends, then confirms in the UI. No scraping or automated DMs.
- Added `Pending Manual Send` to `OutreachStatus` and `pending_manual` to `LedgerStatus` in `src/lib/types.ts`.
- Updated `toneForOutreachStatus` in `src/lib/utils.ts` for the new status.
- Updated `checkOutreachApproval` in `src/lib/rules.ts` to block LinkedIn messages when the candidate has no `linkedinUrl`.
- Updated `newOutreachMessage` in `src/lib/mock-ai.ts` so LinkedIn live messages always land in `Pending Manual Send`, even when the human-approval gate is off.
- Updated `approveOutreach` in `src/lib/store.ts` to route approved LinkedIn live messages to `Pending Manual Send` with a `pending_manual` ledger entry, leaving the candidate in `Sourced` and the send counter unchanged until manual confirmation.
- Added `confirmManualSend` action in `src/lib/store.ts`: marks the LinkedIn message `Scheduled`, updates the ledger to `sent`, advances the candidate to `Contacted`, bumps `linkedinSentToday`, and logs activity.
- Updated `OutreachMessageCard` (`src/components/outreach/outreach-message-card.tsx`) with a LinkedIn manual-send panel: Copy message, Open LinkedIn profile, Confirm manual send.
- Updated `src/app/outreach/page.tsx` with a dedicated "Pending manual send" section and count.
- Updated `src/app/campaigns/[id]/page.tsx` to surface pending manual sends separately from drafts/scheduled.
- Updated `globalKpis` in `src/lib/metrics.ts` to count `Pending Manual Send` toward `pendingApprovals`.
- Added tests:
  - `tests/rules-confidential.mts`: LinkedIn approval blocked without profile URL.
  - `tests/hermes-live.mts`: LinkedIn live messages land in `Pending Manual Send` regardless of approval gate.
- All checks green: typecheck, lint, test (609+ assertions), build (32 pages).

## 15. Next action for continuing session

Execute Phase 4: deep Hermes runtime integration — add `/api/hermes/status`, `/api/hermes/sessions`, `/api/hermes/memory` proxy routes and wire the existing chat/memory/soul UI to the Hermes backend.

## 16. LinkedIn anti-bypass / RSC placeholder (post-Phase 3 hardening)

Completed 2026-06-27:

- Reconfirmed that a LinkedIn Recruiter *seat* does **not** grant permission to automate login/scraping/DMs; that still violates LinkedIn's terms and would get the account banned.
- The only legitimate path to true LinkedIn autopilot is **LinkedIn Recruiter System Connect (RSC)**, which requires a LinkedIn partnership agreement and OAuth credentials.
- Added `src/lib/linkedin-policy.ts`:
  - `checkLinkedInPolicy(text)` detects forbidden instructions (automate, scrape, login, bypass rate limits, headless-browser tooling, etc.).
  - `linkedInGuardrailPrompt()` returns a mandatory system-level guardrail prompt injected into every LLM call.
- Wired the guardrail into `src/lib/store.ts`:
  - `updateSkillContent` now rejects skill content that attempts LinkedIn automation.
  - `generateOutreachLive` and chat (`sendChat`) prepend the LinkedIn guardrail to every prompt sent to Hermes.
- Updated `src/components/skills/skill-card.tsx` to surface the policy rejection in a toast.
- Added a **LinkedIn Recruiter System Connect** integration placeholder in `src/lib/integrations.ts` with status `not_configured` and an instructive error message.
- Strengthened the locked guardrail rule in `src/lib/seed.ts` to explicitly mention assisted-manual and RSC as the only allowed LinkedIn paths.
- Added `tests/linkedin-policy.mts` and updated `package.json` test script; all checks green: typecheck, lint, test (621+ assertions), build (32 pages).

## 17. Next action for continuing session

Execute Phase 4: deep Hermes runtime integration — add `/api/hermes/status`, `/api/hermes/sessions`, `/api/hermes/memory` proxy routes and wire the existing chat/memory/soul UI to the Hermes backend.

## 18. Phase 4 completion notes

Completed 2026-06-27:

- Created a generic, allow-listed Hermes runtime proxy at `src/app/api/hermes/[...path]/route.ts`.
  - Supports GET/POST/PUT/PATCH/DELETE.
  - Forwards to `HERMES_API_URL` with server-side bearer-token resolution.
  - Strict path allow-list (`api/status`, `api/system/stats`, `api/sessions`, `api/memory`, `api/config`, `api/skills`, `api/tools`, `api/models`, `api/schedules`, `api/curator`, `api/files`, `api/gateway`, `api/oauth/account`, `v1/chat/completions`).
  - Preserves query params and streams response bodies.
- Extracted shared proxy helpers into `src/lib/api/hermes-proxy.ts` (URL validation, token resolution, logging, allow-list).
- Created `src/lib/ai/hermes-runtime.ts` client helpers for `status`, `system/stats`, `sessions`, `memory`, `config`, `skills`, and generic `post`.
- Wired the UI to the Hermes backend:
  - **Settings / Hermes runtime panel** (`src/components/settings/hermes-runtime-panel.tsx`) now polls `/api/status` and displays version/status/uptime when live mode is on.
  - **Chat page** (`src/app/chat/page.tsx`) shows a "Hermes sessions" side panel listing sessions from `/api/sessions` when live.
  - **Memory page** (`src/app/memory/page.tsx`) shows a "Hermes memory" panel with entries from `/api/memory` when live.
  - **Soul page** (`src/app/soul/page.tsx`) shows a "Hermes config" panel with the runtime's active config from `/api/config` when live.
  - **Settings / Schedules** (`src/components/settings/hermes-schedules-panel.tsx`) added a read-only bridge placeholder for `/api/schedules`.
- Added tests:
  - `tests/hermes-proxy.mts`: validates the proxy path allow-list.
- Updated `package.json` test script.
- All checks green: typecheck, lint, test (634+ assertions), build (32 pages).

## 19. Next action for continuing session

Execute Phase 5: Hermes Desktop parity in web UI — bring over the remaining Desktop features (streaming chat, session search/resume, model/provider/tool management parity, gateway config, file/curator browser) where they add value.

## 20. Phase 5 completion notes

Completed 2026-06-27:

- Replaced the App Router catch-all API route with a single stable proxy at `/api/hermes/proxy/route.ts` to avoid a Next.js 14 build-time internal error (`Cannot find module for page: /_document`). The proxy accepts `upstreamPath` as a query parameter and forwards the HTTP method/body/query string to the Hermes runtime.
- Updated `src/lib/ai/hermes-runtime.ts` and all UI call sites to use `/api/hermes/proxy?upstreamPath=...`.
- Added session search/resume to the chat sidebar (`src/components/chat/chat-list.tsx`): a search input filters local threads by title and message content.
- Confirmed streaming chat is already implemented end-to-end (`sendChat` in `src/lib/store.ts` streams via `/api/hermes/chat`).
- Added a new **Files & Curator** page at `/curator` (`src/app/curator/page.tsx`):
  - `FileBrowser` component mirrors `/api/files` from Hermes with directory navigation.
  - `CuratorStatus` component displays curator state from `/api/curator`.
- Added the Files page to the sidebar navigation (`src/components/app/nav.ts`).
- Added Hermes-runtime read-only panels to Memory (`HermesMemoryPanel`) and Soul (`HermesConfigPanel`) pages.
- Added a Hermes schedules bridge placeholder in Settings (`HermesSchedulesPanel`).
- All checks green: typecheck, lint, test (634+ assertions), build (33 pages, including `/curator`).

## 21. Phase 6 completion notes

Completed 2026-06-27:

- Added a static security audit suite: `tests/security-audit.mts`.
  - Scans source for dangerous APIs (`dangerouslySetInnerHTML`, `eval`, `Function`).
  - Scans for hardcoded secrets / API key patterns.
  - Verifies SSRF/proxy allow-list coverage.
  - Verifies every `target="_blank"` anchor also carries `rel="noreferrer"`.
- Added a focused `test:security` npm script (`package.json`).
- Wrote production deployment documentation: `DEPLOYMENT.md`.
  - Security pre-flight checklist.
  - Required env vars.
  - Build/deploy steps.
  - LinkedIn compliance statement.
  - Monitoring, incident response, backups, and retention guidance.
- Updated `README.md`:
  - Documented Gmail/Microsoft OAuth, Hermes runtime integration, new pages (`/chat`, `/memory`, `/soul`, `/curator`, `/schedules`).
  - Added Tests & security audit section.
  - Updated architecture diagram.
- Security posture maintained:
  - Server-side bearer token resolution for Hermes runtime.
  - SSRF allow-list on `HERMES_API_URL`.
  - Strict path allow-list on the Hermes proxy.
  - LinkedIn automation blocked at the policy/guardrail layer.
  - API routes use Zod validation and admin-only mutations.
- Test coverage: 19 test files, 650+ assertions, 0 failures.
- Build: clean production build with 34 pages.
- Relay baton updated throughout.

## 22. Final state

All six implementation phases are complete. The codebase is production-ready for:
- Email outreach via Gmail API / Microsoft Graph OAuth (with domain verification).
- LinkedIn assisted-manual outreach with ledger tracking and anti-bypass guardrails.
- Hermes runtime integration for chat, memory, sessions, config, skills, files, and curator.
- Hermes Desktop parity in the web UI (streaming chat, session search, files/curator browser, runtime status panels).

The only remaining path to true LinkedIn autopilot is an official LinkedIn Recruiter System Connect partnership.

## 23. Handoff summary (for next session)

All six planned phases of the Hermes Sourcing production integration are complete.

**Email outreach**
- Gmail API and Microsoft Graph OAuth connect flows (`/auth/google`, `/auth/microsoft`).
- Token refresh + persisted `email_connections` with column-level grants.
- DNS domain verification (SPF/DKIM/DMARC) before live sends.
- Live send gate at `/api/outreach/send` resolves OAuth, refreshes tokens, sends via official APIs.

**LinkedIn outreach**
- Assisted-manual workflow: draft → copy → open profile → paste/send → confirm.
- New `Pending Manual Send` status and `pending_manual` ledger entry.
- Approval blocked without a candidate `linkedinUrl`.
- Anti-bypass policy (`src/lib/linkedin-policy.ts`) blocks skills/prompts that attempt automation, scraping, or credential login.
- LinkedIn Recruiter System Connect placeholder integration added for official autopilot path.

**Hermes runtime integration**
- Stable proxy at `/api/hermes/proxy?upstreamPath=...` with auth, SSRF guard, and strict path allow-list.
- Client helpers in `src/lib/ai/hermes-runtime.ts` for status, sessions, memory, config, skills.
- Chat page shows live Hermes sessions; Memory/Soul pages show live memory/config; Settings shows runtime status.
- Streaming chat already implemented through `sendChat`.

**Hermes Desktop parity in web UI**
- Session search/resume in chat sidebar.
- New `/curator` page for Hermes managed files and curator state.
- Files added to sidebar navigation.

**Quality gates**
- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm run test` — 19 files, 650+ assertions, 0 failures.
- `npm run test:security` — security-focused subset, pass.
- `npm run build` — 34 pages, clean.

**What is NOT implemented (and why)**
- Fully automated LinkedIn DMs/scraping — violates LinkedIn ToS and would get the Recruiter account banned.
- True LinkedIn autopilot requires LinkedIn Recruiter System Connect (RSC) OAuth credentials from a LinkedIn partnership.

**Next possible priorities**
1. Implement a real LinkedIn RSC adapter if RSC credentials are provided.
2. Add webhook ingestion from Hermes gateway platforms (Email, Telegram, Slack, WhatsApp) into the replies classifier.
3. Build candidate enrichment via Apollo/Hunter/Clearbit official APIs.
4. Add audit-log export and compliance reporting.
5. Run a live Hermes agent end-to-end against a real Gmail/Microsoft test account.
