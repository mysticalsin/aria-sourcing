---
project: MSourcing / ARIA
shift: 195
agent: cursor-cloud
updated: 2026-08-27T21:05Z
status: vss-intake-parse-shipped-tip-lags
---

# Handoff — Shift 195

## Current state

- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- **PR #32** tips: … → **`c93f4c5`** (VSS intake extract) → `e6fbd43` / **`6adfb03` HEAD** (Microsoft path deferred per owner)
- Live Fly tip still **`635eb4e`** (`/api/ready` build=`635eb4e…`, ready) — tip lags HEAD; no redeploy (no matching owner confirm for HEAD)
- **VSS Recruitment Need parse shipped** (`src/lib/mantu-need-parse.ts`): plain-text + HTML-stripped paste extracts full structured fields into `JobAnalysis` + `ParsedIntake.mantuNeed`
- Gate green: `npx tsc --noEmit && npm test`; `tests/mantu-intake.mts` 90/90; audit matrix **45/45**
- Microsoft path remains **STOPPED** (owner: skip Microsoft) — do not resume Graph/Outlook/live Teams E2E

## Done this shift

- Extended Mantu need parser for VSS sections (Summary / Purpose / Project / Candidate / Search Support)
- Mapped Title/Type/Category/Priority/Reason/Status, managers/recruiters, company/client/city, contract/start/headcount/remote, skills/languages/experience, mission body, Target School / Ideal profile Id / LinkedIn / Boolean
- Fixtures: `SAMPLE_VSS_CALYPSO_APP_SUPPORT`, `SAMPLE_VSS_CALYPSO_BA`; HTML paste coverage
- API `/api/intake` `suggestedMeta` + live prompt include VSS fields; `linkedinBoolean`/`missionDescription` on JobAnalysis
- Documented PDF/image OCR follow-up in `mantu-need-parse.ts` footer (text path is production baseline)
- Commit **`c93f4c5`** pushed on `cursor/enterprise-autopilot-b91d` (PR #32); ManagePullRequest unavailable — tip commits update PR

## Blockers

- PDF/image attachment OCR not wired (needs Graph attachment download + pdf text layer / vision LLM via vault) — plain text/HTML path complete
- `handler:requisition_parse:rpc_http_404` still blocks webhook→campaign materialization
- Hermes drafts env-Kimi 401 (vault path OK when workspaceId set)

## Next steps

1. Do **not** resume Microsoft Graph / Outlook / live-calendar E2E
2. Debug `requisition_parse` rpc_http_404 (PostgREST overload / arg names vs live DB)
3. Optional: wire PDF/image OCR per footer in `src/lib/mantu-need-parse.ts` when attachment ingest is in scope
4. Redeploy only when owner confirm matches HEAD via `print-fly-deploy-confirm.sh`
5. Optionally unset public `ARIA_WEB_INTERNAL_URL` once 6PN `::` bind verified

## Decisions made (don't relitigate)

- PR **#32**; Fly-only; local gate = CI authority
- Never invent secrets; never log decrypted vault material
- Vault LLM fallback workspace-scoped + `status=valid`
- Owner ordered skip Microsoft path — no MS client secret polling / Graph Outlook / live Teams book gate
- VSS structured extraction preferred over freeform-only; ACTIVE-email path retained
- Tip may lag HEAD — OK unless confirm present

## Watch out

- After deploy, start loop machine if suspended (`flyctl machine start <loop-id>`)
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`
- Secret `ARIA_WEB_INTERNAL_URL` overrides `[env]` — remove after `::` bind verified on 6PN
- EU start dates (`dd/mm/yyyy`) preferred in VSS parser; US ACTIVE-email dates with month>12 fall back to `Date` parse
