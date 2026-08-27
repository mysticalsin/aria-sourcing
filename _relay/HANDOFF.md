---
project: MSourcing / ARIA
shift: 188
agent: cursor-cloud
updated: 2026-08-27T19:37Z
status: vault-llm-fallback-feasible-anthropic-present
---

# Handoff — Shift 188

## Current state

- **PR #32** · tip **`6797061`** live on Fly (prior shift)
- **Still blocked E2E:** Fly env `KIMI_API_KEY` 401; no `MICROSOFT_CLIENT_ID/SECRET`
- **Vault LLM probe (read-only, counts only):** 1 workspace has keys; **valid Anthropic + valid Kimi (Moonshot)** in `api_keys` (legacy plaintext form; `DATA_ENCRYPTION_KEY` present on Fly). Also HeyReach×2, Apify, Tavily — all `status=valid`.
- **Finding:** `serverGenerateText` is **env-only** today. Cron already has workspace vault pattern for Apify/Tavily (`resolveStored*KeyForWorkspace`). Session vault helper `resolveVaultSecret` **cannot** be used from cron (needs user + `current_workspace_id`). Safe fallback is feasible if scoped by `workspaceId` + `status=valid` + never log secrets.

## Done this shift

- Investigated vault → autonomous parse/draft fallback path (no code change yet)
- Live DB probe: LLM vault keys exist (Anthropic can unblock if wired)

## Blockers

- Owner rotate Fly `KIMI_API_KEY` **or** ship vault fallback + use Anthropic vault
- Owner: `MICROSOFT_CLIENT_ID/SECRET` still missing

## Next steps

1. Optional minimal wire: `resolveStoredLlmKeysForWorkspace(workspaceId)` + `serverGenerateText({ workspaceId })` after env 401/403; pass `workspaceId` from draft cron + parse cron/worker
2. Owner LLM rotate still works without code: `/tmp/owner-llm.env` → `fly-apply-owner-llm-secrets.sh`
3. Owner Microsoft secrets → Connect Outlook → E2E

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback must be **workspace-scoped** (job/`workspaceId`); fail closed if none

## Watch out

- `parse-inbound-need` body has **no** `workspaceId` today — worker has `job.workspace_id` but does not send it
- Do not use `resolveVaultSecret` on cron paths (no session)
- Prefer `status=valid` filter (stricter than Apify/Tavily ForWorkspace helpers)
