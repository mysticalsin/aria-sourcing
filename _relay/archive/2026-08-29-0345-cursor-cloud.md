---
project: MSourcing / ARIA
shift: 333
agent: cursor-cloud
updated: 2026-08-29T03:30Z
status: tip-live-sourcing-top10-partial
---

# Handoff — Shift 333

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft
- **Live Fly:** `9f143d1` / **0073** · `deploy_status=tip_live` · ready ok
- **Gate:** green (`npx tsc --noEmit && npm test`)
- **PARTIAL E2E:** **RESULT: PARTIAL** · **42 pass / 0 fail** · step **3c PASS** (top-10 shortlist, all `provenance=live`)
- **Microsoft:** **DEFERRED** (`m365_secrets_missing=7`) · **LLM:** `llm_auth=dead` (no `/tmp/owner-llm.env`)

## Done this shift

1. Root-caused sourcing-agent `n=0`: fake `language:PostgreSQL|GraphQL` queries + GitHub empty-title profiles scored ~30–74 under the 80% floor (not quota)
2. Shipped `src/lib/sourcing/github-query-language.ts` — real language map, sanitize stored queries, strategy/regenerate/orchestrator/policy wired
3. GitHub skills scoring boost + `public repos` activity signal so language-matched profiles clear floor
4. E2E: stop calling empty results “quota”; PARTIAL runner adds `ARIA_ALLOW_CANNED_DRAFT_E2E=1` when LLM auth dead
5. Deployed tip `9f143d1`; verified step 3c top-10 live shortlist on Fly

## Blockers

- Owner remint `/tmp/owner-llm.env` for live critics + real Hermes/cloud drafts (drop canned)
- Owner reopen Microsoft for Teams/Outlook book

## Next steps

```bash
# Microsoft path OFF unless owner re-enables.
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/print-fly-golive-status.sh   # expect tip_live + build 9f143d1
bash scripts/print-fly-deploy-confirm.sh   # remint when tip_ahead_app
ls /tmp/owner-llm.env || true
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS with provenance=live top-10 (not quota)
# expect RESULT: PARTIAL until owner LLM + Microsoft
# expect Agent provider: hermes when llm_auth=dead (not kimi)
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready / strict M365 E2E while Microsoft is deferred.
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only (supersedes #29)
- **2026-08-29: Owner — don’t do the Microsoft part**
- Deploy confirm remint is agent-owned (non-secret)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E — use live probe or hermes
- Workspace critics share Hermes-first stack; Hermes upstream still needs live key
- GitHub `language:` must be a real GH language; non-langs are keywords under primary language

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show”
- Do not re-arm `m365-secrets-reprobe` unless owner asks
- Shell may export stale AGENT_PROVIDER=kimi — E2E must clear it
- Bootstrap machine start can timeout on remint deploy when migration already at tip — app ready.build is source of truth
