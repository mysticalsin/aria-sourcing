---
project: MSourcing / ARIA
shift: 194
agent: cursor-cloud
updated: 2026-08-27T21:03Z
status: microsoft-path-stopped-owner-order
---

# Handoff — Shift 194

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** on `cursor/enterprise-autopilot-b91d` (base `integration/sourcing-enrichment-on-main`)
- Live Fly tip **`635eb4e`** (`/api/ready` build=`635eb4e51fc6a04a5cefa5870a5710ab5fcb8201`, mig=`0067_mcp_allowlist_select_grants.sql`, status=ready) — newer than historical tip `dfa70ec`
- Graph `validationToken` probe historically **HTTP 200** (echo body) when tip was checked — not an active work item
- **Microsoft path STOPPED** per owner order (2026-08-27): no more `MICROSOFT_CLIENT_*` polling, Graph Outlook connect, setup-action re-requests, or live-calendar E2E gate
- Enterprise full E2E with live Teams book: **CANCELLED/DEFERRED** — reason `owner: skip Microsoft`
- Optional LLM: Kimi already on Fly; vault LLM fallback proven; Hermes env-Kimi 401 remains a separate (non-MS) note
- Branch HEAD may include concurrent intake work (e.g. `c93f4c5` Mantu VSS fields); leave intake triage to that agent — this shift is relay-only

## Done this shift

- Owner order honored: stop all Microsoft Graph / Outlook / live Teams calendar E2E unblock work
- Archived shift-193 baton → `_relay/archive/2026-08-27-2103-cursor-cloud.md`
- cursor-subscriptions `list_subscriptions`: **empty** — nothing named `enterprise-e2e-ms-secrets-recheck` (or similar) to unsubscribe on this run
- Did **not** recheck Microsoft secrets, apply MS secrets, Connect Outlook, request MS setup actions, or run Graph-gated E2E

## Blockers

- Microsoft is **not** an active blocker (path abandoned for now)
- Investigate `handler:requisition_parse:rpc_http_404` so webhook→campaign materializes (non-MS)
- Hermes drafts still fail on env Kimi 401 (vault path is workspaceId/`serverGenerateText` only)

## Next steps

1. Do **not** resume Microsoft client-secret polling, Graph Outlook connect, or live-calendar E2E for this goal
2. Triage concurrent intake work on the branch if still dirty / unreviewed (other agent may own this)
3. Debug `requisition_parse` rpc_http_404 with real job payload (independent of Microsoft)
4. Optionally unset public `ARIA_WEB_INTERNAL_URL` once 6PN `::` bind verified
5. PR #32: update description to reflect Microsoft path deferred when ManagePullRequest is available

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback workspace-scoped + `status=valid`
- **Owner ordered skip Microsoft path** — no more MS client secret polling, Graph Outlook connect, or live-calendar E2E gate for this goal (`owner: skip Microsoft`)
- Prior “goal complete ONLY on full E2E PASS including live Teams book” is **superseded**: that completion criterion is cancelled/deferred for now

## Watch out

- After deploy, start loop machine if suspended (`flyctl machine start <loop-id>`)
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` if someone later reopens live calendar work under a new owner order
- Secret `ARIA_WEB_INTERNAL_URL` overrides `[env]` — remove after `::` bind verified on 6PN
- Do not re-spam Entra app create; do not re-request Microsoft environment setup actions
- Prefer HANDOFF-only commits when another agent is mid-intake triage
