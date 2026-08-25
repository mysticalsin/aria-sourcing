# ARIA Integration API Map

**Date:** 2026-08-25  
**Audience:** integrators and internal services wiring ARIA sourcing end-to-end.

This is the authenticated API surface for sourcing, enrichment, outreach, loop
ignition, agents, and MCP. Authority for money/wire effects still lives in
Postgres `SECURITY DEFINER` RPCs — HTTP routes never bypass claim/approval
checks.

## Auth model

| Caller | How |
|---|---|
| Browser / member session | Supabase Auth cookie JWT; RLS + `current_workspace_id()` |
| Admin mutations | Same JWT + `requireAdmin` / role `admin` |
| Cron / loop worker | `Authorization: Bearer $CRON_SECRET` (+ workspace header where noted) |
| Webhooks | Provider signatures (Meta, email) — no member JWT |
| Service-only RPCs | Supabase service role key — server routes only |

Production fails closed when Supabase is not configured.

## Sourcing & enrichment

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/source` | member `source` | GitHub + Tavily discovery |
| POST | `/api/source/apify/start` | member | LinkedIn public-profile search (Apify) |
| GET/POST | `/api/source/apify/status` | member | Poll Apify run |
| POST | `/api/source/apollo/search` | member | Apollo people search |
| POST | `/api/source/apollo/enrich` | member | Apollo enrich |
| POST | `/api/source/enrich` | member | Unified enrichment waterfall |
| POST | `/api/sourcing-agent` | member | LLM sourcing agent with tool loop |
| POST | `/api/shortlist/approve` | admin | Human gate: shortlist → `draft_generate` |

## Outreach

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/outreach/approve` | member/admin | Named human approval (exact body hash) |
| POST | `/api/outreach/send` | member | Queue / dispatch outbound |
| POST | `/api/outreach/revoke` | member | Revoke approval |
| POST | `/api/outreach/whatsapp-template` | admin | WhatsApp template inventory |
| POST | `/api/outreach/whatsapp-review` | member | Review queue decision |
| GET | `/api/cron/dispatch-outbound` | CRON_SECRET | Drain queued outbound |

Template-bound approvals (`approval_source = template_bound`) require an
autopilot-entitled approver and an approved `outreach_templates` row. Claim
RPCs re-check via `outbound_approval_authorizes_send`.

## Autopilot entitlements (admin)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/members` | admin `manage_autopilot` | Roster + entitlement flags |
| PATCH | `/api/admin/members` | admin | `{ userId, autopilotEnabled }` via `set_member_autopilot` |

Workspace switchboard (`sourcing_loop_controls`) remains the blast-radius
control. Per-user `profiles.autopilot_enabled` is the who-may-use axis.

## Loop ignition

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/cron/ignite-sourcing-loop` | CRON_SECRET + `x-aria-workspace-id` | Enqueue due loop work |
| POST | `/api/cron/poll-provider-run` | CRON_SECRET | Async provider poll |

Scheduler helper: `scripts/ignite-sourcing-loop-scheduler.mjs` (calls ignite
per workspace listed in `ARIA_LOOP_WORKSPACE_IDS`).

## MCP

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/mcp/test` | admin `manage_tools` | Handshake + tool list |
| POST | `/api/admin/mcp/allowlist` | admin | Upsert/disable production allowlist rows |

Production remote MCP requires an enabled `mcp_server_allowlist` row matching
base URL + tool-manifest SHA-256. Non-production still requires
`ARIA_ENABLE_REMOTE_MCP_EXECUTION=true`. No wildcards.

## Agents & swarm

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/api/agents/specs` | member/admin | Agent specs (guardrails.autopilot defaults false) |
| POST | `/api/agents/run` | member | Start run |
| GET/POST | `/api/agents/memories` | member | Encrypted memory |
| POST | `/api/swarm/*` | admin | Swarm missions (gated by `swarm_enabled`) |

## Webhooks

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/webhooks/whatsapp` | Meta signature | Inbound + delivery receipts |
| POST | `/api/webhooks/email-inbound` | provider | Inbound email |
| POST | `/api/webhooks/email-delivery` | provider | Delivery events |

## Health

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | Liveness for Fly `web` |
| GET | `/api/ready` | public | Readiness (agent-frameworks may be conditional) |

## LinkedIn messaging

- **Data in:** Apify vendor purchase via `/api/source/apify/*` (working).
- **Messages out:** `assisted-manual` always available; `vendor-api` requires
  `LINKEDIN_VENDOR_API_URL` + `LINKEDIN_VENDOR_API_KEY` and fails closed when
  absent (no silent fallback). Smoke: `scripts/smoke-linkedin-live.mts`
  (discovery) + channel contract tests.

## Stability notes

- Request bodies validated with zod; prefer `Content-Type: application/json`.
- Mutating routes use `Cache-Control: no-store`.
- Do not call claim RPCs from the browser — service_role only.
- Rate limits apply per actor on admin and shortlist routes.
