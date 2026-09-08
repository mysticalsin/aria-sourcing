# Evidence — Enterprise Fleet track / audit

**Date:** 2026-09-08  
**Branch:** `cursor/linkedin-auto-vm-fleet-b91d`

## What shipped

1. **Durable audit trail** — `src/lib/computer-audit.ts`
   - Memory ring (5k) + JSONL (`COMPUTER_AUDIT_LOG_PATH` / `/tmp/aria-computer-audits.jsonl`) + Postgres `computer_audits`
2. **Migration** — `supabase/migrations/0081_computer_audits.sql` (text PK, RLS, indexes on workspace/computer/action/correlation)
3. **Supervisor wiring** — every ensure/start/stop/takeover/release/help/job writes durable audits; takeover gets `correlationId`
4. **API**
   - `GET /api/fleet/computers` → `computers` + `summary` + `recentAudits` (prefers durable)
   - `GET /api/fleet/computers/audits` → JSON or `format=csv` with filters: computerId, actor, action, correlationId, since, until, limit
5. **Ops UI** — `FleetComputerOpsBoard` on `/fleet`
   - KPI strip (ready / human control / help / errors)
   - Seat list filters + search
   - Audit timeline with actor filter, session duration on release, click correlation to filter session, copy computer id, Export CSV
6. **Viewport** — per-computer audit trail polling on `/fleet/computers/[id]/viewport`

## Tests

```
npx tsx tests/computer-audit.mts     # 19 passed
npx tsx tests/computer-supervisor.mts # 12 passed
npx tsc --noEmit                      # clean
```

## Ops notes

- Apply migration `0081` on Fly Supabase before relying on Postgres durability.
- JSONL + memory work without Postgres (dev / fail-soft).
- Never enable `COMPUTER_SUPERVISOR_MOCK_SEND=1` on production.
