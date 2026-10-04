---
project: MSourcing / ARIA
shift: 345
agent: cursor-cloud
updated: 2026-10-03T23:57Z
status: tip-residuals-open-after-tz-fixes
---

# Handoff — Shift 345

## Current state

- **Branch tip:** `3df0f5b` on `cursor/fly-deploy-land-n-agent-b91d` (sendWindow TZ + endHour=24 fixes)
- Adversarial residual hunt **after** those fixes: **OPEN residuals** (not NONE)
- Prior shift-344 NONE verdict is superseded — hunt found durable LI claim + pacing gaps
- `gate.ts` `inQuietHours`/`nextSendTime` (`getHours`) are **dead code** — not on LI Browser Computer send path (omit)
- Floor/PacketFX/pulse/go-live all-N / fail-closed sessionHealthy: reconfirmed closed

## Done this shift

1. Adversarial hunt focus: gate quiet hours, SESSION_HEALTH_TTL clocks, Floor/PacketFX, nextEligibleAt, getHours/getDay on LI path
2. Wrote open findings to `_relay/codex-findings.md` (claim BC exclusion, dispatch seat counter/window, nextEligibleAt, future probedAt, queued commit, UTC day cap)
3. Archived shift 344 → `_relay/archive/2026-10-03-2357-cursor-cloud.md`

## Blockers

1. Open tip residuals must be fixed before N-agent LI durable send is honest
2. Owner approve #150 / Fly dispatch still blocked (unchanged from shift 344)

## Next steps

1. Triage/fix open findings — priority: `claim_linkedin_outbound_queued` allowlist for `LinkedIn Browser Computer`
2. Wire dispatch seat pacing from durable ledger / persisted send_window (not `sentToday=0` + `defaultSendWindow()`)
3. Fix nextEligibleAt boundary + future `sessionProbedAt` expire/restore
4. Re-run adversarial hunt → expect `TIP_RESIDUALS: NONE` only after claim+pacing closed
5. Then owner approve #150 / Fly proof (do not UpdateGoal complete until tip+0087+LI desks)

## Decisions made (don't relitigate)

- Probe remoteUrl + sessionProbedAt rotate; durable adopt; hermes local-only
- Never invent sessionHealthy=true; ignore Vercel-only when Quality/Release pass
- All-N for go-live/strip/setup/stack/agents; send remains per-seat fail-closed
- `gate.ts` quiet hours unused on LI path — do not treat as send-path residual unless wired
- isWithinSendWindow timezone via Intl + ianaForAbbrev; endHour exclusive / 24 all-day

## Watch out

- openbot e2e calls `enqueueJob` directly and **misses** claim_linkedin BC exclusion
- Do not re-clear Floor/PacketFX invent-healthy (closed)
- No agent review/approve / FLY_API_TOKEN / workflow_dispatch
