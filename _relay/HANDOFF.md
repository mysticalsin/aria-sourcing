---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-21
status: interviewer-handoff-qa-fix
---

# Handoff - Shift 469

## Current state

- Branch `cursor/aria-interviewer-handoff` off `twa-odoo` (`e3fa3f59`).
- Red-first commit `4ade6575` is tests only. `go test` in `go/interviewer` fails to compile because the adapter API is absent. Output is in the PR body.
- Implementation lives under `go/interviewer/**`, the console route `src/app/interviewer/page.tsx`, and a hand-off panel on `/calendar` and `/candidates`.
- `go test -count=1 -race -timeout 120s .` in `go/interviewer` exits 0. `node tests/interviewer-console.mjs` exits 0 (Chromium and WebKit, flag off and on).
- Feature flag `ARIA_INTERVIEWER_ENABLED` defaults off. The console shows a disabled state. Nothing is sent while it is off.
- Need summaries, role questions, report summaries and score reasoning are scrubbed of emails, phones and URLs before send or store.
- The package does not write Odoo stages and does not auto-reject. Recommendation is advisory.
- Interviewer contract assumed from public `mysticalsin/aria-interviewer` branch `feat/aria-fusion-multimodal-streaming` at `369077cef402eea6df66f5a7e166e9a51dc252b1`. That tree has no `/v1/screenings` webhook. The façade is documented in `go/interviewer/doc.go`.
- Not wired to Odoo. PRs #171 and #176 still own the Go Odoo client and the addon. Not touched: #167 ledger, #175 channels, #170 Rust core, `mbe-*`, `main`, `vercel-demo`.

## Done this shift

- Added the isolated hand-off adapter: eligibility (`to_interview` + recorded approval + consent true), idempotent POST, poll, HMAC webhook, state machine, bounded timeout retry classified as `ErrInfra`.
- Tests use `httptest` only. No real key and no external network.
- Forge checks are in `property_test.go`, `noskip_test.go`, `spec_boundary_test.go`, and `timeout_infra_test.go`.
- CI: new `go-interviewer` job (`go test -count=1 -race`) is required by the release gate. Quality installs Playwright Chromium and WebKit for `tests/interviewer-console.mjs`.
- Inspector QA on `42b564e4` (no console route, raw need summary) is fixed on this branch. Red-first for that fix is `781717c0`.

## Blockers

- None in this package. Odoo wiring is intentionally deferred until #171 and #176 merge.

## Next steps

1. Review the draft PR into `twa-odoo`. Do not merge it into `main` or `vercel-demo`.
2. After #171 and #176 merge, call `interviewer.RequestScreening` only when the applicant stage is `to_interview` and the approval ledger has a recorded approval. Persist the returned `Handoff`. Do not map `no_hire` / `strong_no_hire` onto `rejected`.
3. When the interviewer grows a real screening façade, point `INTERVIEWER_BASE_URL` at it. Keep the flag off until that contract exists.

## Decisions made (don't relitigate)

- This shift: the voice-screening hand-off is a separate Go package. It never changes an Odoo stage and never auto-rejects. `ARIA_INTERVIEWER_ENABLED` defaults off. Timeouts are infrastructure errors after one retry, not candidate failures. Webhook HMAC uses `crypto/subtle.ConstantTimeCompare`. The API key is never logged.
- Shift 468 decisions stay in force. Full text: `_relay/archive/2026-11-21-0320-cursor.md`. In particular: no Apify, no "hermes" in code, human approval before any send, English UI, do not relitigate the demo-day navigation or LinkedIn bridge decisions recorded there.

## Watch out

- `go/interviewer` tests must not call `t.Skip`, must not contain a URL literal (`://`), and must not dial a real host. The no-skip gate fails the package if they do.
- A screening idempotency key is a digest of candidate id + need id + approval id. Reusing the same triple returns the same remote screening.
- The fake server must drain the request body before hanging, or the client timeout deadlocks `httptest.Server.Close`.
- Do not edit `services/` (PR #171) or `core/` (PR #170) from this branch.
- Do not force-push. Do not use `--no-verify`. Do not touch `mbe-*`, `main`, or `vercel-demo`.
