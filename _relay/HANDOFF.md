---
project: MSourcing / ARIA
shift: 292
agent: cursor-cloud
updated: 2026-08-28T17:55Z
status: post-m365-loop-hardening
---

# Handoff — Shift 292

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (HOLD — do not open another)
- **Live Fly tip (prior):** `fca5ef6` / **0071** — this shift ships loop-hardening; redeploy after push
- **Audit:** **64/64** (was 62; +inbound subject+body idle route, +OAuth Live toggle honesty, +calendar empty-scope/orphan-delete pins)
- **M365:** still `fly_m365_missing=7` · watcher armed · `/tmp/owner-microsoft.env` absent
- **Goal:** strict E2E PASS still blocked on M365 secrets + Connect Outlook + Graph webhook

## Done this shift

1. `isNeedEmail` matches JD keywords on **subject+body** (body-only hiring requests no longer miss)
2. Ambiguous non-reply inbound → `route: "none"` (`ambiguous_non_need`) — no fake `reply_classify`
3. Graph calendar: **empty/missing scope** fail-closed as `not-sent`
4. Missing Teams `joinUrl`: best-effort Graph **DELETE** orphan → `not-sent` (retryable); DELETE fail → `unknown`
5. Hide Live toggle on Outlook/Teams/Gmail cards — mode follows OAuth hydrate only
6. Approval gate: never claim **Quality ready** unless `qualityCriticsUsed === true` (deterministic → warn)

## Blockers

- Owner must mint 7 Fly M365 secrets (Entra app + GoTrue Azure) then Connect Outlook + enable Graph webhook
- Strict: `env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh` after `verify-m365-ready.sh` step **6b**

## Next steps

```bash
bash scripts/fly-deploy-now.sh   # ship tip b8df725+ after push
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
bash scripts/print-fly-deploy-confirm.sh
bash scripts/probe-m365-unblock.sh
# when secrets land:
bash scripts/probe-m365-unblock.sh --apply
# Settings → Connect Outlook → Enable Graph webhook
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA
- Tony HOLD: keep #36 only; no parallel PR
- No candidate phone calling (Omogen Mio excluded)
- Manual mailbox labels ≠ Graph OAuth; Live send needs mode=live
- Goal stays active until **strict** E2E PASS on live Fly

## Watch out

- Do not spam relay-only HANDOFF commits
- Calendar orphan DELETE frees ledger only when Graph confirms delete/404
- Quality warn does not block demo approve; live `/api/outreach/approve` still enforces `critics_required`
- Hub apply requires `DATA_ENCRYPTION_KEY` or `CANDIDATE_HUB_SECRET` (≥16) — already on Fly
- GHA CI fails instantly with 0 steps — ignore
