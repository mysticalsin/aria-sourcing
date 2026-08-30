---
project: MSourcing / ARIA
shift: 388
agent: cursor-cloud
updated: 2026-08-29T17:57Z
status: e2e-partial-real-candidates-verified
---

# Handoff — Shift 388

## Current state

- **Fly live:** `1665b39` / migration **0074** · `/api/ready` ok · `llmKeysPresent=true` (Fly env kimi auth_dead; Hermes vault/failover works)
- **Enterprise PR:** [#36](https://github.com/mysticalsin/aria-sourcing/pull/36) `cursor/enterprise-autopilot-b91d` @ `f2840da` · deploy_status=`tip_ahead_docs`
- **Cloudflare PR:** [#37](https://github.com/mysticalsin/aria-sourcing/pull/37) · CI-BUDGET still blocks GHA
- **PARTIAL E2E (this shift):** **58 pass / 0 fail / 2 warn** · log `/tmp/e2e-partial-real-candidates.log` (+ `/opt/cursor/artifacts/e2e-partial-real-candidates.log`)
  - **Step 3c PASS:** top-10 shortlist, **ALL provenance=`live`**, **10 real profile URLs** (`totalFound=10`)
  - Intake → webhook hiring_need → campaign Sourcing → LinkedIn/email/WhatsApp drafts (fr) → dry-run send → calendar dry-run
  - Classifier=`model` on inbound reply; HeyReach MCP connected
  - **RESULT: PARTIAL** — only Graph seat / confirmLive Teams remaining

## Done this shift

1. Owner asked to test E2E + real candidate sourcing
2. Ran `bash scripts/run-enterprise-e2e-partial.sh` on enterprise tip against live Fly
3. Confirmed step 3c live shortlist (not soft-skipped)

## Blockers

1. Entra admin → Graph seat → dropzone → Connect Outlook → `verify-m365-ready` → strict **RESULT: PASS**
2. Tony: restore GitHub Actions minutes for PR #37 CI

## Next steps

```bash
ls /tmp/owner-azure-app-id /tmp/owner-microsoft.env /tmp/owner-llm.env
# when Microsoft dropzone real (PR #36 only):
bash scripts/probe-m365-unblock.sh --apply
bash scripts/verify-m365-ready.sh   # expect RESULT: PASS
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS; RESULT: PARTIAL until live Graph seat
# after Graph seat + Connect Outlook: drop ARIA_ALLOW_PARTIAL_M365_E2E → RESULT: PASS
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
```

## Decisions made (don't relitigate)

- Production = Fly only
- Microsoft quiet HOLD / dropzones only until owner drops secrets
- Local gate authority while Actions budget empty
- Cloudflare = PR #37; M365 = PR #36 only

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets
- Do not soft-skip sourcing (`ARIA_ALLOW_SKIP_SOURCING_E2E`) when proving real candidates
