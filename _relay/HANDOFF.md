---
project: MSourcing / ARIA
shift: 391
agent: cursor-cloud
updated: 2026-08-29T19:40Z
status: rei-autopilot-send-awaiting-fly-0076-heyreach
---

# Handoff — Shift 391

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39** tip `c4736fc`
- **Live Fly:** `aria-mantu-app.fly.dev` build `1665b39`, migration **0074** — REI code + **0076 not deployed**
- **Dropzones:** `/tmp/owner-azure-app-id`, `/tmp/owner-microsoft.env`, `/tmp/owner-llm.env` **absent** → Graph path = **HOLD**
- **Fly secrets:** has `CRON_SECRET`, KIMI, DATA_ENCRYPTION_KEY, ARIA_LOOP_KILL_SWITCH, etc. **No** `HEYREACH_API_KEY` / `HEYREACH_CAMPAIGN_ID`
- **PARTIAL E2E** (2026-08-29T19:38Z): `RESULT: PARTIAL` — 58 pass, 0 fail, 2 warnings (no Graph seat). LinkedIn send still **409 manual** on live tip (expected: no HeyReach secrets + old build)

## Done this shift

1. Finished `tests/heyreach-delivery.mts` (17 pass: env gates, V2 success, V1 fallback, dual-fail, accountId)
2. Registered `heyreach-delivery` in `tests/test-manifest.mjs`
3. `npx tsc --noEmit` + rei-autopilot-send / linkedin-policy green
4. Pushed `c4736fc`; updated PR #39
5. Ran `bash scripts/run-enterprise-e2e-partial.sh` → PARTIAL (Graph HOLD)

## Blockers

1. Apply migration **0076** + deploy PR tip (needs `ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:$SHA:aria-mantu-bootstrap,aria-mantu-app`)
2. Owner: `flyctl secrets set -a aria-mantu-app HEYREACH_API_KEY=… HEYREACH_CAMPAIGN_ID=…` (+ optional `HEYREACH_ACCOUNT_ID`)
3. Entitle `profiles.autopilot_enabled` + arm Sequences; connect HeyReach MCP (live fleet seat)
4. Microsoft Graph dropzones empty — strict RESULT: PASS / confirmLive Teams still HOLD

## Next steps

```bash
# when deploy confirm + HeyReach secrets available:
ARIA_PROD_DEPLOY_CONFIRM=aria-production-release-v1:fly-deploy-now:$SHA:aria-mantu-bootstrap,aria-mantu-app \
  bash scripts/fly-deploy-now.sh
flyctl secrets set -a aria-mantu-app HEYREACH_API_KEY=… HEYREACH_CAMPAIGN_ID=…
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
bash scripts/run-enterprise-e2e-partial.sh
# Graph: only when /tmp/owner-* dropzones appear — never invent secrets
```

## Decisions made (don't relitigate)

- Autopilot OFF → human Approve → Send; LinkedIn Pending Manual unless live HeyReach/vendor seat
- Autopilot ON → critics green → mint `autopilot_critics` → durable Email/WA/LinkedIn queue; fail-closed if seats/secrets missing
- No LinkedIn scrape/session bots — official HeyReach/vendor only
- Production = Fly only; ignore GHA empty-step budget phantoms
- Prefer apply/deploy via PR #36 lineage when M365/LLM dropzones appear for Graph E2E

## Watch out

- This branch has **0076** without Cloudflare **0075** — OK if Cloudflare merges later as independent schema
- `claim_email_outbound` / LinkedIn claim use `outbound_approval_authorizes_send` (human|autopilot_critics|template_bound)
- Canvas: `~/.cursor/projects/workspace/canvases/rei-autopilot-pipeline.canvas.tsx`
- Enterprise PR **#36** stays open for Graph; Cloudflare **#37**; role-learning **#38**
