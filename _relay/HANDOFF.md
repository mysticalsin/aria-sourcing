---
project: MSourcing / ARIA
shift: 367
agent: cursor-cloud
updated: 2026-10-04T06:46Z
status: tip-residuals-open-awaiting-fix
---

# Handoff — Shift 367

## Current state

- **Branch tip audit:** `d50fbb8` / relay `2f82edc`; findings branch `cursor/n-agent-tip-residuals-4f9c`
- Prior 7 fixed items (Release dual-send, start TOCTOU, adopt seatHeld, probe mid-Take, restore merge, stop/reset+invalidate, release stamp+busy Floor+audit mem) hold — not re-opened
- 3 new open tip residuals in `_relay/codex-findings.md` (busy stuck, probe mid-busy, restore limit 200)

## Done this shift

1. Deep hunt Take/Release/probe/send paths (supervisor, linkedin-channel, fleet route, boot, dispatch, send, audit, FE)
2. Logged 3 open correctness residuals; no code fix (audit-only)

## Blockers

1. Owner Approve #150 still blocks deploy proof
2. Open residuals should fix before claiming tip clean

## Next steps

1. Fix runJob humanMutex / releaseControl busy clear
2. Guard session_probe + reclaim while status===busy
3. Fix restoreSessionHealth probe queries (per-computer newest, not workspace limit 200)
4. Retest: tsc + computer-supervisor + linkedin-channel-contract
5. Tip CI → Approve → Deploy → LI Take→login→Release

## Decisions made (don't relitigate)

- Invalidate stamps probedAt so durable restore cannot re-green from older probe
- Floor refresh never probes busy desks (automatic path only — POST probe still open)
- Durable audit reads merge memory when PG is configured
- preActNotSent intentionally omits snapshot abort (proof-phase nested msg; postActAmbiguous-first)

## Watch out

- Fingerprint pin; no agent Approve / FLY_API_TOKEN / workflow_dispatch
- Do not re-report the 7 already-fixed items listed in hunt prompt
