---
project: MSourcing / ARIA
shift: 351
agent: cursor-cloud
updated: 2026-08-29T09:25Z
status: e2e-partial-tip-live-m365-deferred
---

# Handoff — Shift 351

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** `e5c37c1` / **0074** · `deploy_status=tip_ahead_docs` (ops/docs tip; no app remint)
- **Gate/audit:** green · audit **65/65**
- **E2E verified (prior):** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 58 pass / 0 fail / 2 warn** (Microsoft only)
  - **classifier=model PASS**; Hermes/vault LLM OK
- **Microsoft:** **DEFERRED** · `graph_secrets_missing=3` (CLIENT/SECRET/TENANT) · `entra_secrets_missing=4` WARN · no `/tmp/owner-microsoft.env`
- **LLM:** `llm_auth=dead` but Fly-env key *present* (`llm_env_missing=0`) — auth-dead keys; Hermes/vault OK · no `/tmp/owner-llm.env`
- **Machines:** loop + cleanup + web started; framework_heartbeat not required for E2E PASS (start attempts may exit — ignore unless framework readiness is the goal)

## Done this shift

1. Split Fly missing-secret inventory: `graph_secrets_missing` (PASS blocker) vs `entra_secrets_missing` / `llm_env_missing` (WARN)
2. `probe-m365-unblock` + `print-fly-golive-status` use Graph bucket (`m365_secrets_missing` alias = graph)
3. Owner docs/checklist/example: Graph-minimum; Entra optional; verify-m365 WARN-only for Entra/LLM
4. Audit **65/65**; did not invent Microsoft secrets / did not run strict verify-m365-ready

## Blockers

- Owner reopen Microsoft for RESULT: PASS (`/tmp/owner-microsoft.env` Graph CLIENT/SECRET/TENANT → `probe-m365-unblock.sh --apply` → Connect Outlook Calendars+OnlineMeetings → `bash scripts/verify-m365-ready.sh`)

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh
# expect graph_secrets_missing=3 (not inflated Entra count); m365_secrets_missing=3 alias
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used (first-try preferred)
# expect classifier=model PASS on reply webhook poll
# expect RESULT: PARTIAL until Microsoft reopened
# When owner drops /tmp/owner-microsoft.env (Graph real; Entra optional/PLACEHOLDER OK):
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
- Live Graph promote requires OnlineMeetings + Calendars scopes (matches OAuth callback)
- Sourcing soft-skip is NOT tied to PARTIAL_M365
- Reply classify uses same Hermes→vault stack as drafts (cron classify-inbound-reply)
- Canned/synthetic/skip-reply-classify soft-skips force PARTIAL (never PASS)
- Loop revision RPC must not return full workspace.state (0074)
- Classify model text must tolerate markdown fences (`parseModelJsonObject`)
- Bootstrap migrate CLI timeout after `[migrate] complete` is non-fatal
- microsoftOAuth readiness must match authorize authority (tenant required in production)
- Owner Microsoft dropzone is Graph-minimum (Entra SSO optional for E2E PASS)
- Strict E2E live seat must prove both Calendars.ReadWrite and OnlineMeetings.ReadWrite
- verify-m365-ready matches E2E PASS: Graph+seat required; Entra SSO + Fly-env LLM auth are WARN-only
- **`m365_secrets_missing` / probe ready = Graph bucket only** (Entra/LLM do not inflate PASS blocker)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- Empathy critics reject employer-name-only openers as well as raw repo/follower counts
- After `fly deploy`, confirm loop/cleanup/heartbeat primaries are started (not standbys)
- tip_ahead_docs after script-only commits — do not remint Fly for ops/docs alone
- `llm_env_missing=0` does not imply `llm_auth=ok` (presence ≠ usable)
