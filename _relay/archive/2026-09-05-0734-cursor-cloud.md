---
project: MSourcing / ARIA
shift: 101
agent: cursor-cloud
updated: 2026-09-05T07:10Z
status: linkedin-tip-verified-awaiting-fly-token
---

# Handoff — Shift 101

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → **PR #64** (draft) → `integration/sourcing-enrichment-on-main`
- Tip SHA: `7c961d9106bbdf168bb8329befbb1fa2067683bf`
- **Local tip verified** (demo login + LinkedIn/fleet APIs)
- Live Fly `https://aria-mantu-app.fly.dev` build `5728ad41…` / migration `0079_…` still missing LinkedIn fleet routes (404)
- Cloud Agent secrets request is OPEN for `FLY_API_TOKEN` (+ optional `ADMIN_EMAIL`/`ADMIN_PASSWORD`)

## Done this shift

1. Re-ran LinkedIn/fleet suites: credentials 15, channel 17, connections 47, supervisor 8, lease 10, knowledge 6, auto-deliver 7, oauth 8, policy 31; `tsc` clean
2. Local authenticated smoke with demo session: connections **200**, fleet computers **200**, knowledge **400** (needs id), auth/linkedin **503** fail-closed without OIDC
3. Opened environment setup actions for Fly deploy token (app `aria-mantu-app`)

## Blockers

1. **`FLY_API_TOKEN`** — user must paste into Cloud Agent secrets
2. Live migration **0079** vs tip ledger **0063** — reconcile before production image swap
3. Optional admin creds for post-deploy authenticated E2E on live

## Next steps

1. When `FLY_API_TOKEN` lands: `fly auth` → inspect live migration ledger → deploy tip / protected workflow path → prove LinkedIn routes **401/200** not 404
2. Paste Aria vault LinkedIn OIDC / Vendor / Supervisor keys in Settings
3. Smoke OIDC connect → Automatic Vendor or Browser Computer send
4. Mark PR #64 ready for review

## Decisions made (don't relitigate)

- Production = Fly only (`aria-mantu-app`) — never Vercel
- LinkedIn defaults to Automatic; Manual opt-in
- Automatic = entitled vendor-api OR browser-computer; no silent assisted-manual fallback
- Postgres contact lease = only double-contact lock
- Aria vault keys primary; env fallback only

## Watch out

- `COMPUTER_SUPERVISOR_MOCK_SEND=1` tests-only
- Do not blind-deploy over live migration 0079 without ledger reconciliation
