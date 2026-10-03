---
project: MSourcing / ARIA
shift: 131
agent: cursor-cloud
updated: 2026-09-10T19:20Z
status: ariabot-reachout-video
---

# Handoff — Shift 131

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `b4bc79b`
- **Fly:** https://aria-mantu-app.fly.dev
- **Brand:** OpenBot → **AriaBot** in Settings / Agents copy
- **Settings:** Integrations → AriaBot → **Log in with LinkedIn to test AriaBot**
- **Video:** `/opt/cursor/artifacts/ariabot-linkedin-reachout-showcase.mp4` (~160s)
  - Settings LinkedIn login CTA
  - Live AriaBot VM LinkedIn + compose/send
  - Campaign Approve outreach
  - Agents Observe
- **Compose demo:** `/ariabot/linkedin-outreach.html` (public, no auth)

## Done

1. Renamed OpenBot → AriaBot (user-facing)
2. Settings LinkedIn login-to-test for AriaBot seat
3. Fleet navigate action
4. Recorded reach-out showcase with live VM
5. Made `/ariabot/*` public for Chromium seat demos

## Blockers

1. Fly demo dry-run still blocks durable LinkedIn delivery until operator login + dry-run off
2. Real LinkedIn session requires operator 2FA inside AriaBot once

## Next

1. Operator: Settings → Create AriaBot seat & log in with LinkedIn → 2FA → Release
2. Turn off dry-run for real sends if desired
3. Merge PR

## Decisions

- AriaBot (not OpenBot) is the product name for the Chromium seat
- No LinkedIn password storage in Aria — durable profile only
- Prefer one Browser Computer seat

## Watch out

- Always pass NEXT_PUBLIC_SUPABASE_ANON_KEY on deploy
- Keep `/ariabot/` public in proxy matcher
