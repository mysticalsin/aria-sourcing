---
project: MSourcing / ARIA
shift: 122
agent: cursor-cloud
updated: 2026-09-09T22:40Z
status: aria-e2e-antibot-ux-wired
---

# Handoff — Shift 122

## Current state

- **Branch:** `cursor/aria-e2e-antibot-ux-b91d`
- **Base:** `integration/sourcing-enrichment-on-main` (tracks via campaign-agent-vm-control)
- Core anti-bot libs + UI wiring for LinkedIn OpenBot happy path are in-tree
- `npx tsc --noEmit` clean; `tests/send-pacing.mts` + `tests/campaign-go-live.mts` green

## Done this shift

1. Setup guide + onboarding rewritten to Connect email → Pick LLM → Create campaign → Attach agent → Take control login → Approve → Send (dry-run called out; `hermes:onboarded:v2`)
2. `computer_help` recommendations + AttentionPanel fetches `/api/fleet/computers`
3. CampaignGoLiveChecklist + BanRiskStrip on Agents tab; CampaignFunnelSpine on Overview; SendOutcomeChip on outreach send
4. Pacing enforced in `/api/outreach/send` (deferred + paceReason) + browser adapter help_requested gate; allocateBatch respects send window when enforceBusinessHours; lastSendAt/sentToday updated on success
5. OpenBot supervisor: launchPersistentContext, human-like /type, /session-probe, mouse dwell before click
6. ComputerSupervisor: session gate on linkedin_send; Release clears help_requested + auto-retries ≤3 failed sends
7. LINKEDIN_BROWSER_SEAT_DEFAULTS in seed + addSeat; `scripts/source-idle-campaigns.mjs` dry log only

## Blockers

1. Operator must still complete LinkedIn login/2FA once per computer (credentials not in agent env)
2. Fly Chromium redeploy needed to pick up openbot-chromium-supervisor.mjs typing/profile changes

## Next steps

1. Redeploy `aria-mantu-computers` with updated `scripts/openbot-chromium-supervisor.mjs`
2. Take control → login → Release → prove LinkedIn send with pacing + outcome chip
3. Optional: wire CampaignGoLiveChecklist `computers` prop from live fleet fetch

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = Fly only
- Never COMPUTER_SUPERVISOR_MOCK_SEND=1 on prod
- AttentionPanel client-fetches computers (minimal invasive vs deriveRecommendations callers)
- allocateBatch uses isWithinSendWindow (not evaluateSendPace) to avoid fleet↔send-pacing circular import

## Watch out

- Do not commit computer/supervisor tokens in view HTML
- source-idle-campaigns.mjs must never send
