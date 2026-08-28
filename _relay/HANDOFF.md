---
project: MSourcing / ARIA
shift: 244
agent: cursor-cloud
updated: 2026-08-28T05:42Z
status: gate-green-live-0070-m365-owner-path-documented
---

# Handoff — Shift 244

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d`
- **Live Fly:** **`6ed278e`** (migration **0070**)
- **Deploy:** `bash scripts/print-fly-golive-status.sh` — code live; relay-only tip may be ahead
- **Test gate / audit:** green; **57/57**
- **Live E2E:** **35 pass, 0 fail** (PARTIAL M365)
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35) ([#33](https://github.com/mysticalsin/aria-sourcing/pull/33) closed); supersedes #29–#32
- **Deploy confirm:** `bash scripts/print-fly-deploy-confirm.sh` when tip code changes

## Done this shift

- **`az-configure-existing-graph-app.sh`** — owner path when Entra account cannot *create* apps (portal app + `ARIA_AZURE_APP_ID`)
- Shared Graph permission helper; `fly-wait-entra` tries configure when `ARIA_AZURE_APP_ID` set

## Blockers (owner)

1. **M365 secrets** (6 missing) — `twalteur@amaris.com` cannot create Entra registrations
2. **Owner picks one:**
   - Portal: create app → `export ARIA_AZURE_APP_ID=...` → `bash scripts/az-configure-existing-graph-app.sh --apply`
   - Or paste `/tmp/owner-microsoft.env` → `bash scripts/fly-apply-owner-microsoft-secrets.sh`
3. Full E2E without `ARIA_ALLOW_PARTIAL_M365_E2E=1`; **expect step 3c PASS** with `provenance=live`

## Decisions made (don't relitigate)

- Fly = production; ignore Vercel CI rate limit
