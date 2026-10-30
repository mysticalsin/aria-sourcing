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

## Blockers

- Anthropic workspace id needed from the owner (`wrkspc_...`, Console ->
  Settings -> Workspaces), or a workspace-scoped key. Add to `.secret` as
  `ANTHROPIC_WORKSPACE_ID=wrkspc_...` on its own line.

## Next steps

1. When the workspace id is in `.secret`: run issue 01 (free count_tokens on
   haiku/sonnet/opus 5.5, then one real call per task, total < $0.05).
2. Issue 02 usage ledger + budgets before any feature that fans out calls.
3. Issue 03 (Haiku extraction task for intake), 04 (prompt caching).
4. 05 orchestrator needs triage with the owner (spec section 5 and 7).
5. Resume UX audit packages (02, 07, 05, 06, 04, 08, 09, 10) when the owner
   asks; AI work does not depend on them.
6. Node: `export PATH="/c/Users/michael.bernard_amar/AppData/Local/Temp/aria-node-runtime/node-v22.23.4-win-x64:$PATH"`.

## Decisions made (don't relitigate)

- All AI runs on Claude via one Anthropic key (owner, 2026-10-30). This
  supersedes the shift-446 "no paid calls" rule for Anthropic, within budgets.
- Model per task: Haiku for classification/extraction, Sonnet for drafting,
  chat and the sourcing loop, Opus only by explicit choice or escalation.
- Agents run in-process (ADR 0001: no separate AI server or worker platform).
- Sourcing spends only an admin-created workspace (vault) key; the env/.secret
  key serves the admin chat path and local dev.
- Deterministic fallbacks stay for every AI surface; human approval before any send.
- Earlier: English UI, no personal credit, Calibri/Carlito, single /100 score,
  no secrets in Git/relay, no Docker/WSL install, no auto retry.

## Watch out

- The public demo (vercel-demo) ran on a Kimi env key. After merging this
  branch it needs ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID for this key type).
- Candidate PII will go to Anthropic: owner must confirm the GDPR frame before
  real candidate data is processed (spec section 7).
- Requests still use anthropic-version 2023-06-01 and raw fetch; SDK move is issue 08.
- `max_tokens` / `refusal` stop reasons are not handled explicitly yet (issue 07).
