---
project: MSourcing / ARIA
shift: 347
agent: cursor-cloud
updated: 2026-10-04T03:25Z
status: tip-take-mutex-harden-awaiting-ci-approve
---

# Handoff — Shift 347

## Current state

- **Branch tip:** pending commit on `cursor/fly-deploy-land-n-agent-b91d` (Take mutex + soft-defer FE)
- Prior tip `caad920` had CI green; #150 still `REVIEW_REQUIRED`
- Fly prod still `21a42e7` / migration `0084`
- Four tip residuals from post-caad920 hunt **fixed this shift**

## Done this shift

1. `restoreSessionHealthFromDurableAudits` hydrates open Take → `control=human`; refuses re-green from pre-Take probe
2. OpenBot remote human-mutex → job `refused` / deliver `not-sent` (no outbox burn as `unknown`)
3. openbot `/navigate` + `/session-probe` 409 when `control===human`
4. `classifySendOutcome`: computer_starting / manual / deferred → wait/refused (not "Send failed")
5. Tests: computer-supervisor Take restore, send-outcome suite, channel/perms contracts, manifest freeze

## Blockers

1. Owner Approve #150 → squash → Deploy Aria Mantu → fly-n-agent-proof → LI Take→login→Release
2. Never invent sessionHealthy; do not UpdateGoal complete until tip SHA + ≥0087/0089/0090 + LI healthy

## Next steps

1. Wait tip CI green on this commit
2. Reconfirm TIP_RESIDUALS NONE
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
- Open durable Take blocks cold restore green; `/navigate` shares human mutex with click/type

## Watch out

- openbot e2e enqueueJob bypasses claim (test-only)
- Fingerprint pin required after every claim function replace migration
- No agent review/approve / FLY_API_TOKEN / workflow_dispatch
- click-xy/type-text/key/scroll stay allowed during Take (operator input path)
