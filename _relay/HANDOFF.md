---
project: MSourcing / ARIA
shift: 77
agent: cursor-cloud
updated: 2026-08-25 UTC
status: fly-deployed-linkedin-live
---

# Handoff - Shift 77

## Current state

- **Production:** https://aria-mantu-app.fly.dev/login?redirect=%2F
- Deployed build `639b332`, migration `0059_linkedin_heyreach_parity.sql`.
- LinkedIn routes live: `/api/linkedin/connections` → **401** (auth required).
- Demo login disabled (`POST /api/auth/demo-login` → 404).
- `/api/ready`: migration + releaseIdentity **true**; `agentFrameworks` false (Flowise/Deerflow not shipped — expected).

## Done this shift

- Fly auth as `tony.walteur@gmail.com`.
- Bootstrap image build + push; migrations **0047–0059** applied on prod DB.
- App image deployed to `aria-mantu-app` (includes LinkedIn HeyReach parity routes).
- Release-identity Fly secrets updated to match `639b332` / `0059`.

## Next steps

1. Log in at https://aria-mantu-app.fly.dev/login with real Supabase admin creds.
2. Settings → Connect LinkedIn seat → Simulate → verify `linkedin_channel_events` row.
3. Optional: `fly secrets set LINKEDIN_INBOUND_WEBHOOK_SECRET=… -a aria-mantu-app`
4. Full E2E: `ADMIN_EMAIL=… ADMIN_PASSWORD=… ANON_KEY=… bash e2e-workflow-test.sh`

## Decisions made (don't relitigate)

- Fly is production; Vercel demo stays open-demo.
- Owner-run deploy via `flyctl` (not protected GH workflow) for this push.

## Watch out

- `/api/ready` `ok:false` until agent frameworks deploy — unrelated to LinkedIn.
- Do not commit `.fly-secrets.env` / tokens; agent read creds via Fly SSH for deploy only.
