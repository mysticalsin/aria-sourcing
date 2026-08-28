---
project: MSourcing / ARIA
shift: 293
agent: cursor-cloud
updated: 2026-08-28T18:40Z
status: post-m365-loop-hardening
---

# Handoff — Shift 293

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft (HOLD — do not open another)
- **Live Fly:** `fc8b54a` / **0071** · ready ok · tip `9f0ce1f+` pending remint (`deploy_status=stale_owner_remint_required`)
- **Audit:** **64/64** (target after this commit)
- **Gate:** `npx tsc --noEmit && npm test` green
- **M365:** `fly_m365_missing=7` · watcher armed · `/tmp/owner-microsoft.env` absent
- **LLM:** `kimi=auth_dead` (HTTP 401); anthropic/openai/deepseek absent · `/tmp/owner-llm.env` absent
- **Goal:** strict E2E PASS still blocked on M365 secrets + live LLM + Connect Outlook + Graph webhook

## Done this shift

1. Reply classify model client: Kimi → Anthropic → DeepSeek → OpenAI failover (auth-dead continues)
2. Autopilot `pre_call_propose` / `draft_generate` successors only when `classifier === "model"` (keyword INTERESTED no longer invents jobs)
3. Live outreach personalizationEvidence derived from candidate fields (not mockGen copy)
4. `probe-fly-llm-auth.sh` wired into `verify-m365-ready.sh` (step 3c) + `fly-enterprise-activate.sh`
5. Soften hard-pin `AGENT_PROVIDER=kimi` in `print-fly-e2e-env.sh` + e2e-workflow-test.sh
6. Split `ARIA_ALLOW_PARTIAL_LLM_E2E` / `E2E_LLM_GAP` from M365 partial — critics soft-fail forces PARTIAL (never PASS)
7. Live tenants refuse keyword `draftReplyResponse` + sourcing-agent mock drafts; Quality badge success only when `qualityCriticsUsed`
8. Tests: keyword no-successors + model/Anthropic failover; audit pins updated

## Blockers

- Owner must mint 7 Fly M365 secrets (Entra app + GoTrue Azure) then Connect Outlook + enable Graph webhook
- Owner must rotate LLM key → `bash scripts/probe-fly-llm-auth.sh` → `llm_auth_ok`
- Strict: `env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh` after `verify-m365-ready.sh`

## Next steps

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live after remint
bash scripts/print-fly-deploy-confirm.sh   # remint if needed, then fly-deploy-now / golive
bash scripts/probe-m365-unblock.sh
# when secrets land:
bash scripts/probe-m365-unblock.sh --apply
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh          # expect llm_auth_ok
# Settings → Connect Outlook → Enable Graph webhook
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
# expect step 3c PASS with provenance=live when quota allows; strict RESULT: PASS
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh   # deploy_status=tip_live
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E; provenance / live=0 is quota
ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_PARTIAL_LLM_E2E=1 bash e2e-workflow-test.sh
```
## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA
- Tony HOLD: keep #36 only; no parallel PR
- No candidate phone calling (Omogen Mio excluded)
- Manual mailbox labels ≠ Graph OAuth; Live send needs mode=live
- Goal stays active until **strict** E2E PASS on live Fly
- Keyword INTERESTED may stage Interested; must not invent pre_call/draft successors without model classifier

## Watch out

- Do not spam relay-only HANDOFF commits
- Quality warn does not block demo approve; live `/api/outreach/approve` still enforces `critics_required`
- PARTIAL M365 alone no longer soft-passes critics — needs `ARIA_ALLOW_PARTIAL_LLM_E2E=1`
- GHA CI fails instantly with 0 steps — ignore
