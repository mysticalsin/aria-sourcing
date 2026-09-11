---
project: MSourcing / ARIA
shift: 159
agent: cursor-cloud
updated: 2026-09-11T08:42Z
status: session-fail-closed-on-fly
---

# Handoff — Shift 159

## Current state

- **Branch:** `cursor/openbot-desktop-vm-b91d` @ `b460a2b` (`b460a2bbd2a64d7269e91e0951339895920deb82`)
- **Fly:** https://aria-mantu-app.fly.dev build matches tip
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/112 → `integration/sourcing-enrichment-on-main` (draft)
- **Computers:** max 5 · https://aria-mantu-computers.fly.dev
- **Policy:** every improvement on Fly

## Done this shift

1. Fail-closed LinkedIn send: `enqueueJob` refuses `linkedin_send` unless `sessionHealthy === true` (mock bypass for tests only)
2. Clear `sessionHealthy` on start/stop; auto-retry only when probe healthy (no missing-agent escape)
3. Pacing + LinkedIn channel pass through `null`/`false` — fail closed unless probed true
4. Campaign agents + fleet computers UI: session healthy / unhealthy / unverified badges; header counts session-healthy not process-live
5. Ops board labels for session_probe / refuse
6. Tests: computer-supervisor 38, send-pacing 12, campaign-go-live 11, floor 31; typecheck green
7. Deployed Fly; `/api/ready` build matches tip

## Blockers (goal incomplete)

1. Human Take control + LinkedIn 2FA per seat
2. OPENBOT_MAX_COMPUTERS=5
3. `/api/ready` agentFrameworks:false (Deerflow/Flowise — not campaign VM path)
4. Operator prove Deploy→login→Release→floor shows distinct VM ids + session healthy
5. Apply migration 0084 on prod (ready still reports 0082)

## Next steps

1. Operator prove ≤5 seats: Deploy → Take control → LinkedIn login/2FA → Release → floor/drawer/campaign panel show distinct VM ids + session healthy
2. Apply 0084 on prod; plan host raise/shard for 16 concurrent VMs
3. Mark PR ready when operator E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- `ensure` ≠ boot; go-live requires all attached seats `sessionHealthy === true`
- Send path fail-closed on unverified session (aligns with go-live)

## Watch out

- Mock send (`COMPUTER_SUPERVISOR_MOCK_SEND=1`) still allows send without probe — production must not set this
- Secrets `set ARIA_RELEASE_SHA` rolls machines; verify `/api/ready` build after any secret change
