---
project: MSourcing / ARIA
shift: 127
agent: cursor-cloud
updated: 2026-08-27 UTC
status: code-complete-awaiting-owner-deploy
---

# Handoff — Shift 127

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · **#31** open (supersedes closed #29, #30)
- **Local tip:** deploy path now stages `ARIA_EXPECTED_*` + `ARIA_RELEASE_SHA` from tip ledger (floor **0066_calendar_meeting_url.sql**, count 65)
- **Local gate:** tsc + audit **41/41**; login-page aligned with `AZURE_LOGIN_ARG=false` default
- **Fly live:** build `ba88302`, migration **0060** — Graph webhook **404**; `/api/ready` not_ready — needs tip + **0066**
- **Owner blockers:** `ARIA_PROD_DEPLOY_CONFIRM` unset; prefer M365/webhook/Entra secrets **before** deploy so Azure login build-arg turns on; admin E2E creds
- **Note:** `FLY_API_TOKEN` available for read-only probes; deploy still requires confirm

## Done this shift

- `scripts/fly-deploy-now.sh` computes migration ledger identity and `flyctl secrets set --stage` for `ARIA_EXPECTED_MIGRATION{,_SHA,_COUNT}` + `ARIA_EXPECTED_LEDGER_SHA` (+ `--env` on deploy)
- Floor check requires tip ≥ `0066_calendar_meeting_url.sql`
- Audit matrix row: Fly deploy refreshes `ARIA_EXPECTED_*` for `/api/ready`
- `tests/login-page.mts` expects workflow default `AZURE_LOGIN_ARG=false` (not stale literal `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=false`)

## Blockers

- Live Fly cannot advance without owner: `ARIA_PROD_DEPLOY_CONFIRM` + secrets + `e2e-workflow-test.sh` credentials

## Next steps

1. Owner: `bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)`
2. Owner: set `GOTRUE_EXTERNAL_AZURE_*` + `MICROSOFT_*` + `EMAIL_INBOUND_WEBHOOK_SECRET` on Fly (before deploy preferred)
3. Owner: `bash scripts/print-fly-deploy-confirm.sh` → export confirm → `bash scripts/fly-deploy-now.sh`
4. Owner: `bash scripts/print-fly-e2e-env.sh` + admin creds → `bash e2e-workflow-test.sh`
5. Agent: on timer, recheck `/api/ready` for build=tip and migration `0066_*`; run E2E if secrets present

## Decisions made (don't relitigate)

- PR #31 supersedes closed #29 and #30
- No Fly deploy without `ARIA_PROD_DEPLOY_CONFIRM`
- Use `bash scripts/print-fly-deploy-confirm.sh` for exact deploy one-liner
- Skip Actions billing failures; local gate is authority
- Target migration is **0066** (not 0065)
- Deploy must refresh `ARIA_EXPECTED_*` secrets to tip ledger (stale 0060 identity left `/api/ready` stuck)

## Watch out

- Audit "Fly only" row requires literal `/0066/` in `fly-deploy-now.sh` (floor check satisfies this)
- Live Graph route is 404 until tip deploy
