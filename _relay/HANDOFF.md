---
project: MSourcing / ARIA
shift: 354
agent: cursor-cloud
updated: 2026-08-29T10:10Z
status: tip-ahead-app-github-activity-sanitize-awaiting-deploy
---

# Handoff — Shift 354

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** `e5c37c1` / **0074** · tip will be **tip_ahead_app** after this commit (src outreach sanitize)
- **Gate/audit:** green · audit **65/65**
- **E2E prior:** PARTIAL **60/0/3** — critic WARN was GitHub-activity boilerplate
- **Microsoft:** **DEFERRED** · `graph_secrets_missing=3` · no `/tmp/owner-microsoft.env`
- **LLM:** `llm_auth=dead` · Hermes/vault OK

## Done this shift

1. Fixed draft activity signal that fed `"Active GitHub profile…"` → live critics reject `"Votre activité GitHub récente"` (approve retry WARN)
2. `sanitizeOutreachActivitySignal` strips FR/EN GitHub-activity boilerplate
3. Hermes outreach rules + skills ban the same boilerplate
4. `candidate-mappers` prefers stack language / `"recent open-source work"`

## Blockers

- Owner Microsoft for RESULT: PASS
- Remint + `fly-deploy-now` so tip_ahead_app lands on Fly, then re-run PARTIAL E2E (expect fewer critic retries)

## Next steps

```bash
# After commit on tip:
bash scripts/print-fly-deploy-confirm.sh
# write KEY=value only to /tmp/owner-deploy-confirm.env (two lines — never redirect print output)
bash scripts/fly-deploy-now.sh
# confirm loop primary started
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect Running: ARIA_ALLOW_PARTIAL_M365_E2E=1 only
# expect step 3c PASS with provenance=live top-10
# expect Generated a LinkedIn draft via /api/hermes/chat (fr)
# expect Human approval RECORDED + live LLM critics (prefer first-try, no GitHub-activity critic WARN)
# expect classifier=model PASS
# expect RESULT: PARTIAL until Microsoft reopened
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
- PR #36 only
- **2026-08-29: Owner — don’t do the Microsoft part**
- Deploy confirm remint is agent-owned (KEY=value only)
- Never pin auth-dead cloud AGENT_PROVIDER on Fly E2E
- Graph-minimum dropzone; Entra/LLM WARN-only
- Ban GitHub-activity boilerplate in activity signals + Hermes rules (scraping-disclosure critic tell)

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Do not edit `e2e-workflow-test.sh` while a live E2E bash process is running
- After `fly deploy`, confirm loop/cleanup/heartbeat primaries are started (not standbys)
- Empathy critics reject employer-name-only openers and GitHub-activity boilerplate
