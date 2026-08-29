---
project: MSourcing / ARIA
shift: 331
agent: cursor-cloud
updated: 2026-08-29T02:55Z
status: tip-live-critics-hermes-blocked-on-kimi
---

# Handoff — Shift 331

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly = tip:** `46a1531` / **0073** (`deploy_status=tip_live`)
- **Gate / audit:** green · **64/64**
- **PARTIAL E2E:** **62 pass / 0 fail** (HMAC register; Teams skipped; critics still soft-fail)
- **Microsoft / M365:** **DEFERRED**
- **LLM:** `llm_auth=dead` (Kimi 401). Hermes proxy also errors `provider=kimi status=401` — Hermes-first critics cannot unblock without a live backend key.
- **No** `/tmp/owner-llm.env`

## Done this shift

1. Workspace critics → `resolveLoopLlm` (Hermes-first → cloud) — aligned with draft cron
2. Deployed tip_live `46a1531`; PARTIAL still soft-fails approve (`critics_required`) because Hermes upstream = dead Kimi
3. Timer subscribed: recheck `/tmp/owner-llm.env` every 30m

## Blockers

- Owner remint live LLM (`/tmp/owner-llm.env`) — unblocks critics + cloud path
- Owner reopen Microsoft — unblocks Teams/Outlook book for strict PASS

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
ls /tmp/owner-llm.env  # when present: fly-apply-owner-llm-secrets + probe-fly-llm-auth
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,status,build,migration,components}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live; provenance / live=0 is quota
# After live LLM: drop ARIA_ALLOW_PARTIAL_LLM_E2E and expect approve critics PASS
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
- Deploy confirm remint is agent-owned (non-secret)
- Workspace critics share Hermes-first stack with loop drafts
- Hermes-first ≠ live critics while Hermes upstream is the same auth-dead Kimi

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
