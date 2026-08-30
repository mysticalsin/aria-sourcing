---
project: MSourcing / ARIA
shift: 159
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 159

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#32** open (supersedes #29–#31)
- **Tip:** local tip includes `0067_mcp_allowlist_select_grants.sql` + prior E2E fail-closed
- **HeyReach (live):** MCP+API vault keys saved; allowlist enabled for `https://mcp.heyreach.io/mcp`; `/api/mcp/test` → **200 / 16 tools**; workspace_state `int_heyreach` connected (no secrets in git)
- **DB hotfix applied live:** GRANT SELECT on `mcp_server_allowlist` to authenticated+service_role (same as 0067); durable via new migration file
- **Admin login verified:** `Twalteur@amaris.com` (password in `/tmp` only)
- **Fly missing (6):** MICROSOFT_CLIENT_ID/SECRET + GOTRUE_EXTERNAL_AZURE_*
- **Stale app image:** `ba88302` / mig ledger still reports **0060** / Graph **404**; deploy confirm unset

## Done this shift

- Staged + wired owner HeyReach MCP URL/key + API key into Fly tenant
- Fixed allowlist SELECT privilege gap (live GRANT + migration 0067)
- Confirmed Spremo.McpServer tool discovery (16 tools)

## Next steps

1. Owner: `/tmp/owner-microsoft.env` → `bash scripts/fly-apply-owner-microsoft-secrets.sh`
2. `print-fly-deploy-confirm.sh` → `fly-deploy-now.sh` (applies migrations through 0067)
3. Connect Outlook + Enable webhook
4. `eval "$(bash scripts/print-fly-e2e-env.sh --export)" && bash e2e-workflow-test.sh`
5. Goal complete only on ready+0066/0067 tip + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes closed #29–#31
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Never invent Azure secrets; never commit `/tmp` secrets
- LinkedIn send stays 409 assisted-manual; HeyReach is the LinkedIn outreach MCP path
- Production MCP discovery requires allowlist row + SELECT grants

## Watch out

- Live GRANT already applied; 0067 must still ship so rebuilds/new envs stay correct
- Rotate webhook/cron if `/tmp` lost
