---
project: MSourcing / ARIA
shift: 448
agent: claude-code
updated: 2026-10-30
status: ai-layer-on-claude-foundation-blocked-on-workspace-id
---

# Handoff - Shift 448

## Current state

- Branch mbe-branch. Owner (2026-10-30) switched the whole AI layer to one
  Anthropic key, with a model tier per task and a future agent system.
- The key is in `.secret` at the repo root (bare `sk-ant-...` line). `.secret`
  is now in `.gitignore` AND `.dockerignore` (it was in neither; the Dockerfile
  does `COPY . .`). Verified with `git check-ignore -v .secret`.
- The key authenticates but is NOT scoped to an Anthropic workspace. Every call
  returns 400 "This API key is not scoped to a workspace, so this request must
  include the anthropic-workspace-id header". `/v1/organizations/workspaces`
  returns 403 for this key. No paid call has been made; only free
  `count_tokens` probes.
- Foundation code is in place (see Done). Gate green on it: typecheck,
  typecheck:tests, npm test (exit 0). Live behavior against the API is untested
  (blocked, below).
- Spec and tickets: `.scratch/ai-agents/spec.md`, `.scratch/ai-agents/issues/01..08`.

## Done this shift

1. `src/lib/ai/local-secret.ts` + `src/instrumentation.ts`: at server start
   (nodejs runtime) copy `ANTHROPIC_API_KEY` / `ANTHROPIC_WORKSPACE_ID` from
   `.secret` into process.env when unset. Allow-list only; logs names, never values.
2. `src/lib/ai/provider.ts`: `anthropicHeaders()` adds `anthropic-workspace-id`
   from env; `ANTHROPIC_TASK_PROFILE` (classify low/1024, chat low/8192,
   outreach medium/8192, sourcing medium/16000) sent as `output_config.effort`
   only for models that support effort (`anthropicSupportsEffort`);
   `parseCloudResponse` joins text blocks (Claude 5.5 returns a thinking block
   first, the old `content[0].text` read would be empty); DEFAULT_MODEL
   anthropic = claude-sonnet-5-5.
3. `src/lib/ai/tool-loop.ts`: same headers and task profile in the Anthropic loop.
4. Routes: `/api/hermes/chat` passes `task`, never sends the "hermes" model
   placeholder to a cloud provider. `/api/sourcing-agent` treats a cloud
   provider with no linked workspace key as not configured -> deterministic
   sourcing (was a 503 that the new Anthropic default would have triggered).
5. Seed STATE_VERSION 18: Anthropic enabled+default, Kimi disabled; saved
   models Haiku 5.5 (classification), Sonnet 5.5 (sourcing, outreach, chat),
   Opus 5.5 (saved, no task default). Migration resets the model layer of
   pre-18 blobs and keeps any provider's linked `apiKeyId`.
6. Tests: tests/ai-provider.mts and tests/admin-config.mts updated/extended.
7. Owner answers (2026-10-30): GDPR validated for Claude; budget 20-30 EUR/month;
   goal is a usable demo with every feature; public demo host will get the keys.
8. `src/lib/ai/usage.ts`: price table (Haiku/Sonnet/Opus 5.5, unknown ids
   priced above Opus), per-instance in-memory ledger for the UTC day/month,
   caps AI_MONTHLY_BUDGET_USD (default 30) and AI_DAILY_BUDGET_USD (default 6).
   Checked before every Anthropic call in /api/hermes/chat and each tool-loop
   round; usage recorded from every response (one JSON log line, no content).
   Past a cap: chat returns ok:false (client uses its mock), sourcing runs
   deterministic.
9. Agent system, first slice (owner: "tests then the agentic part"):
   `src/lib/agents/mission.ts` (plan runner: deps, fan-out, shared concurrency
   semaphore, per-agent timeout, abort, fallback, events) and
   `src/lib/agents/campaign-mission.ts` (sourcing agent -> one Sonnet drafting
   agent per top-6 candidate, 2 at a time). Wired into
   `src/components/run/agent-run-stream.tsx` (campaign "Run Aria"), which
   previously drafted with the template only. New optional
   `OutreachMessage.draftedBy: "ai" | "template"`; UI badge shows it.
   Tests: tests/agent-mission.mts (registered in tests/test-manifest.mjs).
   Verified in the synthetic demo with Playwright (camp_seed_design, the one in
   Sourcing): 6 sourced + 6 drafts in 8 s; the 6 Claude calls got 400 (no
   workspace id) and fell back to templates; scrollWidth 390 at 390 px.
10. Live tests still blocked: `.secret` has only the key. `/v1/organizations/me`
   works (org "Tony's Individual Org"); every other endpoint needs the
   workspace header.

## Blockers

- Still open after the owner's answers: Anthropic workspace id needed from the owner (`wrkspc_...`, Console ->
  Settings -> Workspaces), or a workspace-scoped key. Add to `.secret` as
  `ANTHROPIC_WORKSPACE_ID=wrkspc_...` on its own line.

## Next steps

1. When the workspace id is in `.secret`: run issue 01 (free count_tokens on
   haiku/sonnet/opus 5.5, then one real call per task, total < $0.05).
2. Issue 02 remainder: persist the ledger (DB table in the Supabase stack, so
   it survives restarts and is shared) and show month/day spend in Settings.
   Do it before any feature that fans out calls.
3. Issue 03 (Haiku extraction task for intake), 04 (prompt caching).
4. 05 orchestrator: next mission = inbound replies (Haiku classify -> reply
   draft). Same engine; keep agents on top of store actions.
5. Resume UX audit packages (02, 07, 05, 06, 04, 08, 09, 10) when the owner
   asks; AI work does not depend on them.
6. Node: `export PATH="/c/Users/michael.bernard_amar/AppData/Local/Temp/aria-node-runtime/node-v22.23.4-win-x64:$PATH"`.

## Decisions made (don't relitigate)

- All AI runs on Claude via one Anthropic key (owner, 2026-10-30). This
  supersedes the shift-446 "no paid calls" rule for Anthropic, within budgets.
- Model per task: Haiku for classification/extraction, Sonnet for drafting,
  chat and the sourcing loop, Opus only by explicit choice or escalation.
- Agents run in-process (ADR 0001: no separate AI server or worker platform).
- Budget 20-30 EUR/month for a demo with all features; GDPR for candidate data
  sent to Claude is validated by the owner (2026-10-30).
- Sourcing spends only an admin-created workspace (vault) key; the env/.secret
  key serves the admin chat path and local dev.
- Deterministic fallbacks stay for every AI surface; human approval before any send.
- Earlier: English UI, no personal credit, Calibri/Carlito, single /100 score,
  no secrets in Git/relay, no Docker/WSL install, no auto retry.

## Watch out

- The public demo (vercel-demo) ran on a Kimi env key. After merging this
  branch it needs ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID for this key type).
- The in-app spend cap is per server instance and resets on restart. The hard
  ceiling must be a spend limit on the Anthropic workspace (owner, Console).
- Requests still use anthropic-version 2023-06-01 and raw fetch; SDK move is issue 08.
- `max_tokens` / `refusal` stop reasons are not handled explicitly yet (issue 07).
- Missions run in the browser: closing the tab stops queued agents. React
  Strict Mode double-mounts in dev; the panel defers its unmount abort one
  tick for that reason (an immediate abort froze the run on "Sourcing...").
- Under tsx tests a module can load twice (ESM + CJS), so cross-module
  `instanceof` on custom errors fails; use `isAgentTimeout` (name check).
- `/api/sourcing-learning/feedback` returns 503 in the synthetic demo on page
  load (pre-existing, unrelated to AI).
