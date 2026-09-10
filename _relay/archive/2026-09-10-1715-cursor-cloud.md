---
project: MSourcing / ARIA
shift: 128
agent: cursor-cloud
updated: 2026-09-10T16:35Z
status: fly-password-login-candidates-visible
---

# Handoff — Shift 128

## Current state

- **Branch:** `cursor/fly-sourcing-e2e-ready-b91d` @ `07491a9`
- **Fly:** https://aria-mantu-app.fly.dev — password login shows Windows Desktop candidates
- **Login:** email `Twalteur@amaris.com` / password via Fly secret (GoTrue `signInWithPassword`, not demo-login CTA)
- **Campaign:** `camp_mor1jp00097605_enterprise-windows-desktop-engineer`
- **Candidates in workspace_state (5):** Jonah Mack, Patrick Nuckle, Ivan Kruger, Zachary Maggard, Francois Lafond
- Verified Playwright: password login → Candidates tab → **Showing 5 of 5** with all full names
- Evidence: `/opt/cursor/artifacts/fly-password-candidates-visible.png`

## Done this shift

1. Persisted sourced candidates into live `workspace_state` (API alone does not write the UI list)
2. Set `activeCampaignId` to Windows Desktop need; confidentialityMode off
3. Login CTA uses GoTrue password sign-in
4. Moved Candidates table above enrichment so rows are visible without scrolling past empty-looking chrome
5. Redeployed Fly tip `07491a9`

## Blockers

1. Onboarding modal can block first click — dismiss once (`hermes:onboarded:v2`)
2. LinkedIn send still needs Take control login/2FA

## Next steps

1. Hard refresh after login if an old tab had empty state
2. Open Enterprise Windows Desktop Engineer → Candidates tab
3. Merge PR when ready

## Decisions made (don't relitigate)

- Fly showcase uses password login, not demo-login one-click
- Candidates must be in `workspace_state.candidates` to appear in UI

## Watch out

- Running sourcing via API without client commit leaves candidates invisible
- Client save from a stale empty tab can overwrite seeded candidates — refresh before editing
