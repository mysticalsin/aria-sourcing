---
project: MSourcing / ARIA
shift: 470
agent: cursor
updated: 2026-11-21
status: approval-ledger-devin-gate-fixed
---

# Handoff - Shift 470

## Current state

- Base branch `twa-odoo` is `e3fa3f594a6d86aec31d42a65414a96be4c8400e`. Michael's branches were not rewritten or deleted. This branch was not rebased and was not force-pushed.
- Feature branch `cursor/approval-ledger-allowlist-601c`. PR #167 targets `twa-odoo`. Not merged.
- Devin's void gate (head moved `cfcf96ab` -> `8e72cd7f`) is addressed on top of `1047a564`. Failing tests are `9834aba233c64d0032be128f2ee0c9d6ef09a868` (`tests/approval-devin-gate.mts`, 13 failed, 0 passed). The fix commit follows it.
- `exactBodyHash` NFC-normalizes the text and binds approver id and approval timestamp. The send route and the dispatcher compare that hash, not `approvalHash`.
- Demo with an unset allowlist fails closed. Host matching is exact or a dot-boundary subdomain. Homoglyph fold and trim stay on.
- Approval lifecycle is `draft -> pending -> approved -> sent`, plus `invalidated`. Illegal transitions throw. The per-channel cap resets on the UTC day of the injected clock. `consultApprovalLedger` is on the send route and the dispatcher.
- `claim_email_outbound` in `supabase/migrations/0001_baseline.sql` refuses a null `approved_at` or one older than 7 days. `tests/db/approval-ttl.sql` runs from `tests/schema-authority-db.sh`.
- `GET /api/linkedin/outbox` returns 410 and no items. Sentinel fixtures use `profiles.example.test`. The Voyager bridge and the extension are still in the tree.
- Secret scan uses `gitleaks git . --log-opts='--all'` with `fetch-depth: 0`. The `fc1d82a8` line-22 fingerprint is in `.gitleaksignore`. A local `--all` scan after `git fetch origin` reported no leaks.
- Agents healthcheck is `process.kill(1,0)`. #168 deletes it.
- `linkedin_token` stays refused unless `linkedinTokenEnabled === true`. This PR does not network-send it.
- Local gate: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint` (0 errors, 2 pre-existing warnings), and `npm test` exited 0.

## Done this shift

- Committed the failing Devin-gate tests, then the fixes. No force-push, no merge, no rebase.
- Did not delete the Voyager bridge or the extension.

## Blockers

- None on this branch. Conflicts with #168, #169, #170, and #172 are expected and were not resolved.

## Next steps

1. Wait until every GitHub check on the final head is green, then do not push again.
2. After #168 merges, rebase #167 onto it. Do not do that in this shift.
3. Do not merge #167 from this shift.

## Decisions made (don't relitigate)

- Tony, 20 Nov 2026: MANUAL is the default. FULL AUTOMATIC is opt-in per campaign and channel and requires a QC pass bound to the exact body hash. The QC agent is a stub. No model call.
- Tony, 20:30 BRT: the LinkedIn token option is an off-by-default switch. Channel id is `linkedin_token`. It is refused unless the per-workspace flag is on. This PR does not send it.
- Demo and test both enforce the allowlist. An unset list matches nobody.
- #168 lands first. #167 is rebased onto #168 only after #168 merges.
- Owner decisions in the archived shift-469 baton stay archived.

## Watch out

- `claim_email_outbound_queued` still compares the subject-plus-body wire hash. The interactive `claim_email_outbound` compares the stored hash and now requires `approved_at` within 7 days.
- The in-memory ledger is not the Rust ledger. A QC pass still does not release `/api/outreach/send` by itself.
- Audit entries store actor, message id, channel, campaign id, reason, and body hash. They do not store the recipient address or the message text.
- `.gitleaksignore` now comments every fingerprint and adds the full-history Go fixture fingerprints. #168 also edits that file.
