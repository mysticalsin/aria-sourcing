---
project: MSourcing / ARIA
shift: 418
agent: cursor-cloud
updated: 2026-08-29T23:55Z
status: improve-awaiting-deploy
---

# Handoff — Shift 418

## Current state

- **Branch:** `cursor/rei-autopilot-send-b91d` (PR #40)
- **Live Fly image (pre-fix):** `b0cf56a` · migration **0079** · `/api/ready` ok
- **Critical bug found live:** Autopilot used `.from("sourcing_loop_controls")`; service_role SELECT revoked → always `sequences_not_armed` even when sequences armed via admin RPC
- **Planted proof draft:** `msg-autopilot-proof-20260829234930` on workspace `0d179005-…` (Needs Approval + ready + critics) — sweep currently returns `sequences_not_armed` on old image
- **Code fixes on branch (not yet deployed):** controls via `get_sourcing_loop_controls`; sweep 503/skip honesty; worker sent/skipped/errors; HeyReach reason split; `approvalScopeHash` → `toLowerCase()`

## Done this shift

1. Live plant + sweep proved non-empty results (but wrong reason `sequences_not_armed`)
2. Fixed Autopilot controls read (RPC) + four audit observability gaps
3. Focused tests green: rei-autopilot-send 14, dispatch 23, heyreach-mcp 35, sourcing-loop-worker 46, outreach-guardrails 44

## Blockers (owner / external)

1. Graph dropzones empty → no live mailbox → after deploy expect `no_live_mailbox` (not send)
2. HeyReach: campaignId + LI account + live HeyReach seat for LinkedIn auto-send
3. Remint `/tmp/owner-deploy-confirm.env` to tip SHA then `bash scripts/fly-deploy-now.sh`

## Next steps

```bash
# After commit tip SHA:
printf 'ARIA_RELEASE_SHA=%s\nARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:%s:aria-mantu-bootstrap,aria-mantu-app\n' "$(git rev-parse HEAD)" "$(git rev-parse HEAD)" > /tmp/owner-deploy-confirm.env
source /tmp/owner-deploy-confirm.env && bash scripts/fly-deploy-now.sh
# Prove:
curl -fsS -X POST https://aria-mantu-app.fly.dev/api/cron/autopilot-send-outreach \
  -H "Authorization: Bearer $(cat /tmp/aria-e2e-cron-secret)" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"0d179005-e8e2-4b99-8b9a-b67453348005","sweep":true}' | jq .
# Expect skipped reason no_live_mailbox (channels still HOLD) — NOT sequences_not_armed
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty — no Entra chase
- Autopilot must use `get_sourcing_loop_controls` RPC (never table SELECT)
- HeyReach CheckApiKey alone ≠ delivery-ready
- Workspace `0d179005-e8e2-4b99-8b9a-b67453348005`

## Watch out

- `set_sourcing_loop_controls` requires `p_swarm_enabled` overload
- Do not weaken fail-closed when splitting HeyReach skip reasons
- Goal complete only on auto-send receipt (`sent>0`), not skip-reason proof alone
