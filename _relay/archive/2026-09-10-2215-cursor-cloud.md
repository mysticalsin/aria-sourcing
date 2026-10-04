---
project: MSourcing / ARIA
shift: 134
agent: cursor-cloud
updated: 2026-09-10T21:45Z
status: ariabot-vm-fluid-multitab-deployed
---

# Handoff — Shift 134

## Current state

- **Branch:** `cursor/ariabot-vm-fluid-multitab-b91d` @ `0f3e686`
- **PR:** #94 → `integration/sourcing-enrichment-on-main`
- **Fly computers:** https://aria-mantu-computers.fly.dev — CDP screencast + multi-tab live
- **Fly app:** https://aria-mantu-app.fly.dev (AriaBot connect still from #93)

## Done

1. Replaced JPEG poll Take control with **CDP screencast WebSocket** (~15–30 FPS)
2. Real **multi-tab** Chromium (tab strip, +Tab, Ctrl/Cmd+T/W/Tab, popups)
3. Faster human click/type path (no dwell / mouse-walk on human)
4. Computers VM → **performance-4x / 8gb**; deployed
5. Local smoke: ensure → new tab (example.com) → take control OK

## Blockers

1. Operator still needs LinkedIn login/2FA once inside AriaBot after Take control
2. Existing seats may need **Release → Take control** (or computer restart) to pick up new view UI

## Next

1. Operator: Settings → AriaBot → Take control → confirm fluid stream + open 2–3 tabs
2. Complete LinkedIn login in VM → Release → campaign Approve/Send
3. Merge #94 (and #93 if still open)

## Decisions

- Keep demo-login dry-run for third-party; AriaBot unlocked via `ENABLE_PUBLIC_DEMO_ARIABOT`
- Fluidity fix is supervisor-side (CDP stream), not Aria Next app rebuild
- Prefer one Browser Computer seat; many tabs inside that seat

## Watch out

- Deploy computers with `fly.computers.toml` (includes `ws` via package.json)
- Pass `NEXT_PUBLIC_SUPABASE_ANON_KEY` on app deploys
- Keep `/ariabot/` public in proxy matcher
