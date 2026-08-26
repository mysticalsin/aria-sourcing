---
project: MSourcing / ARIA
shift: 95
agent: cursor-cloud
updated: 2026-08-26 UTC
status: integrations-apple-ux
---

# Handoff - Shift 95

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29 → `integration/sourcing-enrichment-on-main`
- Settings → Integrations **Apple UX pass** landed (`49a21f1`):
  - Unified **Identity & outreach** stack (`linkedin-outreach-stack.tsx`) — Step 1 OIDC, Step 2 HeyReach MCP, progress bar
  - Shared primitives: `integration-connection-primitives.tsx` (step rail, System readiness collapse, health strip)
  - Email panel uses System readiness (no badge spam)
  - Integration cards: **Open stack** scrolls to `#linkedin-outreach-stack`; `int_heyreach` test connection wired
- Prior shift work still on branch: LinkedIn OIDC, exec world map, HeyReach MCP, STATE_VERSION 18 honesty
- Focused tests green: `integrations-honesty`, `heyreach-mcp`, `linkedin-oauth`, `tsc`

## Ops required for live OAuth on Fly

1. LinkedIn Developer Portal → Sign In with LinkedIn using OpenID Connect
2. Redirect: `https://aria-mantu-app.fly.dev/auth/linkedin/callback`
3. `fly secrets set LINKEDIN_CLIENT_ID=… LINKEDIN_CLIENT_SECRET=… LINKEDIN_REDIRECT_URI=… -a aria-mantu-app`
4. Apply migration **0061**; redeploy branch SHA

## Done this shift

- Apple-grade Integrations UX (unified LinkedIn stack, readiness collapse, health strip)
- Screenshot artifact: `/opt/cursor/artifacts/screenshots/integrations-apple-ux-stack.webp`

## Blockers

- Fly missing LinkedIn OAuth secrets until ops
- Full `npm test` may still have pre-existing `store-sourcing-actions` failures (unrelated)

## Next steps

1. Tony/ops: LinkedIn app + Fly secrets + migrate 0061 + redeploy
2. Smoke live: Settings → Integrations → Sign in with LinkedIn + HeyReach MCP connect
3. Optional: triage remaining sourcing test harness failures

## Decisions made (don't relitigate)

- OIDC identity login allowed; no password/session scrape
- HeyReach MCP = agent outreach tools; identity stays OIDC
- System readiness collapsed by default (expand when blocked)
- No fake connected integration seeds (STATE_VERSION 18)

## Watch out

- `LinkedInConnectionsProvider` required for stack — single fetch for both steps
- Redirect URI must match LinkedIn app exactly
- HeyReach MCP dev needs `ARIA_ENABLE_REMOTE_MCP_EXECUTION=true`
