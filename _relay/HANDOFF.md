---
project: MSourcing / ARIA
shift: 248
agent: cursor-cloud
updated: 2026-08-28T07:35Z
status: tip-harness-skills-m365-blocked
---

# Handoff — Shift 248

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` (harness + skills)
- **Live Fly:** may lag tip until app redeploy — check `/api/ready`
- **Test gate / audit:** green; **59/59**
- **Fly E2E (PARTIAL):** **46 pass, 0 fail** on prior tip — M365 + quota skips only
- **PR:** [#35](https://github.com/mysticalsin/aria-sourcing/pull/35)

## Done this shift

- **Hermes agent harness:** `src/lib/agents/hermes-agent-harness.ts` composes mission + personality + skill playbook into every loop system prompt
- **Skills upgraded:** default outreach/sourcing/scoring/reply playbooks enforce Mantu brand, ban generic openers/salary/invention, match quality critics
- **Wiring:** Hermes chat, `resolveLoopLlm`, generate-outreach-draft (workspace skills when present), `buildOutreachPrompt` requires Mantu Group in body
- Tests: `hermes-agent-harness.mts`, registry + skills coverage

## Blockers (owner — full objective)

1. **M365 secrets (6 missing)** — see [`M365-OWNER-UNBLOCK.md`](M365-OWNER-UNBLOCK.md)
2. **Strict Fly E2E PASS** — sourcing quota (3c) + M365 Teams book (6b); expect step 3c PASS with provenance=live when quota allows

## Deploy confirm

```bash
bash scripts/print-fly-deploy-confirm.sh
```

## Next steps

1. Redeploy tip to Fly so live drafts use harness/skills
2. Owner: M365 secrets → full E2E without partial flags
3. Loop kill switch (A-1) only after P-1 Docker + full E2E PASS

## Decisions made (don't relitigate)

- **Production = Fly only** — ignore Vercel/GitHub Actions CI
- Hermes = per-agent shell (memory + personality + skills); shared sourcing mission
- Skills are the editable playbooks; harness binds them into agent runtime prompts

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
```
