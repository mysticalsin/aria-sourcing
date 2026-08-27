---
project: MSourcing / ARIA
shift: 163
agent: cursor-cloud
updated: 2026-08-27 UTC
status: awaiting-microsoft-entra-and-deploy-confirm
---

# Handoff — Shift 163

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#32**
- **Tip:** Outlook OAuth callback promotes seat `mode=live` (Teams confirmLive unblock)
- **Azure CLI try:** Twalteur@amaris.com ROPC → AADSTS50126 (not Azure AD admin / MFA) — cannot self-mint app registration
- **Still blocked:** 6 Azure/Entra secrets + deploy confirm; ready `ba88302`/mig `0060`/Graph **404**

## Done this shift

- Microsoft (+ Google) OAuth callback sets `mode: "live"` + `status: "active"` on connect
- E2E requires live seat + active Graph subscription for confirmLive; fails closed if webhook-active but mock seat
- M365 stack UI gates calendarReady on live Graph seat
- `fly-enterprise-golive-when-ready.sh` one-shot remains

## Next steps

1. Owner: `/tmp/owner-microsoft.env` → `bash scripts/fly-enterprise-golive-when-ready.sh`
2. `bash scripts/print-fly-deploy-confirm.sh` → export confirm → re-run golive / `fly-deploy-now.sh`
3. Connect Outlook (auto live mode + webhook) → E2E PASS
4. Goal complete: ready ok + mig>=0066 + tip build + Graph200 + E2E PASS

## Decisions made (don't relitigate)

- PR #32 supersedes #29–#31
- Never invent Azure secrets or deploy confirm
- Seat must be mode=live for Teams book (not subscription alone)

## Watch out

- Reconnect Outlook after tip deploy so existing mock seats become live
