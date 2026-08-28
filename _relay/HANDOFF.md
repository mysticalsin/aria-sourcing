---
project: MSourcing / ARIA
shift: 250
agent: cursor-cloud
updated: 2026-08-28T08:20Z
status: tip-live-008878e-e2e-47-pass-partial-m365-only-ux-honesty-pending-deploy
---

# Handoff — Shift 250

## Current state

- **Branch tip (local):** pending commit after M365 UX honesty + E2E count:10
- **Live Fly:** `008878e` · migration **0071** · `deploy_status=tip_live` (app tip until next deploy)
- **Test gate / audit:** green locally after this shift; **59/59**
- **Fly E2E (PARTIAL):** **47 pass, 0 fail, 1 warn** — **only** M365 Graph seat skip (step 6b)
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35) (supersedes closed #29–#33)

## Done this shift

- Honest M365 UX when Graph OAuth env missing: stack status + blocked step 2; Connect Outlook explains disabled state (no fake “connect” path)
- E2E sourcing-agent requests `count:10` (top-10 shortlist); accepts ≥1 live with clear pass text
- Refreshed `_relay/M365-OWNER-UNBLOCK.md` with 47-pass / M365-only evidence
- Re-confirmed az: `twalteur@amaris.com` cannot create apps + owns zero apps; Cursor setup actions re-requested (6 secrets + Entra app)

## Blockers (owner — full objective)

1. **M365 secrets (6 missing)** — only remaining E2E gap (step 6b Teams book + Entra SSO)
   - `bash scripts/print-m365-owner-portal-checklist.sh`
   - See `_relay/M365-OWNER-UNBLOCK.md`

## Next steps

1. Owner: apply M365 Fly secrets → Settings → Connect Outlook → full E2E without `ARIA_ALLOW_PARTIAL_M365_E2E`
2. After app code commit: `bash scripts/print-fly-deploy-confirm.sh` then app-only deploy; remint `ARIA_PROD_DEPLOY_CONFIRM`
3. Post-deploy: expect step 3c PASS with `provenance=live` (requested count:10); PARTIAL only when FAILS=0 and MS gap
4. Loop kill switch (A-1) only after P-1 Docker + full E2E PASS

## Decisions made (don't relitigate)

- **Production = Fly only** — ignore Vercel/GitHub Actions CI
- Hermes harness + skills bind agent runtime; sequential critics for reliability
- LinkedIn always 409 manual-required; interview prep approval-gated

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# → expect 47 pass, 0 fail, 1 warn (M365 only); expect step 3c PASS (live provenance)
# never pretends full PASS while step 6b is skipped
```
