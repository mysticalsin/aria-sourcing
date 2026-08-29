---
project: MSourcing / ARIA
shift: 361
agent: cursor-cloud
updated: 2026-08-29T11:53Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 361

## Current state

- **Branch / PR:** `cursor/enterprise-autopilot-b91d` · **PR #36** draft OPEN
- **Live Fly:** **`f532707`** / **0074** · tip_live · loop primary **2863e10bd41e28**
- **Gate/audit:** green · audit **65/65**
- **PARTIAL E2E:** **58/0/2** on `f532707` — step 3c PASS · classifier=model · **no approve retries** (disclosure/signature harden)
- **Graph:** `graph_secrets_missing=3` · probe `owner-blocked` · Entra create still **Insufficient privileges**; zero aria-mantu redirect apps

## Done this shift

1. Confirmed az cannot create Graph app; no owner dropzone
2. Strip `compensationNorms` from candidate-bound `buildOutreachPrompt` (was steering disclosure-comp-blocked)
3. Default signature → `Aria · Mantu Group` (critics flagged Talent Team blast)
4. Deploy tip_live `f532707`; PARTIAL clean approve path

## Blockers

- Owner must create Entra app + REAL CLIENT_ID/SECRET/TENANT in `/tmp/owner-microsoft.env`
- Then apply → Connect Outlook → `verify-m365-ready` for RESULT: PASS

## Next steps

```bash
bash scripts/print-fly-golive-status.sh
# expect tip_live f532707; graph_secrets_missing=3
# Owner: Azure Portal create app (checklist) → REAL secrets → /tmp/owner-microsoft.env
#   bash scripts/probe-m365-unblock.sh --apply
#   Settings → Connect Outlook → webhook + Calendars + OnlineMeetings
#   bash scripts/verify-m365-ready.sh   # RESULT: PASS
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS; classifier=model PASS; no disclosure-comp approve retries
# expect RESULT: PARTIAL until real Graph + live seat
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
# Do NOT run verify-m365-ready until real Graph secrets + Connect Outlook.
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA empty-steps
- PR #36 only
- Graph-minimum apply; Entra/LLM WARN-only
- **Monotonous demo UUIDs (11111111-…) are PLACEHOLDER**
- Deploy confirm remint is agent-owned (KEY=value only)
- Do not inject compensationNorms into candidate-bound outreach prompts
- Prefer personal Aria · Mantu Group signature over Talent Team

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- `/tmp/owner-deploy-confirm.env` must be KEY=value only (two lines)
- Never print Microsoft secret values
- After remint deploy, confirm loop primary started
