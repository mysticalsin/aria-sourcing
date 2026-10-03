---
project: MSourcing / ARIA
shift: 170
agent: cursor-cloud
updated: 2026-09-11T16:25Z
status: reclaim-persist-computer-id-shipped
---

# Handoff — Shift 170

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `0ae4ab9`
- **Fly:** https://aria-mantu-app.fly.dev — still on older build `8ea3370…` (`agentFrameworks:false`); tip with reclaim persist + floor isolation **not live**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/124 → `integration/sourcing-enrichment-on-main` (draft)
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5`

## Done this shift

1. **`reclaim_healthy_orphan` persists `agent_seats.computer_id`** on claim (fail-closed on DB error) — closes race where 5s fleet/floor GET re-hydrated the login-wall twin from a stale FK and stole the durable VM back via `claimOrphan`
2. Prior tip still included: host orphan import, Login reclaim-before-mint, floor `resolveComputerHint` seatId isolation
3. Tests: `tests/computer-supervisor.mts` 59 passed (incl. route persist contract); `npm run typecheck` green

## Blockers (goal incomplete)

1. Tip not deployed to Fly — operator Login reclaim / floor prove blocked
2. LinkedIn remember-me / checkpoint may need one human Take control
3. OPENBOT_MAX_COMPUTERS=5
4. `/api/ready` agentFrameworks:false
5. Operator Deploy→login→Release→floor distinct VMs + probe-backed healthy still outstanding

## Next steps

1. Deploy tip to Fly (protected `deploy-aria-mantu` / image digest) — confirm `/api/ready` build SHA matches tip
2. Settings → Login on Tony seat — expect DB `computer_id` → UUID durable bot after reclaim; Take control if checkpoint
3. Operator N-seat floor prove: distinct computerIds, no cross-desk bleed, sessionHealthy from probe only
4. Mark PR #124 ready when operator E2E + stable session evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint on GET/list/poll
- Never remint blank computerId when durable/healthy profile exists
- Unhealthy stored id → probe orphans → reclaim (not mint)
- **Reclaim that claims an orphan must persist `agent_seats.computer_id` in the same request**
- Floor computerId fallback must not cross seat ownership
- Unique `(workspace_id, computer_id)` in DB (0084)
- Host-full → refuse new Browser Computer seats

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` often login-wall twin — reclaim prefers UUID durable bot after probe
- Production deploy is owner/protected workflow — do not bypass release guards
