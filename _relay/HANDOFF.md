---
project: MSourcing / ARIA
shift: 441
agent: cursor-cloud
updated: 2026-08-30T22:03Z
status: live-sourcing-fixed-pr53-closed-needs-reopen
---

# Handoff — Shift 441

## Current state

- **Branch tip:** `cursor/sourcing-quality-contact-track-b91d` @ `643a4e097eabbf3f2541ba34e22f251d43c85b02`.
- **Fly:** ready green at build `643a4e097eabbf3f2541ba34e22f251d43c85b02` (aria-mantu-app). Migration `0079_autopilot_enqueue_approval_hash_bind.sql`.
- **PR #53:** still CLOSED (reopen 403). Do **not** open a second PR.
- **Human PR title (preserve):** `Sourcing: perfect need-agnostic quality (gates, JSON brief, evidence, dedupe)`
- Gate green: `npm run typecheck && npm run typecheck:tests && npm test`.
- Live Calypso Source: HTTP 200 `ok:true` JSON envelope (no more "invalid response"). `totalFound:0` under hard gates for GitHub bios — soft success, not failure.

## Done this shift

1. **Root cause (invalid response):** `tool-loop` statically imported `browser-tools` → `playwright-core`. Fly standalone lacks `browsers.json` → HTML error page → client `The sourcing agent returned an invalid response.`
2. Lazy-load browser tools; soft-filter candidate DTOs.
3. **Root cause (browser Origin):** `HOSTNAME=0.0.0.0` → `nextUrl.origin` is `https://0.0.0.0:3000`. Fixed via `requestSameOrigin` (Host / X-Forwarded-Host / SITE_URL).
4. **Root cause (Calypso unavailable):** strict JobAnalysis + githubQueries.label rejected live workspace extras → 503. Projection now strips/normalizes.
5. Deployed tip to Fly; `/api/ready` build matches tip; e2e-workflow-test PASS (10/0).

## Blockers

- PR #53 closed + reopen/edit 403. Parent must `gh pr reopen 53` then merge.

## Next steps

```bash
gh pr reopen 53
# Preserve human title; append fix notes to body only if editing
gh pr merge 53
curl -s https://aria-mantu-app.fly.dev/api/ready   # already on tip 643a4e0
```

## Decisions made (don't relitigate)

- One PR (#53) only — no second PR / no #36.
- No Microsoft chase.
- Soft empty shortlist under hard gates is success (info toast), not "Sourcing failed".
- Human-edited PR title/body preserved.

## Watch out

- GitHub bios rarely clear Calypso+BA+MySQL hard gates → 0 candidates is expected until queries/providers improve.
- Do not reintroduce static `browser-tools` import into `tool-loop`.
