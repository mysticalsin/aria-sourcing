---
project: MSourcing / ARIA
shift: 132
agent: cursor-cloud
updated: 2026-09-10T21:14Z
status: ariabot-fly-connect-unblocked
---

# Handoff — Shift 132

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d`
- **Fly:** https://aria-mantu-app.fly.dev
- **Root cause of "Public demo… disabled" + "No AriaBot seat":** `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true` dry-ran `POST /api/linkedin/connections` before Browser Computer seat create
- **Fix:** `ENABLE_PUBLIC_DEMO_ARIABOT=true` escape hatch — AriaBot Browser Computer connect + LinkedIn approve/send/dispatch allowed; third-party OAuth/email/WhatsApp stay dry-run
- **Fly secret:** `ENABLE_PUBLIC_DEMO_ARIABOT=true` set on `aria-mantu-app` (needs image deploy to take effect in code)

## Done this shift

1. Policy carve-out in `src/lib/demo-side-effect-policy.ts` + server helpers
2. LinkedIn Browser Computer `ensure_connect` uses `publicDemoAriaBotDisabled()`
3. Outreach approve + LinkedIn send + outbound dispatch LinkedIn-only under AriaBot hatch
4. Tests: `tests/demo-live-side-effects.mts` green (48 pass)

## Blockers

1. Deploy of this commit still required before UI connect works on Fly
2. Real LinkedIn session still needs operator 2FA inside AriaBot VM once

## Next steps

1. Deploy `aria-mantu-app` with `NEXT_PUBLIC_SUPABASE_ANON_KEY` build-arg
2. Login as Twalteur → Settings → Create AriaBot seat / Log in with LinkedIn
3. Take control → LinkedIn login → Release → approve/send on Windows Desktop campaign
4. Record short E2E evidence if needed

## Decisions made (don't relitigate)

- Keep demo login on for showcase password path
- AriaBot Browser Computer is first-party; allow via `ENABLE_PUBLIC_DEMO_ARIABOT`, do not disable entire public-demo wall
- Prefer one Browser Computer seat

## Watch out

- Always pass `NEXT_PUBLIC_SUPABASE_ANON_KEY` on deploy
- Keep `/ariabot/` public in proxy matcher
- Do not commit demo passwords or service-role keys
