---
project: MSourcing / ARIA
shift: 190
agent: cursor-cloud
updated: 2026-08-27T20:25Z
status: tip-live-vault-llm-ok-blocked-on-microsoft-and-loop-json
---

# Handoff — Shift 190

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** · tip **`3f74623`** was live (vault LLM); **follow-up tip pending** for `Dockerfile.prod` loop JSON COPY
- Vault LLM **proven live:** parse without `workspaceId` → kimi 401/`llm_required`; with workspaceId → **HTTP 200 modelUsed** (Anthropic vault)
- Intake E2E step **PASS** on Fly after vault tip
- **Loop worker crash-loop:** `ENOENT .../pipeline-transitions.json` — Dockerfile.prod copied worker.mjs but not the shared JSON. Fix staged in working tree (COPY both JSON files)
- E2E `3f74623`: **32 pass / 10 fail** — no campaign materialization (loop dead) + `microsoftOAuth=false` + no live Graph seat
- Microsoft secrets still missing on Fly

## Done this shift

- Shipped vault LLM fallback (`3f74623`): `resolveStoredLlmKeyForWorkspace` + lazy `serverGenerateText({ workspaceId })`
- Demo paths skip vault via `demoLoginEnabled || publicDemoSideEffectsDisabled()`
- Redeployed tip; ready+Graph 200; vault parse probe green
- Started loop machine; found ENOENT root cause; fixed Dockerfile.prod + audit assert
- Requested owner setup actions for MICROSOFT_CLIENT_ID/SECRET
- ManagePullRequest / `gh pr edit` unavailable (read-only integration)

## Blockers

- Owner: `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (and auth Azure GoTrue flags)
- Redeploy tip with Dockerfile.prod JSON COPY so loop can claim jobs
- Then: Connect Outlook → Enable webhook → `e2e-workflow-test.sh` (never skip live calendar)

## Next steps

1. Commit+push Dockerfile.prod JSON COPY; print-confirm → golive tip
2. Verify loop machine stays up (no ENOENT); webhook need → campaign materializes
3. Owner Microsoft secrets → Connect Outlook → full E2E PASS

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback workspace-scoped + `status=valid`
- Goal complete ONLY on full E2E PASS including live Teams book

## Watch out

- Loop `auto_stop`/suspend leaves only web started after deploy — start loop machine after tip if needed
- Hermes chat still hits env Kimi 401 for drafts (vault path is for `serverGenerateText` workspaceId callers; hermes may need separate wiring or env Anthropic)
