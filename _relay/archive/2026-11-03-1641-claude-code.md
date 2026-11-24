---
project: MSourcing / ARIA
shift: 450
agent: claude-code
updated: 2026-11-03
status: claude-web-search-source-added
---

# Handoff - Shift 450

## Current state

- Branch mbe-branch. Gate green at the last commit (typecheck, typecheck:tests,
  npm test exit 0); `npm run lint` 0 errors (2 old warnings).
- Local Docker stack: app, db, auth, rest, **gateway (Caddy 2.11.7)** + the two
  init jobs. Kong is gone. The compose file and `docker/Caddyfile` were NOT run
  on Docker here (no Docker on this machine; running a downloaded Caddy binary
  was refused by the auto-mode guard). First real proof = the CI job
  "Local Docker demo" (`npm run test:local-demo`) on the next push.
- AI issues (`.scratch/ai-agents/issues/`): 01, 02, 03, 09 resolved; 04
  ready-for-human (code done, live check pending); 05 ready-for-agent; 06, 07,
  08 needs-triage.
- No "hermes" left in the code except deliberate compatibility (old browser
  keys, saved hermes* settings stripped on load, the bootstrap renaming an old
  `admin@hermes.local`). Demo login is now `admin@aria.local` / `admindemo123`.
- `_relay/codex-findings.md`: 8 open (owner credential rotations, re-audits,
  Azure Postgres); 12 obsolete July entries closed as wontfix (obsolete).

## Done this shift (owner: tasks 1-3 of the review + "piste A")

Resource use:
- Store (`src/lib/store.ts`): hooks subscribe to their slice with
  `useSyncExternalStore` (`useSlice`), actions come from a stable context,
  workspace status from its own context (`useWorkspaceStatus`). A commit now
  re-renders only components whose slice changed. `useHermes()` still exists
  (re-renders on every commit); `useHermesStateGetter()` for handlers.
- Lazy chunks: Recharts (drawer gauge, campaign score distribution, exec spark,
  weekly report funnel, trust ROI), the tutorial panel
  (`tutorial-panel.tsx`), the Aria Live overlay + framer-motion
  (`aria-live-host.tsx` loads `aria-live-overlay.tsx` only during a run). No
  global `MotionConfig`: each animated component uses `usePrefersReducedMotion`
  (test-enforced in `tests/motion-foundation.mts`).
- Claude: tool loop sends the system prompt with a cache breakpoint
  (`anthropicCachedSystem`) + top-level `cache_control` (history cached between
  rounds). Single calls unchanged: TASK_SYSTEM prompts are 40-210 tokens, under
  the 512-token minimum. Chat sends only the last 20 messages
  (`CHAT_HISTORY_MESSAGES`).
- Removed: `playwright-core` runtime dependency (still a dev dependency via
  `playwright`), `public/aria-logo.png`, `public/brand/mantu-agents-reference.png`.
- Browser smoke on the synthetic demo (dev :3123, 1440 px): 9 pages, campaign
  detail chart, candidate drawer gauge, a settings toggle, tutorial panel and
  Aria Live overlay all load; no console errors, no React update loops.

Docker:
- Kong replaced by Caddy (`docker/Caddyfile`, ADR 0001 amendment 2026-11-03):
  only /auth/v1 and /rest/v1, key check (anon/service, header or query) with
  GoTrue's verify/callback/authorize/JWKS open, bare key -> Bearer, CORS
  preflight answered, everything else 404. Static contract test:
  `tests/gateway-contract.mts`. Host port variable `API_PORT` (was KONG_PORT;
  CI updated).
- Deleted orphans: `docker/db/*` (Fly era), `docker/kong.yml`,
  `docker/kong-entrypoint.sh`, the unused COPY in `docker/bootstrap/Dockerfile`.
- Health checks: 30 s interval + `start_interval: 2s` (needs Docker Engine 25+);
  json-file logs capped at 3 x 10 MB per permanent service; BuildKit cache
  mounts for npm and `.next/cache` in `Dockerfile`.

Owner follow-up (same day): "retirer hermes", "Play demo, solution la plus
propre", then push.
- 337232aa Play demo: `pickAriaLiveCampaign` (aria-live-policy.ts) uses the
  sourcing lifecycle rule (`campaignAllowsLiveSourcing`): active campaign if it
  qualifies, else the first that does, else a clear message; the run selects
  it (restored on close) and records legitimate interest through
  `recordCandidateEvidence` before approval. Browser: 7/7 steps, funnel 1/1/1/1/1.
