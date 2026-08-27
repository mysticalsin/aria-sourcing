---
project: MSourcing / ARIA
shift: 192
agent: cursor-cloud
updated: 2026-08-27T20:53Z
status: tip-635eb4e-live-blocked-microsoft
---

# Handoff — Shift 192

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** tip **`635eb4e` LIVE** (`/api/ready` build=`635eb4e51fc6a04a5cefa5870a5710ab5fcb8201`)
- Microsoft Graph secrets recheck (2026-08-27T20:53Z): **ABSENT** — process env empty; `/tmp/owner-microsoft.env` missing; `production-readiness/.owner-microsoft.env` missing; Fly secrets only `MICROSOFT_REDIRECT_URI` (no CLIENT_ID/SECRET)
- Setup actions re-requested for `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`
- E2E not run (no secrets → no live Teams book)

## Done this shift

- Secrets recheck across env / files / Fly; confirmed still missing
- Re-requested cursor-cloud environment setup actions for MICROSOFT_CLIENT_ID/SECRET

## Blockers

- Owner: `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (+ auth Azure GoTrue flags)
- Investigate `handler:requisition_parse:rpc_http_404` so webhook→campaign materializes
- Hermes drafts still fail on env Kimi 401 (vault path is workspaceId/`serverGenerateText` only)

## Next steps

1. Owner provides non-placeholder MICROSOFT_CLIENT_ID/SECRET → `bash scripts/fly-apply-owner-microsoft-secrets.sh` → Settings → Enable webhook (Connect Outlook)
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
