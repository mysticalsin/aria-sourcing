---
project: MSourcing / ARIA
shift: 218
agent: cursor-cloud
updated: 2026-08-28T02:30Z
status: gate-green-live-e2e-deploy-lag-awaiting-owner-remint
---

# Handoff — Shift 218

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` **`c64f89a`** (manifest baseline + E2E pre_call_propose grep fix)
- **Live Fly:** still **`e469126`** (migration **0068**) — **~50+ commits behind tip**
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` pins **`e469126`** — **NO MATCH** for `c64f89a`; do not invent
- **Test gate:** `npx tsc --noEmit && npm test` green on tip (manifest contract fixed: 180 app / 233 all)
- **Audit matrix:** **54/54** local
- **Live E2E:** `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1 ARIA_ALLOW_STALE_FLY_E2E=1 bash e2e-workflow-test.sh` → **PARTIAL** (35 pass, 0 fail, 3 warn)
- **Microsoft SKIPPED** — goal stays **IN_PROGRESS**
- **PR:** [#33](https://github.com/mysticalsin/aria-sourcing/pull/33) open (draft); **PR #32 closed** (supersedes #29–#31)

## Done this shift

1. **Manifest contract baseline** — bumped frozen counts/digests for +2 application suites (`sourcing-agent-contract` et al.)
2. **E2E fixes** — URLED jq treated empty `githubUrl` as present (blocked linkedinUrl); stale-Fly provenance tolerance under `ARIA_ALLOW_STALE_FLY_E2E=1`; interest chain grep uses `pre_call_propose`
3. Verified local gate green; live E2E: **PARTIAL 0 fail** with stale-Fly flag (provenance stamp pending deploy a75bc57+)

## Blockers

- Owner deploy confirm for **`c64f89a`** (or newer) before Fly golive
- Live sourcing step **3** fails until tip deploy (authority fingerprint fix + localeContext on live)
- Microsoft skipped — full Teams/Outlook live book cannot complete
- H4/H5 dedicated Hermes runtime + upstream pin needs owner sign-off

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` → `bash scripts/fly-enterprise-golive-when-ready.sh`
2. After deploy: `/api/ready` build = tip; re-run live E2E → expect **PARTIAL** (MS gap only, `FAILS=0` on non-MS steps)
3. Retry sourcing on live after deploy — "Campaign authority changed" fix should hold
4. Owner H4 sign-off for dedicated Hermes runtime when ready

## Decisions made (don't relitigate)

- **Fly = production.** No Vercel deploys, debugging, or CI authority for live behavior
- Skip Microsoft; no Approve/send in autonomous E2E
- Never invent deploy confirm
- Positive interest chain: **pre_call_propose → first_interview_book** (dry-run calendar); `calendar_book` retained as legacy alias
- Dedicated Hermes install recommended over shared Mina fork until H4 complete
- Autonomous drafts: Needs Approval + dryRun always

## Watch out

- `graphStage` never on enqueue payloads
- Hermes session keys cap at 256 chars; profile prefix `ws-{workspaceUuid}`
- Live E2E step **3** (provenance gate): stale Fly `e469126` returns `live=0` (pre-a75bc57 omits provenance stamp); **expect step 3c PASS** after tip deploy with `live=n`
- E2E grep for interest chain must reference `pre_call_propose`, not legacy `calendar_book` enqueue strings
