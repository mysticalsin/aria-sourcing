---
project: MSourcing / ARIA
shift: 432
agent: cursor-cloud
updated: 2026-08-30T07:53Z
status: pr48-ready-optout-live-green
---

# Handoff — Shift 432

## Current state

- **PR #48** tip `8589332` · **9 files** · Fly build **matches** `858933263e1b73657fcaf7acb5290f9b843f24e2`
- **`/api/ready` → `ok:true`** · `agentFrameworks:true` (opt-out honored; secret `AGENT_FRAMEWORKS_REQUIRED=false`)
- Ready formula: `AGENT_FRAMEWORKS_REQUIRED === "true" || (NODE_ENV===production && !== "false")`
- Settings accordion one-open proven live: screenshots `/opt/cursor/artifacts/screenshots/pr48-ready-fly-*.png`
- **Did not** bring megapr back; **did not** merge; Graph/Microsoft HOLD unchanged

## Done this shift

1. Patched `src/app/api/ready/route.ts` + `tests/readiness.mts` only (beyond prior 7 settings files)
2. Commit `8589332` pushed on `cursor/settings-accordion-ux-b91d`
3. App-only Fly redeploy (preserved 0079 migration identity; skipped bootstrap)
4. Proved ready green + Settings accordion screenshots

## Blockers

none for ready gate / Fly tip match

## Next steps

```bash
gh pr view 48 --json changedFiles,additions,deletions,files,headRefOid
curl -sS https://aria-mantu-app.fly.dev/api/ready
# Parent: ManagePullRequest body update; owner merge decision
```

## Decisions made (don't relitigate)

- Minimal widen of PR #48 for ready opt-out authorized by Tony (not megapr)
- App-only slim deploy preserves live ARIA_EXPECTED_* (0079 / count 78); tip ledger ends 0054
- Prefer Fly secret + tip code opt-out over megapr redeploy

## Watch out

- Do not re-expand PR with SMART/OCR/Europe/scoring/autopilot
- Stock `fly-deploy-now.sh` refuses tip (migration floor ≥0066) — use app-only slim script
