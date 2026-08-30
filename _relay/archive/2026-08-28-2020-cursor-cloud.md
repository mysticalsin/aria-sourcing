---
project: MSourcing / ARIA
shift: 296
agent: cursor-cloud
updated: 2026-08-28T20:10Z
status: post-kpi-provenance-honesty
---

# Handoff — Shift 296

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (HOLD — do not open another)
- **Live Fly:** `fc8b54a` / **0071** · ready ok · tip pending remint (`deploy_status=stale_owner_remint_required`)
- **Audit:** **64/64**
- **Gate:** `npx tsc --noEmit && npm test` green
- **M365:** `fly_m365_missing=7` · watcher armed · `/tmp/owner-microsoft.env` absent
- **LLM:** `kimi=auth_dead` (HTTP 401) · `/tmp/owner-llm.env` absent
- **Deploy confirm:** stale vs tip
- **Goal:** strict E2E PASS still blocked on M365 secrets + live LLM + Connect Outlook + Graph webhook
- **Owner setup actions:** requested (7 M365 secrets, LLM key, remint deploy confirm)

## Done this shift

1. Floor3d / packet ticker: “Interview slot” (never “Interview booked” from AgentEvent alone)
2. Replay uses `bookingInterviewTitle`; Aria Live KPI/chapter gated on meeting URL
3. Funnel `booked` KPI requires `teamsLink`/`calLink`
4. Chatbox applicant handoff stamps `provenance: "manual"` (not live)
5. `testConnection` mock mode fails closed (no ready/lastSync)
6. Slack/Telegram prefs: honest toast + seed slack default false
7. Prior: mock integration defaults + stale-Fly PARTIAL (`cdc1c9f`)

## Blockers

- Owner: mint 7 Fly M365 secrets + rotate LLM + remint deploy confirm for tip
- Then Connect Outlook → Graph webhook → `verify-m365-ready.sh` → strict E2E

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/probe-m365-unblock.sh
# when secrets land:
bash scripts/probe-m365-unblock.sh --apply
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/fly-enterprise-golive-when-ready.sh
# Settings → Connect Outlook → Enable Graph webhook
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live when quota allows; strict RESULT: PASS
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA
- Tony HOLD: keep #36 only
- Goal active until **strict** E2E PASS on live Fly
- Interview booked / booked KPI requires meeting URL
- LinkedIn assisted-manual; Live send needs mailbox mode=live

## Watch out

- Do not spam relay-only HANDOFF commits
- Stage may still become Booked for local slots — KPI/copy must stay honest
- GHA empty-steps + Vercel rate limit — ignore
