---
project: MSourcing / ARIA
shift: 197
agent: cursor-cloud
updated: 2026-08-27T21:21Z
status: requisition-parse-404-root-cause-fixed-pending-migrate
---

# Handoff — Shift 197

## Current state

- **PR #32** remains **CLOSED** without merge (owner); do not reopen unless owner asks
- Demo-fix agent owns `cursor/enterprise-autopilot-b91d` for live demo UX — do not push enterprise tip there from this workstream
- Non-MS fix branch: **`cursor/fix-requisition-parse-404-cadd`** — root cause of `handler:requisition_parse:rpc_http_404` identified and fixed in source
- Live Fly still at historical tip **`635eb4e`**; live `apply_workspace_patch` still returns HTTP 404 / PG `42883` `digest(text, unknown)` until **0068** is applied
- Confirm unlock unchanged: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM` (never invent)
- Microsoft path **SKIPPED** (owner) — no Graph/Outlook/live Teams E2E; goal stays active

## Done this shift

- Root cause: migration **0063** dropped `extensions` from `apply_workspace_patch` `search_path`; pgcrypto `digest` unresolved → PostgREST HTTP 404 → worker `rpc_http_404` → campaign never materializes
- Added **`supabase/migrations/0068_apply_workspace_patch_digest_path.sql`**: restore `extensions` on search_path, schema-qualified `digest(..., 'sha256'::text)`, public→extensions→double-md5 fallback; keep `append_outreach`
- Worker: `classifyRpcHttpFailure` surfaces `rpc_http_404:digest_unresolved` (no opaque 404)
- DeepSeek + Kimi apply paths: `DEEPSEEK_API_KEY` (+ optional base URL) in `fly-apply-owner-llm-secrets.sh`, checklist, missing-secrets, activate, `.owner-llm.env.example` (no invented keys)
- Tests: loop-authority 0068 pin; sourcing-loop-worker classify/client; audit matrix DeepSeek + 0068
- Codex finding recorded; VSS text/HTML path unchanged (no gap extend)

## Blockers

- Live DB still broken until **0068** applied (needs bootstrap migrate + matching owner deploy confirm — do not redeploy without confirm)
- PR #32 closed — land path for this branch TBD by owner (do not recreate #32)
- Demo UX owned elsewhere on `enterprise-autopilot-b91d`
- Env Kimi 401 still possible; vault failover OK when workspaceId set
- PDF/image OCR still optional / Graph-attachment dependent

## Next steps

1. Owner: drop deploy confirm → apply migrations through 0068 + deploy tip that includes worker classify (or migrate-only first to unblock campaign materialization)
2. After migrate: re-probe `apply_workspace_patch` (must not return digest 42883); webhook E2E campaign materialization
3. Optional: `/tmp/owner-llm.env` with real `KIMI_API_KEY` and/or `DEEPSEEK_API_KEY` → `bash scripts/fly-apply-owner-llm-secrets.sh`
4. Do **not** resume Microsoft Graph / Outlook / live-calendar E2E
5. Do **not** set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` or mark goal complete

## Decisions made (don't relitigate)

- Owner closed PR #32 without merge — accept; do not reopen unless asked
- Owner skip Microsoft — still in force; goal remains active
- Demo-fix owns `cursor/enterprise-autopilot-b91d` UX files — this workstream stays on `cursor/fix-requisition-parse-404-cadd`
- Local gate `npx tsc --noEmit && npm test` = CI authority
- Never invent secrets / deploy confirm
- VSS plain text/HTML is production baseline; PDF OCR deferred

## Watch out

- Applying 0068 without updating `ARIA_EXPECTED_MIGRATION*` / tip deploy can desync `/api/ready`
- Tip may lag HEAD — OK unless confirm present
- After deploy, start loop machine if suspended
