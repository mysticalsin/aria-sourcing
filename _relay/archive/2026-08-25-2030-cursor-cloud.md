---
project: MSourcing / ARIA
shift: 74
agent: cursor-cloud
updated: 2026-08-25 UTC
status: linkedin-demo-events-writable
---

# Handoff - Shift 74

## Current state

- Feature branch `cursor/enterprise-autopilot-b91d`: open-demo LinkedIn Simulate **writes** events (browser durable store) instead of dry-run.
- API `POST /api/linkedin/simulate` without Supabase → `status:"recorded"` + `event` payload; client `appendLinkedInDemoEvent` → localStorage; Replies inbox reads via `useSyncExternalStore`.
- With Supabase: simulate no longer blocked by `publicDemoSideEffectsDisabled` (inbound telemetry, not outbound delivery).
- Production demo https://aria-sourcing-demo.vercel.app still needs redeploy of this tip for the fix to land.

## Done this shift

- Fixed “cannot write events” on open demo (was dry-run when `!supabaseEnabled`).
- Tests: `linkedin-demo-events-store`, `linkedin-simulate-demo`; parity updated.
- Local proof: demo-login → simulate → `recorded` + event payload.

## Blockers

- Vercel Production still lacks Supabase env (totosworld) — classify enqueue / RPC path needs service_role + migrations 0058–0059.
- Agent MCP cannot set totosworld env; Fly auth unavailable.

## Next steps

1. Ship tip to `vercel-demo`/`main` so production demo gets browser event writes.
2. When Supabase env available: set URL/anon/service_role + webhook secret; apply 0058–0059; redeploy.

## Decisions made (don't relitigate)

- Open demo LinkedIn channel events persist in **browser localStorage** when Supabase is absent (not dry-run).
- Simulate inbound channel events are exempt from public-demo outbound side-effect kill-switch.
- No LinkedIn member OAuth / scrape / cookies.

## Watch out

- GET `/api/linkedin/events` still returns `events:[]` in demo — inbox merges browser store.
- Do not send demo `seat_*` ids as UUID to simulate.
