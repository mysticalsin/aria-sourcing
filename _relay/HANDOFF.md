---
project: MSourcing / ARIA
shift: 125
agent: cursor-cloud
updated: 2026-09-10T13:02Z
status: fly-demo-login-twalteur-verified
---

# Handoff — Shift 125

## Current state

- **Branch:** `cursor/fly-demo-twalteur-login-b91d`
- **Fly web:** https://aria-mantu-app.fly.dev — healthy; demo login identity is `Twalteur@amaris.com`
- Verified: `POST /api/auth/demo-login` with that username + configured password → **200**; `admin` / wrong password → **401**

## Done this shift

1. Demo-login accepts configurable `DEMO_ADMIN_USERNAME` / `DEMO_ADMIN_EMAIL`
2. Fly secrets set for username/email; GoTrue user password synced; profile email/role admin patched
3. Redeployed `aria-mantu-app` with `NEXT_PUBLIC_DEMO_ADMIN_USERNAME` build-arg
4. Password value not recorded in `_relay/`

## Blockers

1. None for login. LinkedIn Message still needs operator Take control login/2FA on computers.

## Next steps

1. Merge this branch / open PR as desired
2. Operator LinkedIn login on `comp_java_01` when ready to send

## Decisions made (don't relitigate)

- Showcase Fly app may keep demo-login ON
- Do not commit passwords / tokens

## Watch out

- GoTrue email for demo user must stay in sync with `DEMO_ADMIN_EMAIL`
- Do not bake `DEMO_ADMIN_PASSWORD` into the Docker image
