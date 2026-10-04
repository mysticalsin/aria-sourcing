---
project: MSourcing / ARIA
shift: 346
agent: cursor-cloud
updated: 2026-10-04T00:45Z
status: tip-europe-day-hermes-fleet-awaiting-fingerprint-ci
---

# Handoff — Shift 346

## Current state

- **Branch tip:** pending commit on `cursor/fly-deploy-land-n-agent-b91d` (0089 Europe day + Hermes fleet/sendWindow on dispatch)
- Prior tip `117a57f` had CI green; #150 still `REVIEW_REQUIRED`
- Fly prod still `21a42e7` / migration `0084`
- Open tip residuals from shift 345 (claim BC, pacing hydrate, nextEligibleAt, future probedAt) **fixed** at 223c211; UTC day + Hermes fleet/window **fixed this shift**

## Done this shift

1. Migration `0089_claim_linkedin_daily_cap_europe.sql` — claim used_today via Europe/Berlin
2. `startOfDayInTimeZone` + dispatch hydrate uses seat/Hermes TZ (not UTC)
3. Dispatch loads Hermes `settings.fleet` + seat `sendWindow` for BC deliver (Manual/BH honest)
4. Tests: send-pacing + linkedin-channel-contract updated; tsc clean
5. Marked codex findings fixed/wontfix for queued Hermes bump

## Blockers

1. Database security fingerprint for 0089 — no local Docker; pin sha after CI reports actual=
2. Owner Approve #150 → squash → Deploy Aria Mantu → fly-n-agent-proof → LI Take→login→Release
3. Never invent sessionHealthy; do not UpdateGoal complete until tip SHA + ≥0087 + LI healthy

## Next steps

1. After CI Database security fails: pin `docker/bootstrap/legacy-baseline-public-schema.sha256` to actual=
2. Reconfirm TIP_RESIDUALS NONE on tip
3. Owner Approve #150; wait deploy HEAD CI; owner workflow_dispatch Deploy
4. `bash scripts/fly-n-agent-proof.sh` then manual LI desk health

## Decisions made (don't relitigate)

- Probe remoteUrl + sessionProbedAt rotate; durable adopt; hermes local-only
- Never invent sessionHealthy=true; ignore Vercel-only when Quality/Release pass
- All-N for go-live/strip/setup/stack/agents; send remains per-seat fail-closed
- `gate.ts` quiet hours unused on LI path
- isWithinSendWindow timezone via Intl + ianaForAbbrev; endHour exclusive / 24 all-day
- Claim durable daily cap = Europe/Berlin until send_window column exists
- Hermes queued path does not bump sentToday (durable ledger is authority)

## Watch out

- openbot e2e enqueueJob bypasses claim (test-only)
- Fingerprint pin required after every claim function replace migration
- No agent review/approve / FLY_API_TOKEN / workflow_dispatch
