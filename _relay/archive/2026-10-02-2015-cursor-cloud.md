---
project: MSourcing / ARIA
shift: 203
agent: cursor-cloud
updated: 2026-10-02T20:10Z
status: n-agent-gap-audit
---

# Handoff — Shift 203

## Current state

- **Branch:** `cursor/n-agent-gap-audit-e69c` (from `cursor/linkedin-human-claude-chrome-b91d` @ 4de692b)
- **Goal:** N agents + isolated VMs real on 3D floor + FE↔BE wired (ponytail) — isolation + Claude Chrome perms landed; Manual mode still FE-only theater
- **Audit:** `_relay/codex-findings.md` → `2026-10-02 — N-agent floor / FE↔BE gap audit`

## Done this shift

1. Very thorough gap audit vs N-agent goal (floor poll, ownership, ensure/navigate, profileVolume, permissions, seatId FE, N-agent tests)
2. Updated prior N-seat audit: gaps 1–2 marked FIXED (246cdd9); remaining OPEN listed with file:line table

## Blockers

1. Live Fly Take control → LinkedIn login → Release → `sessionHealthy:true` still required for green floor
2. Manual permissions localStorage-only — BE never gates `linkedin_send`

## Next steps

1. **Best ponytail fix:** Wire Manual into `ComputerSupervisor.enqueueJob` for `linkedin_send` via durable seat/workspace setting (or strip Manual UI until BE-gated). Do not leave localStorage-only “Manually approve.”
2. Delete unused `profileVolume` + fix `services/computer-supervisor/README.md:17`
3. Persist `agent_seats.computer_id` on POST `ensure` (mirror reclaim)
4. Broaden `tests/floor.mts` N-agent suffix regex to match prove script / base36
5. Operator live proof on Fly after tip deploy

## Decisions made (don't relitigate)

- Never invent `sessionHealthy=true`
- Floor green = `ready && sessionHealthy === true` only (with computerHints Map always present on /floor)
- Mutating computer actions require caller seat ownership
- Auto-reclaim: never-bound or same-`priorSeatId` orphans only
- Claude Chrome parity = watch + Take/Esc + permission modes enforced on BE, not localStorage theater

## Watch out

- `shouldPauseForOperator` exists only in `browser-agent-permissions.ts` + its unit test — zero callers in send path
- Real Chromium isolate path is `PROFILE_ROOT/botId`, not `profileVolume`
- FE must keep sending `seatId` or API 400
