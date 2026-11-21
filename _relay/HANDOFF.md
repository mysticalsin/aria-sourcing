---
project: MSourcing / ARIA
shift: 472
agent: cursor
updated: 2026-11-21
status: approval-ledger-acceptance
---

# Handoff - Shift 472

## Current state

- #167 stays frozen at `9e231dfcffc623df0fffce21b6d143df98c9fa5f` on `cursor/approval-ledger-allowlist-601c`. Do not push that branch.
- `1f835cbdea29930f4af20423b190f43ebc42270c` is a normal ancestor of that frozen head, parent `eef6bf61`. It is not a merge commit.
- #182 is the draft stacked on #167: branch `cursor/aria-ledger-hardening-followup`. Red acceptance commit `17f05d5641838ba1fca0433b97c51907858a7a93`. The fix is the commit that adds `supabase/migrations/0013_claim_exact_recompute.sql`.
- `0013_exact_body_hash.sql` does not exist. The exact-hash migration is `0011_exact_body_hash.sql`, already pushed. `0013` replaces `claim_email_outbound` instead of rewriting `0011`.
- The live claim recomputes `exact_outreach_body_hash` and `outreach_wire_body_hash`, binds `p_candidate_email`, and calls `apply_channel_daily_cap` in the same transaction. A refusal returns before that write. A cap failure raises so the claim rolls back.
- `outreach_channel_sent_today` returns `daily_cap` from `outreach_channel_cap_config`. The send route and the dispatcher use that value. A missing count or a missing config returns a reason and the route answers 503.
- Members cannot `UPDATE` or `DELETE` `outreach_ledger`. Status changes go through `append_outreach_ledger_event`, which is service-role only and inserts `outreach_ledger_events`.
- There is no `aria_app` role.
- Local `npm run typecheck`, `npm run typecheck:tests`, and `npm test` exited 0. This environment has no Docker, so `tests/approval-acceptance-db.sh` runs in the Database security job.

## Done this shift

- Pushed the failing acceptance tests, then the claim, cap, and append-only ledger fix.

## Blockers

- Database security CI has not been confirmed on the fix head yet.
- Conflicts with #168, #169, #170, and #172 stay unresolved. Do not restore paths #168 deletes.

## Next steps

1. Wait until every GitHub check on the #182 head is success, then do not push again.
2. #167 and #182 merge together. Do not merge either from this shift.
3. Do not rebase #167.

## Decisions made (don't relitigate)

- Tony, 20 Nov 2026: MANUAL is the default. FULL AUTOMATIC is opt-in and requires a QC pass bound to the exact body hash.
- Tony, 20:30 BRT: `linkedin_token` is off by default. This PR does not send it, and dispatch has no enable path for it.
- Demo and test both fail closed on an empty allowlist. Non-ASCII recipients are refused rather than folded.
- `body_hash` stays the wire hash. `exact_body_hash` is the exact approval binding.
- #167 stays at `9e231dfc`. The acceptance fixes live on #182 and the two PRs merge as one unit.
- The daily cap ceiling is the `outreach_channel_cap_config` row, not `ARIA_CHANNEL_DAILY_CAP`.

## Watch out

- `claim_email_outbound` is now nine arguments. The privilege matrix and the cross-channel wrapper pass subject and body.
- `apply_channel_daily_cap` is revoked from `authenticated` and `service_role`. Only the security-definer claims call it.
- Seeds that claim email must store a real wire hash, a real exact hash, and a scope hash of `candidate || newline || Email || newline || lower(email)`.
