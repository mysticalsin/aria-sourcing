---
project: MSourcing / ARIA
shift: 178
agent: cursor-cloud
updated: 2026-09-11T20:35Z
status: campaign-clear-foreign-tip-not-released
---

# Handoff — Shift 178

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `d08cc9b` (campaign clear-foreign + seatId contracts + ownership stack)
- **Fly:** https://aria-mantu-app.fly.dev — build `8ea3370…` (**tip not live**); `/api/ready` `ok:false` (`agentFrameworks:false`)
- **PR:** #132 → `integration/sourcing-enrichment-on-main` (draft; prior #131 CLOSED)
- **Durable bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5` ↔ seat `600e8afa-a7c4-40ef-91c8-f4854fa9e5fc`
- **Host:** capacity often 3/5 computers

## Done this shift

1. Campaign Agents poll passes **full** fleet computers into `fleetHermesComputerPatches` (filtered rows missed foreign owners)
2. Settings: single patch pass (no per-seat double call)
3. Demo `addSeat` forces `computerId: null` (ignore client partial)
4. `fleet-hermes-sync` registered in `tests/test-manifest.mjs` application gate
5. Route contract tests: ensure/navigate/session_probe require seatId (no computerId fallback)
6. Tests: fleet-hermes-sync 8, boot-browser-computer 9, computer-supervisor 65; typecheck green

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
- Floor/Settings/Fleet/Campaign sync Hermes from fleet GET (**including clear-foreign; Campaign uses full fleet list**)
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
