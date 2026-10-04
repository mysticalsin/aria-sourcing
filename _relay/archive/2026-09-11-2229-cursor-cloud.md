---
project: MSourcing / ARIA
shift: 180
agent: cursor-cloud
updated: 2026-09-11T21:44Z
status: fail-closed-message-orphan-patch-tip-not-released
---

# Handoff — Shift 180

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` (message fail-closed + orphan health/ops + PATCH ownership)
- **Fly:** https://aria-mantu-app.fly.dev — build `8ea3370…` (**tip not live**); `/api/ready` `ok:false`
- **Live fleet:** 1 computer `comp_7fe31958-…` seat `600e8afa-…` **`sessionHealthy:false`** (honest)
- **PR:** recreate after push (prior #133 CLOSED)
- **Exec video:** `/opt/cursor/artifacts/aria-exec-recruiting-e2e-walkthrough.mp4`

## Done this shift

1. LinkedIn **Message** path fail-closed: refuse disabled Send; require Message-sent UI proof (matches invite)
2. `computerHealthOwnedBySeat`: orphan/empty owner no longer paints every desk green
3. Campaign Agents ops match **seat-owned** rows only (no `__orphan__` drive-by Hermes id)
4. Seats PATCH rejects `computerId` already bound to another workspace seat (409)
5. Tests: fleet-hermes-sync 8, linkedin-send-contract 8, computer-supervisor 65; typecheck green
6. Prior: invite ≤200 + Sent/Pending proof; campaign clear-foreign full fleet; exec E2E evidence pack

## Blockers (goal incomplete)

1. Tip not on protected Fly release
2. Human Take control + LinkedIn login/2FA required (`sessionHealthy` still false)
3. OPENBOT_MAX_COMPUTERS=5; agentFrameworks:false
4. Operator N-seat prove of tip features outstanding on live

## Next steps

1. Human Take control → LinkedIn login/2FA → Release → session_probe healthy
2. Land tip via protected release — `/api/ready` build SHA == tip
3. Prove N distinct computerIds, no cross-desk bleed, floor only healthy/real-send
4. Mark PR ready only with tip live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Invite notes ≤ **200**; Message/Invite both fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge or ops-drive other seats
- PATCH must not steal another seat's computerId
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
