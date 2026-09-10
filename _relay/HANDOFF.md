---
project: MSourcing / ARIA
shift: 130
agent: cursor-cloud
updated: 2026-09-10T17:55Z
status: login-once-agents-linkedin-video
---

# Handoff — Shift 130

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `a4ecabe`
- **Fly:** https://aria-mantu-app.fly.dev
- **Settings:** Integrations → LinkedIn → **Login once — agents use this account** / Open LinkedIn login for agents
- **E2E video:** `/opt/cursor/artifacts/aria-fly-windows-linkedin-e2e.mp4` (~67s)
- **CTA evidence:** `/opt/cursor/artifacts/fly-settings-login-once-cta.png`
- **VM LinkedIn:** `comp_java_01` shows LinkedIn login wall until operator completes login-once

## Done this shift

1. Settings login-once CTA → fleet ensure/start/take_control → fullscreen OpenBot view
2. computerId exposed on LinkedIn connections seats API
3. Recorded Fly E2E video with LinkedIn VM navigation
4. Redeployed tip with anon build-arg

## Blockers

1. Operator must complete LinkedIn login/2FA once inside the VM for agents to send

## Next steps

1. Operator: Settings → Open LinkedIn login for agents → sign in → Release
2. Approve Windows Desktop outreach drafts
3. Merge PR

## Decisions made (don't relitigate)

- No LinkedIn password storage in Aria — durable Chromium profile only
- One Browser Computer seat reused across campaigns
- Prefer 6–12 months tenure before contact

## Watch out

- Always pass NEXT_PUBLIC_SUPABASE_ANON_KEY on deploy
- New Browser Computer seats = empty profile = re-login
