---
project: MSourcing / ARIA
shift: 189
agent: cursor-cloud
updated: 2026-08-27T19:50Z
status: vault-llm-fallback-wired-awaiting-deploy
---

# Handoff — Shift 189

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** · prior tip **`6797061`** live on Fly; vault LLM fallback **wired locally (uncommitted → about to commit)**
- `serverGenerateText({ workspaceId })` lazy-falls back to `resolveStoredLlmKeyForWorkspace` after env 401/403 (or missing env key)
- Worker + parse/draft/intake/critics pass `workspaceId`; demo paths skip via `demoLoginEnabled || publicDemoSideEffectsDisabled()`
- **Still blocked E2E:** no `MICROSOFT_CLIENT_ID/SECRET` on Fly (Teams book). Env `KIMI_API_KEY` still 401 — vault Anthropic should unblock LLM after redeploy

## Done this shift

- Implemented `resolveStoredLlmKeyForWorkspace` (`status=valid`, workspace-scoped)
- Wired `workspaceId` through parse cron, worker, draft cron, intake, recruiting-graph critics, approve/send
- Demo paths omit `workspaceId` so they never touch `getServiceSupabase`
- HANDOFF retains `print-fly-deploy-confirm` for audit 45/45

## Blockers

- Owner: `MICROSOFT_CLIENT_ID/SECRET` still missing → cannot complete live Teams book
- Redeploy tip required before vault fallback is live on Fly

## Next steps

1. Commit + push vault LLM fallback; update PR #32
2. `print-fly-deploy-confirm.sh` → `fly-enterprise-golive-when-ready.sh`
3. Probe ready + Graph validationToken 200
4. If LLM vault works: `e2e-workflow-test.sh` (never `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`)
5. Owner Microsoft secrets → Connect Outlook → full E2E PASS

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback must be **workspace-scoped** (job/`workspaceId`); fail closed if none
- Prefer `status=valid` filter (stricter than Apify/Tavily ForWorkspace helpers)
- Do not use `resolveVaultSecret` on cron paths (no session)

## Watch out

- Lazy vault only when `workspaceId` set AND (env missing OR env auth failed)
- Public demo must never pass `workspaceId` into live critics / intake vault path
