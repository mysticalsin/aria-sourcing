---
project: MSourcing / ARIA
shift: 353
agent: cursor-cloud
updated: 2026-08-29T09:58Z
status: e2e-partial-tip-live-m365-deferred
---

# Handoff — Shift 353

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN (cherry-picked Graph-min reopen fixes; ignore stray `cursor/graph-minimum-reopen-fixes-bca0`)
- **Live Fly:** `e5c37c1` / **0074** · `deploy_status=tip_ahead_docs`
- **Gate/audit:** green · audit **65/65**
- **E2E verified:** PARTIAL **60 pass / 0 fail / 3 warn** on live `e5c37c1` — WARNs are microsoftOAuth + critic retry + no live seat (MS deferred)
- **Microsoft:** **DEFERRED** · `graph_secrets_missing=3` · no `/tmp/owner-microsoft.env`
- **LLM:** `llm_auth=dead` · Hermes/vault OK · no `/tmp/owner-llm.env`

## Done this shift

1. Cherry-picked Graph-minimum reopen fixes onto PR #36:
   - real Azure URL alone no longer ERROR as partial Entra (tenant derive OK; SSO skip when CLIENT_ID+SECRET PLACEHOLDER)
   - `/tmp/owner-microsoft.env` wins over stale production-readiness copy
   - `fly-enterprise-activate` Entra/LLM WARN-only; require `MICROSOFT_TENANT_ID`
2. Prior this session: inventory split, verify-m365 WARN, PLACEHOLDER Entra skip, post-m365 seat scopes, PARTIAL 60/0/3

## Blockers

- Owner reopen Microsoft for RESULT: PASS (Graph CLIENT/SECRET/TENANT → apply → Connect Outlook Calendars+OnlineMeetings → `verify-m365-ready`)

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh
# expect graph_secrets_missing=3; m365_secrets_missing=3 alias
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used
# expect classifier=model PASS on reply webhook poll
# expect RESULT: PARTIAL until Microsoft reopened
# When owner drops /tmp/owner-microsoft.env (Graph real; Entra CLIENT+SECRET PLACEHOLDER OK;
#   Azure URL alone may derive TENANT):
#   bash scripts/probe-m365-unblock.sh --apply
#   Settings → Connect Outlook (Calendars.ReadWrite + OnlineMeetings.ReadWrite)
#   bash scripts/verify-m365-ready.sh
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- **PR #36 only** (do not open separate PRs for tip-ahead fix branches)
- **2026-08-29: Owner — don’t do the Microsoft part**
- Deploy confirm remint is agent-owned (non-secret KEY=value only — never redirect print-fly-deploy-confirm output into dropzone)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E
- Never send `model:""` to `/api/hermes/chat`
- Owner Microsoft dropzone is Graph-minimum (Entra CLIENT+SECRET PLACEHOLDER OK; URL alone may derive tenant)
- verify-m365-ready + activate + inventory: Graph required; Entra/LLM WARN-only
- `m365_secrets_missing` = Graph bucket only
- Apply load order: `/tmp/owner-microsoft.env` wins

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- tip_ahead_docs after script-only commits — do not remint Fly for ops/docs alone
- `llm_env_missing=0` does not imply `llm_auth=ok`
- Stray branch `cursor/graph-minimum-reopen-fixes-bca0` is superseded by cherry-pick on PR #36 — do not open a second PR
