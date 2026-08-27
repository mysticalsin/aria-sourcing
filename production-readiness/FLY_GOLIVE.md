# Fly golive — Mantu enterprise tenant (aria-mantu-app)

**Production URL:** https://aria-mantu-app.fly.dev  
**PR deliverable:** https://github.com/mysticalsin/aria-sourcing/pull/32 (supersedes closed #29–#31)

Demo login is disabled (`NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false`). Password auth
goes through GoTrue on `https://aria-mantu-kong.fly.dev`. Entra SSO turns on
when GoTrue Azure secrets exist and tip deploy sets
`NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true`.

## Target (feature branch tip)

| Check | Target |
|---|---|
| App build | tip SHA of `cursor/enterprise-autopilot-b91d` |
| DB migration | `>= 0066_calendar_meeting_url.sql` (tip may be `0067_*`) |
| `/api/ready` | `ok: true` (Fly sets `AGENT_FRAMEWORKS_REQUIRED=false`) |
| Graph webhook | `validationToken` → HTTP 200 plain text |
| Inbound need | signed `POST /api/webhooks/email-inbound` → `requisition_parse` |

## Owner activation (sanctioned)

```bash
# 1) Set secrets (templates only — fill real values)
bash scripts/print-fly-secrets-checklist.sh

# 2) Preflight (read-only)
bash scripts/fly-enterprise-activate.sh $(git rev-parse HEAD)

# 3) Deploy tip (requires confirm)
bash scripts/print-fly-deploy-confirm.sh
# export ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM from that output
bash scripts/fly-deploy-now.sh

# 4) E2E
bash scripts/print-fly-e2e-env.sh
export ADMIN_EMAIL='…' ADMIN_PASSWORD='…' EMAIL_INBOUND_WEBHOOK_SECRET='…'
# optional: export CRON_SECRET='…'
bash e2e-workflow-test.sh
```

Do **not** enable demo login on Fly. Do **not** `vercel --prod` for this tenant.

## Post-deploy proof

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/health
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,status,build,migration}'
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://aria-mantu-app.fly.dev/api/webhooks/microsoft-graph?validationToken=t"
```

Success: ready `ok=true`, migration `>= 0066_*` (tip may be `0067_*`), build matches tip,
Graph HTTP 200, `e2e-workflow-test.sh` PASS.

## Notes

- LinkedIn send stays assisted-manual (`409 manual-required`).
- Live calendar book only via `/api/calendar/event` + `confirmLive` with a Teams joinUrl.
- Loop intake is webhook-first (no empty `email_sync` polling).
