---
project: MSourcing / ARIA
shift: 73
agent: cursor-cloud
updated: 2026-08-25 UTC
status: linkedin-heyreach-production-demo-live
---

# Handoff - Shift 73

## Current state

- **Production demo LIVE:** https://aria-sourcing-demo.vercel.app (pushed `main` + `vercel-demo` to `baa1ca6`).
- LinkedIn webhook route live (`POST /api/webhooks/linkedin` → 401 Bad signature).
- UI: Connect seat card + Simulate + Replies inbox verified on production.
- Open-demo mode: `supabaseEnabled=false` on this Vercel project build — Simulate dry-runs; no durable events until Supabase Production env is set.
- Feature branch `cursor/enterprise-autopilot-b91d` → PR #25 also updated.

## Done this shift

- Fast-forwarded `vercel-demo` and `main` to ship HeyReach-parity.
- Fixed demo Connect seat wipe (`seats:[]`) and Simulate non-UUID `seatId` validation.
- Verified production webhook + UI paths.

## Blockers

- **Vercel Production env missing Supabase** (`NEXT_PUBLIC_SUPABASE_URL`, anon, service_role) — owner must set in totosworld/aria-sourcing-demo; this agent MCP only has hobby team.
- Apply migrations **0058–0059** on the Supabase project once env is wired.
- Set `LINKEDIN_INBOUND_WEBHOOK_SECRET` (or EMAIL_ inbound secret) for signed vendor webhooks.
- CI Quality still fails on budget (pre-existing).
- Fly `aria-mantu-app` not updated (no flyctl auth).

## Next steps

1. Vercel → aria-sourcing-demo → Production env: set Supabase + DEMO_ADMIN_PASSWORD + inbound webhook secret; redeploy.
2. `supabase db push` (or SQL) migrations 0058+0059.
3. Live: Connect → Simulate reply → events inbox + classify job.
4. Optional: Fly deploy with same commit when fly auth available.

## Decisions made (don't relitigate)

- Production demo ships via `main`/`vercel-demo` FF from the feature tip.
- Open demo without Supabase is dry-run, not a hard failure for Connect/Simulate.

## Watch out

- Do not send demo `seat_*` ids as UUID to simulate (fixed).
- Vercel MCP re-auth to **totosworld** needed for env/promote from agents.
