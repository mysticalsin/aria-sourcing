---
project: MSourcing / ARIA
shift: 286
agent: cursor-cloud
updated: 2026-08-28T12:45Z
status: owner-wait-m365-agent-work-complete
---

# Handoff — Shift 286

## Current state

- **Live Fly:** `344fcaf` / **0071** · ready ok
- **Branch tip:** `0897cd1`
- **PR #35** (supersedes closed #29–#33)
- **Gate:** audit **62/62** · `npx tsc --noEmit && npm test` green
- **PARTIAL E2E (live):** multilingual LinkedIn/Email/WhatsApp FR drafts **PASS**; intermittent sourcing empty + approve `critics_required` (503) — env not code regression
- **Strict E2E:** still blocked on M365 (microsoftOAuth + 6b)
- **M365:** `probe-m365-unblock.sh` → **owner-blocked** (7 Fly secrets)

## Done this shift

1. **`resolveOutreachLanguage`** — candidate `languages[]` beats need `localeContext` / seat / default; wired into cron draft + store outreach paths
2. **E2E multilingual outreach** — Fly defaults `E2E_OUTREACH_LANGUAGE=fr`; asserts language on LinkedIn, Email, WhatsApp; step **5b** WhatsApp dry-run; French intake JD (English Role/Skills labels for parse)
3. **`scripts/assert-outreach-language.mts`** + `tests/outreach-language.mts`; audit **62/62**

## Blockers (owner only)

Entra app + 7 Fly secrets — `_relay/M365-OWNER-UNBLOCK.md`.

## Next steps (owner)

```bash
bash scripts/print-fly-golive-status.sh
bash scripts/print-fly-deploy-confirm.sh
bash scripts/print-m365-owner-portal-checklist.sh
bash scripts/probe-m365-unblock.sh --apply
bash scripts/verify-m365-ready.sh
env -u ARIA_ALLOW_PARTIAL_M365_E2E bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
```

## Decisions made (don't relitigate)

- Production = Fly only; ignore Vercel/GHA CI
- Never claim full enterprise PASS while 6b skipped or partial flag set
- Outreach language priority: **candidate languages → need locale → need language → seat → default**
- E2E Fly default outreach language = **fr** (Mantu EU); override with `E2E_OUTREACH_LANGUAGE`

## Production gate (Fly)

```bash
bash scripts/print-fly-golive-status.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
ARIA_ALLOW_PARTIAL_M365_E2E=1 bash e2e-workflow-test.sh
# step 3c should show PASS; MS-gap PARTIAL only when FAILS=0
bash scripts/verify-m365-ready.sh
bash scripts/print-fly-deploy-confirm.sh
```

