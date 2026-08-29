---
project: MSourcing / ARIA
shift: 318
agent: cursor-cloud
updated: 2026-08-29T00:22Z
status: microsoft-deferred-empty-state-sweep
---

# Handoff — Shift 318

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (supersedes #29)
- **Tip:** pending-commit · Live Fly `fc8b54a` / **0071** (tip **0072**)
- **Audit:** **64/64** · **Gate:** green
- **Microsoft / M365:** **DEFERRED by owner**
- **CI:** GHA jobs fail with `steps: []` / 0ms billable — **ignore** (Fly only)
- **LLM:** `llm_auth=dead`
- App hydrate fallbacks: EmptyState across recruiting + system surfaces (no SkeletonCard collage)

## Done this shift

1. Confirmed CI failure on `72df09e` is empty-steps noise (all 7 jobs `steps: []`)
2. EmptyState hydrate sweep: intake, launch, dashboard, applicants, winlog, skills, trust, chat, floor, sessions, replay, reports, vivier, memory, curator, soul + runtime load panels
3. Audit pins for Loading * strings; gate green **64/64**

## Blockers

- Strict enterprise PASS still needs owner-reopened Microsoft/M365 + live LLM
- Deploy tip **0072** needs owner deploy-confirm remint

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
git status
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
bash scripts/print-fly-deploy-confirm.sh
# Non-MS PARTIAL only (M365 deferred):
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live; provenance / live=0 is quota
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only (supersedes #29)
- **2026-08-29: Owner — don’t do the Microsoft part**
- LinkedIn always assisted-manual; PARTIAL still requires inboundWebhookSecret
- Loop live book = `confirm-calendar-book`; propose cron dry-run

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