- 7cd10cff removed the retired Hermes runtime path (settings, chat SSE path,
  HERMES_ALLOWED_HOSTS, `hermes`/`hermes-agent`/`gateway` allow-listed hosts,
  route placeholder "hermes" -> "none").
- Rename commit: WorkspaceState/WorkspaceActions/WorkspaceProvider/useWorkspace,
  `src/lib/ai/generate.ts` + `aiGenerate`, `/api/ai/chat`, AriaMark/AriaWordmark/
  AriaLockup, package `aria-sourcing`, tests `ai-generate` / `ai-chat-authority`,
  storage keys `aria-sourcing:v1` / `aria:onboarded:v1` (old keys read),
  bootstrap account rename. Issue demo-cleanup 05 resolved.

Docs/tracking: NEEDS_GUIDE rewritten against the code; goals of July marked
ABANDONED (superseded by the 2026-10-26 scope reset); AI spec table and issues
07, cleanup 01 (wontfix) and 06 (resolved) updated; July plans carry a
"Superseded" banner.

Owner request (same day): "sourcing sans Apify payant, avec la clé Anthropic".
Stealth headless-browser scraping that evades bot detection was declined
(LinkedIn terms, CNIL Kaspr 2024 precedent, account bans); the owner accepted
the alternative below.
- New source "LinkedIn via web search" (`WebSearch`) in the reviewed campaign
  plan, between Apify and GitHub. `src/lib/sourcing/claude-web-search.ts`:
  Claude `web_search_20250305`, `allowed_domains: ["linkedin.com/in"]`, 2-5
  searches per run; leads only from `web_search_result` blocks, canonical
  profile URLs, cited text as snippet; queries failing the LinkedIn sourcing
  policy have their results dropped. Workspace vault Anthropic key only (linked
  on the Anthropic provider), AI budget checked, spend recorded as activity
  `web-sourcing` ($0.01 per search added to `estimateCostUsd`). Migration
  `0005_web_search_source.sql` allows 3 steps per run. Issue:
  `.scratch/unified-sourcing/issues/03-claude-web-search-source.md`.
- Real bounded check with the dev key (scratch script, not the app): seed
  campaign "Senior Backend Engineer Go Kubernetes", limit 5 -> 1 search, 5
  linkedin.com/in profiles, 8 s, 17.7k input tokens, $0.054. Headline parsing is
  best effort: some page titles carry the company where the title should be.

## Blockers

- None in code. Unverified: the Caddy gateway on a real Docker stack (see
  Current state).

## Next steps

0. Web search source: on the Docker stack (migration 0005 applies on
   `docker compose up --build`), link the Anthropic key on the Anthropic
   provider (Settings -> AI & Models), run "LinkedIn via web search" once on a
   Sourcing campaign, check AI costs shows "Web search sourcing".
1. Pushed. Check the CI job "Local Docker demo" (login, campaign,
   restart through the new gateway). If it fails, read `docker compose logs
   gateway`. Quick manual probe on a running stack: `curl -i
   localhost:54321/rest/v1/` must be 401, the same with `-H "apikey: <anon>"`
   must reach PostgREST, `localhost:54321/storage/v1/` must be 404.
2. AI issue 04: one chat question that triggers 2+ tool rounds, then check
   `cache_read_input_tokens` > 0 on /costs; set the issue resolved.
3. On a Docker volume created before the rename, check the bootstrap log line
   "admin@hermes.local is now admin@aria.local" and a login with the new email.
4. Chat as real multi-turn messages (needs a `/api/ai/chat` contract change;
   keep S-3: persona never in `system`).
5. Remaining perf ideas (not done): `getClaims()` instead of `getUser()` in
   `src/proxy.ts`; load `@supabase/ssr` only when Supabase is configured; split
   seed/mock-ai out of the store chunk.
6. Node: `export PATH="/c/Users/michael.bernard_amar/AppData/Local/Temp/aria-node-runtime/node-v22.23.4-win-x64:$PATH"`.

## Decisions made (don't relitigate)

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
