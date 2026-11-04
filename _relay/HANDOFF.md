---
project: MSourcing / ARIA
shift: 452
agent: claude-code
updated: 2026-11-04
status: pipeline-redesigned-docker-run-still-pending
---

# Handoff - Shift 452

## Current state

- Branch mbe-test (pushed). Gate green at 19ef9d34 (typecheck,
  typecheck:tests, npm test exit 0; eslint clean on touched files).
- Local Docker stack: app, db, auth, rest, gateway (Caddy 2.11.7) + the two
  init jobs. Still NOT run on a real Docker engine (none on this Windows
  machine; running the downloaded Caddy binary was refused again by the
  auto-mode guard, even with a matching release checksum). The owner will run
  it on a Mac (arm64 and amd64 images both exist).
- Every image has a native arm64 variant (checked on the registry):
  supabase/postgres 17.6.1.136, supabase/gotrue v2.189.0, postgrest v14.12
  (arm64 build differs from amd64 but has `postgrest` in PATH), caddy
  2.11.7-alpine, the pinned postgres:17-bookworm digest, node:22-bookworm-slim.
- Caddyfile semantics checked against the Caddy v2.11.7 source: header value
  `*` = any present value; several `not` lines merge into one NOT(any) = AND
  of negations; `{$VAR:default}` splits on the first colon; `{err.*}` maps to
  `{http.error.*}`; `respond` in handle_errors defaults to the error status.
- AI issues (`.scratch/ai-agents/issues/`): 01, 02, 03, 09 resolved; 04
  ready-for-human; 05 ready-for-agent; 06, 07, 08 needs-triage.
- `_relay/codex-findings.md` now holds only the 8 open findings (owner
  credential rotations, re-audits, Azure Postgres); the 146 closed ones are in
  `_relay/archive/codex-findings-closed-2026-11-03.md`.

## Done this shift (owner: "Pipeline: tout est mélangé, peu clair")

- 19ef9d34 Pipeline page (/funnel) redesigned for the recruiter who uses it:
  one board of candidates only, columns = next action (To contact, Awaiting
  reply, Replied, To book, Interviewing, Offer out, Hired) grouped under the
  TAnIA stages; campaign scope selector (all open campaigns or one), search,
  source chips, "overdue only" toggle; late cards first (limits per column,
  awaiting reply = settings follow-up gap); "To contact" cards show the
  candidateReview blocker or "Message awaiting approval"; cards open the
  CandidateDrawer in place; drops only on Interviewing/Offer/Hired (same
  manual stages as the drawer). Chatbox and Need columns removed (link to
  /applicants, scope selector). FlowMatrix folded into a <details>.
  Model: `src/lib/pipeline.ts`, test `tests/pipeline.mts` (manifest).
  Checked in Chrome via Playwright on `next dev -p 3100` (desktop, mobile,
  drawer, overdue filter, no console errors).
- Working on a Mac now: Node is `~/.nvm/versions/node/v24.14.1/bin`.

## Blockers

- None in code. Unverified until the owner's Mac run: the whole Docker stack
  through Caddy.

## Next steps

1. Owner on Mac: `git pull`, `docker compose up --build` (or
   `npm run demo:up`). If `up` fails, `docker compose logs supabase-bootstrap`
   names the failing gateway check (`[gateway] FAIL ...`); then
   `docker compose logs gateway auth rest`. On a running stack:
   `npm run demo:doctor`.
2. Web search source on the stack: link the Anthropic key on the Anthropic
   provider (Settings -> AI & Models), run "LinkedIn via web search" once,
   check AI costs shows "Web search sourcing" and that titles/companies look
   right (2c56f788).
3. AI issue 04: one chat question with 2+ tool rounds, then
   `cache_read_input_tokens` > 0 on /costs; set it resolved.
4. On a pre-rename volume: bootstrap log "admin@hermes.local is now
   admin@aria.local", then log in with the new email.
5. Deferred until the Docker run is green (owner agreed to the review list):
   split `src/lib/store.ts` (6.1k lines) by domain (sourcing, outreach,
   candidates, settings); `tests/module-boundaries.mts` guards cycles.
6. Chat as real multi-turn messages (needs a `/api/ai/chat` contract change;
   keep S-3: persona never in `system`).
7. Perf ideas left: page-level getClaims only pays off with asymmetric GoTrue
   keys (GOTRUE_JWT_KEYS); load `@supabase/ssr` only when Supabase is
   configured; split seed/mock-ai out of the store chunk.
8. Node (Mac): `export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"`.
9. Pipeline: in demo mode 44 of 46 cards show late because the seed
   timestamps sit 7-16 days before SEED_NOW; if the owner wants a calmer demo,
   move seed activity closer to SEED_NOW (check exec-dashboard/scoring tests).

## Decisions made (don't relitigate)

- Owner 2026-11-03: the Docker stack targets a Mac; do not spend effort on Windows-specific Docker issues.

- Owner 2026-11-03: Vercel is dropped; the app will be self-hosted later
  (target not chosen). Merging into vercel-demo is no longer a goal.
- Owner 2026-11-03: no local LLM / Ollama for now; AI stays on the Anthropic key.
- Owner 2026-11-03: Kong replaced by Caddy as the API gateway.
- Owner 2026-11-03: no stealth scraping or bot-detection evasion; LinkedIn
  discovery without Apify goes through Claude's web search on public indexed
  pages (`WebSearch` source).
- Owner 2026-11-03: no "hermes" in the code (product is Aria). Keep only the
  compatibility reads listed in Current state.
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

- Pipeline day counts use SEED_NOW when Supabase is not configured (same as
  the calendar), Date.now() otherwise.

- `_relay/codex-findings.md` keeps open findings only: when closing one, move
  it to the archive file of closed findings.

- The bootstrap job now depends on the gateway: a gateway regression shows up as a failed supabase-bootstrap, not as an unhealthy app.
- `getClaims()` falls back to `getUser()` with the HS256 secret used here.

- Store hooks: a `useSlice` selector must return a stable reference (a field or
  a found item). Build arrays with `useMemo` on the slice, and use the
  module-level `NO_ITEMS` for `?? []` fallbacks, or React loops on getSnapshot.
- `tests/module-boundaries.mts` rejects import cycles, type-only ones included
  (TutorialMemory lives in `tutorial-panel.tsx` for that reason).
- `tests/motion-foundation.mts` greps `providers.tsx` for "framer-motion",
  comments included.
- `next dev` can get stuck in a Fast Refresh full-reload loop; restart it.
- Several files use CRLF line endings: multi-line `perl`/`sed` edits silently
  miss on them; use the Edit tool.
- `git add` with a path that no longer exists aborts the add; check
  `git show --stat` after committing.
- `.next/types` keeps stale routes after a page moves: `npx next typegen`.
- Missions run in the browser: closing the tab stops queued agents.
- Under tsx a module can load twice; use `isAgentTimeout`, not `instanceof`.
