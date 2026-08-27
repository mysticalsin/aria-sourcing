---
project: MSourcing / ARIA
shift: 193
agent: cursor-cloud
updated: 2026-08-27T20:55Z
status: tip-635eb4e-live-blocked-microsoft
---

# Handoff — Shift 193

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** on `cursor/enterprise-autopilot-b91d` (base `integration/sourcing-enrichment-on-main`)
- Live Fly tip **`635eb4e`** (`/api/ready` build=`635eb4e51fc6a04a5cefa5870a5710ab5fcb8201`, mig=`0067_mcp_allowlist_select_grants.sql`, status=ready) — newer than historical tip `dfa70ec`
- Graph `validationToken` probe still **HTTP 200** (echo body)
- Microsoft secrets recheck (20:55Z): **ABSENT** — Cursor process env empty; `/tmp/owner-microsoft.env` missing; `production-readiness/.owner-microsoft.env` missing; Fly has `MICROSOFT_REDIRECT_URI` + `KIMI_*` only (no `MICROSOFT_CLIENT_ID`/`SECRET`)
- Optional LLM owner files also absent (`/tmp/owner-llm.env`, `.owner-llm.env`); Kimi already on Fly; vault LLM fallback proven
- Entra auto-create watch still fails: insufficient privileges for `twalteur@amaris.com` (Application.ReadWrite.All needed)
- cursor-cloud setup actions re-requested (MICROSOFT_CLIENT_ID/SECRET required; optional DeepSeek/Kimi; write owner env file)
- E2E **not run** — blocked on secrets / live seat; goal remains active
- Working tree clean at local HEAD `9159c00` (relay-only ahead of Fly tip)

## Done this shift

- Timer recheck: secrets (env/files/Fly), `/api/ready`, Graph validationToken
- Re-requested environment setup actions for Microsoft Graph credentials
- Confirmed no uncommitted concurrent work to discard

## Blockers

- Owner: non-placeholder `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (+ GoTrue Azure flags) → apply via `bash scripts/fly-apply-owner-microsoft-secrets.sh` → Connect Outlook / Enable webhook
- Investigate `handler:requisition_parse:rpc_http_404` so webhook→campaign materializes
- Hermes drafts still fail on env Kimi 401 (vault path is workspaceId/`serverGenerateText` only)

## Next steps

1. Owner provides MICROSOFT_CLIENT_ID/SECRET → write `/tmp/owner-microsoft.env` → `bash scripts/fly-apply-owner-microsoft-secrets.sh` → Settings Connect Outlook + Enable webhook (seat mode=live)
2. Then: `export FLY_API_TOKEN="$(tr -d '\n\r ' < production-readiness/.fly-token.env)"`; `eval "$(bash scripts/print-fly-e2e-env.sh --export)"`; `bash e2e-workflow-test.sh` (never `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`)
3. Debug `requisition_parse` rpc_http_404 with real job payload
4. Optionally unset public `ARIA_WEB_INTERNAL_URL` once 6PN `::` bind verified

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback workspace-scoped + `status=valid`
- Goal complete ONLY on full E2E PASS including live Teams book

## Watch out

- After deploy, start loop machine if suspended (`flyctl machine start <loop-id>`)
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`
- Secret `ARIA_WEB_INTERNAL_URL` overrides `[env]` — remove after `::` bind verified on 6PN
- Do not re-spam Entra app create until privileges granted (see tip `dfa70ec`)
