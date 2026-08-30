---
project: MSourcing / ARIA
shift: 423
agent: cursor-cloud
updated: 2026-08-30T01:50Z
status: calypso-amacan-e2e-green
---

# Handoff — Shift 423

## Current state

- **Branch:** `cursor/rei-autopilot-send-b91d` (PR #40)
- **Shell crash fix** still on Fly tip `97c9c95` (deploy parser tip after this commit)
- **VSS parser:** fixed Tony line-oriented AMACAN/BNPP Calypso need (empty-field label leak, Urgent-but-not-Critical, Middle 4–6y, partial remote → Hybrid, skill token split)
- **Local E2E:** demo login → intake paste → Parse JD → Create campaign → **10 candidates** for `Calypso Application Support` (camp_1788054308646_…)

## Done this shift

1. Fixed VSS Label\\nvalue extraction + urgency/seniority/remote/years/skills
2. Fixture `tests/fixtures/tony-calypso-amacan-need.txt` + 13 new mantu-intake asserts (115 pass)
3. Local UI E2E with Tony need proven end-to-end

## Blockers (owner / external)

1. Graph dropzones empty → email auto-send HOLD
2. HeyReach 0 LI accounts / campaigns
3. Prod demo login off — authenticated prod floor needs real Supabase creds

## Next steps

```bash
SHA=$(git rev-parse HEAD)
printf 'ARIA_RELEASE_SHA=%s\nARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:%s:aria-mantu-bootstrap,aria-mantu-app\n' "$SHA" "$SHA" > /tmp/owner-deploy-confirm.env
source /tmp/owner-deploy-confirm.env && bash scripts/fly-deploy-now.sh
```

## Decisions made (don't relitigate)

- Shell fail-soft on malformed campaigns
- "Urgent but not Critical" → Urgent (not Critical)
- Partial remote → Hybrid
- Prefer Level of Experience field over mission prose for years
- Goal complete only on auto-send `sent>0`

## Watch out

- Disk was full from `/opt/cursor/recording-staging` (~223GB) — cleared to restart Next
- localhost (not 127.0.0.1) for local Next allowedDevOrigins
