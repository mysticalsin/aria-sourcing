---
project: MSourcing / ARIA
shift: 11
agent: codex
updated: 2026-07-10 08:08
status: possessive-range-disclosure-fix-tsc-clean
---

# Handoff - Possessive Range Disclosure Fix

## Current state
- Candidate-facing disclosure policy blocks compensation-topic drafts unless they are safe candidate-target questions or recruiter/later deferrals.
- The residual possessive range leak is closed:
  - `within our/the/your salary/pay/comp range|band|budget`
  - `in our/the/your salary/pay/comp range|band|budget`
  - `our/the/your salary/pay/comp range|band|budget`
- Bare safe candidate questions still pass, including `What range are you targeting?` and `What range are you looking for?`.
- Commitment reason tags were preserved.

## Done this shift
- Attempted required Graphify navigation:
  - `/graphify query "MSourcing ARIA candidate disclosure compensation range band budget validation"` failed because `/graphify` is not present in this shell.
  - `graphify-out/wiki/index.md` is absent.
- Updated `src/lib/agent-disclosure-policy.ts`:
  - Added possessive `range|band|budget` compensation-topic patterns for `within`, `in`, and bare possessive forms.
  - Did not weaken the topic gate, whitelist, guardrails, or safe-ask allowance.
- Updated `tests/agent-disclosure-policy.mts`:
  - Added block assertions for `You are well within our range.`, `You're in our range.`, and `That's our band.`
  - Added pass assertions for `What range are you targeting?` and `What range are you looking for?`
- Archived previous baton to `_relay/archive/2026-07-10-0808-codex.md`.

## Blockers
- Direct `npx tsx ...` execution is blocked inside this sandbox by a named-pipe permission error:
  - `Error: listen EPERM: operation not permitted .../T/tsx-501/*.pipe`
- Same test files pass through `node --import tsx`, matching the prior sandbox-compatible runner recorded in shift 10.

## Verification
- `npx tsc --noEmit` passed with exit 0.
- `node --import tsx tests/agent-disclosure-policy.mts` passed:
  - `RESULT agent-disclosure-policy: 88 passed, 0 failed`
- `node --import tsx tests/salary-boundary-adversarial.mts` passed:
  - `RESULT salary-boundary-adversarial: 14 passed, 0 failed`
- `node --import tsx tests/autopilot.mts` passed:
  - `RESULT autopilot: 49 passed, 0 failed`

## Next steps
1. Visionary can rerun `npx tsx tests/agent-disclosure-policy.mts` outside this sandbox.
2. Visionary can rerun `npx tsx tests/salary-boundary-adversarial.mts` outside this sandbox.
3. Review and commit this tight fix separately from unrelated dirty working-tree changes.

## Decisions made (don't relitigate)
- Salary disclosure remains controlled by an allowlist topic gate plus safe-response allowance.
- Safe compensation moves remain limited to asking the candidate for their target/expected range or deferring compensation to a recruiter/later discussion.
- No LinkedIn, approval, dispatch, or prompt construction behavior was changed in this fix.

## Watch out
- The working tree had substantial pre-existing changes before this shift.
- `src/lib/agent-disclosure-policy.ts` and `tests/agent-disclosure-policy.mts` are untracked in git status but are active source/test files for this disclosure security pass.
