---
project: MSourcing / ARIA
shift: 386
agent: cursor-cloud
updated: 2026-08-29T15:48Z
status: e2e-partial-awaiting-real-graph-secrets
---

# Handoff — Shift 386

## Current state

- **Enterprise / Fly:** PR **#36** `cursor/enterprise-autopilot-b91d` · live **`1665b39`** / **0074** · Graph owner-blocked (quiet HOLD)
- **Cloudflare:** successor **PR #37** `cursor/cloudflare-agents-settings-b91d` (supersedes closed #34) · tip includes CF feature + migration **0075** · local gate green (`tsc` + `npm test` `# fail 0`)
- **Dropzones:** still empty (`/tmp/owner-azure-app-id`, `/tmp/owner-microsoft.env`, `/tmp/owner-llm.env`)

## Done this shift

1. Ported Cloudflare Workers AI Settings connect onto current tip
2. Renamed migration **0070 → 0075** (avoid collision with `0070_fix_sourcing_loop_stage_enabled`)
3. Opened **PR #37** (could not reopen #34 after branch recreate)
4. Verified `npx tsc --noEmit` + `npm test`

## Blockers

- Entra admin → Register + Owners Add Tony + Grant → dropzone → Connect Outlook → `verify-m365-ready` → **RESULT: PASS** (Microsoft DEFERRED / quiet HOLD)

## Next steps

```bash
# Cloudflare PR
gh pr view 37 --repo mysticalsin/aria-sourcing
# After Microsoft dropzone (HOLD until then):
bash scripts/probe-m365-unblock.sh --apply
bash scripts/verify-m365-ready.sh
unset AGENT_PROVIDER AGENT_MODEL
bash scripts/run-enterprise-e2e-partial.sh
# expect step 3c PASS; RESULT: PARTIAL until live Graph seat
```

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# step 3c should show PASS when running PARTIAL E2E
```

## Decisions made (don't relitigate)

- Production = Fly only; PR #36 for enterprise E2E; Cloudflare ships via **PR #37** (not #34)
- Cloudflare migration is **0075** on current tip
- Microsoft deferred: dropzones only; quiet HOLD

## Watch out

- HANDOFF must keep “expect step 3c PASS” / “step 3c should show” + `print-fly-deploy-confirm`
- Never invent Microsoft secrets
- Do not reopen closed #34; use #37
