---
project: MSourcing / ARIA
shift: 299
agent: cursor-cloud
updated: 2026-08-28T20:35Z
status: post-fleet-calendar-provenance-honesty
---

# Handoff — Shift 299

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft · tip **`b014326`**
- **Live Fly:** `fc8b54a` / **0071** · tip pending remint (`confirm_stale_for_tip=yes`)
- **Audit:** **64/64** · **Gate:** green (`npx tsc --noEmit && npm test`)
- **M365:** `fly_m365_missing=7` · `/tmp/owner-microsoft.env` absent · watcher armed
- **LLM:** `kimi=auth_dead` · `/tmp/owner-llm.env` absent
- **Goal:** strict E2E PASS blocked on owner secrets

## Done this shift

1. Fleet: `seatMailboxLiveReady` / `seatNeedsDomainVerify` — Graph OAuth skips vanity DNS; health strip uses helpers
2. Calendar: preview-only Copy when live calendar booked; banner when prep queue fails
3. Candidates: **Unknown provenance** badge on live tenants when `!provenance`
4. Outreach: quality badge warning **awaiting approve** on Needs Approval + multi-agent ready
5. Test fix: outreach-channel domain verify copy alignment

## Blockers

Owner: 7 M365 + LLM + remint deploy confirm → Connect Outlook → Graph webhook → strict E2E

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/probe-m365-unblock.sh --apply   # when /tmp/owner-microsoft.env lands
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/fly-enterprise-golive-when-ready.sh
# Settings → Connect Outlook → Enable Graph webhook
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
# expect RESULT: PASS
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA
- PR #36 only; goal until strict Fly PASS
- LinkedIn assisted-manual (409); booked KPI requires teamsLink/calLink

## Watch out

- GHA/Vercel CI — ignore
- Live Fly still on `fc8b54a`; honesty fixes ship in tip only until remint
