---
project: MSourcing / ARIA
shift: 135
agent: cursor-cloud
updated: 2026-09-10T22:15Z
status: responsive-vm-skills-e2e-in-progress
---

# Handoff — Shift 135

## Current state

- **Branch:** `cursor/ariabot-vm-fluid-multitab-b91d`
- **PR:** #94 → `integration/sourcing-enrichment-on-main`
- **Fly computers:** https://aria-mantu-computers.fly.dev — CDP binary screencast + multi-tab + Browserbase-style live view
- **Fly app:** https://aria-mantu-app.fly.dev
- **Volume:** `openbot_profiles` (10GB cdg) — mount in `fly.computers.toml` (`/data`); attach on next computers deploy

## Done this shift

1. Humanizer last-mile on LinkedIn send (`src/lib/openbot/linkedin-send.ts`) + Connect+note path (`preferConnect`)
2. `outreach_skill` playbook injected into `buildOutreachPrompt` via `skillPlaybook` from store
3. Live view: binary JPEG WS frames, CDP Input clicks/moves, RTT/FPS chips, Browserbase-style chrome
4. Scrapling bridge (`src/lib/scrapling/adapter.ts`) + docs; sourcing skill references it
5. Stream quality tuned in `fly.computers.toml` (q45 / 1280×800)

## Blockers

1. Computers volume not yet attached to running machine (needs `fly deploy -c fly.computers.toml`)
2. Operator LinkedIn session may need re-login after volume attach/redeploy
3. Full tonywalteur campaign E2E video still in progress

## Next steps

1. Deploy computers with mounts; confirm `/health` shows `cdp-screencast-binary` and `/data` mounted
2. Deploy app with skill/humanizer wiring
3. Create campaign targeting https://www.linkedin.com/in/tonywalteur/
4. Draft (skills+humanizer) → approve → AriaBot Connect+note / Message
5. Record full E2E video to `/opt/cursor/artifacts/`

## Decisions made (don't relitigate)

- Keep demo-login dry-run for third-party; AriaBot unlocked via `ENABLE_PUBLIC_DEMO_ARIABOT`
- Prefer Connect+note when Message unavailable (`preferConnect` default true on LinkedIn browser path)
- Scrapling is optional sidecar for public web research; LinkedIn stays on AriaBot computers
- Fluidity fix is supervisor-side (CDP stream), not Aria Next app rebuild

## Watch out

- Deploy computers with `fly.computers.toml` so volume mounts
- Pass `NEXT_PUBLIC_SUPABASE_ANON_KEY` on app deploys
- Keep `/ariabot/` public in proxy matcher
- Never commit secrets from `fly ssh printenv`
