---
project: MSourcing / ARIA
shift: 470
agent: cursor
updated: 2026-11-21
status: qc-gate-bound-to-draft
---

# Handoff - Shift 470

## Current state

- Branch `cursor/aria-qc-gate`, based on `twa-odoo` (`e3fa3f59`). Draft PR #185.
- First red-first commit `86dd7f63` (`test(qc): add failing QC gate checks`).
- Implementation `90bbadf4`. Handoff `6103e535`.
- Inspector follow-up red commit `943acc29` (`test(qc): reject a stale pass and an ungated autopilot send`). `Apply` ignored the draft and `Admit` let an over-cap PASS through. The autopilot tick still queued.
- Package remains `go/qc` in module `github.com/mysticalsin/aria-sourcing`. No ledger, Odoo, channel, or Rust imports.
- CI job is `.github/workflows/go-qc.yml`. `.github/workflows/ci.yml` is not edited.

## Done this shift

- Each verdict carries `draft_hash`, the SHA-256 of channel, subject, body, language, and claims. `Apply` returns `ErrStaleVerdict` when the hash is empty or does not match the draft. The sequence QCFailed -> QCPending with a PASS from an edited draft stays failed until `Evaluate` runs again.
- `Admit` is the send boundary. It requires a PASS bound to that draft and runs the channel cap check again.
- `go/qc/cmd/qceval` reads one JSON draft on stdin and prints the verdict plus `caps_ok`.
- Autopilot queueing calls that gate, `ARIA_OUTREACH_KILL_SWITCH`, and `ARIA_OUTREACH_DAILY_CAP` (default 25). A missing verdict, an unreadable switch, an unreadable count, or a count at the cap does not queue. Tests use the in-memory LinkedIn sink.

## Blockers

- Local Docker demo and Secret scan are already red on `twa-odoo` `e3fa3f594a6d86aec31d42a65414a96be4c8400e` (CI run https://github.com/mysticalsin/aria-sourcing/actions/runs/44824720933). This branch does not change the agents healthcheck or the secret-scan history. A separate base-CI PR owns those fixes.

## Next steps

1. Wait until every check on the PR head is terminal. Do not push again after that.
2. After #167 merges, the approval ledger should store `draft_hash` with the verdict and refuse a send when the hash does not match the body it would send.
3. Do not retarget this branch onto `mbe-*`, `main`, or `vercel-demo`.

## Decisions made (don't relitigate)

- QC output is PASS/FAIL, a score in [0, 1], seven reasons in fixed order, and `qc_version` `qc.v1`. The verdict also carries `draft_hash`.
- A failed check forces FAIL even when the score still meets `ARIA_QC_PASS_THRESHOLD`. Lowering the threshold cannot waive a check.
- A verdict applies only to the exact draft text it was computed from. Any edit requires a new `Evaluate`.
- Channel caps are checked inside `Evaluate` and again in `Admit` before a send.
- Length counts Unicode code points. InMail subject 200 and body 1900 (LinkedIn help a411986; 1900 is the stricter published cap). HeyReach direct message body 8000 and InMail subject/body 200/1900 (`heyreach.io/blog/campaign-api`). Connection notes 300 for Premium/Sales Navigator (`help.heyreach.io` article 10493916). Email subject 200 and body 10000 are Aria caps.
- Candidate claims are grounded only by candidate-scoped facts. Need facts ground need-scoped claims and may carry `legal_nationality`. Tenure (`12 years`) is scanned in the draft and must appear in a candidate fact.
- Language is stopword detection for en, fr, de, es, pt, it, nl. Missing, tied, or unsupported language fails closed. The caller cannot label a draft into a pass.
- Automatic LinkedIn queueing requires a fresh PASS (`caps_ok`), the kill switch off, and `sentToday < dailyCap`. Unknown values do not send.
- This package does not send, does not call a network, and does not import ledger, Odoo, or channel code.

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages that need an integration this install does not run are left out of the navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`.
- Shift 466: a LinkedIn message recorded as sent is a real send (`dryRun: false`); the dry-run switch is email only.
- Owner 2026-11-09, ADR 0002: an `agents` Compose service is allowed. Campaign autopilot may queue LinkedIn writes from the owner's paired account under a standing approval.
- Owner 2026-11-06: Apify is retired. No stealth scraping. No "hermes" in the code.
- Owner 2026-11-03: Vercel is dropped. No local LLM. Caddy is the API gateway. Docker targets a Mac.
- Human approval before any send remains the default. Full-auto is opt-in and still has to clear this QC gate, caps, a kill switch, and an Odoo audit. The Odoo audit is not in this package.
- Sourcing spends only an admin vault key. Model per task: Haiku for classify/extract, Sonnet for chat, outreach, and sourcing, Opus only by explicit choice.

## Watch out

- Free LinkedIn accounts document a 200-character connection note. This gate uses HeyReach's Premium/Sales Navigator cap of 300 because the draft does not carry the account plan.
- Qualitative claims that are not passed in `Draft.Claims` and do not match `\d+ years` are not detected.
- Protected-attribute matching uses ASCII word boundaries and a fixed lexicon. Paraphrases can slip through. `young` is flagged; bare `old` is not, so "senior engineer" stays legal.
- `spanish` and `italian` are treated as nationalities.
- `ARIA_OUTREACH_DAILY_CAP` defaults to 25 for the workspace. The LinkedIn bridge still has its own per-account cap.
- Do not force-push this branch and do not use `--no-verify`.
- `_relay/codex-findings.md` still has open owner-action items (ElevenLabs, Fly, GitHub CLI credential). They are outside this package.
