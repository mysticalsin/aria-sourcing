---
project: MSourcing / ARIA
shift: 171
agent: cursor-cloud
updated: 2026-09-11T17:00Z
status: poll-ensure-reclaim-race-fixed
---

# Handoff — Shift 171

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `f1a2ee8`
- **Fly:** https://aria-mantu-app.fly.dev — still on older build `8ea3370…` (`agentFrameworks:false`); tip **not live**
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/125 → `integration/sourcing-enrichment-on-main` (draft)
- **Durable LinkedIn bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5`

## Done this shift

1. **Fleet + Campaign Agents polls are GET-only** (like Floor) — no more poll-`ensure` with Hermes `computerId`
2. **Hermes sync:** fleet/campaign GET aligns `seat.computerId` to DB-backed fleet rows after reclaim
3. **`ensureComputer` refuse:** cannot claim an orphan onto a seat that already owns a different durable VM (`computer-orphan-claim-blocked`)
4. Prior tip: reclaim persists `agent_seats.computer_id`; floor seatId hint isolation; host orphan import
5. Tests: `tests/computer-supervisor.mts` 62 passed; `npm run typecheck` green

## Blockers (goal incomplete)

1. Tip not deployed to Fly — operator Login reclaim / floor prove blocked
2. LinkedIn remember-me / checkpoint may need one human Take control
3. OPENBOT_MAX_COMPUTERS=5
4. `/api/ready` agentFrameworks:false
5. Operator Deploy→login→Release→floor distinct VMs + probe-backed healthy still outstanding

## Next steps

1. Deploy tip to Fly (protected workflow / image digest) — confirm `/api/ready` build SHA matches tip
2. Settings → Login on Tony seat — DB `computer_id` → UUID durable; Take control if checkpoint
3. Leave Fleet/Campaign open during Login — durable must stay bound (no poll thrash)
4. Operator N-seat floor prove; mark PR #125 ready when E2E evidence lands

## Decisions made (don't relitigate)

- Fly-only for LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session-probe`
- Never invent `computerId` from `seat.id`
- Never mint on GET/list/poll
- Never remint blank computerId when durable/healthy profile exists
- Unhealthy stored id → probe orphans → reclaim (not mint)
- Reclaim that claims an orphan must persist `agent_seats.computer_id` in the same request
- **Poll paths must not `ensure` with Hermes computerId (GET + sync only)**
- **ensure must not reclaim an orphan onto a seat that already has a durable binding**
- Floor computerId fallback must not cross seat ownership
- Unique `(workspace_id, computer_id)` in DB (0084)

## Watch out

- Demo-login ~5/min
- Do not commit `/tmp/aria-e2e/*` secrets
- Personalized invite notes free-tier max **200 characters**
- `comp_tony_01` often login-wall twin — reclaim prefers UUID durable bot after probe
- Production deploy is owner/protected workflow — do not bypass release guards
