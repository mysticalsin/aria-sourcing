---
project: MSourcing / ARIA
shift: 191
agent: cursor-cloud
updated: 2026-08-27T20:45Z
status: tip-635eb4e-live-blocked-microsoft
---

# Handoff — Shift 191

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** tips: `3f74623` (vault LLM) → `9100109` (loop JSON in image) → `04cd00d` (HOSTNAME=`::`) → **`635eb4e` LIVE**
- Live proven: ready+Graph **200**; vault parse **modelUsed** after Kimi env 401; intake E2E step PASS
- Loop: JSON ENOENT fixed; 6PN ECONNREFUSED fixed via temporary secret `ARIA_WEB_INTERNAL_URL=https://aria-mantu-app.fly.dev` + HOSTNAME=`::` tip; ticks reach `status=ok` (dispatch/graphRenew ok)
- E2E still **FAIL** (32/10): campaign not materialized (`requisition_parse` → `rpc_http_404` on some jobs) + **microsoftOAuth=false** + no live Graph seat for Teams book
- Owner Microsoft secrets still missing (setup actions requested)

## Done this shift

- Vault LLM fallback shipped + live-proven
- Dockerfile.prod ships `pipeline-transitions.json` + `graph-stage-jobs.json`
- Loop 6PN diagnosis; public URL secret override; HOSTNAME=`::` committed
- Requested MICROSOFT_CLIENT_ID/SECRET setup actions
- ManagePullRequest/`gh pr edit` unavailable (integration read-only); tip commits update PR #32

## Blockers

- Owner: `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (+ auth Azure GoTrue flags)
- Investigate `handler:requisition_parse:rpc_http_404` (PostgREST PGRST202 / missing overload) so webhook→campaign materializes
- Hermes drafts still fail on env Kimi 401 (vault path is workspaceId/`serverGenerateText` only)

## Next steps

1. Finish redeploy `04cd00d`; confirm web listens on `::`; optionally unset public `ARIA_WEB_INTERNAL_URL` secret once 6PN works
2. Debug `requisition_parse` rpc_http_404 with real job payload (compare RPC arg names vs live DB)
3. Owner Microsoft secrets → Connect Outlook → `e2e-workflow-test.sh` (never skip live calendar)
4. Goal complete ONLY on full E2E PASS including live Teams book

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback workspace-scoped + `status=valid`
- Goal complete ONLY on full E2E PASS including live Teams book

## Watch out

- After deploy, start loop machine if suspended (`flyctl machine start <loop-id>`)
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`
- Secret `ARIA_WEB_INTERNAL_URL` overrides `[env]` — remove after `::` bind verified on 6PN
