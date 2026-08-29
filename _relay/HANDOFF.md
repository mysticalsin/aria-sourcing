---
project: MSourcing / ARIA
shift: 340
agent: cursor-cloud
updated: 2026-08-29T06:10Z
status: tip-live-empathy-prompt-harden-pending-deploy
---

# Handoff — Shift 340

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** (reopen if CLOSED; draft only)
- **Live Fly (verified):** `93dd657` / **0073** · `deploy_status=tip_live`
- **Tip ahead (pending deploy):** empathy / employer-name-only opener prompt harden + manifest count freeze (195/248)
- **Gate:** tsc green · audit **64/64** · manifest contract updated for `outreach-activity-signal`
- **E2E verified (live `93dd657`):** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 59 pass / 0 fail / 3 warn** (Microsoft + one LinkedIn approve retry)
  - step **3c PASS** top-10 live; reply webhook **route=reply_classify** (no soft-skip)
  - approve needed **1 retry** — empathy critic: company-name-only compliment (`TryCatchLearn`) felt like database insert
  - **live LLM critics (stages=6)** after regenerate
  - drafts still sanitize raw activity metrics
- **Microsoft:** **DEFERRED** (no `/tmp/owner-microsoft.env`) · `m365_secrets_missing=7`
- **LLM:** Fly env `llm_auth=dead` — drafts/critics via Hermes gateway / vault failover

## Done this shift

1. Confirmed Fly deploy of `93dd657` → `tip_live` / ready build matches tip
2. Re-ran enterprise E2E partial on tip_live → 59/0/3 PARTIAL
3. Hardened outreach prompts/skills/harness/E2E against employer-name-only openers (pending deploy)
4. Fixed test-manifest lifecycle freeze (application 195 / all 248) left stale by prior suite add

## Blockers

- Owner reopen Microsoft for Teams/Outlook book (Graph seat + confirmLive)
- Deploy tip after empathy prompt commit for first-try approve regression check

## Next steps

```bash
bash scripts/print-fly-golive-status.sh   # tip vs live
# if tip_ahead_app:
bash scripts/print-fly-deploy-confirm.sh   # remint KEY=value only into /tmp/owner-deploy-confirm.env
bash scripts/fly-deploy-now.sh
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used (prefer first-try; retry still OK)
# expect RESULT: PARTIAL until Microsoft reopened
# Do NOT set ARIA_ALLOW_PARTIAL_LLM_E2E / ARIA_ALLOW_SKIP_APPROVE_E2E unless regressing
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

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- Empathy critics reject employer-name-only openers as well as raw repo/follower counts
