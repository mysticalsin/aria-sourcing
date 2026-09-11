---
project: MSourcing / ARIA
shift: 177
agent: cursor-cloud
updated: 2026-09-11T19:59Z
status: hermes-ownership-fail-closed-tip-not-released
---

# Handoff — Shift 177

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `59d160e` (Hermes clear-foreign + ownership fail-closed)
- **Fly:** https://aria-mantu-app.fly.dev — build `8ea3370…` (**tip not live**); `/api/ready` `ok:false` (`agentFrameworks:false`)
- **PR:** #131 → `integration/sourcing-enrichment-on-main` (draft; prior #130 may be CLOSED)
- **Durable bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5` ↔ seat `600e8afa-a7c4-40ef-91c8-f4854fa9e5fc`
- **Host:** capacity often 3/5 computers

## Done this shift

1. `fleetHermesComputerPatches` — Floor/Fleet/Campaign/Settings write owned bindings **and clear** Hermes when `computerId` is owned by another seat
2. Settings health badge gated by `computerHealthOwnedBySeat` (no cross-desk green)
3. Seat create always `computer_id: null` (ignore client body)
4. `ensure` / `navigate` / `session_probe` require real `seatId` (never default to `computerId`)
5. `reclaimHealthyOrphan` ownership-mismatch falls through; fallback only if still ours/orphan
6. `resolveDurableComputerId` mints on ownership / no-healthy-orphan errors instead of keeping a foreign id
7. Floor rollup counts ready+healthy LI even when theatrical activity is idle
8. Tests: `fleet-hermes-sync` 8, `boot-browser-computer` 9, `floor` 54; `npm run typecheck` green

## Blockers (goal incomplete)

1. Tip not on protected Fly release / deploy pipeline
2. LinkedIn login wall — needs human credentials / 2FA Take control
3. OPENBOT_MAX_COMPUTERS=5
4. `/api/ready` agentFrameworks:false
5. Operator N-seat prove of tip features still outstanding on live

## Next steps

1. Land tip via protected release — confirm `/api/ready` build SHA == tip
2. Human Take control → LinkedIn login on durable VM → Release → `session_probe` true
3. With tip live: prove N distinct computerIds, no cross-desk bleed, floor shows only healthy/real-send agents
4. Mark PR ready only when tip SHA live + session prove + N-seat evidence

## Decisions (don't relitigate)

- Fly-only LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session_probe`
- Never invent `computerId` from `seat.id`; never mint on GET/poll
- Reclaim must persist `agent_seats.computer_id` same request
- Poll GET+sync only; ensure must not steal durable bindings
- Login must not trust Hermes-only computerId over empty API/DB
- Floor/Settings sync Hermes from fleet GET (**including clear-foreign**)
- All boot paths reclaim-before-mint; seat create leaves computerId null
- computerId fallback must not cross seat ownership
- Unique `(workspace_id, computer_id)` (0084)
- Live computer map → floor "working" is VM/send truth, not theatrical activity
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login ~5/min; user `Twalteur@amaris.com` (password in `/tmp/aria-e2e/demo_pw.clean` — do not commit)
- Closing PRs often deletes remote branch — push + recreate PR
- `comp_tony_01` login-wall twin; prefer UUID durable after probe
- Personalized invite notes free-tier max **200** chars
