---
project: MSourcing / ARIA
shift: 354
agent: cursor-cloud
updated: 2026-08-29T10:16Z
status: e2e-partial-tip-live-m365-deferred
---

# Handoff — Shift 354

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** `c545c07` / **0074** · `deploy_status=tip_live`
- **Gate/audit:** green · audit **65/65**
- **E2E verified now:** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 58 pass / 0 fail / 2 warn** (Microsoft only — no critic retry WARN)
  - **classifier=model PASS**; top-10 live; first-try Human approval + live critics
- **Microsoft:** **DEFERRED** · `graph_secrets_missing=3` · no `/tmp/owner-microsoft.env`
- **LLM:** `llm_auth=dead` · Hermes/vault OK · no `/tmp/owner-llm.env`

## Done this shift

1. Fixed GitHub-activity boilerplate feeding drafts (`Active GitHub profile` → critic `"Votre activité GitHub récente"`)
2. Deployed tip_ahead_app → tip_live `c545c07`
3. Re-ran PARTIAL E2E: **58/0/2** — MS WARNs only; first-try approve (critic retry eliminated)

## Blockers

- Owner reopen Microsoft for RESULT: PASS

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh   # tip_live c545c07 / 0074
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used (first-try preferred)
# expect classifier=model PASS on reply webhook poll
# expect RESULT: PARTIAL until Microsoft reopened
# When owner drops /tmp/owner-microsoft.env (Graph real; Entra CLIENT+SECRET PLACEHOLDER OK):
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
- Deploy confirm remint is agent-owned (KEY=value only — never redirect print-fly-deploy-confirm output into dropzone)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E
- Graph-minimum dropzone; Entra/LLM WARN-only
- Ban GitHub-activity boilerplate in activity signals + Hermes rules

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- After `fly deploy`, confirm loop/cleanup/heartbeat primaries are started (not standbys)
- Empathy critics reject employer-name-only openers and GitHub-activity boilerplate
