---
project: MSourcing / ARIA
shift: 355
agent: cursor-cloud
updated: 2026-08-29T10:22Z
status: graph-oauth-live-awaiting-connect-outlook
---

# Handoff — Shift 355

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** `c545c07` / **0074** · `deploy_status=tip_ahead_docs` (HANDOFF tip)
- **Gate/audit:** green · audit **65/65**
- **Graph secrets:** **APPLIED** · `graph_secrets_missing=0` · `microsoftOAuth=true` · Entra SSO skipped (PLACEHOLDER CLIENT/SECRET; URL used for tenant derive only)
- **E2E verified now:** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 60 pass / 0 fail / 2 warn**
  - `microsoftOAuth=true` PASS (no false WARN)
  - **classifier=model PASS**; top-10 live; approve after 1 critic retry
  - Remaining WARN: no live Graph seat (Connect Outlook) + one critic specificity retry
- **Dropzone:** `/tmp/owner-microsoft.env` synced (mode 600) · never commit
- **LLM:** `llm_auth=dead` · Hermes/vault OK

## Done this shift

1. Owner Microsoft env-exports → `probe-m365-unblock.sh --apply` → **applied-ok** · `graph_secrets_missing=0`
2. Entra PLACEHOLDER skip + tenant derive from Azure URL exercised live
3. post-m365: `microsoftOAuth=true`; Connect Outlook remaining (exit 5)
4. PARTIAL E2E **60/0/2** — microsoftOAuth=true PASS; only live-seat WARN left for MS

## Blockers

- **Human:** Settings → Connect Outlook (grant Calendars.ReadWrite + OnlineMeetings.ReadWrite, mode=live) → Enable Graph webhook
- Then: `bash scripts/verify-m365-ready.sh` (strict, no PARTIAL_M365)

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
# expect graph_secrets_missing=0 m365_secrets_missing=0 microsoftOAuth path ready
# HUMAN: https://aria-mantu-app.fly.dev/settings → Connect Outlook → Enable webhook
# After live seat:
bash scripts/verify-m365-ready.sh
# expect RESULT: PASS (confirmLive Teams joinUrl)
# Until seat exists, PARTIAL still honest:
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS; classifier=model PASS; microsoftOAuth=true (no microsoftOAuth=false WARN)
# expect still PARTIAL until live seat (confirmLive skip only)
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# After Connect Outlook: bash scripts/verify-m365-ready.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only
- Graph-minimum apply (Entra PLACEHOLDER OK; URL may derive tenant)
- Deploy confirm remint is agent-owned (KEY=value only)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E
- Ban GitHub-activity boilerplate in draft signals
- Owner Microsoft env-exports are valid apply triggers (sync to `/tmp/owner-microsoft.env`)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- Do not invent Entra SSO secrets; Graph-only is enough for PASS after Connect Outlook
- `/tmp/owner-microsoft.env` contains secrets — never commit; never print values
