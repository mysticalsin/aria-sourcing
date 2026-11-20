---
project: MSourcing / ARIA
shift: 469
agent: cursor
updated: 2026-11-20
status: approval-ledger-ready-for-review
---

# Handoff - Shift 469

## Current state

- Base branch `twa-odoo` is `e3fa3f594a6d86aec31d42a65414a96be4c8400e` (`docs(relay): shift 468 handoff`). No other commits were added to it. Michael's branches were not rewritten or deleted.
- Feature branch `cursor/approval-ledger-allowlist-601c` holds the approval ledger. PR targets `twa-odoo`. Not merged.
- Ledger modules: `src/lib/approval/{types,hash,allowlist,qc,audit-log,dispatch-guard,ledger}.ts`.
- Tests: `tests/approval-ledger-boundary.mts`, registered in `tests/test-manifest.mjs` (application and security groups).
- Gate on this branch: `npm run typecheck`, `npm run typecheck:tests`, and `npm test` exited 0. The new file reported 8 passed, 0 failed.
- No live send, deploy, or provider call was added. Synthetic addresses only (`*.example.test`).

## Done this shift

- Wrote the eight ledger tests first against a stub that skipped the allowlist, left automatic mode on, and recorded no audit entries. That run failed 8, passed 0 (`'stub' !== 'approved'`, manual approval `true !== false`, `sendMode` returned `automatic`, kill switch still allowed a send, the second email was not capped, test-mode reason was `stub` not `allowlist`, audit length `0 !== 9`).
- Replaced the stub. The same eight tests then passed.
- `src/app/api/outreach/approve/route.ts` calls `approvalPolicyFromEnv` before `record_outreach_approval`.
- `src/app/api/outreach/send/route.ts` and `src/lib/dispatch-outbound.ts` call `sendPolicyFromEnv` before `performEmailSend`.
- Exact body hash reuses `approvalHash` from `src/lib/outreach-content.ts` and also binds channel, recipient, and notice version.
- LinkedIn bridge and autopilot files were not edited.

## Blockers

- None.

## Next steps

1. Review the PR. Do not merge it from this shift.
2. Persist the ledger (caps, QC passes, audit entries) and mirror approvals to Odoo in a later PR. This shift's ledger is in memory and is the decision API the tests call.
3. Do not connect an `automatic` authorization to `performEmailSend` until Tony turns live mode on. `ARIA_MODE=live` is refused.

## Decisions made (don't relitigate)

- Tony, 20 Nov 2026: MANUAL is the default. A human approves the exact text, one message or a batch. FULL AUTOMATIC is opt-in per campaign and channel. It authorizes a send only after a QC pass bound to that exact body hash. The QC agent in this shift is a stub interface plus a deterministic generic-message detector. No model call.
- QC pass requires `pass === true`, rubric score >= 80 (`MIN_QC_RUBRIC_SCORE`), and `generic === false`. The ledger hashes the message itself. The agent cannot supply the hash.
- An edit of body, subject, recipient, channel, or notice version refuses the send with `body-hash-mismatch`. The stored approval still matches the original text. A second send of that same text is `already-authorized`.
- Allowlist env name is `ARIA_RECIPIENT_ALLOWLIST`. It is enforced when the list is non-empty, and always when `ARIA_MODE=test` (an empty list contacts nobody). Demo with the list unset does not invent a list.
- Kill switch env name is `ARIA_SEND_KILL_SWITCH` (`1`, `true`, or `on`). It blocks ledger sends and the existing send and dispatch paths. Recording an approval still works while it is on.
- `AGENTS_LINKEDIN_ALLOWLIST` was not reused. The autopilot files that read it are owned by the removal PR.
- Owner decisions recorded in the archived shift-468 baton stay archived. This shift does not relitigate them and does not carry the LinkedIn autopilot forward.

## Watch out

- `/api/outreach/send` still requires `approval_source === "human"` and the existing SQL claim. A QC pass alone cannot send through that route. The new per-channel cap is enforced inside `ApprovalLedger`, not inside the SQL warmup cap.
- Demo with `ARIA_RECIPIENT_ALLOWLIST` unset still accepts a manual approval for any recipient. Set the list, or `ARIA_MODE=test`, before any test that must be allowlist-only.
- Audit entries store actor, message id, channel, campaign id, reason, and body hash. They do not store the recipient address or the message text.
- `tests/store-contracts.mts` still pins the store action count at 118. This shift did not change the store.
