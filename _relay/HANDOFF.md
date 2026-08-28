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
- **Live Fly:** `fc8b54a` / **0071** · ready ok · **`deploy_status=tip_live`** (pre-this-shift tip; new worker/LLM honesty commits pending deploy)
- **Audit:** **64/64**
- **Gate:** `npx tsc --noEmit && npm test` green
- **M365:** `fly_m365_missing=7` · watcher armed · `/tmp/owner-microsoft.env` absent
- **LLM:** `kimi=auth_dead` (HTTP 401); anthropic/openai/deepseek absent · `/tmp/owner-llm.env` absent
- **Goal:** strict E2E PASS still blocked on M365 secrets + live LLM + Connect Outlook + Graph webhook

## Done this shift

1. Reply classify model client: Kimi → DeepSeek → OpenAI failover (auth-dead continues)
2. Autopilot `pre_call_propose` / `draft_generate` successors only when `classifier === "model"` (keyword INTERESTED no longer invents jobs)
3. Live outreach personalizationEvidence derived from candidate fields (not mockGen copy)
4. `probe-fly-llm-auth.sh` wired into `verify-m365-ready.sh` (step 3c) + `fly-enterprise-activate.sh`
5. Soften hard-pin `AGENT_PROVIDER=kimi` in `print-fly-e2e-env.sh`
6. Split `ARIA_ALLOW_PARTIAL_LLM_E2E` from M365 partial for critics soft-fail; partial runner sets it when auth dead
7. Tests: keyword no-successors + model failover; audit pins updated

## Blockers

- Owner must mint 7 Fly M365 secrets (Entra app + GoTrue Azure) then Connect Outlook + enable Graph webhook
- Owner must rotate LLM key → `bash scripts/probe-fly-llm-auth.sh` → `llm_auth_ok`
- Strict: `env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh` after `verify-m365-ready.sh`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh   # remint if needed, then fly-deploy-now / golive
bash scripts/probe-m365-unblock.sh
# when secrets land:
bash scripts/probe-m365-unblock.sh --apply
bash scripts/fly-apply-owner-llm-secrets.sh
bash scripts/probe-fly-llm-auth.sh          # expect llm_auth_ok
# Settings → Connect Outlook → Enable Graph webhook
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E -u ARIA_ALLOW_PARTIAL_LLM_E2E bash e2e-workflow-test.sh
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
