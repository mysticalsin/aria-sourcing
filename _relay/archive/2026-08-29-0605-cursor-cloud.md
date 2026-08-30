---
project: MSourcing / ARIA
shift: 339
agent: cursor-cloud
updated: 2026-08-29T05:45Z
status: critics-pass-m365-partial-only
---

# Handoff — Shift 339

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `cb6d217` / **0073** · `deploy_status=tip_ahead_docs` (tip ops/tests/_relay only)
- **Gate:** tsc green · audit **64/64** · fleet-seats-server 21/0 after Teams-scope pin
- **E2E verified (live `cb6d217`):** `bash scripts/run-enterprise-e2e-partial.sh`
  - **RESULT: PARTIAL · 57 pass / 0 fail / 2 warn** (Microsoft only)
  - step **3c PASS** top-10 live
  - first-try approve (no repo-count empathy flake) + **live LLM critics (stages=6)**
  - drafts sanitize raw activity metrics; critic 422 feedback still wired for retries
  - calendar slot jittered (ready for post-MS confirmLive re-runs)
- **Microsoft:** **DEFERRED** (no `/tmp/owner-microsoft.env`) · live promote fail-closed without OnlineMeetings/Calendars scopes
- **MS reopen check:** reconfirmed deferred; timer re-armed (~30m)

## Done this shift

1. `assertMicrosoftGraphSeatLiveReady` requires Calendars.ReadWrite + OnlineMeetings.ReadWrite
2. E2E approve regenerates with critic 422 feedback; confirmLive slot jitter
3. Deployed `cb6d217` to Fly; hardened confirm dropzone loader (no accidental `source` deploy)
4. tip_ahead classifier: ops golive scripts are docs-only (not image)
5. MS reopen check: still deferred; drafts avoid raw GitHub repo-count citations (first-try approve)

## Blockers

- Owner reopen Microsoft for Teams/Outlook book (Graph seat + confirmLive)

## Next steps

```bash
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh   # expect tip_ahead_docs or tip_live; live cb6d217
bash scripts/print-fly-deploy-confirm.sh   # remint KEY=value only into /tmp/owner-deploy-confirm.env when tip_ahead_app
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics used
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
