---
project: MSourcing / ARIA
shift: 346
agent: cursor-cloud
updated: 2026-10-04T00:41Z
status: tip-residuals-open-after-0088
---

# Handoff — Shift 346

## Current state

- **Branch tip:** `117a57f` on `cursor/fly-deploy-land-n-agent-b91d` (0088 claim BC + ledger hydrate + future-probe + 5-min nextEligibleAt landed in `223c211`)
- Adversarial tip residual hunt **after** those fixes: **OPEN** (not NONE)
- Already-fixed items verified not regressed: claim BC allowlist, ledger hydrate lastSendAt/sentToday, isWithinSendWindow Intl TZ, nextEligibleAt 5-min, future sessionProbedAt reject
- Floor/go-live all-N / sessionHealthy invent / production openbot claim bypass: **closed** (no tip residual)
- `gate.ts` quiet hours still dead on LI path — omit

## Done this shift

1. Tip residual hunt at `117a57f` focused on UTC daily cap, Hermes↔durable pacing, Manual fleetSettings, floor/go-live/openbot
2. Marked shift-345 findings fixed where tip commits closed them; left/reopened real residuals in `_relay/codex-findings.md`
3. Archived shift 345 → `_relay/archive/2026-10-04-0041-cursor-cloud.md`

## Blockers

1. Open tip residuals must be fixed before N-agent LI durable send is honest (UTC day cap + Hermes window/fleetSettings + queued counter drift)
2. Owner approve #150 / Fly dispatch still blocked (unchanged)

## Next steps

1. Persist seat `send_window` (or load Hermes seat snapshot in dispatch) — stop `defaultSendWindow()` on BC deliver
2. Count claim + dispatch hydrate daily cap in seat TZ (not `at::date = now()::date` / `setUTCHours`)
3. Pass Hermes `settings.fleet` into `adapter.deliver` (Manual/Skip + enforceBusinessHours/jitter)
4. On LI `queued` Hermes commit, bump `lastSendAt`/`sentToday` (or stop Hermes-pacing counters and rely on ledger only)
5. Re-run adversarial hunt → expect `TIP_RESIDUALS: NONE` only after 1–4 closed
6. Then owner approve #150 / Fly proof

## Decisions made (don't relitigate)

- Probe remoteUrl + sessionProbedAt rotate; durable adopt; hermes local-only
- Never invent sessionHealthy=true; ignore Vercel-only when Quality/Release pass
- All-N for go-live/strip/setup/stack/agents; send remains per-seat fail-closed
- `gate.ts` quiet hours unused on LI path — do not treat as send-path residual unless wired
- isWithinSendWindow timezone via Intl + ianaForAbbrev; endHour exclusive / 24 all-day
- claim allowlists LinkedIn Browser Computer (0088); openbot e2e direct enqueueJob is test-only

## Watch out

- Dispatch `defaultFleetSettings()` makes Manual mode theater on durable deliver
- claim still UTC day — CET midnight double-count / early-cap
- No agent review/approve / FLY_API_TOKEN / workflow_dispatch
