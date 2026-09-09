---
project: MSourcing / ARIA
shift: 120
agent: cursor-cloud
updated: 2026-09-09T14:35Z
status: fly-0082-deployed-linkedin-login-needs-operator
---

# Handoff — Shift 120

## Current state

- **Branch:** `cursor/campaign-agent-vm-control-b91d` @ `d8115f6908a0bf1cf7d648fb9ac1c62b385e2331`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/76
- **Fly web:** https://aria-mantu-app.fly.dev — health 200; build tip matches SHA; migration tip **0082**
- **Fly Chromium:** https://aria-mantu-computers.fly.dev — `comp_java_01` running; LinkedIn authwall visible
- **DB:** migrations **0081** + **0082** applied; ledger count **81**; `assigned_campaign_ids` + `computer_audits.campaign_id` live

## Done this shift

1. Applied `0081_computer_audits.sql` + `0082_campaign_agent_bindings.sql` on Fly DB + ledger inserts
2. Set `ARIA_EXPECTED_MIGRATION*` / `ARIA_EXPECTED_LEDGER_SHA` / `ARIA_RELEASE_SHA` on `aria-mantu-app`
3. Redeployed `aria-mantu-app` tip (`d8115f6…`) — `/api/ready` reports migration `0082` + matching build
4. Re-proved campaign-scoped `linkedin_send` on Fly Chromium → login/2FA `help_requested`
5. Opened Chromium Observe view + Take control surface (LinkedIn authwall)

## Blockers

1. **No LinkedIn operator credentials in this environment** — cannot complete LinkedIn login/2FA for a durable Chromium profile. Operator must Take control at `https://aria-mantu-computers.fly.dev/view/comp_java_01` (or Campaign Agents → Observe) and sign in once.
2. `/api/ready` stays `ok:false` on `agentFrameworks:false` (known for this tenant; `/api/health` is the routing check)

## Next steps

1. Operator: open Chromium view → Take control → LinkedIn login/2FA → Release
2. Re-run `COMPUTER_SUPERVISOR_URL=https://aria-mantu-computers.fly.dev … npx tsx scripts/prove-linkedin-campaign-reachout.mjs` — expect `sent` after login
3. Merge PR #76 when ready

## Decisions made (don't relitigate)

- Production LinkedIn/OpenBot/campaign VMs = Fly only (never Vercel)
- 1 seat = 1 Chromium; Campaign Agents shares Fleet mutex
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod
- Soft seat preference: campaign-attached first, then unscoped
- Wiki recall ≠ contact lease

## Watch out

- Do not commit supervisor/computer/JWT/anon tokens
- Live migration ledger count is **81** (not local file count 65) — tip filename/sha are authoritative
