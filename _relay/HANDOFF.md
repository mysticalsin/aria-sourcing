---
project: MSourcing / ARIA
shift: 433
agent: cursor-cloud
updated: 2026-08-30T10:26Z
status: pr48-merged-pr50-rebasing
---

# Handoff — Shift 433

## Current state

- **PR #48 MERGED** → `eaf898f` on `integration/sourcing-enrichment-on-main` (head tip `f0b5760`)
- **Fly** already on `f0b5760` · `/api/ready` → `ok:true`
- **PR #50** undrafted; rebasing onto `eaf898f` (manifest digests recomputed for accordion + firstrun suites)
- **PR #49** CLOSED — not merging
- GHA/Vercel budget phantoms ignored (Fly-only)

## Done this shift

1. Merged PR #48 via `gh pr merge 48 --merge`
2. `gh pr ready 50`; rebase onto post-#48 integration in progress

## Blockers

none for merge path (local gate still required before merge #50)

## Next steps

```bash
# finish rebase, push --force-with-lease, local gate, gh pr merge 50 --merge
# FF main to integration; deploy tip if ≠ Fly; QA
curl -sS https://aria-mantu-app.fly.dev/api/ready
```

## Decisions made (don't relitigate)

- Fly-only production; ignore GHA/Vercel budget reds for merge
- No megapr reintroduction; Graph/Microsoft HOLD
- Prefer FF-sync `main` to `integration/sourcing-enrichment-on-main` after merges

## Watch out

- Manifest contract digests must include BOTH `settings-accordion` and `command-center-firstrun` after rebase
- Do not merge OCR / Europe megapr dumps
