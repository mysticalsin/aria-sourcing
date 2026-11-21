---
project: MSourcing / ARIA
shift: 471
agent: cursor
updated: 2026-11-21
status: approval-ledger-dual-hash
---

# Handoff - Shift 471

## Current state

- Branch `cursor/approval-ledger-allowlist-601c`. PR #167 targets `twa-odoo`. Not merged, not rebased, not force-pushed.
- Sentinel agreed on `6c02aec7` and then reported that `body_hash` cannot be both the wire digest and `exactBodyHash`. The failing tests are `eef6bf61f7e585bc69b8cb19dc99ed11d9f4f3c9`. The fix stores `body_hash` as `sha256(subject || newline || body)` and `exact_body_hash` as the exact binding. `claim_email_outbound_queued` and `enforce_active_email_approval` check both. The dispatcher checks both.
- Non-ASCII recipients are refused. They are not folded onto ASCII allowlist entries.
- The per-UTC-day channel cap is `consume_outreach_channel_daily_cap` in Postgres. The send route and the dispatcher pass `dailyCap`. The in-memory `consultCounts` map is gone.
- `linkedin_token` stays blocked in dispatch. There is no enable path in this PR.
- New gitleaks fingerprints were checked with `git rev-list --all`. The secret-scan job now rejects an ignore line whose commit is not reachable.
- `tests/approval-dispatch-db.sh` is the real Postgres proof (claim, trigger, dispatcher, edited body, swapped recipient). This environment has no Docker, so that script was not run here. Database security CI runs it.
- Local `npm run typecheck`, `npm run typecheck:tests`, and `npm test` exited 0.

## Done this shift

- Unfroze `6c02aec7`, committed the failing tests, then the fix.

## Blockers

- Conflicts with #168, #169, #170, and #172 are still expected and were not resolved.

## Next steps

1. Wait until every GitHub check on the new head is green, then do not push again.
2. After #168 merges, rebase #167 onto it. Do not do that in this shift.
3. Do not merge #167 from this shift.

## Decisions made (don't relitigate)

- Tony, 20 Nov 2026: MANUAL is the default. FULL AUTOMATIC is opt-in and requires a QC pass bound to the exact body hash.
- Tony, 20:30 BRT: `linkedin_token` is off by default. This PR does not send it, and dispatch has no enable path for it.
- Demo and test both fail closed on an empty allowlist. Non-ASCII recipients are refused rather than folded.
- `body_hash` stays the wire hash. `exact_body_hash` is the exact approval binding.
- #168 lands first. #167 rebases onto it only after #168 merges.

## Watch out

- The queued claim now also requires `exact_body_hash` and `approved_at` within 7 days. Seeds that claim email must set `exact_body_hash`.
- The daily cap default is `DEFAULT_CHANNEL_DAILY_CAP` (50) when `ARIA_CHANNEL_DAILY_CAP` is unset. An unparseable value is zero.
- Audit entries still do not store the recipient address or the message text.
