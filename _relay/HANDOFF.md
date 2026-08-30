---
project: MSourcing / ARIA
shift: 422
agent: cursor-cloud
updated: 2026-08-30T00:55Z
status: fixing-global-error-malformed-campaign
---

# Handoff — Shift 422

## Current state

- **Branch:** `cursor/rei-autopilot-send-b91d` (PR #40)
- **Incident:** Fly prod showed `global-error` — `Cannot read properties of undefined (reading 'title')`
- **Root cause:** Always-mounted Aria Command console maps campaigns through `campaignToAriaContext`, which read `jobAnalysis.title` unguarded. Workspace had malformed proof campaign `camp:unispike:proof` (null title / missing jobAnalysis).
- **Fix:** harden `campaignToAriaContext`; repair campaigns in `normalizeHermesState` / migrate; fail-soft ⌘K + topbar notifications
- **Fly tip before this fix:** `736f832…` — deploy needed after commit

## Done this shift

1. Reproduced critical load error in browser + console stack
2. Identified `campaignToAriaContext` / `AriaCommandConsole` useMemo as crash site
3. Code fix + tests `aria-command`, `campaign-repair`

## Blockers (owner / external)

1. Graph dropzones still empty → email auto-send HOLD
2. HeyReach 0 LI accounts / campaigns
3. Must deploy this tip to clear prod global-error

## Next steps

```bash
SHA=$(git rev-parse HEAD)
printf 'ARIA_RELEASE_SHA=%s\nARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:%s:aria-mantu-bootstrap,aria-mantu-app\n' "$SHA" "$SHA" > /tmp/owner-deploy-confirm.env
source /tmp/owner-deploy-confirm.env && bash scripts/fly-deploy-now.sh
# Then verify https://aria-mantu-app.fly.dev/floor loads without global-error
```

## Decisions made (don't relitigate)

- Never table-SELECT `sourcing_loop_controls` from service_role
- Shell must fail-soft on malformed campaigns (never take down global-error)
- Goal complete only on auto-send receipt (`sent>0`)
- Workspace `0d179005-e8e2-4b99-8b9a-b67453348005`

## Watch out

- Clearing `aria-workspace-bootstrap-v1` localStorage forces re-hydrate through repair
- Cron `sent` still includes durable `queued`
