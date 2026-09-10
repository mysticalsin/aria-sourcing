---
project: MSourcing / ARIA
shift: 133
agent: cursor-cloud
updated: 2026-09-10T21:25Z
status: ariabot-fly-connect-verified
---

# Handoff — Shift 133

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `04b7a80`
- **PR:** #93 → `integration/sourcing-enrichment-on-main`
- **Fly:** https://aria-mantu-app.fly.dev — AriaBot Browser Computer **connect works**
- **Evidence:** `_relay/evidence/2026-09-10-ariabot-fly-connect.md`

## Done

1. `ENABLE_PUBLIC_DEMO_ARIABOT` carve-out (connect/approve/LinkedIn send/dispatch)
2. Migration 0083 inbound route allows Browser Computer (applied on prod)
3. Verified ensure_connect + fleet start + LinkedIn navigate on Fly

## Blockers

1. Real LinkedIn session still needs operator 2FA inside AriaBot VM once
2. ComputerUse browser subagent unavailable this shift (model usage) — API/fleet proof done instead

## Next

1. Operator: Settings → AriaBot → Take control → LinkedIn login/2FA → Release
2. Approve/Send one Windows Desktop campaign outreach through AriaBot
3. Merge PR #93

## Decisions

- Keep demo login on; unlock AriaBot via `ENABLE_PUBLIC_DEMO_ARIABOT`, not full side-effect disable
- Browser Computer inbound route is optional for Observe/Take control

## Watch out

- Pass `NEXT_PUBLIC_SUPABASE_ANON_KEY` on every deploy
- Keep `/ariabot/` public in proxy matcher
