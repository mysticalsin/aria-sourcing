---
project: MSourcing / ARIA
shift: 352
agent: cursor-cloud
updated: 2026-08-29T09:40Z
status: e2e-partial-tip-live-m365-deferred
---

# Handoff — Shift 352

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** `e5c37c1` / **0074** · `deploy_status=tip_ahead_docs`
- **Gate/audit:** green · audit **65/65**
- **E2E verified now:** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 60 pass / 0 fail / 3 warn** (Microsoft only)
  - **classifier=model PASS**; top-10 live; Hermes drafts + live critics (1 approve retry)
- **Microsoft:** **DEFERRED** · `graph_secrets_missing=3` · no `/tmp/owner-microsoft.env`
- **LLM:** `llm_auth=dead` · `llm_env_missing=0` · Hermes/vault OK · no `/tmp/owner-llm.env`

## Done this shift

1. Fresh PARTIAL E2E **60/0/3** on live `e5c37c1` (up from 58)
2. **P0 fix:** Graph-minimum apply — PLACEHOLDER Entra no longer hard-errors; embedded `PLACEHOLDER_*` in Azure URL detected; example uses `PLACEHOLDER_TENANT_ID`
3. Golive/wait use `owner_ms_has_drop_file` / `owner_ms_has_credentials` (not blanket PLACEHOLDER grep)
4. `post-m365-secrets-golive` live-seat wait requires Calendars+OnlineMeetings (match verify-m365-ready)

## Blockers

- Owner reopen Microsoft for RESULT: PASS (Graph CLIENT/SECRET/TENANT dropzone → apply → Connect Outlook Calendars+OnlineMeetings → `verify-m365-ready`)

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
# When owner drops /tmp/owner-microsoft.env (Graph real; Entra PLACEHOLDER OK):
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
- PR #36 only
- **2026-08-29: Owner — don’t do the Microsoft part**
- Deploy confirm remint is agent-owned (non-secret KEY=value only — never redirect print-fly-deploy-confirm output into dropzone)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E
- Never send `model:""` to `/api/hermes/chat`
- Live Graph promote requires OnlineMeetings + Calendars scopes
- Owner Microsoft dropzone is Graph-minimum (Entra SSO optional / PLACEHOLDER OK)
- verify-m365-ready + post-m365 seat wait: Graph+Calendars+OnlineMeetings; Entra/LLM WARN-only
- `m365_secrets_missing` = Graph bucket only
- fly-apply skips Entra when all GOTRUE_* are PLACEHOLDER/empty (not partial ERROR)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- After `fly deploy`, confirm loop/cleanup/heartbeat primaries are started (not standbys)
- tip_ahead_docs after script-only commits — do not remint Fly for ops/docs alone
- `llm_env_missing=0` does not imply `llm_auth=ok`
