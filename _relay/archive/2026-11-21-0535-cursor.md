---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-21
status: qc-gate-implemented
---

# Handoff - Shift 469

## Current state

- Branch `cursor/aria-qc-gate`, based on `twa-odoo` (`e3fa3f59`). Not merged.
- Red-first commit `86dd7f63` (`test(qc): add failing QC gate checks`). `go test -count=1 ./go/qc/...` exited 1: 50 failing tests, 0 panics. Forge isolation tests passed on that commit.
- Implementation commit `90bbadf4` (`feat(qc): implement the deterministic outreach QC gate`). Same command exited 0 (`ok github.com/mysticalsin/aria-sourcing/go/qc`).
- Package is `go/qc` in module `github.com/mysticalsin/aria-sourcing` (`go.mod` at the repo root, no third-party requirements). `go test ./go/qc/...` runs from the repo root.
- CI job is new: `.github/workflows/go-qc.yml`. `twa-odoo` has no Go job. `.github/workflows/ci.yml` was not edited (open PRs #167 and #175 already touch it).
- No edits under the approval ledger (#167), `services/channels` (#175), `core/` (#170), or `services/` Odoo client (#171).

## Done this shift

- Added the isolated QC gate: pure `Evaluate`, `Verdict`, states `Draft` / `QCPending` / `QCPassed` / `QCFailed`, and `ARIA_QC_PASS_THRESHOLD` (default 0.9).
- Checks: grounding, protected attributes, email opt-out, channel length, placeholders, salary promises, language. `qc_version` is `qc.v1`.
- Table tests, `go/qc/testdata` fixtures, exact length boundaries, property tests, and fuzz seeds. Synthetic names only (`Ada Example`, `Northwind Labs`, `example.com`).

## Blockers

- None in this package. Ledger wiring waits on #167.

## Next steps

1. Open the draft PR from `cursor/aria-qc-gate` into `twa-odoo` and wait until every check on the head is green. Do not push again after that.
2. After #167 merges, the approval ledger should consume `qc.Verdict`. The ledger imports this package. This package must not import the ledger.
3. Do not retarget this branch onto `mbe-*`, `main`, or `vercel-demo`.

## Decisions made (don't relitigate)

- QC output is PASS/FAIL, a score in [0, 1], seven reasons in fixed order, and `qc_version` `qc.v1`.
- A failed check forces FAIL even when the score still meets `ARIA_QC_PASS_THRESHOLD`. Lowering the threshold cannot waive a check.
- Length counts Unicode code points. InMail subject 200 and body 1900 (LinkedIn help a411986; 1900 is the stricter published cap). HeyReach direct message body 8000 and InMail subject/body 200/1900 (`heyreach.io/blog/campaign-api`). Connection notes 300 for Premium/Sales Navigator (`help.heyreach.io` article 10493916). Email subject 200 and body 10000 are Aria caps.
- Candidate claims are grounded only by candidate-scoped facts. Need facts ground need-scoped claims and may carry `legal_nationality`. Tenure (`12 years`) is scanned in the draft and must appear in a candidate fact.
- Language is stopword detection for en, fr, de, es, pt, it, nl. Missing, tied, or unsupported language fails closed. The caller cannot label a draft into a pass.
- This package does not send, does not call a network, and does not import ledger, Odoo, or channel code.

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages that need an integration this install does not run are left out of the navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`.
- Shift 466: a LinkedIn message recorded as sent is a real send (`dryRun: false`); the dry-run switch is email only.
- Owner 2026-11-09, ADR 0002: an `agents` Compose service is allowed. Campaign autopilot may queue LinkedIn writes from the owner's paired account under a standing approval.
- Owner 2026-11-06: Apify is retired. No stealth scraping. No "hermes" in the code.
- Owner 2026-11-03: Vercel is dropped. No local LLM. Caddy is the API gateway. Docker targets a Mac.
- Human approval before any send remains the default. Full-auto is opt-in and still has to clear this QC gate, caps, a kill switch, and an Odoo audit. Those send controls are not in this package.
- Sourcing spends only an admin vault key. Model per task: Haiku for classify/extract, Sonnet for chat, outreach, and sourcing, Opus only by explicit choice.

## Watch out

- Free LinkedIn accounts document a 200-character connection note. This gate uses HeyReach's Premium/Sales Navigator cap of 300 because the draft does not carry the account plan.
- Qualitative claims that are not passed in `Draft.Claims` and do not match `\d+ years` are not detected.
- Protected-attribute matching uses ASCII word boundaries and a fixed lexicon. Paraphrases can slip through. `young` is flagged; bare `old` is not, so "senior engineer" stays legal.
- `spanish` and `italian` are treated as nationalities.
- Do not force-push this branch and do not use `--no-verify`.
- `_relay/codex-findings.md` still has open owner-action items (ElevenLabs, Fly, GitHub CLI credential). They are outside this package.
